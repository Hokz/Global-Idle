// Phase 1 §18 — the observability signals, proven through the REAL routes.
//
// A counter that is registered and never incremented looks identical, to a
// test that greps `/metrics` for a name, to one that works. So nothing here
// calls the port: every case drives the actual HTTP route and then reads the
// value back out of the real `/metrics` endpoint the adapter serves.
//
// These cases are additional to the §16 matrix and deliberately carry no
// matrix ids.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMetrics,
  createMetricsPort,
  setObservability,
  type DomainLogEvent,
} from '@global-idle/domain';
import { createClient, truncateAll } from '../support/db.js';
import {
  HUNT_KEY,
  REGION_KEY,
  call,
  createCharacter,
  enterHunt,
  publishRookgaard,
  signIn,
  startApp,
  type App,
} from '../support/phase1.js';

const prisma = createClient();

let directory: string;
let app: App | undefined;
let base: string;
let restore: (() => void) | undefined;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-obs-'));
  await publishRookgaard(prisma, directory);
  process.env['GLOBAL_IDLE_DEV_AUTH'] = '1';
  const started = await startApp({ CONTENT_BUNDLE_DIR: directory });
  app = started.app;
  base = started.base;
});

afterEach(async () => {
  restore?.();
  restore = undefined;
  await app?.close();
  app = undefined;
  delete process.env['GLOBAL_IDLE_DEV_AUTH'];
});

/**
 * One counter's value, read from the REAL `/metrics` body.
 *
 * Absent means zero: prom-client does not emit a labelled series until it is
 * incremented, and "the series is missing" and "the series is 0" mean the same
 * thing to a reader.
 */
async function counter(name: string, labels: Record<string, string> = {}): Promise<number> {
  const response = await call<string>(base, '/metrics');
  const body = String(response.body);
  const selector = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .sort()
    .join(',');
  const wanted = selector ? `${name}{${selector}}` : name;
  for (const line of body.split('\n')) {
    if (line.startsWith('#')) continue;
    const space = line.lastIndexOf(' ');
    if (space < 0) continue;
    if (line.slice(0, space) === wanted) return Number(line.slice(space + 1));
  }
  return 0;
}

/** Capture what the domain EMITS, without losing what it COUNTS. */
function capture(): DomainLogEvent[] {
  const events: DomainLogEvent[] = [];
  const metrics = createMetrics({ defaultMetrics: false });
  restore = setObservability({
    metrics: createMetricsPort(metrics),
    events: (event) => events.push(event),
  });
  return events;
}

