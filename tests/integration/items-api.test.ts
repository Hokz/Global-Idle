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
import { character, economy, items, withTransaction } from '@global-idle/domain';
import { accountId as toAccountId, operationId as toOperationId } from '@global-idle/shared';
import type { ResolvedBundle } from '@global-idle/game-data';
import { createClient, truncateAll } from '../support/db.js';
import { publishContent } from '../support/phase2.js';
import { call, createCharacter, signIn, startApp, type App } from '../support/phase1.js';
import { BACKPACK, CHEESE, POTION } from '../support/phase3.js';

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
let bundle: ResolvedBundle;

/** More rows than one page holds, so "the whole thing" and "a page" differ. */
const ROWS = 60;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-p3api-'));
  const published = await publishContent(prisma, directory, T0);
  bundle = await published.resolver.resolve(published.version as never);
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
});

/** Fill the account's Depot with more rows than one page holds. */
async function seedDepot(): Promise<void> {
  await withTransaction(prisma, async (tx) => {
    for (let n = 0; n < ROWS; n += 1) {
      await items.createItem(tx, {
        bundle,
        accountId,
        characterId: null,
        definitionKey: CHEESE,
        quantity: 1,
        location: 'DEPOT',
        at: new Date(T0.getTime() + n),
      });
    }
  });
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('§10.1 — the Depot is paged by the API, not only bounded in the store', () => {
  beforeEach(seedDepot);

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

// ───────────────────────────────────────────────────────────────────────────
// §20 IDM — every mutation is a client command, and runs once
// ───────────────────────────────────────────────────────────────────────────

interface GoldView {
  readonly gold: { readonly pouch: string; readonly bank: string };
  readonly slots: readonly {
    readonly slotIndex: number;
    readonly unlocked: boolean;
    readonly containerInstanceId: string | null;
    readonly routingCategory: string | null;
    readonly contents: readonly ItemRow[];
  }[];
  readonly stash: readonly { readonly definitionKey: string; readonly quantity: string }[];
  readonly lootPouch: { readonly contents: readonly ItemRow[] };
}

/** Post with an explicit Idempotency-Key, the way a client does. */
const send = <T>(path: string, key: string, body?: unknown, method: 'POST' | 'PUT' = 'POST') =>
  call<T>(base, `/api/characters/${characterId}${path}`, {
    method,
    cookie,
    headers: { 'Idempotency-Key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const read = async (): Promise<GoldView> =>
  (await call<GoldView>(base, `/api/characters/${characterId}/inventory`, { cookie })).body;

/** Put Gold where a purchase can reach it. */
async function fund(amount: bigint): Promise<void> {
  await withTransaction(prisma, (tx) =>
    economy.post(tx, {
      subject: economy.bankOf(toAccountId(accountId)),
      currency: 'GOLD',
      amount,
      reasonCode: 'test.seed',
      operationId: toOperationId(`fund:${characterId}:${amount}`),
      at: new Date(),
    }),
  );
}

describe('§20 IDM — idempotency, on the routes that change something', () => {
  it('IDM1: a mutation without an Idempotency-Key is REFUSED', async () => {
    const response = await call<ErrorBody>(base, `/api/characters/${characterId}/service/buy`, {
      method: 'POST',
      cookie,
      body: JSON.stringify({ definitionKey: POTION, quantity: 1 }),
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('IDM2: a duplicated purchase delivers once and charges once', async () => {
    await fund(1000n);
    const before = await read();
    const key = 'buy-once';
    const first = await send<GoldView>('/service/buy', key, {
      definitionKey: POTION,
      quantity: 1,
    });
    const second = await send<GoldView>('/service/buy', key, {
      definitionKey: POTION,
      quantity: 1,
    });

    expect(first.status).toBeLessThan(300);
    expect(second.status).toBeLessThan(300);
    const after = await read();
    const price = 20n;
    expect(BigInt(before.gold.bank) - BigInt(after.gold.bank)).toBe(price);

    const potions = (rows: GoldView) =>
      rows.slots
        .flatMap((slot) => slot.contents)
        .filter((row) => row.definitionKey === POTION)
        .reduce((total, row) => total + (row as { quantity: number }).quantity, 0);
    expect(potions(after) - potions(before)).toBe(1);
  });

  it('IDM3: a duplicated Gold deposit transfers once', async () => {
    await withTransaction(prisma, (tx) =>
      economy.post(tx, {
        subject: economy.pouchOf(toAccountId(accountId), characterId),
        currency: 'GOLD',
        amount: 50n,
        reasonCode: 'test.seed',
        operationId: toOperationId(`pouch:${characterId}`),
        at: new Date(),
      }),
    );
    const key = 'deposit-once';
    await send('/gold/deposit', key, { amount: '50' });
    await send('/gold/deposit', key, { amount: '50' });

    const after = await read();
    expect(after.gold.pouch).toBe('0');
    expect(after.gold.bank).toBe('50');
  });

  it('IDM4: a duplicated PARTIAL sell removes the quantity once and credits once', async () => {
    const cheese = await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        bundle,
        accountId,
        characterId,
        definitionKey: CHEESE,
        quantity: 4,
        location: 'LOOT_POUCH',
        at: new Date(),
      }),
    );
    const key = 'sell-once';
    await send('/service/sell', key, { instanceId: cheese.id, quantity: 2 });
    await send('/service/sell', key, { instanceId: cheese.id, quantity: 2 });

    const row = await prisma.itemInstance.findUniqueOrThrow({ where: { id: cheese.id } });
    expect(row.quantity).toBe(2);
    const after = await read();
    expect(after.gold.bank).toBe('4');
  });

  it('IDM5: the same key with a DIFFERENT command is a conflict, and changes nothing', async () => {
    await fund(1000n);
    const key = 'same-key';
    await send('/service/buy', key, { definitionKey: POTION, quantity: 1 });
    const conflict = await send<ErrorBody>('/service/buy', key, {
      definitionKey: POTION,
      quantity: 3,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

    const after = await read();
    expect(BigInt(after.gold.bank)).toBe(980n);
  });

  it('IDM6: a retry after a lost response returns the DURABLE result, not a new one', async () => {
    await fund(20_000n);
    const key = 'unlock-2';
    const first = await send<GoldView>(`/slots/2/unlock`, key);
    expect(first.status).toBeLessThan(300);
    // The client never saw the answer, so it asks again with the same key.
    const replay = await send<GoldView>(`/slots/2/unlock`, key);
    expect(replay.status).toBeLessThan(300);

    const slots = (await read()).slots;
    expect(slots.filter((slot) => slot.unlocked).map((slot) => slot.slotIndex)).toEqual([1, 2]);
    // Charged ONCE: one ledger entry, and the Bank is 10,000 lighter, not
    // 20,000.
    const entries = await prisma.ledgerEntry.count({
      where: { reasonCode: 'container-slot.unlock' },
    });
    expect(entries).toBe(1);
    expect((await read()).gold.bank).toBe('10000');
  });

  it('IDM7: EVERY mutating Phase 3 route requires a key — swept, not sampled', async () => {
    const routes: [string, 'POST' | 'PUT', unknown][] = [
      ['/items/move', 'POST', { instanceId: 'x', to: { kind: 'DEPOT' } }],
      ['/slots/2/unlock', 'POST', undefined],
      ['/slots/1/routing', 'PUT', { category: null }],
      ['/loot-policy', 'PUT', { mode: 'ACCEPTED_ONLY', rules: [] }],
      ['/service/buy', 'POST', { definitionKey: POTION, quantity: 1 }],
      ['/service/sell', 'POST', { instanceId: 'x' }],
      ['/stash/deposit', 'POST', { instanceId: 'x' }],
      ['/stash/withdraw', 'POST', { definitionKey: CHEESE, quantity: 1, containerId: 'x' }],
      ['/gold/deposit', 'POST', { amount: '1' }],
    ];
    for (const [path, method, payload] of routes) {
      const response = await call<ErrorBody>(base, `/api/characters/${characterId}${path}`, {
        method,
        cookie,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      expect(response.status, path).toBe(422);
      expect(response.body.error.code, path).toBe('IDEMPOTENCY_KEY_REQUIRED');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §20 CSL / RTE / STH — the rest of the surface the spec promised
// ───────────────────────────────────────────────────────────────────────────

describe('§20 CSL — slots 2 to 5 are usable, not only unlockable', () => {
  it('CSL9: the counter sells a real, source-backed container', async () => {
    const view = await call<{ service: { sells: { itemKey: string; price: number }[] } }>(
      base,
      `/api/characters/${characterId}/inventory`,
      { cookie },
    );
    expect(view.body.service.sells).toContainEqual({ itemKey: BACKPACK, price: 10 });
  });

  it('CSL10: unlock slot 2, buy a container, and it is INSTALLED there', async () => {
    await fund(20_000n);
    await send('/slots/2/unlock', 'unlock-slot-2');
    await send('/service/buy', 'buy-backpack', { definitionKey: BACKPACK, quantity: 1 });

    const slots = (await read()).slots;
    const two = slots.find((slot) => slot.slotIndex === 2)!;
    expect(two.unlocked).toBe(true);
    expect(two.containerInstanceId).not.toBeNull();

    // And it is a real active container: something can be routed into it.
    const row = await prisma.itemInstance.findUniqueOrThrow({
      where: { id: two.containerInstanceId! },
    });
    expect(row.location).toBe('HUNT_CONTAINER');
    expect(row.slotIndex).toBe(2);
    expect(row.characterId).toBe(characterId);
  });

  it('CSL11: a second Character does not inherit it, and a full set refuses the sale', async () => {
    await fund(20_000n);
    await send('/slots/2/unlock', 'unlock-2');
    await send('/service/buy', 'buy-1', { definitionKey: BACKPACK, quantity: 1 });

    // Every unlocked slot is now full, so the next one has nowhere to go and
    // the purchase fails atomically.
    const before = (await read()).gold.bank;
    const refused = await send<ErrorBody>('/service/buy', 'buy-2', {
      definitionKey: BACKPACK,
      quantity: 1,
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect((await read()).gold.bank).toBe(before);

    // A second Character on the same account has its own five slots, and
    // slot 2 is not one of them.
    await prisma.account.update({ where: { id: accountId }, data: { rosterCapacity: 5 } });
    // A VOCATION Character, because I1b allows exactly one Origin per account.
    const other = await withTransaction(prisma, (tx) =>
      character.createCharacter(tx, {
        accountId: toAccountId(accountId),
        vocation: 'KNIGHT',
        name: 'Second',
        baseLevel: 1,
        grant: { bundle, key: 'starting-grant.origin.rookgaard' },
        at: new Date(),
      }),
    );
    const otherView = await call<GoldView>(base, `/api/characters/${other}/inventory`, {
      cookie,
    });
    expect(
      otherView.body.slots.filter((slot) => slot.unlocked).map((slot) => slot.slotIndex),
    ).toEqual([1]);
  });
});

describe('§20 RTE / STH — routing and the Stash, through the API', () => {
  it('RTE6: a routing category set through the API changes where a purchase lands', async () => {
    await fund(20_000n);
    await send('/slots/2/unlock', 'r-unlock');
    await send('/service/buy', 'r-buy-bag', { definitionKey: BACKPACK, quantity: 1 });
    await send('/slots/2/routing', 'r-route', { category: 'POTION' }, 'PUT');

    const before = (await read()).slots;
    expect(before.find((slot) => slot.slotIndex === 2)!.routingCategory).toBe('POTION');
    // Slot 1 already holds the tutorial potions, so without the preference a
    // purchase would MERGE there and slot 2 would stay empty. That is what
    // makes this a test of routing rather than of luck.
    expect(before.find((slot) => slot.slotIndex === 2)!.contents).toEqual([]);

    await send('/service/buy', 'r-buy-potion', { definitionKey: POTION, quantity: 1 });
    const after = (await read()).slots;
    expect(
      after.find((slot) => slot.slotIndex === 2)!.contents.map((row) => row.definitionKey),
    ).toEqual([POTION]);
  });

  it('STH7: the Stash is reachable through the API — in, and back out', async () => {
    const cheese = await withTransaction(prisma, (tx) =>
      items.createItem(tx, {
        bundle,
        accountId,
        characterId,
        definitionKey: CHEESE,
        quantity: 5,
        location: 'LOOT_POUCH',
        at: new Date(),
      }),
    );
    await send('/stash/deposit', 'stash-in', { instanceId: cheese.id });
    const stashed = await read();
    expect(stashed.stash).toContainEqual({
      definitionKey: CHEESE,
      label: expect.any(String),
      quantity: '5',
    });
    expect(stashed.lootPouch.contents).toEqual([]);

    const container = stashed.slots.find((slot) => slot.containerInstanceId)!.containerInstanceId!;
    await send('/stash/withdraw', 'stash-out', {
      definitionKey: CHEESE,
      quantity: 3,
      containerId: container,
    });
    const after = await read();
    expect(after.stash).toContainEqual({
      definitionKey: CHEESE,
      label: expect.any(String),
      quantity: '2',
    });
    expect(
      after.slots
        .flatMap((slot) => slot.contents)
        .filter((row) => row.definitionKey === CHEESE)
        .reduce((total, row) => total + (row as { quantity: number }).quantity, 0),
    ).toBe(3);
  });

  it('STH8: a withdrawal that will not fit leaves the Stash exactly as it was', async () => {
    await prisma.stashEntry.create({
      data: { accountId, definitionKey: CHEESE, quantity: 100n, updatedAt: new Date() },
    });
    const view = await read();
    const container = view.slots.find((slot) => slot.containerInstanceId)!.containerInstanceId!;

    // 100 cheeses at a maxStack of 255 is ONE stack, so make the container
    // full instead: nothing can arrive at all.
    const spaces = items.itemDefinition(bundle, BACKPACK).containerSpaces!;
    const used = await prisma.itemInstance.count({ where: { containerId: container } });
    await withTransaction(prisma, async (tx) => {
      for (let n = used; n < spaces; n += 1) {
        await items.createItem(tx, {
          bundle,
          accountId,
          characterId,
          definitionKey: CHEESE,
          quantity: 1,
          location: 'CHARACTER_CONTAINER',
          containerId: container,
          affixes: [{ affix: 'ARMOR_PLUS', value: n + 1 }],
          at: new Date(),
        });
      }
    });

    const refused = await send<ErrorBody>('/stash/withdraw', 'stash-nofit', {
      definitionKey: CHEESE,
      quantity: 10,
      containerId: container,
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const entry = await prisma.stashEntry.findUniqueOrThrow({
      where: { accountId_definitionKey: { accountId, definitionKey: CHEESE } },
    });
    expect(entry.quantity).toBe(100n);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §20 RET / VAL — retirement, and the edge where input stops being arbitrary
// ───────────────────────────────────────────────────────────────────────────

describe('§20 RET — a retired Character is not a live one', () => {
  it('RET1: the inventory surface stops treating a retired Character as playable', async () => {
    const before = await call(base, `/api/characters/${characterId}/inventory`, { cookie });
    expect(before.status).toBe(200);

    await prisma.character.update({
      where: { id: characterId },
      data: { retiredAt: new Date() },
    });

    const after = await call<ErrorBody>(base, `/api/characters/${characterId}/inventory`, {
      cookie,
    });
    expect(after.status).toBe(404);
    expect(after.body.error.code).toBe('NOT_FOUND');
  });

  it('RET2: every player-facing surface agrees — not one filtered and one not', async () => {
    await prisma.character.update({
      where: { id: characterId },
      data: { retiredAt: new Date() },
    });

    // The world and game paths already filtered `retiredAt`; the inventory one
    // did not, and an inconsistency between them was the whole finding.
    for (const path of [
      `/api/characters/${characterId}/inventory`,
      `/api/characters/${characterId}/depot`,
      `/api/characters/${characterId}`,
    ]) {
      const response = await call<ErrorBody>(base, path, { cookie });
      expect(response.status, path).toBe(404);
    }

    // And a mutation is refused for the same reason, before any validation.
    const refused = await send<ErrorBody>('/gold/deposit', 'ret2', { amount: '1' });
    expect(refused.status).toBe(404);
  });
});

describe('§20 VAL — malformed input is a client error, not a server error', () => {
  it('VAL1: a non-numeric Gold amount is REFUSED, not a 500', async () => {
    // `BigInt("abc")` throws. An uncaught throw at the edge is a 500 for a
    // request the client got wrong.
    for (const amount of ['abc', '', '1.5', '-5', '0', null]) {
      const response = await send<ErrorBody>('/gold/deposit', `val1-${amount}`, { amount });
      expect(response.status, String(amount)).toBe(422);
      expect(response.body.error.code, String(amount)).toBe('INVALID_REQUEST');
    }
  });

  it('VAL2: NaN quantities and slot indexes never reach the database', async () => {
    const nonsense = await send<ErrorBody>('/service/buy', 'val2-a', {
      definitionKey: POTION,
      quantity: 'lots',
    });
    expect(nonsense.status).toBe(422);

    const slot = await call<ErrorBody>(
      base,
      `/api/characters/${characterId}/slots/not-a-number/unlock`,
      { method: 'POST', cookie, headers: { 'Idempotency-Key': 'val2-b' } },
    );
    expect(slot.status).toBe(422);

    const sixth = await send<ErrorBody>('/slots/6/unlock', 'val2-c');
    expect(sixth.status).toBe(422);
  });

  it('VAL3: an unknown routing category is refused rather than silently stored', async () => {
    const refused = await send<ErrorBody>(
      '/slots/1/routing',
      'val3',
      { category: 'NOT_A_CATEGORY' },
      'PUT',
    );
    expect(refused.status).toBe(422);
    expect((await read()).slots[0]!.routingCategory).toBeNull();
  });

  it('VAL4: loot rules are bounded in SHAPE and in COUNT', async () => {
    const shapes: unknown[] = [
      'not-an-array',
      [{ accept: 'yes' }],
      [{ accept: true, rarity: 'EPIC' }],
      [{ accept: true, itemKey: 'x'.repeat(400) }],
      Array.from({ length: 65 }, () => ({ accept: true })),
    ];
    for (const [index, rules] of shapes.entries()) {
      const response = await send<ErrorBody>(
        '/loot-policy',
        `val4-${index}`,
        { mode: 'ACCEPTED_ONLY', rules },
        'PUT',
      );
      expect(response.status, JSON.stringify(rules).slice(0, 40)).toBe(422);
    }

    // A well-formed rule still goes through.
    const ok = await send(
      '/loot-policy',
      'val4-ok',
      { mode: 'ACCEPTED_ONLY', rules: [{ accept: true, itemKey: CHEESE }] },
      'PUT',
    );
    expect(ok.status).toBeLessThan(300);
  });

  it('VAL5: an over-long Idempotency-Key is refused — it becomes half a primary key', async () => {
    const response = await call<ErrorBody>(base, `/api/characters/${characterId}/gold/deposit`, {
      method: 'POST',
      cookie,
      headers: { 'Idempotency-Key': 'k'.repeat(300) },
      body: JSON.stringify({ amount: '1' }),
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });
});
