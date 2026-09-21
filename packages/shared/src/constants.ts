/**
 * Domain constants (§7.4). Referenced everywhere, never re-typed as a literal:
 * a magic number in two places is a magic number that will disagree with
 * itself.
 */
import { hours, minutes, type DurationMs } from './time.js';

/** ADR-014 — Stamina is capped at 42 hours. */
export const STAMINA_MAX: DurationMs = hours(42);

/** The rate boundary within Stamina recovery (ACTIVITY_OCCUPANCY_AND_TIMERS.md §3.1). */
export const STAMINA_RECOVERY_BOUNDARY: DurationMs = hours(39);

/** ADR-008 — a disconnected session keeps its claim for this long. */
export const RECONNECT_GRACE: DurationMs = minutes(5);

/** §8.3 — serialization failures retry a bounded number of times, so a
 *  pathological case surfaces instead of spinning. */
export const MAX_SERIALIZATION_RETRIES = 3;

/** DOMAIN_MODEL.md §5.4 — LOCKED BY PRODUCT. */
export const ROSTER_CAPACITY_MIN = 1;
export const ROSTER_CAPACITY_MAX = 5;

/** ADR-005 — Active Party size. */
export const ACTIVE_PARTY_MIN = 1;
export const ACTIVE_PARTY_MAX = 4;

// ─────────────────────────────────────────────────────────────────────────────
// Vocabularies that CONTENT and CODE must agree on (Phase 1 §10.2)
//
// Content is validated at build time by `@global-idle/game-data`, which may
// not import the domain or an app — so the names it checks against have to
// live somewhere both sides can see. That is here, and ONLY the names are
// here. What an activity type DOES (its family, its Stamina classification)
// stays in the domain registry, and what an asset LOOKS LIKE stays in the web
// app's manifest. A list of names is not a second source of truth; a list of
// behaviours would be.
//
// Neither list is allowed to drift: the domain registry asserts at startup
// that it describes exactly these keys, and the web manifest is typed to
// require an entry for exactly these ids.
// ─────────────────────────────────────────────────────────────────────────────

/** Every activity type content may name. The domain describes each one. */
export const ACTIVITY_TYPE_KEYS = ['hunt', 'skill-training'] as const;
export type KnownActivityTypeKey = (typeof ACTIVITY_TYPE_KEYS)[number];

/**
 * Every asset id content may name (§11).
 *
 * The indirection is the point: content says `marker.hunt`, the manifest says
 * what that draws. Real art replaces the manifest and no content key, rule or
 * component changes.
 */
export const ASSET_IDS = [
  'atlas.region.rookgaard',
  'atlas.region.locked',
  'marker.hunt',
  'portrait.character',
] as const;
export type KnownAssetId = (typeof ASSET_IDS)[number];
