/**
 * Structured logging (§12.2). JSON via pino, with a CORRELATION ID PER
 * REQUEST, propagated into jobs.
 *
 * §12.4 records why there is no tracing here: one deployable and one database
 * means a correlation id in structured logs answers what distributed tracing
 * would. The trigger for adopting it is explicit — a second deployable — so it
 * cannot drift in as ceremony.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { pino, type Logger, type LoggerOptions } from 'pino';
import { newId, type Instant } from '@global-idle/shared';

export type { Logger };

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * NEVER LOGGED (§12.2): credential material, session tokens, personal data
 * beyond an account id.
 *
 * Redaction belongs in the logger rather than at each call site, because the
 * call site that forgets is exactly the one that logs the token.
 */
export const REDACTED_PATHS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'email',
  '*.password',
  '*.token',
  '*.secret',
  '*.authorization',
  '*.cookie',
  '*.email',
  'req.headers.authorization',
  'req.headers.cookie',
] as const;

const storage = new AsyncLocalStorage<string>();

/**
 * A correlation id is a UUIDv7 like every other id here: sortable by time, so
 * a log search and a database scan order the same way.
 *
 * `at` is REQUIRED. Defaulting it to `new Date()` would put an ambient clock
 * read inside the domain, which §7.1 forbids and the lint rule catches.
 */
export function newCorrelationId(at: Instant): string {
  return newId<'CorrelationId'>(at);
}

/** Run `body` with this correlation id attached to every log line it produces,
 *  however deep the call stack goes. */
export function withCorrelationId<T>(correlationId: string, body: () => T): T {
  return storage.run(correlationId, body);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore();
}

export interface LoggerConfig {
  readonly level?: string;
  readonly app?: string;
}

export function createLogger(config: LoggerConfig = {}): Logger {
  const options: LoggerOptions = {
    level: config.level ?? 'info',
    base: config.app ? { app: config.app } : {},
    redact: { paths: [...REDACTED_PATHS], censor: '[redacted]' },
    // The correlation id is attached by the logger, not by the caller: a
    // mixin cannot be forgotten, and an argument can.
    mixin() {
      const correlationId = currentCorrelationId();
      return correlationId ? { correlationId } : {};
    },
  };
  return pino(options);
}

/**
 * ALWAYS LOGGED (§12.2). Typing the list means the compiler knows which events
 * exist, and a new one is added here rather than invented at a call site with
 * a different field name for the same thing.
 */
export type DomainLogEvent =
  | {
      readonly kind: 'economy.operation';
      readonly accountId: string;
      readonly currency: string;
      readonly amount: string;
      readonly reasonCode: string;
      readonly operationId: string;
    }
  | {
      readonly kind: 'occupancy.acquired';
      readonly activityId: string;
      readonly characterIds: readonly string[];
    }
  | { readonly kind: 'occupancy.released'; readonly activityId: string; readonly released: number }
  | {
      /** Phase 1 §18. A Character exists that did not before. */
      readonly kind: 'character.created';
      readonly characterId: string;
      readonly accountId: string;
    }
  | {
      /** Phase 2. A Hunt run stopped, and why. */
      readonly kind: 'hunt.ended';
      readonly activityId: string;
      readonly characterId: string;
      readonly reason: string;
      readonly room: number;
      readonly cycle: number;
    }
  | {
      readonly kind: 'activity.transition';
      readonly activityId: string;
      readonly family: string;
      readonly to: string;
    }
  | {
      readonly kind: 'session.evicted';
      readonly accountId: string;
      readonly previousSessionId: string | null;
      readonly newSessionId: string;
    }
  | {
      readonly kind: 'entitlement.transition';
      readonly accountId: string;
      readonly entitlementId: string;
      readonly transition: string;
    };

export function logDomainEvent(logger: Logger, event: DomainLogEvent): void {
  logger.info(event, event.kind);
}
