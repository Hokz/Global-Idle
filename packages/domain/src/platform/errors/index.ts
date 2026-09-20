/**
 * The named failure modes of §8.4. Typed, so a caller handles the case rather
 * than pattern-matching a message — and so the compiler notices when a new one
 * appears.
 */
export type DomainErrorCode =
  | 'OccupancyConflict'
  | 'ActivityClaimHeld'
  | 'IdempotencyConflict'
  | 'EntitlementNotActive'
  | 'ContentBundleUnavailable'
  | 'MigrationVersionMismatch'
  | 'ActivityIntegrityViolation'
  | 'ActivityTypeUnknown'
  | 'RosterCapacityExceeded'
  | 'InsufficientFunds';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = code;
  }
}

export const occupancyConflict = (details: Record<string, unknown> = {}) =>
  new DomainError('OccupancyConflict', 'A Character already holds an occupancy claim.', details);

export const activityClaimHeld = (details: Record<string, unknown> = {}) =>
  new DomainError(
    'ActivityClaimHeld',
    'Another session holds the account activity claim.',
    details,
  );

export const idempotencyConflict = (details: Record<string, unknown> = {}) =>
  new DomainError(
    'IdempotencyConflict',
    'The same idempotency key was reused with a different request.',
    details,
  );

export const entitlementNotActive = (details: Record<string, unknown> = {}) =>
  new DomainError('EntitlementNotActive', 'No active entitlement of that kind.', details);

export const contentBundleUnavailable = (details: Record<string, unknown> = {}) =>
  new DomainError('ContentBundleUnavailable', 'The content bundle cannot be resolved.', details);

export const migrationVersionMismatch = (details: Record<string, unknown> = {}) =>
  new DomainError(
    'MigrationVersionMismatch',
    'The database schema is not at the expected migration version.',
    details,
  );

export const activityIntegrityViolation = (
  details: Record<string, unknown> = {},
  because?: string,
) =>
  new DomainError(
    'ActivityIntegrityViolation',
    because
      ? `Durable Activity structure is invalid; refusing to serve. ${because}`
      : 'Durable Activity structure is invalid; refusing to serve.',
    details,
  );

export const activityTypeUnknown = (details: Record<string, unknown> = {}) =>
  new DomainError('ActivityTypeUnknown', 'No such activity type in the registry.', details);

export const rosterCapacityExceeded = (details: Record<string, unknown> = {}) =>
  new DomainError('RosterCapacityExceeded', 'The account roster is full.', details);

export const insufficientFunds = (details: Record<string, unknown> = {}) =>
  new DomainError('InsufficientFunds', 'The account balance would go negative.', details);

/**
 * `StaminaExhausted` is deliberately NOT here. ADR-014 and
 * ACTIVITY_OCCUPANCY_AND_TIMERS.md §2.3 make it a STATE, not an error: it
 * never blocks combat. Modelling it as a throwable would invite a caller to
 * treat it as a failure, which is exactly the product rule it would break.
 */
export const STAMINA_EXHAUSTED_IS_A_STATE = true as const;
