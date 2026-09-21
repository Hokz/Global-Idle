/**
 * Character creation and retirement (§6.3, ADR-007). INTERNAL to the character
 * context.
 *
 * Two invariants meet here, and neither is enforced by validation alone:
 *
 * - I1, one PLAYABLE Character per vocation per account, is a partial unique
 *   index. This code does not check it; the database refuses it (D4, D5).
 * - I2, count(playable) <= rosterCapacity, cannot be a column constraint, so
 *   it is verified INSIDE the creating transaction with the Account row locked
 *   (§6.4, D8). That lock is also §8.5's first step, so two concurrent creates
 *   serialise rather than deadlock.
 */
import { newId, type AccountId, type CharacterId, type Instant } from '@global-idle/shared';
import {
  characterNameTaken,
  isOriginCharacterViolation,
  originCharacterExists,
  rosterCapacityExceeded,
} from '../../platform/errors/index.js';
import { lockAccount, type UnitOfWork } from '../../platform/transaction/index.js';
import { STAMINA_MAX } from './stamina/index.js';
import { deriveStaminaMode } from './stamina/index.js';

export type VocationName = 'KNIGHT' | 'PALADIN' | 'SORCERER' | 'DRUID' | 'MONK';

export interface CreateCharacterInput {
  readonly accountId: AccountId;
  /**
   * `null` is the ORIGIN Character: Level 1, no vocation yet, chosen at the
   * Level-8 Oracle (TUTORIAL_ROOKGAARD_ROADMAP.md §3, §34). It is NOT a sixth
   * vocation, and I1b lets an account hold only one.
   */
  readonly vocation: VocationName | null;
  readonly name: string;
  /** Origin Characters start at 1; an unlocked one will start at 8
   *  (DOMAIN_MODEL.md §5.5). Phase 1 only creates origins. */
  readonly baseLevel: number;
  readonly at: Instant;
}

/**
 * Create a playable Character, with its Stamina row, in one transaction.
 *
 * The Stamina row is created HERE rather than lazily on first read, because a
 * Character without one is a state the mode machinery has no answer for, and
 * "create it if missing" is how that state becomes permanent.
 */
export async function createCharacter(
  tx: UnitOfWork,
  input: CreateCharacterInput,
): Promise<CharacterId> {
  await lockAccount(tx, input.accountId);

  const { rosterCapacity } = await tx.account.findUniqueOrThrow({
    where: { id: input.accountId },
    select: { rosterCapacity: true },
  });
  const playable = await tx.character.count({
    where: { accountId: input.accountId, retiredAt: null },
  });
  if (playable >= rosterCapacity) {
    throw rosterCapacityExceeded({ accountId: input.accountId, playable, rosterCapacity });
  }

  // Names are unique among PLAYABLE characters on the account. Checked inside
  // the transaction, with the account row already locked above, so two
  // concurrent creates serialise rather than both passing the read.
  const nameTaken = await tx.character.findFirst({
    where: { accountId: input.accountId, retiredAt: null, name: input.name },
    select: { id: true },
  });
  if (nameTaken) throw characterNameTaken({ accountId: input.accountId, name: input.name });

  const id = newId<'CharacterId'>(input.at);
  try {
    await tx.character.create({
      data: {
        id,
        accountId: input.accountId,
        vocation: input.vocation,
        name: input.name,
        baseLevel: input.baseLevel,
        createdAt: input.at,
        retiredAt: null,
      },
    });
  } catch (error) {
    // I1b is the DATABASE's answer, not a read-then-write check here: an
    // application-only check loses to a concurrent create, which is the same
    // reasoning DOMAIN_MODEL.md §5.5 gives for I1. Only that constraint is
    // translated; anything else keeps its identity.
    if (!isOriginCharacterViolation(error)) throw error;
    throw originCharacterExists({ accountId: input.accountId });
  }
  await tx.characterStamina.create({
    data: {
      characterId: id,
      remainingMs: STAMINA_MAX,
      // DERIVED, never assigned: a Character holding no claim is recovering.
      mode: deriveStaminaMode({ claim: null }),
      modeSince: input.at,
      updatedAt: input.at,
    },
  });
  return id;
}

/**
 * ADR-007: retirement, not deletion. A Character is never hard-deleted (I12),
 * so there is no delete counterpart to this function and there must not be
 * one: history stays referentially intact, and the vocation is freed for a new
 * playable Character (D5).
 */
export async function retireCharacter(
  tx: UnitOfWork,
  characterId: CharacterId,
  at: Instant,
): Promise<void> {
  await tx.character.update({ where: { id: characterId }, data: { retiredAt: at } });
}
