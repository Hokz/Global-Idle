/**
 * The durable half of the Content context (§7.7).
 *
 * `packages/game-data` owns content DEFINITIONS — build-time, versioned,
 * read-only at runtime (§4.1). It may not import Prisma (§5.2), so the
 * `ContentBundle` METADATA ROWS and the operations that touch them live here,
 * where every other durable row lives. 0B.7 places them in `packages/domain`
 * for exactly that reason.
 *
 * What this module deliberately does NOT contain:
 *
 * - a reference count or a pinned flag. `ContentBundle` is metadata only. A
 *   counter is a mutable side channel that can drift from reality, and a
 *   drifted counter is how a referenced bundle gets deleted. The pinned set is
 *   derived from real references and therefore cannot disagree with reality,
 *   because it IS reality (test C6);
 * - an automatic sweep. Cleanup is operator-invoked and audited;
 * - a pre-check before deleting. The foreign key refuses a referenced bundle,
 *   so a bug in this file cannot delete one. A pre-check here would invite the
 *   belief that the check is the protection (test C4).
 */
import {
  bundleFilePath,
  deleteBundleFileAt,
  listBundleFiles,
  createFilesystemResolver,
  type ContentBundleArtifact,
  type ContentBundleResolver,
} from '@global-idle/game-data';
import type { Instant } from '@global-idle/shared';
import { stat } from 'node:fs/promises';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { contentBundleUnavailable } from '../../platform/errors/index.js';
import { withTransaction, type UnitOfWork } from '../../platform/transaction/index.js';

/** Anything that can run a statement — the client or a transaction handle. */
type Queryable = Pick<UnitOfWork, '$queryRawUnsafe' | '$executeRawUnsafe'>;

// ─────────────────────────────────────────────────────────────────────────────
// Audit
// ─────────────────────────────────────────────────────────────────────────────

export type ContentAuditEvent =
  | { readonly kind: 'bundle-published'; readonly version: string; readonly location: string }
  | {
      readonly kind: 'bundle-deleted';
      readonly version: string;
      readonly location: string;
      readonly fileDeleted: boolean;
    }
  | { readonly kind: 'orphan-file-removed'; readonly version: string; readonly path: string }
  /** A row whose artifact is gone. §7.7 calls this a P1 incident: the row is
   *  NEVER deleted to resolve it — the artifact is restored. */
  | { readonly kind: 'missing-artifact'; readonly version: string; readonly location: string };

export type ContentAuditLog = (event: ContentAuditEvent) => void;

/**
 * The default sink until 0B.9 introduces the structured logger. Cleanup is
 * required to log what it removed, so "no logger yet" cannot mean "no log".
 *
 * One JSON object per line — the shape pino emits, so swapping the sink in
 * 0B.9 changes the destination and not the record. A missing artifact goes to
 * stderr because it is a P1 incident, not progress.
 */
export const defaultAuditLog: ContentAuditLog = (event) => {
  const incident = event.kind === 'missing-artifact';
  const line = `${JSON.stringify({ context: 'content', level: incident ? 'error' : 'info', ...event })}\n`;
  if (incident) process.stderr.write(line);
  else process.stdout.write(line);
};

// ─────────────────────────────────────────────────────────────────────────────
// Publication and resolution
// ─────────────────────────────────────────────────────────────────────────────

export interface PublishedBundle {
  readonly version: string;
  readonly checksum: string;
  readonly publishedAt: Instant;
  readonly location: string;
}

/**
 * Record a built artifact as available. The artifact file must already be
 * written: a row without a file is the one failure mode §7.7 calls an
 * incident, so publication never creates it deliberately.
 *
 * `location` is stored resolved, and it is what cleanup and reconciliation
 * act on. Nothing downstream reconstructs the path convention.
 */
