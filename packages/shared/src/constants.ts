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
