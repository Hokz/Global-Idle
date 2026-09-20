// §14.1 — W12. The clean-checkout claim, actually exercised.
//
// §16 criterion 1 requires `pnpm install && pnpm build && pnpm test` to succeed
// from a clean checkout, and criterion 1a requires that checkout to contain no
// generated artefact. This test exports the working tree WITHOUT node_modules,
// dist, .next, *.tsbuildinfo or src/generated, and runs the chain there.
//
// The nested test run is guarded: without GLOBAL_IDLE_NESTED_BUILD the inner
// `vitest run --project unit` would re-enter this file and recurse forever.
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
    const env = { DATABASE_URL: 'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder' };

    const install = runClean('pnpm', ['install', '--frozen-lockfile'], workspace, env);
    expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);

    const build = runClean('pnpm', ['build'], workspace, env);
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);

    // The generated client exists only because `pnpm build` produced it.
    expect(existsSync(join(workspace, 'packages/domain/src/generated/prisma/client.ts'))).toBe(
      true,
    );

    // Tests resolve internal packages through their BUILT exports (§3.7), so
    // this only passes because the build ran first.
    const test = runClean('bash', ['-c', 'pnpm vitest run --project unit'], workspace, {
      ...env,
      GLOBAL_IDLE_NESTED_BUILD: '1',
    });
    expect(test.status, `${test.stdout}\n${test.stderr}`).toBe(0);
  }, 900_000);
});
