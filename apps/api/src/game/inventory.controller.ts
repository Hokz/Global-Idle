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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  economy,
  items as itemsContext,
  withTransaction,
  type PrismaClient,
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
  readonly depot: readonly ItemView[];
  readonly stash: readonly {
    readonly definitionKey: string;
    readonly label: string;
    readonly quantity: string;
  }[];
  readonly lootPolicy: { readonly mode: string; readonly rules: readonly unknown[] };
  readonly service: {
    readonly key: string;
    readonly sells: readonly { readonly itemKey: string; readonly price: number }[];
    readonly buys: readonly { readonly itemKey: string; readonly price: number }[];
  };
}

interface MoveBody {
  readonly instanceId?: string;
  readonly quantity?: number;
  readonly to?: { readonly kind?: string; readonly slot?: string; readonly containerId?: string };
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

    const view = (row: (typeof rows)[number]) => {
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
    };

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
      depot: mine.filter((row) => row.location === 'DEPOT').map(view),
      stash: stash.map((entry) => ({
        definitionKey: entry.definitionKey,
        label: itemsContext.itemDefinition(bundle, entry.definitionKey).label,
        quantity: entry.quantity.toString(),
      })),
      lootPolicy: policy,
      service: {
        key: SERVICE_KEY,
        sells: itemsContext.serviceDefinition(bundle, SERVICE_KEY).sells,
        buys: itemsContext.serviceDefinition(bundle, SERVICE_KEY).buys,
      },
    };
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
    if (destination.kind === 'DEPOT') {
      await withTransaction(this.prisma, (tx) =>
        itemsContext.assertSafeContext(tx, characterId, 'depot'),
      ).catch((error) => {
        throw asHttp(error);
      });
    }

    try {
      await withTransaction(this.prisma, (tx) =>
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
    } catch (error) {
      throw asHttp(error);
    }
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
    try {
      await withTransaction(this.prisma, (tx) =>
        itemsContext.unlockSlot(tx, {
          bundle,
          accountId: character.accountId,
          characterId,
          slotIndex: Number(slotIndex),
          operationId: toOperationId(`slot:${characterId}:${slotIndex}`),
          at: new Date(),
        }),
      );
    } catch (error) {
      throw asHttp(error);
    }
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
    await withTransaction(this.prisma, (tx) =>
      itemsContext.writePolicy(
        tx,
        characterId,
        { mode, rules: (body.rules ?? []) as never },
        new Date(),
      ),
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
    try {
      await withTransaction(this.prisma, (tx) =>
        itemsContext.buy(tx, {
          bundle,
          serviceKey: SERVICE_KEY,
          accountId: character.accountId,
          characterId,
          baseLevel: character.baseLevel,
          definitionKey: String(body.definitionKey),
          quantity: Number(body.quantity ?? 1),
          operationId: toOperationId(`buy:${characterId}:${Date.now()}`),
          at: new Date(),
        }),
      );
    } catch (error) {
      throw asHttp(error);
    }
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
    try {
      await withTransaction(this.prisma, (tx) =>
        itemsContext.sell(tx, {
          bundle,
          serviceKey: SERVICE_KEY,
          accountId: character.accountId,
          characterId,
          instanceId: String(body.instanceId),
          ...(body.quantity === undefined ? {} : { quantity: body.quantity }),
          operationId: toOperationId(`sell:${characterId}:${Date.now()}`),
          at: new Date(),
        }),
      );
    } catch (error) {
      throw asHttp(error);
    }
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
    try {
      await withTransaction(this.prisma, async (tx) => {
        await itemsContext.assertSafeContext(tx, characterId, 'bank');
        await economy.transfer(tx, {
          from: economy.pouchOf(toAccountId(character.accountId), characterId),
          to: economy.bankOf(toAccountId(character.accountId)),
          currency: 'GOLD',
          amount,
          reasonCode: 'gold.deposit',
          operationId: toOperationId(`deposit:${characterId}:${Date.now()}`),
          at: new Date(),
        });
      });
    } catch (error) {
      throw asHttp(error);
    }
    return this.inventory(request, characterId);
  }
}
