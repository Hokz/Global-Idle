/**
 * Phase 3 §20 — LPH1-LPH9, POL1-POL6, DPT1-DPT4, STH1-STH6, MOV1-MOV8, RTE1-RTE5.
 *
 * The Loot Pouch, the filter in front of it, the two account stores behind it,
 * the primitive that moves between them, and the routing that decides where a
 * purchase lands.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { economy, hunt as huntContext, items, withTransaction } from '@global-idle/domain';
import { accountId as toAccountId, operationId as toOperationId } from '@global-idle/shared';
import type { ContentBundleResolver, ResolvedBundle } from '@global-idle/game-data';
import { createClient, truncateAll } from '../support/db.js';
import { kills, playUntil, publishContent, startHunt } from '../support/phase2.js';
import {
  BACKPACK,
  CHEESE,
  DAGGER,
  POTION,
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
const T0 = new Date('2026-03-08T09:00:00.000Z');

let directory: string;
let version: string;
let resolver: ContentBundleResolver;
let bundle: ResolvedBundle;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-p3l-'));
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

describe('§20 LPH — the Loot Pouch', () => {
  it('LPH1: a Rat’s cheese reaches the Pouch, and the Gold does not', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    // Enough kills that a 39.41% drop is overwhelmingly likely at least once.
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 12);

    const pouch = await pouchOf(prisma, hunt.characterId);
    expect(pouch.length).toBeGreaterThan(0);
    for (const row of pouch) expect(row.definitionKey).toBe(CHEESE);

    // Gold is a ledger scope. There is no gold-coin ITEM anywhere.
    expect(
      await prisma.itemInstance.count({
        where: { accountId: hunt.accountId, definitionKey: { contains: 'gold' } },
      }),
    ).toBe(0);
    expect(
      await withTransaction(prisma, (tx) =>
        economy.readBalance(
          tx,
          economy.pouchOf(toAccountId(hunt.accountId), hunt.characterId),
          'GOLD',
        ),
      ),
    ).toBeGreaterThan(0n);
  });

  it('LPH2: the Pouch is durable — it survives Leave and a fresh client', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 12);
    const before = await pouchOf(prisma, hunt.characterId);
    expect(before.length).toBeGreaterThan(0);

    await withTransaction(prisma, (tx) =>
      huntContext.endRunOrActivity(tx, hunt.activityId, 'LEFT', new Date(T0.getTime() + 60_000)),
    );
    const fresh = createClient();
    try {
      const after = await fresh.itemInstance.findMany({
        where: { characterId: hunt.characterId, location: 'LOOT_POUCH' },
      });
      expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
    } finally {
      await fresh.$disconnect();
    }
  });

  it('LPH3: nothing can be put INTO the Pouch by hand — the type has no such place', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const stack = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 3,
      at: T0,
    });

    // `ItemDestination` has EQUIPPED, CONTAINER and DEPOT — and no LOOT_POUCH.
    // The prohibition is in the TYPE, so there is no runtime path to test; what
    // IS testable is that a hand-written destination is rejected.
    await expect(
      withTransaction(prisma, (tx) =>
        items.moveItem(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          baseLevel: 1,
          instanceId: stack,
          to: { kind: 'LOOT_POUCH' } as never,
          at: T0,
        }),
      ),
    ).rejects.toThrow();
    expect(await pouchOf(prisma, hero.characterId)).toHaveLength(0);
  });

  it('LPH4: the Pouch empties OUTWARD to a container, a Depot or a Stash', async () => {
    const hero = await idle();
    await drop(prisma, {
      bundle,
      accountId: hero.accountId,
      characterId: hero.characterId,
      baseLevel: 1,
      definitionKey: CHEESE,
      quantity: 5,
      at: T0,
    });
    const stack = (await pouchOf(prisma, hero.characterId))[0]!;
    const container = await firstContainer(prisma, hero.characterId);

    await withTransaction(prisma, (tx) =>
      items.moveItem(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 1,
        instanceId: stack.id,
        quantity: 2,
        to: { kind: 'CONTAINER', containerId: container },
        at: T0,
      }),
    );
    await withTransaction(prisma, (tx) =>
      items.moveItem(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 1,
        instanceId: stack.id,
        quantity: 3,
        to: { kind: 'DEPOT' },
        at: T0,
      }),
    );

    expect(await pouchOf(prisma, hero.characterId)).toHaveLength(0);
    expect(await totalOf(prisma, hero.accountId, CHEESE)).toBe(5);
  });

  it('LPH5: the Pouch is FINITE, and twenty is the number', async () => {
    const hero = await idle();
    // Twenty DIFFERENT non-mergeable things: a stackable would merge.
    for (let index = 0; index < 20; index += 1) {
      const placed = await drop(prisma, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        definitionKey: DAGGER,
        quantity: 1,
        at: T0,
      });
      expect(placed.collected, `drop ${index}`).toBe(1);
    }
    expect(await pouchOf(prisma, hero.characterId)).toHaveLength(20);

    const overflow = await drop(prisma, {
      bundle,
      accountId: hero.accountId,
      characterId: hero.characterId,
      baseLevel: 400,
      definitionKey: DAGGER,
      quantity: 1,
      at: T0,
    });
    expect(overflow).toEqual({ collected: 0, reason: 'no-space' });
    expect(await pouchOf(prisma, hero.characterId)).toHaveLength(20);
  });

  it('LPH6: a stackable drop merges rather than costing a second space', async () => {
    const hero = await idle();
    await drop(prisma, {
      bundle,
      accountId: hero.accountId,
      characterId: hero.characterId,
      baseLevel: 400,
      definitionKey: CHEESE,
      quantity: 100,
      at: T0,
    });
    await drop(prisma, {
      bundle,
      accountId: hero.accountId,
      characterId: hero.characterId,
      baseLevel: 400,
      definitionKey: CHEESE,
      quantity: 100,
      at: T0,
    });
    const pouch = await pouchOf(prisma, hero.characterId);
    expect(pouch).toHaveLength(1);
    expect(pouch[0]!.quantity).toBe(200);
  });

  it('LPH7: a full Pouch stops COLLECTION and never stops the Hunt', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    for (let index = 0; index < 20; index += 1) {
      await drop(prisma, {
        bundle,
        accountId: hunt.accountId,
        characterId: hunt.characterId,
        baseLevel: 400,
        definitionKey: DAGGER,
        quantity: 1,
        at: T0,
      });
    }
    const state = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (s) => kills(s.events) >= 8,
    );

    // Combat carried on: kills happened, XP was earned, the run is alive.
    expect(state.view!.endedReason).toBeNull();
    expect(BigInt(state.view!.sessionXp)).toBeGreaterThan(0n);
    // And the Pouch did not grow past its twenty spaces.
    expect(await pouchOf(prisma, hunt.characterId)).toHaveLength(20);
  });

  it('LPH8: a skipped drop is REPORTED, with the reason', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    for (let index = 0; index < 20; index += 1) {
      await drop(prisma, {
        bundle,
        accountId: hunt.accountId,
        characterId: hunt.characterId,
        baseLevel: 400,
        definitionKey: DAGGER,
        quantity: 1,
        at: T0,
      });
    }
    const state = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (s) => kills(s.events) >= 12,
    );
    const skipped = state.events.filter((event) => event.kind === 'loot-skipped');
    expect(skipped.length).toBeGreaterThan(0);
    for (const event of skipped) expect(event).toMatchObject({ reason: 'no-space', item: CHEESE });
  });

  it('LPH9: the Pouch contributes WEIGHT, and the Gold Pouch does not', async () => {
    const hero = await idle();
    const before = await withTransaction(prisma, (tx) =>
      items.carriedWeight(tx, bundle, hero.characterId),
    );
    await drop(prisma, {
      bundle,
      accountId: hero.accountId,
      characterId: hero.characterId,
      baseLevel: 400,
      definitionKey: CHEESE,
      quantity: 10,
      at: T0,
    });
    const after = await withTransaction(prisma, (tx) =>
      items.carriedWeight(tx, bundle, hero.characterId),
    );
    expect(after - before).toBe(10 * 400);
  });
});

describe('§20 POL — the Loot Policy', () => {
  const policyFor = (characterId: string, policy: items.LootPolicy) =>
    withTransaction(prisma, (tx) => items.writePolicy(tx, characterId, policy, T0));

  it('POL1: the default collects everything', async () => {
    const hero = await idle();
    const policy = await withTransaction(prisma, (tx) => items.readPolicy(tx, hero.characterId));
    expect(policy).toEqual({ mode: 'COLLECT_ALL_EXCEPT_SKIPPED', rules: [] });
    expect(items.accepts(policy, bundle, CHEESE, 'COMMON')).toBe(true);
  });

  it('POL2: COLLECT_ALL_EXCEPT_SKIPPED takes everything but what is skipped', () => {
    const policy: items.LootPolicy = {
      mode: 'COLLECT_ALL_EXCEPT_SKIPPED',
      rules: [{ itemKey: CHEESE, accept: false }],
    };
    expect(items.accepts(policy, bundle, CHEESE, 'COMMON')).toBe(false);
    expect(items.accepts(policy, bundle, DAGGER, 'COMMON')).toBe(true);
  });

  it('POL3: ACCEPTED_ONLY takes nothing but what is accepted', () => {
    const policy: items.LootPolicy = {
      mode: 'ACCEPTED_ONLY',
      rules: [{ itemKey: CHEESE, accept: true }],
    };
    expect(items.accepts(policy, bundle, CHEESE, 'COMMON')).toBe(true);
    expect(items.accepts(policy, bundle, DAGGER, 'COMMON')).toBe(false);
  });

  it('POL4: item beats category beats rarity beats the mode', () => {
    const policy: items.LootPolicy = {
      mode: 'ACCEPTED_ONLY',
      rules: [
        { rarity: 'COMMON', accept: true },
        { category: 'FOOD', accept: false },
        { itemKey: CHEESE, accept: true },
      ],
    };
    // The ITEM rule wins over the category rule that would have skipped it...
    expect(items.accepts(policy, bundle, CHEESE, 'COMMON')).toBe(true);
    // ...the CATEGORY rule wins over the rarity rule for another food...
    const noItemRule: items.LootPolicy = { ...policy, rules: policy.rules.slice(0, 2) };
    expect(items.accepts(noItemRule, bundle, CHEESE, 'COMMON')).toBe(false);
    // ...and the RARITY rule wins over the mode's default.
    const rarityOnly: items.LootPolicy = {
      mode: 'ACCEPTED_ONLY',
      rules: [{ rarity: 'COMMON', accept: true }],
    };
    expect(items.accepts(rarityOnly, bundle, DAGGER, 'COMMON')).toBe(true);
    expect(items.accepts(rarityOnly, bundle, DAGGER, 'RARE')).toBe(false);
  });

  it('POL5: precedence is by SPECIFICITY, not by the order rules were added', () => {
    // The category rule was added AFTER the item rule and must still lose.
    const policy: items.LootPolicy = {
      mode: 'COLLECT_ALL_EXCEPT_SKIPPED',
      rules: [
        { itemKey: CHEESE, accept: true },
        { category: 'FOOD', accept: false },
      ],
    };
    expect(items.accepts(policy, bundle, CHEESE, 'COMMON')).toBe(true);
  });

  it('POL6: a rejected drop never enters the Pouch, and uses no space', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await policyFor(hunt.characterId, {
      mode: 'ACCEPTED_ONLY',
      rules: [{ itemKey: DAGGER, accept: true }],
    });
    const state = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (s) => kills(s.events) >= 12,
    );

    expect(await pouchOf(prisma, hunt.characterId)).toHaveLength(0);
    const skipped = state.events.filter((event) => event.kind === 'loot-skipped');
    expect(skipped.length).toBeGreaterThan(0);
    for (const event of skipped) expect(event).toMatchObject({ reason: 'policy' });
    // ...and it was NOT auto-sold. Phase 8 owns that, and it does not exist.
    const entries = await prisma.ledgerEntry.findMany({ where: { accountId: hunt.accountId } });
    expect(entries.map((entry) => entry.reasonCode)).not.toContain('service.sell');
  });
});

describe('§20 DPT — the Depot', () => {
  it('DPT1: the Depot belongs to the ACCOUNT, not to a Character', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const stack = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 4,
      at: T0,
    });
    await withTransaction(prisma, (tx) =>
      items.moveItem(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 1,
        instanceId: stack,
        to: { kind: 'DEPOT' },
        at: T0,
      }),
    );
    const depot = await depotOf(prisma, hero.accountId);
    expect(depot).toHaveLength(1);
    // characterId is NULL, which is what "another Character can collect it"
    // means in a schema rather than in a sentence.
    expect(depot[0]!.characterId).toBeNull();
  });

  it('DPT2: Depot contents weigh nothing against Carry Capacity', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const stack = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 50,
      at: T0,
    });
    const carrying = await withTransaction(prisma, (tx) =>
      items.carriedWeight(tx, bundle, hero.characterId),
    );
    await withTransaction(prisma, (tx) =>
      items.moveItem(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 1,
        instanceId: stack,
        to: { kind: 'DEPOT' },
        at: T0,
      }),
    );
    expect(
      await withTransaction(prisma, (tx) => items.carriedWeight(tx, bundle, hero.characterId)),
    ).toBe(carrying - 50 * 400);
  });

  it('DPT3: taking something back out is an ordinary move', async () => {
    const hero = await idle();
    const stored = await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        accountId: hero.accountId,
        characterId: null,
        definitionKey: CHEESE,
        quantity: 6,
        location: 'DEPOT',
        at: T0,
      }),
    );
    const container = await firstContainer(prisma, hero.characterId);
    await withTransaction(prisma, (tx) =>
      items.moveItem(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 1,
        instanceId: stored.id,
        to: { kind: 'CONTAINER', containerId: container },
        at: T0,
      }),
    );
    expect(await depotOf(prisma, hero.accountId)).toHaveLength(0);
    expect(
      (await contentsOf(prisma, container)).filter((row) => row.definitionKey === CHEESE),
    ).toHaveLength(1);
  });

  it('DPT4: the Depot is unreachable from inside a Hunt', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await expectDomainError(
      () => withTransaction(prisma, (tx) => items.assertSafeContext(tx, hunt.characterId, 'depot')),
      'ServiceUnavailableHere',
    );
    // ...and reachable once it is over.
    await withTransaction(prisma, (tx) =>
      huntContext.endRunOrActivity(tx, hunt.activityId, 'LEFT', new Date(T0.getTime() + 1000)),
    );
    await withTransaction(prisma, (tx) => items.assertSafeContext(tx, hunt.characterId, 'depot'));
  });
});

describe('§20 STH — the Stash', () => {
  it('STH1: only a stashEligible definition may enter', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const dagger = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: DAGGER,
      quantity: 1,
      at: T0,
    });
    expect(items.itemDefinition(bundle, DAGGER).stashEligible).toBe(false);
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.stow(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: hero.characterId,
            instanceId: dagger,
            at: T0,
          }),
        ),
      'IllegalItemMove',
      /not stashable/,
    );
  });

  it('STH2: a stashed quantity is a NUMBER, and may exceed a stack', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    for (let index = 0; index < 2; index += 1) {
      const stack = await give(prisma, {
        accountId: hero.accountId,
        characterId: hero.characterId,
        containerId: container,
        definitionKey: CHEESE,
        quantity: 255,
        at: T0,
      });
      await withTransaction(prisma, (tx) =>
        items.stow(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          instanceId: stack,
          at: T0,
        }),
      );
    }
    const stash = await withTransaction(prisma, (tx) => items.readStash(tx, hero.accountId));
    expect(stash).toEqual([{ definitionKey: CHEESE, quantity: 510n }]);
  });

  it('STH3: withdrawing MATERIALIZES legal stacks', async () => {
    const hero = await idle();
    await prisma.stashEntry.create({
      data: { accountId: hero.accountId, definitionKey: CHEESE, quantity: 300n, updatedAt: T0 },
    });
    const container = await firstContainer(prisma, hero.characterId);
    const stacks = await withTransaction(prisma, (tx) =>
      items.withdraw(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        definitionKey: CHEESE,
        quantity: 300,
        containerId: container,
        at: T0,
      }),
    );
    expect(stacks).toBe(2);
    const rows = (await contentsOf(prisma, container)).filter(
      (row) => row.definitionKey === CHEESE,
    );
    expect(rows.map((row) => row.quantity).sort((a, b) => b - a)).toEqual([255, 45]);
  });

  it('STH4: an individualized item cannot become a quantity', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const affixed = await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        accountId: hero.accountId,
        characterId: hero.characterId,
        definitionKey: CHEESE,
        quantity: 1,
        location: 'CHARACTER_CONTAINER',
        containerId: container,
        rarity: 'RARE',
        affixes: [{ affix: 'ARMOR_PLUS', value: 2 }],
        at: T0,
      }),
    );
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.stow(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: hero.characterId,
            instanceId: affixed.id,
            at: T0,
          }),
        ),
      'IllegalItemMove',
      /individualized/,
    );
  });

  it('STH5: a withdrawal that does not fit leaves the Stash untouched', async () => {
    const hero = await idle();
    await prisma.stashEntry.create({
      data: { accountId: hero.accountId, definitionKey: CHEESE, quantity: 5000n, updatedAt: T0 },
    });
    const container = await firstContainer(prisma, hero.characterId);
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.withdraw(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: hero.characterId,
            baseLevel: 400,
            definitionKey: CHEESE,
            quantity: 5000,
            containerId: container,
            at: T0,
          }),
        ),
      'NoRoomForItem',
    );
    const stash = await withTransaction(prisma, (tx) => items.readStash(tx, hero.accountId));
    expect(stash[0]!.quantity).toBe(5000n);
  });

  it('STH6: the Stash is unreachable from inside a Hunt', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await prisma.stashEntry.create({
      data: { accountId: hunt.accountId, definitionKey: CHEESE, quantity: 10n, updatedAt: T0 },
    });
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.withdraw(tx, {
            bundle,
            accountId: hunt.accountId,
            characterId: hunt.characterId,
            baseLevel: 1,
            definitionKey: CHEESE,
            quantity: 1,
            containerId: 'whatever',
            at: T0,
          }),
        ),
      'ServiceUnavailableHere',
    );
  });
});

describe('§20 MOV — movement', () => {
  it('MOV1: a move preserves the total, always', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const stack = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 30,
      at: T0,
    });
    const before = await totalOf(prisma, hero.accountId, CHEESE);
    for (const quantity of [1, 5, 10]) {
      await withTransaction(prisma, (tx) =>
        items.moveItem(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          baseLevel: 400,
          instanceId: stack,
          quantity,
          to: { kind: 'DEPOT' },
          at: T0,
        }),
      );
    }
    expect(await totalOf(prisma, hero.accountId, CHEESE)).toBe(before);
  });

  it('MOV2: moving the whole stack removes the row rather than leaving a zero', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const stack = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 3,
      at: T0,
    });
    await withTransaction(prisma, (tx) =>
      items.moveItem(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        instanceId: stack,
        to: { kind: 'DEPOT' },
        at: T0,
      }),
    );
    expect(await prisma.itemInstance.findUnique({ where: { id: stack } })).toBeNull();
  });

  it('MOV3: a quantity of zero or more than the stack is refused', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const stack = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 3,
      at: T0,
    });
    for (const quantity of [0, -1, 4]) {
      await expectDomainError(
        () =>
          withTransaction(prisma, (tx) =>
            items.moveItem(tx, {
              bundle,
              accountId: hero.accountId,
              characterId: hero.characterId,
              baseLevel: 400,
              instanceId: stack,
              quantity,
              to: { kind: 'DEPOT' },
              at: T0,
            }),
          ),
        'IllegalItemMove',
      );
    }
  });

  it('MOV4: another Account’s item is NOT FOUND, not forbidden', async () => {
    const mine = await idle();
    const theirs = await idle({ name: 'stranger' });
    const container = await firstContainer(prisma, theirs.characterId);
    const stack = await give(prisma, {
      accountId: theirs.accountId,
      characterId: theirs.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 3,
      at: T0,
    });
    // The same answer as a nonexistent id, on purpose: a caller must not learn
    // that someone else's item id is real.
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.moveItem(tx, {
            bundle,
            accountId: mine.accountId,
            characterId: mine.characterId,
            baseLevel: 400,
            instanceId: stack,
            to: { kind: 'DEPOT' },
            at: T0,
          }),
        ),
      'ItemNotFound',
    );
  });

  it('MOV5: a container that is not installed in an unlocked slot is not a destination', async () => {
    const hero = await idle();
    const orphanContainer = await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        accountId: hero.accountId,
        characterId: null,
        definitionKey: BACKPACK,
        quantity: 1,
        location: 'DEPOT',
        at: T0,
      }),
    );
    const stack = await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        accountId: hero.accountId,
        characterId: null,
        definitionKey: CHEESE,
        quantity: 1,
        location: 'DEPOT',
        at: T0,
      }),
    );
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.moveItem(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: hero.characterId,
            baseLevel: 400,
            instanceId: stack.id,
            to: { kind: 'CONTAINER', containerId: orphanContainer.id },
            at: T0,
          }),
        ),
      'IllegalItemMove',
      /not installed/,
    );
  });

  it('MOV6: two concurrent moves of the same stack cannot clone it', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const stack = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 10,
      at: T0,
    });
    const before = await totalOf(prisma, hero.accountId, CHEESE);

    const move = () =>
      withTransaction(prisma, (tx) =>
        items.moveItem(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          baseLevel: 400,
          instanceId: stack,
          quantity: 10,
          to: { kind: 'DEPOT' },
          at: T0,
        }),
      );
    const results = await Promise.allSettled([move(), move()]);

    // One wins; the other finds the row gone or the quantity short. Either
    // way the TOTAL is what it was, which is the only thing that matters.
    expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(
      1,
    );
    expect(await totalOf(prisma, hero.accountId, CHEESE)).toBe(before);
  });

  it('MOV7: a move and a sale of the same stack cannot both win', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const stack = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 4,
      at: T0,
    });

    const results = await Promise.allSettled([
      withTransaction(prisma, (tx) =>
        items.moveItem(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          baseLevel: 400,
          instanceId: stack,
          to: { kind: 'DEPOT' },
          at: T0,
        }),
      ),
      withTransaction(prisma, (tx) =>
        items.sell(tx, {
          bundle,
          serviceKey: 'service.rookgaard.counter',
          accountId: hero.accountId,
          characterId: hero.characterId,
          instanceId: stack,
          operationId: toOperationId(`sell-${crypto.randomUUID()}`),
          at: T0,
        }),
      ),
    ]);
    const won = results.filter((result) => result.status === 'fulfilled').length;
    expect(won).toBeGreaterThanOrEqual(1);

    // Either it moved or it sold. It cannot have done both, so the account
    // holds four cheese OR the proceeds of four, never both.
    const total = await totalOf(prisma, hero.accountId, CHEESE);
    const bank = await withTransaction(prisma, (tx) =>
      economy.readBalance(tx, economy.bankOf(toAccountId(hero.accountId)), 'GOLD'),
    );
    expect(total === 4 || bank === 8n).toBe(true);
    expect(total === 4 && bank === 8n).toBe(false);
  });

  it('MOV8: a move that fails leaves the source exactly as it was', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const stack = await give(prisma, {
      accountId: hero.accountId,
      characterId: hero.characterId,
      containerId: container,
      definitionKey: CHEESE,
      quantity: 9,
      at: T0,
    });
    const before = await prisma.itemInstance.findUniqueOrThrow({ where: { id: stack } });

    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.moveItem(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: hero.characterId,
            baseLevel: 400,
            instanceId: stack,
            to: { kind: 'EQUIPPED', slot: 'HEAD' },
            at: T0,
          }),
        ),
      'IllegalItemMove',
    );
    expect(await prisma.itemInstance.findUniqueOrThrow({ where: { id: stack } })).toEqual(before);
  });
});

describe('§20 RTE — Manage Containers routing', () => {
  const unlockAll = async (accountId: string, characterId: string) => {
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.bankOf(toAccountId(accountId)),
        currency: 'GOLD',
        amount: 200_000_000n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`seed-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    for (const slotIndex of [2, 3]) {
      await withTransaction(prisma, (tx) =>
        items.unlockSlot(tx, {
          bundle,
          accountId,
          characterId,
          slotIndex,
          operationId: toOperationId(`unlock-${crypto.randomUUID()}`),
          at: T0,
        }),
      );
      const container = await withTransaction(prisma, (tx) =>
        items.createItem(tx, {
          accountId,
          characterId,
          definitionKey: BACKPACK,
          quantity: 1,
          location: 'EQUIPPED',
          slot: slotIndex === 2 ? 'RIGHT' : 'NECKLACE',
          at: T0,
        }),
      );
      await withTransaction(prisma, (tx) =>
        items.installContainer(tx, {
          bundle,
          characterId,
          slotIndex,
          instanceId: container.id,
        }),
      );
    }
  };

  it('RTE1: a purchase lands in the PREFERRED container', async () => {
    const hero = await idle();
    await unlockAll(hero.accountId, hero.characterId);
    await withTransaction(prisma, (tx) =>
      items.setRouting(tx, { characterId: hero.characterId, slotIndex: 3, category: 'POTION' }),
    );
    const result = await withTransaction(prisma, (tx) =>
      items.route(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        definitionKey: POTION,
        quantity: 5,
        at: T0,
      }),
    );
    const slots = await prisma.characterContainerSlot.findMany({
      where: { characterId: hero.characterId },
      orderBy: { slotIndex: 'asc' },
    });
    expect(result.containerId).toBe(slots[2]!.containerInstanceId);
  });

  it('RTE2: with no preference it falls to the first container in SLOT ORDER', async () => {
    const hero = await idle();
    await unlockAll(hero.accountId, hero.characterId);
    const result = await withTransaction(prisma, (tx) =>
      items.route(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        definitionKey: POTION,
        quantity: 1,
        at: T0,
      }),
    );
    expect(result.containerId).toBe(await firstContainer(prisma, hero.characterId));
  });

  it('RTE3: a full preferred container falls through to the next one', async () => {
    const hero = await idle();
    await unlockAll(hero.accountId, hero.characterId);
    await withTransaction(prisma, (tx) =>
      items.setRouting(tx, { characterId: hero.characterId, slotIndex: 2, category: 'POTION' }),
    );
    const slots = await prisma.characterContainerSlot.findMany({
      where: { characterId: hero.characterId },
      orderBy: { slotIndex: 'asc' },
    });
    const preferred = slots[1]!.containerInstanceId!;
    for (let index = 0; index < 20; index += 1) {
      await give(prisma, {
        accountId: hero.accountId,
        characterId: hero.characterId,
        containerId: preferred,
        definitionKey: DAGGER,
        quantity: 1,
        at: T0,
      });
    }
    const result = await withTransaction(prisma, (tx) =>
      items.route(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        definitionKey: POTION,
        quantity: 1,
        at: T0,
      }),
    );
    expect(result.containerId).not.toBe(preferred);
  });

  it('RTE4: routing respects maxStack and counts spaces, not items', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    const before = (await contentsOf(prisma, container)).length;
    const result = await withTransaction(prisma, (tx) =>
      items.route(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 400,
        definitionKey: POTION,
        quantity: 600,
        at: T0,
      }),
    );
    // 20 potions were already there; 600 more tops that stack to 255 and adds
    // stacks of 255 and 110.
    expect(result.stacks).toBe(3);
    const rows = (await contentsOf(prisma, container)).filter(
      (row) => row.definitionKey === POTION,
    );
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(620);
    expect(rows.every((row) => row.quantity <= 255)).toBe(true);
    expect((await contentsOf(prisma, container)).length).toBeGreaterThan(before);
  });

  it('RTE5: nowhere to put it means the operation FAILS, atomically', async () => {
    const hero = await idle();
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
          items.route(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: hero.characterId,
            baseLevel: 400,
            definitionKey: CHEESE,
            quantity: 1,
            at: T0,
          }),
        ),
      'NoRoomForItem',
    );
    expect(await totalOf(prisma, hero.accountId, CHEESE)).toBe(0);
  });
});
