/**
 * Where authored content lives, and how the CLIs find it.
 *
 * Both CLIs run from `dist/cli/`, and both are also imported from `src/cli/`
 * by tests. The package root is two levels up either way, so one helper serves
 * both without a build-mode branch.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Authored bundle sources. §10.3: a MINIMAL PLACEHOLDER only — creature, item
 *  and hunt content is Phase 2 and later. */
export const CONTENT_DIR = join(PACKAGE_ROOT, 'content');

/** Built artifacts. Immutable and named by the version the build computes. */
export const BUNDLES_DIR = join(PACKAGE_ROOT, 'bundles');

export async function sourceFiles(directory: string = CONTENT_DIR): Promise<string[]> {
  const entries = await readdir(directory);
  return entries
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(directory, name));
}

export async function readSource(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
