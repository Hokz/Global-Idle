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
  /**
   * PHYSICAL loot — Phase 3. Separate from `gold` above on purpose: a Rat kill
   * produces two settlements of different kinds, a currency credit and, some
   * of the time, an item. The Rat's whole table is one entry (source map §2).
   */
  loot: z
    .array(
      z.object({
        itemKey: key,
        chance: z.number().min(0).max(1),
        min: z.number().int().positive().default(1),
        max: z.number().int().positive().default(1),
      }),
    )
    .default([]),
  /** Recorded so a later phase does not have to re-source them. Unused in
   *  Phase 2, which is physical-only. */
  elements: z.record(z.string(), z.number()).default({}),
  immunities: z.array(z.string()).default([]),
  sourceRef,
});

// ─────────────────────────────────────────────────────────────────────────────────
// Phase 3 — real items (Phase 3 spec §2)
//
// `ItemDefinition` is CONTENT, for the same reason a creature is: it is
// authored, identical for everyone, and a retune must be a publish rather than
// a migration. What an individual item IS lives here; what a particular one
// has become lives in the database as an `ItemInstance`.
//
// Phase 2's `combat-profile` kind is GONE. Combat inputs now come from what the
// Character is wearing, which is the whole point of this phase.
// ─────────────────────────────────────────────────────────────────────────────────

/** The ONE rarity vocabulary. There is no `Epic` and no second enum. */
export const rarity = z.enum(['COMMON', 'SEMI_RARE', 'RARE', 'MYSTIC', 'LEGENDARY', 'STELLAR']);

export const itemCategory = z.enum(['FOOD', 'POTION', 'EQUIPMENT', 'CONTAINER', 'VALUABLE']);

/** `Slots_t`, imported whole so a later amulet or ring is content, not a
 *  migration (source map §7). Phase 3 implements the six the tutorial uses. */
export const equipmentSlot = z.enum([
  'HEAD',
  'NECKLACE',
  'BACKPACK',
  'ARMOR',
  'RIGHT',
  'LEFT',
  'LEGS',
  'FEET',
  'RING',
  'AMMO',
]);

/** The affixes Phase 3 can actually apply. Deliberately two: enough to prove
 *  generation, persistence, a combat effect and non-merging; not an affix
 *  system this phase does not own. */
export const affixKind = z.enum(['ARMOR_PLUS', 'ATTACK_PLUS']);

export const itemSchema = definitionSchema.extend({
  kind: z.literal('item'),
  label: z.string().min(1),
  /** The Canary item id this came from, so a reviewer can find it again. */
  sourceId: z.number().int().positive(),
  category: itemCategory,
  /** HUNDREDTHS of an ounce — the source's own unit, and the one Capacity is
   *  compared in. */
  weight: z.number().int().nonnegative(),
  stackable: z.boolean(),
  /** 1 for a non-stackable, 255 for an ordinary stackable (spec §4). */
  maxStack: z.number().int().positive().max(255),
  stashEligible: z.boolean().default(false),
  sellable: z.boolean().default(false),
  rarityEligible: z.boolean().default(false),
  slot: equipmentSlot.optional(),
  containerSpaces: z.number().int().positive().optional(),
  combat: z
    .object({
      armor: z.number().int().nonnegative().optional(),
      attack: z.number().nonnegative().optional(),
      defense: z.number().int().nonnegative().optional(),
    })
    .optional(),
  /** What drinking one restores. A supply CHARGE is now a real item in a real
   *  container, so the number of charges is however many are carried. */
  heal: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).optional(),
  trade: z
    .object({
      /** What a counter CHARGES the player (source `buy`). */
      buyPrice: z.number().int().positive().optional(),
      /** What a counter PAYS the player (source `sell`). */
      sellPrice: z.number().int().positive().optional(),
    })
    .optional(),
  sourceRef,
});

/**
 * How rarity is rolled, and how many affixes each tier carries.
 *
 * INITIAL/TUNABLE and deliberately conservative. Weights are relative, so
 * "exponentially rarer" is a property of the authored numbers rather than a
 * formula in code — which is what makes retuning a content publish.
 */
