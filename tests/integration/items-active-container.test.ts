/**
 * Phase 3 §20 — ACT1 to ACT7, MOV9, MOV10, ITM11.
 *
 * What an ACTIVE Hunt container is, proved against the database rather than
 * against the service that writes it. Every case here would have passed before
 * the correction by asking the service politely; each one now goes around the
 * service and asks PostgreSQL.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hunt as huntContext, items, withTransaction } from '@global-idle/domain';
import type { ContentBundleResolver, ResolvedBundle } from '@global-idle/game-data';
import { createClient, truncateAll } from '../support/db.js';
import { publishContent, startHunt } from '../support/phase2.js';
import { BACKPACK, DAGGER, POTION, expectDomainError, firstContainer } from '../support/phase3.js';

const prisma = createClient();
const T0 = new Date('2026-03-09T09:00:00.000Z');

let directory: string;
let version: string;
let resolver: ContentBundleResolver;
let bundle: ResolvedBundle;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-p3act-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
  bundle = await resolver.resolve(version as never);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A Character with the tutorial grant, out of its Hunt. */
async function idle(options: Parameters<typeof startHunt>[4] = {}) {
  const hunt = await startHunt(prisma, resolver, version, T0, options);
  await withTransaction(prisma, (tx) =>
    huntContext.endRunOrActivity(tx, hunt.activityId, 'LEFT', new Date(T0.getTime() + 1000)),
  );
  return hunt;
}

/** A loose container in the Depot, belonging to one account. */
async function spareContainer(accountId: string) {
  return withTransaction(prisma, (tx) =>
    items.createItem(tx, {
      bundle,
      accountId,
      characterId: null,
      definitionKey: BACKPACK,
      quantity: 1,
      location: 'DEPOT',
      at: T0,
    }),
  );
}

async function unlockAll(characterId: string) {
  await prisma.characterContainerSlot.updateMany({
    where: { characterId },
    data: { unlockedAt: T0 },
  });
}

