/**
 * `/metrics` (§12.3).
 *
 * A scrape NEVER FAILS. Each population step is best-effort: a metrics
 * endpoint that returns 500 while the database is down removes the telemetry
 * exactly when it is needed, and the readiness endpoint is where a broken
 * dependency belongs.
 */
import { Controller, Get, Header, Inject } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  checkMigrationVersion,
  economy,
  setVersionGauge,
  type Metrics,
  type PrismaClient,
} from '@global-idle/domain';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { CONTENT_RESOLVER, MAINTENANCE_QUEUE_HANDLE, METRICS, PRISMA } from './tokens.js';

@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONTENT_RESOLVER) private readonly resolver: ContentBundleResolver,
    @Inject(MAINTENANCE_QUEUE_HANDLE) private readonly queue: Queue,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    await this.populate();
    return this.metrics.registry.metrics();
  }

  /** Gauges are point-in-time facts, so they are read at scrape rather than
   *  maintained by whoever last changed the underlying row. Counters and
   *  histograms are driven by their call sites instead. */
  private async populate(): Promise<void> {
    await this.safely(async () => {
      this.metrics.occupancyClaimsActive.set(await this.prisma.occupancyClaim.count());
    });

    await this.safely(async () => {
      const report = await checkMigrationVersion(this.prisma);
      setVersionGauge(this.metrics.migrationVersion, report.applied ?? 'none');
    });

    await this.safely(async () => {
      const current = await this.resolver.current();
      setVersionGauge(this.metrics.contentBundleVersion, current.version);
    });

    await this.safely(async () => {
      // §12.3: worker starvation. Read from the queue the worker consumes —
      // both applications agree on its NAME through packages/domain, and
      // neither imports the other (§5.2).
      const [waiting, delayed] = await Promise.all([
        this.queue.getJobCountByTypes('waiting'),
        this.queue.getJobCountByTypes('delayed'),
      ]);
      this.metrics.jobQueueDepth.labels(this.queue.name).set(waiting + delayed);

      const oldest = (await this.queue.getJobs(['waiting'], 0, 0, true))[0];
      const ageMs = oldest?.timestamp ? Date.now() - oldest.timestamp : 0;
      this.metrics.jobAgeSeconds.labels(this.queue.name).set(ageMs / 1000);
    });

    await this.safely(async () => {
      // MUST BE ZERO (§12.3, I5). Recomputed from the entries rather than read
      // off a column, because a projection that has drifted is exactly what
      // this is looking for.
      this.metrics.ledgerReconciliationMismatches.set(
        await economy.countReconciliationMismatches(this.prisma),
      );
    });
  }

  private async safely(body: () => Promise<void>): Promise<void> {
    try {
      await body();
    } catch {
      // Deliberately swallowed: see the class comment.
    }
  }
}
