/**
 * The content bundle resolver (§7.7).
 *
 * - bundles are IMMUTABLE and versioned as a whole;
 * - ANY REFERENCED BUNDLE MUST RESOLVE (ADR-016). No code may assume the
 *   current bundle is the only loadable one;
 * - there is NO hot reload into an existing Activity: a running activity keeps
 *   the bundle it pinned (§10.1).
 */
import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { checksumOf } from './build.js';
import type { ContentBundleArtifact } from './schema.js';

export interface ResolvedBundle {
  readonly version: string;
  readonly checksum: string;
  readonly definitions: ReadonlyMap<string, ContentBundleArtifact['definitions'][number]>;
  readonly unlockSets: ContentBundleArtifact['unlockSets'];
}

export interface ContentBundleResolver {
  current(): Promise<ResolvedBundle>;
  /** Any referenced version, not merely the current one (ADR-016). */
  resolve(version: string): Promise<ResolvedBundle>;
  isAvailable(version: string): Promise<boolean>;
}

export class ContentBundleCorrupt extends Error {
  constructor(
    readonly version: string,
    readonly declared: string,
    readonly actual: string,
  ) {
    super(`Content bundle ${version} does not match its checksum.`);
    this.name = 'ContentBundleCorrupt';
  }
}

export class ContentBundleNotAvailable extends Error {
  constructor(readonly version: string) {
    super(`Content bundle ${version} is not available.`);
    this.name = 'ContentBundleNotAvailable';
  }
}

/**
 * The ONE place the on-disk layout of a bundle is decided.
 *
 * The domain stores this path in `ContentBundle.location` and deletes exactly
 * it during cleanup (§7.7); it never reconstructs the convention itself,
 * because two implementations of the same convention is how cleanup deletes
 * the wrong file.
 */
export function bundleFilePath(directory: string, version: string): string {
  return join(directory, `${version}.json`);
}

const fileFor = bundleFilePath;

export async function writeBundle(
  directory: string,
  artifact: ContentBundleArtifact,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = fileFor(directory, artifact.version);
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return path;
}

export async function deleteBundleFile(directory: string, version: string): Promise<void> {
  await deleteBundleFileAt(fileFor(directory, version));
}

/**
 * Delete a bundle artifact by its stored location. `force` so that a second
 * pass over an already-removed orphan is a no-op rather than an error: the
 * reconciliation job of §7.7 is expected to be re-run.
 */
export async function deleteBundleFileAt(path: string): Promise<void> {
  await rm(path, { force: true });
}

export async function listBundleFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory);
    return entries.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5));
  } catch {
    return [];
  }
}

function toResolved(artifact: ContentBundleArtifact): ResolvedBundle {
  return {
    version: artifact.version,
    checksum: artifact.checksum,
    definitions: new Map(artifact.definitions.map((definition) => [definition.key, definition])),
    unlockSets: artifact.unlockSets,
  };
}

/**
 * Local filesystem provider (§7.7). Object storage is a later swap that
 * changes no caller.
 *
 * The cache is a CONVENIENCE, not the mechanism: a cold process must resolve a
 * historical pinned bundle from storage, which is exactly what test C3
 * asserts. Nothing here assumes the current bundle is the only loadable one.
 */
export function createFilesystemResolver(
  directory: string,
  currentVersion: () => Promise<string>,
): ContentBundleResolver {
  const cache = new Map<string, ResolvedBundle>();

  async function load(version: string): Promise<ResolvedBundle> {
    const cached = cache.get(version);
    if (cached) return cached;

    let raw: string;
    try {
      raw = await readFile(fileFor(directory, version), 'utf8');
    } catch {
      throw new ContentBundleNotAvailable(version);
    }

    const artifact = JSON.parse(raw) as ContentBundleArtifact;

    // A bundle whose bytes do not match its checksum is not the bundle that
    // was pinned. Serving it would silently substitute content under a running
    // activity, which is the one thing pinning exists to prevent.
    const recomputed = checksumOf({
      name: artifact.name,
      definitions: artifact.definitions,
      unlockSets: artifact.unlockSets,
    });
    if (recomputed !== artifact.checksum) {
      throw new ContentBundleCorrupt(version, artifact.checksum, recomputed);
    }

    const resolved = toResolved(artifact);
    cache.set(version, resolved);
    return resolved;
  }

  return {
    async current() {
      return load(await currentVersion());
    },
    resolve: load,
    async isAvailable(version) {
      try {
        await load(version);
        return true;
      } catch {
        return false;
      }
    },
  };
}
