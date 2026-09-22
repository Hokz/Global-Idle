/**
 * Phase 3 §20 — DTH1-DTH6, BNK1-BNK6, NPC1-NPC5, HNT1-HNT6, MIG1-MIG6.
 *
 * What a death costs now, what the Bank is for, the one counter, the Hunt's
 * own determinism, and the constraints the migration put in the database.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { economy, hunt as huntContext, items, withTransaction } from '@global-idle/domain';
import {
  accountId as toAccountId,
  minutes,
  operationId as toOperationId,
} from '@global-idle/shared';
import type { ContentBundleResolver, ResolvedBundle } from '@global-idle/game-data';
import { createClient, truncateAll } from '../support/db.js';
import { REPO_ROOT } from '../support/repo.js';
import {
  advanceOnce,
  kills,
  playUntil,
  publishContent,
  readCharacter,
  readPouch,
  setProtection,
  startHunt,
} from '../support/phase2.js';
import {
  BACKPACK,
  CHEESE,
  DAGGER,
  POTION,
  SERVICE,
  contentsOf,
  depotOf,
  drop,
  expectDomainError,
  firstContainer,
  give,
  pouchOf,
  totalOf,
} from '../support/phase3.js';

const prisma = createClient();
const T0 = new Date('2026-03-09T09:00:00.000Z');

let directory: string;
let version: string;
let resolver: ContentBundleResolver;
let bundle: ResolvedBundle;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-p3e-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
  bundle = await resolver.resolve(version as never);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function idle(options: Parameters<typeof startHunt>[4] = {}) {
  const hunt = await startHunt(prisma, resolver, version, T0, options);
  await withTransaction(prisma, (tx) =>
    huntContext.endRunOrActivity(tx, hunt.activityId, 'LEFT', new Date(T0.getTime() + 1000)),
  );
  return hunt;
}

const nearlyDead = (activityId: string, health = 2) =>
  prisma.huntRun.update({
    where: { activityId },
    data: { characterHealth: health, supplyCharges: 0 },
  });

const killIt = (activityId: never, from: Date) =>
  playUntil(prisma, resolver, activityId, from, (state) => state.view?.endedReason === 'DIED', {
    budgetMs: minutes(30),
  });

const bankOf = (accountId: string) =>
  withTransaction(prisma, (tx) =>
    economy.readBalance(tx, economy.bankOf(toAccountId(accountId)), 'GOLD'),
  );

describe('§20 DTH — what a death costs now', () => {
  it('DTH1: without Full Bless the Loot Pouch is lost, with the Gold Pouch', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: 2000n });
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 12);
    const loot = await pouchOf(prisma, hunt.characterId);
    const carried = await readPouch(prisma, hunt.characterId);
    expect(loot.length).toBeGreaterThan(0);
    expect(carried).toBeGreaterThan(0n);

    await nearlyDead(String(hunt.activityId));
    const died = await killIt(hunt.activityId, new Date(T0.getTime() + minutes(10)));
    expect(died.view!.endedReason).toBe('DIED');

    expect(await pouchOf(prisma, hunt.characterId)).toHaveLength(0);
    expect(await readPouch(prisma, hunt.characterId)).toBe(0n);
    expect(died.view!.penalty?.fullBless).toBe(false);
  });

  it('DTH2: Full Bless keeps BOTH pouches, and the XP loss still applies', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: 2000n });
    await setProtection(prisma, hunt.characterId, { blessings: 7 });
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 12);
    const loot = await pouchOf(prisma, hunt.characterId);
    const carried = await readPouch(prisma, hunt.characterId);
    const before = (await readCharacter(prisma, hunt.characterId)).baseXp;
    expect(loot.length).toBeGreaterThan(0);

    await nearlyDead(String(hunt.activityId));
    const died = await killIt(hunt.activityId, new Date(T0.getTime() + minutes(10)));

    expect(died.view!.penalty?.fullBless).toBe(true);
    expect(await pouchOf(prisma, hunt.characterId)).toHaveLength(loot.length);
    expect(await readPouch(prisma, hunt.characterId)).toBe(carried);
    // Full Bless is still not a free death.
    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBeLessThan(before);
  });

  it('DTH3: six blessings forfeit and seven keep — the threshold is still binary', async () => {
    const results: { blessings: number; kept: boolean }[] = [];
    for (const blessings of [6, 7]) {
      await truncateAll(prisma);
      ({ version, resolver } = await publishContent(prisma, directory, T0));
      bundle = await resolver.resolve(version as never);
      const hunt = await startHunt(prisma, resolver, version, T0);
      await setProtection(prisma, hunt.characterId, { blessings });
      await drop(prisma, {
        bundle,
        accountId: hunt.accountId,
        characterId: hunt.characterId,
        baseLevel: 1,
        definitionKey: CHEESE,
        quantity: 3,
        at: T0,
      });
      await nearlyDead(String(hunt.activityId));
      await killIt(hunt.activityId, new Date(T0.getTime() + minutes(10)));
      results.push({
        blessings,
        kept: (await pouchOf(prisma, hunt.characterId)).length > 0,
      });
    }
    expect(results).toEqual([
      { blessings: 6, kept: false },
      { blessings: 7, kept: true },
    ]);
  });

  it('DTH4: equipment, containers, supplies, Depot and Stash are all SAFE', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: 2000n });
    const container = await firstContainer(prisma, hunt.characterId);
    await prisma.stashEntry.create({
      data: { accountId: hunt.accountId, definitionKey: CHEESE, quantity: 40n, updatedAt: T0 },
    });
    await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        accountId: hunt.accountId,
        characterId: null,
        definitionKey: DAGGER,
        quantity: 1,
        location: 'DEPOT',
        at: T0,
      }),
    );
    const equippedBefore = await prisma.itemInstance.count({
      where: { characterId: hunt.characterId, location: 'EQUIPPED' },
    });
    const containerBefore = (await contentsOf(prisma, container)).length;

    await drop(prisma, {
      bundle,
      accountId: hunt.accountId,
      characterId: hunt.characterId,
      baseLevel: 1,
      definitionKey: CHEESE,
      quantity: 2,
      at: T0,
    });
    await nearlyDead(String(hunt.activityId));
    await killIt(hunt.activityId, new Date(T0.getTime() + minutes(10)));

    // The Pouch is empty; nothing else moved at all.
    expect(await pouchOf(prisma, hunt.characterId)).toHaveLength(0);
    expect(
      await prisma.itemInstance.count({
        where: { characterId: hunt.characterId, location: 'EQUIPPED' },
      }),
    ).toBe(equippedBefore);
    expect((await contentsOf(prisma, container)).length).toBe(containerBefore);
    expect(await depotOf(prisma, hunt.accountId)).toHaveLength(1);
    expect(
      (await withTransaction(prisma, (tx) => items.readStash(tx, hunt.accountId)))[0]!.quantity,
    ).toBe(40n);
  });

  it('DTH5: the forfeiture happens ONCE, however many times the path is reached', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: 2000n });
    await drop(prisma, {
      bundle,
      accountId: hunt.accountId,
      characterId: hunt.characterId,
      baseLevel: 1,
      definitionKey: CHEESE,
      quantity: 5,
      at: T0,
    });
    await nearlyDead(String(hunt.activityId));
    const died = await killIt(hunt.activityId, new Date(T0.getTime() + minutes(10)));
    const afterXp = (await readCharacter(prisma, hunt.characterId)).baseXp;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await advanceOnce(
        prisma,
        resolver,
        hunt.activityId,
        new Date(died.at.getTime() + minutes(attempt + 1)),
      );
      await withTransaction(prisma, (tx) =>
        huntContext.endRun(tx, hunt.activityId, 'DIED', new Date(died.at.getTime() + 30_000)),
      );
    }
    expect(await pouchOf(prisma, hunt.characterId)).toHaveLength(0);
    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBe(afterXp);
  });

  it('DTH6: a second concurrent caller destroys nothing extra', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: 5000n });
    await drop(prisma, {
      bundle,
      accountId: hunt.accountId,
      characterId: hunt.characterId,
      baseLevel: 1,
      definitionKey: CHEESE,
      quantity: 7,
      at: T0,
    });
    const at = new Date(T0.getTime() + minutes(10));

    const settle = () =>
      withTransaction(prisma, (tx) => huntContext.endRun(tx, hunt.activityId, 'DIED', at));
    const [first, second] = await Promise.all([settle(), settle()]);

    // Exactly one penalty, and the loot list belongs to whichever won.
    const penalties = [first, second].filter(Boolean);
    expect(penalties).toHaveLength(1);
    expect(penalties[0]!.lootForfeited.reduce((sum, row) => sum + row.quantity, 0)).toBe(7);
    expect(await pouchOf(prisma, hunt.characterId)).toHaveLength(0);
    expect(await totalOf(prisma, hunt.accountId, CHEESE)).toBe(0);
  });
});

describe('§20 BNK — the Bank, and the Gold that is not carried', () => {
  it('BNK1: a deposit is double entry and sums to zero', async () => {
    const hero = await idle();
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.pouchOf(toAccountId(hero.accountId), hero.characterId),
        currency: 'GOLD',
        amount: 500n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`seed-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    const operation = toOperationId(`deposit-${crypto.randomUUID()}`);
    await withTransaction(prisma, (tx) =>
      economy.transfer(tx, {
        from: economy.pouchOf(toAccountId(hero.accountId), hero.characterId),
        to: economy.bankOf(toAccountId(hero.accountId)),
        currency: 'GOLD',
        amount: 300n,
        reasonCode: 'gold.deposit',
        operationId: operation,
        at: T0,
      }),
    );
    expect(await readPouch(prisma, hero.characterId)).toBe(200n);
    expect(await bankOf(hero.accountId)).toBe(300n);

    const entries = await prisma.ledgerEntry.findMany({ where: { operationId: operation } });
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(0n);
  });

  it('BNK2: a purchase spends the POUCH first and the Bank second', async () => {
    const hero = await idle();
    for (const [subject, amount] of [
      [economy.pouchOf(toAccountId(hero.accountId), hero.characterId), 30n],
      [economy.bankOf(toAccountId(hero.accountId)), 100n],
    ] as const) {
      await withTransaction(prisma, (tx) =>
        economy.post(tx, {
          subject,
          currency: 'GOLD',
          amount,
          reasonCode: 'test.seed',
          operationId: toOperationId(`seed-${crypto.randomUUID()}`),
          at: T0,
        }),
      );
    }

    // Two potions at 20 each is 40: thirty from the Pouch and ten from the Bank.
    const purchase = await withTransaction(prisma, (tx) =>
      items.buy(tx, {
        bundle,
        serviceKey: SERVICE,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        definitionKey: POTION,
        quantity: 2,
        operationId: toOperationId(`buy-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    expect(purchase).toMatchObject({ cost: 40n, fromPouch: 30n, fromBank: 10n });
    expect(await readPouch(prisma, hero.characterId)).toBe(0n);
    expect(await bankOf(hero.accountId)).toBe(90n);
  });

  it('BNK3: a slot unlock debits the Bank and never the Pouch', async () => {
    const hero = await idle();
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.pouchOf(toAccountId(hero.accountId), hero.characterId),
        currency: 'GOLD',
        amount: 10_000n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`seed-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    // Carried Gold does NOT pay for a permanent unlock.
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
    expect(await readPouch(prisma, hero.characterId)).toBe(10_000n);
  });

  it('BNK4: sale proceeds credit the Bank', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const stack = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 6,
      at: T0,
    });
    const result = await withTransaction(prisma, (tx) =>
      items.sell(tx, {
        bundle,
        serviceKey: SERVICE,
        accountId: hero.accountId,
        characterId: hero.characterId,
        instanceId: stack,
        operationId: toOperationId(`sell-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    expect(result).toEqual({ quantity: 6, proceeds: 12n });
    expect(await bankOf(hero.accountId)).toBe(12n);
    expect(await readPouch(prisma, hero.characterId)).toBe(0n);
  });

  it('BNK5: every scope reconciles to its own entries, after all of it', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 8);
    await withTransaction(prisma, (tx) =>
      huntContext.endRunOrActivity(
        tx,
        hunt.activityId,
        'LEFT',
        new Date(T0.getTime() + minutes(5)),
      ),
    );
    const container = await firstContainer(prisma, hunt.characterId);
    const cheese = (await pouchOf(prisma, hunt.characterId))[0];
    if (cheese) {
      await withTransaction(prisma, (tx) =>
        items.moveItem(tx, {
          bundle,
          accountId: hunt.accountId,
          characterId: hunt.characterId,
          baseLevel: 400,
          instanceId: cheese.id,
          to: { kind: 'CONTAINER', containerId: container },
          at: T0,
        }),
      );
      await withTransaction(prisma, (tx) =>
        items.sell(tx, {
          bundle,
          serviceKey: SERVICE,
          accountId: hunt.accountId,
          characterId: hunt.characterId,
          instanceId: cheese.id,
          operationId: toOperationId(`sell-${crypto.randomUUID()}`),
          at: T0,
        }),
      );
    }
    await withTransaction(prisma, async (tx) => {
      expect(await economy.countReconciliationMismatches(tx)).toBe(0);
    });
  });

  it('BNK6: nothing bypasses the ledger — every Gold movement has a reason', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 4);
    const entries = await prisma.ledgerEntry.findMany({ where: { accountId: hunt.accountId } });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.reasonCode).toMatch(/^[a-z][a-z.-]+$/);
      expect(entry.operationId).toBeTruthy();
    }
  });
});

describe('§20 NPC — the Rookgaard counter', () => {
  it('NPC1: buying delivers the goods and charges for them', async () => {
    const hero = await idle();
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.bankOf(toAccountId(hero.accountId)),
        currency: 'GOLD',
        amount: 200n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`seed-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    const before = await totalOf(prisma, hero.accountId, POTION);
    await withTransaction(prisma, (tx) =>
      items.buy(tx, {
        bundle,
        serviceKey: SERVICE,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        definitionKey: POTION,
        quantity: 5,
        operationId: toOperationId(`buy-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    expect(await totalOf(prisma, hero.accountId, POTION)).toBe(before + 5);
    expect(await bankOf(hero.accountId)).toBe(100n);
  });

  it('NPC2: a refill is the same operation with a convenient quantity', async () => {
    const hero = await idle();
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.bankOf(toAccountId(hero.accountId)),
        currency: 'GOLD',
        amount: 4_000n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`seed-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    await withTransaction(prisma, (tx) =>
      items.buy(tx, {
        bundle,
        serviceKey: SERVICE,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        definitionKey: POTION,
        quantity: 100,
        operationId: toOperationId(`refill-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    const container = await firstContainer(prisma, hero.characterId);
    const rows = (await contentsOf(prisma, container)).filter(
      (row) => row.definitionKey === POTION,
    );
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(120);
    expect(rows.every((row) => row.quantity <= 255)).toBe(true);
  });

  it('NPC3: a purchase that cannot be DELIVERED is not charged for', async () => {
    const hero = await idle();
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
    // Fill the only container.
    const container = await firstContainer(prisma, hero.characterId);
    for (let index = (await contentsOf(prisma, container)).length; index < 20; index += 1) {
      await give(prisma, {
        accountId: hero.accountId,
        characterId: hero.characterId,
        containerId: container,
        definitionKey: DAGGER,
        quantity: 1,
        at: T0,
      });
    }
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.buy(tx, {
            bundle,
            serviceKey: SERVICE,
            accountId: hero.accountId,
            characterId: hero.characterId,
            baseLevel: 400,
            definitionKey: CHEESE,
            quantity: 1,
            operationId: toOperationId(`buy-${crypto.randomUUID()}`),
            at: T0,
          }),
        ),
      'IllegalItemMove',
    );
    // Not one coin moved.
    expect(await bankOf(hero.accountId)).toBe(10_000n);
  });

  it('NPC4: what the counter does not trade, it refuses', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const potion = (await contentsOf(prisma, container)).find(
      (row) => row.definitionKey === POTION,
    )!;
    // The counter SELLS potions; it does not BUY them.
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.sell(tx, {
            bundle,
            serviceKey: SERVICE,
            accountId: hero.accountId,
            characterId: hero.characterId,
            instanceId: potion.id,
            operationId: toOperationId(`sell-${crypto.randomUUID()}`),
            at: T0,
          }),
        ),
      'IllegalItemMove',
      /not sellable|does not buy/,
    );
    expect(await bankOf(hero.accountId)).toBe(0n);
  });

  it('NPC5: there is no counter inside a Hunt', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.bankOf(toAccountId(hunt.accountId)),
        currency: 'GOLD',
        amount: 10_000n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`seed-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.buy(tx, {
            bundle,
            serviceKey: SERVICE,
            accountId: hunt.accountId,
            characterId: hunt.characterId,
            baseLevel: 1,
            definitionKey: POTION,
            quantity: 1,
            operationId: toOperationId(`buy-${crypto.randomUUID()}`),
            at: T0,
          }),
        ),
      'ServiceUnavailableHere',
    );
    expect(await bankOf(hunt.accountId)).toBe(10_000n);
  });
});

describe('§20 HNT — the Hunt, with items in it', () => {
  it('HNT1: the same persisted position drops the same loot', async () => {
    const first = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, first.activityId, T0, (state) => kills(state.events) >= 10);
    const a = (await pouchOf(prisma, first.characterId)).map((row) => row.quantity);

    await truncateAll(prisma);
    ({ version, resolver } = await publishContent(prisma, directory, T0));
    const second = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, second.activityId, T0, (state) => kills(state.events) >= 10);
    const b = (await pouchOf(prisma, second.characterId)).map((row) => row.quantity);

    // Same seed, same position, same drops — which is what makes a retry safe.
    expect(b).toEqual(a);
  });

  it('HNT2: at zero Stamina a kill yields NOTHING, loot included, and combat continues', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: 0 });
    const state = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (s) => kills(s.events) >= 10,
    );
    expect(BigInt(state.view!.sessionXp)).toBe(0n);
    expect(await readPouch(prisma, hunt.characterId)).toBe(0n);
    expect(await pouchOf(prisma, hunt.characterId)).toHaveLength(0);
    // ...and the run is still going.
    expect(state.view!.endedReason).toBeNull();
  });

  it('HNT3: a retried settlement does not duplicate a stack', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const played = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (s) => kills(s.events) >= 10,
    );
    const before = (await pouchOf(prisma, hunt.characterId)).reduce(
      (sum, row) => sum + row.quantity,
      0,
    );
    expect(before).toBeGreaterThan(0);

    // Ten reads at the same instant. The checkpoint claim makes each a no-op.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await advanceOnce(prisma, resolver, hunt.activityId, played.at);
    }
    expect(
      (await pouchOf(prisma, hunt.characterId)).reduce((sum, row) => sum + row.quantity, 0),
    ).toBe(before);
  });

  it('HNT4: the Pouch survives a reload from durable state', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const played = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (s) => kills(s.events) >= 10,
    );
    const before = await pouchOf(prisma, hunt.characterId);
    const view = await advanceOnce(prisma, resolver, hunt.activityId, played.at);
    expect(view!.endedReason).toBeNull();
    expect((await pouchOf(prisma, hunt.characterId)).map((row) => row.id)).toEqual(
      before.map((row) => row.id),
    );
  });

  it('HNT5: drinking a potion consumes a real one', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const container = await firstContainer(prisma, hunt.characterId);
    const before = (await contentsOf(prisma, container))
      .filter((row) => row.definitionKey === POTION)
      .reduce((sum, row) => sum + row.quantity, 0);
    expect(before).toBe(20);

    // Hurt it enough that the supply rule fires.
    await prisma.huntRun.update({
      where: { activityId: String(hunt.activityId) },
      data: { characterHealth: 20 },
    });
    await playUntil(prisma, resolver, hunt.activityId, T0, (s) =>
      s.events.some((event) => event.kind === 'supply'),
    );
    const after = (await contentsOf(prisma, container))
      .filter((row) => row.definitionKey === POTION)
      .reduce((sum, row) => sum + row.quantity, 0);
    expect(after).toBeLessThan(before);
  });

  it('HNT6: room 10 keeps cycling with items in play', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const state = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (s) => (s.view?.cycle ?? 0) >= 2,
      { budgetMs: minutes(120) },
    );
    expect(state.view!.room).toBe(10);
    expect(state.view!.cycle).toBeGreaterThanOrEqual(2);
  });
});

describe('§20 MIG — migrations and invariants', () => {
  it('MIG1: the Phase 3 migration is applied, and the enums exist', async () => {
    const applied = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name`,
    );
    expect(applied.map((row) => row.migration_name)).toContain(
      '20260922040000_phase_3_itemization',
    );

    const enums = await prisma.$queryRawUnsafe<{ typname: string }[]>(
      `SELECT typname FROM pg_type WHERE typname IN
         ('ItemLocation','ItemRarity','EquipmentSlot','LootPolicyMode')`,
    );
    expect(enums.map((row) => row.typname).sort()).toEqual([
      'EquipmentSlot',
      'ItemLocation',
      'ItemRarity',
      'LootPolicyMode',
    ]);
  });

  it('MIG2: every custody CHECK is in the catalog, not only in the migration', async () => {
    const rows = await prisma.$queryRawUnsafe<{ conname: string; def: string }[]>(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname IN ('ItemInstance','CharacterContainerSlot','StashEntry')
          AND c.contype IN ('c','f','u')`,
    );
    const by = (name: string) => rows.find((row) => row.conname === name)?.def ?? '';

    expect(by('ItemInstance_location_shape_check')).toMatch(/EQUIPPED/);
    expect(by('ItemInstance_quantity_check')).toMatch(/255/);
    expect(by('ItemInstance_no_self_containment_check')).toMatch(/containerId/);
    expect(by('CharacterContainerSlot_index_check')).toMatch(/BETWEEN 1 AND 5|>= 1.*<= 5/s);
    expect(by('CharacterContainerSlot_locked_is_empty_check')).toMatch(/unlockedAt/);
    expect(by('StashEntry_quantity_check')).toMatch(/quantity/);
    expect(by('ItemInstance_characterId_accountId_fkey')).toMatch(
      /FOREIGN KEY \("characterId", "accountId"\)/,
    );
  });

  it('MIG3: the migration text carries what D13 will assert', async () => {
    const sql = await readFile(
      join(
        REPO_ROOT,
        'packages',
        'domain',
        'prisma',
        'migrations',
        '20260922040000_phase_3_itemization',
        'migration.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(/ItemInstance_location_shape_check/);
    expect(sql).toMatch(/CharacterContainerSlot_index_check/);
    // It creates; it does not destroy.
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM/);
  });

  it('MIG4: the equipment slot index is PARTIAL — one per slot, only when equipped', async () => {
    const rows = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'ItemInstance'
        AND indexname = 'ItemInstance_characterId_slot_key'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/UNIQUE/);
    expect(rows[0]!.indexdef).toMatch(/WHERE .*EQUIPPED/);
  });

  it('MIG5: a DEPOT row naming a Character is unrepresentable', async () => {
    const hero = await idle();
    await expect(
      prisma.itemInstance.create({
        data: {
          id: `item-${crypto.randomUUID()}`,
          accountId: hero.accountId,
          characterId: hero.characterId,
          definitionKey: CHEESE,
          quantity: 1,
          location: 'DEPOT',
          createdAt: T0,
        },
      }),
    ).rejects.toThrow(/ItemInstance_location_shape_check/);
  });

  it('MIG6: an item cannot contain itself', async () => {
    const hero = await idle();
    const row = await withTransaction(prisma, (tx) =>
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
      prisma.$executeRawUnsafe(
        `UPDATE "ItemInstance" SET "containerId" = id WHERE id = $1`,
        row.id,
      ),
    ).rejects.toThrow(/ItemInstance_no_self_containment_check|location_shape/);
  });
});
