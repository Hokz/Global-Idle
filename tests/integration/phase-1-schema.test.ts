// Phase 1 §16 — D19 to D28. The Phase 1 migration and the constraints it adds
// (spec §13.2, §13.3).
//
// Phase 0B owns D1–D18 and none of them move. These continue the same letter
// because they are the same kind of claim: the DATABASE refuses the invalid
// state, not application code that declined to create it.
//
// D19, D20 and D28 apply real migrations to real scratch databases, because
// "the migration works" and "the migration file looks right" are different
// claims and only the first one is worth anything.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ORIGIN_LEVEL,
  T0,
  createClient,
  databaseUrl,
  seedAccount,
  seedCharacter,
  truncateAll,
} from '../support/db.js';
import { REPO_ROOT } from '../support/repo.js';
import { rookgaardSource } from '../support/phase1.js';

const prisma = createClient();

const MIGRATIONS = join(REPO_ROOT, 'packages', 'domain', 'prisma', 'migrations');
const PHASE_1 = '20260921180000_phase_1_origin_character_and_activity_content';

const migrationDirs = (): string[] =>
  readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

interface Psql {
  status: number;
  stdout: string;
  stderr: string;
}

function psql(args: string[], database: string, input?: string): Psql {
  const url = new URL(databaseUrl());
  const result = spawnSync(
    'psql',
    [
      '-h',
      url.hostname,
      '-p',
      url.port || '5432',
      '-U',
      url.username,
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      ...args,
    ],
    {
      encoding: 'utf8',
      input,
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
    },
  );
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * A throwaway database, dropped whether the body passes or throws. A migration
 * case that leaves its scratch database behind makes the next run's failure
 * somebody else's problem.
 */
function withScratchDatabase<T>(name: string, body: (database: string) => T): T {
  const drop = () => psql(['-tAc', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`], 'postgres');
  drop();
  const created = psql(['-tAc', `CREATE DATABASE "${name}";`], 'postgres');
  if (created.status !== 0) throw new Error(`could not create ${name}: ${created.stderr}`);
  try {
    return body(name);
  } finally {
    drop();
  }
}

/** Apply migrations in order, up to and including `last`. */
function applyThrough(database: string, last: string): void {
  for (const dir of migrationDirs()) {
    const sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
    const applied = psql(['-f', '-'], database, sql);
    if (applied.status !== 0) {
      throw new Error(`migration ${dir} failed on ${database}:\n${applied.stderr}`);
    }
    if (dir === last) return;
  }
}

/** Apply ONE migration and report what the database said. */
function apply(database: string, dir: string): Psql {
  return psql(['-f', '-'], database, readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8'));
}

const phase0bLast = (): string => {
  const dirs = migrationDirs();
  const index = dirs.indexOf(PHASE_1);
  if (index <= 0) throw new Error('the Phase 1 migration is not where it was expected');
  return dirs[index - 1]!;
};

beforeEach(async () => {
  await truncateAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Phase 1 schema', () => {
  it('D19: the migration applies to a clean database', () => {
    withScratchDatabase('globalidle_phase1_clean', (database) => {
      applyThrough(database, PHASE_1);

      const columns = psql(
        [
          '-tAc',
          `SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_name = 'Character' AND column_name IN ('vocation', 'baseLevel')
            ORDER BY column_name`,
        ],
        database,
      );
      expect(columns.status, columns.stderr).toBe(0);
      expect(columns.stdout.trim().split('\n').sort()).toEqual(['baseLevel|NO', 'vocation|YES']);
    });
  }, 300_000);

  it('D20: the migration applies over a Phase 0B database that holds no Activity rows', () => {
    withScratchDatabase('globalidle_phase1_over_0b', (database) => {
      applyThrough(database, phase0bLast());

      // A REAL Phase 0B database: accounts and characters exist, and every one
      // of them predates the Origin Character.
      const seeded = psql(
        [
          '-tAc',
          `INSERT INTO "Account" ("id", "rosterCapacity", "createdAt")
             VALUES ('01900000-0000-7000-8000-000000000001', 5, now());
           INSERT INTO "Character" ("id", "accountId", "vocation", "name", "createdAt")
             VALUES ('01900000-0000-7000-8000-000000000002',
                     '01900000-0000-7000-8000-000000000001', 'KNIGHT', 'Old Knight', now());`,
        ],
        database,
      );
      expect(seeded.status, seeded.stderr).toBe(0);

      const migrated = apply(database, PHASE_1);
      expect(migrated.status, migrated.stderr).toBe(0);

      // The pre-existing Character keeps its vocation and gets the default.
      const row = psql(['-tAc', `SELECT "vocation", "baseLevel" FROM "Character"`], database);
      expect(row.stdout.trim()).toBe('KNIGHT|1');
    });
  }, 300_000);

  it('D21: the FIRST Origin Character on an account is accepted', async () => {
    const account = await seedAccount(prisma);
    const id = await prisma.character.create({
      data: {
        id: '01900000-0000-7000-8000-000000000010',
        accountId: account,
        vocation: null,
        name: 'Origin',
        baseLevel: ORIGIN_LEVEL,
        createdAt: T0,
      },
      select: { id: true, vocation: true, baseLevel: true },
    });

    expect(id.vocation).toBeNull();
    expect(id.baseLevel).toBe(ORIGIN_LEVEL);
  });

  it('D22: a SECOND Origin Character on the same account is refused by I1b', async () => {
    const account = await seedAccount(prisma);
    const origin = (suffix: string) => ({
      id: `01900000-0000-7000-8000-0000000000${suffix}`,
      accountId: account,
      vocation: null,
      name: `Origin ${suffix}`,
      baseLevel: ORIGIN_LEVEL,
      createdAt: T0,
    });

    await prisma.character.create({ data: origin('20') });
    // I1 cannot do this: a unique index treats NULLs as DISTINCT, so
    // (accountId, NULL) never collides with (accountId, NULL). I1b is the
    // index that does.
    await expect(prisma.character.create({ data: origin('21') })).rejects.toThrow();
    expect(await prisma.character.count({ where: { accountId: account } })).toBe(1);

    // Retire it, and the slot frees — retirement, not deletion (ADR-007).
    await prisma.character.update({
      where: { id: origin('20').id },
      data: { retiredAt: new Date(T0.getTime() + 1_000) },
    });
    await expect(prisma.character.create({ data: origin('22') })).resolves.toBeDefined();
  });

  it('D23: a DIFFERENT account may have its own Origin Character', async () => {
    const first = await seedAccount(prisma);
    const second = await seedAccount(prisma, { at: new Date(T0.getTime() + 1) });

    for (const [index, account] of [first, second].entries()) {
      await prisma.character.create({
        data: {
          id: `01900000-0000-7000-8000-00000000003${index}`,
          accountId: account,
          vocation: null,
          name: `Origin ${index}`,
          baseLevel: ORIGIN_LEVEL,
          createdAt: T0,
        },
      });
    }

    // I1b is scoped to the ACCOUNT. It has no opinion about other accounts.
    expect(await prisma.character.count({ where: { vocation: null } })).toBe(2);
  });

  it('D24: a Knight and an Origin Character coexist on one account', async () => {
    const account = await seedAccount(prisma);
    await seedCharacter(prisma, account, 'KNIGHT');
    await prisma.character.create({
      data: {
        id: '01900000-0000-7000-8000-000000000040',
        accountId: account,
        vocation: null,
        name: 'Origin',
        baseLevel: ORIGIN_LEVEL,
        createdAt: T0,
      },
    });

    // I1 constrains CONCRETE vocations; I1b constrains the absence of one.
    // Neither one refuses the other's rows, which is exactly why there are two.
    const rows = await prisma.character.findMany({
      where: { accountId: account, retiredAt: null },
      select: { vocation: true },
      orderBy: { name: 'asc' },
    });
    expect(rows.map((row) => row.vocation).sort()).toEqual(['KNIGHT', null]);
  });

  it('D25: the baseLevel >= 1 CHECK is enforced by the database', async () => {
    const account = await seedAccount(prisma);

    for (const baseLevel of [0, -1, -999]) {
      await expect(
        prisma.character.create({
          data: {
            id: `01900000-0000-7000-8000-0000000000${50 + Math.abs(baseLevel)}`,
            accountId: account,
            vocation: 'KNIGHT',
            name: `Level ${baseLevel}`,
            baseLevel,
            createdAt: T0,
          },
        }),
        `baseLevel ${baseLevel}`,
      ).rejects.toThrow();
    }

    // The floor is 1, and 1 is allowed.
    await expect(
      prisma.character.create({
        data: {
          id: '01900000-0000-7000-8000-000000000059',
          accountId: account,
          vocation: 'KNIGHT',
          name: 'Floor',
          baseLevel: 1,
          createdAt: T0,
        },
      }),
    ).resolves.toBeDefined();
  });

  it('D26: Activity.contentKey is NOT NULL after the migration', async () => {
    const [column] = await prisma.$queryRawUnsafe<{ is_nullable: string }[]>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'Activity' AND column_name = 'contentKey'`,
    );
    expect(column?.is_nullable).toBe('NO');

    // Every OTHER required value is present and valid, so the only thing this
    // insert can fail on is the missing contentKey. An Activity that cannot
    // say WHICH definition it ran is the defect §9.5 removes.
    const account = await seedAccount(prisma);
    await prisma.contentBundle.create({
      data: { version: 'v-not-null', checksum: 'checksum', publishedAt: T0, location: './x' },
    });

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Activity" ("id", "accountId", "activityTypeKey", "family",
                                 "contentVersion", "createdAt")
           VALUES ('01900000-0000-7000-8000-000000000060', $1,
                   'hunt', 'SESSION_BOUND', 'v-not-null', now())`,
        account,
      ),
    ).rejects.toThrow(/contentKey|null/i);

    // The same insert WITH a key is accepted, which is what makes the previous
    // assertion about the column rather than about the statement.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Activity" ("id", "accountId", "activityTypeKey", "family",
                                 "contentVersion", "contentKey", "createdAt")
           VALUES ('01900000-0000-7000-8000-000000000062', $1,
                   'hunt', 'SESSION_BOUND', 'v-not-null', 'hunt.rookgaard.sewers', now())`,
        account,
      ),
    ).resolves.toBe(1);
  });

  it('D27: the format CHECK refuses a malformed key and accepts every key the bundle authors', async () => {
    const account = await seedAccount(prisma);
    const bundle = 'v-phase-1-format-check';
    await prisma.contentBundle.create({
      data: { version: bundle, checksum: 'checksum', publishedAt: T0, location: './x' },
    });

    let serial = 100;
    const insert = (contentKey: string) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "Activity" ("id", "accountId", "activityTypeKey", "family",
                                 "contentVersion", "contentKey", "createdAt")
           VALUES ($1, $2, 'hunt', 'SESSION_BOUND', $3, $4, now())`,
        `01900000-0000-7000-8000-000000000${serial++}`,
        account,
        bundle,
        contentKey,
      );

    for (const malformed of [
      '',
      'nodot',
      'Upper.Case',
      'trailing.',
      '.leading',
      'double..dot',
      'has space.key',
      'sym$bol.key',
      'hunt.-leadingdash',
    ]) {
      await expect(insert(malformed), JSON.stringify(malformed)).rejects.toThrow();
    }

    // EVERY key the Phase 1 bundle actually authors is accepted. A format rule
    // the shipped content cannot satisfy is a rule that will be deleted.
    const source = await rookgaardSource();
    expect(source.definitions.length).toBeGreaterThan(0);
    for (const definition of source.definitions) {
      await expect(insert(definition.key), definition.key).resolves.toBeDefined();
    }
  });

  it('D28: the migration FAILS on a database that still holds Activity rows, readably', () => {
    withScratchDatabase('globalidle_phase1_with_activities', (database) => {
      applyThrough(database, phase0bLast());

      const seeded = psql(
        [
          '-tAc',
          `INSERT INTO "Account" ("id", "rosterCapacity", "createdAt")
             VALUES ('01900000-0000-7000-8000-000000000070', 5, now());
           INSERT INTO "ContentBundle" ("version", "checksum", "publishedAt", "location")
             VALUES ('v-old', 'checksum', now(), './old');
           INSERT INTO "Activity" ("id", "accountId", "activityTypeKey", "family",
                                   "contentVersion", "createdAt")
             VALUES ('01900000-0000-7000-8000-000000000071',
                     '01900000-0000-7000-8000-000000000070',
                     'hunt', 'SESSION_BOUND', 'v-old', now());`,
        ],
        database,
      );
      expect(seeded.status, seeded.stderr).toBe(0);

      const migrated = apply(database, PHASE_1);

      // It FAILS, on purpose. There is no truthful contentKey for a
      // pre-Phase-1 Activity, and inventing one would put a false fact in the
      // column reload depends on (§13.3).
      expect(migrated.status).not.toBe(0);
      // And it says why, in words a developer can act on: the column, the
      // constraint, and the row it could not satisfy.
      expect(migrated.stderr).toMatch(/contentKey/);
      expect(migrated.stderr).toMatch(/null|not-null|NOT NULL/i);
    });
  }, 300_000);
});
