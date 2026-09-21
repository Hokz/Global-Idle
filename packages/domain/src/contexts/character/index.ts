// Public surface of the Character bounded context (ADR-001).
//
// This file is the ONLY legal entry point (§4.1, tests W8 and W11).
// The Character context owns roster capacity and per-Character Stamina, even
// though rosterCapacity is stored on the Account row (DOMAIN_MODEL.md §5.4).
export const CONTEXT_NAME = 'character' as const;

export { createCharacter, retireCharacter } from './roster.js';
export type { CreateCharacterInput, VocationName } from './roster.js';

export {
  deriveStaminaMode,
  settleConsumption,
  settleNeutral,
  settleRecovery,
  STAMINA_MAX,
  STAMINA_RECOVERY_BOUNDARY,
  ZERO_STAMINA,
} from './stamina/index.js';
export type {
  CharacterStaminaState,
  OccupancyView,
  StaminaMode,
  StaminaSegment,
} from './stamina/index.js';

export { settleStamina } from './stamina/settlement.js';
export type { SettleStaminaInput, StaminaSettlement } from './stamina/settlement.js';
