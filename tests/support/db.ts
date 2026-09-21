// Database helpers for the integration and invariants projects.
//
// Tests talk to the database through the same generated client the
// application uses; nothing here re-implements a query the domain owns.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../packages/domain/src/generated/prisma/client.js';
import { contentKey, newId, type Instant } from '@global-idle/shared';

export function databaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set; the global setup should have provided it.');
  return url;
}

export function createClient(url: string = databaseUrl()): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/**
 * A client connected as the least-privileged application role (I6, test D9).
 *
 * The role is created NOLOGIN by the migration; the test global setup attaches
 * this credential, exactly as a deployment would. See global-setup.ts.
 */
export function createAppRoleClient(): PrismaClient {
  const url = new URL(databaseUrl());
  url.username = 'globalidle_app';
  url.password = 'globalidle_app';
  return createClient(url.toString());
}

/** Phase 1 made `contentKey` required on every Activity (spec §9.5). These
 *  are well-formed keys for suites that assert LIFECYCLE rather than content
 *  identity; the content-identity cases resolve real definitions instead. */
export const T_HUNT_KEY = contentKey('hunt.rookgaard.sewers');
export const T_TRAINING_KEY = contentKey('skill-training.rookgaard.basics');
/** Origin Characters are Level 1 (TUTORIAL_ROOKGAARD_ROADMAP.md §3). */
export const ORIGIN_LEVEL = 1;

export const AT = (iso: string): Instant => new Date(iso);
export const T0 = AT('2026-01-01T00:00:00.000Z');

/** Delete every row, in foreign-key order. Each test starts from nothing so a
 *  failure points at the test that caused it rather than the one that ran
 *  after it. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "OccupancyClaim", "SkillTrainingActivity", "SessionBoundActivity",
      "ActivityParticipant", "Activity", "CharacterStamina", "Character",
      "EntitlementAudit", "Entitlement", "AuthIdentity",
      "LedgerEntry", "CurrencyBalance", "ActiveUseTimer",
      "IdempotencyRecord", "SettlementOperation", "Account", "ContentBundle"
    RESTART IDENTITY CASCADE
  `);
}

export interface SeedOptions {
  readonly at?: Instant;
  readonly rosterCapacity?: number;
}

export async function seedAccount(prisma: PrismaClient, options: SeedOptions = {}) {
  const at = options.at ?? T0;
  const id = newId<'AccountId'>(at);
  await prisma.account.create({
    data: { id, rosterCapacity: options.rosterCapacity ?? 5, createdAt: at },
  });
  return id;
}

export async function seedBundle(prisma: PrismaClient, version = 'v1', at: Instant = T0) {
  await prisma.contentBundle.create({
    data: { version, checksum: `checksum-${version}`, publishedAt: at, location: `./${version}` },
  });
  return version;
}

export type VocationName = 'KNIGHT' | 'PALADIN' | 'SORCERER' | 'DRUID' | 'MONK';

export async function seedCharacter(
  prisma: PrismaClient,
  accountId: string,
  vocation: VocationName,
  options: { at?: Instant; retiredAt?: Instant | null; name?: string } = {},
) {
  const at = options.at ?? T0;
  const id = newId<'CharacterId'>(at);
  await prisma.character.create({
    data: {
      id,
      accountId,
      vocation,
      name: options.name ?? `${vocation.toLowerCase()}-${id.slice(0, 8)}`,
      createdAt: at,
      retiredAt: options.retiredAt ?? null,
    },
  });
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity fixtures (§6.3.1, §8.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface ActivityRootOptions {
  readonly at?: Instant;
  readonly family: 'SESSION_BOUND' | 'WALL_CLOCK';
  readonly activityTypeKey?: string;
  readonly contentVersion?: string;
}

export async function seedActivityRoot(
  prisma: PrismaClient,
  accountId: string,
  options: ActivityRootOptions,
) {
  const at = options.at ?? T0;
  const id = newId<'ActivityId'>(at);
  await prisma.activity.create({
    data: {
      id,
      accountId,
      activityTypeKey:
        options.activityTypeKey ?? (options.family === 'SESSION_BOUND' ? 'hunt' : 'skill-training'),
      family: options.family,
      contentVersion: options.contentVersion ?? 'v1',
      contentKey: 'hunt.rookgaard.sewers',
      createdAt: at,
    },
  });
  return id;
}

export async function seedParticipant(
  prisma: PrismaClient,
  activityId: string,
  characterId: string,
  family: 'SESSION_BOUND' | 'WALL_CLOCK',
  slotIndex = 0,
) {
  await prisma.activityParticipant.create({
    data: { activityId, characterId, family, slotIndex, staminaActivatedAt: null },
  });
}

export async function seedClaim(
  prisma: PrismaClient,
  activityId: string,
  characterId: string,
  at: Instant = T0,
) {
  await prisma.occupancyClaim.create({ data: { characterId, activityId, acquiredAt: at } });
}

/**
 * Assert a DomainError by its CODE (§8.4), not by matching its prose. A test
 * that greps the message breaks when the message improves, and passes when a
 * different error happens to share a word.
 */
export async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const actual = error as { code?: string; name?: string };
    if (actual.code === code || actual.name === code) return;
    throw new Error(`expected DomainError ${code}, got ${actual.name ?? 'unknown'}`, {
      cause: error,
    });
  }
  throw new Error(`expected DomainError ${code}, but the call resolved`);
}
