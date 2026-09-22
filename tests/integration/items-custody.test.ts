/**
 * Phase 3 §20 — EQP1 to EQP8, CSL1 to CSL8, STK1 to STK7, CAP1 to CAP5.
 *
 * Equipment, the five Hunt Container Slots, stacking and Capacity — driven
 * against the real database, because every one of these is ultimately a claim
 * about what a row may be.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { economy, items, withTransaction } from '@global-idle/domain';
import { accountId as toAccountId, operationId as toOperationId } from '@global-idle/shared';
import type { ContentBundleResolver, ResolvedBundle } from '@global-idle/game-data';
import { createClient, truncateAll } from '../support/db.js';
import { publishContent, startHunt } from '../support/phase2.js';
import {
  BACKPACK,
  CHEESE,
  DAGGER,
  HELMET,
  POTION,
  allOf,
  contentsOf,
  equippedOf,
  firstContainer,
  give,
  expectDomainError,
  slotsOf,
  totalOf,
} from '../support/phase3.js';

const prisma = createClient();
const T0 = new Date('2026-03-07T09:00:00.000Z');

let directory: string;
let version: string;
let resolver: ContentBundleResolver;
let bundle: ResolvedBundle;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-p3-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
  bundle = await resolver.resolve(version as never);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A Character with the tutorial grant, not in a Hunt. */
async function character(options: Parameters<typeof startHunt>[4] = {}) {
  const hunt = await startHunt(prisma, resolver, version, T0, options);
  await withTransaction(prisma, (tx) =>
    import('@global-idle/domain').then(({ hunt: h }) =>
      h.endRunOrActivity(tx, hunt.activityId, 'LEFT', new Date(T0.getTime() + 1000)),
    ),
  );
  return hunt;
}

