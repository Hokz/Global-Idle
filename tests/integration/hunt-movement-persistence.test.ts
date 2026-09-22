/**
 * Phase 3.5 §20 — PER1 to PER6. A step in flight survives the database.
 *
 * The engine's own cases prove that a `HuntState` round-trips through JSON.
 * That is not the same claim. This group drives the REAL path — `advance`
 * writes `HuntRun.position`, a later settlement reads that row back — because
 * the defect this group exists for lived exactly there: the write was correct
 * and the read took only half of it, so a Character mid-step became a
 * Character standing still, free to decide again, with its destination no
 * longer reserved.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hunt as huntContext, withTransaction } from '@global-idle/domain';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { createClient, databaseUrl, truncateAll } from '../support/db.js';
import { advanceOnce, publishContent, readRun, startHunt } from '../support/phase2.js';
import { REPO_ROOT } from '../support/repo.js';

const prisma = createClient();
const T0 = new Date('2026-03-05T09:00:00.000Z');
const RUNNER = join(REPO_ROOT, 'tests', 'support', 'restart-runner.mjs');

interface Tile {
  x: number;
  y: number;
  z: number;
}
interface Movement {
  from: Tile;
  to: Tile;
  startsAtMs: number;
  arrivesAtMs: number;
}
interface StoredPosition {
  tile: Tile;
  movement?: Movement;
}

let directory: string;
let version: string;
let resolver: ContentBundleResolver;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-per-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
});

afterAll(async () => {
  await prisma.$disconnect();
});

const at = (x: number, y: number): Tile => ({ x, y, z: 7 });
const position = (activityId: string) =>
  prisma.huntRun
    .findUniqueOrThrow({ where: { activityId } })
    .then((run) => run.position as unknown as StoredPosition | null);

/** Put a step in flight that cannot possibly complete inside the next tick. */
async function arrangeLongStep(activityId: string, arrivesAtMs: number): Promise<Movement> {
  const run = await prisma.huntRun.findUniqueOrThrow({ where: { activityId } });
  const movement: Movement = {
    from: at(20, 5),
    to: at(21, 5),
    startsAtMs: run.tick * 1000,
    arrivesAtMs,
  };
  await prisma.huntRun.update({
    where: { activityId },
    data: {
      room: 4,
      creatures: [] as never,
      position: { tile: movement.from, movement } as never,
    },
  });
  return movement;
}

