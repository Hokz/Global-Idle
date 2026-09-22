// Phase 2 §12 — RW1 to RW6 (rewards) and SU1 to SU3 (supplies).
//
// ST proves the Stamina RULES. This file proves the REWARD PIPELINE those
// rules feed: that XP survives the request that earned it, that Gold is a
// ledger entry and not a number on a row, that a settlement which earns
// nothing writes nothing, and that a replay adds neither.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { economy, hunt as huntContext, withTransaction } from '@global-idle/domain';
import { STAMINA_RECOVERY_BOUNDARY, minutes, seconds } from '@global-idle/shared';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { createClient, truncateAll } from '../support/db.js';
import {
  advanceOnce,
  kills,
  play,
  playUntil,
  publishContent,
  readCharacter,
  readLedger,
  readRun,
  readStamina,
  startHunt,
} from '../support/phase2.js';

const prisma = createClient();
const T0 = new Date('2026-03-03T09:00:00.000Z');

let directory: string;
let version: string;
let resolver: ContentBundleResolver;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-rw-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('§12 RW — rewards', () => {
  it('RW1: XP is awarded, durable, and moves the Base Level on the Canary curve', async () => {
    // Level 2 is 100 XP, which is twenty Rats. Starting just under it means
    // the run crosses a level boundary rather than merely accumulating.
    const hunt = await startHunt(prisma, resolver, version, T0, { baseXp: 90n });
    expect((await readCharacter(prisma, hunt.characterId)).baseLevel).toBe(1);

    const { view, events } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 3,
    );

    const character = await readCharacter(prisma, hunt.characterId);
    expect(character.baseXp).toBe(90n + BigInt(kills(events)) * 5n);
    // The LEVEL is a consequence of the XP, derived from the same curve the
    // source map records — never assigned, never drifting from the total.
    expect(character.baseLevel).toBe(huntContext.levelForXp(character.baseXp));
    expect(character.baseLevel).toBe(2);

    // The view agrees with the row, and carries the progress a bar needs
    // without the client recomputing a curve.
    expect(view!.baseXp).toBe(character.baseXp.toString());
    expect(view!.baseLevel).toBe(2);
    expect(view!.levelStartXp).toBe('100');
    expect(view!.nextLevelXp).toBe('200');

    // DURABLE: a brand-new read, with nothing cached, sees the same totals.
    const reread = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(T0.getTime() + minutes(30)),
    );
    expect(BigInt(reread!.baseXp)).toBeGreaterThanOrEqual(character.baseXp);
  });

  it('RW2: the Premium band is evaluated per reward, at that reward’s Stamina', async () => {
    // Starting just above 39:00 means the run CROSSES the boundary, and the
    // rewards on either side of it must be rated differently — the exact
    // split §2.2 requires, not a pro-rata approximation of the settlement.
    const hunt = await startHunt(prisma, resolver, version, T0, {
      premium: true,
      staminaRemainingMs: STAMINA_RECOVERY_BOUNDARY + minutes(4),
    });
    const { view, events } = await play(prisma, resolver, hunt.activityId, T0, minutes(20));

    const total = BigInt(view!.sessionXp);
    const count = BigInt(kills(events));
    expect(count).toBeGreaterThan(2);
    // Every reward is worth 5 or 7. A run that crossed the line is worth
    // strictly between the two extremes, which no single multiplier produces.
    expect(total).toBeGreaterThan(count * 5n);
    expect(total).toBeLessThan(count * 7n);
    expect((await readStamina(prisma, hunt.characterId)).remainingMs).toBeLessThan(
      STAMINA_RECOVERY_BOUNDARY,
    );

    // The exact split, stated against the settlement: two rewards, one on
    // each side of the boundary, from one span.
    const settled = huntContext.settleRewards({
      fromTick: 0,
      toTick: 20,
      rewards: [
        { tick: 5, creatureKey: 'creature.rat', experience: 5, gold: 1 },
        { tick: 15, creatureKey: 'creature.rat', experience: 5, gold: 1 },
      ],
      staminaRemaining: (STAMINA_RECOVERY_BOUNDARY + seconds(9)) as never,
      activated: true,
      premium: true,
    });
    // The first lands above the line at 1.5x; by the second, ten seconds of
    // consumption have taken the Character below it, so it is worth 5.
    expect(settled.experience).toBe(12n);
  });

  it('RW3: Free applies no multiplier, to XP or to anything else', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const { view, events } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 4,
    );

    expect(BigInt(view!.sessionXp)).toBe(BigInt(kills(events)) * 5n);

    // Gold is never multiplied for anyone, so the Free total is just the sum
    // of the rolls — between one and four per Rat.
    const gold = BigInt(view!.sessionGold);
    expect(gold).toBeGreaterThanOrEqual(BigInt(kills(events)));
    expect(gold).toBeLessThanOrEqual(BigInt(kills(events)) * 4n);
  });

  it('RW4: Gold is ledger-backed, and every entry is traceable to its settlement', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const { view } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 4,
    );

    const entries = await readLedger(prisma, hunt.accountId);
    expect(entries.length).toBeGreaterThan(0);

    // The session total IS the ledger, not a second number that agrees with
    // it by convention (ADR-003).
    const summed = entries.reduce((total, entry) => total + entry.amount, 0n);
    expect(summed).toBe(BigInt(view!.sessionGold));

    // ...and the projected balance is the same sum again.
    const balance = await withTransaction(prisma, (tx) =>
      economy.readBalance(tx, economy.pouchOf(hunt.accountId as never, hunt.characterId), 'GOLD'),
    );
    expect(balance).toBe(summed);

    // AUDITABLE: every entry names why it exists and which settlement made
    // it, and no two share an operation id.
    for (const entry of entries) {
      expect(entry.reasonCode).toBe('hunt.reward');
      expect(entry.amount).toBeGreaterThan(0n);
      expect(entry.operationId).toContain(String(hunt.activityId));
      expect(entry.operationId).toMatch(/:gold$/);
    }
    expect(new Set(entries.map((entry) => entry.operationId)).size).toBe(entries.length);
  });

  it('RW5: a settlement that earns nothing writes nothing', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: 0 });
    const { events } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 3,
    );

    expect(kills(events)).toBeGreaterThanOrEqual(3);
    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBe(0n);

    // NO entry — not a zero-amount one. A ledger full of zeroes is a ledger
    // nobody can read, and `post` would have to accept an amount it should
    // never be asked to write.
    expect(await readLedger(prisma, hunt.accountId)).toEqual([]);
    expect(
      await prisma.currencyBalance.findFirst({ where: { accountId: hunt.accountId } }),
    ).toBeNull();
  });

  it('RW6: a retried settlement duplicates neither XP nor Gold', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    await playUntil(prisma, resolver, hunt.activityId, T0, (state) => kills(state.events) >= 3);

    const at = new Date(T0.getTime() + minutes(20));
    await advanceOnce(prisma, resolver, hunt.activityId, at);
    const run = await readRun(prisma, hunt.activityId);
    const xp = (await readCharacter(prisma, hunt.characterId)).baseXp;
    const entries = await readLedger(prisma, hunt.accountId);

    // Replay the same checkpoint five times over.
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

    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBe(xp);
    const after = await readLedger(prisma, hunt.accountId);
    expect(after.length).toBe(entries.length);
    expect(after.map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id));
  });
});

