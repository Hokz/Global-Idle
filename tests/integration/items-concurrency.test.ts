/**
 * Phase 3 §20 — LCK1 to LCK4.
 *
 * The LAST FREE SPACE, contested. Counting a container's free spaces and then
 * inserting into it is a read-then-write, and two arrivals that both read
 * "one left" both write unless something serializes them. Every case here uses
 * a BARRIER rather than two promises and hope: the first transaction is held
 * open after it has taken the destination lock, the second is started while
 * the first is still inside, and the case asserts the second is BLOCKED before
 * asserting what it did.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { economy, hunt as huntContext, items, withTransaction } from '@global-idle/domain';
import { accountId as toAccountId, operationId as toOperationId } from '@global-idle/shared';
import type { ContentBundleResolver, ResolvedBundle } from '@global-idle/game-data';
import { createClient, truncateAll } from '../support/db.js';
import { publishContent, startHunt } from '../support/phase2.js';
import { BACKPACK, CHEESE, DAGGER, SERVICE, firstContainer } from '../support/phase3.js';

const prisma = createClient();
const T0 = new Date('2026-03-10T09:00:00.000Z');

let directory: string;
let version: string;
let resolver: ContentBundleResolver;
let bundle: ResolvedBundle;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-p3lck-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
  bundle = await resolver.resolve(version as never);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const gate = () => {
  let open!: () => void;
  const reached = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, reached };
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function idle(options: Parameters<typeof startHunt>[4] = {}) {
  const hunt = await startHunt(prisma, resolver, version, T0, options);
  await withTransaction(prisma, (tx) =>
    huntContext.endRunOrActivity(tx, hunt.activityId, 'LEFT', new Date(T0.getTime() + 1000)),
  );
  return hunt;
}

/** Fill the Character's first container to exactly one free space. */
async function fillToOneFree(accountId: string, characterId: string): Promise<string> {
  const containerId = await firstContainer(prisma, characterId);
  const spaces = items.itemDefinition(bundle, 'item.backpack').containerSpaces!;
  const used = await prisma.itemInstance.count({ where: { containerId } });
  for (let n = used; n < spaces - 1; n += 1) {
    await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        bundle,
        accountId,
        characterId,
        definitionKey: CHEESE,
        // Distinct rarities so nothing merges and every row costs a SPACE.
        quantity: 1,
        location: 'CHARACTER_CONTAINER',
        containerId,
        affixes: [{ affix: 'ARMOR_PLUS', value: n + 1 }],
        at: new Date(T0.getTime() + n),
      }),
    );
  }
  expect(await prisma.itemInstance.count({ where: { containerId } })).toBe(spaces - 1);
  return containerId;
}

