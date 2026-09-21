// Phase 1 §16 — API1 to API10. The route contracts (spec §12).
//
// This group is about the CONTRACT: the status, the envelope and the shape of
// every route, plus each one's documented refusal. The behaviour behind the
// routes belongs to the CH, AC and S groups; what is asserted here is what a
// second client — a mobile app, another service — would have to rely on.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { character as characterContext } from '@global-idle/domain';
import { createClient, truncateAll } from '../support/db.js';
import {
  HUNT_KEY,
  MARKER_KEY,
  REGION_KEY,
  call,
  createCharacter,
  enterHunt,
  publishRookgaard,
  signIn,
  startApp,
  type App,
  type CharacterBody,
} from '../support/phase1.js';

const prisma = createClient();

let directory: string;
let app: App | undefined;
let base: string;
let cookie: string;
let version: string;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-api-'));
  version = await publishRookgaard(prisma, directory);
  process.env['GLOBAL_IDLE_DEV_AUTH'] = '1';
  const started = await startApp({ CONTENT_BUNDLE_DIR: directory });
  app = started.app;
  base = started.base;
  cookie = await signIn(base, 'rookie');
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  delete process.env['GLOBAL_IDLE_DEV_AUTH'];
});

/** Every refusal shares ONE envelope, and the UI switches on `code` (§12). */
function expectEnvelope(body: unknown, code: string): void {
  const envelope = body as { error?: { code?: string; message?: string } };
  expect(envelope.error, JSON.stringify(body)).toBeDefined();
  expect(envelope.error?.code).toBe(code);
  expect(typeof envelope.error?.message).toBe('string');
  expect(envelope.error?.message?.length).toBeGreaterThan(0);
}

