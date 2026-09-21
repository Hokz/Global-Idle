// Global setup for the integration and invariants projects (§3.7).
//
// DEFAULT PATH: Testcontainers brings up ephemeral PostgreSQL and Redis, so a
// developer and CI run the same thing and neither depends on a hand-started
// database. That is what the specification fixes and what CI uses.
//
// ESCAPE HATCH: when GLOBAL_IDLE_TEST_DATABASE_URL and
// GLOBAL_IDLE_TEST_REDIS_URL are both set, those services are used instead.
// This exists because Testcontainers needs a Docker daemon, and a sandbox
// without one would otherwise be unable to run a single integration test. It
// is not a way to avoid Testcontainers: with a daemon present and the
// variables unset — which is CI — the default path is the only path.
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOMAIN = resolve(REPO_ROOT, 'packages', 'domain');

type Teardown = () => Promise<void>;

let teardown: Teardown = async () => {};

async function startTestcontainers(): Promise<{ databaseUrl: string; redisUrl: string }> {
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const { RedisContainer } = await import('@testcontainers/redis');

  const postgres = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('globalidle')
    .withUsername('globalidle')
    .withPassword('globalidle')
    .start();
  const redis = await new RedisContainer('redis:7-alpine').start();

  teardown = async () => {
    await redis.stop();
    await postgres.stop();
  };

  return { databaseUrl: postgres.getConnectionUri(), redisUrl: redis.getConnectionUrl() };
}

export async function setup(): Promise<void> {
  const externalDatabase = process.env['GLOBAL_IDLE_TEST_DATABASE_URL'];
  const externalRedis = process.env['GLOBAL_IDLE_TEST_REDIS_URL'];

  const { databaseUrl, redisUrl } =
    externalDatabase && externalRedis
      ? { databaseUrl: externalDatabase, redisUrl: externalRedis }
      : await startTestcontainers();

  process.env['DATABASE_URL'] = databaseUrl;
  process.env['REDIS_URL'] = redisUrl;

  // Migrations run against the instance the tests are about to use. They are
  // applied as a SEPARATE STEP BEFORE anything reads the schema, never at boot
  // (§6.5).
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: DOMAIN,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await attachApplicationRoleCredential(databaseUrl);
}

/**
 * The migration creates `globalidle_app` NOLOGIN on purpose — a migration has
 * no business holding a credential (§6.4). Attaching one is a DEPLOYMENT
 * concern, and for the test stack this is the deployment.
 *
 * Without it, D9 cannot connect as the least-privileged role and the whole
 * append-only guarantee goes untested. It passed on a developer machine only
 * because the role had been given a login there by hand, which is exactly the
 * kind of local state that makes a suite green here and red in CI.
 */
async function attachApplicationRoleCredential(databaseUrl: string): Promise<void> {
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient } = await import('../../packages/domain/src/generated/prisma/client.js');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    await prisma.$executeRawUnsafe(
      `ALTER ROLE "globalidle_app" WITH LOGIN PASSWORD 'globalidle_app'`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

export async function teardownAll(): Promise<void> {
  await teardown();
}

export { teardownAll as teardown };
