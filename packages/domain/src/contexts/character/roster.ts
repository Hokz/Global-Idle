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
import { rosterCapacityExceeded } from '../../platform/errors/index.js';
import { lockAccount, type UnitOfWork } from '../../platform/transaction/index.js';
import { STAMINA_MAX } from './stamina/index.js';
import { deriveStaminaMode } from './stamina/index.js';

export type VocationName = 'KNIGHT' | 'PALADIN' | 'SORCERER' | 'DRUID' | 'MONK';

export interface CreateCharacterInput {
  readonly accountId: AccountId;
  readonly vocation: VocationName;
  readonly name: string;
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

  const id = newId<'CharacterId'>(input.at);
  await tx.character.create({
    data: {
      id,
      accountId: input.accountId,
      vocation: input.vocation,
      name: input.name,
      createdAt: input.at,
      retiredAt: null,
    },
  });
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
