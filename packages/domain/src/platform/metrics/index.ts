/**
 * Metrics from day one (§12.3).
 *
 * Every metric in the table exists here, named exactly as the specification
 * names it. A dashboard built against this file and a dashboard built against
 * §12.3 are the same dashboard.
 *
 * `createMetrics` returns a FRESH registry rather than mutating a global one:
 * prom-client throws when a metric name is registered twice, and a module-level
 * singleton makes that a function of import order.
 */
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { MetricsPort } from '../observability/index.js';

export interface Metrics {
  readonly registry: Registry;
  /** Claim leaks. */
  readonly occupancyClaimsActive: Gauge;
  /** Contention, or a client bug. */
  readonly occupancyConflictsTotal: Counter;
  /** The hot path degrading. */
  readonly settlementDurationSeconds: Histogram;
  /** Correctness trouble. */
  readonly settlementFailuresTotal: Counter;
  /** Client retry behaviour. */
  readonly idempotencyReplaysTotal: Counter;
  readonly idempotencyConflictsTotal: Counter;
  /** Phase 1 §18. Why a character was not created. */
  readonly characterCreationFailuresTotal: Counter;
  /** The Atlas could not read its bundle — a broken deploy, not a user error. */
  readonly atlasContentLoadFailuresTotal: Counter;
  /** Why entering a Hunt was refused. */
  readonly huntEntryFailuresTotal: Counter;
  /** Which session-scoped route refused a request. */
  readonly authorizationRejectsTotal: Counter;
  /** MUST BE ZERO. Any non-zero value is a P1 (ADR-003, I5). */
  readonly ledgerReconciliationMismatches: Gauge;
  /** Whether a deploy actually rolled out. */
  readonly migrationVersion: Gauge;
  /** The same, for content. */
  readonly contentBundleVersion: Gauge;
  /** Worker starvation. */
  readonly jobQueueDepth: Gauge;
  readonly jobAgeSeconds: Gauge;
}

export function createMetrics(options: { defaultMetrics?: boolean } = {}): Metrics {
  const registry = new Registry();
  if (options.defaultMetrics !== false) collectDefaultMetrics({ register: registry });

  const counter = (name: string, help: string, labelNames: string[] = []) =>
    new Counter({ name, help, labelNames, registers: [registry] });
  const gauge = (name: string, help: string, labelNames: string[] = []) =>
    new Gauge({ name, help, labelNames, registers: [registry] });

  return {
    registry,
    occupancyClaimsActive: gauge('occupancy_claims_active', 'Occupancy claims currently held'),
    occupancyConflictsTotal: counter(
      'occupancy_conflicts_total',
      'Occupancy claim acquisitions refused because a Character was already claimed',
    ),
    settlementDurationSeconds: new Histogram({
      name: 'settlement_duration_seconds',
      help: 'Wall time of a settlement transaction',
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    settlementFailuresTotal: counter('settlement_failures_total', 'Settlements that failed'),
    idempotencyReplaysTotal: counter(
      'idempotency_replays_total',
      'Requests answered from a stored idempotent outcome',
    ),
    idempotencyConflictsTotal: counter(
      'idempotency_conflicts_total',
      'Idempotency keys reused with a different request fingerprint',
    ),
    characterCreationFailuresTotal: counter(
      'character_creation_failures_total',
      'Character creations refused, by reason',
      ['reason'],
    ),
    atlasContentLoadFailuresTotal: counter(
      'atlas_content_load_failures_total',
      'Atlas requests that could not resolve a content bundle',
    ),
    huntEntryFailuresTotal: counter(
      'hunt_entry_failures_total',
      'Hunt entries refused, by reason',
      ['reason'],
    ),
    authorizationRejectsTotal: counter(
      'authorization_rejects_total',
      'Requests refused by a session-scoped route, by route template',
      ['route'],
    ),
    ledgerReconciliationMismatches: gauge(
      'ledger_reconciliation_mismatches',
      'Accounts whose balance projection disagrees with the ledger. Any non-zero value is a P1',
    ),
    // The VALUE is a timestamp or a constant 1; the identity is in the label,
    // because a version is not a number you can average.
    migrationVersion: gauge('migration_version', 'The migration the database is at, as a label', [
      'version',
    ]),
    contentBundleVersion: gauge(
      'content_bundle_version',
      'The current content bundle, as a label',
      ['version'],
    ),
    jobQueueDepth: gauge('job_queue_depth', 'Jobs waiting in a queue', ['queue']),
    jobAgeSeconds: gauge('job_age_seconds', 'Age of the oldest waiting job', ['queue']),
  };
}

/** Set a version gauge so only the CURRENT version is reported. Leaving the
 *  previous label in place makes a rolled-back deploy look like two. */
export function setVersionGauge(gauge: Gauge, version: string): void {
  gauge.reset();
  gauge.labels(version).set(1);
}

/**
 * The adapter: turns what the domain reports into the collectors above.
 *
 * This is the ONLY place the two sides meet. `packages/domain`'s contexts
 * report through `MetricsPort` and never see prom-client, which is what keeps
 * the counter's existence and the behaviour it counts in different modules
 * (§12.3).
 */
export function createMetricsPort(metrics: Metrics): MetricsPort {
  return {
    occupancyConflict: () => metrics.occupancyConflictsTotal.inc(),
    settlementDuration: (seconds) => metrics.settlementDurationSeconds.observe(seconds),
    settlementFailure: () => metrics.settlementFailuresTotal.inc(),
    idempotencyReplay: () => metrics.idempotencyReplaysTotal.inc(),
    idempotencyConflict: () => metrics.idempotencyConflictsTotal.inc(),
    characterCreationFailure: (reason) =>
      metrics.characterCreationFailuresTotal.labels(reason).inc(),
    atlasContentLoadFailure: () => metrics.atlasContentLoadFailuresTotal.inc(),
    huntEntryFailure: (reason) => metrics.huntEntryFailuresTotal.labels(reason).inc(),
    authorizationReject: (route) => metrics.authorizationRejectsTotal.labels(route).inc(),
  };
}
