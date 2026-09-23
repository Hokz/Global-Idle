// Pure simulation (ADR-010, §9).
//
// No I/O of any kind. Time is a parameter, randomness is injected and seeded,
// content arrives already resolved, and output DESCRIBES change rather than
// applying it. Test E3 proves the module graph contains no forbidden import,
// by running dependency-cruiser and ESLint and then introducing real
// violations to show the rules bite; E1 and E2 prove determinism, including
// across a process restart.
export const GAME_ENGINE_PACKAGE = '@global-idle/game-engine' as const;

export {
  SEEDED_RANDOM_ALGORITHM,
  createSeededRandom,
  isSeededRandomState,
  restoreSeededRandom,
} from './random.js';
export type { SeededRandom, SeededRandomState } from './random.js';

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

// Phase 3.5 — space. Pure, deterministic, and the only place that knows what
// a tile is.
export { CHARACTER_ACTOR } from './hunt.js';
export {
  BLOCK_PATH,
  BLOCK_PROJECTILE,
  BLOCK_SOLID,
  DEFAULT_GROUND_SPEED,
  DIAGONAL_WALK_COST,
  KIND_CODES,
  MAX_GROUND_SPEED,
  MapError,
  NORMAL_WALK_COST,
  STEPS,
  blocksProjectile,
  canOccupy,
  canPathThrough,
  chebyshev,
  compileMap,
  connectorAt,
  groundSpeedAt,
  isAdjacent,
  isInside,
  isWalkable,
  manhattan,
  meleeGoals,
  samePosition,
  stepCost,
  stepToward,
  tileIndex,
} from './space.js';
export type {
  ConnectorKind,
  MapConnector,
  MapConnectorSource,
  MapLegendEntry,
  MapRegion,
  MapRegionSource,
  MapSource,
  MapTileDefinition,
  TileKindName,
  TileMap,
  TilePosition,
} from './space.js';
export {
  BEAT_MS,
  DEFAULT_STEP_SPEED,
  DIAGONAL_STEP_FACTOR,
  PLAYER_MIN_STEP_SPEED,
  playerBaseStepSpeed,
  stepDurationMs,
} from './hunt.js';
export type { Movement, SpatialPlan } from './hunt.js';
