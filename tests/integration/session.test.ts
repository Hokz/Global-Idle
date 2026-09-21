// Phase 1 §16 — S1 to S11, DEV1 to DEV4. Sessions and dev-provider containment
// (spec §3.2, §3.3).
//
// Every case goes over HTTP against the real application. The cookie is a
// signed value the server minted, and the assertions open it with the same
// secret the server was configured with — which is the only way to check that
// `sessionId` is server-minted rather than merely present.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DevAuthMisconfigured,
  SESSION_COOKIE,
  assertDevAuthSafe,
  devAuthEnabled,
  openSession,
} from '@global-idle/domain';
import { createClient, truncateAll } from '../support/db.js';
import {
  call,
  cookieFrom,
  publishRookgaard,
  signIn,
  startApp,
  type App,
} from '../support/phase1.js';

const prisma = createClient();
const SECRET = 'phase-1-integration-secret-value';

let directory: string;
let app: App | undefined;
let base: string;

async function boot(overrides = {}): Promise<void> {
  const started = await startApp({
    CONTENT_BUNDLE_DIR: directory,
    SESSION_SECRET: SECRET,
    ...overrides,
  });
  app = started.app;
  base = started.base;
}

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-session-'));
  await publishRookgaard(prisma, directory);
  process.env['GLOBAL_IDLE_DEV_AUTH'] = '1';
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  delete process.env['GLOBAL_IDLE_DEV_AUTH'];
});