describe('§20 EQP — equipment', () => {
  it('EQP1: the Origin Character arrives WEARING the tutorial kit', async () => {
    const hero = await character();
    const worn = await equippedOf(prisma, hero.characterId);

    // Four armour pieces, a weapon and the backpack — six real rows, each an
    // ItemInstance of a real source item.
    expect(worn.map((row) => `${row.slot}:${row.definitionKey}`).sort()).toEqual([
      'ARMOR:item.coat',
      'BACKPACK:item.backpack',
      'FEET:item.leather-boots',
      'HEAD:item.leather-helmet',
      'LEFT:item.dagger',
      'LEGS:item.leather-legs',
    ]);
    for (const row of worn) expect(row.quantity).toBe(1);
  });

  it('EQP2: combat comes from the ITEMS, and lands on Phase 2’s numbers', async () => {
    const hero = await character();
    const { hunt } = await import('@global-idle/domain');
    const plan = await withTransaction(prisma, async (tx) => {
      const equipped = await items.equippedItems(tx, hero.characterId);
      const supplies = await items.broughtSupplies(tx, bundle, hero.characterId);
      return hunt.buildHuntPlan({
        bundle,
        huntKey: 'hunt.rookgaard.sewers',
        level: 1,
        equipped,
        supplyCharges: supplies.charges,
        supplyHeal: supplies.heal,
      });
    });

    // The four leather pieces, summed. The dagger's 8, compensated to 9.6.
    // `Player::getDefense`, truncated to 4. Not authored anywhere — ARRIVED AT.
    expect(plan.profile.armor).toBe(4);
    expect(plan.profile.attackValue).toBeCloseTo(9.6, 10);
    expect(plan.profile.defense).toBe(4);
    expect(plan.profile.armed).toBe(true);
    expect(plan.profile.maxHealth).toBe(150);
    // And the charges are the potions that were actually brought.
    expect(plan.supplyCharges).toBe(20);
    expect(plan.profile.supply).toEqual({ healMin: 60, healMax: 90, useBelowPercent: 40 });
  });

  it('EQP3: unequipping the weapon falls to the UNARMED path, and it still works', async () => {
    const hero = await character();
    const container = await firstContainer(prisma, hero.characterId);
    const weapon = (await equippedOf(prisma, hero.characterId)).find((row) => row.slot === 'LEFT')!;

    await withTransaction(prisma, (tx) =>
      items.moveItem(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 1,
        instanceId: weapon.id,
        to: { kind: 'CONTAINER', containerId: container },
        at: T0,
      }),
    );

    const { hunt } = await import('@global-idle/domain');
    const plan = await withTransaction(prisma, async (tx) =>
      hunt.buildHuntPlan({
        bundle,
        huntKey: 'hunt.rookgaard.sewers',
        level: 1,
        equipped: await items.equippedItems(tx, hero.characterId),
        supplyCharges: 0,
        supplyHeal: null,
      }),
    );

    // `Weapon::useFist` — attackValue 7, and the roll starts at ZERO rather
    // than at level/5. Phase 2 measured what that costs; it is still a legal
    // state and still the player's choice.
    expect(plan.profile.armed).toBe(false);
    expect(plan.profile.attackValue).toBe(7);
    expect(plan.profile.armor).toBe(4);
  });

  it('EQP4: an item cannot be worn in a slot its definition does not fit', async () => {
    const hero = await character();
    const container = await firstContainer(prisma, hero.characterId);
    const potion = (await contentsOf(prisma, container))[0]!;

    await expect(
      withTransaction(prisma, (tx) =>
        items.moveItem(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          baseLevel: 1,
          instanceId: potion.id,
          to: { kind: 'EQUIPPED', slot: 'HEAD' },
          at: T0,
        }),
      ),
    ).rejects.toThrow(/not a legal place/);

    // The helmet fits HEAD and nothing else.
    const helmet = (await equippedOf(prisma, hero.characterId)).find(
      (row) => row.definitionKey === HELMET,
    )!;
    expect(helmet.slot).toBe('HEAD');
  });

  it('EQP5: one item per slot, enforced by the database and not by a service', async () => {
    const hero = await character();
    // A second HEAD row, written by hand, past every guard in TypeScript.
    await expect(
      prisma.itemInstance.create({
        data: {
          id: `item-${crypto.randomUUID()}`,
          accountId: hero.accountId,
          characterId: hero.characterId,
          definitionKey: HELMET,
          quantity: 1,
          location: 'EQUIPPED',
          slot: 'HEAD',
          createdAt: T0,
        },
      }),
    ).rejects.toThrow();
  });

  it('EQP6: an equipped item is not also somewhere else — the shape forbids it', async () => {
    const hero = await character();
    const container = await firstContainer(prisma, hero.characterId);
    // EQUIPPED with a containerId is not a state; it is an unrepresentable row.
    await expect(
      prisma.itemInstance.create({
        data: {
          id: `item-${crypto.randomUUID()}`,
          accountId: hero.accountId,
          characterId: hero.characterId,
          definitionKey: DAGGER,
          quantity: 1,
          location: 'EQUIPPED',
          slot: 'RIGHT',
          containerId: container,
          createdAt: T0,
        },
      }),
    ).rejects.toThrow(/ItemInstance_location_shape_check/);
  });

  it('EQP7: equipment survives a reload, because it is a row and not a session', async () => {
    const hero = await character();
    const before = await equippedOf(prisma, hero.characterId);
    const fresh = createClient();
    try {
      const after = await fresh.itemInstance.findMany({
        where: { characterId: hero.characterId, location: 'EQUIPPED' },
        orderBy: { slot: 'asc' },
      });
      expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
    } finally {
      await fresh.$disconnect();
    }
  });

  it('EQP8: an item cannot name a Character of another Account', async () => {
    const mine = await character();
    const theirs = await character({ name: 'other-hero' });
    expect(theirs.accountId).not.toBe(mine.accountId);

    // The same composite pair ADR-019 uses for currency. Both halves are real
    // and the PAIR is the lie.
    await expect(
      prisma.itemInstance.create({
        data: {
          id: `item-${crypto.randomUUID()}`,
          accountId: mine.accountId,
          characterId: theirs.characterId,
          definitionKey: CHEESE,
          quantity: 1,
          location: 'LOOT_POUCH',
          createdAt: T0,
        },
      }),
    ).rejects.toThrow(/ItemInstance_characterId_accountId_fkey/);
  });
});

