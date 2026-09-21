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
export const definitionSchema = z.looseObject({
  key,
  kind: z.string().min(1),
  /** Keys this definition points at. Reference resolution checks them (§10.2). */
  references: z.array(key).default([]),
  /** Optional probability, range-checked at 0..1 (§10.2). */
  probability: z.number().min(0).max(1).optional(),
  /** Optional non-negative magnitude. Negative damage is a validation error,
   *  not a balance decision. */
  magnitude: z.number().min(0).optional(),
  // Kind-specific payloads (region, atlas-marker, hunt) ride along and are
  // parsed by their own schema in parseTyped. Phase 0B's two shared fields
  // stay the contract every kind satisfies.
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — the world the first slice renders (Phase 1 spec §10.1)
// ─────────────────────────────────────────────────────────────────────────────

/** An asset id, resolved through the manifest. Content NEVER names a file:
 *  swapping placeholder art for real art must not touch a content key or a
 *  gameplay rule (§11). */
const assetId = z.string().regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)+$/, {
  message: 'must be a dotted lowercase asset id, e.g. atlas.region.rookgaard',
});

const availability = z.enum(['AVAILABLE', 'LOCKED']);

/** A rectangle in Atlas space. The Atlas has its own coordinate system; it is
 *  not geography and there is no projection. */
const bounds = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const regionSchema = definitionSchema.extend({
  kind: z.literal('region'),
  label: z.string().min(1),
  availability,
  atlas: bounds,
  minZoom: z.number().positive(),
  maxZoom: z.number().positive(),
  backdropAssetId: assetId,
});

/** Categories Phase 5+ will author. Phase 1 authors only HUNT, but the schema
 *  accepts the others so adding one later is content, not a migration. */
export const markerCategory = z.enum(['HUNT', 'DUNGEON', 'NPC', 'SERVICE']);

export const atlasMarkerSchema = definitionSchema.extend({
  kind: z.literal('atlas-marker'),
  label: z.string().min(1),
  category: markerCategory,
  region: key,
  position: z.object({ x: z.number(), y: z.number() }),
  target: key,
  iconAssetId: assetId,
  availability,
});

export const huntSchema = definitionSchema.extend({
  kind: z.literal('hunt'),
  label: z.string().min(1),
  region: key,
  summary: z.string().min(1),
  /** A LABEL. Phase 1 has no creature definition, no stats and no loot. */
  primaryCreature: z.string().min(1),
  /** Must resolve in the activity type registry — checked at build time. */
  activityTypeKey: z.string().min(1),
  availability,
});

export type Region = z.infer<typeof regionSchema>;
export type AtlasMarker = z.infer<typeof atlasMarkerSchema>;
export type Hunt = z.infer<typeof huntSchema>;

/** Parse a definition into its kind-specific shape, or return null when the
 *  kind carries no extra payload (Phase 0B's `placeholder`). */
export function parseTyped(definition: Definition): Region | AtlasMarker | Hunt | null {
  switch (definition.kind) {
    case 'region':
      return regionSchema.parse(definition);
    case 'atlas-marker':
      return atlasMarkerSchema.parse(definition);
    case 'hunt':
      return huntSchema.parse(definition);
    default:
      return null;
  }
}

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
