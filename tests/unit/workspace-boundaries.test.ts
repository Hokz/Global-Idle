// §14.1 — W1 to W11 and W13.
//
// Every case introduces a REAL violation and asserts the REAL command rejects
// it. Nothing here inspects the configuration and concludes it would have
// worked: ADR-012 asks for boundaries the build enforces, so the test drives
// the build.
import { describe, expect, it } from 'vitest';
import {
  boundaries,
  REPO_ROOT,
  run,
  typecheck,
  withTemporaryDir,
  withTemporaryFile,
} from '../support/repo.js';

const violationOf = (result: { status: number; stdout: string; stderr: string }) =>
  `${result.stdout}\n${result.stderr}`;

describe('§14.1 workspace and boundaries', () => {
  it('W1: a forbidden import fails `pnpm boundaries`', () => {
    const clean = boundaries();
    expect(clean.status, violationOf(clean)).toBe(0);

    const dirty = withTemporaryFile(
      'packages/shared/src/__w1_violation.ts',
      "import { describeWorker } from '../../../apps/worker/src/main.js';\nexport const x = describeWorker;\n",
      boundaries,
    );
    expect(dirty.status).not.toBe(0);
    expect(violationOf(dirty)).toMatch(/no-package-to-app/);
  });

  it('W2: game-engine importing Prisma fails', () => {
    const result = withTemporaryFile(
      'packages/game-engine/src/__w2_violation.ts',
      "import type { PrismaClient } from '@prisma/client';\nexport type P = PrismaClient;\n",
      boundaries,
    );
    expect(result.status).not.toBe(0);
    expect(violationOf(result)).toMatch(/engine-no-frameworks-or-clients|not-to-unresolvable/);
  });

  it('W3: game-engine importing NestJS fails', () => {
    const result = withTemporaryFile(
      'packages/game-engine/src/__w3_violation.ts',
      "import { Module } from '@nestjs/common';\nexport const M = Module;\n",
      boundaries,
    );
    expect(result.status).not.toBe(0);
    expect(violationOf(result)).toMatch(/engine-no-frameworks-or-clients|not-to-unresolvable/);
  });

  it('W4: game-engine using Date.now fails lint', () => {
    const result = withTemporaryFile(
      'packages/game-engine/src/__w4_violation.ts',
      'export const t = (): number => Date.now();\n',
      () => run('npx', ['eslint', 'packages/game-engine/src/__w4_violation.ts']),
    );
    expect(result.status).not.toBe(0);
    expect(violationOf(result)).toMatch(/ADR-010: the engine reads no clock/);
  });

  it('W5: game-engine using Math.random fails lint', () => {
    const result = withTemporaryFile(
      'packages/game-engine/src/__w5_violation.ts',
      'export const r = (): number => Math.random();\n',
      () => run('npx', ['eslint', 'packages/game-engine/src/__w5_violation.ts']),
    );
    expect(result.status).not.toBe(0);
    expect(violationOf(result)).toMatch(/injected SeededRandom/);
  });

  it('W6: packages importing apps fails', () => {
    const result = withTemporaryFile(
      'packages/domain/src/__w6_violation.ts',
      "import { describeWorker } from '../../../apps/worker/src/main.js';\nexport const x = describeWorker;\n",
      boundaries,
    );
    expect(result.status).not.toBe(0);
    expect(violationOf(result)).toMatch(/no-package-to-app/);
  });

  it('W7: web importing game-engine or a persistence package fails', () => {
    const engine = withTemporaryFile(
      'apps/web/app/__w7_engine.ts',
      "import { GAME_ENGINE_PACKAGE } from '@global-idle/game-engine';\nexport const e = GAME_ENGINE_PACKAGE;\n",
      boundaries,
    );
    expect(engine.status).not.toBe(0);
    expect(violationOf(engine)).toMatch(/web-no-server-internals|not-to-unresolvable/);

    const domain = withTemporaryFile(
      'apps/web/app/__w7_domain.ts',
      "import { activity } from '@global-idle/domain';\nexport const d = activity;\n",
      boundaries,
    );
    expect(domain.status).not.toBe(0);
    expect(violationOf(domain)).toMatch(/web-no-server-internals|not-to-unresolvable/);
  });

  it("W8: one domain context importing another context's internals fails", () => {
    const result = withTemporaryDir(
      'packages/domain/src/contexts/economy/__w8',
      {
        'probe.ts':
          "import { ACTIVITY_INTERNAL } from '../../activity/__w8_internal/secret.js';\nexport const v = ACTIVITY_INTERNAL;\n",
      },
      () =>
        withTemporaryDir(
          'packages/domain/src/contexts/activity/__w8_internal',
          { 'secret.ts': 'export const ACTIVITY_INTERNAL = 1;\n' },
          boundaries,
        ),
    );
    expect(result.status).not.toBe(0);
    expect(violationOf(result)).toMatch(/domain-no-cross-context-internals/);
  });

  it('W9: the full dependency graph matches the declared rules', () => {
    const result = boundaries();
    expect(result.status, violationOf(result)).toBe(0);
    expect(result.stdout).toMatch(/no dependency violations found/);
  });

  it('W10: apps/worker importing apps/api fails, and vice versa', () => {
    const workerToApi = withTemporaryFile(
      'apps/worker/src/__w10_violation.ts',
      "import { AppModule } from '../../api/src/app.module.js';\nexport const a: unknown = AppModule;\n",
      boundaries,
    );
    expect(workerToApi.status).not.toBe(0);
    expect(violationOf(workerToApi)).toMatch(/worker-not-api/);

    const apiToWorker = withTemporaryFile(
      'apps/api/src/__w10_violation.ts',
      "import { describeWorker } from '../../worker/src/main.js';\nexport const b = describeWorker;\n",
      boundaries,
    );
    expect(apiToWorker.status).not.toBe(0);
    expect(violationOf(apiToWorker)).toMatch(/api-not-worker/);
  });

  it('W11: importing a domain context internal rather than its index.ts fails', () => {
    const result = withTemporaryDir(
      'packages/domain/src/contexts/activity/__w11_internal',
      { 'thing.ts': 'export const THING = 1;\n' },
      () =>
        withTemporaryFile(
          'packages/domain/src/platform/__w11_violation.ts',
          "import { THING } from '../contexts/activity/__w11_internal/thing.js';\nexport const t = THING;\n",
          boundaries,
        ),
    );
    expect(result.status).not.toBe(0);
    expect(violationOf(result)).toMatch(/domain-context-public-surface-only/);
  });

  it('W13: all seven workspaces are typechecked', () => {
    const clean = typecheck();
    expect(clean.status, violationOf(clean)).toBe(0);

    // The six composite projects go through `tsc -b`...
    const composite = [
      'packages/shared/src',
      'packages/game-data/src',
      'packages/game-engine/src',
      'packages/domain/src',
      'apps/api/src',
      'apps/worker/src',
    ];
    for (const dir of composite) {
      const result = withTemporaryFile(
        `${dir}/__w13_type_error.ts`,
        'export const broken: number = "not a number";\n',
        typecheck,
      );
      expect(result.status, `expected a type error in ${dir} to fail tsc -b`).not.toBe(0);
    }

    // ...and apps/web through its own `tsc --noEmit`, because a noEmit project
    // cannot be a project-reference target (TS6310, §4.4).
    const web = withTemporaryFile(
      'apps/web/app/__w13_type_error.ts',
      'export const broken: number = "not a number";\n',
      () => run('npx', ['tsc', '--noEmit'], `${REPO_ROOT}/apps/web`),
    );
    expect(web.status, 'expected a type error in apps/web to fail its typecheck').not.toBe(0);
  });
});
