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

/**
 * DL12 to DL14 — ONCE ONLY AGAINST CONCURRENCY, not merely against retries.
 *
 * DL11 proves the sequential half: replay the path and nothing happens twice.
 * That half is satisfied by reading `endedReason` and returning early, and it
 * is NOT the half that matters for a penalty that burns experience and empties
 * a Gold Pouch. Under ReadCommitted — the isolation every one of these
 * transactions actually runs at — two callers read `null` at the same instant
 * and both settle. These cases make that interleaving happen on purpose.
 *
 * Each uses a BARRIER rather than firing two promises and hoping: the first
 * transaction is held open after it has taken the lock, the second is started
 * while the first is still inside, and the case asserts the second is BLOCKED
 * before asserting what it did. A race that is only usually a race proves
 * nothing on the run where it is not.
 */
describe('§12 DL — the terminal transition, under concurrency', () => {
  /** A resolver for a promise, and the promise, as one value. */
  const gate = () => {
    let open!: () => void;
    const reached = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { open, reached };
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('DL12: a second caller ending the same run BLOCKS, and then applies nothing', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: 5000n });
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 2);
    const carried = await readPouch(prisma, hunt.characterId);
    expect(carried).toBeGreaterThan(0n);
    const at = new Date(T0.getTime() + minutes(10));

    const inside = gate();
    const mayCommit = gate();

    // FIRST: takes the run's row lock, settles the death, and waits there.
    const first = withTransaction(prisma, async (tx) => {
      const penalty = await huntContext.endRun(tx, hunt.activityId, 'DIED', at);
      inside.open();
      await mayCommit.reached;
      return penalty;
    });
    await inside.reached;

    // SECOND: starts while the first is still open, so it meets the lock.
    const second = withTransaction(prisma, (tx) =>
      huntContext.endRun(tx, hunt.activityId, 'DIED', new Date(at.getTime() + seconds(1))),
    );

    // It must not have got past the lock. Before this correction it did: it
    // read `endedReason = null` from its own snapshot and settled a second
    // penalty on the same run.
    const outcome = await Promise.race([
      second.then(() => 'ran-through' as const),
      sleep(400).then(() => 'blocked' as const),
    ]);
    expect(outcome).toBe('blocked');

    mayCommit.open();
    const [wonPenalty, lostPenalty] = await Promise.all([first, second]);

    // EXACTLY ONE settlement: the winner returns a penalty, the loser returns
    // null having applied nothing at all.
    expect(wonPenalty).not.toBeNull();
    expect(wonPenalty!.goldForfeited).toBe(carried);
    expect(lostPenalty).toBeNull();

    const entries = await readLedger(prisma, hunt.accountId);
    expect(entries.filter((entry) => entry.reasonCode === 'hunt.death.forfeit').length).toBe(1);
    expect(await readPouch(prisma, hunt.characterId)).toBe(0n);
    const run = await readRun(prisma, hunt.activityId);
    expect(run.endedReason).toBe('DIED');
  });

  it('DL13: two concurrent settlements of the same dying run cost exactly one death', async () => {
    // The realistic shape of the race: two polls of the same run arriving
    // together — a heartbeat and a foreground read, or two tabs — with the run
    // one tick from death. This is the END-TO-END assertion: one XP penalty,
    // one forfeiture entry, one terminal state, nothing negative, and a ledger
    // that still reconciles.
    //
    // WHICH LAYER WINS IT, honestly: on this path the checkpoint claim gets
    // there first — the loser's settlement is already a no-op before it can
    // reach the death branch — so this case would pass with or without the row
    // lock. DL12 is the one that isolates the lock, and it fails without it.
    // Both are worth having: one proves the guard, one proves the outcome.
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: 4000n });
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 2);
    const carried = await readPouch(prisma, hunt.characterId);
    const before = (await readCharacter(prisma, hunt.characterId)).baseXp;
    expect(carried).toBeGreaterThan(0n);

    await nearlyDead(String(hunt.activityId));
    const at = new Date(T0.getTime() + minutes(10));

    const settle = (when: Date) =>
      withTransaction(prisma, (tx) =>
        huntContext.advance(tx, {
          activityId: hunt.activityId,
          resolver,
          now: when,
          seen: true,
        }),
      );

    const [left, right] = await Promise.all([settle(at), settle(at)]);

    // One terminal state, one reason.
    const run = await readRun(prisma, hunt.activityId);
    expect(run.endedReason).toBe('DIED');
    expect([left?.endedReason, right?.endedReason]).toContain('DIED');

    // Exactly one XP penalty. The formula's own number, charged once: a
    // pre-vocation Character with no blessings loses a flat tenth.
    const after = (await readCharacter(prisma, hunt.characterId)).baseXp;
    expect(before - after).toBe(BigInt(Math.ceil(Number(before) * 0.1)));

    // Exactly one forfeiture entry, and exactly one settlement reported.
    const entries = await readLedger(prisma, hunt.accountId);
    const forfeits = entries.filter((entry) => entry.reasonCode === 'hunt.death.forfeit');
    expect(forfeits.length).toBe(1);
    expect(forfeits[0]!.amount).toBe(-carried);
    expect([left?.penalty, right?.penalty].filter(Boolean).length).toBe(1);

    // Nothing went negative, and the ledger still explains every scope.
    expect(await readPouch(prisma, hunt.characterId)).toBe(0n);
    expect(await prisma.currencyBalance.count({ where: { amount: { lt: 0n } } })).toBe(0);
    await withTransaction(prisma, async (tx) => {
      expect(await economy.countReconciliationMismatches(tx)).toBe(0);
    });
  });

  it('DL14: a Leave racing a death yields ONE ending, and no penalty the ending did not charge', async () => {
    // Which reason wins is decided by the lock, not by a ranking: the first
    // transaction to hold the run writes its only ending. Here the Leave wins,
    // and the point is that nothing is left unpaid — the settlement that would
    // have produced the death never runs, so no experience is awarded past the
    // ending either.
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: 3000n });
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 2);
    const carried = await readPouch(prisma, hunt.characterId);
    const before = (await readCharacter(prisma, hunt.characterId)).baseXp;
    expect(carried).toBeGreaterThan(0n);

    await nearlyDead(String(hunt.activityId));
    const at = new Date(T0.getTime() + minutes(10));

    const inside = gate();
    const mayCommit = gate();

    const leaving = withTransaction(prisma, async (tx) => {
      await huntContext.endRunOrActivity(tx, hunt.activityId, 'LEFT', at);
      inside.open();
      await mayCommit.reached;
    });
    await inside.reached;

    const dying = withTransaction(prisma, (tx) =>
      huntContext.advance(tx, {
        activityId: hunt.activityId,
        resolver,
        now: new Date(at.getTime() + seconds(30)),
        seen: true,
      }),
    );

    const outcome = await Promise.race([
      dying.then(() => 'ran-through' as const),
      sleep(400).then(() => 'blocked' as const),
    ]);
    expect(outcome).toBe('blocked');

    mayCommit.open();
    await leaving;
    const view = await dying;

    // ONE terminal reason, and it is the one that committed first.
    const run = await readRun(prisma, hunt.activityId);
    expect(run.endedReason).toBe('LEFT');
    expect(view?.endedReason).toBe('LEFT');
    expect(view?.penalty ?? null).toBeNull();

    // Leaving costs nothing, so nothing was charged...
    const after = await readCharacter(prisma, hunt.characterId);
    expect(after.baseXp).toBe(before);
    expect(await readPouch(prisma, hunt.characterId)).toBe(carried);
    expect(
      (await readLedger(prisma, hunt.accountId)).filter(
        (entry) => entry.reasonCode === 'hunt.death.forfeit',
      ).length,
    ).toBe(0);

    // ...and nothing was EARNED past the ending either, which is the half a
    // terminal flag alone would have missed: the blocked settlement found the
    // run already over and simulated none of the span it had been asked for.
    expect(run.tick).toBe((await readRun(prisma, hunt.activityId)).tick);
    expect(await readPouch(prisma, hunt.characterId)).toBe(carried);
    await withTransaction(prisma, async (tx) => {
      expect(await economy.countReconciliationMismatches(tx)).toBe(0);
    });
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

