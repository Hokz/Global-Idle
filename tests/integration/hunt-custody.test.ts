/**
 * Phase 2 correction §12 — DL10, DL11, GP1 to GP9, BL1 to BL3.
 *
 * The cases about DURABLE custody and about not applying a penalty twice. They
 * drive the real domain against the real database, the real Activity
 * lifecycle and the real ledger, because those are the only things that can be
 * wrong about them.
 *
 * What the group is defending, in one line: Gold a creature dropped is
 * CARRIED and can be lost, Gold in the Bank cannot, and the difference is a
 * dimension of the append-only ledger rather than a second balance nobody can
 * audit (ADR-019).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { economy, hunt as huntContext, withTransaction } from '@global-idle/domain';
import {
  accountId as toAccountId,
  minutes,
  operationId as toOperationId,
  seconds,
} from '@global-idle/shared';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { createClient, truncateAll } from '../support/db.js';
import {
  advanceOnce,
  kills,
  playUntil,
  publishContent,
  readBank,
  readCharacter,
  readLedger,
  readPouch,
  readRun,
  setProtection,
  startHunt,
} from '../support/phase2.js';

const prisma = createClient();
const T0 = new Date('2026-03-06T09:00:00.000Z');

let directory: string;
let version: string;
let resolver: ContentBundleResolver;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-gp-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Put a run one bad tick away from death, as the DE group does. */
async function nearlyDead(activityId: string, health = 2) {
  await prisma.huntRun.update({
    where: { activityId },
    data: { characterHealth: health, supplyCharges: 0 },
  });
}

/** Run until the Character dies, and return what the view said about it. */
async function killIt(hunt: { activityId: never } | { activityId: unknown }, from: Date) {
  return playUntil(
    prisma,
    resolver,
    hunt.activityId as never,
    from,
    (state) => state.view?.endedReason === 'DIED',
    { budgetMs: minutes(30) },
  );
}

describe('§12 DL — death, against the database', () => {
  it('DL10: a pre-vocation Character cannot be promoted, and the database says so', async () => {
    // The 30-point Promotion reduction is the largest single protection in the
    // formula. A Rookgaard Character has not been to the Oracle, so it cannot
    // have it — and that is the SOURCE's answer, not a Global Idle rule:
    // nothing promotes from vocation 0, so `Player::isPromoted()` is false.
    const hunt = await startHunt(prisma, resolver, version, T0);
    const character = await readCharacter(prisma, hunt.characterId);
    expect(character.vocation).toBeNull();
    expect(character.promoted).toBe(false);
    expect(character.blessings).toBe(0);

    // Not merely defaulted — REFUSED. A future Oracle that promoted before it
    // set a vocation would be stopped here rather than quietly handing out a
    // discount nobody earned.
    await expect(
      prisma.character.update({ where: { id: hunt.characterId }, data: { promoted: true } }),
    ).rejects.toThrow();
    expect((await readCharacter(prisma, hunt.characterId)).promoted).toBe(false);

    // And the reduction it would have bought is genuinely absent: the Origin
    // Character loses the full unprotected tenth.
    await prisma.character.update({
      where: { id: hunt.characterId },
      data: { baseXp: 1000n, baseLevel: huntContext.levelForXp(1000n) },
    });
    await nearlyDead(String(hunt.activityId));
    await killIt(hunt, new Date(T0.getTime() + minutes(5)));
    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBe(900n);
  });

  it('DL11: a retried or restarted death settles the penalty exactly once', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: 2000n });
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 1);
    const carried = await readPouch(prisma, hunt.characterId);
    expect(carried).toBeGreaterThan(0n);

    await nearlyDead(String(hunt.activityId));
    const died = await killIt(hunt, new Date(T0.getTime() + minutes(5)));
    expect(died.view!.endedReason).toBe('DIED');

    const afterDeath = await readCharacter(prisma, hunt.characterId);
    const pouchAfter = await readPouch(prisma, hunt.characterId);
    const entries = await readLedger(prisma, hunt.accountId);
    expect(afterDeath.baseXp).toBeLessThan(2000n);
    expect(pouchAfter).toBe(0n);

    // Ten more reads, a restart's worth. `endRun` returns immediately for a
    // run that already carries an ending, so the penalty cannot be charged a
    // second time however many times the path is reached.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await advanceOnce(
        prisma,
        resolver,
        hunt.activityId,
        new Date(died.at.getTime() + minutes(attempt + 1)),
      );
      await withTransaction(prisma, (tx) =>
        huntContext.endRun(tx, hunt.activityId, 'DIED', new Date(died.at.getTime() + seconds(30))),
      );
    }

    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBe(afterDeath.baseXp);
    expect(await readPouch(prisma, hunt.characterId)).toBe(0n);
    const after = await readLedger(prisma, hunt.accountId);
    expect(after.length).toBe(entries.length);
    expect(after.filter((entry) => entry.reasonCode === 'hunt.death.forfeit').length).toBe(1);
  });
});

