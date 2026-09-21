// The Content bounded context (ADR-001, ADR-011, §10).
//
// Build-time, versioned and read-only at runtime, which is why it is its own
// package rather than a directory under domain. It imports no app, no engine,
// no domain and no framework (§5.2).
export const GAME_DATA_PACKAGE = '@global-idle/game-data' as const;

export { contentKey, isContentKey, keyNamespace } from './keys.js';
export type { ContentKey } from './keys.js';

export { bundleSourceSchema, definitionSchema, unlockSetSchema } from './schema.js';
export type { BundleSource, ContentBundleArtifact, Definition, UnlockSet } from './schema.js';

export { POWERFUL_IMBUEMENT_SET_SIZE, validateBundleSource } from './validate.js';
export type { ValidationIssue, ValidationResult } from './validate.js';

export { ContentBuildError, buildBundle, canonical, checksumOf } from './build.js';

export {
  ContentBundleCorrupt,
  ContentBundleNotAvailable,
  bundleFilePath,
  createFilesystemResolver,
  deleteBundleFile,
  deleteBundleFileAt,
  listBundleFiles,
  writeBundle,
} from './resolver.js';
export type { ContentBundleResolver, ResolvedBundle } from './resolver.js';
