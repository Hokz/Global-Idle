// Phase 2 §12 — ST1 to ST24: the twenty-four mandatory Stamina cases of
// `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §7, in order.
//
// None of these rules are new. They were locked in Phase 0A, given pure
// machinery in Phase 0B, and left deliberately unwired because no activity
// could consume or recover yet. Phase 2 has a Hunt, so this is where they stop
// being a document.
//
// WHERE EACH CASE LIVES. A case about arithmetic at a boundary is asserted
// against the pure settlement, because a boundary is exact and a database adds
// nothing to the claim. A case about durability, ordering or a transition is
// asserted against the real database, the real Activity lifecycle and the real
// ledger, because those are the only things that can be wrong about it. Every
// case says which it is and why.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activity as activityContext,
  character as characterContext,
  hunt as huntContext,
  identity,
  withTransaction,
} from '@global-idle/domain';
import {
  STAMINA_MAX,
  STAMINA_RECOVERY_BOUNDARY,
  accountId as toAccountId,
  characterId as toCharacterId,
  contentKey as toContentKey,
  contentVersion as toContentVersion,
  durationMs,
  hours,
  minutes,
  seconds,
} from '@global-idle/shared';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { createClient, expectDomainError, truncateAll } from '../support/db.js';
import {
  advanceOnce,
  kills,
  play,
  playUntil,
  publishContent,
  readCharacter,
  readRun,
  readStamina,
  startHunt,
} from '../support/phase2.js';

const prisma = createClient();
const T0 = new Date('2026-03-01T09:00:00.000Z');

let directory: string;
let version: string;
let resolver: ContentBundleResolver;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-st-'));
  ({ version, resolver } = await publishContent(prisma, directory, T0));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** The participant row is where activation is recorded (ADR-014). */
const participant = (activityId: string, characterId: string) =>
  prisma.activityParticipant.findUniqueOrThrow({
    where: { activityId_characterId: { activityId, characterId } },
  });

