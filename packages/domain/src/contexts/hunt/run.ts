/**
 * The Hunt run: advance-on-read settlement (Phase 2 spec §2, §8, §9).
 *
 * THERE IS NO LOOP. A worker per activity is a process that can die between
 * two writes; this is a pure function of durable state and the clock, so a
 * restart resumes rather than recovers. Nothing is decremented on a schedule
 * (ADR-015) — the durable state is a POSITION, and every read moves it forward
 * by however much authoritative time has passed.
 *
 * One settlement is one transaction: simulate, write the run, award XP, post
 * Gold, settle Stamina, settle active-use timers — all under one operation id,
 * so a retry is a no-op rather than a duplicate.
 */
import {
  LOOT_POUCH_SPACES,
  RECONNECT_GRACE,
  activityId as toActivityId,
  characterId as toCharacterId,
  durationMs,
  elapsedSince,
  operationId as toOperationId,
  type ActivityId,
  type DurationMs,
  type Instant,
} from '@global-idle/shared';
import {
  TICK_MS,
  createSeededRandom,
  initialState,
  simulateHunt,
  type HuntEvent,
  type HuntState,
  type MovementLeg,
  type TilePosition,
} from '@global-idle/game-engine';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { claimSettlement, settlementOperationId } from '../../platform/idempotency/index.js';
import { recordDomainEvent } from '../../platform/observability/index.js';
import {
  lockCharactersInOrder,
  lockHuntRun,
  type UnitOfWork,
} from '../../platform/transaction/index.js';
import { endActivity, occupancyFor, pauseForGrace, resumeFromGrace } from '../activity/index.js';
import { settleStamina } from '../character/index.js';
import { pouchOf, post, readBalance } from '../economy/index.js';
import * as items from '../items/index.js';
import { entitlementPort } from '../identity/index.js';
import { createTimerPort } from '../../platform/timer/index.js';
import { levelForXp, levelProgress } from './progression.js';
import { settleDeath, type DeathProtection } from './death.js';
import { buildHuntPlan } from './plan.js';
import { settleRewards } from './rewards.js';

/**
 * How long a run keeps advancing after the last sign of life.
 *
 * A session is `ONLINE_ACTIVE` while a heartbeat arrived inside this window
 * (P2-D7). Time beyond it was never proven to be connected, so it is not
 * simulated — which is what makes "no connection, no progress" true rather
 * than merely intended.
 *
 * NINETY SECONDS, and the number comes from the browser rather than from
 * taste. §8 requires a BACKGROUNDED TAB WITH A LIVE CONNECTION to keep
 * advancing, and every current engine clamps a hidden page's timers to roughly
 * one firing per minute. A window shorter than that clamp would treat a tab
 * that is merely hidden as a connection that is gone, and an idle game whose
 * progress stops when you look away is not an idle game. The cost is the
 * maximum unproven span: a client that genuinely dies is credited with up to
 * ninety seconds it did not connect for, once, after which nothing advances at
 * all.
 */
export const LIVENESS_WINDOW: DurationMs = durationMs(90_000);

/** The framework Stamina is the reference implementation of (ADR-015, §5). */
const timers = createTimerPort();

export type HuntEndReason = 'DIED' | 'LEFT' | 'GRACE_EXPIRED';

export interface HuntRunView {
  readonly activityId: string;
  readonly characterId: string;
  readonly room: number;
  readonly cycle: number;
  readonly tick: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly supplyCharges: number;
  readonly creatures: readonly {
    key: string;
    health: number;
    maxHealth: number;
    /** Phase 3.5 — present only when the Hunt has a map. The id is RUN-LOCAL:
     *  it identifies this actor for as long as it exists and is never a row. */
    id?: string;
    tile?: TilePosition;
    leg?: MovementLeg | null;
  }[];
  /**
   * Phase 3.5 — where the Character IS, and on which map.
   *
   * Null when the Hunt names no map, which is every Phase 2 fixture. The tile
   * is authoritative; the leg is the step in flight, and exists so a browser
   * can interpolate pixels between two server tiles without ever deciding
   * where anything is.
   */
  readonly space: {
    readonly mapKey: string;
    readonly tile: TilePosition;
    readonly leg: MovementLeg | null;
  } | null;
  /**
   * Phase 3.5 — the snapshot's monotonic revision.
   *
   * `checkpointSequence`: it advances once per applied settlement and never
   * goes backwards. A client that holds a higher revision must DISCARD this
   * response — two polls in flight can arrive out of order, and rendering the
   * older one rewinds the world on screen.
   */
  readonly revision: number;
  /** STRINGS on the wire. A bigint does not survive JSON, and a number would
   *  quietly lose precision on a total the curve takes past 2^53. */
  readonly sessionXp: string;
  /** What THIS RUN earned, for display. The authoritative carried total is
   *  `pouchGold`, which is the ledger's projection; this is a per-run counter
   *  and is deliberately not the number anything settles against. */
  readonly sessionGold: string;
  /** The Character's Gold Pouch — CARRIED, and lost on death without Full
   *  Bless (ADR-019). Not the Bank. */
  readonly pouchGold: string;
  /** The DURABLE progression, so the window does not have to ask twice. */
  readonly baseLevel: number;
  readonly baseXp: string;
  readonly levelStartXp: string;
  readonly nextLevelXp: string;
  readonly staminaRemainingMs: number;
  readonly staminaMode: 'CONSUMING' | 'NEUTRAL' | 'RECOVERING';
  readonly connection: 'ONLINE_ACTIVE' | 'RECONNECT_GRACE_PAUSED' | 'ACTIVITY_ENDED';
  readonly graceExpiresAt: string | null;
  readonly endedReason: HuntEndReason | null;
  /** Phase 3 — how full the Loot Pouch is. */
  readonly lootPouch: { readonly used: number; readonly spaces: number };
  /** Present only on the settlement that KILLED the Character. What death
   *  cost, so the window can say it rather than leaving the player to work it
   *  out from two numbers that both went down. */
  readonly penalty: {
    readonly experienceLost: string;
    readonly goldForfeited: string;
    readonly levelBefore: number;
    readonly levelAfter: number;
    readonly fullBless: boolean;
    /** Phase 3 — the physical stacks the death destroyed. */
    readonly lootForfeited: readonly {
      readonly definitionKey: string;
      readonly quantity: number;
    }[];
  } | null;
  readonly events: readonly HuntEvent[];
}

