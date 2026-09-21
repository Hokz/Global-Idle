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
