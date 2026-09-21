// The only legal entry point into the application core (ADR-018).
//
// apps/api and apps/worker both depend on this package and never on each
// other. The worker's reconciliation job imports a context's public surface
// here and calls it — the same call path apps/api uses, no privileged access
// and no second implementation (§4.2).
export * as identity from './contexts/identity/index.js';
export * as character from './contexts/character/index.js';
export * as party from './contexts/party/index.js';
export * as activity from './contexts/activity/index.js';
export * as economy from './contexts/economy/index.js';
export * as content from './contexts/content/index.js';

export { createPrismaClient } from './platform/prisma/client.js';
export type { PrismaClient, PrismaClientOptions } from './platform/prisma/client.js';

export {
  appliedMigrationVersion,
  assertMigrationVersion,
  checkMigrationVersion,
  expectedMigrationVersion,
} from './platform/prisma/migrations.js';
export type { MigrationVersionReport } from './platform/prisma/migrations.js';

export {
  CORRELATION_ID_HEADER,
  REDACTED_PATHS,
  createLogger,
  currentCorrelationId,
  logDomainEvent,
  newCorrelationId,
  withCorrelationId,
} from './platform/logging/index.js';
export type { DomainLogEvent, Logger, LoggerConfig } from './platform/logging/index.js';

export {
  GRACE_EXPIRY_JOB,
  GRACE_SWEEP_INTERVAL_MS,
  GRACE_SWEEP_SCHEDULER,
  MAINTENANCE_QUEUE,
} from './platform/jobs/index.js';
export type { GraceExpiryJobData } from './platform/jobs/index.js';

export { createMetrics, setVersionGauge } from './platform/metrics/index.js';
export type { Metrics } from './platform/metrics/index.js';

export {
  withTransaction,
  isRetryable,
  lockAccount,
  lockBalance,
  lockCharactersInOrder,
} from './platform/transaction/index.js';
export type {
  UnitOfWork,
  IsolationLevel,
  TransactionOptions,
} from './platform/transaction/index.js';

export {
  createIdempotencyPort,
  fingerprintOf,
  settlementOperationId,
  claimSettlement,
} from './platform/idempotency/index.js';
export type {
  Fingerprint,
  IdempotencyKeyIdentity,
  IdempotencyPort,
  IdempotentOutcome,
} from './platform/idempotency/index.js';

export {
  SystemClock,
  FakeClock,
  ProcessMonotonicSource,
  reportRegression,
  CLOCK_REGRESSION_TOLERANCE,
} from './platform/clock/index.js';
export type { Clock, ClockRegressionObserver } from './platform/clock/index.js';

export { createTimerPort, remainingAt } from './platform/timer/index.js';
export type { ActiveUseTimerState, TimerPort } from './platform/timer/index.js';

export {
  ConfigurationError,
  LOG_LEVELS,
  configSchema,
  loadConfig,
} from './platform/config/index.js';
export type { AppConfig } from './platform/config/index.js';

export {
  DEFAULT_CACHE_TTL_SECONDS,
  REDIS_KEY_FAMILIES,
  UndocumentedRedisKey,
  activityClaimKey,
  assertRebuildable,
  contentCacheKey,
  createRedis,
  createRedisPort,
  familyOf,
  rateLimitKey,
  sessionPresenceKey,
} from './platform/redis/index.js';
export type { RedisKeyFamily, RedisPort } from './platform/redis/index.js';

export { DomainError } from './platform/errors/index.js';
export type { DomainErrorCode } from './platform/errors/index.js';
