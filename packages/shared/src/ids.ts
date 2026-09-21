/**
 * Identifiers (§6.2).
 *
 * UUIDv7, generated in APPLICATION CODE, never by a database default:
 * `uuidv7()` is not available on every PostgreSQL version this may deploy to,
 * and generating here keeps id creation testable and deterministic under a
 * fake clock (test D3).
 *
 * An identifier is NOT a secret and NOT an authorization control
 * (DOMAIN_MODEL.md §4). No 0B code may rely on an id being unguessable.
 */
import { v7 as uuidv7 } from 'uuid';
import type { Instant } from './time.js';

declare const brand: unique symbol;
type Branded<T extends string> = string & { readonly [brand]: T };

export type AccountId = Branded<'AccountId'>;
export type CharacterId = Branded<'CharacterId'>;
export type ActivityId = Branded<'ActivityId'>;
export type SessionId = Branded<'SessionId'>;
export type EntitlementId = Branded<'EntitlementId'>;
export type LedgerEntryId = Branded<'LedgerEntryId'>;
export type TimerId = Branded<'TimerId'>;
export type OperationId = Branded<'OperationId'>;
export type ContentVersion = Branded<'ContentVersion'>;
export type ActivityTypeKey = Branded<'ActivityTypeKey'>;
/** A canonical content key — `hunt.rookgaard.sewers`. The grammar lives in
 *  packages/game-data/src/keys.ts and is mirrored by a database CHECK. */
export type ContentKey = Branded<'ContentKey'>;

/**
 * A time-ordered identifier. `at` is the authoritative instant the caller is
 * already holding — the clock is injected at the call site, never read here,
 * so id generation stays deterministic under a FakeClock.
 */
export function newId<T extends string>(at: Instant): Branded<T> {
  return uuidv7({ msecs: at.getTime() }) as Branded<T>;
}

export const accountId = (value: string): AccountId => value as AccountId;
export const characterId = (value: string): CharacterId => value as CharacterId;
export const activityId = (value: string): ActivityId => value as ActivityId;
export const sessionId = (value: string): SessionId => value as SessionId;
export const operationId = (value: string): OperationId => value as OperationId;
export const contentVersion = (value: string): ContentVersion => value as ContentVersion;
export const activityTypeKey = (value: string): ActivityTypeKey => value as ActivityTypeKey;
export const contentKey = (value: string): ContentKey => value as ContentKey;
