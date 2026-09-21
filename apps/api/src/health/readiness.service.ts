/**
 * Readiness (§12.1). FOUR conditions, each one independently able to hold
 * traffic back:
 *
 *   1. PostgreSQL reachable
 *   2. the migration version matches the one this build ships
 *   3. Redis reachable
 *   4. the current content bundle is available AND valid
 *
 * Every check is BOUNDED. A readiness probe that can hang is worse than one
 * that fails: the orchestrator learns nothing and waits.
 */
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { assertMigrationVersion, content, type PrismaClient } from '@global-idle/domain';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { CONTENT_RESOLVER, PRISMA, REDIS_PROBE } from './tokens.js';

/** Connect, PING, disconnect. See the provider for why it is a function. */
export type RedisProbe = () => Promise<void>;

export const READINESS_TIMEOUT_MS = 2_000;

/**
 * Every dependency is injected by an EXPLICIT token. Nest can infer a
 * class-typed parameter from `design:paramtypes`, but that metadata only
 * exists when the compiler emits it — esbuild, which the test runner uses,
 * does not. Explicit tokens make the wiring the same under every toolchain.
 */
@Injectable()
export class ReadinessIndicator {
  constructor(
    @Inject(HealthIndicatorService) private readonly health: HealthIndicatorService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS_PROBE) private readonly pingRedis: RedisProbe,
    @Inject(CONTENT_RESOLVER) private readonly resolver: ContentBundleResolver,
  ) {}

  database(): PromiseLike<HealthIndicatorResult> {
    return this.health
      .check('postgres')
      .attempt(async () => {
        await this.prisma.$queryRawUnsafe('SELECT 1');
      })
      .withTimeout(READINESS_TIMEOUT_MS);
  }

  /** A stale instance must not serve traffic against a newer schema (§6.5). */
  migrations(): PromiseLike<HealthIndicatorResult> {
    return this.health
      .check('migrations')
      .attempt(async () => ({ version: await assertMigrationVersion(this.prisma) }))
      .withTimeout(READINESS_TIMEOUT_MS);
  }

  cache(): PromiseLike<HealthIndicatorResult> {
    return this.health
      .check('redis')
      .attempt(async () => {
        await this.pingRedis();
      })
      .withTimeout(READINESS_TIMEOUT_MS);
  }

  /** `available AND valid`: resolving verifies the checksum, so a bundle whose
   *  bytes drifted fails here rather than being served (§7.7). */
  content(): PromiseLike<HealthIndicatorResult> {
    return this.health
      .check('content')
      .attempt(async () => ({
        version: await content.assertCurrentBundleAvailable(this.resolver),
      }))
      .withTimeout(READINESS_TIMEOUT_MS);
  }
}
