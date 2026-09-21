/**
 * Account creation (§6.3). INTERNAL to the identity context.
 *
 * Foundations only: Phase 1 owns registration and the authentication flows
 * (§19). What exists here is the durable Account an account-scoped operation
 * needs, and the credential link that Phase 1 will hang its flows on.
 */
import { newId, type AccountId, type Instant } from '@global-idle/shared';
import type { UnitOfWork } from '../../platform/transaction/index.js';

export interface CreateAccountInput {
  readonly at: Instant;
  /**
   * 1..5, enforced by a CHECK constraint (I2, §6.4). Not re-validated here:
   * duplicating a database constraint in application code produces two
   * answers that can disagree, and only one of them is enforced under
   * concurrency.
   */
  readonly rosterCapacity?: number;
}

export async function createAccount(tx: UnitOfWork, input: CreateAccountInput): Promise<AccountId> {
  const id = newId<'AccountId'>(input.at);
  await tx.account.create({
    data: { id, rosterCapacity: input.rosterCapacity ?? 1, createdAt: input.at },
  });
  return id;
}

export interface LinkIdentityInput {
  readonly accountId: AccountId;
  readonly provider: string;
  readonly subject: string;
  readonly at: Instant;
}

/** Credential -> Account. The unique constraint on (provider, subject) is what
 *  stops one credential reaching two accounts. */
export async function linkIdentity(tx: UnitOfWork, input: LinkIdentityInput): Promise<string> {
  const id = newId<'AuthIdentityId'>(input.at);
  await tx.authIdentity.create({
    data: {
      id,
      accountId: input.accountId,
      provider: input.provider,
      subject: input.subject,
      createdAt: input.at,
    },
  });
  return id;
}
