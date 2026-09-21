/**
 * Atlas, hunts, and the Phase 1 hunt-entry boundary (spec §7, §9).
 *
 * ENTER creates a REAL session-bound Activity and stops in the pre-consumption
 * state ACTIVITY_OCCUPANCY_AND_TIMERS.md §4 already defines: occupied, Stamina
 * NEUTRAL, staminaActivatedAt null. No XP, gold, loot, rooms or encounters —
 * Phase 2 decides what raises activation, and this phase does not pretend to.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  activity as activityContext,
  content,
  withTransaction,
  type PrismaClient,
} from '@global-idle/domain';
import {
  accountId as toAccountId,
  activityId as toActivityId,
  characterId as toCharacterId,
  contentKey as toContentKey,
  contentVersion as toContentVersion,
  sessionId as toSessionId,
} from '@global-idle/shared';
import {
  atlasMarkerSchema,
  regionSchema,
  type ContentBundleResolver,
} from '@global-idle/game-data';
import { CONTENT_RESOLVER, PRISMA } from './tokens.js';
import { SessionGuard, type RequestWithSession } from './session.guard.js';
import { asHttp, fail, notFound } from './errors.js';
import { currentActivity, huntView } from './views.js';

@Controller('api')
@UseGuards(SessionGuard)
export class WorldController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONTENT_RESOLVER) private readonly resolver: ContentBundleResolver,
  ) {}

  private session(request: RequestWithSession) {
    const session = request.session;
    if (!session) throw fail(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in first.');
    return session;
  }

  /** The whole Atlas: regions and markers from the CURRENT bundle. Content is
   *  a build artefact, so there is no empty state to design for. */
  @Get('atlas')
  async atlas() {
    const bundle = await this.resolver.current();
    const regions = [];
    const markers = [];
    for (const definition of bundle.definitions.values()) {
      if (definition.kind === 'region') {
        const parsed = regionSchema.safeParse(definition);
        if (parsed.success) regions.push(parsed.data);
      } else if (definition.kind === 'atlas-marker') {
        const parsed = atlasMarkerSchema.safeParse(definition);
        if (parsed.success) markers.push(parsed.data);
      }
    }
    return { contentVersion: bundle.version, regions, markers };
  }

  @Get('hunts/:key')
  async hunt(@Param('key') key: string) {
    const bundle = await this.resolver.current();
    try {
      return huntView(
        await content.resolveHunt(
          this.resolver,
          toContentVersion(bundle.version),
          toContentKey(key),
        ),
      );
    } catch (error) {
      throw asHttp(error);
    }
  }

  /** What reload reads. Durable state only (§9.6). */
  @Get('characters/:id/activity')
  async activity(@Req() request: RequestWithSession, @Param('id') id: string) {
    await this.own(request, id);
    return currentActivity(this.prisma, this.resolver, id);
  }

  @Post('characters/:id/hunt')
  async enter(
    @Req() request: RequestWithSession,
    @Param('id') id: string,
    @Body() body: { huntKey?: unknown },
  ) {
    const session = this.session(request);
    await this.own(request, id);

    const key = typeof body?.huntKey === 'string' ? body.huntKey : '';
    const bundle = await this.resolver.current();

    try {
      // Resolve and KIND-CHECK before anything is written. A key that does not
      // resolve, or resolves to something that is not a runnable hunt, creates
      // no Activity and takes no claim (§9.5).
      const hunt = await content.resolveHunt(
        this.resolver,
        toContentVersion(bundle.version),
        toContentKey(key),
      );

      await withTransaction(this.prisma, (tx) =>
        activityContext.startSessionBound(tx, {
          accountId: toAccountId(session.accountId),
          activityTypeKey: activityContext.HUNT,
          contentVersion: toContentVersion(bundle.version),
          // WHICH hunt. Durable, so reload does not need the URL (§9.5).
          contentKey: toContentKey(hunt.key),
          participants: [toCharacterId(id)],
          // The AUTHENTICATED session, not the account: ADR-008 eviction is
          // between connections, and accountId would make two browsers one.
          claimHolderSessionId: toSessionId(session.sessionId),
          rngSeed: hunt.key,
          at: new Date(),
        }),
      );
      return currentActivity(this.prisma, this.resolver, id);
    } catch (error) {
      throw asHttp(error);
    }
  }

  @Delete('characters/:id/activity')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(@Req() request: RequestWithSession, @Param('id') id: string) {
    await this.own(request, id);
    const claim = await this.prisma.occupancyClaim.findUnique({
      where: { characterId: id },
      select: { activityId: true },
    });
    if (!claim) return;
    try {
      await withTransaction(this.prisma, (tx) =>
        activityContext.endActivity(tx, toActivityId(claim.activityId), new Date()),
      );
    } catch (error) {
      throw asHttp(error);
    }
  }

  /** Ownership from the session; someone else's Character is ABSENT (§19). */
  private async own(request: RequestWithSession, characterId: string): Promise<void> {
    const { accountId } = this.session(request);
    const row = await this.prisma.character.findFirst({
      where: { id: characterId, accountId, retiredAt: null },
      select: { id: true },
    });
    if (!row) throw notFound();
  }
}