describe('§12 GP — the Gold Pouch', () => {
  it('GP1: a creature’s Gold goes to the Pouch, and the Bank never sees it', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const { view } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 3,
    );

    const pouch = await readPouch(prisma, hunt.characterId);
    expect(pouch).toBeGreaterThan(0n);
    expect(BigInt(view!.pouchGold)).toBe(pouch);

    // THE BANK IS UNTOUCHED — not zero-by-coincidence, but never written at
    // all. Before this correction every one of those coins landed here, which
    // made Hunt Gold safe the instant it dropped.
    expect(await readBank(prisma, hunt.accountId)).toBe(0n);
    expect(
      await prisma.currencyBalance.count({
        where: { accountId: hunt.accountId, custody: 'BANK' },
      }),
    ).toBe(0);

    // Every entry says which scope it moved, and the Hunt's say POUCH.
    const entries = await readLedger(prisma, hunt.accountId);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.custody).toBe('POUCH');
      expect(entry.subjectId).toBe(hunt.characterId);
      expect(entry.reasonCode).toBe('hunt.reward');
    }
  });

  it('GP2: the Pouch survives a reload and a restart', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const played = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 2,
    );
    const carried = await readPouch(prisma, hunt.characterId);
    expect(carried).toBeGreaterThan(0n);

    // A brand-new client, and a brand-new connection: the number comes back
    // from the ledger's projection, not from anything this process held.
    const fresh = createClient();
    try {
      const row = await fresh.currencyBalance.findUniqueOrThrow({
        where: {
          subjectId_custody_currency: {
            subjectId: hunt.characterId,
            custody: 'POUCH',
            currency: 'GOLD',
          },
        },
      });
      expect(row.amount).toBe(carried);
      expect(row.accountId).toBe(hunt.accountId);
    } finally {
      await fresh.$disconnect();
    }

    const reread = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(played.at.getTime() + seconds(20)),
    );
    expect(BigInt(reread!.pouchGold)).toBeGreaterThanOrEqual(carried);
  });

  it('GP3: zero Stamina credits the Pouch with nothing', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: 0 });
    const { events } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 3,
    );

    expect(kills(events)).toBeGreaterThanOrEqual(3);
    expect(await readPouch(prisma, hunt.characterId)).toBe(0n);
    // No entry at all, in either scope. A reward that was dropped is not a
    // reward of zero.
    expect(await readLedger(prisma, hunt.accountId)).toEqual([]);
  });

  it('GP4: a retried reward settlement credits the Pouch once', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 2);

    const at = new Date(T0.getTime() + minutes(15));
    await advanceOnce(prisma, resolver, hunt.activityId, at);
    const run = await readRun(prisma, hunt.activityId);
    const carried = await readPouch(prisma, hunt.characterId);
    const entries = await readLedger(prisma, hunt.accountId);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await prisma.huntRun.update({
        where: { activityId: String(hunt.activityId) },
        data: {
          simulatedThrough: new Date(run.simulatedThrough.getTime() - seconds(20)),
          checkpointSequence: run.checkpointSequence - 1,
        },
      });
      await advanceOnce(prisma, resolver, hunt.activityId, at);
    }

    expect(await readPouch(prisma, hunt.characterId)).toBe(carried);
    expect((await readLedger(prisma, hunt.accountId)).length).toBe(entries.length);
  });

  it('GP5: dying without Full Bless forfeits the Pouch, exactly once', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 2);
    const carried = await readPouch(prisma, hunt.characterId);
    expect(carried).toBeGreaterThan(0n);

    await nearlyDead(String(hunt.activityId));
    const died = await killIt(hunt, new Date(T0.getTime() + minutes(10)));

    expect(died.view!.endedReason).toBe('DIED');
    expect(await readPouch(prisma, hunt.characterId)).toBe(0n);
    expect(died.view!.pouchGold).toBe('0');
    expect(died.view!.penalty?.goldForfeited).toBe(carried.toString());
    expect(died.view!.penalty?.fullBless).toBe(false);

    // FORFEITED, not reset: one negative entry, with a reason and an operation
    // id, so the movement a player is most likely to dispute is the one the
    // ledger explains.
    const forfeits = (await readLedger(prisma, hunt.accountId)).filter(
      (entry) => entry.reasonCode === 'hunt.death.forfeit',
    );
    expect(forfeits.length).toBe(1);
    expect(forfeits[0]!.amount).toBe(-carried);
    expect(forfeits[0]!.custody).toBe('POUCH');
    expect(forfeits[0]!.subjectId).toBe(hunt.characterId);
  });

  it('GP6: Full Bless keeps the Pouch through death', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await setProtection(prisma, hunt.characterId, { blessings: huntContext.FULL_BLESS_COUNT });
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 2);
    const carried = await readPouch(prisma, hunt.characterId);
    expect(carried).toBeGreaterThan(0n);

    await nearlyDead(String(hunt.activityId));
    const died = await killIt(hunt, new Date(T0.getTime() + minutes(10)));

    expect(died.view!.endedReason).toBe('DIED');
    expect(died.view!.penalty?.fullBless).toBe(true);
    expect(died.view!.penalty?.goldForfeited).toBe('0');
    expect(await readPouch(prisma, hunt.characterId)).toBe(carried);
    expect(
      (await readLedger(prisma, hunt.accountId)).some(
        (entry) => entry.reasonCode === 'hunt.death.forfeit',
      ),
    ).toBe(false);

    // Full Bless is not a free death: the experience penalty still applies.
    expect(died.view!.penalty?.experienceLost).not.toBe('0');
  });

  it('GP7: leaving and losing the connection destroy nothing', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const played = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 2,
    );
    const carried = await readPouch(prisma, hunt.characterId);

    await withTransaction(prisma, (tx) =>
      huntContext.endRun(tx, hunt.activityId, 'LEFT', played.at),
    );
    expect(await readPouch(prisma, hunt.characterId)).toBe(carried);

    // ...and neither does a grace expiry. Punishing a lost connection would
    // make the five minutes a trap rather than a mercy.
    const second = await startHunt(prisma, resolver, version, T0, {
      accountId: hunt.accountId,
      name: 'grace-loser',
      vocation: 'KNIGHT',
    });
    await playUntil(prisma, resolver, second.activityId, T0, (state) => kills(state.events) >= 1);
    const secondCarried = await readPouch(prisma, second.characterId);
    expect(secondCarried).toBeGreaterThan(0n);

    await withTransaction(prisma, (tx) =>
      huntContext.endRun(
        tx,
        second.activityId,
        'GRACE_EXPIRED',
        new Date(T0.getTime() + minutes(30)),
      ),
    );
    expect(await readPouch(prisma, second.characterId)).toBe(secondCarried);
    expect(
      (await readLedger(prisma, hunt.accountId)).some(
        (entry) => entry.reasonCode === 'hunt.death.forfeit',
      ),
    ).toBe(false);
  });

  it('GP8: the Bank is a different number, and moving between them is balanced', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 3);
    const carried = await readPouch(prisma, hunt.characterId);
    expect(await readBank(prisma, hunt.accountId)).toBe(0n);

    // A deposit is DOUBLE ENTRY: two entries, one operation id, summing to
    // zero. Value moves scope; none is created and none destroyed.
    await withTransaction(prisma, (tx) =>
      economy.transfer(tx, {
        from: economy.pouchOf(toAccountId(hunt.accountId), hunt.characterId),
        to: economy.bankOf(toAccountId(hunt.accountId)),
        currency: 'GOLD',
        amount: carried,
        reasonCode: 'gold.deposit',
        operationId: toOperationId(`deposit:${hunt.characterId}`),
        at: new Date(T0.getTime() + minutes(20)),
      }),
    );

    expect(await readPouch(prisma, hunt.characterId)).toBe(0n);
    expect(await readBank(prisma, hunt.accountId)).toBe(carried);

    const deposits = (await readLedger(prisma, hunt.accountId)).filter(
      (entry) => entry.reasonCode === 'gold.deposit',
    );
    expect(deposits.length).toBe(2);
    expect(deposits.reduce((total, entry) => total + entry.amount, 0n)).toBe(0n);
    expect(new Set(deposits.map((entry) => entry.operationId)).size).toBe(1);
    expect(new Set(deposits.map((entry) => entry.custody))).toEqual(new Set(['POUCH', 'BANK']));

    // And banked Gold is SAFE: the Character dies and it is still there.
    await nearlyDead(String(hunt.activityId));
    await killIt(hunt, new Date(T0.getTime() + minutes(25)));
    expect(await readBank(prisma, hunt.accountId)).toBe(carried);
    expect(await readPouch(prisma, hunt.characterId)).toBe(0n);
  });

  it('GP9: every scope reconciles to its own entries, including after a death', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 3);

    const pouch = economy.pouchOf(toAccountId(hunt.accountId), hunt.characterId);
    const bank = economy.bankOf(toAccountId(hunt.accountId));

    const earned = await withTransaction(prisma, (tx) => economy.reconcile(tx, pouch, 'GOLD'));
    expect(earned.reconciles).toBe(true);
    expect(earned.projected).toBeGreaterThan(0n);

    await withTransaction(prisma, (tx) =>
      economy.transfer(tx, {
        from: pouch,
        to: bank,
        currency: 'GOLD',
        amount: earned.projected / 2n,
        reasonCode: 'gold.deposit',
        operationId: toOperationId(`deposit-half:${hunt.characterId}`),
        at: new Date(T0.getTime() + minutes(20)),
      }),
    );

    await nearlyDead(String(hunt.activityId));
    await killIt(hunt, new Date(T0.getTime() + minutes(25)));

    for (const subject of [pouch, bank]) {
      const state = await withTransaction(prisma, (tx) => economy.reconcile(tx, subject, 'GOLD'));
      expect(state.reconciles).toBe(true);
    }

    // The database-wide sweep agrees, per scope. A pouch cannot hide a
    // disagreement by being averaged into its account's bank.
    expect(await withTransaction(prisma, (tx) => economy.countReconciliationMismatches(tx))).toBe(
      0,
    );
  });
});