interface StoredCreature {
  readonly key: string;
  readonly health: number;
  readonly nextAttackTick: number;
  /** Phase 3.5 — written by the engine when the Hunt has a map. Optional in
   *  the column for the same reason it is optional in the engine: a Phase 2
   *  run has no space, and absent is not the same as zero. */
  readonly id?: string;
  readonly position?: TilePosition;
  readonly leg?: MovementLeg;
}

/** Create the run beside the Activity, in the same transaction (spec §11). */
export async function startRun(
  tx: UnitOfWork,
  input: {
    readonly activityId: ActivityId;
    readonly characterId: string;
    readonly resolver: ContentBundleResolver;
    readonly contentVersion: string;
    readonly contentKey: string;
    readonly level: number;
    readonly at: Instant;
  },
): Promise<void> {
  const bundle = await input.resolver.resolve(input.contentVersion);
  // The run's opening state comes from what the Character IS WEARING and what
  // it actually brought — not from a content profile and a content charge
  // count, which is the whole difference Phase 3 makes.
  const equipped = await items.equippedItems(tx, input.characterId);
  const supplies = await items.broughtSupplies(tx, bundle, input.characterId);
  const { plan, profile, supplyCharges, space } = buildHuntPlan({
    bundle,
    huntKey: input.contentKey,
    level: input.level,
    equipped,
    supplyCharges: supplies.charges,
    supplyHeal: supplies.heal,
  });
  const state = initialState(profile, plan, supplyCharges);

  await tx.huntRun.create({
    data: {
      activityId: input.activityId,
      characterId: input.characterId,
      room: state.room,
      cycle: state.cycle,
      tick: state.tick,
      simulatedThrough: input.at,
      characterHealth: state.health,
      characterNextAttackTick: state.characterNextAttackTick,
      supplyCharges: state.supplyCharges,
      creatures: [],
      // The Character starts ON the map, at its authored entry tile.
      ...(space ? { position: { tile: space.map.entry } as never } : {}),
      lastSeenAt: input.at,
    },
  });
}

/**
 * Advance a run to `now` and return what a client should see.
 *
 * `seen` marks this call as a sign of life — a heartbeat or a read from a live
 * client. A server-side sweep passes `false`, so it can expire a grace without
 * pretending the player is still there.
 */
/** Everything the view needs that does not change between two settlements. */
interface ProjectionContext {
  readonly activityId: string;
  readonly characterId: string;
  readonly maxHealth: number;
  readonly creatureMaxHealth: (key: string) => number | null;
  readonly pouchUsed: number;
  readonly mapKey: string | null;
}

/** The durable run, at one instant, in the shape the projection reads. */
interface RunProjection {
  readonly room: number;
  readonly cycle: number;
  readonly tick: number;
  readonly characterHealth: number;
  readonly supplyCharges: number;
  readonly creatures: readonly StoredCreature[];
  readonly sessionXp: bigint;
  readonly sessionGold: bigint;
  readonly pouchGold: bigint;
  readonly endedReason: HuntEndReason | null;
  readonly baseXp: bigint;
  readonly staminaRemainingMs: number;
  readonly revision: number;
  readonly position?: { readonly tile: TilePosition; readonly leg?: MovementLeg };
}

/**
 * Durable state → the view, in ONE place.
 *
 * `advance` and `snapshot` must answer with the same shape from the same
 * numbers; the only difference between them is whether the state they hand in
 * was simulated first. Two projections would drift, and the first symptom
 * would be a field the pure read forgets to fill.
 */
