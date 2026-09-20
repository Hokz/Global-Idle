// Shared helpers for the workspace-level tests (W1–W13).
//
// These tests drive the real commands rather than re-implementing their logic:
// a boundary test that reasons about the rules instead of running them proves
// nothing about the gate CI uses.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface RunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function run(
  command: string,
  args: string[],
  cwd = REPO_ROOT,
  env: NodeJS.ProcessEnv = {},
): RunResult {
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', NO_COLOR: '1', ...env },
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
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
