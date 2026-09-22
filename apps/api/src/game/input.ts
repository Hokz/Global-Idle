/**
 * The edge, where external input stops being arbitrary (Phase 3 correction).
 *
 * Not a DTO framework and not a validation layer — six functions, because six
 * is what the Phase 3 mutating routes actually need. What they have in common
 * is the failure they remove: `Number("abc")` is `NaN` and reaches the
 * database as a parameter, `BigInt("abc")` THROWS and reaches the client as a
 * 500, and an unbounded JSON array reaches a `Json` column intact. A client
 * that sent nonsense should be told so with a 4xx; a 500 says the server is
 * broken, and it is not.
 *
 * Zod lives in `@global-idle/game-data` and validates CONTENT. Pulling it into
 * the API for six bounds would be a dependency for a decision, not for a
 * problem.
 */
import { HttpStatus } from '@nestjs/common';
import { fail } from './errors.js';

const refuse = (message: string): never => {
  throw fail(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_REQUEST', message);
};

/** A whole number inside a stated range. `NaN`, floats and strings that only
 *  look numeric are all the same answer. */
export function wholeNumber(value: unknown, name: string, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return refuse(`${name} must be a whole number between ${min} and ${max}.`);
  }
  return parsed;
}

/** The same, but absent is allowed and reported as `undefined`. */
export function optionalWholeNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number | undefined {
  return value === undefined || value === null ? undefined : wholeNumber(value, name, min, max);
}

/** A positive amount of money. `BigInt` throws on nonsense, which is exactly
 *  the 500 this exists to prevent. */
export function positiveAmount(value: unknown, name: string): bigint {
  const raw = typeof value === 'bigint' ? value.toString() : String(value ?? '').trim();
  if (!/^\d{1,20}$/.test(raw)) return refuse(`${name} must be a whole positive amount.`);
  const parsed = BigInt(raw);
  if (parsed <= 0n) return refuse(`${name} must be greater than zero.`);
  return parsed;
}

/** An identifier the server will look up. Bounded so a megabyte cannot become
 *  a query parameter. */
export function identifier(value: unknown, name: string, max = 128): string {
  const raw = String(value ?? '').trim();
  if (raw.length === 0 || raw.length > max) {
    return refuse(`${name} must be between 1 and ${max} characters.`);
  }
  return raw;
}

/** A value from a closed set the SERVER owns. */
export function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  const raw = String(value ?? '').trim();
  if (!(allowed as readonly string[]).includes(raw)) {
    return refuse(`${name} must be one of: ${allowed.join(', ')}.`);
  }
  return raw as T;
}

export interface LootRuleInput {
  readonly itemKey?: string;
  readonly category?: string;
  readonly rarity?: string;
  readonly accept: boolean;
}

const RARITIES = ['COMMON', 'SEMI_RARE', 'RARE', 'MYSTIC', 'LEGENDARY', 'STELLAR'] as const;

/**
 * Loot filter rules, bounded in COUNT and in SHAPE.
 *
 * Without this the route wrote whatever JSON arrived into a `Json` column, and
 * `accepts()` then read back fields it had never agreed to. The cap is a
 * product bound as much as a safety one: a filter nobody can read is not a
 * filter.
 */
export function lootRules(value: unknown, max = 64): LootRuleInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return refuse('rules must be an array.');
  if (value.length > max) return refuse(`rules may not exceed ${max} entries.`);
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return refuse(`rules[${index}] must be an object.`);
    }
    const row = entry as Record<string, unknown>;
    if (typeof row['accept'] !== 'boolean') {
      return refuse(`rules[${index}].accept must be a boolean.`);
    }
    const rule: LootRuleInput = {
      accept: row['accept'],
      ...(row['itemKey'] === undefined
        ? {}
        : { itemKey: identifier(row['itemKey'], `rules[${index}].itemKey`) }),
      ...(row['category'] === undefined
        ? {}
        : { category: identifier(row['category'], `rules[${index}].category`, 64) }),
      ...(row['rarity'] === undefined
        ? {}
        : { rarity: oneOf(row['rarity'], `rules[${index}].rarity`, RARITIES) }),
    };
    return rule;
  });
}

/**
 * A published bundle version, as `buildBundle` mints it: `v` followed by the
 * first sixteen hex characters of the content's SHA-256.
 *
 * This is checked BEFORE the value reaches the content resolver, because the
 * filesystem resolver ultimately builds `join(directory, `${version}.json`)`
 * from it. A branded cast is a type-level promise, not a check; a route
 * parameter is whatever the network sent.
 */
const CONTENT_VERSION = /^v[0-9a-f]{16}$/;

export const isPublishedVersion = (value: string): boolean =>
  value.length === 17 && CONTENT_VERSION.test(value);
