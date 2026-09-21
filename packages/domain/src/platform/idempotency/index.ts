/**
 * Idempotency (§7.6, ADR-017). Two mechanisms, deliberately separate.
 *
 * CLIENT COMMANDS are keyed on the FULL identity — principal, namespace and
 * client key — never the client key alone, so the same key on two accounts
 * cannot collide or leak. The fingerprint is a canonical hash of the
 * semantically significant fields, so field order or formatting cannot cause a
 * false mismatch.
 *
 * SERVER SETTLEMENTS use a deterministic operation id and a unique constraint,
 * so a retry after a lost response cannot double-apply.
 */
import { createHash } from 'node:crypto';
import type { AccountId, Instant, OperationId } from '@global-idle/shared';
import { measureSettlement, metrics } from '../observability/index.js';
import type { UnitOfWork } from '../transaction/index.js';

export interface IdempotencyKeyIdentity {
  readonly principalId: AccountId;
  readonly commandNamespace: string;
  readonly clientKey: string;
}

export type Fingerprint = string & { readonly __fingerprint: unique symbol };

/**
 * A canonical hash of the request's semantically significant fields.
 *
 * Object keys are sorted at every depth, so `{a:1,b:2}` and `{b:2,a:1}` agree:
 * a client that serialises its own payload differently on a retry must not be
 * told its request changed.
 */
export function fingerprintOf(payload: unknown): Fingerprint {
  return createHash('sha256').update(canonicalise(payload)).digest('hex') as Fingerprint;
}

function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
}

/**
 * A conflict is an OUTCOME here, not a throw: §7.6's port returns it so the
 * caller can answer the client without exception handling. Callers that would
 * rather throw use `idempotencyConflict()` from ../errors, which is §8.4's
 * named failure mode for exactly this.
 */
export type IdempotentOutcome<T> =
  | { readonly outcome: 'executed'; readonly result: T }
  | { readonly outcome: 'replayed'; readonly result: T }
  | { readonly outcome: 'conflict' };

export interface IdempotencyPort {
  execute<T>(
    identity: IdempotencyKeyIdentity,
    fingerprint: Fingerprint,
    at: Instant,
    body: (tx: UnitOfWork) => Promise<T>,
  ): Promise<IdempotentOutcome<T>>;
}

type Runner = <T>(body: (tx: UnitOfWork) => Promise<T>) => Promise<T>;

export function createIdempotencyPort(runInTransaction: Runner): IdempotencyPort {
  return {
    async execute(identity, fingerprint, at, body) {
      type R = Awaited<ReturnType<typeof body>>;

      // An existing record decides the outcome before anything runs. A
      // fingerprint mismatch REJECTS EXPLICITLY: it does not execute and does
      // not overwrite (§7.6). It is never retried (§8.3).
      const existing = await runInTransaction(async (tx) =>
        tx.idempotencyRecord.findUnique({
          where: {
            principalId_commandNamespace_clientKey: {
              principalId: identity.principalId,
              commandNamespace: identity.commandNamespace,
              clientKey: identity.clientKey,
            },
          },
        }),
      );

      if (existing) return answerFrom<R>(existing, fingerprint);

      try {
        const result = await runInTransaction(async (tx) => {
          const value = await body(tx);
          // The record is written in the SAME transaction as the command's own
          // writes (§8.1), so a crash cannot leave one without the other.
          await tx.idempotencyRecord.create({
            data: {
              principalId: identity.principalId,
              commandNamespace: identity.commandNamespace,
              clientKey: identity.clientKey,
              fingerprint,
              result: value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
              createdAt: at,
            },
          });
          return value;
        });
        return { outcome: 'executed', result };
      } catch (error) {
        // Another caller won the race on the same key. Re-read and answer from
        // what they wrote rather than reporting a failure the client cannot act
        // on.
        if (isUniqueViolation(error)) {
          const raced = await runInTransaction(async (tx) =>
            tx.idempotencyRecord.findUnique({
              where: {
                principalId_commandNamespace_clientKey: {
                  principalId: identity.principalId,
                  commandNamespace: identity.commandNamespace,
                  clientKey: identity.clientKey,
                },
              },
            }),
          );
          if (raced) return answerFrom<R>(raced, fingerprint);
        }
        throw error;
      }
    },
  };
}

/**
 * Answer from a stored record, and COUNT WHICH ANSWER IT WAS (§12.3).
 *
 * Both outcomes are returned from two places — the pre-check and the
 * lost-race re-read — so the counting lives here rather than at four call
 * sites where one could be forgotten or double-counted.
 */
function answerFrom<T>(
  record: { fingerprint: string; result: unknown },
  fingerprint: Fingerprint,
): IdempotentOutcome<T> {
  if (record.fingerprint !== fingerprint) {
    metrics.idempotencyConflict();
    return { outcome: 'conflict' };
  }
  metrics.idempotencyReplay();
  return { outcome: 'replayed', result: (record.result as T) ?? (undefined as T) };
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; meta?: { code?: string } };
  return candidate?.code === 'P2002' || candidate?.meta?.code === '23505';
}

/**
 * The deterministic operation id a server settlement carries (§7.6).
 * Same activity, same checkpoint => same id, so a replay is a no-op.
 */
export function settlementOperationId(activityId: string, checkpointSequence: number): OperationId {
  return `settle:${activityId}:${checkpointSequence}` as OperationId;
}

/**
 * Record a settlement exactly once. Returns false when it was already applied.
 *
 * This IS the settlement operation Phase 0B has: §19 forbids building the
 * reward loop here, so there is no settlement body to wrap yet. The timing and
 * failure counting live on the primitive rather than on a caller, so the
 * phase that adds a body inherits the instrumentation instead of having to
 * remember it (§12.3).
 *
 * An already-applied settlement is a no-op, NOT a failure: it is exactly the
 * outcome idempotency exists to produce.
 */
export async function claimSettlement(
  tx: UnitOfWork,
  operationId: OperationId,
  kind: string,
  at: Instant,
): Promise<boolean> {
  return measureSettlement(async () => {
    const inserted = await tx.$executeRawUnsafe(
      `INSERT INTO "SettlementOperation" ("operationId", "kind", "appliedAt")
       VALUES ($1, $2, $3) ON CONFLICT ("operationId") DO NOTHING`,
      operationId,
      kind,
      at,
    );
    return inserted === 1;
  });
}
