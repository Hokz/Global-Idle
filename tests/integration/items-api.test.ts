/**
 * Phase 3 §10.1 and §17 — the Depot's HTTP contract.
 *
 * Unnumbered, deliberately: the §20 matrix stays at 125 cases with the same
 * ids. What these add is coverage of a sentence the specification already
 * made — "bounded and paginated … with the API paging" — which the first
 * implementation stated and did not hold. The Depot was returned whole inside
 * the inventory read, so `DEPOT_SPACES` bounded the STORE and nothing bounded
 * the RESPONSE.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { items, withTransaction } from '@global-idle/domain';
import { createClient, truncateAll } from '../support/db.js';
import {
  call,
  createCharacter,
  publishRookgaard,
  signIn,
  startApp,
  type App,
} from '../support/phase1.js';
import { CHEESE } from '../support/phase3.js';

const prisma = createClient();
const T0 = new Date('2026-03-08T09:00:00.000Z');

/** Stated here rather than imported: a test that reads the API's own types
 *  cannot notice the API changing them. */
interface ItemRow {
  readonly id: string;
  readonly definitionKey: string;
  readonly location: string;
}
interface DepotPage {
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly items: readonly ItemRow[];
}
interface InventoryBody {
  readonly depot: DepotPage;
}
interface ErrorBody {
  readonly error: { readonly code: string };
}

let directory: string;
let app: App | undefined;
let base: string;
let cookie: string;
let characterId: string;
let accountId: string;

/** More rows than one page holds, so "the whole thing" and "a page" differ. */
const ROWS = 60;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-p3api-'));
  await publishRookgaard(prisma, directory, T0);
  process.env['GLOBAL_IDLE_DEV_AUTH'] = '1';
  const started = await startApp({ CONTENT_BUNDLE_DIR: directory });
  app = started.app;
  base = started.base;

  cookie = await signIn(base, 'depot-reader');
  const character = await createCharacter(base, cookie, 'Warehouse');
  characterId = character.id;
  const row = await prisma.character.findUniqueOrThrow({
    where: { id: characterId },
    select: { accountId: true },
  });
  accountId = row.accountId;

  await withTransaction(prisma, async (tx) => {
    for (let n = 0; n < ROWS; n += 1) {
      await items.createItem(tx, {
        accountId,
        characterId: null,
        definitionKey: CHEESE,
        quantity: 1,
        location: 'DEPOT',
        at: new Date(T0.getTime() + n),
      });
    }
  });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('§10.1 — the Depot is paged by the API, not only bounded in the store', () => {
  it('the inventory read carries a PAGE and the whole count beside it', async () => {
    const response = await call<InventoryBody>(base, `/api/characters/${characterId}/inventory`, {
      cookie,
    });

    expect(response.status).toBe(200);
    expect(response.body.depot.total).toBe(ROWS);
    expect(response.body.depot.offset).toBe(0);
    // The response is bounded by the page, not by what the account owns.
    expect(response.body.depot.items.length).toBe(response.body.depot.limit);
    expect(response.body.depot.items.length).toBeLessThan(ROWS);
    for (const item of response.body.depot.items) expect(item.location).toBe('DEPOT');
  });

  it('an explicit window returns exactly that slice, and the database applies it', async () => {
    const stored = await prisma.itemInstance.findMany({
      where: { accountId, location: 'DEPOT' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    const response = await call<DepotPage>(
      base,
      `/api/characters/${characterId}/depot?offset=10&limit=5`,
      { cookie },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: ROWS, offset: 10, limit: 5 });
    expect(response.body.items.map((item) => item.id)).toEqual(
      stored.slice(10, 15).map((item) => item.id),
    );
  });

  it('paging past the end is empty rather than an error, and the total still says how many', async () => {
    const response = await call<DepotPage>(
      base,
      `/api/characters/${characterId}/depot?offset=${ROWS + 10}`,
      { cookie },
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(response.body.total).toBe(ROWS);
  });

  it('a nonsense window is REFUSED, not quietly clamped to page one', async () => {
    for (const query of ['?limit=abc', '?offset=-1', '?limit=0', '?limit=100000']) {
      const response = await call<ErrorBody>(base, `/api/characters/${characterId}/depot${query}`, {
        cookie,
      });
      expect(response.status, query).toBe(400);
      expect(response.body.error.code, query).toBe('INVALID_REQUEST');
    }
  });

  it('another account’s Depot is NOT FOUND, exactly as its Character is', async () => {
    const stranger = await signIn(base, 'not-the-owner');
    const response = await call<ErrorBody>(base, `/api/characters/${characterId}/depot`, {
      cookie: stranger,
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