function project(
  context: ProjectionContext,
  state: RunProjection,
  connection: HuntRunView['connection'],
  graceExpiresAt: Instant | null,
  events: readonly HuntEvent[],
  penalty: DeathPenalty | null = null,
): HuntRunView {
  const progress = levelProgress(state.baseXp);
  return {
    activityId: context.activityId,
    characterId: context.characterId,
    room: state.room,
    cycle: state.cycle,
    tick: state.tick,
    health: state.characterHealth,
    maxHealth: context.maxHealth,
    supplyCharges: state.supplyCharges,
    creatures: state.creatures.map((creature) => ({
      key: creature.key,
      health: creature.health,
      maxHealth: context.creatureMaxHealth(creature.key) ?? creature.health,
      ...(creature.id === undefined ? {} : { id: creature.id }),
      ...(creature.position === undefined ? {} : { tile: creature.position }),
      ...(creature.position === undefined ? {} : { leg: creature.leg ?? null }),
    })),
    sessionXp: state.sessionXp.toString(),
    sessionGold: state.sessionGold.toString(),
    pouchGold: state.pouchGold.toString(),
    baseLevel: progress.level,
    baseXp: progress.totalXp.toString(),
    levelStartXp: progress.levelStartXp.toString(),
    nextLevelXp: progress.nextLevelXp.toString(),
    staminaRemainingMs: state.staminaRemainingMs,
    // The mode is DERIVED from the same authoritative state the Character
    // context derives it from: ended is recovering, paused is neutral, and a
    // run that has not yet earned its first XP is neutral too (§3.3).
    staminaMode:
      connection === 'ACTIVITY_ENDED'
        ? 'RECOVERING'
        : connection === 'RECONNECT_GRACE_PAUSED'
          ? 'NEUTRAL'
          : state.tick > 0 && state.sessionXp > 0n
            ? 'CONSUMING'
            : 'NEUTRAL',
    connection,
    graceExpiresAt: graceExpiresAt ? graceExpiresAt.toISOString() : null,
    endedReason: state.endedReason,
    // Phase 3 — how full the Loot Pouch is. "Nothing is being picked up" is
    // a state the player has to be able to SEE before they can fix it.
    lootPouch: { used: context.pouchUsed, spaces: LOOT_POUCH_SPACES },
    penalty: penalty
      ? {
          experienceLost: penalty.experienceLost.toString(),
          goldForfeited: penalty.goldForfeited.toString(),
          levelBefore: penalty.levelBefore,
          levelAfter: penalty.levelAfter,
          fullBless: penalty.fullBless,
          lootForfeited: penalty.lootForfeited,
        }
      : null,
    events,
    // Phase 3.5 — space, and the revision that orders two snapshots.
    space:
      context.mapKey !== null && state.position
        ? {
            mapKey: context.mapKey,
            tile: state.position.tile,
            leg: state.position.leg ?? null,
          }
        : null,
    revision: state.revision,
  };
}

