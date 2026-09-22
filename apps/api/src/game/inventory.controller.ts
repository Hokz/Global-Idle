/**
 * Physical items — the System UI's server (Phase 3 spec §17).
 *
 * Every route validates on the SERVER: ownership, source custody, destination
 * acceptance, the access context, stack limits, space, Capacity, slot legality
 * and `stashEligible`. The UI is a way to ASK; it is never a reason to believe.
 *
 * There is no route that puts something INTO the Loot Pouch, because there is
 * no such destination in the domain type. That is the prohibition, expressed
 * once, where it cannot be forgotten.
 */
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createIdempotencyPort,
  economy,
  fingerprintOf,
  items as itemsContext,
  withTransaction,
  type PrismaClient,
  type UnitOfWork,
} from '@global-idle/domain';
import {
  accountId as toAccountId,
  operationId as toOperationId,
  LOOT_POUCH_SPACES,
} from '@global-idle/shared';
import type { ContentBundleResolver, ResolvedBundle } from '@global-idle/game-data';
import { CONTENT_RESOLVER, PRISMA } from './tokens.js';
import { SessionGuard, type RequestWithSession } from './session.guard.js';
import { asHttp, fail } from './errors.js';

const SERVICE_KEY = 'service.rookgaard.counter';

/**
 * The Depot is bounded (spec §10.1) AND paged. Bounded is not the same
 * promise: a 200-row account blob is still a 200-row response, and the phase
 * that raises `DEPOT_SPACES` should not also have to discover that every
 * client was reading the whole thing in one breath.
 *
 * The inventory read carries the FIRST page so the System UI has something to
 * draw; everything past it comes from the dedicated route.
 */
const DEPOT_PAGE_DEFAULT = 50;
const DEPOT_PAGE_MAX = 200;

/**
 * The System UI's whole world, in one shape.
 *
 * Written out rather than inferred, because inferring it drags Prisma's
 * generated enum types into the public signature of every route — which is
 * both unportable and a boundary leak: the wire format is the API's to state,
 * not the ORM's to imply.
 */
export interface ItemView {
  readonly id: string;
  readonly definitionKey: string;
  readonly label: string;
  readonly category: string;
  readonly quantity: number;
  readonly rarity: string;
  readonly affixes: unknown;
  readonly weight: number;
  readonly stackable: boolean;
  readonly maxStack: number;
  readonly slot: string | null;
  readonly containerId: string | null;
  readonly location: string;
  readonly sellable: boolean;
  readonly stashEligible: boolean;
}

/** One window onto the Depot, with the whole beside it so a client can page. */
export interface DepotPage {
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly items: readonly ItemView[];
}

export interface InventoryView {
  readonly characterId: string;
  readonly inHunt: boolean;
  readonly capacity: { readonly carried: number; readonly limit: number };
  readonly gold: { readonly pouch: string; readonly bank: string };
  readonly equipment: readonly ItemView[];
  readonly slots: readonly {
    readonly slotIndex: number;
    readonly unlocked: boolean;
    readonly containerInstanceId: string | null;
    readonly routingCategory: string | null;
    readonly price: number;
    readonly spaces: number;
    readonly contents: readonly ItemView[];
  }[];
  readonly lootPouch: { readonly spaces: number; readonly contents: readonly ItemView[] };
  readonly depot: DepotPage;
  readonly stash: readonly {
    readonly definitionKey: string;
    readonly label: string;
    readonly quantity: string;
  }[];
  readonly lootPolicy: { readonly mode: string; readonly rules: readonly unknown[] };
  /** Every category a slot may be set to prefer. The server's list, so the UI
   *  offers exactly what routing can actually match. */
  readonly routingCategories: readonly string[];
  readonly service: {
    readonly key: string;
    readonly sells: readonly { readonly itemKey: string; readonly price: number }[];
    readonly buys: readonly { readonly itemKey: string; readonly price: number }[];
  };
}

/** The fields a view needs, stated structurally so the ORM's generated row
 *  type never becomes part of this module's shape. */
interface ItemRow {
  readonly id: string;
  readonly definitionKey: string;
  readonly quantity: number;
  readonly rarity: string;
  readonly affixes: unknown;
  readonly slot: string | null;
  readonly containerId: string | null;
  readonly location: string;
}

