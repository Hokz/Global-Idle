/**
 * The Phase 1 API surface (spec §12).
 *
 * THIN ON PURPOSE. Controllers resolve a session, validate shape, call the
 * domain, and map an error to a status. No rule about characters, occupancy,
 * Stamina or content lives here — those belong to the contexts that own them,
 * and a formula in a controller is a formula nothing else can reuse or test.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  SESSION_COOKIE,
  character as characterContext,
  identity,
  mintSessionId,
  recordDomainEvent,
  sealSession,
  withTransaction,
  type PrismaClient,
} from '@global-idle/domain';
import { accountId as toAccountId, newId } from '@global-idle/shared';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { CONTENT_RESOLVER, PRISMA, SESSION_SECRET } from './tokens.js';
import { SessionGuard, type RequestWithSession } from './session.guard.js';
import { asHttp, fail, notFound } from './errors.js';
import {
  currentActivity,
  staminaView,
  type CharacterDetail,
  type CharacterSummary,
} from './views.js';
import { HttpStatus } from '@nestjs/common';

interface Reply {
  setHeader(name: string, value: string): void;
}

/** 2-20 characters, letters and single inner spaces. Deliberately strict:
 *  loosening a name rule later is easy, tightening one is a migration. */
const NAME = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const nameIsValid = (name: string) => name.length >= 2 && name.length <= 20 && NAME.test(name);

@Controller('api')
export class GameController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONTENT_RESOLVER) private readonly resolver: ContentBundleResolver,
    @Inject(SESSION_SECRET) private readonly secret: string,
  ) {}

  private session(request: RequestWithSession) {
    const session = request.session;
    if (!session) throw fail(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in first.');
    return session;
  }

  // ── session ────────────────────────────────────────────────────────────
  // Registered only when the dev provider is enabled; see GameModule.

  @Post('session')
  async signIn(@Body() body: { handle?: unknown }, @Res({ passthrough: true }) reply: Reply) {
    const handle = typeof body?.handle === 'string' ? body.handle.trim() : '';
    if (!nameIsValid(handle)) {
      throw fail(HttpStatus.UNPROCESSABLE_ENTITY, 'NAME_INVALID', 'Enter a handle.');
    }

    const accountId = await withTransaction(this.prisma, async (tx) => {
      const existing = await tx.authIdentity.findUnique({
        where: { provider_subject: { provider: 'dev', subject: handle } },
        select: { accountId: true },
      });
      if (existing) return existing.accountId;

      const now = new Date();
      const account = newId<'AccountId'>(now);
      await tx.account.create({ data: { id: account, rosterCapacity: 1, createdAt: now } });
      await tx.authIdentity.create({
        data: {
          id: newId<'EntitlementId'>(now),
          accountId: account,
          provider: 'dev',
          subject: handle,
          createdAt: now,
        },
      });
      return account;
    });

    // A NEW sessionId per sign-in. Reload reuses the cookie and keeps the
    // same one; a second browser gets a different one, which is what makes
    // ADR-008 eviction meaningful (§3.2.1).
    const sealed = sealSession(this.secret, {
      accountId: toAccountId(accountId),
      sessionId: mintSessionId(new Date()),
    });
    reply.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(sealed)}; Path=/; HttpOnly; SameSite=Lax`,
    );
    return { accountId };
  }

  @Delete('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  signOut(@Res({ passthrough: true }) reply: Reply) {
    reply.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  // ── account ────────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@Req() request: RequestWithSession) {
    const { accountId } = this.session(request);
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { rosterCapacity: true },
    });
    if (!account) throw notFound();
    return {
      accountId,
      rosterCapacity: account.rosterCapacity,
      premium: await this.isPremium(accountId),
    };
  }

  /** Premium is an ACCOUNT-WIDE entitlement (ADR-005), read through the
   *  context that owns it. Phase 1 displays it and sells nothing. */
  private async isPremium(accountId: string): Promise<boolean> {
    const active = await withTransaction(this.prisma, (tx) =>
      identity.entitlementPort.activeAt(tx, toAccountId(accountId), new Date()),
    );
    return active.some((entitlement) => entitlement.kind === 'PREMIUM');
  }

  // ── characters ─────────────────────────────────────────────────────────

  @Get('characters')
  @UseGuards(SessionGuard)
  async list(@Req() request: RequestWithSession): Promise<{ characters: CharacterSummary[] }> {
    const { accountId } = this.session(request);
    const rows = await this.prisma.character.findMany({
      where: { accountId, retiredAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, baseLevel: true, vocation: true },
    });
    return {
      characters: await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          name: row.name,
          baseLevel: row.baseLevel,
          vocation: row.vocation,
          stamina: await staminaView(this.prisma, row.id),
        })),
      ),
    };
  }

  @Post('characters')
  @UseGuards(SessionGuard)
  async create(@Req() request: RequestWithSession, @Body() body: { name?: unknown }) {
    const { accountId } = this.session(request);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!nameIsValid(name)) {
      throw fail(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'NAME_INVALID',
        'Two to twenty letters, single spaces between words.',
      );
    }
    // The body carries a name and NOTHING else. baseLevel and vocation are
    // server-owned; a request that tries to set them is ignored by shape, not
    // trusted and overwritten (§19).
    try {
      const id = await withTransaction(this.prisma, (tx) =>
        characterContext.createCharacter(tx, {
          accountId: toAccountId(accountId),
          vocation: null,
          name,
          baseLevel: 1,
          at: new Date(),
        }),
      );
      recordDomainEvent({ kind: 'character.created', characterId: id, accountId });
      return this.detail(accountId, id);
    } catch (error) {
      throw asHttp(error);
    }
  }

  @Get('characters/:id')
  @UseGuards(SessionGuard)
  async character(@Req() request: RequestWithSession, @Param('id') id: string) {
    const { accountId } = this.session(request);
    return this.detail(accountId, id);
  }

  private async detail(accountId: string, characterId: string): Promise<CharacterDetail> {
    // Ownership comes from the SESSION, and a character belonging to another
    // account is reported as absent (§19).
    const row = await this.prisma.character.findFirst({
      where: { id: characterId, accountId, retiredAt: null },
      select: { id: true, name: true, baseLevel: true, vocation: true },
    });
    if (!row) throw notFound();
    return {
      id: row.id,
      name: row.name,
      baseLevel: row.baseLevel,
      vocation: row.vocation,
      stamina: await staminaView(this.prisma, row.id),
      premium: await this.isPremium(accountId),
      activity: await currentActivity(this.prisma, this.resolver, row.id),
    };
  }
}