describe('API contracts', () => {
  it('API1: POST /api/session answers { accountId }; a bad handle is 422 NAME_INVALID', async () => {
    const ok = await call<{ accountId: string }>(base, '/api/session', {
      method: 'POST',
      body: JSON.stringify({ handle: 'player-one' }),
    });
    expect(ok.status).toBe(201);
    expect(Object.keys(ok.body)).toEqual(['accountId']);

    for (const handle of ['', 'a', 'x'.repeat(33), 'has/slash', { not: 'a string' }]) {
      const bad = await call(base, '/api/session', {
        method: 'POST',
        body: JSON.stringify({ handle }),
      });
      expect(bad.status, JSON.stringify(handle)).toBe(422);
      expectEnvelope(bad.body, 'NAME_INVALID');
    }
  });

  it('API2: DELETE /api/session is 204 with no body', async () => {
    const response = await call(base, '/api/session', { method: 'DELETE', cookie });
    expect(response.status).toBe(204);
    expect(response.body).toBeUndefined();
  });

  it('API3: GET /api/me answers { accountId, rosterCapacity, premium }; 401 without a session', async () => {
    const me = await call<{ accountId: string; rosterCapacity: number; premium: boolean }>(
      base,
      '/api/me',
      { cookie },
    );
    expect(me.status).toBe(200);
    expect(Object.keys(me.body).sort()).toEqual(['accountId', 'premium', 'rosterCapacity']);
    expect(typeof me.body.accountId).toBe('string');
    expect(typeof me.body.rosterCapacity).toBe('number');
    expect(me.body.premium).toBe(false);

    const anonymous = await call(base, '/api/me');
    expect(anonymous.status).toBe(401);
    expectEnvelope(anonymous.body, 'UNAUTHENTICATED');
  });

  it('API4: GET /api/characters answers { characters: CharacterSummary[] }, session-scoped', async () => {
    const empty = await call<{ characters: CharacterBody[] }>(base, '/api/characters', { cookie });
    expect(empty.status).toBe(200);
    expect(empty.body.characters).toEqual([]);

    await createCharacter(base, cookie, 'Rookie');

    const listed = await call<{ characters: CharacterBody[] }>(base, '/api/characters', {
      cookie,
    });
    expect(listed.body.characters).toHaveLength(1);
    expect(Object.keys(listed.body.characters[0]!).sort()).toEqual([
      'baseLevel',
      'id',
      'name',
      'stamina',
      'vocation',
    ]);

    // Another account sees its own roster, not this one's.
    const stranger = await signIn(base, 'stranger');
    const theirs = await call<{ characters: CharacterBody[] }>(base, '/api/characters', {
      cookie: stranger,
    });
    expect(theirs.body.characters).toEqual([]);

    expect((await call(base, '/api/characters')).status).toBe(401);
  });

  it('API5: POST /api/characters answers a CharacterSummary; its refusals are documented', async () => {
    const created = await call<CharacterBody>(base, '/api/characters', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: 'Rookie' }),
    });
    expect(created.status).toBe(201);
    expect(created.body.baseLevel).toBe(1);
    expect(created.body.vocation).toBeNull();
    expect(created.body.stamina.maxMs).toBe(characterContext.STAMINA_MAX);
    expect(created.body.stamina.mode).toBe('RECOVERING');

    const invalid = await call(base, '/api/characters', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: '!' }),
    });
    expect(invalid.status).toBe(422);
    expectEnvelope(invalid.body, 'NAME_INVALID');

    const full = await call(base, '/api/characters', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: 'Another' }),
    });
    expect(full.status).toBe(409);
    expectEnvelope(full.body, 'ROSTER_FULL');
  });

  it('API6: GET /api/characters/:id answers a CharacterDetail; a foreign one is 404, NOT 403', async () => {
    const mine = await createCharacter(base, cookie, 'Rookie');

    const detail = await call<CharacterBody>(base, `/api/characters/${mine.id}`, { cookie });
    expect(detail.status).toBe(200);
    expect(Object.keys(detail.body).sort()).toEqual([
      'activity',
      'baseLevel',
      'id',
      'name',
      'premium',
      'stamina',
      'vocation',
    ]);
    expect(detail.body.activity).toBeNull();

    const stranger = await signIn(base, 'stranger');
    const foreign = await call(base, `/api/characters/${mine.id}`, { cookie: stranger });
    // EXISTENCE IS INFORMATION (§19). A 403 confirms the id is real.
    expect(foreign.status).toBe(404);
    expectEnvelope(foreign.body, 'NOT_FOUND');

    const nonsense = await call(base, '/api/characters/not-an-id', { cookie });
    expect(nonsense.status).toBe(404);
    expectEnvelope(nonsense.body, 'NOT_FOUND');
  });

  it('API7: GET /api/atlas answers { contentVersion, regions[], markers[] } from the pinned bundle', async () => {
    const atlas = await call<{
      contentVersion: string;
      regions: Array<{ key: string; availability: string; atlas: Record<string, number> }>;
      markers: Array<{ key: string; target: string; position: Record<string, number> }>;
    }>(base, '/api/atlas', { cookie });

    expect(atlas.status).toBe(200);
    expect(atlas.body.contentVersion).toBe(version);
    expect(atlas.body.regions.map((region) => region.key)).toContain(REGION_KEY);
    expect(atlas.body.markers.map((marker) => marker.key)).toContain(MARKER_KEY);

    const rookgaard = atlas.body.regions.find((region) => region.key === REGION_KEY);
    expect(rookgaard?.availability).toBe('AVAILABLE');
    expect(Object.keys(rookgaard?.atlas ?? {}).sort()).toEqual(['height', 'width', 'x', 'y']);

    expect((await call(base, '/api/atlas')).status).toBe(401);
  });

  it('API8: GET /api/hunts/:key answers a HuntDetail; unknown is 404 and a non-hunt is 422', async () => {
    const hunt = await call<{
      key: string;
      label: string;
      summary: string;
      primaryCreature: string;
      region: string;
      availability: string;
    }>(base, `/api/hunts/${HUNT_KEY}`, { cookie });

    expect(hunt.status).toBe(200);
    expect(hunt.body.key).toBe(HUNT_KEY);
    expect(hunt.body.label).toBe('Rookgaard Sewers');
    expect(hunt.body.primaryCreature).toBe('Rat');
    expect(hunt.body.region).toBe(REGION_KEY);
    expect(hunt.body.availability).toBe('AVAILABLE');

    const missing = await call(base, '/api/hunts/hunt.nowhere', { cookie });
    expect(missing.status).toBe(404);
    expectEnvelope(missing.body, 'HUNT_NOT_FOUND');

    // A key that RESOLVES but is the wrong kind is a different failure, and
    // gets a different code, because the caller can act differently on it.
    const wrongKind = await call(base, `/api/hunts/${REGION_KEY}`, { cookie });
    expect(wrongKind.status).toBe(422);
    expectEnvelope(wrongKind.body, 'CONTENT_KIND_MISMATCH');
  });

  it('API9: POST /api/characters/:id/hunt answers an ActivityView and documents every refusal', async () => {
    const hero = await createCharacter(base, cookie, 'Rookie');

    const entered = await enterHunt<{
      activityId: string;
      activityTypeKey: string;
      contentVersion: string;
      contentKey: string;
      hunt: { key: string };
      state: string;
      startedAt: string;
    }>(base, cookie, hero.id, HUNT_KEY);

    expect(entered.status).toBe(201);
    expect(Object.keys(entered.body).sort()).toEqual([
      'activityId',
      'activityTypeKey',
      'contentKey',
      'contentVersion',
      'hunt',
      'startedAt',
      'state',
    ]);
    expect(entered.body.contentVersion).toBe(version);
    expect(entered.body.contentKey).toBe(HUNT_KEY);
    expect(entered.body.state).toBe('ONLINE_ACTIVE');
    expect(Date.parse(entered.body.startedAt)).not.toBeNaN();

    // Every documented refusal of this route.
    const occupied = await enterHunt(base, cookie, hero.id, HUNT_KEY);
    expect(occupied.status).toBe(409);
    expectEnvelope(occupied.body, 'OCCUPANCY_CONFLICT');

    const noKey = await call(base, `/api/characters/${hero.id}/hunt`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ huntKey: HUNT_KEY }),
    });
    expect(noKey.status).toBe(422);
    expectEnvelope(noKey.body, 'IDEMPOTENCY_KEY_REQUIRED');

    const stranger = await signIn(base, 'stranger');
    const foreign = await enterHunt(base, stranger, hero.id, HUNT_KEY);
    expect(foreign.status).toBe(404);
    expectEnvelope(foreign.body, 'NOT_FOUND');
  });

  it('API10: the activity route answers ActivityView | null, and DELETE is 204', async () => {
    const hero = await createCharacter(base, cookie, 'Rookie');

    const idle = await call<null>(base, `/api/characters/${hero.id}/activity`, { cookie });
    expect(idle.status).toBe(200);
    expect(idle.body).toBeNull();

    await enterHunt(base, cookie, hero.id, HUNT_KEY);

    const busy = await call<{ activityId: string }>(base, `/api/characters/${hero.id}/activity`, {
      cookie,
    });
    expect(busy.status).toBe(200);
    expect(typeof busy.body.activityId).toBe('string');

    const left = await call(base, `/api/characters/${hero.id}/activity`, {
      method: 'DELETE',
      cookie,
    });
    expect(left.status).toBe(204);
    expect(left.body).toBeUndefined();

    // Leaving twice is not an error: the second call has nothing to do.
    expect(
      (await call(base, `/api/characters/${hero.id}/activity`, { method: 'DELETE', cookie }))
        .status,
    ).toBe(204);

    const stranger = await signIn(base, 'stranger');
    const foreign = await call(base, `/api/characters/${hero.id}/activity`, { cookie: stranger });
    expect(foreign.status).toBe(404);
    expectEnvelope(foreign.body, 'NOT_FOUND');
  });
});