export const rarityTableSchema = definitionSchema.extend({
  kind: z.literal('rarity-table'),
  label: z.string().min(1),
  tiers: z
    .array(
      z.object({
        rarity,
        weight: z.number().positive(),
        affixes: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  affixes: z
    .array(
      z.object({
        affix: affixKind,
        min: z.number().int().positive(),
        max: z.number().int().positive(),
      }),
    )
    .min(1),
});

/** The five top-level Hunt Container Slots and what they cost (spec §3.1). */
export const containerSlotsSchema = definitionSchema.extend({
  kind: z.literal('container-slots'),
  label: z.string().min(1),
  /** Exactly five, and slot 1 costs nothing. LOCKED. */
  prices: z
    .array(z.object({ slot: z.number().int().min(1).max(5), gold: z.number().int().nonnegative() }))
    .length(5),
});

/**
 * The Character's own combat facts — and ONLY those.
 *
 * This is deliberately not Phase 2's `combat-profile` under a new name. It
 * carries what belongs to the Character and its vocation: maximum health, the
 * weapon skill, the attack factor, the attack interval, and the value an
 * EMPTY hand attacks with. It carries no armour, no attack value, no defence
 * and no supply charges, because every one of those now comes from an item the
 * Character is actually wearing or carrying. A test asserts the absence.
 */
export const characterBaselineSchema = definitionSchema.extend({
  kind: z.literal('character-baseline'),
  label: z.string().min(1),
  maxHealth: z.number().int().positive(),
  attackSkill: z.number().int().positive(),
  attackFactor: z.number().positive(),
  attackIntervalMs: z.number().int().positive(),
  /** `Weapon::useFist` — an empty hand attacks with 7 and rolls from zero. */
  unarmedAttackValue: z.number().int().positive(),
  /** Below this fraction of health, a carried supply is drunk. Behaviour, not
   *  an item stat: the item says how much it heals. */
  supplyUseBelowPercent: z.number().min(0).max(100),
  /** `vocation basespeed` (`data/XML/vocations.xml`). A Character's step speed
   *  is this plus `level - 1`, exactly as `Player::updateBaseSpeed` computes
   *  it, and the step duration follows from the source's log curve. */
  baseSpeed: z.number().int().positive(),
  sourceRef,
});

/**
 * What a new Character is given before its first Hunt.
 *
 * Canary's pre-vocation kit is four armour pieces and NOTHING else — no
 * container and no weapon (source map §11). A Character with no container
 * cannot carry loot and a Character with no weapon measurably loses to a Rat,
 * so Global Idle grants a backpack, a dagger and potions as well. Every item is
 * a real source item with real source stats; what is adapted is WHEN they are
 * given, and this definition is where that adaptation is visible.
 */
export const startingGrantSchema = definitionSchema.extend({
  kind: z.literal('starting-grant'),
  label: z.string().min(1),
  /** Worn from the first moment. */
  equipped: z.array(z.object({ itemKey: key, slot: equipmentSlot })).default([]),
  /** The container installed in Container Slot 1. */
  container: key,
  /** Placed inside that container. */
  contents: z.array(z.object({ itemKey: key, quantity: z.number().int().positive() })).default([]),
  sourceRef,
});

/** One service counter. Not an NPC, not a chat tree, not a city (spec §13). */
export const serviceSchema = definitionSchema.extend({
  kind: z.literal('service'),
  label: z.string().min(1),
  region: key,
  buys: z.array(z.object({ itemKey: key, price: z.number().int().positive() })).default([]),
  sells: z.array(z.object({ itemKey: key, price: z.number().int().positive() })).default([]),
  sourceRef,
});

export const huntRoomSchema = z.object({
  number: z.number().int().positive(),
  creatures: z.array(z.object({ key, count: z.number().int().positive() })).min(1),
  /** Exactly one room — the last — loops forever. */
  endless: z.boolean().default(false),
});

/**
 * A tile map, as a human writes it (Phase 3.5 §7).
 *
 * Rows of characters, a legend, regions that name which Phase 2 room they ARE,
 * and the tiles creatures stand on. Readable in a diff, validated at build
 * time, and compiled once into flat arrays for the runtime — static map data
 * never becomes mutable database state.
 */
export const mapRegionSchema = z
  .object({
    id: z.string().min(1),
    /** `[x, y, width, height]`, inclusive of the origin. */
    rect: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
    room: z.number().int().min(1),
    spawns: z.array(z.object({ x: z.number().int().min(0), y: z.number().int().min(0) })).min(1),
  })
  .strict();

const tileRef = z
  .object({ x: z.number().int().min(0), y: z.number().int().min(0), z: z.number().int() })
  .strict();

export const mapConnectorSchema = z
  .object({
    from: tileRef,
    to: tileRef,
    kind: z.enum(['STAIRS_UP', 'STAIRS_DOWN', 'LADDER']),
  })
  .strict();

export const mapSchema = definitionSchema.extend({
  kind: z.literal('map'),
  label: z.string().min(1),
  z: z.number().int(),
  rows: z.array(z.string().min(1)).min(1),
  legend: z.record(z.string().length(1), z.enum(['floor', 'wall', 'water', 'sludge'])),
  entry: z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }),
  regions: z.array(mapRegionSchema).min(1),
  /**
   * Floor links — the SEAM, not a dungeon (Phase 3.5 §6).
   *
   * Declaring the shape now is what lets a later phase add a second floor
   * without migrating every published map. The live Sewers declare none.
   */
  connectors: z.array(mapConnectorSchema).optional(),
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
  /** Phase 3 — the starting grant a Character receives before its first Hunt,
   *  if this Hunt is the tutorial one. Real items, in real slots. */
  startingGrant: key.optional(),
  /** The Character's own combat facts. Armour, attack and defence are NOT here
   *  — they come from what is equipped. */
  characterBaseline: key.optional(),
  /** Phase 3.5 — the tile map this Hunt is fought ON. Absent means the Hunt is
   *  still the abstract Phase 2 encounter counter, which is what every Phase 2
   *  fixture expects and why this is optional rather than required. */
  map: key.optional(),
});

export type Region = z.infer<typeof regionSchema>;
export type AtlasMarker = z.infer<typeof atlasMarkerSchema>;
export type Hunt = z.infer<typeof huntSchema>;
export type MapDefinition = z.infer<typeof mapSchema>;
export type HuntRoom = z.infer<typeof huntRoomSchema>;
export type Creature = z.infer<typeof creatureSchema>;
export type ItemDefinition = z.infer<typeof itemSchema>;
export type RarityTable = z.infer<typeof rarityTableSchema>;
export type ContainerSlots = z.infer<typeof containerSlotsSchema>;
export type ServiceDefinition = z.infer<typeof serviceSchema>;
export type StartingGrant = z.infer<typeof startingGrantSchema>;
export type CharacterBaseline = z.infer<typeof characterBaselineSchema>;
export type Rarity = z.infer<typeof rarity>;
export type ItemCategory = z.infer<typeof itemCategory>;
export type EquipmentSlot = z.infer<typeof equipmentSlot>;
export type AffixKind = z.infer<typeof affixKind>;

/** Parse a definition into its kind-specific shape, or return null when the
 *  kind carries no extra payload (Phase 0B's `placeholder`). */
export function parseTyped(
  definition: Definition,
):
  | Region
  | AtlasMarker
  | Hunt
  | Creature
  | ItemDefinition
  | RarityTable
  | ContainerSlots
  | ServiceDefinition
  | StartingGrant
  | CharacterBaseline
  | null {
  switch (definition.kind) {
    case 'region':
      return regionSchema.parse(definition);
    case 'atlas-marker':
      return atlasMarkerSchema.parse(definition);
    case 'hunt':
      return huntSchema.parse(definition);
    case 'creature':
      return creatureSchema.parse(definition);
    case 'item':
      return itemSchema.parse(definition);
    case 'rarity-table':
      return rarityTableSchema.parse(definition);
    case 'container-slots':
      return containerSlotsSchema.parse(definition);
    case 'service':
      return serviceSchema.parse(definition);
    case 'starting-grant':
      return startingGrantSchema.parse(definition);
    case 'character-baseline':
      return characterBaselineSchema.parse(definition);
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