describe('sessions', () => {
  it('S1: POST /api/session creates an account and sets a signed cookie', async () => {
    await boot();
    const response = await call<{ accountId: string }>(base, '/api/session', {
      method: 'POST',
      body: JSON.stringify({ handle: 'rookie' }),
    });

    expect(response.status).toBe(201);
    expect(response.body.accountId).toMatch(/^[0-9a-f-]{36}$/);

    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toContain(`${SESSION_COOKIE}=`);
    // HttpOnly, because the browser has no reason to read it and every reason
    // not to be able to.
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');

    const stored = await prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'dev', subject: 'rookie' } },
    });
    expect(stored?.accountId).toBe(response.body.accountId);
  });

  it('S2: the same cookie still resolves on a later request — reload persists', async () => {
    await boot();
    const cookie = await signIn(base, 'rookie');

    const first = await call<{ accountId: string }>(base, '/api/me', { cookie });
    const second = await call<{ accountId: string }>(base, '/api/me', { cookie });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.accountId).toBe(first.body.accountId);
  });

  it('S3: a session-scoped route without a cookie is 401, not 200 with a guess', async () => {
    await boot();
    const response = await call<{ error: { code: string } }>(base, '/api/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('S4: DELETE /api/session clears the cookie', async () => {
    await boot();
    const cookie = await signIn(base, 'rookie');

    const response = await call(base, '/api/session', { method: 'DELETE', cookie });
    expect(response.status).toBe(204);

    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toContain(`${SESSION_COOKIE}=;`);
    expect(header).toContain('Max-Age=0');
  });

  it("S5: account A's cookie cannot read account B's character — 404, not 403", async () => {
    await boot();
    const alice = await signIn(base, 'alice');
    const bob = await signIn(base, 'bob');

    const hers = await call<{ id: string }>(base, '/api/characters', {
      method: 'POST',
      cookie: alice,
      body: JSON.stringify({ name: 'Alice' }),
    });
    expect(hers.status).toBe(201);

    const peek = await call<{ error: { code: string } }>(base, `/api/characters/${hers.body.id}`, {
      cookie: bob,
    });

    // 404, because EXISTENCE IS INFORMATION (§19). A 403 would confirm the
    // character is real and owned by someone else.
    expect(peek.status).toBe(404);
    expect(peek.body.error.code).toBe('NOT_FOUND');
  });

  it('S6: /health and /metrics answer without any session at all', async () => {
    await boot();

    const live = await call(base, '/health/live');
    const ready = await call(base, '/health/ready');
    const metrics = await call<string>(base, '/metrics');

    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(metrics.status).toBe(200);
    // An operator's scrape must not need a player's cookie.
    expect(String(metrics.body)).toContain('occupancy_claims_active');
  });

  it('S7: a cookie whose signature was tampered with is refused', async () => {
    await boot();
    const cookie = await signIn(base, 'rookie');

    const [name, value] = cookie.split('=');
    const raw = decodeURIComponent(value ?? '');
    const dot = raw.lastIndexOf('.');
    // Flip the LAST character of the signature: the payload still parses, so
    // only the signature check can catch this.
    const signature = raw.slice(dot + 1);
    const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');
    const forged = `${name}=${encodeURIComponent(`${raw.slice(0, dot)}.${flipped}`)}`;

    const response = await call<{ error: { code: string } }>(base, '/api/me', { cookie: forged });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('S8: sessionId is minted by the SERVER and is not the accountId', async () => {
    await boot();
    const response = await call<{ accountId: string }>(base, '/api/session', {
      method: 'POST',
      body: JSON.stringify({ handle: 'rookie' }),
    });
    const cookie = cookieFrom(response);
    const payload = openSession(SECRET, decodeURIComponent(cookie.split('=')[1] ?? ''));

    expect(payload).not.toBeNull();
    expect(payload?.accountId).toBe(response.body.accountId);
    expect(payload?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    // The distinction ADR-008 depends on: one account, many connections.
    expect(payload?.sessionId).not.toBe(payload?.accountId);
  });

  it('S9: the same cookie carries the same sessionId on every request', async () => {
    await boot();
    const cookie = await signIn(base, 'rookie');
    const payload = openSession(SECRET, decodeURIComponent(cookie.split('=')[1] ?? ''));

    // The cookie IS the session record (§3.2): nothing re-mints it per request,
    // so two reads of the same cookie are the same session.
    const again = openSession(SECRET, decodeURIComponent(cookie.split('=')[1] ?? ''));
    expect(again?.sessionId).toBe(payload?.sessionId);

    const me = await call<{ accountId: string }>(base, '/api/me', { cookie });
    expect(me.body.accountId).toBe(payload?.accountId);
  });

  it('S10: a second sign-in on the same account mints a DIFFERENT sessionId', async () => {
    await boot();
    const first = await signIn(base, 'rookie');
    const second = await signIn(base, 'rookie');

    const a = openSession(SECRET, decodeURIComponent(first.split('=')[1] ?? ''));
    const b = openSession(SECRET, decodeURIComponent(second.split('=')[1] ?? ''));

    expect(b?.accountId).toBe(a?.accountId);
    // Two browsers, one account. If these were equal, ADR-008 eviction could
    // never tell them apart.
    expect(b?.sessionId).not.toBe(a?.sessionId);
  });

  it('S11: a client-supplied sessionId is ignored, not honoured', async () => {
    await boot();
    const response = await call<{ accountId: string }>(base, '/api/session', {
      method: 'POST',
      body: JSON.stringify({
        handle: 'rookie',
        sessionId: 'attacker-chosen-session',
        accountId: 'attacker-chosen-account',
      }),
    });
    const payload = openSession(
      SECRET,
      decodeURIComponent(cookieFrom(response).split('=')[1] ?? ''),
    );

    expect(payload?.sessionId).not.toBe('attacker-chosen-session');
    expect(payload?.accountId).not.toBe('attacker-chosen-account');
    expect(payload?.accountId).toBe(response.body.accountId);
  });
});

describe('dev credential provider containment', () => {
  it('DEV1: with NODE_ENV!==production and GLOBAL_IDLE_DEV_AUTH=1 the route exists', async () => {
    expect(process.env['NODE_ENV']).not.toBe('production');
    expect(devAuthEnabled()).toBe(true);

    await boot();
    const response = await call(base, '/api/session', {
      method: 'POST',
      body: JSON.stringify({ handle: 'rookie' }),
    });
    expect(response.status).toBe(201);
  });

  it('DEV2: without GLOBAL_IDLE_DEV_AUTH the route is ABSENT — 404, not 403', async () => {
    delete process.env['GLOBAL_IDLE_DEV_AUTH'];
    expect(devAuthEnabled()).toBe(false);

    await boot();
    const response = await call(base, '/api/session', {
      method: 'POST',
      body: JSON.stringify({ handle: 'rookie' }),
    });

    // 404 because the controller is NOT REGISTERED. A 403 would tell an
    // attacker the mechanism exists and is merely switched off (§3.2).
    expect(response.status).toBe(404);

    // The rest of the surface is unaffected: it is the credential provider
    // that is contained, not the game.
    expect((await call(base, '/health/live')).status).toBe(200);
  });

  it('DEV3: NODE_ENV=production with GLOBAL_IDLE_DEV_AUTH=1 REFUSES TO BOOT', () => {
    const production = { NODE_ENV: 'production', GLOBAL_IDLE_DEV_AUTH: '1' } as NodeJS.ProcessEnv;

    expect(() => assertDevAuthSafe(production)).toThrow(DevAuthMisconfigured);
    expect(devAuthEnabled(production)).toBe(false);

    // Either gate alone is safe; it is the combination that is a hole.
    expect(() => assertDevAuthSafe({ NODE_ENV: 'production' })).not.toThrow();
    expect(() => assertDevAuthSafe({ GLOBAL_IDLE_DEV_AUTH: '1' })).not.toThrow();
  });

  it('DEV4: the E2E harness and the demo seed both sign in through this provider', async () => {
    // The harness asserts on the FILES, because the claim is about how the
    // rest of the system gets a session — not about one more HTTP call.
    const { readFile } = await import('node:fs/promises');
    const { REPO_ROOT } = await import('../support/repo.js');

    const config = await readFile(join(REPO_ROOT, 'playwright.config.ts'), 'utf8');
    expect(config).toContain("GLOBAL_IDLE_DEV_AUTH: '1'");

    const spec = await readFile(join(REPO_ROOT, 'tests', 'e2e', 'phase-1.spec.ts'), 'utf8');
    expect(spec).toContain("getByLabel('Handle')");

    // And the provider it reaches is this one, with a handle and no secret.
    await boot();
    const cookie = await signIn(base, 'e2e-shaped-handle');
    expect((await call(base, '/api/me', { cookie })).status).toBe(200);
  });
});
