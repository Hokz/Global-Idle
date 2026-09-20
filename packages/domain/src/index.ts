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

export { createPrismaClient } from './platform/prisma/client.js';
export type { PrismaClient, PrismaClientOptions } from './platform/prisma/client.js';

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

export { DomainError } from './platform/errors/index.js';
export type { DomainErrorCode } from './platform/errors/index.js';
