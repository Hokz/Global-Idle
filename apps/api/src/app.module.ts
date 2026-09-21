import {
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import {
  CORRELATION_ID_HEADER,
  REDACTED_PATHS,
  createLogger,
  createMetrics,
  createMetricsPort,
  loadConfig,
  logDomainEvent,
  setObservability,
  type AppConfig,
} from '@global-idle/domain';
import { CorrelationMiddleware } from './correlation.middleware.js';
import { HealthModule } from './health/health.module.js';
import { GameModule } from './game/game.module.js';

@Module({})
export class AppModule implements NestModule {
  /**
   * Configuration is read ONCE, here, and injected downwards (§11.3). A test
   * overrides a field to point the same wiring at a dependency that is
   * deliberately down; production passes nothing and gets the environment.
   */
  static forRoot(overrides: Partial<AppConfig> = {}): DynamicModule {
    const config: AppConfig = { ...loadConfig(), ...overrides };

    // ONE metrics registry, created here and shared: /metrics reports it and
    // the domain reports INTO it, through the port. Two registries would mean
    // a counter that increments and a counter that is scraped.
    const metrics = createMetrics();
    const logger = createLogger({ level: config.LOG_LEVEL, app: 'api' });
    setObservability({
      metrics: createMetricsPort(metrics),
      events: (event) => logDomainEvent(logger, event),
    });

    const health = HealthModule.forRoot(config, metrics);

    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            // A CORRELATION ID PER REQUEST (§12.2), taken from the caller when
            // it supplies one so a trace survives the hop, and minted
            // otherwise. It is echoed back so the caller can quote it.
            genReqId: (req, res) => {
              const incoming = req.headers[CORRELATION_ID_HEADER];
              const id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
              res.setHeader(CORRELATION_ID_HEADER, id);
              return id;
            },
            customProps: (req) => ({ correlationId: req.id }),
            // NEVER LOGGED (§12.2). Redaction lives in the logger, not at the
            // call site that forgets.
            redact: { paths: [...REDACTED_PATHS], censor: '[redacted]' },
          },
        }),
        health,
        // Phase 1's player-facing routes, sharing the health root's Prisma
        // client and content resolver rather than building their own.
        GameModule.forRoot(config, health),
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*path');
  }
}