export async function advance(
  tx: UnitOfWork,
  input: {
    readonly activityId: ActivityId;
    readonly resolver: ContentBundleResolver;
    readonly now: Instant;
    readonly seen: boolean;
    /**
     * Active-use timers to settle against this Hunt's qualifying time
     * (§5 of ACTIVITY_OCCUPANCY_AND_TIMERS.md, cases 25–28).
     *
     * INJECTED rather than looked up: Phase 2 ships no player-facing timed
     * effect — no XP boost, no Imbuement — so there is no ownership to model
     * yet, and inventing an owner column for a feature that does not exist
     * would be a schema decision made by the wrong phase. The seam is the real
     * settlement path, under the same operation id as everything else, and the
     * cases drive it with a real timer.
     */
    readonly activeUseTimerIds?: readonly string[];
  },
): Promise<HuntRunView | null> {
  // LOCK BEFORE READING, in §8.5's order: Character, then the Activity's run.
  //
  // Not a formality. Without it a Leave can commit between this read and the
  // checkpoint write, and the settlement goes on to simulate, award and
  // possibly KILL inside a run that is already over — a checkpoint applied
  // past the ending, and a death the ending has no way to charge for. Holding
  // the row for the whole settlement makes the terminal transition a race
  // nobody can tie: whichever transaction takes this lock first decides how
  // the run ended, and the other one sees that decision instead of making a
  // second one.
  //
  // The first read is for the Character id alone, which is immutable, so it
  // does not need the lock it is about to take.
  const identity = await tx.huntRun.findUnique({
    where: { activityId: input.activityId },
    select: { characterId: true },
  });
  if (!identity) return null;
  await lockCharactersInOrder(tx, [identity.characterId]);
  await lockHuntRun(tx, String(input.activityId));

  const run = await tx.huntRun.findUnique({ where: { activityId: input.activityId } });
  if (!run) return null;

  /**
   * Active-use timers burn EXACTLY the span this settlement simulated, and
   * stop being qualifying the moment the run stops advancing.
   *
   * Two things make cases 25 to 28 true rather than approximately true. The
   * first is the INSTANT: a checkpoint settles at the point the simulation
   * reached, never at the wall clock the request happened to arrive on, so an
   * unproven span cannot be billed to a timer. The second is the TRANSITION:
   * a paused, expired or dead run leaves qualifying, so the marker does not
   * sit there accumulating through the pause and get collected on the far
   * side of it — which is what a checkpoint-only implementation does, and it
   * reads as "grace consumed five minutes of my Imbuement".
   *
   * Injecting the ids is the seam (see the parameter): Phase 2 ships no timed
   * effect to own them, so what burns is the caller's to say. WHEN it burns
   * is not.
   */
  const timerIds = input.activeUseTimerIds ?? [];

  const burnTimers = async (from: Instant, to: Instant, operation: string): Promise<void> => {
    for (const timerId of timerIds) {
      // No-op when it is already qualifying: only a STATE TRANSITION moves the
      // marker (I15).
      await timers.enterQualifying(tx, timerId, from);
      await timers.settleCheckpoint(
        tx,
        timerId,
        to,
        toOperationId(`${operation}:timer:${timerId}`),
      );
    }
  };

  const stopTimers = async (at: Instant, operation: string): Promise<void> => {
    for (const timerId of timerIds) {
      await timers.leaveQualifying(tx, timerId, at, toOperationId(`${operation}:stop:${timerId}`));
    }
  };

  const activity = await tx.activity.findUniqueOrThrow({
    where: { id: input.activityId },
    select: { contentVersion: true, contentKey: true, sessionBound: true },
  });
  const bound = activity.sessionBound;
  const character = await tx.character.findUniqueOrThrow({
    where: { id: run.characterId },
    select: { id: true, accountId: true, baseXp: true, baseLevel: true },
  });

  const bundle = await input.resolver.resolve(activity.contentVersion);
  const equipped = await items.equippedItems(tx, run.characterId);
  const supplies = await items.broughtSupplies(tx, bundle, run.characterId);
  const { plan, profile, space } = buildHuntPlan({
    bundle,
    huntKey: activity.contentKey,
    level: levelForXp(character.baseXp),
    equipped,
    supplyCharges: supplies.charges,
    supplyHeal: supplies.heal,
  });

  // Stamina is brought up to `now` FIRST, through the character context's own
  // settlement. A Hunt that ended or is in grace leaves the Character
  // recovering, and that recovery is this read's to apply — a Hunt read is
  // still a read, and advance-on-read is the whole model (P2-D1).
  const occupancy = await occupancyFor(tx, run.characterId);
  const stamina = await settleStamina(tx, {
    characterId: run.characterId,
    accountId: character.accountId as never,
    occupancy: { claim: occupancy },
    now: input.now,
  });

  const view = (
    state: RunProjection,
    connection: HuntRunView['connection'],
    graceExpiresAt: Instant | null,
    events: readonly HuntEvent[],
    penalty: DeathPenalty | null = null,
  ): HuntRunView =>
    project(
      {
        activityId: String(input.activityId),
        characterId: run.characterId,
        maxHealth: profile.maxHealth,
        creatureMaxHealth: (key) => plan.creatures[key]?.maxHealth ?? null,
        pouchUsed,
        mapKey: space?.map.key ?? null,
      },
      state,
      connection,
      graceExpiresAt,
      events,
      penalty,
    );

  // The CARRIED total, read from the ledger's projection rather than summed
  // from the run: a Character may have carried Gold in from an earlier Hunt,
  // and a run counter cannot know about it.
  const pouchGold = await readBalance(
    tx,
    pouchOf(character.accountId as never, run.characterId),
    'GOLD',
  );
  const pouchUsed = await items.pouchSpaces(tx, run.characterId);

  const storedPosition = run.position as RunProjection['position'] | null;
  const stored: RunProjection = {
    room: run.room,
    cycle: run.cycle,
    tick: run.tick,
    characterHealth: run.characterHealth,
    supplyCharges: run.supplyCharges,
    creatures: run.creatures as unknown as StoredCreature[],
    sessionXp: run.sessionXp,
    sessionGold: run.sessionGold,
    pouchGold,
    endedReason: run.endedReason as HuntEndReason | null,
    baseXp: character.baseXp,
    staminaRemainingMs: stamina.remaining,
    revision: run.checkpointSequence,
    ...(storedPosition ? { position: storedPosition } : {}),
  };

  // ── ended ────────────────────────────────────────────────────────────────
  if (run.endedReason !== null || bound === null || bound.state === 'ACTIVITY_ENDED') {
    await stopTimers(run.simulatedThrough, `${String(input.activityId)}:ended`);
    return view(stored, 'ACTIVITY_ENDED', null, []);
  }

  // ── paused in reconnect grace ────────────────────────────────────────────
  if (bound.state === 'RECONNECT_GRACE_PAUSED') {
    const deadline = bound.graceExpiresAt;
    await stopTimers(run.simulatedThrough, `${String(input.activityId)}:grace`);
    if (deadline && input.now >= deadline) {
      await endRun(tx, input.activityId, 'GRACE_EXPIRED', input.now);
      return view({ ...stored, endedReason: 'GRACE_EXPIRED' }, 'ACTIVITY_ENDED', null, []);
    }
    if (input.seen) {
      // Reconnect INSIDE the window resumes the same run at the same state.
      // `simulatedThrough` jumps to now, which is what makes the paused time
      // cost nothing: no ticks, no Stamina, no timers, no rewards (§8).
      await resumeFromGrace(tx, input.activityId);
      await tx.huntRun.update({
        where: { activityId: input.activityId },
        data: { simulatedThrough: input.now, lastSeenAt: input.now },
      });
      return view(stored, 'ONLINE_ACTIVE', null, []);
    }
    return view(stored, 'RECONNECT_GRACE_PAUSED', deadline ?? null, []);
  }

  // ── online ───────────────────────────────────────────────────────────────
  //
  // Only the span that was PROVEN LIVE is simulated. Anything past
  // `lastSeenAt + LIVENESS_WINDOW` happened with nobody connected.
  const liveThrough = new Date(run.lastSeenAt.getTime() + LIVENESS_WINDOW);
  const simulateTo = input.now < liveThrough ? input.now : liveThrough;
  const availableMs = Math.max(0, simulateTo.getTime() - run.simulatedThrough.getTime());
  const ticks = Math.floor(availableMs / TICK_MS);
  /** The instant the simulation actually reached. Everything settles here. */
  const simulatedTo = new Date(run.simulatedThrough.getTime() + ticks * TICK_MS);

  let next: RunProjection = stored;
  let events: readonly HuntEvent[] = [];

  if (ticks > 0) {
    const sequence = run.checkpointSequence + 1;
    const operation = settlementOperationId(String(input.activityId), sequence);
    const fresh = await claimSettlement(tx, operation, 'hunt.checkpoint', input.now);
    if (!fresh) {
      // This checkpoint is already applied — a concurrent settlement won the
      // race, or this is a replay of one that committed. Either way the work
      // is done and doing it again would double the XP, the Gold, the supply
      // consumption and the Stamina.
      //
      // The answer is to APPLY NOTHING and return what is durable. An earlier
      // version re-entered `advance` to "read the fresh state", which inside
      // the same transaction re-read the same snapshot and looped until the
      // transaction timed out — a retry storm dressed as a re-read. The
      // winner has already advanced `checkpointSequence`, so the caller's next
      // read computes the next sequence and moves on by itself.
      return view(stored, 'ONLINE_ACTIVE', null, []);
    }

    // The persisted tile, or the map's entry the first time a spatial run
    // advances. Never a pixel, never interpolated: the row holds a TILE.
    const persistedPosition =
      (run.position as { tile?: TilePosition } | null)?.tile ?? space?.map.entry ?? null;

    const state: HuntState = {
      tick: run.tick,
      room: run.room,
      cycle: run.cycle,
      health: run.characterHealth,
      supplyCharges: run.supplyCharges,
      creatures: stored.creatures,
      characterNextAttackTick: run.characterNextAttackTick,
      ended: null,
      ...(persistedPosition === null ? {} : { position: persistedPosition }),
    };

    // The seed includes the tick, so a settlement is a pure function of the
    // persisted position: a rolled-back attempt replays identically, and a
    // restart resumes the same future.
    const rng = createSeededRandom(`${bound.rngSeed}:${state.tick}`);
    // A SECOND stream for physical loot, so the fight's draw sequence is
    // exactly what Phase 2 was verified against. Both are pure functions of
    // the persisted position, so a replay reproduces the drops as well as the
    // hits.
    const lootRng = createSeededRandom(`${bound.rngSeed}:${state.tick}:loot`);
    const step = simulateHunt(state, profile, plan, ticks, rng, lootRng, space);
    events = step.events;

    const participant = await tx.activityParticipant.findUniqueOrThrow({
      where: {
        activityId_characterId: { activityId: input.activityId, characterId: run.characterId },
      },
      select: { staminaActivatedAt: true },
    });
    const staminaRow = await tx.characterStamina.findUniqueOrThrow({
      where: { characterId: run.characterId },
    });
    const entitlements = await entitlementPort.activeAt(
      tx,
      character.accountId as never,
      input.now,
    );
    const premium = entitlements.some((entitlement) => entitlement.kind === 'PREMIUM');

    const settled = settleRewards({
      fromTick: state.tick,
      toTick: step.state.tick,
      rewards: step.rewards,
      staminaRemaining: durationMs(staminaRow.remainingMs),
      activated: participant.staminaActivatedAt !== null,
      premium,
    });

    // Activation is the tick the first qualifying XP landed on (§2.1).
    if (settled.activatedAtTick !== null) {
      await tx.activityParticipant.update({
        where: {
          activityId_characterId: { activityId: input.activityId, characterId: run.characterId },
        },
        data: {
          staminaActivatedAt: new Date(
            run.simulatedThrough.getTime() + (settled.activatedAtTick - state.tick) * TICK_MS,
          ),
        },
      });
    }

    if (settled.staminaConsumed > 0 || settled.staminaRemaining !== staminaRow.remainingMs) {
      await tx.characterStamina.update({
        where: { characterId: run.characterId },
        data: { remainingMs: settled.staminaRemaining, updatedAt: input.now },
      });
    }

    if (settled.experience > 0n) {
      const total = character.baseXp + settled.experience;
      await tx.character.update({
        where: { id: run.characterId },
        data: { baseXp: total, baseLevel: levelForXp(total) },
      });
    }

    // Active-use timers burn only while the Hunt is actually advancing, which
    // is this branch and nowhere else: a paused run returns above without
    // reaching here, and so does one with no elapsed ticks (cases 25, 26).
    await burnTimers(run.simulatedThrough, simulatedTo, operation);

    if (settled.gold > 0n) {
      // THE POUCH, not the Bank (ADR-019). Gold a creature dropped is CARRIED:
      // it is at risk until it is deposited, and death without Full Bless
      // takes it. Crediting the account balance here — which is what this did
      // before — made every coin safe the instant it dropped and quietly
      // deleted the risk a Hunt is supposed to carry.
      await post(tx, {
        subject: pouchOf(character.accountId as never, run.characterId),
        currency: 'GOLD',
        amount: settled.gold,
        reasonCode: 'hunt.reward',
        operationId: toOperationId(`${operation}:gold`),
        at: input.now,
      });
    }

    // ── physical loot ───────────────────────────────────────────────────
    //
    // The engine said what fell; this decides what is COLLECTED. Policy first,
    // then space, then Capacity — and a refusal at any of them is a reason the
    // Game Window can show, never an error and never an end to the Hunt.
    const collected: { definitionKey: string; quantity: number }[] = [];
    if (step.rewards.length > 0) {
      const policy = await items.readPolicy(tx, run.characterId);
      const identityRng = createSeededRandom(`${bound.rngSeed}:${state.tick}:identity`);
      const rewarded = new Set(settled.rewardedTicks);
      for (const reward of step.rewards) {
        // Zero Stamina drops the WHOLE reward, loot included (§2.3, §14).
        if (!rewarded.has(reward.tick)) continue;
        for (const drop of reward.loot) {
          const identity = items.rollIdentity(bundle, drop.itemKey, identityRng);
          if (!items.accepts(policy, bundle, drop.itemKey, identity.rarity)) {
            events = [
              ...events,
              { tick: reward.tick, kind: 'loot-skipped', item: drop.itemKey, reason: 'policy' },
            ];
            continue;
          }
          const placed = await items.placeInPouch(tx, {
            bundle,
            accountId: character.accountId,
            characterId: run.characterId,
            baseLevel: levelForXp(character.baseXp + settled.experience),
            definitionKey: drop.itemKey,
            quantity: drop.quantity,
            rarity: identity.rarity,
            affixes: identity.affixes,
            at: input.now,
          });
          if (placed.collected > 0) {
            collected.push({ definitionKey: drop.itemKey, quantity: placed.collected });
            events = [
              ...events,
              { tick: reward.tick, kind: 'loot', item: drop.itemKey, quantity: placed.collected },
            ];
          } else if (placed.reason !== 'ok') {
            events = [
              ...events,
              {
                tick: reward.tick,
                kind: 'loot-skipped',
                item: drop.itemKey,
                reason: placed.reason,
              },
            ];
          }
        }
      }
    }

    // A supply charge is a real potion now, so drinking one has to remove one.
    if (step.suppliesUsed > 0 && supplies.definitionKey) {
      await items.consumeSupplies(tx, run.characterId, supplies.definitionKey, step.suppliesUsed);
    }

    next = {
      room: step.state.room,
      cycle: step.state.cycle,
      tick: step.state.tick,
      characterHealth: step.state.health,
      supplyCharges: step.state.supplyCharges,
      creatures: step.state.creatures as unknown as StoredCreature[],
      sessionXp: run.sessionXp + settled.experience,
      sessionGold: run.sessionGold + settled.gold,
      pouchGold: pouchGold + settled.gold,
      endedReason: step.state.ended,
      baseXp: character.baseXp + settled.experience,
      staminaRemainingMs: settled.staminaRemaining,
      // The revision the client will hold after this settlement commits.
      revision: sequence,
      ...(step.state.position === undefined
        ? {}
        : {
            position: {
              tile: step.state.position,
              ...(step.state.leg === undefined ? {} : { leg: step.state.leg }),
            },
          }),
    };

    await tx.huntRun.update({
      where: { activityId: input.activityId },
      data: {
        room: next.room,
        cycle: next.cycle,
        tick: next.tick,
        simulatedThrough: simulatedTo,
        characterHealth: next.characterHealth,
        characterNextAttackTick: step.state.characterNextAttackTick,
        supplyCharges: next.supplyCharges,
        creatures: next.creatures as never,
        ...(step.state.position === undefined
          ? {}
          : {
              position: {
                tile: step.state.position,
                ...(step.state.leg === undefined ? {} : { leg: step.state.leg }),
              } as never,
            }),
        sessionXp: next.sessionXp,
        sessionGold: next.sessionGold,
        checkpointSequence: sequence,
        ...(input.seen ? { lastSeenAt: input.now } : {}),
      },
    });

    if (step.state.ended === 'DIED') {
      await stopTimers(simulatedTo, operation);
      const penalty = await endRun(tx, input.activityId, 'DIED', input.now);
      // RE-READ, because `endRun` just took some of it away. Returning `next`
      // here would show the player the experience and the Gold they had a
      // moment before dying, which is the one moment they will look hardest.
      const after = await tx.character.findUniqueOrThrow({
        where: { id: run.characterId },
        select: { baseXp: true },
      });
      const carried = await readBalance(
        tx,
        pouchOf(character.accountId as never, run.characterId),
        'GOLD',
      );
      return view(
        { ...next, endedReason: 'DIED', baseXp: after.baseXp, pouchGold: carried },
        'ACTIVITY_ENDED',
        null,
        events,
        penalty,
      );
    }
  } else if (input.seen) {
    await tx.huntRun.update({
      where: { activityId: input.activityId },
      data: { lastSeenAt: input.now },
    });
  }

  // The connection went quiet for longer than the window. The five minutes run
  // from the last moment anyone was PROVEN to be there, and the deadline is
  // computed the same way whoever asks — a server sweep, a poll, or the
  // reconnect itself. A deadline that depended on who noticed would let a
  // client extend its own grace by staying away.
  if (elapsedSince(run.lastSeenAt, input.now) > LIVENESS_WINDOW) {
    const graceExpiresAt = new Date(liveThrough.getTime() + RECONNECT_GRACE);
    if (input.now >= graceExpiresAt) {
      await stopTimers(simulatedTo, `${String(input.activityId)}:expired`);
      await endRun(tx, input.activityId, 'GRACE_EXPIRED', input.now);
      return view({ ...next, endedReason: 'GRACE_EXPIRED' }, 'ACTIVITY_ENDED', null, events);
    }
    if (!input.seen) {
      await stopTimers(simulatedTo, `${String(input.activityId)}:paused`);
      await pauseForGrace(tx, input.activityId, graceExpiresAt);
      await tx.huntRun.update({
        where: { activityId: input.activityId },
        data: { simulatedThrough: input.now },
      });
      return view(next, 'RECONNECT_GRACE_PAUSED', graceExpiresAt, events);
    }
    // A reconnect inside the window. The unproven span produced nothing and
    // cost nothing: no ticks, no Stamina, no timers, no rewards (§8).
    await stopTimers(simulatedTo, `${String(input.activityId)}:gap`);
    await tx.huntRun.update({
      where: { activityId: input.activityId },
      data: { simulatedThrough: input.now, lastSeenAt: input.now },
    });
  }

  return view(next, 'ONLINE_ACTIVE', null, events);
}

