/**
 * Resolving a Hunt from a PINNED bundle (Phase 1 spec §9.5, §10.2).
 *
 * This lives in the domain rather than in `game-data` for one reason: the
 * activity-type registry is here, and a hunt definition is only valid if its
 * `activityTypeKey` is a type this build actually runs. `game-data` cannot see
 * the registry without depending on the domain, which is the wrong direction.
 *
 * The database checks a content key's SHAPE. Only this can check its KIND,
 * because kind is a fact in a bundle, not in a table.
 */
import { huntSchema, type Hunt } from '@global-idle/game-data';
import type { ContentKey, ContentVersion } from '@global-idle/shared';
// Through the activity context's PUBLIC surface (§4.1). Reaching into
// contexts/activity/types/registry.js is a cross-context violation, which the
// boundary gate caught rather than a reviewer having to.
import { describe } from '../activity/index.js';
import { activityTypeKey as toActivityTypeKey } from '@global-idle/shared';
import { contentKindMismatch, huntNotFound } from '../../platform/errors/index.js';
import type { ContentBundleResolver } from '@global-idle/game-data';

export interface ResolvedHunt {
  readonly key: ContentKey;
  readonly contentVersion: ContentVersion;
  readonly label: string;
  readonly summary: string;
  readonly primaryCreature: string;
  readonly region: string;
  readonly availability: 'AVAILABLE' | 'LOCKED';
  readonly activityTypeKey: string;
}

/**
 * Resolve `key` in the bundle `version` pins, and prove it is a runnable Hunt.
 *
 * Four refusals, each with its own reason, because "not found" and "found but
 * wrong" are different bugs:
 *
 * - the key is absent from THAT bundle            -> HuntNotFound
 * - it resolves to something that is not a hunt   -> ContentKindMismatch
 * - its activityTypeKey is not in the registry    -> ContentKindMismatch
 * - it is LOCKED                                  -> HuntNotFound
 *
 * The version is the ACTIVITY'S OWN, never "the current bundle": an Activity
 * started against older content must stay readable, which ADR-016 guarantees
 * by never collecting a referenced bundle.
 */
export async function resolveHunt(
  resolver: ContentBundleResolver,
  version: ContentVersion,
  key: ContentKey,
): Promise<ResolvedHunt> {
  const bundle = await resolver.resolve(version);
  const definition = bundle.definitions.get(key);
  if (!definition) throw huntNotFound({ contentVersion: version, contentKey: key });

  if (definition.kind !== 'hunt') {
    throw contentKindMismatch({ contentKey: key, expected: 'hunt', actual: definition.kind });
  }
  const parsed = huntSchema.safeParse(definition);
  if (!parsed.success) {
    throw contentKindMismatch({ contentKey: key, reason: 'malformed hunt definition' });
  }
  const hunt: Hunt = parsed.data;

  if (!describe(toActivityTypeKey(hunt.activityTypeKey))) {
    throw contentKindMismatch({
      contentKey: key,
      reason: 'activityTypeKey is not in the registry',
      activityTypeKey: hunt.activityTypeKey,
    });
  }

  // A LOCKED hunt is not startable. It is reported as NOT FOUND rather than as
  // a distinct code: whether locked content exists is not something an
  // unauthorised caller gets to learn (§19).
  if (hunt.availability !== 'AVAILABLE') {
    throw huntNotFound({ contentVersion: version, contentKey: key });
  }

  return {
    key,
    contentVersion: version,
    label: hunt.label,
    summary: hunt.summary,
    primaryCreature: hunt.primaryCreature,
    region: hunt.region,
    availability: hunt.availability,
    activityTypeKey: hunt.activityTypeKey,
  };
}