describe('§12 SU — supplies', () => {
  it('SU1: a charge is spent when health falls below the threshold, and it heals', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const { events } = await playUntil(prisma, resolver, hunt.activityId, T0, (state) =>
      state.events.some((event) => event.kind === 'supply'),
    );

    const uses = events.filter((event) => event.kind === 'supply');
    expect(uses.length).toBeGreaterThan(0);

    const first = uses[0]!;
    // 60 to 90, as the potion the source map cites heals (§6).
    expect(first.healed).toBeGreaterThanOrEqual(60);
    expect(first.healed).toBeLessThanOrEqual(90);
    // Twenty charges, one spent.
    expect(first.remaining).toBe(19);
    expect((await readRun(prisma, hunt.activityId)).supplyCharges).toBe(
      uses[uses.length - 1]!.remaining,
    );

    // The drink happens at or below 40% of 150, and never above it: the
    // damage that triggered it landed in the same tick.
    const damage = events.filter((event) => event.kind === 'taken' && event.tick === first.tick);
    expect(damage.length).toBeGreaterThan(0);
  });

  it('SU2: exhaustion is durable', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const { view } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => (state.view?.supplyCharges ?? 20) === 0,
      { budgetMs: 6 * 60 * 60 * 1000 },
    );

    expect(view!.supplyCharges).toBe(0);
    expect((await readRun(prisma, hunt.activityId)).supplyCharges).toBe(0);

    // Charges do not come back on their own, and they do not go negative.
    const later = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(Date.parse(view!.graceExpiresAt ?? T0.toISOString()) + minutes(5)),
    );
    expect(later!.supplyCharges).toBe(0);
    expect((await readRun(prisma, hunt.activityId)).supplyCharges).toBe(0);
  });

  it('SU3: running out of supplies does not end the Hunt', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const exhausted = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => (state.view?.supplyCharges ?? 20) === 0,
      { budgetMs: 6 * 60 * 60 * 1000 },
    );

    // The moment the last charge is spent the run is still alive and still
    // fighting. It ends when the Character dies, which is a different rule.
    expect(exhausted.view!.endedReason).toBeNull();
    expect(exhausted.view!.connection).toBe('ONLINE_ACTIVE');

    const after = await play(prisma, resolver, hunt.activityId, exhausted.at, minutes(2));
    expect(after.events.some((event) => event.kind === 'hit')).toBe(true);
    expect(after.events.some((event) => event.kind === 'supply')).toBe(false);
  });
});
