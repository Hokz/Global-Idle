/**
 * Phase 3.5 §20 — MPV1 to MPV5. ONE spatial truth, across a publish.
 *
 * An Activity pins the content bundle it started under and keeps simulating
 * against it. If the map the browser draws came from "whatever is current"
 * instead, a publish that moved a wall would put the server's collision and
 * the player's picture on two different maps — a Character walking through a
 * wall that exists only on screen. These cases are that not happening.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBundle, writeBundle, type BundleSource } from '@global-idle/game-data';
import { content } from '@global-idle/domain';
import { createClient, truncateAll } from '../support/db.js';
import {
  HUNT_KEY,
  call,
  createCharacter,
  enterHunt,
  publishRookgaard,
  rookgaardSource,
  signIn,
  startApp,
  type App,
} from '../support/phase1.js';

const prisma = createClient();

interface Snapshot {
  tick: number;
  space: { contentVersion: string; mapKey: string } | null;
}
interface MapBody {
  contentVersion: string;
  map: { key: string; rows: string[] };
}

let directory: string;
let app: App | undefined;
let base: string;
let cookie: string;
let versionOne: string;

const MAP_KEY = 'map.rookgaard.sewers';

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-mpv-'));
  versionOne = await publishRookgaard(prisma, directory);
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

/**
 * Publish a SECOND bundle whose Sewers map has visibly different geometry
 * under the same stable key — one doorway moved, which is exactly the kind of
 * edit a content author makes and exactly the kind that changes collision.
 */
async function publishMovedWall(): Promise<{ version: string; rows: string[] }> {
  const source = (await rookgaardSource()) as BundleSource & {
    definitions: Record<string, unknown>[];
  };
  const map = source.definitions.find((definition) => definition['kind'] === 'map') as unknown as {
    rows: string[];
  };
  // Row 7 carries the doorway through the wall at column 6. Open row 6 as well
  // and the chamber has two ways out — different collision, same key.
  const widened = [...map.rows];
  widened[6] = `${widened[6]!.slice(0, 6)}.${widened[6]!.slice(7)}`;
  map.rows = widened;

  const artifact = buildBundle(source);
  await writeBundle(directory, artifact);
  await content.publish(prisma, artifact, directory, new Date());
  return { version: artifact.version, rows: widened };
}

