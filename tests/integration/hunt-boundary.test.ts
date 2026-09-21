// Phase 1 §16 — AC1 to AC13. The Activity boundary (spec §9).
//
// The claim this group has to make good on is that ENTER creates a REAL
// session-bound Activity in the pre-consumption state, and that everything the
// browser shows afterwards is rebuilt from durable state — not from the URL,
// not from client memory, not from a cached response.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content } from '@global-idle/domain';
import { buildBundle, writeBundle } from '@global-idle/game-data';
import { createClient, truncateAll } from '../support/db.js';
import {
  HUNT_KEY,
  MARKER_KEY,
  REGION_KEY,
  call,
  createCharacter,
  enterHunt,
  idempotencyKey,
  publishRookgaard,
  rookgaardSource,
  signIn,
  startApp,
  type App,
  type CharacterBody,
} from '../support/phase1.js';

const prisma = createClient();

interface ActivityBody {
  activityId: string;
  activityTypeKey: string;
  contentVersion: string;
  contentKey: string;
  hunt: { key: string; label: string; primaryCreature: string };
  state: string;
  startedAt: string;
}

let directory: string;
let app: App | undefined;
let base: string;
let cookie: string;
let hero: CharacterBody;
let version: string;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-hunt-'));
  version = await publishRookgaard(prisma, directory);
  process.env['GLOBAL_IDLE_DEV_AUTH'] = '1';
  const started = await startApp({ CONTENT_BUNDLE_DIR: directory });
  app = started.app;
  base = started.base;
  cookie = await signIn(base, 'rookie');
  hero = await createCharacter(base, cookie, 'Rookie');
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  delete process.env['GLOBAL_IDLE_DEV_AUTH'];
});

const stamina = async (): Promise<string> => {
  const response = await call<CharacterBody>(base, `/api/characters/${hero.id}`, { cookie });
  return response.body.stamina.mode;
};

