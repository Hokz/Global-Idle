// Shared helpers for the workspace-level tests (W1–W13).
//
// These tests drive the real commands rather than re-implementing their logic:
// a boundary test that reasons about the rules instead of running them proves
// nothing about the gate CI uses.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface RunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Build an environment that does NOT carry the test runner's own settings.
 *
 * Vitest exports NODE_ENV, NODE_OPTIONS, VITEST_* and friends into the
 * process, and inheriting them into a nested `pnpm build` is not what a clean
 * checkout looks like — it made `next build` fail while the identical tree
 * built fine from a shell.
 */
export function pristineEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'SHELL', 'LANG', 'TERM', 'TMPDIR', 'USER'];
  const env: NodeJS.ProcessEnv = { CI: '1', NO_COLOR: '1' };
  for (const key of keep) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

export function run(
  command: string,
  args: string[],
  cwd = REPO_ROOT,
  env: NodeJS.ProcessEnv = {},
): RunResult {
  // spawnSync rather than execFileSync: execFileSync returns stdout only and
  // discards stderr unless the command FAILS, so a successful command that
  // reports on stderr — migrate:check does — came back empty.
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', NO_COLOR: '1', ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Like {@link run}, but with the runner's own environment stripped. */
export function runClean(
  command: string,
  args: string[],
  cwd: string,
  extra: NodeJS.ProcessEnv = {},
): RunResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: pristineEnv(extra),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function boundaries(): RunResult {
  return run('npx', ['depcruise', '--config', '.dependency-cruiser.cjs', 'apps', 'packages']);
}

export function typecheck(): RunResult {
  return run('npx', ['tsc', '-b']);
}

/**
 * Write a file, run `body`, and remove the file again — even if the assertion
 * inside `body` throws. A boundary test that leaves its own violation behind
 * poisons every later test in the run.
 */
export function withTemporaryFile<T>(relativePath: string, contents: string, body: () => T): T {
  const absolute = resolve(REPO_ROOT, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, 'utf8');
  try {
    return body();
  } finally {
    rmSync(absolute, { force: true });
  }
}

export function withTemporaryDir<T>(
  relativeDir: string,
  files: Record<string, string>,
  body: () => T,
): T {
  const absolute = resolve(REPO_ROOT, relativeDir);
  mkdirSync(absolute, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const target = resolve(absolute, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  }
  try {
    return body();
  } finally {
    rmSync(absolute, { force: true, recursive: true });
  }
}
