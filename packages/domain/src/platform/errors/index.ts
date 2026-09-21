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
  | 'InsufficientFunds'
  | 'OriginCharacterExists'
  | 'CharacterNameTaken'
  | 'ContentKindMismatch'
  | 'HuntNotFound';

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

/** I1b (Phase 1 §13.2): an account may hold at most one playable Origin
 *  Character — the un-vocationalized Level-1 one. Further Characters are
 *  vocation UNLOCKS starting at Level 8, which Phase 1 does not implement. */
export const originCharacterExists = (details: Record<string, unknown> = {}) =>
  new DomainError(
    'OriginCharacterExists',
    'This account already has its Origin Character.',
    details,
  );

export const characterNameTaken = (details: Record<string, unknown> = {}) =>
  new DomainError('CharacterNameTaken', 'That name is already used on this account.', details);

/** The content key resolved, but to the wrong KIND — a marker where a hunt was
 *  required. Shape is a database CHECK; kind lives in a bundle (§9.5). */
export const contentKindMismatch = (details: Record<string, unknown> = {}) =>
  new DomainError('ContentKindMismatch', 'That content key is not a hunt.', details);

export const huntNotFound = (details: Record<string, unknown> = {}) =>
  new DomainError('HuntNotFound', 'No such hunt in the pinned content bundle.', details);

// ─────────────────────────────────────────────────────────────────────────────
// What the DATABASE refused, read structurally (§8.3, §8.4)
// ─────────────────────────────────────────────────────────────────────────────

/** PostgreSQL class 23 — integrity constraint violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * The OccupancyClaim uniqueness constraints, BY NAME.
 *
 * `OccupancyClaim_pkey` is the primary key on `characterId` — I13 itself, and
 * the one a lost race actually trips, whichever activity the winner claimed
 * for. The composite is the redundant unique index Prisma requires on the
 * defining side of the 1:1; it guards the same thing, so it counts too.
 */
const OCCUPANCY_UNIQUE_CONSTRAINTS = new Set([
  'OccupancyClaim_pkey',
  'OccupancyClaim_activityId_characterId_key',
]);

interface DriverRefusal {
  readonly code?: string;
  readonly meta?: {
    readonly code?: string;
    readonly driverAdapterError?: {
      readonly cause?: {
        readonly originalCode?: string;
        readonly constraint?: { readonly index?: string };
        readonly table?: string;
      };
    };
  };
}

const refusal = (error: unknown) => (error as DriverRefusal)?.meta?.driverAdapterError?.cause;

/** The SQLSTATE the database raised, never the prose around it. */
function sqlState(error: unknown): string | undefined {
  const candidate = error as DriverRefusal;
  return (
    refusal(error)?.originalCode ??
    candidate?.meta?.code ??
    (typeof candidate?.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)
      ? candidate.code
      : undefined)
  );
}

/**
 * Did the database refuse this write because a Character ALREADY HOLDS a
 * claim — and nothing else?
 *
 * This predicate is deliberately narrow. `acquire` translates what it matches
 * into a typed `OccupancyConflict` and counts it in
 * `occupancy_conflicts_total`, so anything it matches wrongly becomes both a
 * lie to the caller and a lie in the metric: a foreign-key violation, a
 * connection failure or a permission error is not player contention, and a
 * SERIALIZATION FAILURE belongs to the retry layer (§8.3) — swallowing one
 * here would turn a retryable transaction into a spurious domain error.
 *
 * Measured against Prisma 7.10 with `@prisma/adapter-pg`: a lost race arrives
 * as P2002 with SQLSTATE 23505 and
 * `meta.driverAdapterError.cause.constraint.index` naming the constraint.
 * `meta.target` is NOT populated by this adapter, which is why nothing here
 * reads it. When the SQLSTATE says unique violation but no constraint name is
 * available, the table alone decides; when neither is, this returns false and
 * the original error propagates untouched — mislabelling is the worse failure.
 */
/** Did the database refuse this INSERT because the account already holds a
 *  playable Origin Character (I1b)? Same structural reading as
 *  {@link isOccupancyUniqueViolation}, and just as narrow. */
export function isOriginCharacterViolation(error: unknown): boolean {
  const candidate = error as DriverRefusal;
  const isUnique = candidate?.code === 'P2002' || sqlState(error) === UNIQUE_VIOLATION;
  return isUnique && refusal(error)?.constraint?.index === 'Character_accountId_key';
}

export function isOccupancyUniqueViolation(error: unknown): boolean {
  const candidate = error as DriverRefusal;
  const isUnique = candidate?.code === 'P2002' || sqlState(error) === UNIQUE_VIOLATION;
  if (!isUnique) return false;

  const constraint = refusal(error)?.constraint?.index;
  if (typeof constraint === 'string') return OCCUPANCY_UNIQUE_CONSTRAINTS.has(constraint);
  return refusal(error)?.table === 'OccupancyClaim';
}

/**
 * `StaminaExhausted` is deliberately NOT here. ADR-014 and
 * ACTIVITY_OCCUPANCY_AND_TIMERS.md §2.3 make it a STATE, not an error: it
 * never blocks combat. Modelling it as a throwable would invite a caller to
 * treat it as a failure, which is exactly the product rule it would break.
 */
export const STAMINA_EXHAUSTED_IS_A_STATE = true as const;