describe('the pre-combat Hunt boundary', () => {
  it('AC1: ENTER creates a real session-bound Activity, not a client-side screen', async () => {
    const response = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY);
    expect(response.status).toBe(201);

    const row = await prisma.activity.findUniqueOrThrow({
      where: { id: response.body.activityId },
      include: { sessionBound: true, participants: true },
    });
    expect(row.activityTypeKey).toBe('hunt');
    expect(row.family).toBe('SESSION_BOUND');
    expect(row.sessionBound).not.toBeNull();
    expect(row.sessionBound?.state).toBe('ONLINE_ACTIVE');
    expect(row.participants.map((p) => p.characterId)).toEqual([hero.id]);
  });

  it('AC2: the occupancy claim is acquired, held by the AUTHENTICATED session', async () => {
    const response = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY);

    const claim = await prisma.occupancyClaim.findUniqueOrThrow({
      where: { characterId: hero.id },
    });
    expect(claim.activityId).toBe(response.body.activityId);

    const bound = await prisma.sessionBoundActivity.findUniqueOrThrow({
      where: { activityId: response.body.activityId },
    });
    // The SESSION, not the account: two browsers on one account must be
    // distinguishable or ADR-008 eviction has nothing to evict.
    const account = await prisma.character.findUniqueOrThrow({ where: { id: hero.id } });
    expect(bound.claimHolderSessionId).not.toBe(account.accountId);
    expect(bound.claimHolderSessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('AC3: staminaActivatedAt stays NULL — this is the PRE-consumption state', async () => {
    await enterHunt(base, cookie, hero.id, HUNT_KEY);

    const participant = await prisma.activityParticipant.findFirstOrThrow({
      where: { characterId: hero.id },
    });
    // Phase 2 decides what raises activation. Phase 1 stops here, and the null
    // is the boundary itself rather than an oversight.
    expect(participant.staminaActivatedAt).toBeNull();
  });

  it('AC4: Stamina reads NEUTRAL inside the Hunt and RECOVERING once it ends', async () => {
    expect(await stamina()).toBe('RECOVERING');

    await enterHunt(base, cookie, hero.id, HUNT_KEY);
    expect(await stamina()).toBe('NEUTRAL');

    await call(base, `/api/characters/${hero.id}/activity`, { method: 'DELETE', cookie });
    expect(await stamina()).toBe('RECOVERING');
  });

  it('AC5: reload returns the SAME Activity', async () => {
    const entered = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY);

    const reload = await call<ActivityBody>(base, `/api/characters/${hero.id}/activity`, {
      cookie,
    });
    expect(reload.status).toBe(200);
    expect(reload.body.activityId).toBe(entered.body.activityId);
    expect(reload.body.startedAt).toBe(entered.body.startedAt);
  });

  it('AC6: LEAVE ends the Activity and releases the claim', async () => {
    const entered = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY);

    const left = await call(base, `/api/characters/${hero.id}/activity`, {
      method: 'DELETE',
      cookie,
    });
    expect(left.status).toBe(204);

    expect(await prisma.occupancyClaim.findUnique({ where: { characterId: hero.id } })).toBeNull();
    const bound = await prisma.sessionBoundActivity.findUnique({
      where: { activityId: entered.body.activityId },
    });
    // ADR-007: ended, never deleted. The history stays.
    expect(bound?.state).toBe('ACTIVITY_ENDED');
    expect(await prisma.activity.count()).toBe(1);

    // §12 declares this route `ActivityView | null`, and it answers with the
    // literal JSON `null` rather than an empty body a consumer has to guess at.
    const after = await call<ActivityBody | null>(base, `/api/characters/${hero.id}/activity`, {
      cookie,
    });
    expect(after.status).toBe(200);
    expect(after.body).toBeNull();
  });

  it('AC7: a second ENTER while occupied is refused with OCCUPANCY_CONFLICT', async () => {
    await enterHunt(base, cookie, hero.id, HUNT_KEY);

    // A DIFFERENT idempotency key, so this is a genuine second command and not
    // a replay of the first.
    const second = await enterHunt<{ error: { code: string } }>(
      base,
      cookie,
      hero.id,
      HUNT_KEY,
      idempotencyKey(),
    );

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('OCCUPANCY_CONFLICT');
    expect(await prisma.activity.count()).toBe(1);
  });

  it('AC8: a double-submitted ENTER replays instead of racing the claim', async () => {
    // A second REAL hunt is published first, so the "different request, same
    // key" half of this case can be a VALID command that differs only in what
    // it asks for. A non-hunt key would be refused for its kind and would
    // prove nothing about fingerprints.
    const source = await rookgaardSource();
    const sewers = source.definitions.find((definition) => definition.key === HUNT_KEY);
    const artifact = buildBundle({
      ...source,
      definitions: [
        ...source.definitions,
        { ...sewers, key: 'hunt.rookgaard.cellar', label: 'Rookgaard Cellar' },
      ],
    });
    await writeBundle(directory, artifact);
    await content.publish(prisma, artifact, directory, new Date());

    const key = idempotencyKey();
    const first = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY, key);
    const replay = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY, key);

    expect(first.status).toBe(201);
    // The SAME key and the SAME request: the player clicked once and the
    // network duplicated it. A conflict here would be the server arguing with
    // itself, and an OCCUPANCY_CONFLICT would be it losing that argument.
    expect(replay.status).toBe(201);
    expect(replay.body.activityId).toBe(first.body.activityId);
    expect(await prisma.activity.count()).toBe(1);

    // Transport noise does NOT change the fingerprint: it is taken over the
    // SEMANTIC fields, so a client that serialises its retry differently is
    // still making the same request.
    const noisy = await call<ActivityBody>(base, `/api/characters/${hero.id}/hunt`, {
      method: 'POST',
      cookie,
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ extra: 'not part of the command', huntKey: HUNT_KEY }),
    });
    expect(noisy.status).toBe(201);
    expect(noisy.body.activityId).toBe(first.body.activityId);

    // And the same key aimed at a DIFFERENT hunt is a real conflict, refused
    // without overwriting the stored outcome. Without this half, "idempotent"
    // would be indistinguishable from "always replays whatever you send".
    const conflicting = await enterHunt<{ error: { code: string } }>(
      base,
      cookie,
      hero.id,
      'hunt.rookgaard.cellar',
      key,
    );
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await prisma.activity.count()).toBe(1);
    const row = await prisma.activity.findUniqueOrThrow({
      where: { id: first.body.activityId },
      select: { contentKey: true },
    });
    expect(row.contentKey).toBe(HUNT_KEY);
  });

  it('AC9: contentKey is PERSISTED on the Activity row', async () => {
    const entered = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY);

    const row = await prisma.activity.findUniqueOrThrow({
      where: { id: entered.body.activityId },
    });
    expect(row.contentKey).toBe(HUNT_KEY);
    expect(row.contentVersion).toBe(version);
    expect(entered.body.contentKey).toBe(HUNT_KEY);
  });

  it('AC10: reload reconstructs the Hunt from (contentVersion, contentKey) alone', async () => {
    const entered = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY);

    // Resolve the SAME pair the row holds, with nothing else in hand — no URL,
    // no client state, no cached response.
    const row = await prisma.activity.findUniqueOrThrow({
      where: { id: entered.body.activityId },
      select: { contentVersion: true, contentKey: true },
    });
    const resolver = content.createResolver(prisma, directory);
    const hunt = await content.resolveHunt(
      resolver,
      row.contentVersion as never,
      row.contentKey as never,
    );

    const reload = await call<ActivityBody>(base, `/api/characters/${hero.id}/activity`, {
      cookie,
    });
    expect(reload.body.hunt.key).toBe(hunt.key);
    expect(reload.body.hunt.label).toBe(hunt.label);
    expect(reload.body.hunt.primaryCreature).toBe(hunt.primaryCreature);
  });

  it("AC11: the key resolves against the Activity's OWN pinned version, not the current one", async () => {
    const entered = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY);
    expect(entered.body.hunt.label).toBe('Rookgaard Sewers');

    // Publish a NEWER bundle in which the same key says something different.
    // A running Activity keeps the bundle it pinned (§10.1, ADR-011).
    const source = await rookgaardSource();
    const renamed = {
      ...source,
      definitions: source.definitions.map((definition) =>
        definition.key === HUNT_KEY
          ? { ...definition, label: 'Renamed In A Later Bundle' }
          : definition,
      ),
    };
    const artifact = buildBundle(renamed);
    await writeBundle(directory, artifact);
    await content.publish(prisma, artifact, directory, new Date());
    expect(artifact.version).not.toBe(version);
    expect(await content.currentVersion(prisma)).toBe(artifact.version);

    const reload = await call<ActivityBody>(base, `/api/characters/${hero.id}/activity`, {
      cookie,
    });
    expect(reload.body.contentVersion).toBe(version);
    expect(reload.body.hunt.label).toBe('Rookgaard Sewers');
  });

  it('AC12: a key of the wrong KIND is refused with CONTENT_KIND_MISMATCH and creates nothing', async () => {
    // `region.rookgaard` resolves perfectly. It is simply not a hunt, and
    // "resolves" is not the same as "is the right thing" (§9.5).
    const response = await enterHunt<{ error: { code: string } }>(
      base,
      cookie,
      hero.id,
      REGION_KEY,
    );

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('CONTENT_KIND_MISMATCH');
    expect(await prisma.activity.count()).toBe(0);
    expect(await prisma.occupancyClaim.count()).toBe(0);

    // An unknown key is a different failure with a different code.
    const unknown = await enterHunt<{ error: { code: string } }>(
      base,
      cookie,
      hero.id,
      'hunt.nowhere.at.all',
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('HUNT_NOT_FOUND');
    expect(await prisma.activity.count()).toBe(0);
  });

  it('AC13: no endpoint can change contentKey after creation', async () => {
    const entered = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY);
    const before = await prisma.activity.findUniqueOrThrow({
      where: { id: entered.body.activityId },
      select: { contentKey: true, contentVersion: true },
    });

    // There is no update route, so the only way to aim an existing Activity at
    // different content is to enter again while occupied — which the claim
    // refuses before content is even consulted.
    const retarget = await enterHunt<{ error: { code: string } }>(
      base,
      cookie,
      hero.id,
      REGION_KEY,
      idempotencyKey(),
    );
    expect([409, 422]).toContain(retarget.status);

    for (const method of ['PUT', 'PATCH']) {
      const response = await call(base, `/api/characters/${hero.id}/activity`, {
        method,
        cookie,
        body: JSON.stringify({ contentKey: 'hunt.somewhere.else' }),
      });
      expect(response.status, method).toBe(404);
    }

    const after = await prisma.activity.findUniqueOrThrow({
      where: { id: entered.body.activityId },
      select: { contentKey: true, contentVersion: true },
    });
    expect(after).toEqual(before);
  });
});

