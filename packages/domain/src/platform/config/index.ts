/**
 * Environment validation (§11.3): a zod schema, validated AT BOOT, fail-fast.
 *
 * "A process that cannot see its database refuses to start rather than failing
 * on the first request." Configuration is the first half of that promise —
 * this module refuses a process whose configuration is wrong. Readiness
 * (§12.1) is the second half: it refuses traffic when a dependency the
 * configuration names is not actually reachable.
 *
 * Every problem is reported at once. A schema that stops at the first missing
 * variable turns one misconfiguration into as many restarts as there are
 * mistakes.
 */
import { z } from 'zod';

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: 'must be a postgresql:// connection string',
  });

const redisUrl = z
  .string()
  .min(1)
  .refine((value) => /^rediss?:\/\//.test(value), {
    message: 'must be a redis:// or rediss:// connection string',
  });

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

export const configSchema = z.object({
  /** PostgreSQL is the sole durable truth (ADR-009). */
  DATABASE_URL: postgresUrl,
  /**
   * The least-privileged runtime role (I6). Optional because migrations and
   * tooling legitimately run as the owner; when it is set, the application
   * uses it.
   */
  DATABASE_APP_URL: postgresUrl.optional(),
  /** Redis holds nothing that cannot be rebuilt from PostgreSQL (§11.1). */
  REDIS_URL: redisUrl,
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** Local filesystem provider root for content bundles (§7.7). */
  CONTENT_BUNDLE_DIR: z.string().min(1).default('./packages/game-data/bundles'),
});

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigurationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigurationError';
  }
}

/**
 * Read and validate configuration. Throws {@link ConfigurationError} listing
 * EVERY problem found.
 *
 * `process.env` is read HERE and nowhere else in the domain: a value plucked
 * out of the environment deep inside a call stack is a dependency no test can
 * see and no schema can validate.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Undefined and empty are the same thing for configuration: an unset
  // variable and one set to "" are equally not a connection string, and
  // letting "" through produces a failure far from its cause.
  const present: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.length > 0) present[key] = value;
  }

  const parsed = configSchema.safeParse(present);
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return parsed.data;
}
