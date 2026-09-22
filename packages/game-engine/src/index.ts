// Pure simulation (ADR-010, §9).
//
// No I/O of any kind. Time is a parameter, randomness is injected and seeded,
// content arrives already resolved, and output DESCRIBES change rather than
// applying it. Test E3 proves the module graph contains no forbidden import,
// by running dependency-cruiser and ESLint and then introducing real
// violations to show the rules bite; E1 and E2 prove determinism, including
// across a process restart.
export const GAME_ENGINE_PACKAGE = '@global-idle/game-engine' as const;

export { createSeededRandom } from './random.js';
export type { SeededRandom } from './random.js';

export { normalRandom, uniformRandom } from './distributions.js';

export { TICK_MS, initialState, maxMeleeHit, minMeleeHit, simulateHunt } from './hunt.js';
export type {
  CombatProfile,
  CreatureStats,
  HuntCreatureState,
  HuntEndReason,
  HuntEvent,
  HuntReward,
  HuntState,
  HuntStep,
  RoomDefinition,
  RoomPlan,
  SupplyProfile,
} from './hunt.js';

export { simulateActivity } from './simulate.js';
export type {
  ActivityRunState,
  ParticipantOutcome,
  ParticipantProfile,
  ResolvedContentSlice,
  SimulationResult,
} from './simulate.js';
