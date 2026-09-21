import { Module, type DynamicModule } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import {
  CORRELATION_ID_HEADER,
  REDACTED_PATHS,
  loadConfig,
  type AppConfig,
} from '@global-idle/domain';
import { HealthModule } from './health/health.module.js';

@Module({})
export class AppModule {
  /**
   * Configuration is read ONCE, here, and injected downwards (§11.3). A test
   * overrides a field to point the same wiring at a dependency that is
   * deliberately down; production passes nothing and gets the environment.
   */
  static forRoot(overrides: Partial<AppConfig> = {}): DynamicModule {
    const config: AppConfig = { ...loadConfig(), ...overrides };
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
        HealthModule.forRoot(config),
      ],
    };
  }
}