describe('§20 ACT — an active Hunt container', () => {
  it('ACT1: “installed” is a fact BOTH rows carry, not a pointer one of them holds', async () => {
    const hero = await idle();
    const container = await prisma.itemInstance.findFirstOrThrow({
      where: { characterId: hero.characterId, location: 'HUNT_CONTAINER' },
    });
    expect(container.slotIndex).toBe(1);
    expect(container.slot).toBeNull();
    expect(container.containerId).toBeNull();

    const slot = await prisma.characterContainerSlot.findUniqueOrThrow({
      where: { characterId_slotIndex: { characterId: hero.characterId, slotIndex: 1 } },
    });
    expect(slot.containerInstanceId).toBe(container.id);

    // The instance cannot quietly claim a different slot than the one that
    // claims it: the composite foreign key is what both rows are checked by.
    await expect(
      prisma.itemInstance.update({ where: { id: container.id }, data: { slotIndex: 2 } }),
    ).rejects.toThrow(/foreign key|constraint|P2003/i);
  });

  it('ACT2: Character A cannot install Character B’s container', async () => {
    const a = await idle();
    const b = await idle({ accountId: a.accountId, vocation: 'KNIGHT' });
    await unlockAll(a.characterId);

    const bContainer = await prisma.itemInstance.findFirstOrThrow({
      where: { characterId: b.characterId, location: 'HUNT_CONTAINER' },
    });

    // Through the domain: not found, because whose it is, is not information
    // A is entitled to.
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.installContainer(tx, {
            bundle,
            accountId: a.accountId,
            characterId: a.characterId,
            baseLevel: 1,
            instanceId: bContainer.id,
            slotIndex: 2,
            at: T0,
          }),
        ),
      'ItemNotFound',
    );

    // And around the domain entirely: the slot's key names the CHARACTER too,
    // so the pointer cannot be written by hand either.
    await expect(
      prisma.characterContainerSlot.update({
        where: { characterId_slotIndex: { characterId: a.characterId, slotIndex: 2 } },
        data: { containerInstanceId: bContainer.id },
      }),
    ).rejects.toThrow(/foreign key|constraint|P2003/i);
  });

  it('ACT3: another ACCOUNT’s container is not installable, by the same key', async () => {
    const mine = await idle();
    const theirs = await idle();
    await unlockAll(mine.characterId);

    const foreign = await prisma.itemInstance.findFirstOrThrow({
      where: { characterId: theirs.characterId, location: 'HUNT_CONTAINER' },
    });
    await expect(
      prisma.characterContainerSlot.update({
        where: { characterId_slotIndex: { characterId: mine.characterId, slotIndex: 2 } },
        data: { containerInstanceId: foreign.id },
      }),
    ).rejects.toThrow(/foreign key|constraint|P2003/i);
  });

  it('ACT4: a DEPOT container is not active, whatever a slot would like to say', async () => {
    const hero = await idle();
    await unlockAll(hero.characterId);
    const spare = await spareContainer(hero.accountId);

    // A Depot row has NO characterId, and the slot's does. The pair cannot
    // match, so the database refuses the row outright.
    await expect(
      prisma.characterContainerSlot.update({
        where: { characterId_slotIndex: { characterId: hero.characterId, slotIndex: 2 } },
        data: { containerInstanceId: spare.id },
      }),
    ).rejects.toThrow(/foreign key|constraint|P2003/i);

    // And nothing can be routed into it while it sits there.
    const potion = await prisma.itemInstance.findFirstOrThrow({
      where: { characterId: hero.characterId, definitionKey: POTION },
    });
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.moveItem(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: hero.characterId,
            baseLevel: 1,
            instanceId: potion.id,
            to: { kind: 'CONTAINER', containerId: spare.id },
            at: T0,
          }),
        ),
      'IllegalItemMove',
    );
  });

  it('ACT5: an installed container cannot slip into the Depot behind its slot’s back', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);

    // Straight at the table, past every service: set the row to DEPOT and the
    // slot that names it becomes a lie. The foreign key refuses.
    await expect(
      prisma.itemInstance.update({
        where: { id: container },
        data: { location: 'DEPOT', characterId: null, slotIndex: null },
      }),
    ).rejects.toThrow(/fkey|violates/i);

    const slot = await prisma.characterContainerSlot.findUniqueOrThrow({
      where: { characterId_slotIndex: { characterId: hero.characterId, slotIndex: 1 } },
    });
    expect(slot.containerInstanceId).toBe(container);
  });

  it('ACT6: contents cannot name a different Character from their parent', async () => {
    const a = await idle();
    const b = await idle({ accountId: a.accountId, vocation: 'KNIGHT' });
    const aContainer = await firstContainer(prisma, a.characterId);

    await expect(
      withTransaction(prisma, (tx) =>
        tx.itemInstance.create({
          data: {
            id: `bad-${Date.now()}`,
            accountId: a.accountId,
            characterId: b.characterId,
            definitionKey: DAGGER,
            quantity: 1,
            location: 'CHARACTER_CONTAINER',
            containerId: aContainer,
            rarity: 'COMMON',
            affixes: [],
            createdAt: T0,
          },
        }),
      ),
    ).rejects.toThrow(/ItemInstance_containerId_characterId_fkey|violates/i);
  });

  it('ACT7: five slots can each hold their own container, and there is no sixth', async () => {
    const hero = await idle();
    await unlockAll(hero.characterId);

    for (const slotIndex of [2, 3, 4, 5]) {
      const spare = await spareContainer(hero.accountId);
      await withTransaction(prisma, (tx) =>
        items.installContainer(tx, {
          bundle,
          accountId: hero.accountId,
          characterId: hero.characterId,
          baseLevel: 1,
          instanceId: spare.id,
          slotIndex,
          at: T0,
        }),
      );
    }

    const installed = await prisma.itemInstance.findMany({
      where: { characterId: hero.characterId, location: 'HUNT_CONTAINER' },
      orderBy: { slotIndex: 'asc' },
    });
    expect(installed.map((row) => row.slotIndex)).toEqual([1, 2, 3, 4, 5]);

    // Six is not "refused by a service". There is no row shape for it.
    const sixth = await spareContainer(hero.accountId);
    await expect(
      prisma.itemInstance.update({
        where: { id: sixth.id },
        data: {
          location: 'HUNT_CONTAINER',
          characterId: hero.characterId,
          slotIndex: 6,
        },
      }),
    ).rejects.toThrow(/ItemInstance_slotIndex_check|shape_check/);
  });
});