/**
 * The idempotency fingerprint is the CLIENT COMMAND — `{characterId, huntKey}`
 * — and nothing the server chose for itself.
 *
 * `contentVersion` used to be in it. It is selected by the server from
 * whatever bundle is current when the request lands, so a retry of the same
 * logical command that arrived after a publication fingerprinted differently
 * and was refused with IDEMPOTENCY_CONFLICT, for a change the caller never
 * made. Which bundle the Activity pinned belongs to the first execution's
 * RESULT (ADR-017).
 *
 * These cases are additional to the §16 matrix and deliberately carry no
 * matrix ids.
 */
describe('replay across a content publication', () => {
  /** Publish a bundle built from the authored source with one edit. */
  async function publish(edit: (definitions: readonly unknown[]) => unknown[]): Promise<string> {
    const source = await rookgaardSource();
    const artifact = buildBundle({
      ...source,
      definitions: edit(source.definitions) as typeof source.definitions,
    });
    await writeBundle(directory, artifact);
    await content.publish(prisma, artifact, directory, new Date());
    return artifact.version;
  }

  it('replays when a NEWER bundle is current', async () => {
    const key = idempotencyKey();
    const first = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY, key);
    expect(first.status).toBe(201);

    // A genuinely DIFFERENT bundle: the version is a content hash, so an
    // identical source would republish the same version and prove nothing.
    const next = await publish((definitions) =>
      definitions.map((definition) =>
        (definition as { key: string }).key === REGION_KEY
          ? { ...(definition as object), label: 'Rookgaard (revised)' }
          : definition,
      ),
    );
    expect(next).not.toBe(version);

    const replay = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY, key);
    expect(replay.status).toBe(201);
    expect(replay.body.activityId).toBe(first.body.activityId);
    expect(replay.body.contentVersion).toBe(version);
    expect(await prisma.activity.count()).toBe(1);
  });

  it('replays when the Hunt CHANGED in the newer bundle', async () => {
    const key = idempotencyKey();
    const first = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY, key);
    await publish((definitions) =>
      definitions.map((definition) =>
        (definition as { key: string }).key === HUNT_KEY
          ? { ...(definition as object), label: 'Renamed After Entry', primaryCreature: 'Cave Rat' }
          : definition,
      ),
    );

    const replay = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY, key);
    expect(replay.status).toBe(201);
    expect(replay.body.activityId).toBe(first.body.activityId);
    // The Activity pinned its own bundle, so it still describes the Hunt the
    // player actually entered.
    expect(replay.body.hunt.label).toBe('Rookgaard Sewers');
    expect(replay.body.hunt.primaryCreature).toBe('Rat');
  });

  it('replays when the Hunt is ABSENT from the newer bundle', async () => {
    const key = idempotencyKey();
    const first = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY, key);

    // Remove the hunt AND the marker that points at it, so the bundle still
    // validates — content that no longer offers this Hunt at all.
    await publish((definitions) =>
      definitions.filter(
        (definition) =>
          (definition as { key: string }).key !== HUNT_KEY &&
          (definition as { key: string }).key !== MARKER_KEY,
      ),
    );

    const replay = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY, key);
    expect(replay.status).toBe(201);
    expect(replay.body.activityId).toBe(first.body.activityId);
    expect(replay.body.hunt.label).toBe('Rookgaard Sewers');

    // A FRESH command for the same Hunt is a different matter: there is
    // nothing current to enter, and it is refused.
    await call(base, `/api/characters/${hero.id}/activity`, { method: 'DELETE', cookie });
    const fresh = await enterHunt<{ error: { code: string } }>(
      base,
      cookie,
      hero.id,
      HUNT_KEY,
      idempotencyKey(),
    );
    expect(fresh.status).toBe(404);
    expect(fresh.body.error.code).toBe('HUNT_NOT_FOUND');
  });

  it('replays when the Hunt is LOCKED in the newer bundle', async () => {
    const key = idempotencyKey();
    const first = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY, key);

    await publish((definitions) =>
      definitions.map((definition) =>
        (definition as { key: string }).key === HUNT_KEY
          ? { ...(definition as object), availability: 'LOCKED' }
          : definition,
      ),
    );

    const replay = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY, key);
    expect(replay.status).toBe(201);
    expect(replay.body.activityId).toBe(first.body.activityId);

    // ...and a fresh entry into a now-locked Hunt is refused.
    await call(base, `/api/characters/${hero.id}/activity`, { method: 'DELETE', cookie });
    const fresh = await enterHunt<{ error: { code: string } }>(
      base,
      cookie,
      hero.id,
      HUNT_KEY,
      idempotencyKey(),
    );
    expect(fresh.status).toBe(404);
    expect(fresh.body.error.code).toBe('HUNT_NOT_FOUND');
  });

  it('still treats the same key aimed at a DIFFERENT hunt as a conflict', async () => {
    await publish((definitions) => {
      const sewers = definitions.find((d) => (d as { key: string }).key === HUNT_KEY);
      return [
        ...definitions,
        { ...(sewers as object), key: 'hunt.rookgaard.cellar', label: 'Cellar' },
      ];
    });

    const key = idempotencyKey();
    const first = await enterHunt<ActivityBody>(base, cookie, hero.id, HUNT_KEY, key);
    expect(first.status).toBe(201);

    const conflicting = await enterHunt<{ error: { code: string } }>(
      base,
      cookie,
      hero.id,
      'hunt.rookgaard.cellar',
      key,
    );
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await prisma.activity.count()).toBe(1);
  });
});
