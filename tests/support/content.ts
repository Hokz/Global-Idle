// Content-bundle helpers for the §14.8 cases.
//
// The one thing that needs care here is C3 and C9's "after a process
// restart". A fresh resolver object in this process has a cold cache, but it
// is still the same process, with the same module graph and the same file
// handles. Proving the claim the specification makes means actually starting
// node again, which is what resolveInFreshProcess does.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './repo.js';

const GAME_DATA = join(REPO_ROOT, 'packages', 'game-data');
const DIST_ENTRY = join(GAME_DATA, 'dist', 'index.js');

/** A scratch directory for bundle artifacts, outside the repository so a
 *  failed test cannot leave one in the working tree. */
export async function makeBundleDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'global-idle-bundles-'));
}

let built = false;

/**
 * `tsc -b` the package so the child process has something to import. It is
 * incremental, so this is a no-op once the tree is built, and it guarantees
 * the child runs the CURRENT source rather than a stale dist.
 */
function ensureBuilt(): void {
  if (built && existsSync(DIST_ENTRY)) return;
  const result = spawnSync('npx', ['tsc', '-b', 'packages/game-data'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`building packages/game-data failed:\n${result.stdout}${result.stderr}`);
  }
  built = true;
}

export interface FreshProcessResolution {
  readonly version: string;
  readonly checksum: string;
  readonly definitionKeys: readonly string[];
}

/**
 * Resolve a bundle in a BRAND NEW node process: no warmed cache, no shared
 * module state, nothing this process can have primed.
 *
 * The child is given a `current()` that throws, so a resolution that quietly
 * fell back to the current bundle would fail rather than pass.
 */
export async function resolveInFreshProcess(
  directory: string,
  version: string,
): Promise<FreshProcessResolution> {
  ensureBuilt();

  const scriptDir = await mkdtemp(join(tmpdir(), 'global-idle-restart-'));
  const script = join(scriptDir, 'resolve.mjs');
  await writeFile(
    script,
    [
      `import { createFilesystemResolver } from ${JSON.stringify(DIST_ENTRY)};`,
      `const [directory, version] = process.argv.slice(2);`,
      `const resolver = createFilesystemResolver(directory, async () => {`,
      `  throw new Error('current() must not be consulted when resolving a pinned version');`,
      `});`,
      `const bundle = await resolver.resolve(version);`,
      `process.stdout.write(JSON.stringify({`,
      `  version: bundle.version,`,
      `  checksum: bundle.checksum,`,
      `  definitionKeys: [...bundle.definitions.keys()],`,
      `}));`,
    ].join('\n'),
    'utf8',
  );

  const result = spawnSync(process.execPath, [script, directory, version], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(
      `resolving ${version} in a fresh process failed:\n${result.stdout}${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as FreshProcessResolution;
}

/** PostgreSQL SQLSTATEs these cases assert on. */
export const FOREIGN_KEY_VIOLATION = '23503';
export const NOT_NULL_VIOLATION = '23502';

interface PrismaLikeError {
  readonly code?: string;
  readonly meta?: {
    readonly code?: string;
    readonly driverAdapterError?: { readonly cause?: { readonly originalCode?: string } };
  };
}

/**
 * The SQLSTATE the DATABASE raised, read structurally.
 *
 * Prisma surfaces a failed raw statement as P2010 carrying the driver's own
 * code under `meta.driverAdapterError.cause.originalCode`. A predicate that
 * greps the prose instead would pass for any error that happens to share a
 * word, which is the same mistake `expectDomainError` exists to avoid.
 */
export function sqlStateOf(error: unknown): string | undefined {
  const candidate = error as PrismaLikeError;
  return (
    candidate?.meta?.driverAdapterError?.cause?.originalCode ??
    candidate?.meta?.code ??
    (typeof candidate?.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)
      ? candidate.code
      : undefined)
  );
}

/**
 * Was this statement refused by a FOREIGN KEY, rather than by application
 * code? Prisma reports a model write that violates one as P2003 and a raw
 * statement as P2010 plus SQLSTATE 23503.
 */
export function isForeignKeyRefusal(error: unknown): boolean {
  return (
    (error as PrismaLikeError)?.code === 'P2003' || sqlStateOf(error) === FOREIGN_KEY_VIOLATION
  );
}