describe('§12 BL — what a blessing does, and what it does not', () => {
  it('BL1: partial blessings reduce the XP loss and protect nothing carried', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: 1000n });
    await setProtection(prisma, hunt.characterId, { blessings: 4 });
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 2);
    const carried = await readPouch(prisma, hunt.characterId);
    expect(carried).toBeGreaterThan(0n);

    const before = (await readCharacter(prisma, hunt.characterId)).baseXp;
    await nearlyDead(String(hunt.activityId));
    const died = await killIt(hunt, new Date(T0.getTime() + minutes(10)));

    // The XP loss IS reduced: four blessings are 32% off, so 6.8% rather than
    // the bare 10%.
    const lost = before - (await readCharacter(prisma, hunt.characterId)).baseXp;
    expect(lost).toBe(BigInt(Math.ceil(Number(before) * 0.068)));
    expect(lost).toBeLessThan(BigInt(Math.ceil(Number(before) * 0.1)));

    // The Pouch is NOT protected. Carried-reward protection is not a sliding
    // scale, and four blessings buy none of it.
    expect(died.view!.penalty?.fullBless).toBe(false);
    expect(await readPouch(prisma, hunt.characterId)).toBe(0n);
    expect(died.view!.penalty?.goldForfeited).toBe(carried.toString());
  });

  it('BL2: Full Bless is the binary threshold — six forfeits, seven protects', async () => {
    const results: { blessings: number; kept: boolean }[] = [];
    for (const blessings of [6, 7]) {
      await truncateAll(prisma);
      ({ version, resolver } = await publishContent(prisma, directory, T0));
      const hunt = await startHunt(prisma, resolver, version, T0);
      await setProtection(prisma, hunt.characterId, { blessings });
      await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 2);
      const carried = await readPouch(prisma, hunt.characterId);
      expect(carried).toBeGreaterThan(0n);

      await nearlyDead(String(hunt.activityId));
      await killIt(hunt, new Date(T0.getTime() + minutes(10)));
      results.push({ blessings, kept: (await readPouch(prisma, hunt.characterId)) === carried });
    }

    expect(results).toEqual([
      { blessings: 6, kept: false },
      { blessings: 7, kept: true },
    ]);
    expect(huntContext.FULL_BLESS_COUNT).toBe(7);
    expect(huntContext.isFullBless({ blessings: 6, promoted: true })).toBe(false);
    expect(huntContext.isFullBless({ blessings: 7, promoted: false })).toBe(true);
  });

  it('BL3: Skill loss is deferred on purpose, and no shadow Skill exists', async () => {
    // Canary loses Skill tries to death with the same percentage and a
    // different rounding. Phase 2 has no durable Skill representation, and
    // inventing one so that it could be deleted would be exactly the shadow
    // system every other part of this phase refuses.
    //
    // What IS owed now is that the deferral is explicit rather than forgotten:
    // the source policy is recorded, with the phase that owns it named.
    const { recorded } = await import('../support/canary.js');
    const row = recorded('death.skillLossRounding');
    expect(row.decision).toBe('Simplify');
    expect(row.reason).toMatch(/Phase 4|Skills/);
    expect(row.value).toContain('sumSkillTries');

    // ...and that nothing has quietly grown one in the meantime. A Character
    // carries progression and protection, and no skill columns.
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Character'`,
    );
    const names = columns.map((column) => column.column_name);
    expect(names).toContain('baseXp');
    expect(names).toContain('blessings');
    for (const forbidden of names.filter((name) => /skill|magic|mana/i.test(name))) {
      throw new Error(`a shadow Skill column appeared on Character: ${forbidden}`);
    }
    expect(
      (
        await prisma.$queryRawUnsafe<{ table_name: string }[]>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name ILIKE '%skill%'`,
        )
      ).map((row) => row.table_name),
    ).toEqual(['SkillTrainingActivity']);
  });
});