/**
 * The run as it stands DURABLY, without advancing it (Phase 3.5 §6).
 *
 * The mutating read is deliberately gone from GET. Advance-on-read is still
 * the model — it is just that "read" now means a POST the client sends on its
 * own clock, because a GET is the one verb the whole stack is allowed to
 * repeat: a retry, a prefetch, a double-render in React strict mode or a
 * proxy's revalidation all re-issue it, and every one of those was a
 * settlement the player never asked for.
 *
 * This writes NOTHING. What it reports is the state as of the last applied
 * settlement, which is what "pure" means here rather than an approximation of
 * it: Stamina is the durable figure, not one settled to now, and no event is
 * replayed because events belong to the settlement that produced them.
 */
export async function snapshot(
  tx: UnitOfWork,
  input: {
    readonly activityId: ActivityId;
    readonly resolver: ContentBundleResolver;
  },
): Promise<HuntRunView | null> {
  const run = await tx.huntRun.findUnique({ where: { activityId: input.activityId } });
  if (!run) return null;

  const activity = await tx.activity.findUniqueOrThrow({
    where: { id: input.activityId },
    select: { contentVersion: true, contentKey: true, sessionBound: true },
  });
  const character = await tx.character.findUniqueOrThrow({
    where: { id: run.characterId },
    select: { id: true, accountId: true, baseXp: true },
  });

  const bundle = await input.resolver.resolve(activity.contentVersion);
  const equipped = await items.equippedItems(tx, run.characterId);
  const supplies = await items.broughtSupplies(tx, bundle, run.characterId);
  const { plan, profile, space } = buildHuntPlan({
    bundle,
    huntKey: activity.contentKey,
    level: levelForXp(character.baseXp),
    equipped,
    supplyCharges: supplies.charges,
    supplyHeal: supplies.heal,
  });

  const stamina = await tx.characterStamina.findUniqueOrThrow({
    where: { characterId: run.characterId },
    select: { remainingMs: true },
  });
  const pouchGold = await readBalance(
    tx,
    pouchOf(character.accountId as never, run.characterId),
    'GOLD',
  );
  const pouchUsed = await items.pouchSpaces(tx, run.characterId);

  const bound = activity.sessionBound;
  const ended = run.endedReason !== null || bound === null || bound.state === 'ACTIVITY_ENDED';
  const paused = !ended && bound?.state === 'RECONNECT_GRACE_PAUSED';
  const connection: HuntRunView['connection'] = ended
    ? 'ACTIVITY_ENDED'
    : paused
      ? 'RECONNECT_GRACE_PAUSED'
      : 'ONLINE_ACTIVE';

  const storedPosition = run.position as RunProjection['position'] | null;
  return project(
    {
      activityId: String(input.activityId),
      characterId: run.characterId,
      maxHealth: profile.maxHealth,
      creatureMaxHealth: (key) => plan.creatures[key]?.maxHealth ?? null,
      pouchUsed,
      mapKey: space?.map.key ?? null,
    },
    {
      room: run.room,
      cycle: run.cycle,
      tick: run.tick,
      characterHealth: run.characterHealth,
      supplyCharges: run.supplyCharges,
      creatures: run.creatures as unknown as StoredCreature[],
      sessionXp: run.sessionXp,
      sessionGold: run.sessionGold,
      pouchGold,
      endedReason: run.endedReason as HuntEndReason | null,
      baseXp: character.baseXp,
      staminaRemainingMs: stamina.remainingMs,
      revision: run.checkpointSequence,
      ...(storedPosition ? { position: storedPosition } : {}),
    },
    connection,
    paused ? (bound?.graceExpiresAt ?? null) : null,
    [],
  );
}