export async function publish(
  prisma: PrismaClient,
  artifact: ContentBundleArtifact,
  directory: string,
  at: Instant,
  log: ContentAuditLog = defaultAuditLog,
): Promise<PublishedBundle> {
  const location = bundleFilePath(directory, artifact.version);
  const row = await prisma.contentBundle.create({
    data: { version: artifact.version, checksum: artifact.checksum, publishedAt: at, location },
  });
  log({ kind: 'bundle-published', version: row.version, location: row.location });
  return row;
}

/** The bundle a new Activity pins. Latest publication wins; ties break on the
 *  version so the answer is deterministic. */
export async function currentVersion(prisma: PrismaClient): Promise<string> {
  const row = await prisma.contentBundle.findFirst({
    orderBy: [{ publishedAt: 'desc' }, { version: 'desc' }],
    select: { version: true },
  });
  if (!row) throw contentBundleUnavailable({ reason: 'no content bundle has been published' });
  return row.version;
}

/**
 * The §7.7 resolver, backed by the local filesystem provider and by the
 * database's notion of "current". Historical pinned bundles resolve from
 * storage, not from a cache warmed earlier in the same process (test C3).
 */
export function createResolver(prisma: PrismaClient, directory: string): ContentBundleResolver {
  return createFilesystemResolver(directory, () => currentVersion(prisma));
}

/**
 * Readiness (§12.1, test H5): the current bundle must resolve AND match its
 * checksum. `resolve` throws `ContentBundleCorrupt` for a bundle whose bytes
 * drifted, which is why this calls it rather than merely stat-ing the file.
 */
