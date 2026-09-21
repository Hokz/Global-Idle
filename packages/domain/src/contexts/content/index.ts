// Public surface of the durable half of the Content bounded context
// (ADR-001, ADR-011, ADR-016, §7.7).
//
// This file is the ONLY legal entry point. Reaching past it into bundles.ts is
// a dependency-cruiser violation, inside this package as much as across it
// (§5.2, tests W8 and W11).
//
// Content DEFINITIONS live in `packages/game-data` — build-time, versioned and
// read-only at runtime, which is why that context is a separate package
// (§4.1). What lives here is the `ContentBundle` metadata rows: publication,
// the derived pinned set, the audited cleanup path and the reconciliation job.
// 0B.7 places them in `packages/domain` because they touch durable rows and
// `game-data` may not import Prisma.
export const CONTEXT_NAME = 'content' as const;

export { resolveHunt } from './hunts.js';
export type { ResolvedHunt } from './hunts.js';

export {
  assertCurrentBundleAvailable,
  defaultAuditLog,
  createResolver,
  currentVersion,
  deleteBundleMetadata,
  deleteUnreferencedBundle,
  isPinned,
  pinnedVersions,
  publish,
  reconcileBundleArtifacts,
  unreferencedVersions,
} from './bundles.js';
export type {
  BundleRemoval,
  ContentAuditEvent,
  ContentAuditLog,
  PublishedBundle,
  ReconciliationReport,
} from './bundles.js';
