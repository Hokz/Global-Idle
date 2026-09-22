/**
 * Phase 3.5 §20 — SNP1 to SNP7. The snapshot contract.
 *
 * What this group is about is the SPLIT: which verb is allowed to move the
 * world. A GET that settles is a GET the browser, a proxy, a retry or React's
 * own double-render may repeat, and every repetition was a settlement the
 * player never asked for. So the read is pure and the advance is a POST, and
 * these cases are the difference being true rather than intended.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, truncateAll } from '../support/db.js';
import {
  HUNT_KEY,
  call,
  createCharacter,
  enterHunt,
  publishRookgaard,
  signIn,
  startApp,
  type App,
} from '../support/phase1.js';

const prisma = createClient();

interface Tile {
  x: number;
  y: number;
  z: number;
}
interface Snapshot {
  activityId: string;
  tick: number;
  revision: number;
  room: number;
  creatures: { key: string; health: number; id?: string; tile?: Tile }[];
  space: {
    contentVersion: string;
    mapKey: string;
    tile: Tile;
    movement: { from: Tile; to: Tile; startsAtMs: number; arrivesAtMs: number } | null;
    nowMs: number;
  } | null;
}

let directory: string;
let app: App | undefined;
let base: string;
let cookie: string;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-snp-'));
  await publishRookgaard(prisma, directory);
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

/** Enter a Hunt and settle it once, so there is a spatial run to read. */
async function hunting(): Promise<string> {
  const hero = await createCharacter(base, cookie, 'Rookie');
  await enterHunt(base, cookie, hero.id, HUNT_KEY);
  await new Promise((resume) => setTimeout(resume, 1200));
  await call(base, `/api/characters/${hero.id}/hunt/advance`, { method: 'POST', cookie });
  return hero.id;
}

const runRow = (characterId: string) => prisma.huntRun.findFirstOrThrow({ where: { characterId } });