export async function assertCurrentBundleAvailable(
  resolver: ContentBundleResolver,
): Promise<string> {
  try {
    return (await resolver.current()).version;
  } catch (error) {
    throw contentBundleUnavailable({ cause: (error as Error).message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The pinned set — derived, never counted
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every bundle referenced by a durable row, whatever its lifecycle state.
 *
 * NO LIFECYCLE FILTER, deliberately. An `ACTIVITY_ENDED` Hunt and an
 * `EXHAUSTED` Skill Training both keep pinning for as long as their `Activity`
 * row — and with it their roster snapshot — is retained (ADR-016).
 *
 * Every future durable reference to a bundle UNIONs into this derivation.
 * That is a rule for the phases that add them, not an option.
 */
export async function pinnedVersions(client: Queryable): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ contentVersion: string }[]>(
    `SELECT DISTINCT "contentVersion" FROM "Activity"`,
  );
  return rows.map((row) => row.contentVersion).sort();
}

export async function isPinned(client: Queryable, version: string): Promise<boolean> {
  return (await pinnedVersions(client)).includes(version);
}

/** Published bundles that no durable row references. The only bundles the
 *  cleanup path may be pointed at — though the database, not this list, is
 *  what refuses the rest. */
export async function unreferencedVersions(prisma: PrismaClient): Promise<string[]> {
  const pinned = new Set(await pinnedVersions(prisma));
  const rows = await prisma.contentBundle.findMany({ select: { version: true } });
  return rows
    .map((row) => row.version)
    .filter((version) => !pinned.has(version))
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup (§7.7) — metadata first, committed; file only afterwards
// ─────────────────────────────────────────────────────────────────────────────

export interface BundleRemoval {
  readonly version: string;
  readonly location: string;
  readonly fileDeleted: boolean;
}

/**
 * Steps 1-4 of §7.7:
 *
 * ```text
 * 1. BEGIN
 * 2. SELECT ... FOR UPDATE on the ContentBundle row
 * 3. DELETE the row        <- FK RESTRICT refuses if anything still references it
 * 4. COMMIT
 * ```
 *
 * The `FOR UPDATE` closes the insert race: a concurrent activity start that
 * references this bundle blocks on the same row until this commits, and then
 * either finds the row gone — its FK insert fails and the start is retried
 * against the current bundle — or finds this rolled back and proceeds.
 *
 * The foreign-key error from step 3 propagates UNTRANSLATED. Turning it into a
 * domain error here would put cleanup code back into a refusal the database is
 * supposed to own.
 *
 * Returns `null` when there is no such bundle: asking to remove a version that
 * is already gone is a no-op, not a failure, because this is re-runnable.
 */
export async function deleteBundleMetadata(
  prisma: PrismaClient,
  version: string,
): Promise<{ version: string; location: string } | null> {
  return withTransaction(prisma, async (tx) => {
    const locked = await tx.$queryRawUnsafe<{ version: string; location: string }[]>(
      `SELECT version, location FROM "ContentBundle" WHERE version = $1 FOR UPDATE`,
      version,
    );
    const row = locked[0];
    if (!row) return null;

    await tx.$executeRawUnsafe(`DELETE FROM "ContentBundle" WHERE version = $1`, version);
    return row;
  });
}

/**
 * The explicit, audited cleanup path: steps 1-5 of §7.7.
 *
 * The ORDERING is the part that matters. The metadata row is deleted and
 * COMMITTED FIRST; the file is deleted ONLY AFTER that commit succeeds.
 * Deleting the file first is forbidden, because its failure mode is the
 * unacceptable one — a rollback that committed nothing, leaving a referenced
 * bundle whose file is gone.
 *
 * | Failure point        | Outcome                                          |
 * | crash before step 4  | rollback; row and file both intact               |
 * | crash between 4 and 5| orphaned file, no row — harmless, reconcilable   |
 * | file delete fails    | the same orphan; logged, retried by reconcile    |
 *
 * An orphaned file wastes disk. A missing referenced file breaks an activity
 * that cannot be recovered. The asymmetry is deliberate.
 */
export async function deleteUnreferencedBundle(
  prisma: PrismaClient,
  version: string,
  log: ContentAuditLog = defaultAuditLog,
): Promise<BundleRemoval | null> {
  const removed = await deleteBundleMetadata(prisma, version);
  if (!removed) return null;

  let fileDeleted = true;
  try {
    await deleteBundleFileAt(removed.location);
  } catch {
    // The row is already gone, so the bundle is unreachable either way. What
    // is left is an orphaned file, which reconciliation removes.
    fileDeleted = false;
  }

  const result: BundleRemoval = { ...removed, fileDeleted };
  log({ kind: 'bundle-deleted', ...result });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation (§7.7) — run on a schedule and after any restore
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconciliationReport {
  /** Orphans from a crash between steps 4 and 5. Safe to remove; logged. */
  readonly orphanedFilesRemoved: readonly string[];
  /** Rows whose artifact is missing. NEVER resolved by deleting the row. */
  readonly missingArtifacts: readonly string[];
}

/**
 * The asymmetry, stated as code (test C8):
 *
 * | Finding                       | Action                                  |
 * | file with no ContentBundle row| remove it and log                       |
 * | row with no file              | P1 INCIDENT; do not delete the row      |
 *
 * There is no branch here that deletes a `ContentBundle` row. That is not an
 * oversight to be helpfully corrected later: a missing artifact means a
 * referenced bundle lost its file, and removing the row would turn recoverable
 * data loss into unrecoverable data loss.
 */
export async function reconcileBundleArtifacts(
  prisma: PrismaClient,
  directory: string,
  log: ContentAuditLog = defaultAuditLog,
): Promise<ReconciliationReport> {
  const rows = await prisma.contentBundle.findMany({ select: { version: true, location: true } });
  const known = new Map(rows.map((row) => [row.version, row.location]));

  const orphanedFilesRemoved: string[] = [];
  for (const version of await listBundleFiles(directory)) {
    if (known.has(version)) continue;
    const path = bundleFilePath(directory, version);
    await deleteBundleFileAt(path);
    orphanedFilesRemoved.push(version);
    log({ kind: 'orphan-file-removed', version, path });
  }

  const missingArtifacts: string[] = [];
  for (const [version, location] of known) {
    const present = await stat(location).then(
      (entry) => entry.isFile(),
      () => false,
    );
    if (present) continue;
    missingArtifacts.push(version);
    log({ kind: 'missing-artifact', version, location });
  }

  return {
    orphanedFilesRemoved: orphanedFilesRemoved.sort(),
    missingArtifacts: missingArtifacts.sort(),
  };
}
