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
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  activity as activityContext,
  content,
  createIdempotencyPort,
  fingerprintOf,
  observability,
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
import { asHttp, codeOf, fail, notFound } from './errors.js';
import { currentActivity, huntView } from './views.js';

/** The one response this controller writes itself; see `activity` below. */
interface JsonReply {
  json(body: unknown): void;
}

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
    const bundle = await this.current();
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

  /** The current bundle, counting the failure §18 asks for. A broken deploy
   *  is the only way this throws, and it should be visible as one. */
  private async current() {
    try {
      return await this.resolver.current();
    } catch (error) {
      observability().metrics.atlasContentLoadFailure();
      throw asHttp(error);
    }
  }

  @Get('hunts/:key')
  async hunt(@Param('key') key: string) {
    const bundle = await this.current();
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

  /**
   * What reload reads. Durable state only (§9.6).
   *
   * §12 declares this `ActivityView | null`, so it answers with the literal
   * JSON `null` when there is no Activity. Returning the value through Nest
   * would send an EMPTY 200 instead, which every consumer then has to guess
   * about — an empty body is not `null`, it is "no answer".
   */
  @Get('characters/:id/activity')
  async activity(
    @Req() request: RequestWithSession,
    @Param('id') id: string,
    @Res() reply: JsonReply,
  ): Promise<void> {
    await this.own(request, id);
    reply.json((await currentActivity(this.prisma, this.resolver, id)) ?? null);
  }

  @Post('characters/:id/hunt')
  async enter(
    @Req() request: RequestWithSession,
    @Param('id') id: string,
    @Body() body: { huntKey?: unknown },
  ) {
    const session = this.session(request);
    await this.own(request, id);

    const key = typeof body?.huntKey === 'string' ? body.huntKey.trim() : '';

    // §12: this route CARRIES an idempotency key. A double-submitted Enter
    // must replay its own answer rather than race the occupancy constraint and
    // come back as a conflict with itself — which is what happens without
    // one, and which the player reads as "the button is broken".
    const raw = request.headers['idempotency-key'];
    const clientKey = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
    if (!clientKey) {
      observability().metrics.huntEntryFailure('IDEMPOTENCY_KEY_REQUIRED');
      throw fail(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'IDEMPOTENCY_KEY_REQUIRED',
        'This request must carry an Idempotency-Key header.',
      );
    }

    try {
      const idempotency = createIdempotencyPort((run) => withTransaction(this.prisma, run));
      const outcome = await idempotency.execute(
        {
          principalId: toAccountId(session.accountId),
          commandNamespace: 'hunt.enter',
          clientKey,
        },
        // THE CLIENT COMMAND, and nothing else (ADR-017).
        //
        // `contentVersion` used to be in here, and it is chosen by the SERVER
        // from whatever bundle is current at the moment the request lands. A
        // retry of the same logical command after a publication therefore
        // fingerprinted differently and came back IDEMPOTENCY_CONFLICT — the
        // client had changed nothing. Which bundle the Activity pinned is part
        // of the first execution's RESULT, not of the command's identity.
        fingerprintOf({ characterId: id, huntKey: key }),
        new Date(),
        async (tx) => {
          // Resolution happens HERE, inside the executed callback, so a replay
          // never re-resolves against a newer bundle. It costs a content read
          // inside the transaction; the resolver caches per version, and the
          // alternative is a retry that can be refused for a publication the
          // caller never saw.
          const bundle = await this.current();
          const hunt = await content.resolveHunt(
            this.resolver,
            toContentVersion(bundle.version),
            toContentKey(key),
          );

          const activityId = await activityContext.startSessionBound(tx, {
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
          });
          return { activityId: String(activityId) };
        },
      );

      if (outcome.outcome === 'conflict') {
        throw fail(
          HttpStatus.CONFLICT,
          'IDEMPOTENCY_CONFLICT',
          'That idempotency key was already used for a different request.',
        );
      }

      // Read the view back from DURABLE state in both outcomes. A replay that
      // returned a serialised snapshot would answer with the world as it was
      // when the first call ran, not as it is (§9.6) — and the Activity's own
      // pinned version is what its Hunt resolves against, however far content
      // has moved on since.
      return currentActivity(this.prisma, this.resolver, id);
    } catch (error) {
      const http = asHttp(error);
      observability().metrics.huntEntryFailure(codeOf(http));
      throw http;
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
    if (!row) {
      observability().metrics.authorizationReject('/api/characters/:id');
      throw notFound();
    }
  }
}