describe('§20 MOV — the movement primitive answers for itself', () => {
  it('MOV9: the DOMAIN refuses a Depot move during a Hunt, with no controller involved', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const potion = await prisma.itemInstance.findFirstOrThrow({
      where: { characterId: hunt.characterId, definitionKey: POTION },
    });

    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.moveItem(tx, {
            bundle,
            accountId: hunt.accountId,
            characterId: hunt.characterId,
            baseLevel: 1,
            instanceId: potion.id,
            to: { kind: 'DEPOT' },
            at: T0,
          }),
        ),
      'ServiceUnavailableHere',
    );

    // Rearranging what is CARRIED stays legal inside a Hunt.
    const container = await firstContainer(prisma, hunt.characterId);
    await withTransaction(prisma, (tx) =>
      items.moveItem(tx, {
        bundle,
        accountId: hunt.accountId,
        characterId: hunt.characterId,
        baseLevel: 1,
        instanceId: potion.id,
        to: { kind: 'CONTAINER', containerId: container },
        at: T0,
      }),
    );
  });

  it('MOV10: a LOADED container cannot leave its slot', async () => {
    const hero = await idle();
    const container = await firstContainer(prisma, hero.characterId);
    expect(await prisma.itemInstance.count({ where: { containerId: container } })).toBeGreaterThan(
      0,
    );

    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.moveItem(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: hero.characterId,
            baseLevel: 1,
            instanceId: container,
            to: { kind: 'DEPOT' },
            at: T0,
          }),
        ),
      'IllegalItemMove',
    );

    // Empty it, and the same move is allowed.
    await prisma.itemInstance.deleteMany({ where: { containerId: container } });
    await withTransaction(prisma, (tx) =>
      items.moveItem(tx, {
        bundle,
        accountId: hero.accountId,
        characterId: hero.characterId,
        baseLevel: 1,
        instanceId: container,
        to: { kind: 'DEPOT' },
        at: T0,
      }),
    );
    const slot = await prisma.characterContainerSlot.findUniqueOrThrow({
      where: { characterId_slotIndex: { characterId: hero.characterId, slotIndex: 1 } },
    });
    expect(slot.containerInstanceId).toBeNull();
  });
});

describe('§20 ITM — the stack limit is the DEFINITION’s', () => {
  it('ITM11: the domain refuses a non-stackable Dagger with a quantity of 2', async () => {
    const hero = await idle();
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.createItem(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: null,
            definitionKey: DAGGER,
            quantity: 2,
            location: 'DEPOT',
            at: T0,
          }),
        ),
      'IllegalItemMove',
    );

    // And a stackable above ITS OWN maxStack, which the database's 1..255
    // ceiling would happily have accepted if the definition said 100.
    const definition = items.itemDefinition(bundle, POTION);
    await expectDomainError(
      () =>
        withTransaction(prisma, (tx) =>
          items.createItem(tx, {
            bundle,
            accountId: hero.accountId,
            characterId: null,
            definitionKey: POTION,
            quantity: definition.maxStack + 1,
            location: 'DEPOT',
            at: T0,
          }),
        ),
      'IllegalItemMove',
    );
  });
});