describe('§20 MPV — the map the browser draws is the map the server simulates', () => {
  it('MPV1: a running Activity keeps naming ITS bundle after a publish', async () => {
    const hero = await createCharacter(base, cookie, 'Rookie');
    await enterHunt(base, cookie, hero.id, HUNT_KEY);
    await new Promise((resume) => setTimeout(resume, 1100));
    await call(base, `/api/characters/${hero.id}/hunt/advance`, { method: 'POST', cookie });

    const { version: versionTwo } = await publishMovedWall();
    expect(versionTwo).not.toBe(versionOne);

    // The simulation is unmoved: it settles against the bundle it pinned.
    await new Promise((resume) => setTimeout(resume, 1100));
    const advanced = await call<Snapshot>(base, `/api/characters/${hero.id}/hunt/advance`, {
      method: 'POST',
      cookie,
    });
    expect(advanced.body.space?.contentVersion).toBe(versionOne);

    const read = await call<Snapshot>(base, `/api/characters/${hero.id}/hunt`, { cookie });
    expect(read.body.space?.contentVersion).toBe(versionOne);
  });

  it('MPV2: the version in the snapshot fetches the geometry the server is using', async () => {
    const hero = await createCharacter(base, cookie, 'Rookie');
    await enterHunt(base, cookie, hero.id, HUNT_KEY);
    await new Promise((resume) => setTimeout(resume, 1100));
    await call(base, `/api/characters/${hero.id}/hunt/advance`, { method: 'POST', cookie });

    const { version: versionTwo, rows: changed } = await publishMovedWall();

    const snapshot = await call<Snapshot>(base, `/api/characters/${hero.id}/hunt`, { cookie });
    const pinned = snapshot.body.space!.contentVersion;
    const drawn = await call<MapBody>(base, `/api/content/${pinned}/maps/${MAP_KEY}`, { cookie });

    expect(drawn.body.contentVersion).toBe(versionOne);
    // The OLD geometry, after the new one was published.
    expect(drawn.body.map.rows[6]).not.toBe(changed[6]);
    expect(drawn.body.map.rows[6]![6]).toBe('#');

    // And the new bundle is still there, at its own URL, with its own walls.
    const fresh = await call<MapBody>(base, `/api/content/${versionTwo}/maps/${MAP_KEY}`, {
      cookie,
    });
    expect(fresh.body.map.rows[6]![6]).toBe('.');
  });

  it('MPV3: a NEW Activity after the publish gets the new bundle', async () => {
    const { version: versionTwo } = await publishMovedWall();

    const hero = await createCharacter(base, cookie, 'Rookie');
    await enterHunt(base, cookie, hero.id, HUNT_KEY);
    await new Promise((resume) => setTimeout(resume, 1100));
    const advanced = await call<Snapshot>(base, `/api/characters/${hero.id}/hunt/advance`, {
      method: 'POST',
      cookie,
    });
    expect(advanced.body.space?.contentVersion).toBe(versionTwo);

    const drawn = await call<MapBody>(base, `/api/content/${versionTwo}/maps/${MAP_KEY}`, {
      cookie,
    });
    expect(drawn.body.map.rows[6]![6]).toBe('.');
  });

  it('MPV4: the two versions are two URLs, and neither can be served for the other', async () => {
    const { version: versionTwo } = await publishMovedWall();
    const one = `/api/content/${versionOne}/maps/${MAP_KEY}`;
    const two = `/api/content/${versionTwo}/maps/${MAP_KEY}`;
    expect(one).not.toBe(two);

    const first = await call<MapBody>(base, one, { cookie });
    const second = await call<MapBody>(base, two, { cookie });
    expect(first.body.map.rows[6]).not.toBe(second.body.map.rows[6]);
    // Which is what makes `immutable` honest: the URL identifies the bytes.
    expect(first.headers.get('cache-control')).toContain('immutable');
    expect(second.headers.get('cache-control')).toContain('immutable');
  });

  it('MPV5: the map is never in the snapshot — only its identity is', async () => {
    const hero = await createCharacter(base, cookie, 'Rookie');
    await enterHunt(base, cookie, hero.id, HUNT_KEY);
    await new Promise((resume) => setTimeout(resume, 1100));
    const advanced = await call<Record<string, unknown>>(
      base,
      `/api/characters/${hero.id}/hunt/advance`,
      { method: 'POST', cookie },
    );
    const body = JSON.stringify(advanced.body);
    expect(body).toContain('contentVersion');
    // 671 tiles that never change have no business in a two-second poll.
    expect(body).not.toContain('rows');
    expect(body).not.toContain('legend');
  });

  it('MPV6: a route parameter never becomes a filesystem path', async () => {
    // `toContentVersion` is a branded cast, and the filesystem resolver builds
    // `join(directory, `${version}.json`)`. So the grammar is checked BEFORE
    // anything is looked up: a published version is `v` and sixteen hex
    // characters, and a content key is lowercase dot-separated segments.
    // Everything else names a resource that cannot exist.
    const refused = [
      '/api/content/not-a-version/maps/map.rookgaard.sewers',
      `/api/content/v${'f'.repeat(15)}/maps/map.rookgaard.sewers`,
      `/api/content/v${'f'.repeat(17)}/maps/map.rookgaard.sewers`,
      '/api/content/vZZZZZZZZZZZZZZZZ/maps/map.rookgaard.sewers',
      `/api/content/${'v0123456789abcdef'.repeat(40)}/maps/map.rookgaard.sewers`,
      '/api/content/..%2f..%2fetc%2fpasswd/maps/map.rookgaard.sewers',
      '/api/content/v0123456789abcdef/maps/..%2f..%2fsecrets',
      '/api/content/v0123456789abcdef/maps/NOT A KEY',
      '/api/content/v0123456789abcdef/maps/Map.Rookgaard.Sewers',
    ];
    for (const path of refused) {
      const response = await call<{ error?: { code?: string } }>(base, path, { cookie });
      expect([404, 400], `${path} -> ${response.status}`).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toContain('ENOENT');
    }

    // A WELL-FORMED version that was simply never published is equally absent,
    // and a well-formed key that is not a map stays a 404.
    const unpublished = await call(
      base,
      '/api/content/v0123456789abcdef/maps/map.rookgaard.sewers',
      { cookie },
    );
    expect(unpublished.status).toBe(404);
    const notAMap = await call(base, `/api/content/${versionOne}/maps/${HUNT_KEY}`, { cookie });
    expect(notAMap.status).toBe(404);
  });
});
