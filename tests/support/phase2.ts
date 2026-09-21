/**
 * Support for the Phase 2 groups (spec §12).
 *
 * These cases drive the REAL domain against the REAL database: the real
 * content bundle built from the authored source, the real Activity lifecycle,
 * the real ledger, the real Stamina rows. Nothing is stubbed.
 *
 * The one thing that is not real is the CLOCK, and it must not be: every case
 * below is about what happens after minutes or hours of simulated time, and
 * `advance` takes `now` as a parameter precisely so that time can be supplied
 * instead of waited for. The server still owns it — a test is not a client,
 * and no route anywhere accepts an instant from one.
 */
import {
  activity as activityContext,
  character as characterContext,
  content as contentContext,
  hunt as huntContext,
  identity,
  withTransaction,
  type PrismaClient,
} from '@global-idle/domain';
import { buildBundle, writeBundle, type ContentBundleResolver } from '@global-idle/game-data';
import type { HuntEvent } from '@global-idle/game-engine';
import {
  accountId as toAccountId,
  activityId as toActivityId,
  characterId as toCharacterId,
  contentKey as toContentKey,
  contentVersion as toContentVersion,
  sessionId as toSessionId,
  type ActivityId,
  type Instant,
} from '@global-idle/shared';
import { rookgaardSource, HUNT_KEY } from './phase1.js';

export { HUNT_KEY } from './phase1.js';

/** A run under test: the ids every case needs, and nothing it does not. */
export interface HuntFixture {
  readonly accountId: string;
  readonly characterId: string;
  readonly activityId: ActivityId;
  readonly contentVersion: string;
  readonly startedAt: Instant;
}

/**
 * Publish the authored content and return a resolver over it.
 *
 * The bundle is written to disk and published exactly as a deployment would,
 * so the version a run pins is a real content hash rather than a label.
 */
export async function publishContent(
  prisma: PrismaClient,
  directory: string,
  at: Instant,
): Promise<{ version: string; resolver: ContentBundleResolver }> {
  const artifact = buildBundle(await rookgaardSource());
  await writeBundle(directory, artifact);
  await contentContext.publish(prisma, artifact, directory, at);
  return { version: artifact.version, resolver: contentContext.createResolver(prisma, directory) };
}

export interface StartHuntOptions {
  readonly premium?: boolean;
  /** null is the Origin Character (I1b allows exactly one per account), so a
   *  SECOND Character on the same account has to have one. */
  readonly vocation?: 'KNIGHT' | 'PALADIN' | 'SORCERER' | 'DRUID' | 'MONK' | null;
  readonly staminaRemainingMs?: number;
  readonly baseXp?: bigint;
  readonly name?: string;
  readonly huntKey?: string;
  readonly accountId?: string;
}

/**
 * An Account, a playable Origin Character, and a Hunt in progress — through
 * the same calls the HTTP layer makes, in the same order.
 */
export async function startHunt(
  prisma: PrismaClient,
  resolver: ContentBundleResolver,
  version: string,
  at: Instant,
  options: StartHuntOptions = {},
): Promise<HuntFixture> {
  const accountId =
    options.accountId ??
    (await withTransaction(prisma, async (tx) => {
      const id = `acct-${crypto.randomUUID()}`;
      await tx.account.create({ data: { id, rosterCapacity: 5, createdAt: at } });
      return id;
    }));

  const characterId = await withTransaction(prisma, (tx) =>
    characterContext.createCharacter(tx, {
      accountId: toAccountId(accountId),
      vocation: options.vocation ?? null,
      name: options.name ?? `hunter-${Math.random().toString(36).slice(2, 8)}`,
      baseLevel: 1,
      at,
    }),
  );

  if (options.premium) {
    await withTransaction(prisma, (tx) =>
      identity.grant(tx, {
        accountId: toAccountId(accountId),
        kind: 'PREMIUM',
        validFrom: at,
        // Long enough that no case in this suite outlives it.
        validUntil: new Date(at.getTime() + 400 * 24 * 60 * 60 * 1000),
        reason: 'phase-2-test',
      }),
    );
  }

  if (options.staminaRemainingMs !== undefined) {
    await prisma.characterStamina.update({
      where: { characterId: String(characterId) },
      data: { remainingMs: options.staminaRemainingMs, updatedAt: at },
    });
  }

  if (options.baseXp !== undefined) {
    await prisma.character.update({
      where: { id: String(characterId) },
      data: { baseXp: options.baseXp, baseLevel: huntContext.levelForXp(options.baseXp) },
    });
  }

  const key = options.huntKey ?? HUNT_KEY;
  const activityId = await withTransaction(prisma, async (tx) => {
    const hunt = await contentContext.resolveHunt(
      resolver,
      toContentVersion(version),
      toContentKey(key),
    );
    const id = await activityContext.startSessionBound(tx, {
      accountId: toAccountId(accountId),
      activityTypeKey: activityContext.HUNT,
      contentVersion: toContentVersion(version),
      contentKey: toContentKey(hunt.key),
      participants: [toCharacterId(String(characterId))],
      claimHolderSessionId: toSessionId(`session-${crypto.randomUUID()}`),
      rngSeed: hunt.key,
      at,
    });
    const row = await tx.character.findUniqueOrThrow({
      where: { id: String(characterId) },
      select: { baseXp: true },
    });
    await huntContext.startRun(tx, {
      activityId: id,
      characterId: String(characterId),
      resolver,
      contentVersion: version,
      contentKey: hunt.key,
      level: huntContext.levelForXp(row.baseXp),
      at,
    });
    return id;
  });

  return {
    accountId,
    characterId: String(characterId),
    activityId,
    contentVersion: version,
    startedAt: at,
  };
}