describe('§20 SNP — the snapshot contract', () => {
  it('SNP1: the read is PURE — two of them move nothing', async () => {
    const id = await hunting();
    const before = await runRow(id);

    const first = await call<Snapshot>(base, `/api/characters/${id}/hunt`, { cookie });
    await new Promise((resume) => setTimeout(resume, 1200));
    const second = await call<Snapshot>(base, `/api/characters/${id}/hunt`, { cookie });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // A second and a bit of real time passed BETWEEN the two reads. Under the
    // old contract that was a settlement; under this one it is nothing.
    expect(second.body.tick).toBe(first.body.tick);
    expect(second.body.revision).toBe(first.body.revision);

    const after = await runRow(id);
    expect(after.checkpointSequence).toBe(before.checkpointSequence);
    expect(after.tick).toBe(before.tick);
    expect(after.simulatedThrough.toISOString()).toBe(before.simulatedThrough.toISOString());
    expect(after.sessionXp).toBe(before.sessionXp);
  });

  it('SNP2: the advance is a POST, and it is the one thing that settles', async () => {
    const id = await hunting();
    const before = await call<Snapshot>(base, `/api/characters/${id}/hunt`, { cookie });

    await new Promise((resume) => setTimeout(resume, 1200));
    const advanced = await call<Snapshot>(base, `/api/characters/${id}/hunt/advance`, {
      method: 'POST',
      cookie,
    });
    expect(advanced.status).toBe(200);
    expect(advanced.body.tick).toBeGreaterThan(before.body.tick);
    expect(advanced.body.revision).toBeGreaterThan(before.body.revision);

    // And the pure read now agrees with it, because it reads the same row.
    const after = await call<Snapshot>(base, `/api/characters/${id}/hunt`, { cookie });
    expect(after.body.tick).toBe(advanced.body.tick);
    expect(after.body.revision).toBe(advanced.body.revision);
  });

  it('SNP3: neither answer is storable', async () => {
    const id = await hunting();
    const read = await call(base, `/api/characters/${id}/hunt`, { cookie });
    const advance = await call(base, `/api/characters/${id}/hunt/advance`, {
      method: 'POST',
      cookie,
    });
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(advance.headers.get('cache-control')).toBe('no-store');
  });

  it('SNP4: the snapshot names the map and puts every living actor on a tile', async () => {
    const id = await hunting();
    const snapshot = await call<Snapshot>(base, `/api/characters/${id}/hunt`, { cookie });

    expect(snapshot.body.space).not.toBeNull();
    expect(snapshot.body.space?.mapKey).toBe('map.rookgaard.sewers');
    // The bundle the SIMULATION is running against — what the browser must
    // fetch its map by.
    expect(snapshot.body.space?.contentVersion).toMatch(/^v[0-9a-f]+$/);
    // The simulation instant this snapshot describes, in the same
    // milliseconds a step's start and arrival are in.
    expect(snapshot.body.space?.nowMs).toBe(snapshot.body.tick * 1000);
    const tile = snapshot.body.space!.tile;
    expect(Number.isInteger(tile.x)).toBe(true);
    expect(Number.isInteger(tile.y)).toBe(true);
    expect(tile.z).toBe(7);

    expect(snapshot.body.creatures.length).toBeGreaterThan(0);
    for (const creature of snapshot.body.creatures) {
      // A RUN-LOCAL identity, not a row: it says which actor this is for as
      // long as it exists, which is what a renderer needs to keep a creature
      // from teleporting when the array reorders.
      expect(creature.id).toMatch(/^creature\..+:sewers-\d+:c\d+:s\d+$/);
      expect(creature.tile?.z).toBe(7);
    }
    // No two living actors share a tile.
    const living = snapshot.body.creatures.filter((creature) => creature.health > 0);
    const spots = [tile, ...living.map((creature) => creature.tile!)].map(
      (at) => `${at.x},${at.y},${at.z}`,
    );
    expect(new Set(spots).size).toBe(spots.length);
  });

  it('SNP5: the revision only ever goes up', async () => {
    const id = await hunting();
    const seen: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resume) => setTimeout(resume, 1100));
      const advanced = await call<Snapshot>(base, `/api/characters/${id}/hunt/advance`, {
        method: 'POST',
        cookie,
      });
      seen.push(advanced.body.revision);
      const read = await call<Snapshot>(base, `/api/characters/${id}/hunt`, { cookie });
      seen.push(read.body.revision);
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[seen.length - 1]).toBeGreaterThan(seen[0]!);
  });

  it('SNP6: the map is CONTENT — fetched by VERSION and key, cacheable, 404 otherwise', async () => {
    const id = await hunting();
    const snapshot = await call<Snapshot>(base, `/api/characters/${id}/hunt`, { cookie });
    const version = snapshot.body.space!.contentVersion;

    const found = await call<{ contentVersion: string; map: { key: string; rows: string[] } }>(
      base,
      `/api/content/${version}/maps/map.rookgaard.sewers`,
      { cookie },
    );
    expect(found.status).toBe(200);
    expect(found.body.contentVersion).toBe(version);
    expect(found.body.map.key).toBe('map.rookgaard.sewers');
    expect(found.body.map.rows.length).toBeGreaterThan(0);
    // The URL names the version, so the resource genuinely cannot change and
    // the cache header is genuinely true.
    expect(found.headers.get('cache-control')).toContain('immutable');

    const missing = await call(base, `/api/content/${version}/maps/map.nowhere`, { cookie });
    expect(missing.status).toBe(404);
    // A key that IS in the bundle but is not a map is equally absent.
    const wrongKind = await call(base, `/api/content/${version}/maps/${HUNT_KEY}`, { cookie });
    expect(wrongKind.status).toBe(404);
    // And a bundle this deployment never published is absent, not a fault.
    const noVersion = await call(base, '/api/content/v0/maps/map.rookgaard.sewers', { cookie });
    expect(noVersion.status).toBe(404);
  });

  it('SNP7: no Activity is null, and someone else’s Character is absent', async () => {
    // The roster holds one Character (I1b), so this is the same one before and
    // after it enters — which is the more interesting reading anyway.
    const hero = await createCharacter(base, cookie, 'Rookie');
    const quiet = await call<null>(base, `/api/characters/${hero.id}/hunt`, { cookie });
    expect(quiet.status).toBe(200);
    // LITERAL null on the wire. An empty 200 is not an answer a client can
    // tell from a truncated one.
    expect(quiet.body).toBeNull();

    await enterHunt(base, cookie, hero.id, HUNT_KEY);
    await new Promise((resume) => setTimeout(resume, 1200));
    await call(base, `/api/characters/${hero.id}/hunt/advance`, { method: 'POST', cookie });
    const id = hero.id;

    const stranger = await signIn(base, 'stranger');
    const peek = await call(base, `/api/characters/${id}/hunt`, { cookie: stranger });
    expect(peek.status).toBe(404);
    const push = await call(base, `/api/characters/${id}/hunt/advance`, {
      method: 'POST',
      cookie: stranger,
    });
    expect(push.status).toBe(404);
  });
});
