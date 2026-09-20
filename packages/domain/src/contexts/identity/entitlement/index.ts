/**
 * Account-wide entitlements (§7.5). INTERNAL to the identity context.
 *
 * `validUntil: null` means PERMANENT — expiry is optional, not part of the
 * definition (DOMAIN_MODEL.md §5.17). Transitions are auditable, and §8.1
 * makes the audit record part of the same transaction as the entitlement row.
 */
import { newId, type AccountId, type DurationMs, type Instant } from '@global-idle/shared';
import { durationMs } from '@global-idle/shared';
import type { UnitOfWork } from '../../../platform/transaction/index.js';

export type EntitlementKind = 'PREMIUM';

export interface Entitlement {
  readonly accountId: AccountId;
  readonly kind: EntitlementKind;
  readonly validFrom: Instant;
  readonly validUntil: Instant | null;
}

/** A sub-interval over which the entitlement state does not change (§7.4). */
export interface RateSegment {
  readonly from: Instant;
  readonly to: Instant;
  readonly duration: DurationMs;
  readonly premium: boolean;
}

export interface EntitlementPort {
  activeAt(tx: UnitOfWork, accountId: AccountId, at: Instant): Promise<Entitlement[]>;
  segmentsBetween(
    tx: UnitOfWork,
    accountId: AccountId,
    from: Instant,
    to: Instant,
  ): Promise<RateSegment[]>;
}

export const entitlementPort: EntitlementPort = {
  async activeAt(tx, accountId, at) {
    const rows = await tx.entitlement.findMany({
      where: {
        accountId,
        validFrom: { lte: at },
        OR: [{ validUntil: null }, { validUntil: { gt: at } }],
      },
    });
    return rows.map((row) => ({
      accountId: row.accountId as AccountId,
      kind: row.kind as EntitlementKind,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
    }));
  },

  /**
   * Cut [from, to) at every entitlement transition, so §7.4's segmented
   * settlement can rate each piece on its own terms. An interval that crosses
   * a Premium boundary is SPLIT; it is never settled at one rate and
   * approximated (test T5).
   */
  async segmentsBetween(tx, accountId, from, to) {
    if (to.getTime() <= from.getTime()) return [];

    const rows = await tx.entitlement.findMany({
      where: {
        accountId,
        kind: 'PREMIUM',
        validFrom: { lt: to },
        OR: [{ validUntil: null }, { validUntil: { gt: from } }],
      },
      orderBy: { validFrom: 'asc' },
    });

    const boundaries = new Set<number>([from.getTime(), to.getTime()]);
    for (const row of rows) {
      const start = row.validFrom.getTime();
      const end = row.validUntil?.getTime();
      if (start > from.getTime() && start < to.getTime()) boundaries.add(start);
      if (end !== undefined && end > from.getTime() && end < to.getTime()) boundaries.add(end);
    }

    const cuts = [...boundaries].sort((a, b) => a - b);
    const segments: RateSegment[] = [];
    for (let index = 0; index < cuts.length - 1; index += 1) {
      const start = cuts[index]!;
      const end = cuts[index + 1]!;
      const premium = rows.some((row) => {
        const rowStart = row.validFrom.getTime();
        const rowEnd = row.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
        return rowStart <= start && rowEnd >= end;
      });
      segments.push({
        from: new Date(start),
        to: new Date(end),
        duration: durationMs(end - start),
        premium,
      });
    }
    return segments;
  },
};

/** Grant an entitlement and record the transition, in one transaction (§8.1).
 *  A dev/test fixture may use this so Phase 2 can be tested before the Phase 8
 *  store exists — it is a seeded row through the ordinary domain path, not a
 *  bypass (§7.5). */
export async function grant(
  tx: UnitOfWork,
  input: {
    accountId: AccountId;
    kind: EntitlementKind;
    validFrom: Instant;
    validUntil: Instant | null;
    reason: string;
  },
): Promise<string> {
  const id = newId<'EntitlementId'>(input.validFrom);
  await tx.entitlement.create({
    data: {
      id,
      accountId: input.accountId,
      kind: input.kind,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
    },
  });
  await tx.entitlementAudit.create({
    data: {
      id: newId<'EntitlementId'>(input.validFrom),
      entitlementId: id,
      transition: 'GRANTED',
      occurredAt: input.validFrom,
      reason: input.reason,
    },
  });
  return id;
}

export async function revoke(
  tx: UnitOfWork,
  entitlementId: string,
  at: Instant,
  reason: string,
): Promise<void> {
  await tx.entitlement.update({ where: { id: entitlementId }, data: { validUntil: at } });
  await tx.entitlementAudit.create({
    data: {
      id: newId<'EntitlementId'>(at),
      entitlementId,
      transition: 'REVOKED',
      occurredAt: at,
      reason,
    },
  });
}