export interface AdvanceOptions {
  readonly seen?: boolean;
  readonly timerIds?: readonly string[];
}

/** One settlement, at one instant. */
export async function advanceOnce(
  prisma: PrismaClient,
  resolver: ContentBundleResolver,
  activityId: ActivityId,
  now: Instant,
  options: AdvanceOptions = {},
) {
  return withTransaction(prisma, (tx) =>
    huntContext.advance(tx, {
      activityId,
      resolver,
      now,
      seen: options.seen ?? true,
      ...(options.timerIds ? { activeUseTimerIds: options.timerIds } : {}),
    }),
  );
}

/**
 * Play a connected client for `durationMs` of simulated time.
 *
 * A real client polls; a run only advances as far as it was PROVEN live, which
 * is `LIVENESS_WINDOW` past the last heartbeat. So a case that wants an hour
 * of Hunt has to spend an hour of heartbeats, exactly as a browser would.
 * Passing one giant instant instead would advance 30 seconds and silently
 * discard the rest — which is the behaviour CX3 depends on.
 */
export async function play(
  prisma: PrismaClient,
  resolver: ContentBundleResolver,
  activityId: ActivityId,
  from: Instant,
  durationMs: number,
  options: AdvanceOptions & { readonly stepMs?: number } = {},
) {
  const step = options.stepMs ?? 20_000;
  let now = from;
  const end = from.getTime() + durationMs;
  const events: HuntEvent[] = [];
  let last = await advanceOnce(prisma, resolver, activityId, now, options);
  events.push(...(last?.events ?? []));
  while (now.getTime() < end) {
    now = new Date(Math.min(now.getTime() + step, end));
    last = await advanceOnce(prisma, resolver, activityId, now, options);
    events.push(...(last?.events ?? []));
    if (last?.endedReason) break;
  }
  return { view: last, at: now, events };
}

/**
 * Play until something is TRUE rather than until a clock says so.
 *
 * Every case below is about an event — the first kill, the first room change,
 * the moment supplies run out — and how many simulated minutes that takes
 * depends on rolls. Waiting for the event keeps the case about the event; a
 * fixed duration would make it about the balance of the content instead, and
 * it would start failing the first time a number is retuned.
 */
export async function playUntil(
  prisma: PrismaClient,
  resolver: ContentBundleResolver,
  activityId: ActivityId,
  from: Instant,
  done: (state: { view: Awaited<ReturnType<typeof advanceOnce>>; events: HuntEvent[] }) => boolean,
  options: AdvanceOptions & { readonly stepMs?: number; readonly budgetMs?: number } = {},
) {
  const step = options.stepMs ?? 20_000;
  const budget = options.budgetMs ?? 4 * 60 * 60 * 1000;
  const events: HuntEvent[] = [];
  let now = from;
  let view = await advanceOnce(prisma, resolver, activityId, now, options);
  events.push(...(view?.events ?? []));

  while (!done({ view, events }) && now.getTime() - from.getTime() < budget) {
    now = new Date(now.getTime() + step);
    view = await advanceOnce(prisma, resolver, activityId, now, options);
    events.push(...(view?.events ?? []));
    if (view?.endedReason) break;
  }
  if (!done({ view, events })) {
    throw new Error(`the run never reached the expected state within ${budget} ms`);
  }
  return { view, at: now, events };
}

/** How many creatures died over a span of settlements. */
export const kills = (events: readonly HuntEvent[]): number =>
  events.filter((event) => event.kind === 'kill').length;

/** The durable row, read back without going through the domain. */
export const readRun = (prisma: PrismaClient, activityId: ActivityId) =>
  prisma.huntRun.findUniqueOrThrow({ where: { activityId: String(activityId) } });

export const readStamina = (prisma: PrismaClient, characterId: string) =>
  prisma.characterStamina.findUniqueOrThrow({ where: { characterId } });

export const readCharacter = (prisma: PrismaClient, characterId: string) =>
  prisma.character.findUniqueOrThrow({ where: { id: characterId } });

/** Every Gold entry an account has, oldest first. */
export const readLedger = (prisma: PrismaClient, accountId: string) =>
  prisma.ledgerEntry.findMany({
    where: { accountId, currency: 'GOLD' },
    orderBy: { createdAt: 'asc' },
  });

export const asActivityId = toActivityId;
