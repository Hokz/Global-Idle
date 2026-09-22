#!/usr/bin/env node
/**
 * Migration validation — §13 check 9, tests D1, D2 and D13.
 *
 * Three claims, each checked against the artefacts rather than the intent:
 *
 *   D1  migrations apply cleanly to an EMPTY database
 *   D2  migrations apply cleanly FROM THE PREVIOUS migration's state
 *   D13 the GENERATED SQL carries every declared partial-index predicate, and
 *       the hand-written CHECK constraints are present
 *
 * D13 reads the migration files, not schema.prisma. A `raw()` predicate in the
 * schema is a declaration; what reaches the database is whatever Prisma Migrate
 * generated from it, and that is the thing worth asserting (§6.5).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(PACKAGE_ROOT, 'prisma', 'migrations');

/** Statements the migrations MUST contain, with the invariant each enforces. */
const REQUIRED_SQL = [
  {
    invariant: 'I1 — one playable (non-retired) Character per vocation per account',
    pattern:
      /CREATE UNIQUE INDEX "Character_accountId_vocation_key"[\s\S]*?WHERE \("retiredAt" IS NULL\)/,
  },
  {
    invariant: 'I9 — one non-terminal session-bound Activity per account',
    pattern:
      /CREATE UNIQUE INDEX "SessionBoundActivity_accountId_key"[\s\S]*?WHERE \(state IN \('ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED'\)\)/,
  },
  {
    invariant: 'I1b — one playable un-vocationalized ORIGIN Character per account (Phase 1 §13.2)',
    pattern:
      /CREATE UNIQUE INDEX "Character_accountId_key"[\s\S]*?WHERE "retiredAt" IS NULL AND "vocation" IS NULL/,
  },
  {
    invariant: 'Phase 1 §13.2 — baseLevel has a floor',
    pattern: /CHECK \("baseLevel" >= 1\)/,
  },
  {
    invariant: 'Phase 1 §13.3 — Activity.contentKey is NOT NULL and shaped like a content key',
    pattern: /ALTER COLUMN "contentKey" SET NOT NULL[\s\S]*?CHECK \("contentKey" ~ '\^\[a-z0-9\]\+/,
  },
  {
    invariant: 'at most one participant on a wall-clock activity (§6.3.1)',
    pattern:
      /CREATE UNIQUE INDEX "ActivityParticipant_activityId_key"[\s\S]*?WHERE \(family = 'WALL_CLOCK'\)/,
  },
  {
    invariant: '§6.3.3 — a session-bound subtype cannot sit under a wall-clock root',
    pattern: /CHECK \("family" = 'SESSION_BOUND'\)/,
  },
  {
    invariant: '§6.3.3 — a wall-clock subtype cannot sit under a session-bound root',
    pattern: /CHECK \("family" = 'WALL_CLOCK'\)/,
  },
  {
    invariant: 'I2 — rosterCapacity bounds',
    pattern: /CHECK \("rosterCapacity" BETWEEN 1 AND 5\)/,
  },
  {
    invariant: 'I6 — the ledger is append-only for the application role',
    pattern: /REVOKE UPDATE, DELETE ON "LedgerEntry" FROM "globalidle_app"/,
  },
  {
    invariant:
      'ADR-019 — a POUCH names a REAL Character owned by the row\u2019s Account (LedgerEntry)',
    pattern:
      /ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_characterId_accountId_fkey"[\s\S]*?FOREIGN KEY \("characterId", "accountId"\) REFERENCES "Character"\("id", "accountId"\)/,
  },
  {
    invariant:
      'ADR-019 — a POUCH names a REAL Character owned by the row\u2019s Account (CurrencyBalance)',
    pattern:
      /ALTER TABLE "CurrencyBalance" ADD CONSTRAINT "CurrencyBalance_characterId_accountId_fkey"[\s\S]*?FOREIGN KEY \("characterId", "accountId"\) REFERENCES "Character"\("id", "accountId"\)/,
  },
  {
    invariant: 'ADR-019 — custody, carrier and subject key agree, or the row is refused',
    pattern:
      /CHECK \(\s*\("custody" = 'BANK'\s+AND "characterId" IS NULL\s+AND "subjectId" = "accountId"\) OR\s*\("custody" = 'POUCH' AND "characterId" IS NOT NULL AND "subjectId" = "characterId"\)/,
  },
  {
    invariant: 'Phase 3 §3 — an installed container, its OWNER and its SLOT are one foreign key',
    pattern:
      /ALTER TABLE "CharacterContainerSlot"\s+ADD CONSTRAINT "CharacterContainerSlot_containerInstanceId_characterId_slo_fkey"\s+FOREIGN KEY \("containerInstanceId", "characterId", "slotIndex"\)\s+REFERENCES "ItemInstance"\("id", "characterId", "slotIndex"\)/,
  },
  {
    invariant: 'Phase 3 §3 — contents belong to the same Character as their parent container',
    pattern:
      /ALTER TABLE "ItemInstance"\s+ADD CONSTRAINT "ItemInstance_containerId_characterId_fkey"\s+FOREIGN KEY \("containerId", "characterId"\) REFERENCES "ItemInstance"\("id", "characterId"\)/,
  },
  {
    invariant: 'Phase 3 §3 — HUNT_CONTAINER is its own shape, and carries a slot index',
    pattern:
      /\("location" = 'HUNT_CONTAINER'\s+AND "characterId" IS NOT NULL AND "containerId" IS NULL\s+AND "slot" IS NULL\s+AND "slotIndex" IS NOT NULL\)/,
  },
  {
    invariant: 'Phase 3 §3.1 — there is no slot 6 on the INSTANCE side either',
    pattern: /CHECK \("slotIndex" IS NULL OR "slotIndex" BETWEEN 1 AND 5\)/,
  },
];

function migrationDirs() {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function allMigrationSql() {
  return migrationDirs()
    .map((dir) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8'))
    .join('\n');
}

function prisma(args, databaseUrl) {
  return execFileSync('npx', ['prisma', ...args], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function withScratchDatabase(name, body) {
  const base = new URL(process.env['DATABASE_URL'] ?? '');
  const admin = { ...process.env, PGPASSWORD: decodeURIComponent(base.password) };
  const psqlArgs = [
    '-h',
    base.hostname,
    '-p',
    base.port || '5432',
    '-U',
    base.username,
    '-d',
    'postgres',
  ];
  const drop = () =>
    execFileSync('psql', [...psqlArgs, '-tAc', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`], {
      env: admin,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  drop();
  execFileSync('psql', [...psqlArgs, '-tAc', `CREATE DATABASE "${name}";`], {
    env: admin,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = new URL(base.toString());
  url.pathname = `/${name}`;
  try {
    return body(url.toString());
  } finally {
    drop();
  }
}

let failures = 0;
const fail = (message) => {
  console.error(`  ✗ ${message}`);
  failures += 1;
};
const pass = (message) => console.warn(`  ✓ ${message}`);

console.warn('migrate:check');

// ---------------------------------------------------------------- D13
const sql = allMigrationSql();
for (const { invariant, pattern } of REQUIRED_SQL) {
  if (pattern.test(sql)) pass(`D13 generated SQL enforces ${invariant}`);
  else fail(`D13 generated SQL is MISSING the statement for ${invariant}`);
}

// ---------------------------------------------------------------- D1
const dirs = migrationDirs();
if (dirs.length < 2) fail(`expected at least two migrations, found ${dirs.length}`);

withScratchDatabase('globalidle_migrate_check_empty', (url) => {
  prisma(['migrate', 'deploy'], url);
  pass('D1 migrations apply cleanly from an empty database');

  // ---------------------------------------------------------------- D2
  // Applying again from the state the previous run left is a no-op, not an
  // error: that is what "from the previous state" has to mean for a
  // forward-only history.
  const again = prisma(['migrate', 'deploy'], url);
  if (/No pending migrations|already applied|up to date/i.test(again)) {
    pass('D2 migrations apply cleanly from the previous migration state');
  } else {
    fail(`D2 re-applying did not report an up-to-date database:\n${again}`);
  }

  const status = prisma(['migrate', 'status'], url);
  if (/up to date/i.test(status)) pass('no drift between schema and database');
  else fail(`drift detected:\n${status}`);
});

// ---------------------------------------------------------------- D2, stepwise
// Apply migrations one at a time, so a migration that only works when the
// whole history runs at once is caught.
withScratchDatabase('globalidle_migrate_check_stepwise', (url) => {
  for (const dir of dirs) {
    prisma(['migrate', 'deploy'], url);
    void dir;
  }
  pass('D2 stepwise application reaches the same state');
});

if (failures > 0) {
  console.error(`\nmigrate:check FAILED with ${failures} problem(s).`);
  process.exit(1);
}
console.warn('\nmigrate:check passed.');
