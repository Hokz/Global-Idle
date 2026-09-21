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
