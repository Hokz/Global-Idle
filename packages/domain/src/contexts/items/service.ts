/**
 * The Rookgaard counter — buy, refill, sell (Phase 3 spec §13).
 *
 * INTERNAL to the items context. ONE counter, not an NPC with a chat tree and
 * not a city: Phase 3 builds the trade the loop needs and leaves the town to
 * the phase that owns towns.
 *
 * The two rules that matter are both about ATOMICITY. A purchase routes the
 * goods BEFORE it takes the money, so a delivery that cannot happen cannot be
 * charged for. A sale removes the item and credits the Bank in one
 * transaction, so a sold stack cannot be sold twice.
 */
import { type Instant, type OperationId } from '@global-idle/shared';
import type { ResolvedBundle } from '@global-idle/game-data';
import { illegalItemMove, insufficientFunds } from '../../platform/errors/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';
import { bankOf, post, pouchOf, readBalance } from '../economy/index.js';
import { assertSafeContext } from './access.js';
import { itemDefinition, serviceDefinition } from './catalogue.js';
import { CARRIED_SOURCES, lockItems, readItemForCharacterAction } from './custody.js';
import { route } from './routing.js';

export interface Purchase {
  readonly definitionKey: string;
  readonly quantity: number;
  readonly cost: bigint;
  readonly fromPouch: bigint;
  readonly fromBank: bigint;
  readonly containerId: string;
}

/**
 * Buy, paying the POUCH FIRST and the Bank second.
 *
 * Locked priority, and it is the player-friendly one: carried Gold is at risk
 * until it is banked, so spending it first is what a player would do by hand.
 * A purchase that needs both is still ONE operation id and one transaction.
 */
export async function buy(
  tx: UnitOfWork,
  input: {
    readonly bundle: ResolvedBundle;
    readonly serviceKey: string;
    readonly accountId: string;
    readonly characterId: string;
    readonly baseLevel: number;
    readonly definitionKey: string;
    readonly quantity: number;
    readonly operationId: OperationId;
    readonly at: Instant;
  },
): Promise<Purchase> {
  await assertSafeContext(tx, input.characterId, 'buy');
  const service = serviceDefinition(input.bundle, input.serviceKey);
  const entry = service.sells.find((row) => row.itemKey === input.definitionKey);
  if (!entry) {
    throw illegalItemMove({
      definitionKey: input.definitionKey,
      reason: 'the counter does not sell it',
    });
  }
  if (input.quantity <= 0) {
    throw illegalItemMove({ definitionKey: input.definitionKey, quantity: input.quantity });
  }

  const cost = BigInt(entry.price) * BigInt(input.quantity);
  const pouch = pouchOf(input.accountId as never, input.characterId);
  const bank = bankOf(input.accountId as never);
  const carriedGold = await readBalance(tx, pouch, 'GOLD');
  const bankedGold = await readBalance(tx, bank, 'GOLD');
  if (carriedGold + bankedGold < cost) {
    throw insufficientFunds({
      accountId: input.accountId,
      currency: 'GOLD',
      balance: (carriedGold + bankedGold).toString(),
      requested: cost.toString(),
    });
  }

  // ROUTE FIRST. If the goods cannot be delivered this throws, the transaction
  // rolls back, and nothing was charged — which is the difference between a
  // failed purchase and a theft.
  const delivered = await route(tx, {
    bundle: input.bundle,
    accountId: input.accountId,
    characterId: input.characterId,
    baseLevel: input.baseLevel,
    definitionKey: input.definitionKey,
    quantity: input.quantity,
    at: input.at,
  });

  const fromPouch = carriedGold < cost ? carriedGold : cost;
  const fromBank = cost - fromPouch;
  if (fromPouch > 0n) {
    await post(tx, {
      subject: pouch,
      currency: 'GOLD',
      amount: -fromPouch,
      reasonCode: 'service.buy',
      operationId: input.operationId,
      at: input.at,
    });
  }
  if (fromBank > 0n) {
    await post(tx, {
      subject: bank,
      currency: 'GOLD',
      amount: -fromBank,
      reasonCode: 'service.buy',
      operationId: input.operationId,
      at: input.at,
    });
  }

  return {
    definitionKey: input.definitionKey,
    quantity: input.quantity,
    cost,
    fromPouch,
    fromBank,
    containerId: delivered.containerId,
  };
}

/**
 * Sell a physical stack. The proceeds go to the BANK.
 *
 * Deliberately the Bank and not the Pouch: a sale happens at a counter, which
 * only exists in a safe context, and money that arrived somewhere safe should
 * not need a second trip to become safe.
 */
export async function sell(
  tx: UnitOfWork,
  input: {
    readonly bundle: ResolvedBundle;
    readonly serviceKey: string;
    readonly accountId: string;
    readonly characterId: string;
    readonly instanceId: string;
    readonly quantity?: number;
    readonly operationId: OperationId;
    readonly at: Instant;
  },
): Promise<{ readonly quantity: number; readonly proceeds: bigint }> {
  await assertSafeContext(tx, input.characterId, 'sell');
  await lockItems(tx, [input.instanceId]);
  // The ACTING Character's own carried item, and nothing else: not another
  // Character's, not something still worn, not a container still installed.
  const item = await readItemForCharacterAction(tx, {
    accountId: input.accountId,
    characterId: input.characterId,
    instanceId: input.instanceId,
    allow: CARRIED_SOURCES,
  });
  const definition = itemDefinition(input.bundle, item.definitionKey);
  if (!definition.sellable) {
    throw illegalItemMove({ instanceId: item.id, reason: 'the definition is not sellable' });
  }

  const service = serviceDefinition(input.bundle, input.serviceKey);
  const entry = service.buys.find((row) => row.itemKey === item.definitionKey);
  if (!entry) {
    throw illegalItemMove({ instanceId: item.id, reason: 'the counter does not buy it' });
  }

  const quantity = input.quantity ?? item.quantity;
  if (quantity <= 0 || quantity > item.quantity) {
    throw illegalItemMove({ instanceId: item.id, quantity, available: item.quantity });
  }

  if (quantity === item.quantity) await tx.itemInstance.delete({ where: { id: item.id } });
  else
    await tx.itemInstance.update({
      where: { id: item.id },
      data: { quantity: { decrement: quantity } },
    });

  const proceeds = BigInt(entry.price) * BigInt(quantity);
  await post(tx, {
    subject: bankOf(input.accountId as never),
    currency: 'GOLD',
    amount: proceeds,
    reasonCode: 'service.sell',
    operationId: input.operationId,
    at: input.at,
  });
  return { quantity, proceeds };
}
