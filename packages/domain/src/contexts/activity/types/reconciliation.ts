/**
 * Registry <-> database reconciliation (§7.3.2). INTERNAL to the activity
 * context.
 *
 * Every persisted `Activity.activityTypeKey` must be a key the code registry
 * knows, carrying the family the registry says it has. A key the code no
 * longer knows, or a family it disagrees with, makes the process REFUSE TO
 * START — the same fail-fast path as T12, so `/health/ready`'s four conditions
 * are unchanged and readiness is simply never reached.
 *
 * Removing or reclassifying a type that has persisted rows is therefore a
 * fail-fast event, not a silent drift.
 */
import { activityTypeKey } from '@global-idle/shared';
import { activityIntegrityViolation } from '../../../platform/errors/index.js';
import type { UnitOfWork } from '../../../platform/transaction/index.js';
import { ACTIVITY_TYPES, validateRegistry } from './registry.js';

export async function assertRegistryMatchesDatabase(tx: UnitOfWork): Promise<void> {
  // Schema-check the descriptors first: a malformed registry is a bug in the
  // code, and reporting it as a data problem would send someone to the wrong
  // place.
  validateRegistry();

  const rows = await tx.$queryRawUnsafe<{ activityTypeKey: string; family: string }[]>(
    `SELECT DISTINCT "activityTypeKey", "family"::text AS family FROM "Activity"`,
  );

  const problems: string[] = [];
  for (const row of rows) {
    const descriptor = ACTIVITY_TYPES.get(activityTypeKey(row.activityTypeKey));
    if (!descriptor) {
      problems.push(
        `persisted activity type "${row.activityTypeKey}" is not in the registry — ` +
          'a type with persisted rows cannot be removed',
      );
      continue;
    }
    if (descriptor.family !== row.family) {
      problems.push(
        `persisted activity type "${row.activityTypeKey}" has family ${row.family}, ` +
          `but the registry says ${descriptor.family} — a key's family is immutable`,
      );
    }
  }

  if (problems.length > 0) {
    // The problems go in the MESSAGE, not only the details bag. An error that
    // hides its cause behind a structured field is an error someone reads at
    // 3am and learns nothing from.
    throw activityIntegrityViolation({ problems }, problems.join('; '));
  }
}
