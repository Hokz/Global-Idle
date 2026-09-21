/**
 * The observability boundary (§12.2, §12.3).
 *
 * Domain code reports WHAT HAPPENED through this port. It never imports
 * `prom-client` and never holds a logger: the adapter that turns a report into
 * a Prometheus counter or a pino line is bound once, by the composition root
 * of whichever application is running (§4.2).
 *
 * The default is a no-op, so a process that binds nothing still works — and a
 * test that binds its own port sees exactly its own events.
 *
 * THE EVENT HALF IS POST-COMMIT. A domain operation runs inside a transaction
 * that may still roll back, so an event recorded there is BUFFERED and emitted
 * only once the transaction commits. A "success" line for a write that later
 * disappeared is worse than no line at all.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DomainLogEvent } from '../logging/index.js';

/** The §12.3 metrics the domain itself is the only witness to. The gauges
 *  §12.3 also names are read at scrape time instead, from the database. */
export interface MetricsPort {
  /** An occupancy claim refused because the Character was already claimed. */
  occupancyConflict(): void;
  /** Wall time of one settlement operation, in seconds. */
  settlementDuration(seconds: number): void;
  /** A settlement that failed. NOT an idempotent no-op. */
  settlementFailure(): void;
  /** A request answered from a stored idempotent outcome. */
  idempotencyReplay(): void;
  /** An idempotency key reused with a different request fingerprint. */
  idempotencyConflict(): void;
}

export type DomainEventSink = (event: DomainLogEvent) => void;

export interface ObservabilityPort {
  readonly metrics: MetricsPort;
  readonly events: DomainEventSink;
}

const NO_OP: ObservabilityPort = {
  metrics: {
    occupancyConflict() {},
    settlementDuration() {},
    settlementFailure() {},
    idempotencyReplay() {},
    idempotencyConflict() {},
  },
  events() {},
};

let bound: ObservabilityPort = NO_OP;

/**
 * Bind the adapter. Returns a function that restores the previous binding, so
 * a test can install its own port and put the old one back without knowing
 * what it was.
 */
export function setObservability(port: ObservabilityPort): () => void {
  const previous = bound;
  bound = port;
  return () => {
    bound = previous;
  };
}

export function observability(): ObservabilityPort {
  return bound;
}

/** What the domain calls. Reads the binding at CALL time, so rebinding works
 *  even for a module that captured this object at import. */
export const metrics: MetricsPort = {
  occupancyConflict: () => bound.metrics.occupancyConflict(),
  settlementDuration: (seconds) => bound.metrics.settlementDuration(seconds),
  settlementFailure: () => bound.metrics.settlementFailure(),
  idempotencyReplay: () => bound.metrics.idempotencyReplay(),
  idempotencyConflict: () => bound.metrics.idempotencyConflict(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Events, emitted only after the transaction that produced them commits
// ─────────────────────────────────────────────────────────────────────────────

const pending = new AsyncLocalStorage<DomainLogEvent[]>();

/**
 * Report a domain event.
 *
 * Inside {@link withCommittedEvents} — which `withTransaction` establishes for
 * every attempt — the event is held until the transaction commits. Outside
 * one it is emitted immediately, which is correct for a caller that is not in
 * a transaction and is the only honest thing to do for one that is running a
 * transaction some other way.
 */
export function recordDomainEvent(event: DomainLogEvent): void {
  const buffer = pending.getStore();
  if (buffer) buffer.push(event);
  else bound.events(event);
}

/**
 * Collect the domain events `body` reports and emit them ONLY if it resolves.
 *
 * One buffer per call, which is why `withTransaction` wraps each ATTEMPT
 * rather than the whole retry loop: a serialization failure rolls its writes
 * back, and the events it reported must go with them.
 */
export async function withCommittedEvents<T>(body: () => Promise<T>): Promise<T> {
  const buffer: DomainLogEvent[] = [];
  const result = await pending.run(buffer, body);
  for (const event of buffer) bound.events(event);
  return result;
}

/** Time `body` and report it as a settlement: duration always, failure only
 *  when it throws. An idempotent no-op is a settlement that ran, not one that
 *  failed (§7.6). */
export async function measureSettlement<T>(body: () => Promise<T>): Promise<T> {
  const startedAt = process.hrtime.bigint();
  try {
    return await body();
  } catch (error) {
    metrics.settlementFailure();
    throw error;
  } finally {
    metrics.settlementDuration(Number(process.hrtime.bigint() - startedAt) / 1e9);
  }
}
