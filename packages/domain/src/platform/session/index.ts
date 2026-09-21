/**
 * Browser sessions (Phase 1 spec §3.2, §3.2.1).
 *
 * ┌─ THIS IS A DEVELOPMENT / TEST HARNESS, NOT AUTHENTICATION ──────────────┐
 * │ The `dev` provider's subject is a self-asserted handle with NO SECRET,  │
 * │ so typing another player's handle IS logging in as them. Acceptable for │
 * │ a local slice and a CI fixture; unacceptable anywhere else. The gates   │
 * │ live in `devAuthEnabled` below, and Phase 1 is not production-          │
 * │ deployable. Real authentication is a later phase's work.                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * TWO IDENTITIES, deliberately not one:
 *
 *   accountId   WHO owns the characters       stable across logins, devices
 *   sessionId   WHICH login is acting now     minted per successful sign-in
 *
 * `SessionBoundActivity.claimHolderSessionId` is the connection holding the
 * claim (ADR-008: the newest connection evicts the previous). Passing
 * `accountId` there would make two browsers on one account indistinguishable
 * and silently break eviction before Phase 2 implements it.
 *
 * The signed cookie IS the session record. No table: Phase 1 needs no
 * server-side revocation, no session listing and no idle expiry, and durable
 * state with no reader is state that drifts.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { newId, type AccountId, type SessionId } from '@global-idle/shared';

export const SESSION_COOKIE = 'gi_session';

export interface SessionPayload {
  readonly accountId: AccountId;
  readonly sessionId: SessionId;
}

/**
 * Is the dev credential provider available?
 *
 * BOTH gates, not either: a stray environment variable in one place must not
 * be enough. `assertDevAuthSafe` turns the dangerous combination into a boot
 * failure rather than an open door.
 */
export function devAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NODE_ENV'] !== 'production' && env['GLOBAL_IDLE_DEV_AUTH'] === '1';
}

export class DevAuthMisconfigured extends Error {
  constructor() {
    super(
      'GLOBAL_IDLE_DEV_AUTH=1 with NODE_ENV=production. The dev credential ' +
        'provider has no secret and would let anyone sign in as anyone. ' +
        'Refusing to start.',
    );
    this.name = 'DevAuthMisconfigured';
  }
}

/** Called at boot. A misconfiguration is a crash, not a warning. */
export function assertDevAuthSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (env['NODE_ENV'] === 'production' && env['GLOBAL_IDLE_DEV_AUTH'] === '1') {
    throw new DevAuthMisconfigured();
  }
}

/**
 * ONE LOCAL HOST CONVENTION: `127.0.0.1`.
 *
 * A session cookie is stored against a HOST, and `SameSite=Lax` compares the
 * site of the request with the site of the page that made it. `localhost` and
 * `127.0.0.1` are different hosts and therefore different sites, so a page on
 * one calling an API on the other is a CROSS-SITE request and the cookie is
 * simply not sent — a silent 401 with nothing in the network panel to explain
 * it. The fix is not a looser cookie; it is one convention, used everywhere.
 *
 * `127.0.0.1` rather than `localhost` because it is literal: no name
 * resolution, and no chance of resolving to `::1` on one machine and `127.0.0.1`
 * on another, which would reintroduce exactly this split.
 */
export const LOCAL_HOST = '127.0.0.1';
export const LOCAL_WEB_ORIGIN = `http://${LOCAL_HOST}:3000`;
export const LOCAL_API_ORIGIN = `http://${LOCAL_HOST}:3001`;

/** Hosts a browser already treats as a trustworthy origin over plain HTTP. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export class InsecureSessionOrigin extends Error {
  constructor(readonly origin: string) {
    super(
      `PUBLIC_ORIGIN ${origin} serves the session cookie over plaintext HTTP on a ` +
        'non-loopback host. A session that travels in the clear is readable by ' +
        'anything on the path, and marking it Secure would simply stop the cookie ' +
        'working. Serve it over https, or bind it to loopback. Refusing to start.',
    );
    this.name = 'InsecureSessionOrigin';
  }
}

export interface SessionCookiePolicy {
  /** `Secure` is set unless the session is served over loopback HTTP. */
  readonly secure: boolean;
}

/**
 * The cookie policy for an origin, decided ONCE from configuration.
 *
 * Deliberately not inferred per request: `X-Forwarded-Proto`, `Host` and the
 * request body are all attacker-controlled, and a cookie whose security
 * attributes depend on them has no security attributes. The deployment says
 * what it is; the code believes the deployment and nothing else.
 */
export function sessionCookiePolicy(publicOrigin: string): SessionCookiePolicy {
  let url: URL;
  try {
    url = new URL(publicOrigin);
  } catch {
    throw new InsecureSessionOrigin(publicOrigin);
  }
  if (url.protocol === 'https:') return { secure: true };
  if (url.protocol === 'http:' && LOOPBACK.has(url.hostname)) return { secure: false };
  throw new InsecureSessionOrigin(publicOrigin);
}

const attributes = (policy: SessionCookiePolicy): string =>
  `Path=/; HttpOnly; SameSite=Lax${policy.secure ? '; Secure' : ''}`;

/** The `Set-Cookie` value that establishes a session. */
export function sessionCookie(sealed: string, policy: SessionCookiePolicy): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(sealed)}; ${attributes(policy)}`;
}

/** The `Set-Cookie` value that clears one. The attributes must MATCH the ones
 *  it was set with, or the browser keeps the original cookie. */
export function clearedSessionCookie(policy: SessionCookiePolicy): string {
  return `${SESSION_COOKIE}=; ${attributes(policy)}; Max-Age=0`;
}

/**
 * A new login. The id is SERVER-MINTED; nothing accepts one from a client.
 *
 * `at` is REQUIRED rather than defaulted: §7.1 keeps the wall clock out of the
 * domain, and a default here would be exactly the ambient read that rule
 * exists to prevent. The composition root supplies it.
 */
export function mintSessionId(at: Date): SessionId {
  return newId<'SessionId'>(at);
}

const sign = (secret: string, body: string): string =>
  createHmac('sha256', secret).update(body).digest('base64url');

/** `<base64url payload>.<hmac>`. Opaque to the browser, which never reads it:
 *  the cookie is HttpOnly and the client has no reason to parse it. */
export function sealSession(secret: string, payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

/**
 * Open a sealed cookie, or return null.
 *
 * Every failure returns null rather than throwing: a tampered cookie is a
 * request without a session, not a server error, and the signature is compared
 * in constant time so the comparison itself leaks nothing.
 */
export function openSession(secret: string, cookie: string | undefined): SessionPayload | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = cookie.slice(0, dot);
  const presented = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(sign(secret, body));
  if (presented.length !== expected.length) return null;
  if (!timingSafeEqual(presented, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
    const candidate = parsed as SessionPayload;
    if (typeof candidate?.accountId !== 'string' || typeof candidate?.sessionId !== 'string') {
      return null;
    }
    return { accountId: candidate.accountId, sessionId: candidate.sessionId };
  } catch {
    return null;
  }
}
