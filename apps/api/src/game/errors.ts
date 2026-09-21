/**
 * One error envelope for every route (Phase 1 spec §12).
 *
 * The UI switches on `code`, never on prose, so the prose can improve without
 * breaking a client. Domain errors carry their own code already; anything else
 * becomes INTERNAL and its detail stays server-side.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { DomainError } from '@global-idle/domain';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'NAME_INVALID'
  | 'NAME_TAKEN'
  | 'ROSTER_FULL'
  | 'ORIGIN_CHARACTER_EXISTS'
  | 'OCCUPANCY_CONFLICT'
  | 'HUNT_NOT_FOUND'
  | 'CONTENT_KIND_MISMATCH'
  | 'CONTENT_UNAVAILABLE'
  | 'INTERNAL';

export function fail(status: HttpStatus, code: ErrorCode, message: string, details?: unknown) {
  return new HttpException({ error: { code, message, details } }, status);
}

/** Existence is information. A character or activity that is not this
 *  account's is reported as absent, not forbidden (§19). */
export const notFound = () => fail(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
export const unauthenticated = () =>
  fail(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in first.');

const DOMAIN_TO_HTTP: Record<string, { status: HttpStatus; code: ErrorCode }> = {
  RosterCapacityExceeded: { status: HttpStatus.CONFLICT, code: 'ROSTER_FULL' },
  OriginCharacterExists: { status: HttpStatus.CONFLICT, code: 'ORIGIN_CHARACTER_EXISTS' },
  CharacterNameTaken: { status: HttpStatus.CONFLICT, code: 'NAME_TAKEN' },
  OccupancyConflict: { status: HttpStatus.CONFLICT, code: 'OCCUPANCY_CONFLICT' },
  ActivityClaimHeld: { status: HttpStatus.CONFLICT, code: 'OCCUPANCY_CONFLICT' },
  HuntNotFound: { status: HttpStatus.NOT_FOUND, code: 'HUNT_NOT_FOUND' },
  ContentKindMismatch: { status: HttpStatus.UNPROCESSABLE_ENTITY, code: 'CONTENT_KIND_MISMATCH' },
  ContentBundleUnavailable: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: 'CONTENT_UNAVAILABLE',
  },
};

/** Translate a domain failure, or rethrow. A domain error this map does not
 *  name is a bug in the map, not a 500 to be swallowed quietly. */
export function asHttp(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof DomainError) {
    const mapped = DOMAIN_TO_HTTP[error.code];
    if (mapped) return fail(mapped.status, mapped.code, error.message, error.details);
  }
  return fail(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL', 'Something went wrong.');
}
