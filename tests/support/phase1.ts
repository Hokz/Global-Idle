/**
 * Support for the Phase 1 groups (spec §16).
 *
 * Every helper here drives the REAL stack: the real Nest application on an
 * ephemeral port, the real content bundle built from the authored source, the
 * real database. Nothing is stubbed. A suite that mocked the orchestration
 * layer would prove the mocks agree with each other, which is not what any of
 * these cases claim.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { content, type AppConfig, type PrismaClient } from '@global-idle/domain';
import { buildBundle, writeBundle, type BundleSource } from '@global-idle/game-data';
import { createApp } from '../../apps/api/src/app.factory.js';
import { REPO_ROOT } from './repo.js';

export type App = Awaited<ReturnType<typeof createApp>>;

/** The authored Phase 1 content, read from the file the game ships. */
export async function rookgaardSource(): Promise<BundleSource> {
  const file = join(REPO_ROOT, 'packages', 'game-data', 'content', 'rookgaard.json');
  return JSON.parse(await readFile(file, 'utf8')) as BundleSource;
}

/**
 * Build the authored bundle, write it where the resolver will find it, and
 * publish it so `current()` returns it.
 *
 * Returns the version, which is a CONTENT HASH — the same source always
 * produces the same one, which is what makes a pinned version durable.
 */
export async function publishRookgaard(
  prisma: PrismaClient,
  directory: string,
  at: Date = new Date(),
): Promise<string> {
  const artifact = buildBundle(await rookgaardSource());
  await writeBundle(directory, artifact);
  await content.publish(prisma, artifact, directory, at);
  return artifact.version;
}

/** Start the real application on an ephemeral port. */
export async function startApp(overrides: Partial<AppConfig> = {}): Promise<{
  app: App;
  base: string;
}> {
  const app = await createApp({ LOG_LEVEL: 'silent', ...overrides });
  await app.listen(0);
  return { app, base: await app.getUrl() };
}

export interface Response<T> {
  readonly status: number;
  readonly body: T;
  readonly headers: Headers;
}

export interface ErrorBody {
  readonly error?: { readonly code?: string; readonly message?: string };
}

/**
 * One HTTP call, carrying a cookie jar of exactly one cookie.
 *
 * The cookie is passed explicitly rather than kept in module state: several
 * cases here are ABOUT two sessions disagreeing, and a shared jar would quietly
 * make them one.
 */
export async function call<T = unknown>(
  base: string,
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<Response<T>> {
  const { cookie, ...rest } = init;
  const response = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(rest.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body: body as T, headers: response.headers };
}

/** The `Set-Cookie` value, reduced to what a browser would send back. */
export function cookieFrom(response: Response<unknown>): string {
  const header = response.headers.get('set-cookie');
  if (!header) throw new Error('No Set-Cookie header on that response.');
  return header.split(';')[0] ?? '';
}

/** Sign in through the real dev route and return the cookie it set. */
export async function signIn(base: string, handle: string): Promise<string> {
  const response = await call(base, '/api/session', {
    method: 'POST',
    body: JSON.stringify({ handle }),
  });
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`sign-in failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return cookieFrom(response);
}

export interface CharacterBody {
  readonly id: string;
  readonly name: string;
  readonly baseLevel: number;
  readonly vocation: string | null;
  readonly stamina: { readonly remainingMs: number; readonly maxMs: number; readonly mode: string };
  readonly premium?: boolean;
  readonly activity?: unknown;
}

/** Create a character through the real route. */
export async function createCharacter(
  base: string,
  cookie: string,
  name: string,
): Promise<CharacterBody> {
  const response = await call<CharacterBody>(base, '/api/characters', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ name }),
  });
  if (response.status >= 300) {
    throw new Error(`create failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

/** A fresh idempotency key. Real clients mint one per click (§12). */
export const idempotencyKey = (): string => crypto.randomUUID();

/** Enter a Hunt through the real route, carrying the key §12 requires. */
export async function enterHunt<T = unknown>(
  base: string,
  cookie: string,
  characterId: string,
  huntKey: string,
  key: string = idempotencyKey(),
): Promise<Response<T>> {
  return call<T>(base, `/api/characters/${characterId}/hunt`, {
    method: 'POST',
    cookie,
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ huntKey }),
  });
}

export const HUNT_KEY = 'hunt.rookgaard.sewers';
export const MARKER_KEY = 'marker.rookgaard.sewers';
export const REGION_KEY = 'region.rookgaard';
