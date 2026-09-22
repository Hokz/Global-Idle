// Engine determinism helpers (§14.10, E1 and E2).
//
// The inputs live here, in ONE place, and are handed to the child process as
// JSON rather than copied into it. A fixture whose "same inputs" are written
// out twice proves that two copies agree, not that the engine is
// deterministic. The fixture BODY lives in engine-runner.mjs, for the same
// reason: a fresh node process has no transpiler and must import it as is.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CombatProfile, CreatureStats, RoomPlan } from '@global-idle/game-engine';
import { REPO_ROOT } from './repo.js';

const DIST_ENTRY = join(REPO_ROOT, 'packages', 'game-engine', 'dist', 'index.js');
const RUNNER = join(REPO_ROOT, 'tests', 'support', 'engine-runner.mjs');

export interface EngineFixtureInput {
  readonly seed: string;
  readonly state: { readonly activityId: string; readonly tick: number };
  readonly party: readonly { readonly characterId: string; readonly vocation: string }[];
  readonly content: { readonly version: string; readonly keys: readonly string[] };
  readonly elapsedMs: number;
}

/** Fixed forever. Changing any value here invalidates the golden file, which
 *  is the point: a silent change to the fixture would hide a change to the
 *  engine. */
export const FIXTURE_INPUT: EngineFixtureInput = {
  seed: 'phase-0b-fixture-seed',
  state: { activityId: 'activity-fixture', tick: 7 },
  party: [
    { characterId: 'character-a', vocation: 'KNIGHT' },
    { characterId: 'character-b', vocation: 'DRUID' },
    { characterId: 'character-c', vocation: 'MONK' },
  ],
  content: { version: 'v0000000000000001', keys: ['placeholder.node.a', 'placeholder.node.b'] },
  elapsedMs: 61_000,
};

/**
 * The PHASE 2 fixture (§12, SIM1 and SIM10).
 *
 * The profile and the plan are FROZEN HERE rather than read from the content
 * bundle, deliberately. This fixture pins the ENGINE: a content retune must be
 * free to change the first fight without rewriting a golden file, and a change
 * to the simulator must not be able to hide behind one. The authored content
 * is pinned instead by the SRC cases, against the Canary import record.
 */
export interface HuntFixtureInput {
  readonly seed: string;
  readonly profile: CombatProfile;
  readonly plan: RoomPlan;
  readonly charges: number;
  readonly ticks: number;
}

/** A Rat, as the record reads it. Fixed forever; see above. */
const FIXTURE_RAT: CreatureStats = {
  key: 'creature.rat',
  maxHealth: 20,
  experience: 5,
  attackIntervalMs: 2000,
  maxDamage: 8,
  defense: 5,
  armor: 1,
  mitigation: 0.07,
  gold: { chance: 1, min: 1, max: 4 },
};

export const HUNT_FIXTURE_INPUT: HuntFixtureInput = {
  seed: 'phase-2-hunt-fixture-seed',
  profile: {
    level: 1,
    maxHealth: 150,
    attackSkill: 10,
    attackValue: 9.6,
    attackFactor: 1,
    attackIntervalMs: 2000,
    defense: 4,
    armor: 4,
    supply: { healMin: 60, healMax: 90, useBelowPercent: 40 },
  },
  plan: {
    rooms: [
      { number: 1, creatures: [{ key: 'creature.rat', count: 1 }], endless: false },
      { number: 2, creatures: [{ key: 'creature.rat', count: 2 }], endless: false },
      { number: 3, creatures: [{ key: 'creature.rat', count: 1 }], endless: true },
    ],
    creatures: { 'creature.rat': FIXTURE_RAT },
  },
  charges: 20,
  ticks: 600,
};

let built = false;

function ensureBuilt(): void {
  if (built && existsSync(DIST_ENTRY)) return;
  const result = spawnSync('npx', ['tsc', '-b', 'packages/game-engine'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`building packages/game-engine failed:\n${result.stdout}${result.stderr}`);
  }
  built = true;
}

/**
 * Run the same fixture in a BRAND NEW node process. Determinism that only
 * holds within one process is not determinism; it is a warm cache.
 */
export async function runFixtureInFreshProcess(input: EngineFixtureInput): Promise<string> {
  ensureBuilt();

  const dir = await mkdtemp(join(tmpdir(), 'global-idle-engine-'));
  const script = join(dir, 'run.mjs');
  await writeFile(
    script,
    [
      `import * as engine from ${JSON.stringify(DIST_ENTRY)};`,
      `import { runFixture, canonicalJson } from ${JSON.stringify(RUNNER)};`,
      `const input = JSON.parse(process.argv[2]);`,
      `process.stdout.write(canonicalJson(runFixture(engine, input)));`,
    ].join('\n'),
    'utf8',
  );

  const result = spawnSync(process.execPath, [script, JSON.stringify(input)], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(
      `the engine fixture failed in a fresh process:\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

/**
 * The Phase 2 fixture in a BRAND NEW node process (SIM10).
 *
 * Same machinery as E2, pointed at `runHuntFixture`. Determinism that only
 * holds inside one process is a warmed cache, not determinism — and a
 * simulation whose draw ordering shifted after a restart would resume a
 * player's Hunt into a different future than the one they left.
 */
export async function runHuntFixtureInFreshProcess(input: HuntFixtureInput): Promise<string> {
  ensureBuilt();

  const dir = await mkdtemp(join(tmpdir(), 'global-idle-hunt-'));
  const script = join(dir, 'run.mjs');
  await writeFile(
    script,
    [
      `import * as engine from ${JSON.stringify(DIST_ENTRY)};`,
      `import { runHuntFixture, canonicalJson } from ${JSON.stringify(RUNNER)};`,
      `const input = JSON.parse(process.argv[2]);`,
      `process.stdout.write(canonicalJson(runHuntFixture(engine, input)));`,
    ].join('\n'),
    'utf8',
  );

  const result = spawnSync(process.execPath, [script, JSON.stringify(input)], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(
      `the hunt fixture failed in a fresh process:\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}
