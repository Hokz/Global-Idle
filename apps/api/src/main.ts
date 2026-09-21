// apps/api — HTTP and realtime adapters plus the composition root (§4.2).
// Thin: adapters and wiring, no domain logic. It reaches the domain only
// through packages/domain, and never imports apps/worker (§5.2, test W10).
import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { createApp } from './app.factory.js';
import {
  activity,
  createPrismaClient,
  loadConfig,
  withTransaction,
  type PrismaClient,
} from '@global-idle/domain';

/**
 * STARTUP REFUSALS (§7.3.2, §6.3.3). Not readiness checks: these are
 * conditions under which the process must not run at all, because serving
 * would mean serving from a durable state the code has no correct answer for.
 * A refusal here is loud and immediate; a readiness failure would be quiet and
 * indefinite.
 */
export async function runStartupChecks(prisma: PrismaClient): Promise<void> {
  activity.validateRegistry();
  await withTransaction(prisma, async (tx) => {
    await activity.assertRegistryMatchesDatabase(tx);
    await activity.assertActivityIntegrity(tx);
  });
}

export async function bootstrap(): Promise<INestApplication> {
  // FAIL-FAST (§11.3): configuration first, before anything opens a socket.
  const config = loadConfig();

  const prisma = createPrismaClient({
    connectionString: config.DATABASE_APP_URL ?? config.DATABASE_URL,
  });
  try {
    await runStartupChecks(prisma);
  } finally {
    await prisma.$disconnect();
  }

  const app = await createApp({}, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.listen(config.API_PORT);
  return app;
}

if (process.env['NODE_ENV'] !== 'test') {
  await bootstrap();
}