describe('§20 CSL — the five Hunt Container Slots', () => {
  it('CSL1: every Character has exactly five, and slot 1 arrives unlocked', async () => {
    const hero = await character();
    const slots = await slotsOf(prisma, hero.characterId);
    expect(slots.map((slot) => slot.slotIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(slots.filter((slot) => slot.unlockedAt !== null).map((slot) => slot.slotIndex)).toEqual([
      1,
    ]);
    expect(slots[0]!.containerInstanceId).not.toBeNull();
  });

  it('CSL2: there is no slot 6, and the database is what says so', async () => {
    const hero = await character();
    await expect(
      prisma.characterContainerSlot.create({
        data: { characterId: hero.characterId, slotIndex: 6, unlockedAt: T0 },
      }),
    ).rejects.toThrow(/CharacterContainerSlot_index_check/);
    await expect(
      prisma.characterContainerSlot.create({
        data: { characterId: hero.characterId, slotIndex: 0, unlockedAt: T0 },
      }),
    ).rejects.toThrow(/CharacterContainerSlot_index_check/);
  });

  it('CSL3: slots 2 to 5 cost Gold, from the SAFE Bank', async () => {
    const hero = await character();
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.bankOf(toAccountId(hero.accountId)),
        currency: 'GOLD',
        amount: 10_000n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`seed-${crypto.randomUUID()}`),
        at: T0,
      }),
    );

    const result = await withTransaction(prisma, (tx) =>
      items.unlockSlot(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        slotIndex: 2,
        operationId: toOperationId(`unlock-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    expect(result.charged).toBe(10_000n);

    const slots = await slotsOf(prisma, hero.characterId);
    expect(slots[1]!.unlockedAt).not.toBeNull();
    expect(
      await withTransaction(prisma, (tx) =>
        economy.readBalance(tx, economy.bankOf(toAccountId(hero.accountId)), 'GOLD'),
      ),
    ).toBe(0n);
  });

  it('CSL4: an unlock a Character cannot afford changes nothing at all', async () => {
    const hero = await character();
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.unlockSlot(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: hero.characterId,
            slotIndex: 2,
            operationId: toOperationId(`unlock-${crypto.randomUUID()}`),
            at: T0,
          }),
        ),
      'InsufficientFunds',
    );
    expect((await slotsOf(prisma, hero.characterId))[1]!.unlockedAt).toBeNull();
  });

  it('CSL5: buying the same slot twice charges once', async () => {
    const hero = await character();
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.bankOf(toAccountId(hero.accountId)),
        currency: 'GOLD',
        amount: 30_000n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`seed-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    const unlock = () =>
      withTransaction(prisma, (tx) =>
        items.unlockSlot(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          slotIndex: 2,
          operationId: toOperationId(`unlock-${crypto.randomUUID()}`),
          at: T0,
        }),
      );
    const first = await unlock();
    const second = await unlock();
    expect(first.charged).toBe(10_000n);
    expect(second).toEqual({ charged: 0n, alreadyUnlocked: true });
    expect(
      await withTransaction(prisma, (tx) =>
        economy.readBalance(tx, economy.bankOf(toAccountId(hero.accountId)), 'GOLD'),
      ),
    ).toBe(20_000n);
  });

  it('CSL6: the price curve is content, and it escalates', async () => {
    const prices = items.containerSlotPrices(bundle).prices;
    expect(prices.map((entry) => entry.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(prices[0]!.gold).toBe(0);
    for (let index = 2; index < prices.length; index += 1) {
      expect(prices[index]!.gold).toBeGreaterThan(prices[index - 1]!.gold);
    }
    expect(prices.map((entry) => entry.gold)).toEqual([0, 10_000, 100_000, 1_000_000, 100_000_000]);
  });

  it('CSL7: an unlock belongs to ONE Character, not to the account', async () => {
    const first = await character({ name: 'first-hero' });
    const second = await character({
      accountId: first.accountId,
      vocation: 'KNIGHT',
      name: 'second-hero',
    });
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.bankOf(toAccountId(first.accountId)),
        currency: 'GOLD',
        amount: 10_000n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`seed-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    await withTransaction(prisma, (tx) =>
      items.unlockSlot(tx, {
        bundle,
        accountId: first.accountId,
        characterId: first.characterId,
        slotIndex: 2,
        operationId: toOperationId(`unlock-${crypto.randomUUID()}`),
        at: T0,
      }),
    );

    // The OTHER Character on the same account is unaffected. Five vocations
    // therefore cost up to 25 unlocks, which is the sink the rule intends.
    expect((await slotsOf(prisma, first.characterId))[1]!.unlockedAt).not.toBeNull();
    expect((await slotsOf(prisma, second.characterId))[1]!.unlockedAt).toBeNull();
  });

  it('CSL8: a locked slot cannot hold a container', async () => {
    const hero = await character();
    const spare = await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        accountId: hero.accountId,
        characterId: hero.characterId,
        definitionKey: BACKPACK,
        quantity: 1,
        location: 'EQUIPPED',
        slot: 'NECKLACE',
        at: T0,
      }),
    );
    await expect(
      withTransaction(prisma, (tx) =>
        items.installContainer(tx, {
          bundle,
          characterId: hero.characterId,
          slotIndex: 3,
          instanceId: spare.id,
        }),
      ),
    ).rejects.toThrow(/not unlocked/i);

    // And the database refuses the row shape directly, too.
    await expect(
      prisma.characterContainerSlot.update({
        where: { characterId_slotIndex: { characterId: hero.characterId, slotIndex: 4 } },
        data: { containerInstanceId: spare.id },
      }),
    ).rejects.toThrow(/CharacterContainerSlot_locked_is_empty_check/);
  });
});

describe('§20 STK — stacking and space', () => {
  it('STK1: a stackable stacks to 255 and a non-stackable to 1', async () => {
    expect(items.itemDefinition(bundle, CHEESE).maxStack).toBe(255);
    expect(items.itemDefinition(bundle, POTION).maxStack).toBe(255);
    expect(items.itemDefinition(bundle, DAGGER).maxStack).toBe(1);
    expect(items.itemDefinition(bundle, BACKPACK).maxStack).toBe(1);

    // And 255 is a CEILING the database also holds.
    const hero = await character();
    await expect(
      prisma.itemInstance.create({
        data: {
          id: `item-${crypto.randomUUID()}`,
          accountId: hero.accountId,
          characterId: hero.characterId,
          definitionKey: CHEESE,
          quantity: 256,
          location: 'LOOT_POUCH',
          createdAt: T0,
        },
      }),
    ).rejects.toThrow(/ItemInstance_quantity_check/);
  });

  it('STK2: 600 becomes 255 / 255 / 90 — three spaces, not six hundred rows', async () => {
    const hero = await character();
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.bankOf(toAccountId(hero.accountId)),
        currency: 'GOLD',
        amount: 1n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`seed-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    // Straight into the Stash, then back out as legal stacks.
    await withTransaction(prisma, (tx) =>
      tx.stashEntry.upsert({
        where: {
          accountId_definitionKey: { accountId: hero.accountId, definitionKey: CHEESE },
        },
        create: {
          accountId: hero.accountId,
          definitionKey: CHEESE,
          quantity: 600n,
          updatedAt: T0,
        },
        update: { quantity: 600n, updatedAt: T0 },
      }),
    );

    const container = await firstContainer(prisma, hero.characterId);
    const stacks = await withTransaction(prisma, (tx) =>
      items.withdraw(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        definitionKey: CHEESE,
        quantity: 600,
        containerId: container,
        at: T0,
      }),
    );
    expect(stacks).toBe(3);
    const rows = (await contentsOf(prisma, container)).filter(
      (row) => row.definitionKey === CHEESE,
    );
    expect(rows.map((row) => row.quantity).sort((a, b) => b - a)).toEqual([255, 255, 90]);
  });

  it('STK3: moving part of a stack splits it, and the total is conserved', async () => {
    const hero = await character();
    const container = await firstContainer(prisma, hero.characterId);
    const source = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 10,
      at: T0,
    });
    const before = await totalOf(prisma, hero.accountId, CHEESE);

    await withTransaction(prisma, (tx) =>
      items.moveItem(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 1,
        instanceId: source,
        quantity: 4,
        to: { kind: 'DEPOT' },
        at: T0,
      }),
    );

    expect(await totalOf(prisma, hero.accountId, CHEESE)).toBe(before);
    const remaining = await prisma.itemInstance.findUniqueOrThrow({ where: { id: source } });
    expect(remaining.quantity).toBe(6);
  });

  it('STK4: arriving at a stack of the same thing MERGES rather than making a second row', async () => {
    const hero = await character();
    const container = await firstContainer(prisma, hero.characterId);
    await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 200,
      at: T0,
    });
    const second = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 100,
      at: T0,
    });

    await withTransaction(prisma, (tx) =>
      items.moveItem(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        instanceId: second,
        to: { kind: 'DEPOT' },
        at: T0,
      }),
    );
    // 100 into the Depot, which was empty, so one row of 100.
    const depot = await prisma.itemInstance.findMany({
      where: { accountId: hero.accountId, location: 'DEPOT', definitionKey: CHEESE },
    });
    expect(depot.map((row) => row.quantity)).toEqual([100]);
    expect(await totalOf(prisma, hero.accountId, CHEESE)).toBe(300);
  });

  it('STK5: a full container refuses an arrival, and nothing is lost', async () => {
    const hero = await character();
    const container = await firstContainer(prisma, hero.characterId);
    const spaces = items.itemDefinition(bundle, BACKPACK).containerSpaces!;
    const used = (await contentsOf(prisma, container)).length;
    for (let index = used; index < spaces; index += 1) {
      await give(prisma, {
        accountId: hero.accountId,
        characterId: hero.characterId,
        containerId: container,
        definitionKey: DAGGER,
        quantity: 1,
        at: T0,
      });
    }
    expect((await contentsOf(prisma, container)).length).toBe(spaces);

    const orphan = await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        accountId: hero.accountId,
        characterId: null,
        definitionKey: DAGGER,
        quantity: 1,
        location: 'DEPOT',
        at: T0,
      }),
    );
    await expect(
      withTransaction(prisma, (tx) =>
        items.moveItem(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          baseLevel: 400,
          instanceId: orphan.id,
          to: { kind: 'CONTAINER', containerId: container },
          at: T0,
        }),
      ),
    ).rejects.toThrow(/no space/i);
    // Still in the Depot. Items never disappear.
    expect(await prisma.itemInstance.findUniqueOrThrow({ where: { id: orphan.id } })).toMatchObject(
      { location: 'DEPOT' },
    );
  });

  it('STK6: a container cannot go inside a container', async () => {
    const hero = await character();
    const container = await firstContainer(prisma, hero.characterId);
    const spare = await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        accountId: hero.accountId,
        characterId: null,
        definitionKey: BACKPACK,
        quantity: 1,
        location: 'DEPOT',
        at: T0,
      }),
    );
    await expect(
      withTransaction(prisma, (tx) =>
        items.moveItem(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          baseLevel: 400,
          instanceId: spare.id,
          to: { kind: 'CONTAINER', containerId: container },
          at: T0,
        }),
      ),
    ).rejects.toThrow(/not a legal place/);
  });

  it('STK7: a quantity of zero or below is unrepresentable', async () => {
    const hero = await character();
    await expect(
      prisma.itemInstance.create({
        data: {
          id: `item-${crypto.randomUUID()}`,
          accountId: hero.accountId,
          characterId: hero.characterId,
          definitionKey: CHEESE,
          quantity: 0,
          location: 'LOOT_POUCH',
          createdAt: T0,
        },
      }),
    ).rejects.toThrow(/ItemInstance_quantity_check/);
  });
});

