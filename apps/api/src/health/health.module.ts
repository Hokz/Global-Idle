/**
 * The composition root for health, metrics and the runtime dependencies they
 * observe (§4.2). Everything is constructed from an {@link AppConfig}, and
 * nothing reads `process.env` below this point — which is what lets a test
 * point the same module at a database that is deliberately down (H1-H3).
 */
import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  MAINTENANCE_QUEUE,
  content,
  createPrismaClient,
  type AppConfig,
  type Metrics,
  type PrismaClient,
} from '@global-idle/domain';
import { HealthController } from './health.controller.js';
import { MetricsController } from './metrics.controller.js';
import { ReadinessIndicator } from './readiness.service.js';
import {
  APP_CONFIG,
  CONTENT_RESOLVER,
  MAINTENANCE_QUEUE_HANDLE,
  METRICS,
  PRISMA,
  REDIS_PROBE,
} from './tokens.js';

/**
 * A readiness probe must answer even when Redis is unreachable, AND must go
 * back to reporting up when Redis returns. A long-lived client cannot do both:
 * with retries disabled it never reconnects, and with them enabled a PING
 * against a dead host queues instead of failing.
 *
 * So the probe is a function, and each probe is its own short-lived
 * connection. It costs one TCP connect per scrape and is stateless, which is
 * exactly what a health check should be.
 */
function probeRedis(url: string): () => Promise<void> {
  return async () => {
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1_000,
      retryStrategy: () => null,
    });
    // An unreachable host emits `error`; without a listener Node treats it as
    // an unhandled exception and kills a process that is otherwise healthy —
    // the exact failure liveness exists to avoid.
    client.on('error', () => {});
    try {
      await client.connect();
      await client.ping();
    } finally {
      client.disconnect();
    }
  };
}

/** The queue handle exists only to READ depth for §12.3. Commands fail fast
 *  rather than queueing, and the metrics endpoint swallows the failure: a
 *  scrape must not hang because Redis is down. */
function metricsRedis(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1_000,
  });
  client.on('error', () => {});
  return client;
}

@Module({})
export class HealthModule implements OnApplicationShutdown {
  static forRoot(config: AppConfig, metrics: Metrics): DynamicModule {
    return {
      module: HealthModule,
      imports: [TerminusModule],
      controllers: [HealthController, MetricsController],
      providers: [
        ReadinessIndicator,
        { provide: APP_CONFIG, useValue: config },
        {
          provide: PRISMA,
          useFactory: (c: AppConfig) =>
            createPrismaClient({ connectionString: c.DATABASE_APP_URL ?? c.DATABASE_URL }),
          inject: [APP_CONFIG],
        },
        {
          provide: REDIS_PROBE,
          useFactory: (c: AppConfig) => probeRedis(c.REDIS_URL),
          inject: [APP_CONFIG],
        },
        {
          provide: CONTENT_RESOLVER,
          useFactory: (c: AppConfig, prisma: PrismaClient) =>
            content.createResolver(prisma, c.CONTENT_BUNDLE_DIR),
          inject: [APP_CONFIG, PRISMA],
        },
        {
          provide: MAINTENANCE_QUEUE_HANDLE,
          useFactory: (c: AppConfig) =>
            new Queue(MAINTENANCE_QUEUE, { connection: metricsRedis(c.REDIS_URL) }),
          inject: [APP_CONFIG],
        },
        // Provided by the caller, because the domain reports into this same
        // registry through the observability port (§12.3).
        { provide: METRICS, useValue: metrics },
      ],
      exports: [APP_CONFIG, PRISMA, REDIS_PROBE, CONTENT_RESOLVER, METRICS],
    };
  }

  // Explicit token, like every other injection here: the test runner's
  // transpiler emits no `design:paramtypes`, so inference is not available.
  constructor(@Inject(ModuleRef) private readonly moduleRef: ModuleRef) {}

  /** Nest tears the container down; the connections inside it are ours. */
  async onApplicationShutdown(): Promise<void> {
    const prisma = this.moduleRef.get<PrismaClient>(PRISMA, { strict: false });
    const queue = this.moduleRef.get<Queue>(MAINTENANCE_QUEUE_HANDLE, { strict: false });
    // The readiness probe owns no connection to close; that is the point of it
    // being a function.
    await queue.close();
    await prisma.$disconnect();
  }
}