function viewOf(bundle: ResolvedBundle, row: ItemRow): ItemView {
  const definition = itemsContext.itemDefinition(bundle, row.definitionKey);
  return {
    id: row.id,
    definitionKey: row.definitionKey,
    label: definition.label,
    category: definition.category,
    quantity: row.quantity,
    rarity: row.rarity,
    affixes: row.affixes,
    weight: definition.weight * (definition.stackable ? row.quantity : 1),
    stackable: definition.stackable,
    maxStack: definition.maxStack,
    slot: row.slot,
    containerId: row.containerId,
    location: row.location,
    sellable: definition.sellable,
    stashEligible: definition.stashEligible,
  };
}

/**
 * A page, or a refusal. A nonsense window is NOT silently clamped to a
 * sensible one: a client that asked for `limit=abc` is wrong about something,
 * and answering it with page one hides that.
 */
function pageOf(offset?: string, limit?: string): { offset: number; limit: number } {
  const read = (raw: string | undefined, fallback: number, max: number, name: string) => {
    if (raw === undefined || raw === '') return fallback;
    if (!/^\d+$/.test(raw)) {
      throw fail(HttpStatus.BAD_REQUEST, 'INVALID_REQUEST', `${name} must be a whole number.`);
    }
    const value = Number(raw);
    if (value > max) {
      throw fail(HttpStatus.BAD_REQUEST, 'INVALID_REQUEST', `${name} may not exceed ${max}.`);
    }
    return value;
  };
  const window = {
    offset: read(offset, 0, Number.MAX_SAFE_INTEGER, 'offset'),
    limit: read(limit, DEPOT_PAGE_DEFAULT, DEPOT_PAGE_MAX, 'limit'),
  };
  if (window.limit < 1) {
    throw fail(HttpStatus.BAD_REQUEST, 'INVALID_REQUEST', 'limit must be at least 1.');
  }
  return window;
}

interface MoveBody {
  readonly instanceId?: string;
  readonly quantity?: number;
  readonly to?: {
    readonly kind?: string;
    readonly slot?: string;
    readonly containerId?: string;
    readonly slotIndex?: number;
  };
}

