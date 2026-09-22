/**
 * Where a Character is, for the purposes of logistics (Phase 3 spec §13.1).
 *
 * INTERNAL to the items context. There are two contexts and the SERVER decides
 * which one applies: in an active Hunt, or somewhere safe. The Depot, the
 * Stash, every counter and every Bank movement are unreachable from the first
 * one — which is the whole of "no remote supplies", expressed once instead of
 * as six separate guards that each have to remember.
 */
import { serviceUnavailableHere } from '../../platform/errors/index.js';
import type { UnitOfWork } from '../../platform/transaction/index.js';

export async function inActiveHunt(tx: UnitOfWork, characterId: string): Promise<boolean> {
  const claim = await tx.occupancyClaim.findUnique({
    where: { characterId },
    select: { activityId: true },
  });
  if (!claim) return false;
  const activity = await tx.activity.findUnique({
    where: { id: claim.activityId },
    select: { sessionBound: { select: { state: true } } },
  });
  const state = activity?.sessionBound?.state;
  return state === 'ONLINE_ACTIVE' || state === 'RECONNECT_GRACE_PAUSED';
}

/** Refuse anything that would amount to reaching a town from inside a sewer. */
export async function assertSafeContext(
  tx: UnitOfWork,
  characterId: string,
  what: string,
): Promise<void> {
  if (await inActiveHunt(tx, characterId)) {
    throw serviceUnavailableHere({ characterId, what });
  }
}