/**
 * End whatever live session-bound Activity a SESSION holds.
 *
 * Signing out is an explicit departure, so §8 gives it no grace: the run ends
 * now, the claim is released now, and the next sign-in starts clean. Leaving
 * the Activity behind would strand the Character in an occupancy claim held by
 * a session that no longer exists, which the sweeper would only clear five
 * minutes later — for a player who told us they were going.
 */
export async function endForSession(
  tx: UnitOfWork,
  claimHolderSessionId: string,
  at: Instant,
): Promise<string | null> {
  const bound = await tx.sessionBoundActivity.findFirst({
    where: {
      claimHolderSessionId,
      state: { in: ['ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED'] },
    },
    select: { activityId: true },
  });
  if (!bound) return null;
  await endRunOrActivity(tx, toActivityId(bound.activityId), 'LEFT', at);
  return bound.activityId;
}

/**
 * End an Activity, as a Hunt if it is one.
 *
 * A Hunt LEAVES — it has a run to close and a reason to record. Anything else
 * just ends. Both paths release the claim; the difference is whether there is
 * a run that has to agree with the Activity about being over.
 */
export async function endRunOrActivity(
  tx: UnitOfWork,
  activityId: ActivityId,
  reason: HuntEndReason,
  at: Instant,
): Promise<void> {
  const run = await tx.huntRun.findUnique({
    where: { activityId },
    select: { activityId: true },
  });
  if (run) await endRun(tx, activityId, reason, at);
  else await endActivity(tx, activityId, at);
}

