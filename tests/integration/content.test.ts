// §14.8 — C1 to C9. The content bundle foundation (§7.7, §10, ADR-011, ADR-016).
//
// The load-bearing claim of this file is that a pinned bundle cannot be lost.
// Everything else — validation, versioning, cleanup, reconciliation — exists to
// keep that true, so the cases are written to fail if the protection is ever
// moved from the database back into application code.
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content } from '@global-idle/domain';
import type { ContentAuditEvent } from '@global-idle/domain';
import {
  buildBundle,
  bundleFilePath,
  validateBundleSource,
  writeBundle,
  type BundleSource,
  type ContentBundleArtifact,
} from '@global-idle/game-data';
import type { Instant } from '@global-idle/shared';
import { T0, createClient, seedAccount, seedCharacter, truncateAll } from '../support/db.js';
import {
  NOT_NULL_VIOLATION,
  isForeignKeyRefusal,
  makeBundleDir,
  resolveInFreshProcess,
  sqlStateOf,
} from '../support/content.js';
import { REPO_ROOT } from '../support/repo.js';

const prisma = createClient();
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** The bundle the repository actually ships (§10.3). Reading it here means
 *  these cases also prove the shipped placeholder validates and builds. */
const PLACEHOLDER = JSON.parse(
  await readFile(join(REPO_ROOT, 'packages/game-data/content/placeholder.json'), 'utf8'),
) as BundleSource;

let directory: string;
let events: ContentAuditEvent[];
const log = (event: ContentAuditEvent) => {
  events.push(event);
};

/** Build a distinct bundle, write its artifact, and record it as published —
 *  the file first, then the row, so the state a row without a file describes
 *  is never created by the happy path. */
async function publishBundle(name: string, when: Instant): Promise<ContentBundleArtifact> {
  const artifact = buildBundle({ ...PLACEHOLDER, name });
  await writeBundle(directory, artifact);
  await content.publish(prisma, artifact, directory, when, log);
  return artifact;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** A Hunt: session-bound root plus its subtype. Inserted directly — 0B.7 does
 *  not depend on 0B.6's lifecycle code. */
async function seedHunt(accountId: string, contentVersion: string, state = 'ONLINE_ACTIVE') {
  const id = `hunt-${contentVersion}-${state}`;
  await prisma.activity.create({
    data: {
      id,
      accountId,
      activityTypeKey: 'hunt',
      family: 'SESSION_BOUND',
      contentVersion,
      createdAt: T0,
    },
  });
  await prisma.sessionBoundActivity.create({
    data: {
      activityId: id,
      accountId,
      family: 'SESSION_BOUND',
      state: state as 'ONLINE_ACTIVE' | 'RECONNECT_GRACE_PAUSED' | 'ACTIVITY_ENDED',
      claimHolderSessionId: state === 'ACTIVITY_ENDED' ? null : `session-${id}`,
      rngSeed: 'seed',
    },
  });
  return id;
}

/** A Skill Training: wall-clock root, its single participant, and its subtype. */
async function seedSkillTraining(accountId: string, characterId: string, contentVersion: string) {
  const id = `training-${contentVersion}`;
  await prisma.activity.create({
    data: {
      id,
      accountId,
      activityTypeKey: 'skill-training',
      family: 'WALL_CLOCK',
      contentVersion,
      createdAt: T0,
    },
  });
  await prisma.activityParticipant.create({
    data: { activityId: id, characterId, family: 'WALL_CLOCK', slotIndex: 0 },
  });
  await prisma.skillTrainingActivity.create({
    data: {
      activityId: id,
      family: 'WALL_CLOCK',
      traineeCharacterId: characterId,
      status: 'ACCRUING',
      startedAt: T0,
      lastSettledAt: T0,
    },
  });
  return id;
}

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await makeBundleDir();
  events = [];
});

