// apps/worker — job consumers plus the composition root (§4.2).
//
// The SAME container image as apps/api, a different start command. It calls a
// bounded context's public surface from packages/domain, exactly as apps/api
// does, and never imports apps/api on any path (ADR-018, §5.2, test W10).
//
// Nothing here decides anything. The worker owns scheduling and shutdown; the
// domain owns every decision, read from persisted state (§11.2).
import { Worker } from 'bullmq';
import { pino } from 'pino';
import {
  SystemClock,
  activity,
  createPrismaClient,
  createRedis,
  loadConfig,
} from '@global-idle/domain';
import { runGraceExpiry } from './jobs/grace-expiry.js';
import {
  GRACE_SWEEP_INTERVAL_MS,
  MAINTENANCE_QUEUE,
  createMaintenanceQueue,
  scheduleGraceSweep,
} from './queues.js';

export function describeWorker(): string {
  return `worker ready; activity context surface: ${activity.CONTEXT_NAME}`;
}

export async function bootstrap(): Promise<() => Promise<void>> {
  // FAIL-FAST (§11.3): a worker that cannot see its configuration refuses to
  // start rather than failing on the first job.
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL, base: { app: 'worker' } });

  const prisma = createPrismaClient({
    connectionString: config.DATABASE_APP_URL ?? config.DATABASE_URL,
  });
  const clock = new SystemClock();

  // Separate connections: a Worker blocks on its connection, and sharing it
  // with the Queue would stall every produce behind a consume.
  const queueConnection = createRedis(config.REDIS_URL);
  const workerConnection = createRedis(config.REDIS_URL);

  const queue = createMaintenanceQueue(queueConnection);
  await scheduleGraceSweep(queue);

  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      const result = await runGraceExpiry(prisma, clock);
      if (result.ended.length > 0) {
        logger.info({ job: job.name, ended: result.ended }, 'reconnect grace expired');
      }
      return result;
    },
    { connection: workerConnection },
  );

  worker.on('failed', (job, error) => {
    // At-least-once delivery means a failed job is retried, and every job here
    // is idempotent, so this is reported rather than compensated.
    logger.error({ job: job?.name, err: error }, 'job failed');
  });

  logger.info(
    { queue: MAINTENANCE_QUEUE, sweepIntervalMs: GRACE_SWEEP_INTERVAL_MS },
    describeWorker(),
  );

  return async () => {
    await worker.close();
    await queue.close();
    queueConnection.disconnect();
    workerConnection.disconnect();
    await prisma.$disconnect();
  };
}

if (process.env['NODE_ENV'] !== 'test') {
  const shutdown = await bootstrap();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown().then(() => process.exit(0));
    });
  }
}