/**
 * End a run and the Activity with it, releasing the occupancy claim.
 *
 * ONCE ONLY, and it is the ROW LOCK that makes it so rather than the read.
 *
 * Testing `endedReason` on an unlocked read is only safe against SEQUENTIAL
 * retries: two concurrent callers both see `null`, both settle, and a death
 * burns the experience and the Gold Pouch twice. Under ReadCommitted that is
 * not a theoretical interleaving — it is the default one. So the run row is
 * locked and tested in one statement, and everything after that point runs
 * with the ending held.
 *
 * WHICH ENDING WINS is therefore decided by the lock: the first transaction to
 * take it writes the run's only `endedReason`, and a later caller — a Leave
 * that raced a death, a sweep that raced a Leave — returns here having applied
 * nothing. That is the whole precedence rule, and it needs no ranking of
 * reasons because a death is only ever DETERMINED inside this lock: a Leave
 * that wins the race stops the simulation that would have produced one, so
 * there is no death left unpaid, and a death that wins leaves the Leave
 * nothing to do.
 *
 * The Character is locked first, per §8.5. A caller that already holds both
 * rows — `advance`, which takes them before it simulates — re-acquires them
 * without waiting.
 */
export async function endRun(
  tx: UnitOfWork,
  activityId: ActivityId,
  reason: HuntEndReason,
  at: Instant,
): Promise<DeathPenalty | null> {
  const identity = await tx.huntRun.findUnique({
    where: { activityId },
    select: { characterId: true },
  });
  if (!identity) return null;
  await lockCharactersInOrder(tx, [identity.characterId]);

  const held = await lockHuntRun(tx, String(activityId));
  if (!held.present || held.endedReason !== null) return null;

  const run = await tx.huntRun.findUniqueOrThrow({ where: { activityId } });

  // DEATH IS THE ONLY ENDING THAT COSTS ANYTHING. Leaving and losing a
  // connection are not punished: §8 already ends the run, and inventing a
  // penalty for them would make the reconnect grace a trap rather than a
  // mercy.
  const penalty =
    reason === 'DIED' ? await settleDeathPenalty(tx, run.characterId, at, activityId) : null;

  await tx.huntRun.update({
    where: { activityId },
    data: { endedReason: reason, endedAt: at },
  });
  await endActivity(tx, activityId, at);
  recordDomainEvent({
    kind: 'hunt.ended',
    activityId: String(activityId),
    characterId: run.characterId,
    reason,
    room: run.room,
    cycle: run.cycle,
    ...(penalty
      ? {
          experienceLost: penalty.experienceLost.toString(),
          goldForfeited: penalty.goldForfeited.toString(),
          levelAfter: penalty.levelAfter,
          itemsForfeited: penalty.lootForfeited.length,
        }
      : {}),
  });
  return penalty;
}

