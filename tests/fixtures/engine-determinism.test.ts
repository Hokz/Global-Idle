// §14.10 — E1 and E2. The engine is deterministic (ADR-010, §9.3).
//
// Phase 0B implements no gameplay, so what these cases protect is the property
// every later phase depends on: the same inputs and the same seed produce the
// same output, today, in another process, and after a refactor. The GOLDEN
// FILE is the part that survives a refactor — two fresh runs of a broken
// implementation agree with each other perfectly.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as engine from '@global-idle/game-engine';
import { FIXTURE_INPUT, runFixtureInFreshProcess } from '../support/engine.js';
import { canonicalJson, runFixture } from '../support/engine-runner.mjs';
import { REPO_ROOT } from '../support/repo.js';

const GOLDEN = join(REPO_ROOT, 'tests', 'fixtures', 'engine', 'golden.json');

describe('§14.10 engine determinism', () => {
  it('E1: same inputs and the same seed produce identical output', async () => {
    const first = canonicalJson(runFixture(engine, FIXTURE_INPUT));
    const second = canonicalJson(runFixture(engine, FIXTURE_INPUT));

    // Byte-identical, not merely deep-equal.
    expect(second).toBe(first);

    // ...and identical to the output recorded when this engine was written.
    // Without this, a change that breaks every historical replay would still
    // pass: the two runs above would agree with each other.
    expect(first).toBe(await readFile(GOLDEN, 'utf8'));

    // A DIFFERENT seed must produce different output, or the case above is
    // satisfied by a constant function.
    const other = canonicalJson(runFixture(engine, { ...FIXTURE_INPUT, seed: 'another-seed' }));
    expect(other).not.toBe(first);

    // Draw ordering is part of the contract (§9.3): one draw per participant,
    // in party order, and exactly one per nextInt and per pick.
    const result = runFixture(engine, FIXTURE_INPUT);
    expect((result.result as { drawsConsumed: number }).drawsConsumed).toBe(
      FIXTURE_INPUT.party.length,
    );
    expect(result.drawCount).toBe(FIXTURE_INPUT.party.length + 15);

    // The party is ORDERED (ADR-005): reordering it is a different run.
    const reordered = canonicalJson(
      runFixture(engine, { ...FIXTURE_INPUT, party: [...FIXTURE_INPUT.party].reverse() }),
    );
    expect(reordered).not.toBe(first);
  });

  it('E2: determinism survives a process restart', async () => {
    const inProcess = canonicalJson(runFixture(engine, FIXTURE_INPUT));

    // A brand-new node, importing the BUILT engine: no warmed module state,
    // no shared generator, nothing this process primed.
    const restarted = await runFixtureInFreshProcess(FIXTURE_INPUT);

    expect(restarted).toBe(inProcess);
    expect(restarted).toBe(await readFile(GOLDEN, 'utf8'));
  }, 180_000);
});
