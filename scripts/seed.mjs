#!/usr/bin/env node
/**
 * Local seed data (§11.3).
 *
 * GENERATED THROUGH DOMAIN PATHS — every row below is created by calling the
 * same application service a user's action would. Never a SQL dump: a seed
 * that bypasses the domain can encode states the game cannot reach, and those
 * states become bug reports nobody can reproduce.
 *
 * Idempotent, so `pnpm dev` can run it on every start.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  character,
  content,
  createPrismaClient,
  identity,
  loadConfig,
  withTransaction,
} from '@global-idle/domain';

const config = loadConfig();
const prisma = createPrismaClient({ connectionString: config.DATABASE_URL });
const now = new Date();

const say = (line) => process.stdout.write(`${line}\n`);

/** Publish every built bundle that is not published yet. The bundle files are
 *  produced by `pnpm --filter @global-idle/game-data run build:bundle`. */
async function publishBundles() {
  const directory = resolve(config.CONTENT_BUNDLE_DIR);
  let files;
  try {
    files = (await readdir(directory)).filter((name) => name.endsWith('.json'));
  } catch {
    throw new Error(
      `No content bundles at ${directory}. Run: pnpm --filter @global-idle/game-data run build:bundle`,
    );
  }
  if (files.length === 0) throw new Error(`No content bundles at ${directory}.`);

  for (const file of files) {
    const artifact = JSON.parse(await readFile(join(directory, file), 'utf8'));
    const already = await prisma.contentBundle.findUnique({ where: { version: artifact.version } });
    if (already) {
      say(`bundle ${artifact.version} already published`);
      continue;
    }
    await content.publish(prisma, artifact, directory, now);
    say(`published bundle ${artifact.version}`);
  }
}

const VOCATIONS = ['KNIGHT', 'PALADIN', 'SORCERER', 'DRUID', 'MONK'];
const SEED_SUBJECT = 'seed@local';

async function seedAccount() {
  const existing = await prisma.authIdentity.findUnique({
    where: { provider_subject: { provider: 'local', subject: SEED_SUBJECT } },
  });
  if (existing) {
    say(`account ${existing.accountId} already seeded`);
    return existing.accountId;
  }

  // One transaction, the same boundary a real registration would use (§8.1).
  const accountId = await withTransaction(prisma, async (tx) => {
    const id = await identity.createAccount(tx, { at: now, rosterCapacity: 5 });
    await identity.linkIdentity(tx, {
      accountId: id,
      provider: 'local',
      subject: SEED_SUBJECT,
      at: now,
    });
    await identity.grant(tx, {
      accountId: id,
      kind: 'PREMIUM',
      validFrom: now,
      validUntil: null,
      reason: 'local seed',
    });
    return id;
  });
  say(`created account ${accountId} with a permanent PREMIUM entitlement`);

  // Each Character in its own transaction: the roster-capacity check locks the
  // Account row, and one long transaction holding that lock is not what a real
  // creation looks like (§6.4, §8.5).
  for (const vocation of VOCATIONS) {
    const id = await withTransaction(prisma, (tx) =>
      character.createCharacter(tx, {
        accountId,
        vocation,
        name: `${vocation[0]}${vocation.slice(1).toLowerCase()}`,
        at: now,
      }),
    );
    say(`created ${vocation} ${id}`);
  }
  return accountId;
}

try {
  await publishBundles();
  await seedAccount();
  say('seed complete');
} finally {
  await prisma.$disconnect();
}