describe('§20 LCK — the last free space is won by exactly one caller', () => {
  it('LCK1: two concurrent arrivals needing the last space — exactly one wins', async () => {
    const hero = await idle();
    const containerId = await fillToOneFree(hero.accountId, hero.characterId);

    // Two items that CANNOT merge with anything in the container or with each
    // other, so each genuinely needs a new space. Two potions would merge and
    // prove nothing.
    const [a, b] = await Promise.all(
      [901, 902].map((mark) =>
        withTransaction(prisma, (tx) =>
          items.createItem(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: hero.characterId,
            definitionKey: CHEESE,
            quantity: 1,
            location: 'LOOT_POUCH',
            affixes: [{ affix: 'ARMOR_PLUS', value: mark }],
            at: T0,
          }),
        ),
      ),
    );

    const move = (instanceId: string) => ({
      bundle,
      accountId: hero.accountId,
      characterId: hero.characterId,
      baseLevel: 1,
      instanceId,
      to: { kind: 'CONTAINER' as const, containerId },
      at: T0,
    });

    const inside = gate();
    const mayCommit = gate();
    const first = withTransaction(prisma, async (tx) => {
      await items.moveItem(tx, move(a!.id));
      inside.open();
      await mayCommit.reached;
    });
    await inside.reached;

    const second = withTransaction(prisma, (tx) => items.moveItem(tx, move(b!.id))).catch(
      (error: unknown) => error as Error,
    );

    // It must MEET the lock rather than read a stale count and insert.
    const outcome = await Promise.race([
      second.then(() => 'ran-through' as const),
      sleep(400).then(() => 'blocked' as const),
    ]);
    expect(outcome).toBe('blocked');

    mayCommit.open();
    await first;
    const loser = await second;
    expect(loser).toBeInstanceOf(Error);
    expect((loser as Error).name).toBe('NoRoomForItem');

    // Exactly one arrival, and the container is not over its capacity.
    const spaces = items.itemDefinition(bundle, 'item.backpack').containerSpaces!;
    expect(await prisma.itemInstance.count({ where: { containerId } })).toBe(spaces);
    // And the loser is exactly where it was — not lost, not duplicated.
    const stayed = await prisma.itemInstance.findUniqueOrThrow({ where: { id: b!.id } });
    expect(stayed.location).toBe('LOOT_POUCH');
  });

  it('LCK2: two concurrent purchases of the last SLOT — the loser is not charged', async () => {
    const hero = await idle();
    // Slot 2 unlocked and empty; 3 to 5 still locked. Exactly one container
    // can be delivered, and a container never merges with anything.
    await prisma.characterContainerSlot.update({
      where: { characterId_slotIndex: { characterId: hero.characterId, slotIndex: 2 } },
      data: { unlockedAt: T0 },
    });
    await economy.post(prisma as never, {
      subject: economy.bankOf(toAccountId(hero.accountId)),
      currency: 'GOLD',
      amount: 1000n,
      reasonCode: 'test.seed',
      operationId: toOperationId(`seed2:${hero.characterId}`),
      at: T0,
    });
    const before = await withTransaction(prisma, (tx) =>
      economy.readBalance(tx, economy.bankOf(toAccountId(hero.accountId)), 'GOLD'),
    );

    const buyOne = (operation: string) => ({
      bundle,
      serviceKey: SERVICE,
      accountId: hero.accountId,
      characterId: hero.characterId,
      baseLevel: 1,
      definitionKey: BACKPACK,
      quantity: 1,
      operationId: toOperationId(`${operation}:${hero.characterId}`),
      at: T0,
    });

    const inside = gate();
    const mayCommit = gate();
    const first = withTransaction(prisma, async (tx) => {
      await items.buy(tx, buyOne('buy-a'));
      inside.open();
      await mayCommit.reached;
    });
    await inside.reached;
    const second = withTransaction(prisma, (tx) => items.buy(tx, buyOne('buy-b'))).catch(
      () => 'refused' as const,
    );

    const outcome = await Promise.race([
      second.then(() => 'ran-through' as const),
      sleep(400).then(() => 'blocked' as const),
    ]);
    expect(outcome).toBe('blocked');

    mayCommit.open();
    await first;
    expect(await second).toBe('refused');

    const after = await withTransaction(prisma, (tx) =>
      economy.readBalance(tx, economy.bankOf(toAccountId(hero.accountId)), 'GOLD'),
    );
    const price = items
      .serviceDefinition(bundle, SERVICE)
      .sells.find((entry) => entry.itemKey === BACKPACK)!.price;
    // ONE backpack's worth, not two. A purchase that could not be delivered is
    // not a purchase.
    expect(before - after).toBe(BigInt(price));
    expect(
      await prisma.itemInstance.count({
        where: { characterId: hero.characterId, location: 'HUNT_CONTAINER' },
      }),
    ).toBe(2);
  });

  it('LCK3: two concurrent Stash withdrawals cannot both take the last space', async () => {
    const hero = await idle();
    const containerId = await fillToOneFree(hero.accountId, hero.characterId);
    await prisma.stashEntry.create({
      data: {
        accountId: hero.accountId,
        definitionKey: CHEESE,
        quantity: 10n,
        updatedAt: T0,
      },
    });

    const inside = gate();
    const mayCommit = gate();
    const first = withTransaction(prisma, async (tx) => {
      await items.withdraw(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 1,
        definitionKey: CHEESE,
        quantity: 1,
        containerId,
        at: T0,
      });
      inside.open();
      await mayCommit.reached;
    });
    await inside.reached;
    const second = withTransaction(prisma, (tx) =>
      items.withdraw(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 1,
        definitionKey: CHEESE,
        quantity: 1,
        containerId,
        at: T0,
      }),
    ).catch(() => 'refused' as const);

    const outcome = await Promise.race([
      second.then((value) =>
        value === 'refused' ? ('refused' as const) : ('ran-through' as const),
      ),
      sleep(400).then(() => 'blocked' as const),
    ]);
    expect(outcome).toBe('blocked');

    mayCommit.open();
    await first;
    expect(await second).toBe('refused');

    const spaces = items.itemDefinition(bundle, 'item.backpack').containerSpaces!;
    expect(await prisma.itemInstance.count({ where: { containerId } })).toBe(spaces);
    // The refused withdrawal left the Stash exactly as it was.
    const entry = await prisma.stashEntry.findUniqueOrThrow({
      where: {
        accountId_definitionKey: { accountId: hero.accountId, definitionKey: CHEESE },
      },
    });
    expect(entry.quantity).toBe(9n);
  });

  it('LCK4: two concurrent drops cannot both take the last Loot Pouch space', async () => {
    const hero = await idle();
    const spaces = 20;
    for (let n = 0; n < spaces - 1; n += 1) {
      await withTransaction(prisma, (tx) =>
        items.createItem(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          definitionKey: CHEESE,
          quantity: 1,
          location: 'LOOT_POUCH',
          affixes: [{ affix: 'ARMOR_PLUS', value: n + 1 }],
          at: new Date(T0.getTime() + n),
        }),
      );
    }

    const inside = gate();
    const mayCommit = gate();
    // A DAGGER, because it is non-stackable: two of them can never merge, so
    // each arrival genuinely needs a space of its own.
    const drop = (at: Date) => ({
      bundle,
      accountId: hero.accountId,
      characterId: hero.characterId,
      baseLevel: 1,
      definitionKey: DAGGER,
      quantity: 1,
      at,
    });
    const first = withTransaction(prisma, async (tx) => {
      const result = await items.placeInPouch(tx, drop(T0));
      inside.open();
      await mayCommit.reached;
      return result;
    });
    await inside.reached;
    const second = withTransaction(prisma, (tx) =>
      items.placeInPouch(tx, drop(new Date(T0.getTime() + 1000))),
    );

    const outcome = await Promise.race([
      second.then(() => 'ran-through' as const),
      sleep(400).then(() => 'blocked' as const),
    ]);
    expect(outcome).toBe('blocked');

    mayCommit.open();
    expect((await first).reason).toBe('ok');
    // The second is not an ERROR — a full Pouch stops COLLECTION and never
    // stops the Hunt. It collects nothing, and says why.
    expect(await second).toEqual({ collected: 0, reason: 'no-space' });
    expect(
      await prisma.itemInstance.count({
        where: { characterId: hero.characterId, location: 'LOOT_POUCH' },
      }),
    ).toBe(spaces);
  });
});