export interface DeathPenalty {
  readonly experienceLost: bigint;
  readonly levelBefore: number;
  readonly levelAfter: number;
  readonly goldForfeited: bigint;
  /** Phase 3 — the PHYSICAL loot the death destroyed, item by item. Enough to
   *  answer "where did my loot go" without an item ledger nobody replays. */
  readonly lootForfeited: readonly {
    readonly definitionKey: string;
    readonly quantity: number;
  }[];
  readonly fullBless: boolean;
}

/**
 * Apply what death costs: Base XP by Canary's formula, and the whole Gold
 * Pouch unless the Character had Full Bless.
 *
 * The forfeiture is a real ledger entry, not a reset: value leaves the economy
 * with a reason and an operation id, so "where did my gold go" survives the
 * one movement a player is most likely to dispute (ADR-019).
 */
async function settleDeathPenalty(
  tx: UnitOfWork,
  characterId: string,
  at: Instant,
  activityId: ActivityId,
): Promise<DeathPenalty> {
  const character = await tx.character.findUniqueOrThrow({
    where: { id: characterId },
    select: { accountId: true, baseXp: true, vocation: true, blessings: true, promoted: true },
  });

  const protection: DeathProtection = {
    blessings: character.blessings,
    promoted: character.promoted,
  };
  const settled = settleDeath({
    experience: character.baseXp,
    protection,
    vocation: character.vocation,
  });

  if (settled.experienceLost > 0n) {
    await tx.character.update({
      where: { id: characterId },
      data: { baseXp: settled.experienceAfter, baseLevel: settled.levelAfter },
    });
  }

  let goldForfeited = 0n;
  // Phase 3 — the Loot Pouch goes with the Gold Pouch, and on the same
  // condition. Carried-reward protection stays BINARY: six blessings lose
  // both, seven keep both. Equipment, the Hunt containers, the supplies that
  // were brought, the Depot and the Stash are untouched by this rule, which is
  // why the delete names `LOOT_POUCH` and nothing else.
  let lootForfeited: readonly { definitionKey: string; quantity: number }[] = [];
  if (settled.forfeitsCarried) {
    lootForfeited = await items.emptyPouch(tx, characterId);
    if (lootForfeited.length > 0) {
      recordDomainEvent({
        kind: 'hunt.death.loot-forfeit',
        characterId,
        activityId: String(activityId),
        items: lootForfeited,
      });
    }
  }
  if (settled.forfeitsCarried) {
    const pouch = pouchOf(character.accountId as never, characterId);
    const carried = await readBalance(tx, pouch, 'GOLD');
    if (carried > 0n) {
      await post(tx, {
        subject: pouch,
        currency: 'GOLD',
        amount: -carried,
        reasonCode: 'hunt.death.forfeit',
        operationId: toOperationId(`hunt.death:${characterId}:${at.toISOString()}`),
        at,
      });
      goldForfeited = carried;
    }
  }

  return {
    experienceLost: settled.experienceLost,
    levelBefore: settled.levelBefore,
    levelAfter: settled.levelAfter,
    goldForfeited,
    lootForfeited,
    fullBless: !settled.forfeitsCarried,
  };
}

export const asActivityId = toActivityId;
export const asCharacterId = toCharacterId;