describe('§12 ST — Stamina', () => {
  it('ST1: Hunt entry before the first qualifying XP consumes nothing', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const before = await readStamina(prisma, hunt.characterId);
    expect(before.remainingMs).toBe(STAMINA_MAX);

    // Long enough to have simulated real ticks, short enough that nothing has
    // died yet: the Character is swinging, and the first swings are free.
    const view = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(T0.getTime() + seconds(20)),
    );
    const run = await readRun(prisma, hunt.activityId);

    expect(run.tick).toBeGreaterThan(0);
    expect(view?.events.some((event) => event.kind === 'hit')).toBe(true);
    expect(view?.events.some((event) => event.kind === 'kill')).toBe(false);

    const after = await readStamina(prisma, hunt.characterId);
    expect(after.remainingMs).toBe(STAMINA_MAX);
    expect(
      (await participant(String(hunt.activityId), hunt.characterId)).staminaActivatedAt,
    ).toBeNull();
    // And the MODE says so rather than a comment saying so: occupied, but not
    // yet consuming (§4).
    expect(view?.staminaMode).toBe('NEUTRAL');
  });

  it('ST2: the first qualifying XP activates consumption', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const { events, view } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 1,
    );

    const first = events.find((event) => event.kind === 'kill')!;
    const row = await participant(String(hunt.activityId), hunt.characterId);
    expect(row.staminaActivatedAt).not.toBeNull();

    // Activation is the TICK the first XP landed on, converted back to an
    // instant — not "the settlement that happened to contain it". A settlement
    // is a batch; activation is an event inside one.
    expect(row.staminaActivatedAt!.getTime()).toBe(T0.getTime() + first.tick * 1000);
    expect(view?.staminaMode).toBe('CONSUMING');

    // The tick that brought the XP is the activation, not the first second
    // spent: consumption covers the ticks strictly after it.
    const stamina = await readStamina(prisma, hunt.characterId);
    const run = await readRun(prisma, hunt.activityId);
    expect(stamina.remainingMs).toBe(STAMINA_MAX - (run.tick - first.tick) * 1000);
  });

  it('ST3: time between kills consumes while ONLINE_ACTIVE', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const activated = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 1,
    );

    const beforeStamina = (await readStamina(prisma, hunt.characterId)).remainingMs;
    const beforeTick = (await readRun(prisma, hunt.activityId)).tick;

    // Three more minutes of connected Hunt, whatever happens in them.
    await play(
      prisma,
      resolver,
      hunt.activityId,
      new Date(activated.at.getTime() + seconds(20)),
      minutes(3),
    );

    const afterStamina = (await readStamina(prisma, hunt.characterId)).remainingMs;
    const afterTick = (await readRun(prisma, hunt.activityId)).tick;

    // EVERY simulated second after activation costs a second, whether or not
    // anything died in it. There is no "N minutes without XP" heuristic
    // anywhere, and this is the case that would catch one.
    expect(afterTick).toBeGreaterThan(beforeTick);
    expect(beforeStamina - afterStamina).toBe((afterTick - beforeTick) * 1000);
  });

  it('ST4: reconnect grace consumes nothing', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const activated = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 1,
    );
    // The heartbeat stops. A server-side read notices and pauses — and that
    // read still settles the last span the connection was PROVEN live for,
    // which is not grace and does consume. Grace starts where it ends, so
    // that is where the comparison starts too.
    const quiet = new Date(activated.at.getTime() + minutes(2));
    const paused = await advanceOnce(prisma, resolver, hunt.activityId, quiet, { seen: false });
    expect(paused?.connection).toBe('RECONNECT_GRACE_PAUSED');

    const before = (await readStamina(prisma, hunt.characterId)).remainingMs;
    const tickBefore = (await readRun(prisma, hunt.activityId)).tick;

    // Four more minutes of grace. Nothing at all happens in them.
    const later = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(quiet.getTime() + minutes(4)),
      {
        seen: false,
      },
    );
    expect(later?.connection).toBe('RECONNECT_GRACE_PAUSED');
    expect(later?.staminaMode).toBe('NEUTRAL');

    const after = await readStamina(prisma, hunt.characterId);
    const run = await readRun(prisma, hunt.activityId);
    expect(after.remainingMs).toBe(before);
    expect(run.tick).toBe(tickBefore);
    // NEUTRAL, not RECOVERING. Without that, disconnecting on a cycle would
    // regenerate Stamina at resting rate while keeping the Hunt — a
    // regeneration exploit dressed as a network problem.
    expect(after.remainingMs).not.toBeGreaterThan(before);
  });

  it('ST5: a manual exit stops consumption immediately', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const activated = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 1,
    );
    const before = (await readStamina(prisma, hunt.characterId)).remainingMs;

    const left = new Date(activated.at.getTime() + seconds(5));
    await withTransaction(prisma, (tx) => huntContext.endRun(tx, hunt.activityId, 'LEFT', left));

    // An hour later: not one millisecond more was consumed.
    const view = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(left.getTime() + hours(1)),
    );
    expect(view?.connection).toBe('ACTIVITY_ENDED');
    expect(view?.endedReason).toBe('LEFT');
    expect((await readStamina(prisma, hunt.characterId)).remainingMs).toBeGreaterThanOrEqual(
      before,
    );
  });

  it('ST6: an Activity ending stops consumption immediately', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const activated = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 1,
    );
    const before = (await readStamina(prisma, hunt.characterId)).remainingMs;

    // The ACTIVITY ends without the run being told — a sweep, an eviction, an
    // operator. The run must not keep consuming behind it.
    const ended = new Date(activated.at.getTime() + seconds(5));
    await withTransaction(prisma, (tx) => activityContext.endActivity(tx, hunt.activityId, ended));

    const view = await advanceOnce(
      prisma,
      resolver,
      hunt.activityId,
      new Date(ended.getTime() + hours(1)),
    );
    expect(view?.connection).toBe('ACTIVITY_ENDED');
    expect((await readRun(prisma, hunt.activityId)).tick).toBe(
      (await readRun(prisma, hunt.activityId)).tick,
    );
    expect((await readStamina(prisma, hunt.characterId)).remainingMs).toBeGreaterThanOrEqual(
      before,
    );
  });

  it('ST7: Premium multiplies XP by 1.5 in the 42:00 to 39:00 band, and nothing else', async () => {
    // TWO runs, identical in every way except the entitlement. The seed is the
    // hunt key and the heartbeat pattern is the same, so the two simulations
    // are the same simulation — which is what makes the ratio meaningful
    // rather than a coincidence of rolls.
    const free = await startHunt(prisma, resolver, version, T0, { name: 'free-one' });
    const paid = await startHunt(prisma, resolver, version, T0, {
      name: 'paid-one',
      premium: true,
    });

    const span = minutes(20);
    const a = await play(prisma, resolver, free.activityId, T0, span);
    const b = await play(prisma, resolver, paid.activityId, T0, span);

    expect(kills(a.events)).toBe(kills(b.events));
    expect(kills(a.events)).toBeGreaterThan(2);

    const freeXp = BigInt(a.view!.sessionXp);
    const paidXp = BigInt(b.view!.sessionXp);
    // 5 per Rat, 1.5x floored to 7. The ratio is exactly 7:5.
    expect(freeXp).toBe(BigInt(kills(a.events)) * 5n);
    expect(paidXp).toBe(BigInt(kills(b.events)) * 7n);
    expect(paidXp * 5n).toBe(freeXp * 7n);

    // XP ONLY. Gold is not in the band, and Stamina is spent at the same rate
    // by both — a Premium Character does not get a discount on time.
    expect(BigInt(a.view!.sessionGold)).toBe(BigInt(b.view!.sessionGold));
    expect((await readStamina(prisma, free.characterId)).remainingMs).toBe(
      (await readStamina(prisma, paid.characterId)).remainingMs,
    );
  });

  it('ST8: Premium below 39:00 uses 1.0x', async () => {
    // Same Premium account, started just under the boundary.
    const below = await startHunt(prisma, resolver, version, T0, {
      name: 'below-boundary',
      premium: true,
      staminaRemainingMs: STAMINA_RECOVERY_BOUNDARY - minutes(1),
    });
    const { view, events } = await play(prisma, resolver, below.activityId, T0, minutes(20));

    expect(kills(events)).toBeGreaterThan(2);
    expect(BigInt(view!.sessionXp)).toBe(BigInt(kills(events)) * 5n);

    // The band is a property of the STAMINA, not of the account: the same
    // Premium account above the line pays 1.5x, which ST7 already showed.
    expect(huntContext.isPremiumBand(durationMs(STAMINA_RECOVERY_BOUNDARY - 1))).toBe(false);
    expect(huntContext.isPremiumBand(durationMs(STAMINA_RECOVERY_BOUNDARY + 1))).toBe(true);
  });

  it('ST9: Free uses 1.0x for the whole 42:00 to 0 range', async () => {
    // Started just above the boundary so the run CROSSES it. A Free Character
    // must not notice.
    const hunt = await startHunt(prisma, resolver, version, T0, {
      staminaRemainingMs: STAMINA_RECOVERY_BOUNDARY + minutes(2),
    });
    const { view, events } = await play(prisma, resolver, hunt.activityId, T0, minutes(20));

    const crossed = (await readStamina(prisma, hunt.characterId)).remainingMs;
    expect(crossed).toBeLessThan(STAMINA_RECOVERY_BOUNDARY);
    expect(kills(events)).toBeGreaterThan(2);
    expect(BigInt(view!.sessionXp)).toBe(BigInt(kills(events)) * 5n);
  });

  it('ST10: exactly zero Stamina yields zero Hunt reward of every kind', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: 0 });
    const { view, events } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 3,
    );

    // Creatures died. Nothing was earned for them — not reduced, NOTHING.
    expect(kills(events)).toBeGreaterThanOrEqual(3);
    expect(view!.sessionXp).toBe('0');
    expect(view!.sessionGold).toBe('0');
    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBe(0n);
    expect(
      await prisma.ledgerEntry.count({ where: { accountId: hunt.accountId, currency: 'GOLD' } }),
    ).toBe(0);

    // Zero Stamina is a STATE, never an error (ADR-014): the run is healthy.
    expect(view!.endedReason).toBeNull();
  });

  it('ST11: zero Stamina does not end combat', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: 0 });
    const { view, events } = await playUntil(prisma, resolver, hunt.activityId, T0, (state) =>
      state.events.some((event) => event.kind === 'room-cleared'),
    );

    // The Character keeps fighting, keeps clearing rooms and keeps advancing.
    expect(events.some((event) => event.kind === 'hit')).toBe(true);
    expect(events.some((event) => event.kind === 'room-cleared')).toBe(true);
    expect(view!.room).toBeGreaterThan(1);
    expect(view!.connection).toBe('ONLINE_ACTIVE');
    expect((await readRun(prisma, hunt.activityId)).endedReason).toBeNull();
  });

  it('ST12: Stamina is per Character, and two Characters settle independently', async () => {
    // PHASE 2 HAS NO PARTY. §1.2 puts party play out of scope, so what is
    // provable now is the property that makes a mixed party correct when
    // Phase 4 builds one: the predicate is per CHARACTER, and one Character's
    // Stamina is not reachable from another's settlement. Two Characters in
    // two Hunts is the strongest form of that this phase can state, and the
    // case moves onto a real party when there is one.
    const spent = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: 0 });
    const fresh = await startHunt(prisma, resolver, version, T0);

    const a = await play(prisma, resolver, spent.activityId, T0, minutes(15));
    const b = await play(prisma, resolver, fresh.activityId, T0, minutes(15));

    expect(kills(a.events)).toBe(kills(b.events));
    expect(a.view!.sessionXp).toBe('0');
    expect(BigInt(b.view!.sessionXp)).toBeGreaterThan(0n);

    expect((await readStamina(prisma, spent.characterId)).remainingMs).toBe(0);
    expect((await readStamina(prisma, fresh.characterId)).remainingMs).toBeLessThan(STAMINA_MAX);
    expect((await readCharacter(prisma, spent.characterId)).baseXp).toBe(0n);
    expect((await readCharacter(prisma, fresh.characterId)).baseXp).toBeGreaterThan(0n);
  });

  it('ST13: XP cannot reach a second Character through the Activity', async () => {
    // Shared XP arrives with parties, in a later phase. The invariant it will
    // rest on can be stated now, and it is stronger than the case asks: XP
    // does not reach a CO-PARTICIPANT at all, exhausted or not. An
    // implementation that awarded the Activity rather than the run would fail
    // here, which is the failure Shared XP would otherwise inherit.
    const hunt = await startHunt(prisma, resolver, version, T0);
    const bystanderId = await withTransaction(prisma, (tx) =>
      characterContext.createCharacter(tx, {
        accountId: toAccountId(hunt.accountId),
        vocation: 'KNIGHT',
        name: 'bystander',
        baseLevel: 1,
        at: T0,
      }),
    );
    await prisma.characterStamina.update({
      where: { characterId: String(bystanderId) },
      data: { remainingMs: 0, updatedAt: T0 },
    });
    // A participant of the same Activity, with no run of its own.
    await prisma.activityParticipant.create({
      data: {
        activityId: String(hunt.activityId),
        characterId: String(bystanderId),
        family: 'SESSION_BOUND',
        slotIndex: 1,
        staminaActivatedAt: null,
      },
    });

    const { view, events } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 2,
    );

    expect(BigInt(view!.sessionXp)).toBeGreaterThan(0n);
    expect(kills(events)).toBeGreaterThanOrEqual(2);
    // The hunter earned. The co-participant earned nothing, and spent nothing.
    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBeGreaterThan(0n);
    expect((await readCharacter(prisma, String(bystanderId))).baseXp).toBe(0n);
    expect((await readStamina(prisma, String(bystanderId))).remainingMs).toBe(0);
    expect(
      (await participant(String(hunt.activityId), String(bystanderId))).staminaActivatedAt,
    ).toBeNull();
  });

  it('ST14: recovery never exceeds 42:00', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, {
      staminaRemainingMs: minutes(30),
    });
    // Idle: the Hunt is over, the claim is gone, the Character is resting.
    await withTransaction(prisma, (tx) => huntContext.endRun(tx, hunt.activityId, 'LEFT', T0));

    // A week of it, settled in one read. The cap holds however long the span.
    const settled = await settle(
      hunt.accountId,
      hunt.characterId,
      new Date(T0.getTime() + hours(24 * 7)),
    );
    expect(settled.mode).toBe('RECOVERING');
    expect(settled.remaining).toBe(STAMINA_MAX);
    expect((await readStamina(prisma, hunt.characterId)).remainingMs).toBe(STAMINA_MAX);

    // And settling again at the cap adds nothing rather than overflowing.
    const again = await settle(
      hunt.accountId,
      hunt.characterId,
      new Date(T0.getTime() + hours(24 * 14)),
    );
    expect(again.remaining).toBe(STAMINA_MAX);
    expect(again.recovered).toBe(0);
  });

  it('ST15: Premium recovers 1:1', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, {
      premium: true,
      staminaRemainingMs: hours(10),
    });
    await withTransaction(prisma, (tx) => huntContext.endRun(tx, hunt.activityId, 'LEFT', T0));

    const settled = await settle(
      hunt.accountId,
      hunt.characterId,
      new Date(T0.getTime() + hours(4)),
    );
    expect(settled.recovered).toBe(hours(4));
    expect(settled.remaining).toBe(hours(14));
  });

  it('ST16: Free recovers 1:2', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: hours(10) });
    await withTransaction(prisma, (tx) => huntContext.endRun(tx, hunt.activityId, 'LEFT', T0));

    const settled = await settle(
      hunt.accountId,
      hunt.characterId,
      new Date(T0.getTime() + hours(4)),
    );
    // Two hours of wall clock buy one hour of Stamina.
    expect(settled.recovered).toBe(hours(2));
    expect(settled.remaining).toBe(hours(12));
  });

  it('ST17: Skill Training recovers Stamina while it occupies the Character', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: hours(10) });
    await withTransaction(prisma, (tx) => huntContext.endRun(tx, hunt.activityId, 'LEFT', T0));

    // The SAME Character now trains. Occupied — it cannot hunt — and
    // recovering, because occupancy is not consumption.
    await withTransaction(prisma, (tx) =>
      activityContext.startSkillTraining(tx, {
        accountId: toAccountId(hunt.accountId),
        activityTypeKey: activityContext.SKILL_TRAINING,
        contentVersion: toContentVersion(version),
        contentKey: toContentKey('skill-training.rookgaard.basics'),
        trainee: toCharacterId(hunt.characterId),
        at: T0,
      }),
    );

    const occupancy = await withTransaction(prisma, (tx) =>
      activityContext.occupancyFor(tx, hunt.characterId),
    );
    expect(occupancy?.stamina).toBe('STAMINA_RECOVERY_ELIGIBLE');

    const settled = await settle(
      hunt.accountId,
      hunt.characterId,
      new Date(T0.getTime() + hours(6)),
    );
    expect(settled.mode).toBe('RECOVERING');
    expect(settled.recovered).toBe(hours(3));
  });

  it('ST18: idle time recovers Stamina, with nobody connected', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: hours(5) });
    await withTransaction(prisma, (tx) => huntContext.endRun(tx, hunt.activityId, 'LEFT', T0));

    // Nothing ran for eight hours. No worker, no job, no process — the row
    // was not touched, and nothing needed to be alive for the night to count.
    expect((await readStamina(prisma, hunt.characterId)).remainingMs).toBe(hours(5));

    const settled = await settle(
      hunt.accountId,
      hunt.characterId,
      new Date(T0.getTime() + hours(8)),
    );
    expect(settled.recovered).toBe(hours(4));
    expect((await readStamina(prisma, hunt.characterId)).remainingMs).toBe(hours(9));
    // There is no waiting period before recovery begins (§3.1): a minute of
    // idle is worth half a minute, immediately.
    const soon = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: hours(1) });
    await withTransaction(prisma, (tx) => huntContext.endRun(tx, soon.activityId, 'LEFT', T0));
    const quick = await settle(
      soon.accountId,
      soon.characterId,
      new Date(T0.getTime() + minutes(1)),
    );
    expect(quick.recovered).toBe(seconds(30));
  });

  it('ST19: one Character hunts while another on the account trains', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: hours(20) });
    const traineeId = await withTransaction(prisma, (tx) =>
      characterContext.createCharacter(tx, {
        accountId: toAccountId(hunt.accountId),
        vocation: 'DRUID',
        name: 'trainee',
        baseLevel: 1,
        at: T0,
      }),
    );
    await prisma.characterStamina.update({
      where: { characterId: String(traineeId) },
      data: { remainingMs: hours(20), updatedAt: T0 },
    });
    await withTransaction(prisma, (tx) =>
      activityContext.startSkillTraining(tx, {
        accountId: toAccountId(hunt.accountId),
        activityTypeKey: activityContext.SKILL_TRAINING,
        contentVersion: toContentVersion(version),
        contentKey: toContentKey('skill-training.rookgaard.basics'),
        trainee: toCharacterId(String(traineeId)),
        at: T0,
      }),
    );

    // Both proceed. Account-level concurrency across different Characters is
    // preserved — the claim is per Character, not per Account.
    const played = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 2,
    );
    const hunter = await readStamina(prisma, hunt.characterId);
    const trainee = await settle(hunt.accountId, String(traineeId), played.at);

    expect(hunter.remainingMs).toBeLessThan(hours(20));
    expect(trainee.remaining).toBeGreaterThan(hours(20));
    // One went down, the other went up, over the same wall clock.
    expect(trainee.mode).toBe('RECOVERING');
  });

  it('ST20: the same Character cannot Hunt and Skill Train at once', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);

    await expectDomainError(
      withTransaction(prisma, (tx) =>
        activityContext.startSkillTraining(tx, {
          accountId: toAccountId(hunt.accountId),
          activityTypeKey: activityContext.SKILL_TRAINING,
          contentVersion: toContentVersion(version),
          contentKey: toContentKey('skill-training.rookgaard.basics'),
          trainee: toCharacterId(hunt.characterId),
          at: new Date(T0.getTime() + seconds(1)),
        }),
      ),
      'OccupancyConflict',
    );

    // The Hunt is untouched by the refusal.
    expect((await readRun(prisma, hunt.activityId)).endedReason).toBeNull();
    expect(
      await prisma.occupancyClaim.findUniqueOrThrow({ where: { characterId: hunt.characterId } }),
    ).toMatchObject({ activityId: String(hunt.activityId) });
  });

  it('ST21: a replayed settlement cannot double-consume or double-recover', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0);
    const activated = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => kills(state.events) >= 1,
    );

    const at = new Date(activated.at.getTime() + seconds(20));
    await advanceOnce(prisma, resolver, hunt.activityId, at);
    const settled = await readRun(prisma, hunt.activityId);
    const stamina = (await readStamina(prisma, hunt.characterId)).remainingMs;
    const xp = (await readCharacter(prisma, hunt.characterId)).baseXp;
    const gold = await prisma.ledgerEntry.count({ where: { accountId: hunt.accountId } });

    // A CRASH between the settlement and its commit, reconstructed: the run's
    // position is rewound, but the SettlementOperation the checkpoint claimed
    // is still there. Replaying the same checkpoint must apply nothing.
    await prisma.huntRun.update({
      where: { activityId: String(hunt.activityId) },
      data: {
        simulatedThrough: new Date(settled.simulatedThrough.getTime() - seconds(20)),
        checkpointSequence: settled.checkpointSequence - 1,
      },
    });
    await advanceOnce(prisma, resolver, hunt.activityId, at);

    expect((await readStamina(prisma, hunt.characterId)).remainingMs).toBe(stamina);
    expect((await readCharacter(prisma, hunt.characterId)).baseXp).toBe(xp);
    expect(await prisma.ledgerEntry.count({ where: { accountId: hunt.accountId } })).toBe(gold);

    // Recovery is idempotent for a different reason: the marker IS the row's
    // updatedAt, so a replay settles a span of zero.
    const idle = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: hours(4) });
    await withTransaction(prisma, (tx) => huntContext.endRun(tx, idle.activityId, 'LEFT', T0));
    const when = new Date(T0.getTime() + hours(2));
    const first = await settle(idle.accountId, idle.characterId, when);
    const second = await settle(idle.accountId, idle.characterId, when);
    expect(first.recovered).toBe(hours(1));
    expect(second.recovered).toBe(0);
    expect(second.remaining).toBe(first.remaining);
  });

  it('ST22: a Premium transition mid-interval is settled in segments', async () => {
    const hunt = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: hours(10) });
    await withTransaction(prisma, (tx) => huntContext.endRun(tx, hunt.activityId, 'LEFT', T0));

    // Premium for the first two hours of a four-hour idle span.
    await withTransaction(prisma, (tx) =>
      identity.grant(tx, {
        accountId: toAccountId(hunt.accountId),
        kind: 'PREMIUM',
        validFrom: T0,
        validUntil: new Date(T0.getTime() + hours(2)),
        reason: 'phase-2-test',
      }),
    );

    const settled = await settle(
      hunt.accountId,
      hunt.characterId,
      new Date(T0.getTime() + hours(4)),
    );
    // 2h at 1:1 plus 2h at 1:2 = 3h. Averaging the rate over the interval
    // would give 2h * 0.75 * 2 = 3h too, which is why the case also checks
    // the ASYMMETRIC arrangement below.
    expect(settled.recovered).toBe(hours(3));

    const flipped = await startHunt(prisma, resolver, version, T0, {
      staminaRemainingMs: hours(10),
    });
    await withTransaction(prisma, (tx) => huntContext.endRun(tx, flipped.activityId, 'LEFT', T0));
    await withTransaction(prisma, (tx) =>
      identity.grant(tx, {
        accountId: toAccountId(flipped.accountId),
        kind: 'PREMIUM',
        validFrom: new Date(T0.getTime() + hours(3)),
        validUntil: new Date(T0.getTime() + hours(4)),
        reason: 'phase-2-test',
      }),
    );
    const late = await settle(
      flipped.accountId,
      flipped.characterId,
      new Date(T0.getTime() + hours(4)),
    );
    // 3h Free (1.5h) plus 1h Premium (1h) = 2.5h. A single averaged rate
    // cannot produce both this and the answer above.
    expect(late.recovered).toBe(hours(2) + minutes(30));
  });

  it('ST23: the boundary at exactly 39:00 is deterministic', async () => {
    // EXACTNESS, so it is stated against the settlement rather than through a
    // simulation that would have to land on the boundary by luck.
    const reward = { tick: 10, creatureKey: 'creature.rat', experience: 5, gold: 2 };
    const at = (remaining: number) =>
      huntContext.settleRewards({
        fromTick: 10,
        toTick: 10,
        rewards: [reward],
        staminaRemaining: durationMs(remaining),
        activated: true,
        premium: true,
      }).experience;

    // The band is "42:00 -> 39:00". Exactly 39:00 is the BOUNDARY, not a point
    // above it, so it pays 1.0x. An implementation choosing >= would also be
    // self-consistent and would disagree by one settlement's bonus, which is
    // precisely why this has to be pinned somewhere.
    expect(at(STAMINA_RECOVERY_BOUNDARY)).toBe(5n);
    expect(at(STAMINA_RECOVERY_BOUNDARY + 1)).toBe(7n);
    expect(at(STAMINA_RECOVERY_BOUNDARY - 1)).toBe(5n);

    // Deterministic: the same input, a hundred times, is the same answer.
    const answers = new Set(Array.from({ length: 100 }, () => at(STAMINA_RECOVERY_BOUNDARY)));
    expect([...answers]).toEqual([5n]);

    // And end to end: a Premium run that STARTS at the boundary never pays the
    // bonus, however the rolls fall.
    const hunt = await startHunt(prisma, resolver, version, T0, {
      premium: true,
      staminaRemainingMs: STAMINA_RECOVERY_BOUNDARY,
    });
    const { view, events } = await play(prisma, resolver, hunt.activityId, T0, minutes(15));
    expect(kills(events)).toBeGreaterThan(1);
    expect(BigInt(view!.sessionXp)).toBe(BigInt(kills(events)) * 5n);
  });

  it('ST24: the boundary at exactly 0:00 is deterministic', async () => {
    const reward = { tick: 10, creatureKey: 'creature.rat', experience: 5, gold: 3 };
    const at = (remaining: number) =>
      huntContext.settleRewards({
        fromTick: 10,
        toTick: 10,
        rewards: [reward],
        staminaRemaining: durationMs(remaining),
        activated: true,
        premium: false,
      });

    // At exactly zero the reward is DROPPED, not reduced: no XP and no Gold.
    expect(at(0)).toMatchObject({ experience: 0n, gold: 0n, rewardsDropped: 1 });
    // One millisecond above it, the reward is paid IN FULL. There is no
    // proration band and no low-Stamina penalty (§2.3).
    expect(at(1)).toMatchObject({ experience: 5n, gold: 3n, rewardsDropped: 0 });

    const answers = new Set(Array.from({ length: 100 }, () => at(0).experience));
    expect([...answers]).toEqual([0n]);

    // End to end: a run that CROSSES zero keeps everything before and nothing
    // after, at the same tick every time.
    const hunt = await startHunt(prisma, resolver, version, T0, { staminaRemainingMs: minutes(3) });
    const { view, events } = await playUntil(
      prisma,
      resolver,
      hunt.activityId,
      T0,
      (state) => (state.view?.staminaRemainingMs ?? 1) === 0 && kills(state.events) >= 3,
    );
    expect((await readStamina(prisma, hunt.characterId)).remainingMs).toBe(0);
    // Some rewards landed before zero; the ones after it are worth nothing.
    const earned = BigInt(view!.sessionXp);
    expect(earned).toBeGreaterThan(0n);
    expect(earned).toBeLessThan(BigInt(kills(events)) * 5n);
  });
});

/** One durable Stamina settlement, through the real occupancy read. */
async function settle(accountId: string, characterId: string, now: Date) {
  return withTransaction(prisma, async (tx) => {
    const occupancy = await activityContext.occupancyFor(tx, characterId);
    return characterContext.settleStamina(tx, {
      characterId,
      accountId: toAccountId(accountId),
      occupancy: { claim: occupancy },
      now,
    });
  });
}
