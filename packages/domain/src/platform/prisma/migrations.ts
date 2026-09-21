/**
 * Migration version check (§6.5, §12.1).
 *
 * Readiness fails on a mismatch so a STALE INSTANCE does not serve traffic
 * against a newer schema. That is the direction that matters: during a rolling
 * deploy the database moves first, and an old process that keeps serving is
 * the one that writes rows the new schema did not expect.
 *
 * `expected` is the latest migration SHIPPED WITH THIS BUILD; `applied` is the
 * latest the database has. They are compared as strings, because Prisma
 * migration names are timestamp-prefixed and therefore ordered.
 */
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationVersionMismatch } from '../errors/index.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

/** src/platform/prisma -> the package root, and the same from dist/. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function expectedMigrationVersion(
  migrationsDir = join(PACKAGE_ROOT, 'prisma', 'migrations'),
): string {
  const entries = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const latest = entries.at(-1);
  if (!latest) throw new Error(`No migrations found in ${migrationsDir}.`);
  return latest;
}

export async function appliedMigrationVersion(prisma: PrismaClient): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name DESC LIMIT 1`,
  );
  return rows[0]?.migration_name ?? null;
}

export interface MigrationVersionReport {
  readonly expected: string;
  readonly applied: string | null;
  readonly matches: boolean;
}

export async function checkMigrationVersion(
  prisma: PrismaClient,
  migrationsDir?: string,
): Promise<MigrationVersionReport> {
  const expected = expectedMigrationVersion(migrationsDir);
  const applied = await appliedMigrationVersion(prisma);
  return { expected, applied, matches: applied === expected };
}

/** Throws {@link DomainError} `MigrationVersionMismatch` unless the database is
 *  at exactly the migration this build ships. */
export async function assertMigrationVersion(
  prisma: PrismaClient,
  migrationsDir?: string,
): Promise<string> {
  const report = await checkMigrationVersion(prisma, migrationsDir);
  if (!report.matches) {
    throw migrationVersionMismatch({ expected: report.expected, applied: report.applied });
  }
  return report.expected;
}