/**
 * GP10 to GP15 — POUCH OWNERSHIP IS REFERENTIAL.
 *
 * The first custody migration checked only that a POUCH row's subject differed
 * from its account. That is a naming convention, not ownership: it accepted a
 * pouch for a Character nobody had ever created, and a pouch held by Account A
 * over a Character owned by Account B. These cases drive the DATABASE
 * directly, past every TypeScript guard, because a guard that only exists in
 * TypeScript is exactly what they are here to disprove.
 */
describe('§12 GP — POUCH ownership, enforced by the database', () => {
  /** Insert one raw ledger row, bypassing every domain guard on purpose. */
  const rawEntry = (row: {
    accountId: string;
    subjectId: string;
    custody: 'BANK' | 'POUCH';
    characterId: string | null;
  }) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "LedgerEntry"
         ("id", "accountId", "subjectId", "custody", "characterId",
          "currency", "amount", "reasonCode", "operationId", "createdAt")
       VALUES ($1, $2, $3, $4::"CurrencyCustody", $5,
               'GOLD'::"CurrencyKind", 1, 'test.raw', $6, $7)`,
      `ledger-${crypto.randomUUID()}`,
      row.accountId,
      row.subjectId,
      row.custody,
      row.characterId,
      `op-${crypto.randomUUID()}`,
      T0,
    );

  it('GP10: a BANK row is account-scoped, and cannot name a Character', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.bankOf(toAccountId(hunt.accountId)),
        currency: 'GOLD',
        amount: 500n,
        reasonCode: 'test.deposit',
        operationId: toOperationId(`bank-${crypto.randomUUID()}`),
        at: T0,
      }),
    );

    const balance = await prisma.currencyBalance.findFirstOrThrow({
      where: { accountId: hunt.accountId, custody: 'BANK' },
    });
    expect(balance.amount).toBe(500n);
    expect(balance.subjectId).toBe(hunt.accountId);
    // NULL, not "the account again": the column means the CARRIER, and a bank
    // has none. It is what makes the composite foreign key skip BANK rows
    // instead of needing an exemption for them.
    expect(balance.characterId).toBeNull();

    // A BANK row that names a Character is refused by the CHECK, whichever
    // Character it names — including a real one on the same account.
    await expect(
      rawEntry({
        accountId: hunt.accountId,
        subjectId: hunt.accountId,
        custody: 'BANK',
        characterId: hunt.characterId,
      }),
    ).rejects.toThrow(/LedgerEntry_custody_subject_check/);
  });

  it('GP11: a POUCH row for a real Character on its own Account is accepted', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 1);

    const pouch = await prisma.currencyBalance.findFirstOrThrow({
      where: { accountId: hunt.accountId, custody: 'POUCH' },
    });
    expect(pouch.amount).toBeGreaterThan(0n);
    // The three columns agree, and the CHECK is what makes them: the subject
    // key IS the carrier, so the projection cannot drift away from the owner
    // the foreign key proved.
    expect(pouch.subjectId).toBe(hunt.characterId);
    expect(pouch.characterId).toBe(hunt.characterId);
    expect(pouch.accountId).toBe(hunt.accountId);

    for (const entry of await readLedger(prisma, hunt.accountId)) {
      expect(entry.characterId).toBe(hunt.characterId);
    }

    // And the same row written by hand still passes: acceptance is a property
    // of the shape, not of the code path that produced it.
    await expect(
      rawEntry({
        accountId: hunt.accountId,
        subjectId: hunt.characterId,
        custody: 'POUCH',
        characterId: hunt.characterId,
      }),
    ).resolves.toBe(1);
  });

  it('GP12: a POUCH for a Character that does not exist is refused by the database', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const ghost = `char-${crypto.randomUUID()}`;
    expect(await prisma.character.count({ where: { id: ghost } })).toBe(0);

    // The CHECK is satisfied — subjectId is a Character id and differs from
    // the account — so before this correction the row went in. What stops it
    // now is REFERENTIAL: there is no such Character to point at.
    await expect(
      rawEntry({
        accountId: hunt.accountId,
        subjectId: ghost,
        custody: 'POUCH',
        characterId: ghost,
      }),
    ).rejects.toThrow(/LedgerEntry_characterId_accountId_fkey/);

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "CurrencyBalance"
           ("subjectId", "custody", "currency", "accountId", "characterId", "amount", "updatedAt")
         VALUES ($1, 'POUCH'::"CurrencyCustody", 'GOLD'::"CurrencyKind", $2, $1, 7, $3)`,
        ghost,
        hunt.accountId,
        T0,
      ),
    ).rejects.toThrow(/CurrencyBalance_characterId_accountId_fkey/);

    expect(await prisma.ledgerEntry.count({ where: { subjectId: ghost } })).toBe(0);
    expect(await prisma.currencyBalance.count({ where: { subjectId: ghost } })).toBe(0);
  });

  it('GP13: one Account cannot hold a POUCH over another Account’s Character', async () => {
    const mine = await startHunt(prisma, resolver, version, T0);
    const theirs = await startHunt(prisma, resolver, version, T0, { name: 'other-hunter' });
    expect(theirs.accountId).not.toBe(mine.accountId);

    // Both halves are individually real — a real account, a real Character —
    // and the pair is the lie. A single-column foreign key would have accepted
    // it; the COMPOSITE one is the whole point.
    await expect(
      rawEntry({
        accountId: mine.accountId,
        subjectId: theirs.characterId,
        custody: 'POUCH',
        characterId: theirs.characterId,
      }),
    ).rejects.toThrow(/LedgerEntry_characterId_accountId_fkey/);

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "CurrencyBalance"
           ("subjectId", "custody", "currency", "accountId", "characterId", "amount", "updatedAt")
         VALUES ($1, 'POUCH'::"CurrencyCustody", 'GOLD'::"CurrencyKind", $2, $1, 7, $3)`,
        theirs.characterId,
        mine.accountId,
        T0,
      ),
    ).rejects.toThrow(/CurrencyBalance_characterId_accountId_fkey/);

    // Nor can the claim be smuggled in by lying about the subject key instead:
    // the CHECK ties subjectId to characterId, so there is no third spelling.
    await expect(
      rawEntry({
        accountId: mine.accountId,
        subjectId: mine.characterId,
        custody: 'POUCH',
        characterId: theirs.characterId,
      }),
    ).rejects.toThrow(/LedgerEntry_custody_subject_check/);

    expect(
      await prisma.ledgerEntry.count({
        where: { accountId: mine.accountId, subjectId: theirs.characterId },
      }),
    ).toBe(0);
  });

  it('GP14: the constraints are real, and the BANK rows the backfill preserved still are', async () => {
    // The guarantee is only worth what the database actually holds, so this
    // reads the catalog rather than the migration's intent.
    const constraints = await prisma.$queryRawUnsafe<{ conname: string; def: string }[]>(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname IN ('LedgerEntry', 'CurrencyBalance')
          AND c.contype IN ('c', 'f')`,
    );
    const definition = (name: string) => constraints.find((row) => row.conname === name)?.def ?? '';

    for (const table of ['LedgerEntry', 'CurrencyBalance']) {
      const fk = definition(`${table}_characterId_accountId_fkey`);
      expect(fk).toMatch(/FOREIGN KEY \("characterId", "accountId"\)/);
      expect(fk).toMatch(/REFERENCES "Character"\(id, "accountId"\)/);
      // RESTRICT, not SET NULL: silently orphaning a pouch into a shape the
      // CHECK forbids would move the failure somewhere it means nothing.
      expect(fk).toMatch(/ON DELETE RESTRICT/);

      const check = definition(`${table}_custody_subject_check`);
      expect(check).toMatch(/"characterId" IS NULL/);
      expect(check).toMatch(/"characterId" IS NOT NULL/);
      expect(check).toMatch(/"subjectId" = "characterId"/);
    }

    // The migration MOVES nothing. Every pre-existing row was a BANK row whose
    // subject was its own account, and that is exactly what it stays: the
    // backfill only fills in the new column for POUCH rows, which had none
    // before it, and no statement in it deletes or rewrites an amount.
    const { readFileSync } = await import('node:fs');
    const migration = readFileSync(
      'packages/domain/prisma/migrations/20260922020000_pouch_ownership/migration.sql',
      'utf8',
    );
    expect(migration).toMatch(
      /UPDATE "LedgerEntry"\s+SET "characterId" = "subjectId" WHERE "custody" = 'POUCH'/,
    );
    expect(migration).toMatch(
      /UPDATE "CurrencyBalance" SET "characterId" = "subjectId" WHERE "custody" = 'POUCH'/,
    );
    expect(migration).not.toMatch(/DELETE FROM|SET "amount"|DROP COLUMN/);

    const hunt = await startHunt(prisma, resolver, version, T0);
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.bankOf(toAccountId(hunt.accountId)),
        currency: 'GOLD',
        amount: 120n,
        reasonCode: 'test.deposit',
        operationId: toOperationId(`bank-${crypto.randomUUID()}`),
        at: T0,
      }),
    );
    for (const row of await prisma.currencyBalance.findMany({ where: { custody: 'BANK' } })) {
      expect(row.subjectId).toBe(row.accountId);
      expect(row.characterId).toBeNull();
    }
    expect(await readBank(prisma, hunt.accountId)).toBe(120n);
  });

  it('GP15: with both scopes in use, the ledger still reconciles exactly', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 3);
    const carried = await readPouch(prisma, hunt.characterId);
    expect(carried).toBeGreaterThan(0n);

    // A deposit is double entry across the two scopes, which is the movement
    // most likely to make a per-account reconciliation look right while both
    // scopes are wrong.
    await withTransaction(prisma, (tx) =>
      economy.transfer(tx, {
        from: economy.pouchOf(toAccountId(hunt.accountId), hunt.characterId),
        to: economy.bankOf(toAccountId(hunt.accountId)),
        currency: 'GOLD',
        amount: 1n,
        reasonCode: 'gold.deposit',
        operationId: toOperationId(`deposit-${crypto.randomUUID()}`),
        at: new Date(T0.getTime() + minutes(1)),
      }),
    );

    await withTransaction(prisma, async (tx) => {
      const pouch = await economy.reconcile(
        tx,
        economy.pouchOf(toAccountId(hunt.accountId), hunt.characterId),
        'GOLD',
      );
      const bank = await economy.reconcile(tx, economy.bankOf(toAccountId(hunt.accountId)), 'GOLD');
      expect(pouch.reconciles).toBe(true);
      expect(bank.reconciles).toBe(true);
      expect(pouch.projected).toBe(carried - 1n);
      expect(bank.projected).toBe(1n);
      expect(await economy.countReconciliationMismatches(tx)).toBe(0);
    });

    // And every row still carries a carrier the database vouched for.
    for (const entry of await prisma.ledgerEntry.findMany({ where: { custody: 'POUCH' } })) {
      expect(entry.characterId).toBe(hunt.characterId);
    }
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
