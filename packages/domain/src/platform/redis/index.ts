/**
 * Redis (§11.1) — rebuildable only.
 *
 * Every key family below has a DOCUMENTED REBUILD PATH, and this module makes
 * that structural rather than a promise: a write to a key outside the table is
 * refused. The rule "Redis holds nothing that matters" survives exactly as
 * long as nobody can quietly add a sixth family holding something that does.
 *
 * The activity claim is AUTHORITATIVE IN POSTGRESQL (ADR-009). Redis only
 * fronts it, which is why every read here is a read-THROUGH: a miss is not an
 * answer, it is a trip to the durable source.
 */
import { Redis } from 'ioredis';

export interface RedisKeyFamily {
  /** The key prefix, without the trailing colon. */
  readonly prefix: string;
  readonly holds: string;
  /** What happens if the whole instance is flushed. */
  readonly ifFlushed: string;
}

/** §11.1, verbatim. Adding a family means adding its rebuild path. */
export const REDIS_KEY_FAMILIES: readonly RedisKeyFamily[] = [
  {
    prefix: 'session:presence',
    holds: 'connection liveness',
    ifFlushed: 'sessions reconnect',
  },
  {
    prefix: 'activity:claim',
    holds: 'fast path over the authoritative PostgreSQL claim',
    ifFlushed: 'rebuilt from PostgreSQL',
  },
  {
    prefix: 'bull',
    holds: 'BullMQ queues and timers',
    ifFlushed: 'the sweeper recovers; a lost job delays a decision, never changes one',
  },
  { prefix: 'ratelimit', holds: 'counters', ifFlushed: 'limits reset' },
  {
    prefix: 'cache:content',
    holds: 'derived content projections',
    ifFlushed: 'cold cache',
  },
] as const;

export class UndocumentedRedisKey extends Error {
  constructor(readonly key: string) {
    super(
      `Redis key "${key}" belongs to no documented key family. §11.1 requires every ` +
        `family to have a rebuild path; add it there before writing it here. ` +
        `Known: ${REDIS_KEY_FAMILIES.map((family) => `${family.prefix}:*`).join(', ')}.`,
    );
    this.name = 'UndocumentedRedisKey';
  }
}

export function familyOf(key: string): RedisKeyFamily | undefined {
  return REDIS_KEY_FAMILIES.find((family) => key.startsWith(`${family.prefix}:`));
}

/** Throws unless the key belongs to a family with a documented rebuild path. */
export function assertRebuildable(key: string): RedisKeyFamily {
  const family = familyOf(key);
  if (!family) throw new UndocumentedRedisKey(key);
  return family;
}

export const sessionPresenceKey = (sessionId: string) => `session:presence:${sessionId}`;
export const activityClaimKey = (accountId: string) => `activity:claim:${accountId}`;
export const rateLimitKey = (bucket: string) => `ratelimit:${bucket}`;
export const contentCacheKey = (version: string) => `cache:content:${version}`;

export function createRedis(url: string): Redis {
  // A queue client must not give up on a command mid-flight, and BullMQ
  // requires this setting explicitly.
  return new Redis(url, { maxRetriesPerRequest: null });
}

/** Default lifetime for a fronted value. Short on purpose: the cache is a
 *  latency optimisation, and a stale fast path is worse than a slow one. */
export const DEFAULT_CACHE_TTL_SECONDS = 30;

export interface RedisPort {
  readonly client: Redis;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * Read through to the durable source on a miss, then front the answer.
   *
   * `load` is what makes the key rebuildable: it is the authoritative read,
   * and it runs whenever Redis cannot answer — including after a total flush.
   */
  readThrough<T>(key: string, load: () => Promise<T>, ttlSeconds?: number): Promise<T>;
}

export function createRedisPort(client: Redis): RedisPort {
  return {
    client,

    async get(key) {
      assertRebuildable(key);
      return client.get(key);
    },

    async set(key, value, ttlSeconds = DEFAULT_CACHE_TTL_SECONDS) {
      assertRebuildable(key);
      await client.set(key, value, 'EX', ttlSeconds);
    },

    async del(key) {
      assertRebuildable(key);
      await client.del(key);
    },

    async readThrough<T>(key: string, load: () => Promise<T>, ttlSeconds?: number): Promise<T> {
      assertRebuildable(key);

      const cached = await client.get(key);
      if (cached !== null) return JSON.parse(cached) as T;

      const value = await load();
      // A cached null is still an answer, so it is stored like any other.
      await client.set(key, JSON.stringify(value), 'EX', ttlSeconds ?? DEFAULT_CACHE_TTL_SECONDS);
      return value;
    },
  };
}