@Controller('api')
@UseGuards(SessionGuard)
export class InventoryController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONTENT_RESOLVER) private readonly resolver: ContentBundleResolver,
  ) {}

  private session(request: RequestWithSession) {
    const session = request.session;
    if (!session) throw fail(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in first.');
    return session;
  }

  /** The Character, confirmed to belong to this account. A Character someone
   *  else owns is NOT FOUND, never FORBIDDEN. */
  private async owned(request: RequestWithSession, characterId: string) {
    const { accountId } = this.session(request);
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, accountId },
      select: { id: true, accountId: true, baseLevel: true, baseXp: true },
    });
    if (!character) throw fail(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No such character.');
    return character;
  }

  private current(): Promise<ResolvedBundle> {
    return this.resolver.current();
  }

  /** Everything the System UI draws, in one read. */
  @Get('characters/:characterId/inventory')
  async inventory(
    @Req() request: RequestWithSession,
    @Param('characterId') characterId: string,
  ): Promise<InventoryView> {
    const character = await this.owned(request, characterId);
    const bundle = await this.current();

    const [rows, slots, stash, policy, inHunt] = await Promise.all([
      this.prisma.itemInstance.findMany({
        where: { accountId: character.accountId },
        orderBy: { id: 'asc' },
      }),
      withTransaction(this.prisma, (tx) => itemsContext.readSlots(tx, characterId)),
      withTransaction(this.prisma, (tx) => itemsContext.readStash(tx, character.accountId)),
      withTransaction(this.prisma, (tx) => itemsContext.readPolicy(tx, characterId)),
      withTransaction(this.prisma, (tx) => itemsContext.inActiveHunt(tx, characterId)),
    ]);

    const [pouchGold, bankGold, weight] = await Promise.all([
      withTransaction(this.prisma, (tx) =>
        economy.readBalance(
          tx,
          economy.pouchOf(toAccountId(character.accountId), characterId),
          'GOLD',
        ),
      ),
      withTransaction(this.prisma, (tx) =>
        economy.readBalance(tx, economy.bankOf(toAccountId(character.accountId)), 'GOLD'),
      ),
      withTransaction(this.prisma, (tx) => itemsContext.carriedWeight(tx, bundle, characterId)),
    ]);

    const view = (row: ItemRow) => viewOf(bundle, row);

    const mine = rows.filter((row) => row.characterId === characterId || row.location === 'DEPOT');
    return {
      characterId,
      inHunt,
      capacity: {
        carried: weight,
        limit: itemsContext.capacityFor(character.baseLevel),
      },
      gold: { pouch: pouchGold.toString(), bank: bankGold.toString() },
      equipment: mine.filter((row) => row.location === 'EQUIPPED').map(view),
      slots: slots.map((slot) => ({
        ...slot,
        price:
          itemsContext
            .containerSlotPrices(bundle)
            .prices.find((entry) => entry.slot === slot.slotIndex)?.gold ?? 0,
        contents: mine.filter((row) => row.containerId === slot.containerInstanceId).map(view),
        spaces: slot.containerInstanceId
          ? (itemsContext.itemDefinition(
              bundle,
              rows.find((row) => row.id === slot.containerInstanceId)!.definitionKey,
            ).containerSpaces ?? 0)
          : 0,
      })),
      lootPouch: {
        spaces: LOOT_POUCH_SPACES,
        contents: mine.filter((row) => row.location === 'LOOT_POUCH').map(view),
      },
      depot: (() => {
        const all = mine.filter((row) => row.location === 'DEPOT');
        return {
          total: all.length,
          offset: 0,
          limit: DEPOT_PAGE_DEFAULT,
          items: all.slice(0, DEPOT_PAGE_DEFAULT).map(view),
        };
      })(),
      stash: stash.map((entry) => ({
        definitionKey: entry.definitionKey,
        label: itemsContext.itemDefinition(bundle, entry.definitionKey).label,
        quantity: entry.quantity.toString(),
      })),
      lootPolicy: policy,
      routingCategories: [
        ...new Set(itemsContext.allItems(bundle).map((definition) => definition.category)),
      ].sort(),
      service: {
        key: SERVICE_KEY,
        sells: itemsContext.serviceDefinition(bundle, SERVICE_KEY).sells,
        buys: itemsContext.serviceDefinition(bundle, SERVICE_KEY).buys,
      },
    };
  }

  /**
   * The Depot, a window at a time (spec §10.1).
   *
   * The window is applied by the DATABASE, not by slicing a full read, so the
   * response size is bounded by what was asked for rather than by what the
   * account happens to own. `total` is the whole, so a client can page without
   * guessing where the end is.
   */
  @Get('characters/:characterId/depot')
  async depot(
    @Req() request: RequestWithSession,
    @Param('characterId') characterId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ): Promise<DepotPage> {
    const character = await this.owned(request, characterId);
    const bundle = await this.current();
    const window = pageOf(offset, limit);
    const where = { accountId: character.accountId, location: 'DEPOT' as const };
    const [total, rows] = await Promise.all([
      this.prisma.itemInstance.count({ where }),
      this.prisma.itemInstance.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: window.offset,
        take: window.limit,
      }),
    ]);
    return {
      total,
      offset: window.offset,
      limit: window.limit,
      items: rows.map((row) => viewOf(bundle, row)),
    };
  }

  // ── every mutation below is a CLIENT COMMAND, and carries a key ─────────

  /**
   * Run a mutating command exactly once, however many times it is sent.
   *
   * The fingerprint is the CLIENT's command and nothing else — no timestamp,
   * no resolved content version, nothing the server chose. A retry after a
   * lost response therefore replays the original result instead of buying a
   * second backpack; the same key with a different command is an explicit
   * conflict rather than a silent overwrite (ADR-017, spec §17).
   *
   * The operation id every ledger post uses is DERIVED from the same key, so
   * the settlement-level guard agrees with the command-level one rather than
   * inventing a second opinion.
   */
  private async idempotent(
    request: RequestWithSession,
    namespace: string,
    command: Record<string, unknown>,
    body: (tx: UnitOfWork, operationId: ReturnType<typeof toOperationId>) => Promise<unknown>,
  ): Promise<void> {
    const session = this.session(request);
    const raw = request.headers['idempotency-key'];
    const clientKey = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
    if (!clientKey) {
      throw fail(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'IDEMPOTENCY_KEY_REQUIRED',
        'This request must carry an Idempotency-Key header.',
      );
    }
    const operationId = toOperationId(`${namespace}:${session.accountId}:${clientKey}`);
    const port = createIdempotencyPort((run) => withTransaction(this.prisma, run));
    let outcome;
    try {
      outcome = await port.execute(
        {
          principalId: toAccountId(session.accountId),
          commandNamespace: namespace,
          clientKey,
        },
        fingerprintOf(command),
        new Date(),
        // The RESULT of every one of these routes is the inventory read that
        // follows, so nothing domain-shaped is stored in the record. That is
        // not laziness: the domain returns BigInt Gold, which has no JSON
        // form, and a record that cannot be written would turn a successful
        // command into a 500 after it had already happened.
        async (tx) => {
          await body(tx, operationId);
          return null;
        },
      );
    } catch (error) {
      throw asHttp(error);
    }
    if (outcome.outcome === 'conflict') {
      throw fail(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_CONFLICT',
        'That Idempotency-Key was used for a different command.',
      );
    }
  }

  @Post('characters/:characterId/items/move')
  async move(
    @Req() request: RequestWithSession,
    @Param('characterId') characterId: string,
    @Body() body: MoveBody,
  ): Promise<InventoryView> {
    const character = await this.owned(request, characterId);
    const bundle = await this.current();
    const to = body.to ?? {};
    const destination =
      to.kind === 'EQUIPPED'
        ? { kind: 'EQUIPPED' as const, slot: to.slot as never }
        : to.kind === 'HUNT_CONTAINER'
          ? { kind: 'HUNT_CONTAINER' as const, slotIndex: Number(to.slotIndex) }
          : to.kind === 'CONTAINER'
            ? { kind: 'CONTAINER' as const, containerId: String(to.containerId) }
            : to.kind === 'DEPOT'
              ? { kind: 'DEPOT' as const }
              : null;
    if (!destination || !body.instanceId) {
      throw fail(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'INVALID_REQUEST',
        'Name an item and a destination.',
      );
    }

    // The Hunt access rule is NOT checked here. It lives inside `moveItem`,
    // where a job or a future caller cannot forget it.
    await this.idempotent(
      request,
      'items.move',
      { characterId, instanceId: body.instanceId, quantity: body.quantity ?? null, to },
      (tx) =>
        itemsContext.moveItem(tx, {
          bundle,
          accountId: character.accountId,
          characterId,
          baseLevel: character.baseLevel,
          instanceId: body.instanceId!,
          ...(body.quantity === undefined ? {} : { quantity: body.quantity }),
          to: destination,
          at: new Date(),
        }),
    );
    return this.inventory(request, characterId);
  }

  @Post('characters/:characterId/slots/:slotIndex/unlock')
  async unlock(
    @Req() request: RequestWithSession,
    @Param('characterId') characterId: string,
    @Param('slotIndex') slotIndex: string,
  ): Promise<InventoryView> {
    const character = await this.owned(request, characterId);
    const bundle = await this.current();
    await this.idempotent(
      request,
      'slots.unlock',
      { characterId, slotIndex: Number(slotIndex) },
      (tx, operationId) =>
        itemsContext.unlockSlot(tx, {
          bundle,
          accountId: character.accountId,
          characterId,
          slotIndex: Number(slotIndex),
          operationId,
          at: new Date(),
        }),
    );
    return this.inventory(request, characterId);
  }

  /** Where purchases, refills and withdrawals prefer to land. */
  @Put('characters/:characterId/slots/:slotIndex/routing')
  async routing(
    @Req() request: RequestWithSession,
    @Param('characterId') characterId: string,
    @Param('slotIndex') slotIndex: string,
    @Body() body: { category?: string | null },
  ): Promise<InventoryView> {
    await this.owned(request, characterId);
    const category = typeof body.category === 'string' && body.category ? body.category : null;
    await this.idempotent(
      request,
      'slots.routing',
      { characterId, slotIndex: Number(slotIndex), category },
      (tx) => itemsContext.setRouting(tx, { characterId, slotIndex: Number(slotIndex), category }),
    );
    return this.inventory(request, characterId);
  }

  @Put('characters/:characterId/loot-policy')
  async policy(
    @Req() request: RequestWithSession,
    @Param('characterId') characterId: string,
    @Body() body: { mode?: string; rules?: unknown[] },
  ): Promise<InventoryView> {
    await this.owned(request, characterId);
    const mode = body.mode === 'ACCEPTED_ONLY' ? 'ACCEPTED_ONLY' : 'COLLECT_ALL_EXCEPT_SKIPPED';
    const rules = (body.rules ?? []) as never;
    await this.idempotent(request, 'loot-policy.write', { characterId, mode, rules }, (tx) =>
      itemsContext.writePolicy(tx, characterId, { mode, rules }, new Date()),
    );
    return this.inventory(request, characterId);
  }

  @Post('characters/:characterId/service/buy')
  async buy(
    @Req() request: RequestWithSession,
    @Param('characterId') characterId: string,
    @Body() body: { definitionKey?: string; quantity?: number },
  ): Promise<InventoryView> {
    const character = await this.owned(request, characterId);
    const bundle = await this.current();
    const definitionKey = String(body.definitionKey);
    const quantity = Number(body.quantity ?? 1);
    await this.idempotent(
      request,
      'service.buy',
      { characterId, definitionKey, quantity },
      (tx, operationId) =>
        itemsContext.buy(tx, {
          bundle,
          serviceKey: SERVICE_KEY,
          accountId: character.accountId,
          characterId,
          baseLevel: character.baseLevel,
          definitionKey,
          quantity,
          operationId,
          at: new Date(),
        }),
    );
    return this.inventory(request, characterId);
  }

  @Post('characters/:characterId/service/sell')
  async sell(
    @Req() request: RequestWithSession,
    @Param('characterId') characterId: string,
    @Body() body: { instanceId?: string; quantity?: number },
  ): Promise<InventoryView> {
    const character = await this.owned(request, characterId);
    const bundle = await this.current();
    const instanceId = String(body.instanceId);
    await this.idempotent(
      request,
      'service.sell',
      { characterId, instanceId, quantity: body.quantity ?? null },
      (tx, operationId) =>
        itemsContext.sell(tx, {
          bundle,
          serviceKey: SERVICE_KEY,
          accountId: character.accountId,
          characterId,
          instanceId,
          ...(body.quantity === undefined ? {} : { quantity: body.quantity }),
          operationId,
          at: new Date(),
        }),
    );
    return this.inventory(request, characterId);
  }

  @Post('characters/:characterId/stash/deposit')
  async stashDeposit(
    @Req() request: RequestWithSession,
    @Param('characterId') characterId: string,
    @Body() body: { instanceId?: string; quantity?: number },
  ): Promise<InventoryView> {
    const character = await this.owned(request, characterId);
    const bundle = await this.current();
    const instanceId = String(body.instanceId);
    await this.idempotent(
      request,
      'stash.deposit',
      { characterId, instanceId, quantity: body.quantity ?? null },
      (tx) =>
        itemsContext.stow(tx, {
          bundle,
          accountId: character.accountId,
          characterId,
          instanceId,
          ...(body.quantity === undefined ? {} : { quantity: body.quantity }),
          at: new Date(),
        }),
    );
    return this.inventory(request, characterId);
  }

  @Post('characters/:characterId/stash/withdraw')
  async stashWithdraw(
    @Req() request: RequestWithSession,
    @Param('characterId') characterId: string,
    @Body() body: { definitionKey?: string; quantity?: number; containerId?: string },
  ): Promise<InventoryView> {
    const character = await this.owned(request, characterId);
    const bundle = await this.current();
    const definitionKey = String(body.definitionKey);
    const quantity = Number(body.quantity ?? 0);
    const containerId = String(body.containerId);
    await this.idempotent(
      request,
      'stash.withdraw',
      { characterId, definitionKey, quantity, containerId },
      (tx) =>
        itemsContext.withdraw(tx, {
          bundle,
          accountId: character.accountId,
          characterId,
          baseLevel: character.baseLevel,
          definitionKey,
          quantity,
          containerId,
          at: new Date(),
        }),
    );
    return this.inventory(request, characterId);
  }

  @Post('characters/:characterId/gold/deposit')
  async deposit(
    @Req() request: RequestWithSession,
    @Param('characterId') characterId: string,
    @Body() body: { amount?: string | number },
  ): Promise<InventoryView> {
    const character = await this.owned(request, characterId);
    const amount = BigInt(body.amount ?? 0);
    if (amount <= 0n)
      throw fail(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_REQUEST', 'Deposit a positive amount.');
    await this.idempotent(
      request,
      'gold.deposit',
      { characterId, amount: amount.toString() },
      async (tx, operationId) => {
        await itemsContext.assertSafeContext(tx, characterId, 'bank');
        await economy.transfer(tx, {
          from: economy.pouchOf(toAccountId(character.accountId), characterId),
          to: economy.bankOf(toAccountId(character.accountId)),
          currency: 'GOLD',
          amount,
          reasonCode: 'gold.deposit',
          operationId,
          at: new Date(),
        });
      },
    );
    return this.inventory(request, characterId);
  }
}
