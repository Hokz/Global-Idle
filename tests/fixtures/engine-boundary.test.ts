// §14.10 — E3. The engine's module graph contains no forbidden import.
//
// ADR-010's determinism requirement is made mechanical by two independent
// checks, and this asserts both: dependency-cruiser over the module graph
// (frameworks, clients, I/O) and ESLint over the globals no module-graph tool
// can see (Date.now, Math.random, process.env, timers, fetch).
//
// One `it` per matrix case, so the suite can be counted against §14 exactly.
import { describe, expect, it } from 'vitest';
import { boundaries, run, withTemporaryFile } from '../support/repo.js';

describe('§14.10 engine', () => {
  it('E3: the engine module graph contains no forbidden import', () => {
    const graph = boundaries();
    expect(graph.status, `${graph.stdout}\n${graph.stderr}`).toBe(0);

    const lint = run('npx', ['eslint', 'packages/game-engine/src']);
    expect(lint.status, `${lint.stdout}\n${lint.stderr}`).toBe(0);

    // The graph is clean; prove the rules would catch it if it were not.
    for (const [name, source, pattern] of [
      ['clock', 'export const t = (): number => Date.now();\n', /reads no clock/],
      ['rng', 'export const r = (): number => Math.random();\n', /injected SeededRandom/],
      ['env', "export const e = process.env['X'];\n", /reads no environment/],
      ['timer', 'export const s = () => setTimeout(() => {}, 1);\n', /no scheduling/],
    ] as const) {
      const violation = withTemporaryFile(`packages/game-engine/src/__e3_${name}.ts`, source, () =>
        run('npx', ['eslint', `packages/game-engine/src/__e3_${name}.ts`]),
      );
      expect(violation.status, `expected the ${name} violation to fail lint`).not.toBe(0);
      expect(`${violation.stdout}\n${violation.stderr}`).toMatch(pattern);
    }

    const framework = withTemporaryFile(
      'packages/game-engine/src/__e3_framework.ts',
      "import { Module } from '@nestjs/common';\nexport const M = Module;\n",
      boundaries,
    );
    expect(framework.status).not.toBe(0);
  }, 180_000);
});
