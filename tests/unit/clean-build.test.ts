// §14.1 — W12. The clean-checkout claim, actually exercised.
//
// §16 criterion 1 requires `pnpm install && pnpm build && pnpm test` to succeed
// from a clean checkout, and criterion 1a requires that checkout to contain no
// generated artefact. This test exports the working tree WITHOUT node_modules,
// dist, .next, *.tsbuildinfo or src/generated, and runs that chain there.
//
// THE THIRD COMMAND IS `pnpm test`, NOT A SUBSET OF IT. An earlier version ran
// `vitest run --project unit`, which proved clean-install -> build -> UNIT
// TESTS while the case claimed clean-install -> build -> the documented root
// command. Those are different claims, and the second is the one §16 makes.
// Hand-picking projects here would test an internal approximation of the
// repository's public interface instead of the interface itself.
//
// Recursion is handled by GLOBAL_IDLE_NESTED_BUILD, which skips ONLY this
// case in the nested run. Every other project the real `pnpm test` includes
// still executes in the scratch checkout.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT, runClean } from '../support/repo.js';

const NESTED = process.env['GLOBAL_IDLE_NESTED_BUILD'] === '1';

const EXCLUDES = [
  '.git',
  'node_modules',
  'dist',
  '.next',
  'coverage',
  'src/generated',
  '*.tsbuildinfo',
  '.env',
];

let workspace: string | undefined;

afterAll(() => {
  if (workspace) rmSync(workspace, { force: true, recursive: true });
});

/**
 * The nested `pnpm test` needs PostgreSQL and Redis, because the real root
 * command runs the integration and invariant suites.
 *
 * With a Docker daemon — which is CI — it brings its own up through
 * Testcontainers and needs nothing from here. Where the escape hatch of
 * `tests/support/global-setup.ts` is in use instead, it has to be handed
 * down: `runClean` strips the environment to a pristine set on purpose, and
 * the nested run would otherwise have no services and no way to say so.
 */
function inheritedTestServices(): NodeJS.ProcessEnv {
  const forwarded: NodeJS.ProcessEnv = {};
  for (const key of ['GLOBAL_IDLE_TEST_DATABASE_URL', 'GLOBAL_IDLE_TEST_REDIS_URL'] as const) {
    const value = process.env[key];
    if (value) forwarded[key] = value;
  }
  return forwarded;
}

describe.skipIf(NESTED)('§14.1 W12 — clean checkout', () => {
  it('W12: `pnpm install && pnpm build && pnpm test` succeeds from a clean checkout', () => {
    workspace = mkdtempSync(join(tmpdir(), 'global-idle-w12-'));

    // Export the tree the way a fresh clone would arrive: source only.
    execFileSync(
      'bash',
      [
        '-c',
        `tar -c ${EXCLUDES.map((p) => `--exclude='${p}'`).join(' ')} -C '${REPO_ROOT}' . | tar -x -C '${workspace}'`,
      ],
      { stdio: 'inherit' },
    );

    // Criterion 1a: nothing generated came along.
    expect(existsSync(join(workspace, 'node_modules'))).toBe(false);
    expect(existsSync(join(workspace, 'packages/domain/src/generated'))).toBe(false);
    expect(existsSync(join(workspace, 'packages/domain/dist'))).toBe(false);

    // §4.3: CI exports DATABASE_URL for every step — a placeholder for the
    // static steps. `prisma generate` never connects, but prisma.config.ts
    // reads the variable EAGERLY, and a variable that is unset only here would
    // be exactly the divergence §4.3 exists to prevent.
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder',
    };

    const install = runClean('pnpm', ['install', '--frozen-lockfile'], workspace, env);
    expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);

    const build = runClean('pnpm', ['build'], workspace, env);
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);

    // The generated client exists only because `pnpm build` produced it.
    expect(existsSync(join(workspace, 'packages/domain/src/generated/prisma/client.ts'))).toBe(
      true,
    );

    // THE DOCUMENTED ROOT COMMAND, verbatim. It resolves internal packages
    // through their BUILT exports (§3.7), so it only passes because the build
    // ran first — and it includes the database suites, which is why the
    // scratch checkout is given the same service configuration this run has.
    const test = runClean('pnpm', ['test'], workspace, {
      ...env,
      ...inheritedTestServices(),
      GLOBAL_IDLE_NESTED_BUILD: '1',
    });
    expect(test.status, `${test.stdout}\n${test.stderr}`).toBe(0);
  }, 2_400_000);
});
