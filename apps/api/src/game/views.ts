/**
 * The shapes the browser receives (Phase 1 spec §12).
 *
 * Every field here is SERVER-DERIVED. The client renders them; it never sends
 * them back as authority (§19).
 */
import { character as characterContext, content, type PrismaClient } from '@global-idle/domain';

type ResolvedHunt = Awaited<ReturnType<typeof content.resolveHunt>>;
import type { ContentKey, ContentVersion } from '@global-idle/shared';
import type { ContentBundleResolver } from '@global-idle/game-data';

export interface StaminaView {
  readonly remainingMs: number;
  readonly maxMs: number;
  readonly mode: 'CONSUMING' | 'NEUTRAL' | 'RECOVERING';
}

export interface ActivityView {
  readonly activityId: string;
  readonly activityTypeKey: string;
  readonly contentVersion: string;
  readonly contentKey: string;
  readonly hunt: HuntView;
  readonly state: string;
  readonly startedAt: string;
}

export interface HuntView {
  readonly key: string;
  readonly label: string;
  readonly summary: string;
  readonly primaryCreature: string;
  readonly region: string;
  readonly availability: string;
}

export interface CharacterSummary {
  readonly id: string;
  readonly name: string;
  readonly baseLevel: number;
  readonly vocation: string | null;
  readonly stamina: StaminaView;
}

export interface CharacterDetail extends CharacterSummary {
  readonly premium: boolean;
  readonly activity: ActivityView | null;
}

export const huntView = (hunt: ResolvedHunt): HuntView => ({
  key: hunt.key,
  label: hunt.label,
  summary: hunt.summary,
  primaryCreature: hunt.primaryCreature,
  region: hunt.region,
  availability: hunt.availability,
});

/**
 * The Stamina a Character actually has, with the mode DERIVED from its real
 * occupancy — never a constant.
 *
 * Idle is RECOVERING (capped at the maximum, so nothing moves); inside a
 * pre-combat Hunt it is NEUTRAL, because `staminaActivatedAt` is null. Phase 1
 * shows that transition rather than asserting one value.
 */
export async function staminaView(prisma: PrismaClient, characterId: string): Promise<StaminaView> {
  const row = await prisma.characterStamina.findUniqueOrThrow({ where: { characterId } });
  const claim = await prisma.occupancyClaim.findUnique({
    where: { characterId },
    select: {
      activityId: true,
      participant: { select: { staminaActivatedAt: true } },
    },
  });

  let occupancy: Parameters<typeof characterContext.deriveStaminaMode>[0] = { claim: null };
  if (claim) {
    const activity = await prisma.activity.findUniqueOrThrow({
      where: { id: claim.activityId },
      select: { activityTypeKey: true, sessionBound: { select: { state: true } } },
    });
    occupancy = {
      claim: {
        stamina:
          activity.activityTypeKey === 'skill-training'
            ? 'STAMINA_RECOVERY_ELIGIBLE'
            : 'STAMINA_CONSUMING',
        sessionState: (activity.sessionBound?.state ?? 'ONLINE_ACTIVE') as never,
        staminaActivatedAt: claim.participant?.staminaActivatedAt ?? null,
      },
    };
  }

  return {
    remainingMs: row.remainingMs,
    maxMs: characterContext.STAMINA_MAX,
    mode: characterContext.deriveStaminaMode(occupancy),
  };
}

/** The Activity a Character is in, reconstructed from DURABLE state alone:
 *  (contentVersion, contentKey) and nothing from the client (§9.5). */
export async function currentActivity(
  prisma: PrismaClient,
  resolver: ContentBundleResolver,
  characterId: string,
): Promise<ActivityView | null> {
  const claim = await prisma.occupancyClaim.findUnique({
    where: { characterId },
    select: { activityId: true },
  });
  if (!claim) return null;

  const activity = await prisma.activity.findUniqueOrThrow({
    where: { id: claim.activityId },
    select: {
      id: true,
      activityTypeKey: true,
      contentVersion: true,
      contentKey: true,
      createdAt: true,
      sessionBound: { select: { state: true } },
    },
  });

  const hunt = await content.resolveHunt(
    resolver,
    activity.contentVersion as ContentVersion,
    activity.contentKey as ContentKey,
  );

  return {
    activityId: activity.id,
    activityTypeKey: activity.activityTypeKey,
    contentVersion: activity.contentVersion,
    contentKey: activity.contentKey,
    hunt: huntView(hunt),
    state: activity.sessionBound?.state ?? 'UNKNOWN',
    startedAt: activity.createdAt.toISOString(),
  };
}