describe('§20 PER — movement survives the database', () => {
  it('PER1: a settlement that ends mid-step persists the whole step', async () => {
    const run = await startHunt(prisma, resolver, version, T0);
    // Two ticks. The encounter SPAWNS on the first tick — movement is decided
    // on the 50 ms beat and spawning on the 1000 ms tick, so the first second
    // has nothing to walk toward — and the second tick puts the Character mid
    // step: it leaves at 1050, arrives at 1600, leaves again, and the boundary
    // at 2000 falls inside that leg.
    await advanceOnce(prisma, resolver, run.activityId, new Date(T0.getTime() + 2_000));

    const stored = await position(String(run.activityId));
    expect(stored).not.toBeNull();
    expect(stored!.tile).toMatchObject({ z: 7 });
    expect(stored!.movement).toBeDefined();
    const flight = stored!.movement!;
    // Everything the next settlement needs, and the tile it is still on.
    expect(flight.from).toEqual(stored!.tile);
    expect(flight.to).toMatchObject({ z: 7 });
    expect(flight.startsAtMs).toBeLessThan(flight.arrivesAtMs);
    const durable = await readRun(prisma, run.activityId);
    expect(flight.arrivesAtMs).toBeGreaterThan(durable.tick * 1000);
  });

  it('PER2: the next settlement resumes that step instead of starting a new one', async () => {
    const run = await startHunt(prisma, resolver, version, T0);
    await advanceOnce(prisma, resolver, run.activityId, new Date(T0.getTime() + 2_000));
    // A step that cannot finish before the next boundary, so "still in flight"
    // is observable rather than inferred.
    const arranged = await arrangeLongStep(String(run.activityId), 99_000);

    await advanceOnce(prisma, resolver, run.activityId, new Date(T0.getTime() + 3_000));

    const stored = await position(String(run.activityId));
    // The tile has not moved, and the step is the SAME step — not a fresh
    // departure from the same origin with a later start.
    expect(stored!.tile).toEqual(arranged.from);
    expect(stored!.movement).toEqual(arranged);
  });

  it('PER3: the destination stays reserved across the boundary', async () => {
    const run = await startHunt(prisma, resolver, version, T0);
    await advanceOnce(prisma, resolver, run.activityId, new Date(T0.getTime() + 2_000));
    const arranged = await arrangeLongStep(String(run.activityId), 99_000);

    // Spawn the room's creatures and let them converge for a while. Nothing
    // may take the tile the Character has committed to.
    for (let span = 3; span <= 30; span += 1) {
      await advanceOnce(prisma, resolver, run.activityId, new Date(T0.getTime() + span * 1_000));
      const durable = await prisma.huntRun.findUniqueOrThrow({
        where: { activityId: String(run.activityId) },
      });
      const creatures = durable.creatures as unknown as {
        health: number;
        position?: Tile;
        movement?: Movement;
      }[];
      for (const creature of creatures) {
        if (creature.health <= 0) continue;
        expect(creature.position).not.toEqual(arranged.to);
        if (creature.movement) expect(creature.movement.to).not.toEqual(arranged.to);
      }
    }
  });

  it('PER4: arrival commits the tile, and only then is a new step decided', async () => {
    const run = await startHunt(prisma, resolver, version, T0);
    await advanceOnce(prisma, resolver, run.activityId, new Date(T0.getTime() + 2_000));
    // Arrives inside the NEXT tick rather than far away.
    const arranged = await arrangeLongStep(String(run.activityId), 2_500);

    await advanceOnce(prisma, resolver, run.activityId, new Date(T0.getTime() + 3_000));

    const stored = await position(String(run.activityId));
    expect(stored!.tile).toEqual(arranged.to);
    // Either standing still, or on a step that began at or after the arrival —
    // never one that pretends to have started before it got there.
    if (stored!.movement) {
      expect(stored!.movement.startsAtMs).toBeGreaterThanOrEqual(arranged.arrivesAtMs);
      expect(stored!.movement.from).toEqual(arranged.to);
    }
  });

  it('PER5: a FRESH PROCESS resumes the same step, and the same future', async () => {
    const run = await startHunt(prisma, resolver, version, T0);
    await advanceOnce(prisma, resolver, run.activityId, new Date(T0.getTime() + 2_000));
    const arranged = await arrangeLongStep(String(run.activityId), 99_000);

    // Nothing this process warmed is involved: a new node, a new client, a new
    // resolver, and only the durable row to go on.
    const out = execFileSync(
      process.execPath,
      [
        RUNNER,
        databaseUrl(),
        directory,
        String(run.activityId),
        new Date(T0.getTime() + 3_000).toISOString(),
      ],
      { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 },
    );
    const view = JSON.parse(out) as {
      space: { tile: Tile; movement: Movement | null } | null;
    };
    expect(view.space).not.toBeNull();
    expect(view.space!.tile).toEqual(arranged.from);
    expect(view.space!.movement).toEqual(arranged);

    const stored = await position(String(run.activityId));
    expect(stored!.movement).toEqual(arranged);
  });

  it('PER6: reconnect grace does not throw the step away', async () => {
    const run = await startHunt(prisma, resolver, version, T0);
    await advanceOnce(prisma, resolver, run.activityId, new Date(T0.getTime() + 2_000));
    const arranged = await arrangeLongStep(String(run.activityId), 99_000);

    // Past the liveness window with nobody there: the run pauses.
    const away = new Date(T0.getTime() + 120_000);
    const paused = await withTransaction(prisma, (tx) =>
      huntContext.advance(tx, { activityId: run.activityId, resolver, now: away, seen: false }),
    );
    expect(paused?.connection).toBe('RECONNECT_GRACE_PAUSED');
    expect(paused?.space?.movement).toEqual(arranged);

    // And coming back finds the same step, not a Character that forgot it.
    const back = await advanceOnce(prisma, resolver, run.activityId, away);
    expect(back?.connection).toBe('ONLINE_ACTIVE');
    const stored = await position(String(run.activityId));
    expect(stored!.tile).toEqual(arranged.from);
    expect(stored!.movement).toEqual(arranged);
  });
});
