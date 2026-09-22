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
  hunt,
  identity,
  mintSessionId,
  openSession,
  observability,
  recordDomainEvent,
  sealSession,
  sessionCookie,
  clearedSessionCookie,
  withTransaction,
  type PrismaClient,
  type SessionCookiePolicy,
} from '@global-idle/domain';
import { accountId as toAccountId, newId } from '@global-idle/shared';
import type { ContentBundleResolver } from '@global-idle/game-data';
import { CONTENT_RESOLVER, COOKIE_POLICY, PRISMA, SESSION_SECRET } from './tokens.js';
import { SessionGuard, readCookie, type RequestWithSession } from './session.guard.js';
import { asHttp, codeOf, fail, notFound } from './errors.js';
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

/** A CHARACTER name: 2-20 characters, letters and single inner spaces.
 *  Deliberately strict — loosening a name rule later is easy, tightening one
 *  is a migration. */
const NAME = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const nameIsValid = (name: string) => name.length >= 2 && name.length <= 20 && NAME.test(name);

/** A dev HANDLE is not a character name. It identifies a test account, so
 *  digits are fine and the rule only has to be unambiguous and bounded. */
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;
const handleIsValid = (handle: string) =>
  handle.length >= 2 && handle.length <= 32 && HANDLE.test(handle);

@Controller('api')
export class GameController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONTENT_RESOLVER) private readonly resolver: ContentBundleResolver,
    @Inject(SESSION_SECRET) private readonly secret: string,
    @Inject(COOKIE_POLICY) private readonly cookiePolicy: SessionCookiePolicy,
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
    if (!handleIsValid(handle)) {
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
    // The attributes come from the POLICY, decided once from configuration:
    // `Secure` off on loopback HTTP, on everywhere else, and a non-loopback
    // plaintext origin refuses to boot rather than shipping either mistake.
    reply.setHeader('Set-Cookie', sessionCookie(sealed, this.cookiePolicy));
    return { accountId };
  }

  @Delete('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(
    @Req() request: RequestWithSession,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<void> {
    // Signing out is an EXPLICIT departure, so it takes no grace (§8): the
    // Activity ends here rather than being left for the sweeper to notice in
    // five minutes. Read WITHOUT a guard, because clearing a cookie must work
    // for a caller whose session has already expired — a sign-out that can
    // fail with 401 leaves the browser holding the cookie it asked to drop.
    const raw = request.headers['cookie'];
    const session = openSession(
      this.secret,
      readCookie(Array.isArray(raw) ? raw[0] : raw, SESSION_COOKIE),
    );
    if (session) {
      await withTransaction(this.prisma, (tx) =>
        hunt.endForSession(tx, String(session.sessionId), new Date()),
      );
    }

    // The SAME attributes it was set with; a browser keeps the original
    // cookie when they differ.
    reply.setHeader('Set-Cookie', clearedSessionCookie(this.cookiePolicy));
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
      observability().metrics.characterCreationFailure('NAME_INVALID');
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
      // Phase 3 — a new Character arrives WEARING things. The grant is resolved
      // from the CURRENT bundle, so what it hands out is content and changing
      // it is a publish rather than a deploy.
      const bundle = await this.resolver.current();
      const grantKey = 'starting-grant.origin.rookgaard';
      const id = await withTransaction(this.prisma, (tx) =>
        characterContext.createCharacter(tx, {
          accountId: toAccountId(accountId),
          vocation: null,
          name,
          baseLevel: 1,
          ...(bundle.definitions.has(grantKey) ? { grant: { bundle, key: grantKey } } : {}),
          at: new Date(),
        }),
      );
      // POST-COMMIT: `withTransaction` has already resolved, so this event
      // describes a Character that exists. Reporting it inside the transaction
      // would announce one that a rollback could still take away (§18).
      recordDomainEvent({ kind: 'character.created', characterId: id, accountId });
      return this.detail(accountId, id);
    } catch (error) {
      const http = asHttp(error);
      observability().metrics.characterCreationFailure(codeOf(http));
      throw http;
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
    if (!row) {
      observability().metrics.authorizationReject('/api/characters/:id');
      throw notFound();
    }
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
