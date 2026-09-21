/**
 * Bundle build (§10.1). Produces an IMMUTABLE, versioned artifact.
 *
 * The version is COMPUTED FROM THE CONTENT, never authored: two builds of the
 * same content produce the same version, and any change produces a different
 * one. A hand-written version could be reused for different content, which is
 * precisely what pinning exists to prevent (ADR-011).
 */
import { createHash } from 'node:crypto';
import type { BundleSource, ContentBundleArtifact, Definition, UnlockSet } from './schema.js';
import { validateBundleSource } from './validate.js';

/** Stable serialisation: object keys sorted at every depth, so the same
 *  content always hashes the same way regardless of authoring order. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

const byKey = <T extends { key: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/** The one definition of a bundle's checksum. The resolver verifies against
 *  this same function, so a bundle whose bytes drift from its checksum is
 *  refused rather than silently served. */
export function checksumOf(content: {
  name: string;
  definitions: readonly Definition[];
  unlockSets: readonly UnlockSet[];
}): string {
  return createHash('sha256').update(canonical(content)).digest('hex');
}

export class ContentBuildError extends Error {
  constructor(
    message: string,
    readonly issues: readonly { severity: string; check: string; message: string }[],
  ) {
    super(message);
    this.name = 'ContentBuildError';
  }
}

/** Build refuses to produce an artifact from content that does not validate.
 *  An invalid bundle must never reach a pin. */
export function buildBundle(input: unknown): ContentBundleArtifact {
  const result = validateBundleSource(input);
  if (!result.valid || !result.source) {
    throw new ContentBuildError('Content bundle failed validation.', result.issues);
  }

  const source: BundleSource = result.source;
  const definitions: Definition[] = byKey(source.definitions);
  const unlockSets: UnlockSet[] = byKey(source.unlockSets);

  const checksum = checksumOf({ name: source.name, definitions, unlockSets });

  return {
    // The version IS the content's identity. A short prefix keeps it readable
    // without making two different bundles share one.
    version: `v${checksum.slice(0, 16)}`,
    checksum,
    name: source.name,
    definitions,
    unlockSets,
  };
}