afterEach(async () => {
  // A scratch directory per case, removed afterwards: a failed run must not
  // leave bundle artifacts behind for the next one to resolve.
  await rm(directory, { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('§14.8 content', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Validation and build (§10.2)
  // ───────────────────────────────────────────────────────────────────────────

  it('C1: an invalid bundle fails validation', () => {
    expect(validateBundleSource(PLACEHOLDER).valid).toBe(true);

    const checks = (source: unknown) =>
      validateBundleSource(source)
        .issues.filter((issue) => issue.severity === 'error')
        .map((issue) => issue.check);

    // A malformed key.
    expect(
      checks({ ...PLACEHOLDER, definitions: [{ key: 'Not A Key', kind: 'placeholder' }] }),
    ).toContain('schema-conformance');

    // A duplicate key.
    const duplicated = PLACEHOLDER.definitions[0]!;
    expect(
      checks({ ...PLACEHOLDER, definitions: [...PLACEHOLDER.definitions, duplicated] }),
    ).toContain('key-uniqueness');

    // A pointer to a definition that does not exist.
    expect(
      checks({
        ...PLACEHOLDER,
        definitions: [
          { key: 'placeholder.node.z', kind: 'placeholder', references: ['a.missing'] },
        ],
        unlockSets: [],
      }),
    ).toContain('reference-resolution');

    // Range sanity: negative magnitude and a probability outside 0..1.
    expect(
      checks({
        ...PLACEHOLDER,
        definitions: [{ key: 'placeholder.node.z', kind: 'placeholder', magnitude: -1 }],
      }),
    ).toContain('schema-conformance');
    expect(
      checks({
        ...PLACEHOLDER,
        definitions: [{ key: 'placeholder.node.z', kind: 'placeholder', probability: 1.5 }],
      }),
    ).toContain('schema-conformance');

    // Orphan detection is a WARNING and does not fail the build: content is
    // often authored ahead of its consumer (§10.2).
    const orphaned = validateBundleSource({
      name: 'orphan',
      definitions: [{ key: 'placeholder.node.lonely', kind: 'placeholder' }],
      unlockSets: [],
    });
    expect(orphaned.valid).toBe(true);
    expect(orphaned.issues.map((issue) => issue.check)).toContain('orphan-detection');

    // And build refuses what validation refuses: an invalid bundle never
    // reaches a pin.
    expect(() => buildBundle({ ...PLACEHOLDER, definitions: [{ key: 'Not A Key' }] })).toThrow(
      /failed validation/,
    );
  });

  it('C2: a bundle builds with a version identifier', () => {
    const built = buildBundle(PLACEHOLDER);

    expect(built.version).toMatch(/^v[0-9a-f]{16}$/);
    expect(built.checksum).toMatch(/^[0-9a-f]{64}$/);

    // The version is COMPUTED FROM THE CONTENT, never authored: the same
    // content always builds to the same version...
    expect(buildBundle(PLACEHOLDER).version).toBe(built.version);
    // ...and it is order-independent, so reshuffling the source file is not a
    // new bundle.
    expect(
      buildBundle({ ...PLACEHOLDER, definitions: [...PLACEHOLDER.definitions].reverse() }).version,
    ).toBe(built.version);
    // ...while any change is a different version. That is what makes a pin a
    // durable reference rather than a label.
    expect(buildBundle({ ...PLACEHOLDER, name: 'other' }).version).not.toBe(built.version);
  });

  it('C5: an unlock set without exactly five keys fails validation', () => {
    const members = PLACEHOLDER.unlockSets[0]!.members;
    expect(members).toHaveLength(5);

    // A sixth definition, so the too-many case is genuinely six DISTINCT
    // members rather than a repeated one.
    const sixth = 'placeholder.node.f';
    const withMembers = (keys: readonly string[]) =>
      validateBundleSource({
        ...PLACEHOLDER,
        definitions: [...PLACEHOLDER.definitions, { key: sixth, kind: 'placeholder' }],
        unlockSets: [{ key: 'placeholder.unlock-set.five', members: keys }],
      });

    for (const keys of [[], members.slice(0, 1), members.slice(0, 4), [...members, sixth]]) {
      const result = withMembers(keys);
      expect(result.valid, `a set of ${keys.length} must be rejected`).toBe(false);
      expect(result.issues.map((issue) => issue.check)).toContain('unlock-set-cardinality');
    }

    expect(withMembers(members).valid).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Resolution (§7.7)
  // ───────────────────────────────────────────────────────────────────────────

  it('C3: a historical pinned bundle resolves after the current advances and after a process restart', async () => {
    const account = await seedAccount(prisma);
    const v1 = await publishBundle('first', at(0));
    await seedHunt(account, v1.version);

    const v2 = await publishBundle('second', at(10));
    expect(await content.currentVersion(prisma)).toBe(v2.version);
    expect(v2.version).not.toBe(v1.version);

    // In a BRAND NEW process: no warmed cache, no shared module state. The
    // child's current() throws, so a silent fallback to the current bundle
    // would fail rather than pass.
    const resolved = await resolveInFreshProcess(directory, v1.version);
    expect(resolved.version).toBe(v1.version);
    expect(resolved.checksum).toBe(v1.checksum);
    expect(resolved.definitionKeys).toEqual(v1.definitions.map((definition) => definition.key));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The pinned set (§7.7)
  // ───────────────────────────────────────────────────────────────────────────

  it('C6: the pinned set is derived by querying real references, with no reference-count column to drift', async () => {
    const account = await seedAccount(prisma);
    const character = await seedCharacter(prisma, account, 'KNIGHT');

    const hunted = await publishBundle('hunted', at(0));
    const trained = await publishBundle('trained', at(1));
    const unused = await publishBundle('unused', at(2));

    expect(await content.pinnedVersions(prisma)).toEqual([]);

    await seedHunt(account, hunted.version);
    await seedSkillTraining(account, character, trained.version);

    // BOTH families pin, and the derivation is exactly the set of real
    // references — the unused bundle is absent.
    expect(await content.pinnedVersions(prisma)).toEqual([hunted.version, trained.version].sort());
    expect(await content.unreferencedVersions(prisma)).toEqual([unused.version]);

    // NO LIFECYCLE FILTER: an ended Hunt keeps pinning for as long as its row
    // — and with it its roster snapshot — is retained (ADR-016).
    await seedHunt(account, hunted.version, 'ACTIVITY_ENDED');
    await prisma.skillTrainingActivity.updateMany({ data: { status: 'EXHAUSTED' } });
    expect(await content.pinnedVersions(prisma)).toEqual([hunted.version, trained.version].sort());

    // The derivation is the specification's query, verbatim, over the real
    // references — not a cached number.
    const direct = await prisma.$queryRawUnsafe<{ contentVersion: string }[]>(
      `SELECT DISTINCT "contentVersion" FROM "Activity"`,
    );
    expect(direct.map((row) => row.contentVersion).sort()).toEqual(
      await content.pinnedVersions(prisma),
    );

    // And there is no counter that could drift from it. ContentBundle is
    // metadata only: version, checksum, published timestamp, storage location.
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ContentBundle' ORDER BY column_name`,
    );
    expect(columns.map((row) => row.column_name)).toEqual([
      'checksum',
      'location',
      'publishedAt',
      'version',
    ]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cleanup (§7.7)
  // ───────────────────────────────────────────────────────────────────────────

  it('C4: the cleanup path refuses to delete a referenced bundle and deletes an unreferenced one, logging what it removed', async () => {
    const account = await seedAccount(prisma);
    const referenced = await publishBundle('referenced', at(0));
    const unreferenced = await publishBundle('unreferenced', at(1));
    await seedHunt(account, referenced.version);

    // Refused — and refused by the FOREIGN KEY.
    await expect(
      content.deleteUnreferencedBundle(prisma, referenced.version, log),
    ).rejects.toSatisfy(isForeignKeyRefusal);

    // With cleanup code removed from the equation entirely: the same DELETE,
    // issued directly, is refused by the database just as firmly. Nothing in
    // packages/domain is what protects a referenced bundle.
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM "ContentBundle" WHERE version = $1`,
        referenced.version,
      ),
    ).rejects.toSatisfy(isForeignKeyRefusal);

    expect(await prisma.contentBundle.count({ where: { version: referenced.version } })).toBe(1);
    expect(await exists(bundleFilePath(directory, referenced.version))).toBe(true);

    // An unreferenced bundle is removed through the explicit audited path.
    const removal = await content.deleteUnreferencedBundle(prisma, unreferenced.version, log);
    expect(removal).toEqual({
      version: unreferenced.version,
      location: bundleFilePath(directory, unreferenced.version),
      fileDeleted: true,
    });
    expect(await prisma.contentBundle.count({ where: { version: unreferenced.version } })).toBe(0);
    expect(await exists(bundleFilePath(directory, unreferenced.version))).toBe(false);

    // ...and it logged what it removed.
    expect(events).toContainEqual({
      kind: 'bundle-deleted',
      version: unreferenced.version,
      location: bundleFilePath(directory, unreferenced.version),
      fileDeleted: true,
    });

    // Removing a version that is already gone is a no-op, not a failure: the
    // audited path is re-runnable.
    expect(await content.deleteUnreferencedBundle(prisma, unreferenced.version, log)).toBeNull();
  });

  it('C7: the crash window leaves an orphaned file, never a missing one', async () => {
    const account = await seedAccount(prisma);
    const doomed = await publishBundle('doomed', at(0));
    const referenced = await publishBundle('referenced', at(1));
    await seedHunt(account, referenced.version);

    // THE CRASH WINDOW: steps 1-4 committed, step 5 not yet run.
    const removed = await content.deleteBundleMetadata(prisma, doomed.version);
    expect(removed?.version).toBe(doomed.version);

    // The row is gone, so the bundle is absent from the pinned derivation...
    expect(await prisma.contentBundle.count({ where: { version: doomed.version } })).toBe(0);
    expect(await content.pinnedVersions(prisma)).not.toContain(doomed.version);
    // ...its file is the orphan the specification expects...
    expect(await exists(bundleFilePath(directory, doomed.version))).toBe(true);
    // ...and NO REFERENCED BUNDLE LOST ITS FILE, which is the whole point of
    // the ordering.
    expect(await exists(bundleFilePath(directory, referenced.version))).toBe(true);

    // The next reconciliation pass removes the orphan.
    const report = await content.reconcileBundleArtifacts(prisma, directory, log);
    expect(report.orphanedFilesRemoved).toEqual([doomed.version]);
    expect(report.missingArtifacts).toEqual([]);
    expect(await exists(bundleFilePath(directory, doomed.version))).toBe(false);
    expect(await exists(bundleFilePath(directory, referenced.version))).toBe(true);

    // CRASHING BEFORE THE COMMIT leaves row and file both intact. A referenced
    // bundle's delete aborts inside the transaction, which is exactly that
    // case, and the rollback keeps everything.
    await expect(content.deleteBundleMetadata(prisma, referenced.version)).rejects.toSatisfy(
      isForeignKeyRefusal,
    );
    expect(await prisma.contentBundle.count({ where: { version: referenced.version } })).toBe(1);
    expect(await exists(bundleFilePath(directory, referenced.version))).toBe(true);
  });

  it('C8: reconciliation removes a file with no row and never deletes a row with no file', async () => {
    const account = await seedAccount(prisma);
    const kept = await publishBundle('kept', at(0));
    const stranded = await publishBundle('stranded', at(1));
    await seedHunt(account, kept.version);
    await seedHunt(account, stranded.version, 'ACTIVITY_ENDED');

    // A file with no ContentBundle row — an orphan from a crash between
    // steps 4 and 5.
    const orphanPath = bundleFilePath(directory, 'v0000000000000000');
    await writeFile(orphanPath, '{}', 'utf8');

    // A ContentBundle row with no file — a referenced bundle whose artifact is
    // missing. This is the P1 incident.
    await rm(bundleFilePath(directory, stranded.version));

    const before = await prisma.contentBundle.count();
    const report = await content.reconcileBundleArtifacts(prisma, directory, log);

    // The orphan is removed and logged.
    expect(report.orphanedFilesRemoved).toEqual(['v0000000000000000']);
    expect(await exists(orphanPath)).toBe(false);
    expect(events).toContainEqual({
      kind: 'orphan-file-removed',
      version: 'v0000000000000000',
      path: orphanPath,
    });

    // The missing artifact is REPORTED, and the row is NOT deleted. This test
    // fails if reconciliation ever deletes a row to resolve a missing
    // artifact: removing the row would turn recoverable data loss into
    // unrecoverable data loss.
    expect(report.missingArtifacts).toEqual([stranded.version]);
    expect(events).toContainEqual({
      kind: 'missing-artifact',
      version: stranded.version,
      location: bundleFilePath(directory, stranded.version),
    });
    expect(await prisma.contentBundle.count()).toBe(before);
    expect(await prisma.contentBundle.count({ where: { version: stranded.version } })).toBe(1);
    expect(events.some((event) => event.kind === 'bundle-deleted')).toBe(false);

    // Re-running changes nothing further: the incident stays reported until
    // the artifact is restored.
    const second = await content.reconcileBundleArtifacts(prisma, directory, log);
    expect(second.orphanedFilesRemoved).toEqual([]);
    expect(second.missingArtifacts).toEqual([stranded.version]);
    expect(await prisma.contentBundle.count()).toBe(before);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Every Activity pins (ADR-011)
  // ───────────────────────────────────────────────────────────────────────────

  it('C9: an Activity of either family cannot exist without a pinned bundle, and a Skill Training pin is protected exactly as a Hunt pin is', async () => {
    const account = await seedAccount(prisma);
    const character = await seedCharacter(prisma, account, 'DRUID');
    const hunting = await publishBundle('hunting', at(0));
    const training = await publishBundle('training', at(1));

    // Neither family can be inserted without a contentVersion. The column is
    // on the SHARED ROOT, so this is one rule, not two.
    for (const family of ['SESSION_BOUND', 'WALL_CLOCK'] as const) {
      const unpinned = await prisma
        .$executeRawUnsafe(
          `INSERT INTO "Activity" (id, "accountId", "activityTypeKey", family, "createdAt")
           VALUES ($1, $2, $3, $4::"ActivityFamily", now())`,
          `unpinned-${family}`,
          account,
          family === 'SESSION_BOUND' ? 'hunt' : 'skill-training',
          family,
        )
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      // NOT NULL, raised by the column itself — and demonstrably a different
      // refusal from the foreign key below, so neither predicate is a rubber
      // stamp for the other.
      expect(sqlStateOf(unpinned)).toBe(NOT_NULL_VIOLATION);
      expect(isForeignKeyRefusal(unpinned)).toBe(false);
      expect(await prisma.activity.count({ where: { id: `unpinned-${family}` } })).toBe(0);
    }

    // Nor with a contentVersion that names no bundle: the reference is a real
    // foreign key, not a string column that happens to look like one.
    await expect(
      prisma.activity.create({
        data: {
          id: 'dangling',
          accountId: account,
          activityTypeKey: 'hunt',
          family: 'SESSION_BOUND',
          contentVersion: 'v-does-not-exist',
          createdAt: T0,
        },
      }),
    ).rejects.toSatisfy(isForeignKeyRefusal);

    await seedHunt(account, hunting.version);
    await seedSkillTraining(account, character, training.version);
    expect(await content.pinnedVersions(prisma)).toEqual(
      [hunting.version, training.version].sort(),
    );

    // A Skill Training activity's bundle is refused deletion EXACTLY as a
    // Hunt's is — same refusal, same mechanism, no family-specific path.
    await expect(content.deleteUnreferencedBundle(prisma, training.version, log)).rejects.toSatisfy(
      isForeignKeyRefusal,
    );
    await expect(content.deleteUnreferencedBundle(prisma, hunting.version, log)).rejects.toSatisfy(
      isForeignKeyRefusal,
    );
    expect(await prisma.contentBundle.count()).toBe(2);

    // The current bundle advances, and the process restarts.
    const latest = await publishBundle('latest', at(30));
    expect(await content.currentVersion(prisma)).toBe(latest.version);

    const pinned = await prisma.activity.findFirstOrThrow({
      where: { family: 'WALL_CLOCK' },
      select: { contentVersion: true },
    });
    expect(pinned.contentVersion).toBe(training.version);

    const resolved = await resolveInFreshProcess(directory, pinned.contentVersion);
    expect(resolved.version).toBe(training.version);
    expect(resolved.checksum).toBe(training.checksum);
  });
});
