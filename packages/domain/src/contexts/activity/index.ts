// Public surface of the activity bounded context (ADR-001, ADR-018).
//
// This file is the ONLY legal entry point. Reaching past it into a sibling
// file is a dependency-cruiser violation, inside this package as much as
// across it (§4.1, tests W8 and W11).
export const CONTEXT_NAME = 'activity' as const;

export {
  ACTIVITY_TYPES,
  ActivityTypeRegistryError,
  HUNT,
  SKILL_TRAINING,
  assertRegistryCoversContentVocabulary,
  describe,
  registrySnapshot,
  validateRegistry,
} from './types/registry.js';
export { assertRegistryMatchesDatabase } from './types/reconciliation.js';

export { assertActivityIntegrity, findIntegrityViolations } from './integrity.js';
export type { IntegrityFinding } from './integrity.js';

export {
  acquire,
  isSessionBoundLive,
  isSkillTrainingLive,
  reconcileStranded,
  release,
  reserveForGrace,
} from './occupancy.js';
export type { ReleasedClaim, SessionBoundState, SkillTrainingStatus } from './occupancy.js';

export { endActivity, pauseForGrace, startSessionBound, startSkillTraining } from './lifecycle.js';
export type {
  EndResult,
  SkillTrainingTerminal,
  StartSessionBoundInput,
  StartSkillTrainingInput,
} from './lifecycle.js';

export { currentHolder, findExpiredGrace, isGraceExpired, transferClaim } from './claim.js';

export { invalidateClaim, readClaim, readClaimFromDatabase } from './claim-cache.js';
export type { ClaimView } from './claim-cache.js';

export { sweepExpiredGrace } from './sweeper.js';
export type { SweepResult } from './sweeper.js';
export type {
  ActivityFamily,
  ActivityTypeDescriptor,
  StaminaClassification,
} from './types/registry.js';
