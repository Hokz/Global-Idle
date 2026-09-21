/**
 * Content schemas (§10.1). Phase 0B defines the SHAPE and the pipeline, not
 * the content: no creature, item or hunt definitions are authored here (§10.3,
 * §19).
 */
import { z } from 'zod';
import { isContentKey } from './keys.js';

const key = z.string().refine(isContentKey, {
  message: 'must be a lowercase dot-separated content key, e.g. creature.rookgaard.rat',
});

/** A definition is anything addressable by a canonical key. Phase 0B carries
 *  the two fields every kind shares and nothing else. */
export const definitionSchema = z.object({
  key,
  kind: z.string().min(1),
  /** Keys this definition points at. Reference resolution checks them (§10.2). */
  references: z.array(key).default([]),
  /** Optional probability, range-checked at 0..1 (§10.2). */
  probability: z.number().min(0).max(1).optional(),
  /** Optional non-negative magnitude. Negative damage is a validation error,
   *  not a balance decision. */
  magnitude: z.number().min(0).optional(),
});

/**
 * An unlock set. The Powerful Imbuement set must contain EXACTLY FIVE keys
 * (§10.2, ACTIVITY_OCCUPANCY_AND_TIMERS.md §6.2, test C5).
 */
export const unlockSetSchema = z.object({
  key,
  members: z.array(key),
});

export const bundleSourceSchema = z.object({
  /** Human-readable label. The VERSION is computed at build time from the
   *  content, never authored — see build.ts. */
  name: z.string().min(1),
  definitions: z.array(definitionSchema),
  unlockSets: z.array(unlockSetSchema).default([]),
});

export type Definition = z.infer<typeof definitionSchema>;
export type UnlockSet = z.infer<typeof unlockSetSchema>;
export type BundleSource = z.infer<typeof bundleSourceSchema>;

/** A built bundle: immutable, versioned as a whole (§7.7). */
export interface ContentBundleArtifact {
  readonly version: string;
  readonly checksum: string;
  readonly name: string;
  readonly definitions: readonly Definition[];
  readonly unlockSets: readonly UnlockSet[];
}
