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

// ─────────────────────────────────────────────────────────────────────────────────
// Phase 2 — what a Hunt actually simulates (Phase 2 spec §5)
//
// Every numeric field below has a citation in PHASE_2_CANARY_SOURCE_MAP.md.
// `sourceRef` carries it into the content itself, so a value cannot drift from
// its provenance by being edited in isolation.
// ─────────────────────────────────────────────────────────────────────────────────

const sourceRef = z.string().min(1);

export const creatureSchema = definitionSchema.extend({
  kind: z.literal('creature'),
  label: z.string().min(1),
  maxHealth: z.number().int().positive(),
  experience: z.number().int().nonnegative(),
  attack: z.object({
    intervalMs: z.number().int().positive(),
    /** Canary authors this negative; content stores the magnitude. */
    maxDamage: z.number().int().nonnegative(),
  }),
  defense: z.number().int().nonnegative(),
  armor: z.number().int().nonnegative(),
  /** Percent, as `Creature::mitigateDamage` uses it. */
  mitigation: z.number().nonnegative(),
  speed: z.number().int().nonnegative(),
  /** The currency a kill yields. NOT a loot table — Phase 3 owns loot,
   *  `BaseItem` and `ItemInstance`; this is the Gold the same entry produces. */
  gold: z
    .object({
      chance: z.number().min(0).max(1),
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
    })
    .refine((gold) => gold.min <= gold.max, { message: 'gold.min must not exceed gold.max' }),
  /** Recorded so a later phase does not have to re-source them. Unused in
   *  Phase 2, which is physical-only. */
  elements: z.record(z.string(), z.number()).default({}),
  immunities: z.array(z.string()).default([]),
  sourceRef,
});

/**
 * The Character's combat INPUTS — not an item, not equipment, not an
 * inventory.
 *
 * Phase 2 needs a Level-1 pre-vocation Character that can actually fight, and
 * measurement says fists cannot (source map §4). This is the smallest honest
 * way to have a starting weapon without building Phase 3's itemization, and
 * **Phase 3 replaces it** with what the Character is really wearing.
 */
export const combatProfileSchema = definitionSchema.extend({
  kind: z.literal('combat-profile'),
  label: z.string().min(1),
  maxHealth: z.number().int().positive(),
  attackSkill: z.number().int().positive(),
  /** ALREADY compensated by the 120% weapon factor (source map §3.3). */
  attackValue: z.number().positive(),
  attackFactor: z.number().positive(),
  attackIntervalMs: z.number().int().positive(),
  defense: z.number().int().nonnegative(),
  armor: z.number().int().nonnegative(),
  supply: z.object({
    charges: z.number().int().nonnegative(),
    healMin: z.number().int().nonnegative(),
    healMax: z.number().int().nonnegative(),
    useBelowPercent: z.number().min(0).max(100),
  }),
  sourceRef,
});

export const huntRoomSchema = z.object({
  number: z.number().int().positive(),
  creatures: z.array(z.object({ key, count: z.number().int().positive() })).min(1),
  /** Exactly one room — the last — loops forever. */
  endless: z.boolean().default(false),
});

export const huntSchema = definitionSchema.extend({
  kind: z.literal('hunt'),
  label: z.string().min(1),
  region: key,
  summary: z.string().min(1),
  /** A LABEL for the details panel. The creatures that actually spawn are in
   *  `rooms`, by key. */
  primaryCreature: z.string().min(1),
  /** Must resolve in the activity type registry — checked at build time. */
  activityTypeKey: z.string().min(1),
  availability,
  /** Phase 2. Absent means a Hunt that cannot be simulated yet, which content
   *  validation refuses for an AVAILABLE hunt. */
  rooms: z.array(huntRoomSchema).optional(),
  /** The Character combat profile this Hunt runs with (Phase 2). */
  combatProfile: key.optional(),
});

export type Region = z.infer<typeof regionSchema>;
export type AtlasMarker = z.infer<typeof atlasMarkerSchema>;
export type Hunt = z.infer<typeof huntSchema>;
export type HuntRoom = z.infer<typeof huntRoomSchema>;
export type Creature = z.infer<typeof creatureSchema>;
export type CombatProfileDefinition = z.infer<typeof combatProfileSchema>;

/** Parse a definition into its kind-specific shape, or return null when the
 *  kind carries no extra payload (Phase 0B's `placeholder`). */
export function parseTyped(
  definition: Definition,
): Region | AtlasMarker | Hunt | Creature | CombatProfileDefinition | null {
  switch (definition.kind) {
    case 'region':
      return regionSchema.parse(definition);
    case 'atlas-marker':
      return atlasMarkerSchema.parse(definition);
    case 'hunt':
      return huntSchema.parse(definition);
    case 'creature':
      return creatureSchema.parse(definition);
    case 'combat-profile':
      return combatProfileSchema.parse(definition);
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
