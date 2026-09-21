// §14.9 — H1 to H5. Health and observability (§12.1).
//
// Each case brings the REAL application up, with one dependency deliberately
// broken, and asks it over HTTP. Nothing here calls an indicator directly: a
// readiness check that is only ever invoked by a unit test proves nothing
// about what an orchestrator will see.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content, type AppConfig } from '@global-idle/domain';
import { buildBundle, bundleFilePath, writeBundle } from '@global-idle/game-data';
import { T0, createClient, truncateAll } from '../support/db.js';
import { createApp } from '../../apps/api/src/app.factory.js';

const prisma = createClient();

/** Ports that nothing is listening on, so "down" means unreachable rather than
 *  "configured with a typo". */
const DEAD_POSTGRES = 'postgresql://nobody:nobody@127.0.0.1:1/none?schema=public';
const DEAD_REDIS = 'redis://127.0.0.1:1';

const PLACEHOLDER = {
  name: 'health',
  definitions: [
    { key: 'placeholder.node.a', kind: 'placeholder', references: [] },
    { key: 'placeholder.node.b', kind: 'placeholder', references: [] },
    { key: 'placeholder.node.c', kind: 'placeholder', references: [] },
    { key: 'placeholder.node.d', kind: 'placeholder', references: [] },
    { key: 'placeholder.node.e', kind: 'placeholder', references: [] },
  ],
  unlockSets: [
    {
      key: 'placeholder.unlock-set.five',
      members: [
        'placeholder.node.a',
        'placeholder.node.b',
        'placeholder.node.c',
        'placeholder.node.d',
        'placeholder.node.e',
      ],
    },
  ],
};

let directory: string;
let app: Awaited<ReturnType<typeof createApp>> | undefined;

async function startApp(overrides: Partial<AppConfig> = {}): Promise<string> {
  app = await createApp({ CONTENT_BUNDLE_DIR: directory, LOG_LEVEL: 'silent', ...overrides });
  await app.listen(0);
  return app.getUrl();
}

interface ReadyBody {
  status: string;
  info?: Record<string, { status: string }>;
  error?: Record<string, { status: string; message?: string }>;
}

async function ready(base: string): Promise<{ status: number; body: ReadyBody }> {
  const response = await fetch(`${base}/health/ready`);
  return { status: response.status, body: (await response.json()) as ReadyBody };
}

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-health-'));
  const artifact = buildBundle(PLACEHOLDER);
  await writeBundle(directory, artifact);
  await content.publish(prisma, artifact, directory, T0, () => {});
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('§14.9 health', () => {
  it('H1: /health/live succeeds with PostgreSQL down', async () => {
    const base = await startApp({ DATABASE_URL: DEAD_POSTGRES, DATABASE_APP_URL: DEAD_POSTGRES });

    const response = await fetch(`${base}/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });

    // Liveness must not check a dependency: one that fails on a database blip
    // restarts healthy processes during an incident and turns a database
    // problem into an outage.
    const second = await fetch(`${base}/health/live`);
    expect(second.status).toBe(200);
  });

  it('H2: /health/ready fails with PostgreSQL down', async () => {
    // First, the control: with everything up, all FOUR conditions are up.
    const healthy = await startApp();
    const ok = await ready(healthy);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(Object.keys(ok.body.info ?? {}).sort()).toEqual([
      'content',
      'migrations',
      'postgres',
      'redis',
    ]);
    await app?.close();
    app = undefined;

    const base = await startApp({ DATABASE_URL: DEAD_POSTGRES, DATABASE_APP_URL: DEAD_POSTGRES });
    const result = await ready(base);
    expect(result.status).toBe(503);
    expect(result.body.error?.['postgres']?.status).toBe('down');
  });

  it('H3: /health/ready fails with Redis down', async () => {
    const base = await startApp({ REDIS_URL: DEAD_REDIS });
    const result = await ready(base);

    expect(result.status).toBe(503);
    expect(result.body.error?.['redis']?.status).toBe('down');
    // ...and only Redis: a broken dependency must not be reported as four.
    expect(result.body.info?.['postgres']?.status).toBe('up');
    expect(result.body.info?.['content']?.status).toBe('up');
  });

  it('H4: /health/ready fails on a migration version mismatch', async () => {
    // A database that has moved ahead of this build — exactly the rolling
    // deploy this check exists to stop (§6.5).
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations"
         (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
       VALUES ($1, 'test', now(), $2, now(), 1)`,
      'health-h4-fake',
      '29990101000000_from_a_newer_build',
    );
    try {
      const base = await startApp();
      const result = await ready(base);
      expect(result.status).toBe(503);
      expect(result.body.error?.['migrations']?.status).toBe('down');
    } finally {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "_prisma_migrations" WHERE id = 'health-h4-fake'`,
      );
    }
  });

  it('H5: /health/ready fails when the content bundle is unavailable or invalid', async () => {
    // UNAVAILABLE: nothing published at all.
    await prisma.contentBundle.deleteMany();
    const missing = await startApp();
    const unavailable = await ready(missing);
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error?.['content']?.status).toBe('down');
    await app?.close();
    app = undefined;

    // INVALID: a row whose file no longer matches its checksum. Resolving
    // verifies the checksum, so a bundle whose bytes drifted is refused rather
    // than served under a running activity (§7.7).
    const artifact = buildBundle(PLACEHOLDER);
    await content.publish(prisma, artifact, directory, T0, () => {});
    await writeFile(
      bundleFilePath(directory, artifact.version),
      JSON.stringify({ ...artifact, definitions: [] }),
      'utf8',
    );

    const corrupt = await startApp();
    const invalid = await ready(corrupt);
    expect(invalid.status).toBe(503);
    expect(invalid.body.error?.['content']?.status).toBe('down');
  });

  it('exposes every §12.3 metric on /metrics', async () => {
    const base = await startApp();
    const response = await fetch(`${base}/metrics`);

    expect(response.status).toBe(200);
    const body = await response.text();
    for (const metric of [
      'occupancy_claims_active',
      'occupancy_conflicts_total',
      'settlement_duration_seconds',
      'settlement_failures_total',
      'idempotency_replays_total',
      'idempotency_conflicts_total',
      'ledger_reconciliation_mismatches',
      'migration_version',
      'content_bundle_version',
      'job_queue_depth',
      'job_age_seconds',
    ]) {
      expect(body, `${metric} is missing from /metrics`).toContain(metric);
    }

    // The two that say whether a deploy rolled out carry the version as a
    // label, and the reconciliation gauge must read zero.
    expect(body).toMatch(/migration_version\{version="\d{14}_[a-z0-9_]+"\} 1/);
    expect(body).toMatch(/content_bundle_version\{version="v[0-9a-f]{16}"\} 1/);
    expect(body).toMatch(/ledger_reconciliation_mismatches 0/);
  });
});
