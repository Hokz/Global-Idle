/**
 * The activity-type registry (§7.3.2). CODE, not a table.
 *
 * WHY CODE. A descriptor's `family` selects WHICH LIFECYCLE CODE PATH RUNS and
 * its `stamina` selects WHICH MODE DERIVATION APPLIES. Those are behaviour,
 * and behaviour is versioned with the code that implements it. A table would
 * let an UPDATE change which code path an existing row takes, with no review
 * and no deploy — a second, mutable source of truth for something the code has
 * to agree with anyway.
 *
 * WHY NOT ADR-011 CONTENT. ADR-011 governs the definitions a type CONSUMES:
 * creatures, loot, encounter tables, a Dungeon's floors. Which KIND of
 * activity exists, and how it occupies and consumes, is not content; it is the
 * shape of the system. A future Dungeon's floors are content; the Dungeon TYPE
 * is a descriptor.
 */
import type { ActivityTypeKey } from '@global-idle/shared';
import { ACTIVITY_TYPE_KEYS, activityTypeKey } from '@global-idle/shared';

export type ActivityFamily = 'SESSION_BOUND' | 'WALL_CLOCK';

export type StaminaClassification = 'STAMINA_CONSUMING' | 'STAMINA_RECOVERY_ELIGIBLE';

export interface ActivityTypeDescriptor {
  readonly key: ActivityTypeKey;
  readonly family: ActivityFamily;
  /** REQUIRED. No default exists: an undeclared type is rejected, never
   *  silently assumed either way (ACTIVITY_OCCUPANCY_AND_TIMERS.md §3.2). */
  readonly stamina: StaminaClassification;
  /** Every activity occupies its Characters (ADR-013). Occupancy is NOT
   *  consumption: Skill Training occupies AND is recovery-eligible. */
  readonly occupiesCharacter: true;
}

export const HUNT = activityTypeKey('hunt');
export const SKILL_TRAINING = activityTypeKey('skill-training');

/**
 * Phase 0B registers exactly the two types whose classification the accepted
 * documents state.
 *
 * DUNGEON IS DELIBERATELY ABSENT. No accepted document classifies it for
 * Stamina: ACTIVITY_OCCUPANCY_AND_TIMERS.md names Hunt as the consuming
 * activity throughout, and Dungeon is given a classification nowhere. Its
 * family membership IS settled (DOMAIN_MODEL.md §5.6 lists it as
 * session-bound), but a settled family is not a settled classification.
 * Deciding it here would be a product rule invented by a technical module.
 * The omission is safe because a descriptor missing `stamina` fails validation
 * and the process refuses to start (test T12).
 */
const DESCRIPTORS: readonly ActivityTypeDescriptor[] = Object.freeze([
  Object.freeze({
    key: HUNT,
    family: 'SESSION_BOUND',
    stamina: 'STAMINA_CONSUMING',
    occupiesCharacter: true,
  } as const),
  Object.freeze({
    key: SKILL_TRAINING,
    family: 'WALL_CLOCK',
    stamina: 'STAMINA_RECOVERY_ELIGIBLE',
    occupiesCharacter: true,
  } as const),
]);

export const ACTIVITY_TYPES: ReadonlyMap<ActivityTypeKey, ActivityTypeDescriptor> = Object.freeze(
  new Map(DESCRIPTORS.map((descriptor) => [descriptor.key, descriptor])),
);

export function describe(key: ActivityTypeKey): ActivityTypeDescriptor | undefined {
  return ACTIVITY_TYPES.get(key);
}

export class ActivityTypeRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityTypeRegistryError';
  }
}

const FAMILIES: ReadonlySet<string> = new Set<ActivityFamily>(['SESSION_BOUND', 'WALL_CLOCK']);
const CLASSIFICATIONS: ReadonlySet<string> = new Set<StaminaClassification>([
  'STAMINA_CONSUMING',
  'STAMINA_RECOVERY_ELIGIBLE',
]);

/**
 * Schema-check every descriptor at startup (test T12). A descriptor missing
 * `stamina` — or carrying anything but a known value — makes the process
 * REFUSE TO START. That is the only way "undeclared is rejected" is true in
 * practice: a new activity type cannot be added by forgetting to classify it.
 */
export function validateRegistry(
  descriptors: Iterable<Partial<ActivityTypeDescriptor>> = ACTIVITY_TYPES.values(),
): void {
  const seen = new Set<string>();
  for (const descriptor of descriptors) {
    const key = descriptor.key;
    if (typeof key !== 'string' || key.length === 0) {
      throw new ActivityTypeRegistryError('An activity type descriptor has no key.');
    }
    if (seen.has(key)) {
      throw new ActivityTypeRegistryError(`Duplicate activity type key: ${key}`);
    }
    seen.add(key);
    if (!descriptor.family || !FAMILIES.has(descriptor.family)) {
      throw new ActivityTypeRegistryError(
        `Activity type "${key}" has no valid family. Got: ${String(descriptor.family)}`,
      );
    }
    if (!descriptor.stamina || !CLASSIFICATIONS.has(descriptor.stamina)) {
      throw new ActivityTypeRegistryError(
        `Activity type "${key}" is missing its stamina classification. ` +
          'An undeclared type is rejected, never defaulted ' +
          '(ACTIVITY_OCCUPANCY_AND_TIMERS.md §3.2).',
      );
    }
    if (descriptor.occupiesCharacter !== true) {
      throw new ActivityTypeRegistryError(
        `Activity type "${key}" must occupy its Characters (ADR-013).`,
      );
    }
  }
}

/**
 * CONTENT/REGISTRY RECONCILIATION (Phase 1 §10.2).
 *
 * `packages/game-data` validates an authored `activityTypeKey` against
 * `ACTIVITY_TYPE_KEYS` in `@global-idle/shared`, because it may not import
 * this package (§5.2). That list is only worth anything if it cannot drift
 * from the descriptors above — so drift is a BOOT FAILURE. A key content is
 * allowed to name and nothing can run is precisely the failure the pair
 * exists to prevent, and it would otherwise surface as a 500 on a player's
 * first click.
 *
 * Separate from {@link validateRegistry} on purpose: that one validates
 * whatever descriptors it is handed, including the deliberately broken ones a
 * test constructs. This one is about the REAL registry and nothing else.
 */
export function assertRegistryCoversContentVocabulary(): void {
  const undescribed = ACTIVITY_TYPE_KEYS.filter(
    (key) => !ACTIVITY_TYPES.has(key as ActivityTypeKey),
  );
  if (undescribed.length > 0) {
    throw new ActivityTypeRegistryError(
      `ACTIVITY_TYPE_KEYS names ${undescribed.join(', ')}, which no descriptor describes. ` +
        'Content could name an activity type nothing knows how to run.',
    );
  }
}

/**
 * The key set is APPEND-ONLY and a key's family is IMMUTABLE: a change of
 * lifecycle is a new key, never an edit. This snapshot is what a test pins so
 * any change that is not an addition fails (§7.3.2).
 */
export function registrySnapshot(): ReadonlyArray<readonly [string, ActivityFamily]> {
  return [...ACTIVITY_TYPES.values()].map((d) => [d.key, d.family] as const).sort();
}