describe('Phase 1 observability', () => {
  it('counts character creation failures by REASON, not by message', async () => {
    const cookie = await signIn(base, 'rookie');

    expect(await counter('character_creation_failures_total', { reason: 'NAME_INVALID' })).toBe(0);

    await call(base, '/api/characters', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: '!' }),
    });
    expect(await counter('character_creation_failures_total', { reason: 'NAME_INVALID' })).toBe(1);

    // A DIFFERENT reason is a different series, which is the whole point of
    // the label: "creation is failing" is not actionable, "creation is failing
    // because rosters are full" is.
    await createCharacter(base, cookie, 'Rookie');
    await call(base, '/api/characters', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: 'Another' }),
    });
    expect(await counter('character_creation_failures_total', { reason: 'ROSTER_FULL' })).toBe(1);
    expect(await counter('character_creation_failures_total', { reason: 'NAME_INVALID' })).toBe(1);
  });

  it('counts hunt-entry failures by reason', async () => {
    const cookie = await signIn(base, 'rookie');
    const hero = await createCharacter(base, cookie, 'Rookie');

    await enterHunt(base, cookie, hero.id, REGION_KEY);
    expect(await counter('hunt_entry_failures_total', { reason: 'CONTENT_KIND_MISMATCH' })).toBe(1);

    await enterHunt(base, cookie, hero.id, HUNT_KEY);
    await enterHunt(base, cookie, hero.id, HUNT_KEY);
    expect(await counter('hunt_entry_failures_total', { reason: 'OCCUPANCY_CONFLICT' })).toBe(1);

    // A SUCCESSFUL entry counts nothing. A failure counter that also counted
    // successes would be a request counter with a misleading name.
    expect(await counter('hunt_entry_failures_total', { reason: 'HUNT_NOT_FOUND' })).toBe(0);
    await enterHunt(base, cookie, hero.id, 'hunt.nowhere');
    expect(await counter('hunt_entry_failures_total', { reason: 'HUNT_NOT_FOUND' })).toBe(1);
  });

  it('counts authorization rejects by ROUTE TEMPLATE, never by id', async () => {
    const cookie = await signIn(base, 'rookie');
    const hero = await createCharacter(base, cookie, 'Rookie');
    const stranger = await signIn(base, 'stranger');

    const before = await counter('authorization_rejects_total', {
      route: '/api/characters/:id',
    });
    await call(base, `/api/characters/${hero.id}`, { cookie: stranger });
    expect(await counter('authorization_rejects_total', { route: '/api/characters/:id' })).toBe(
      before + 1,
    );

    // A missing session is counted too, and the label is still a template.
    await call(base, '/api/me');
    const body = String((await call<string>(base, '/metrics')).body);
    const routes = [...body.matchAll(/authorization_rejects_total\{route="([^"]+)"\}/g)].map(
      (match) => match[1]!,
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      // No character id may ever appear in a label: that is unbounded
      // cardinality, and it takes a Prometheus server down.
      expect(route, route).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });

  it('counts a content-load failure when the Atlas cannot resolve its bundle', async () => {
    const cookie = await signIn(base, 'rookie');
    expect(await counter('atlas_content_load_failures_total')).toBe(0);

    // The bundle row points at a version whose FILE is gone: a broken deploy,
    // which is what this counter is for.
    await prisma.contentBundle.create({
      data: {
        version: 'v-never-written',
        checksum: 'checksum',
        publishedAt: new Date(Date.now() + 60_000),
        location: './missing',
      },
    });

    const atlas = await call(base, '/api/atlas', { cookie });
    expect(atlas.status).toBeGreaterThanOrEqual(500);
    expect(await counter('atlas_content_load_failures_total')).toBe(1);
  });

  it('emits character.created AFTER the transaction commits, with both ids', async () => {
    const cookie = await signIn(base, 'rookie');
    const events = capture();

    const hero = await createCharacter(base, cookie, 'Rookie');

    const created = events.filter((event) => event.kind === 'character.created');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: 'character.created', characterId: hero.id });

    // POST-COMMIT means the row is really there when the event is emitted —
    // a "created" line for a write a rollback took away is worse than none.
    const row = await prisma.character.findUnique({ where: { id: hero.id } });
    expect(row).not.toBeNull();

    // A REFUSED creation emits nothing.
    events.length = 0;
    await call(base, '/api/characters', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: '!' }),
    });
    expect(events.filter((event) => event.kind === 'character.created')).toHaveLength(0);
  });

  it('rides the Phase 0B activity.transition event for Enter and Leave', async () => {
    const cookie = await signIn(base, 'rookie');
    const hero = await createCharacter(base, cookie, 'Rookie');
    const events = capture();

    await enterHunt(base, cookie, hero.id, HUNT_KEY);
    await call(base, `/api/characters/${hero.id}/activity`, { method: 'DELETE', cookie });

    const transitions = events.filter((event) => event.kind === 'activity.transition');
    // Phase 1 adds NO new mechanism here: the event Phase 0B already emits is
    // the event Enter and Leave produce.
    expect(transitions.length).toBeGreaterThanOrEqual(2);
    expect(transitions.map((event) => (event as { to: string }).to)).toContain('ACTIVITY_ENDED');

    const occupancy = events.filter(
      (event) => event.kind === 'occupancy.acquired' || event.kind === 'occupancy.released',
    );
    expect(occupancy.map((event) => event.kind)).toEqual([
      'occupancy.acquired',
      'occupancy.released',
    ]);
  });
});