describe('§20 CAP — Capacity', () => {
  it('CAP1: Capacity is 400 oz at Level 1 and gains 10 a level', () => {
    expect(items.capacityFor(1)).toBe(40_000);
    expect(items.capacityFor(2)).toBe(41_000);
    expect(items.capacityFor(20)).toBe(59_000);
  });

  it('CAP2: carried weight is equipment, containers, contents and the Loot Pouch', async () => {
    const hero = await character();
    const weight = await withTransaction(prisma, (tx) =>
      items.carriedWeight(tx, bundle, hero.characterId),
    );
    // 22.00 + 27.00 + 18.00 + 9.00 leather, 9.50 dagger, 18.00 backpack,
    // and 20 potions at 2.65 each.
    const expected = 2200 + 2700 + 1800 + 900 + 950 + 1800 + 20 * 265;
    expect(weight).toBe(expected);
    expect(weight).toBeLessThan(items.capacityFor(1));
  });

  it('CAP3: a stackable weighs its base weight TIMES its count', async () => {
    const hero = await character();
    const container = await firstContainer(prisma, hero.characterId);
    const before = await withTransaction(prisma, (tx) =>
      items.carriedWeight(tx, bundle, hero.characterId),
    );
    await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 7,
      at: T0,
    });
    const after = await withTransaction(prisma, (tx) =>
      items.carriedWeight(tx, bundle, hero.characterId),
    );
    expect(after - before).toBe(7 * 400);
  });

  it('CAP4: Gold weighs nothing, because it is a ledger scope and not coins', async () => {
    const hero = await character();
    const before = await withTransaction(prisma, (tx) =>
      items.carriedWeight(tx, bundle, hero.characterId),
    );
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.pouchOf(toAccountId(hero.accountId), hero.characterId),
        currency: 'GOLD',
        amount: 1_000_000n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`seed-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    expect(
      await withTransaction(prisma, (tx) => items.carriedWeight(tx, bundle, hero.characterId)),
    ).toBe(before);
    expect(await allOf(prisma, hero.characterId)).not.toContainEqual(
      expect.objectContaining({ definitionKey: 'item.gold-coin' }),
    );
  });

  it('CAP5: over Capacity refuses the arrival and destroys nothing', async () => {
    const hero = await character();
    const container = await firstContainer(prisma, hero.characterId);
    // Fill to just under the limit with cheese, then ask for one more.
    const carried = await withTransaction(prisma, (tx) =>
      items.carriedWeight(tx, bundle, hero.characterId),
    );
    const room = items.capacityFor(1) - carried;
    const fits = Math.floor(room / 400);
    await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: Math.min(255, fits),
      at: T0,
    });

    const spare = await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        accountId: hero.accountId,
        characterId: null,
        definitionKey: CHEESE,
        quantity: 255,
        location: 'DEPOT',
        at: T0,
      }),
    );
    await expect(
      withTransaction(prisma, (tx) =>
        items.moveItem(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          baseLevel: 1,
          instanceId: spare.id,
          to: { kind: 'CONTAINER', containerId: container },
          at: T0,
        }),
      ),
    ).rejects.toThrow(/Capacity/i);

    // Untouched in the Depot: refusing an arrival never costs the player what
    // they already had.
    expect(await prisma.itemInstance.findUniqueOrThrow({ where: { id: spare.id } })).toMatchObject({
      location: 'DEPOT',
      quantity: 255,
    });
  });
});
