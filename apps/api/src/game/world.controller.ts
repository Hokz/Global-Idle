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
  Header,
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
  hunt as huntContext,
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
  isContentKey,
  mapSchema,
  regionSchema,
  type ContentBundleResolver,
} from '@global-idle/game-data';
import { CONTENT_RESOLVER, PRISMA } from './tokens.js';
import { SessionGuard, type RequestWithSession } from './session.guard.js';
import { asHttp, codeOf, fail, notFound } from './errors.js';
import { isPublishedVersion } from './input.js';
import { currentActivity, huntView } from './views.js';

/** The responses this controller writes itself; see `activity` below. */
interface JsonReply {
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
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

          const character = await tx.character.findUniqueOrThrow({
            where: { id },
            select: { baseXp: true },
          });

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

          // The run is created BESIDE the Activity, in the same transaction:
          // an Activity without a run would be a Hunt nothing can simulate,
          // and the two must exist or not exist together (§11).
          await huntContext.startRun(tx, {
            activityId,
            characterId: id,
            resolver: this.resolver,
            contentVersion: bundle.version,
            contentKey: hunt.key,
            level: huntContext.levelForXp(character.baseXp),
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
      // A Hunt LEAVES; anything else just ends. Either way there is NO GRACE —
      // a deliberate exit is not a lost connection (§8).
      await withTransaction(this.prisma, (tx) =>
        huntContext.endRunOrActivity(tx, toActivityId(claim.activityId), 'LEFT', new Date()),
      );
    } catch (error) {
      throw asHttp(error);
    }
  }

  /**
   * The Hunt run as it stands. PURE (Phase 3.5 §6).
   *
   * This used to be the endpoint that advanced the simulation, and that was a
   * GET the whole stack is entitled to repeat: a retry, a prefetch, a strict
   * mode double-render, a proxy revalidating. Each repetition was a
   * settlement. Advance-on-read survives — `POST .../hunt/advance` is the read
   * that advances — and this one answers with durable state and writes nothing.
   *
   * `no-store`, because a Hunt snapshot is never valid a second time.
   */
  @Get('characters/:id/hunt')
  async run(
    @Req() request: RequestWithSession,
    @Param('id') id: string,
    @Res() reply: JsonReply,
  ): Promise<void> {
    await this.own(request, id);
    // `HuntRunView | null`, and the null has to be on the wire. Returning it
    // through Nest sends an EMPTY 200, which a client cannot tell from a
    // truncated response — the same reason `activity` writes its own answer.
    reply.setHeader('Cache-Control', 'no-store');
    const claim = await this.prisma.occupancyClaim.findUnique({
      where: { characterId: id },
      select: { activityId: true },
    });
    if (!claim) {
      reply.json(null);
      return;
    }
    try {
      reply.json(
        (await withTransaction(this.prisma, (tx) =>
          huntContext.snapshot(tx, {
            activityId: toActivityId(claim.activityId),
            resolver: this.resolver,
          }),
        )) ?? null,
      );
    } catch (error) {
      throw asHttp(error);
    }
  }

  /**
   * Bring the run up to now, and prove the connection alive doing it (§11).
   *
   * The ONE route that settles. A client drives it on its own clock; the
   * server still decides how far "now" reaches, because only the span proven
   * live is simulated.
   */
  @Post('characters/:id/hunt/advance')
  @HttpCode(HttpStatus.OK)
  async advance(
    @Req() request: RequestWithSession,
    @Param('id') id: string,
    @Res() reply: JsonReply,
  ): Promise<void> {
    await this.own(request, id);
    reply.setHeader('Cache-Control', 'no-store');
    reply.json((await this.advanceRun(id, true)) ?? null);
  }

  /** Liveness. A session is ONLINE_ACTIVE while these keep arriving (P2-D7).
   *  The same settlement as `advance`, under the name Phase 2 gave it. */
  @Post('characters/:id/hunt/heartbeat')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async heartbeat(@Req() request: RequestWithSession, @Param('id') id: string) {
    await this.own(request, id);
    return (await this.advanceRun(id, true)) ?? null;
  }

  /**
   * The static tile map a Hunt is played on, AT A NAMED VERSION (§5).
   *
   * The version is in the URL, and that is the whole point. An Activity pins
   * the bundle it started under and keeps simulating against it after a
   * publish; a map endpoint that answered with "whatever is current" would
   * have the server colliding against one geometry while the browser drew
   * another — a wall the Character walks through, on screen. The identity of
   * the resource is `contentVersion + key`, so the answer is genuinely
   * immutable and the cache header is genuinely true.
   */
  @Get('content/:contentVersion/maps/:key')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async map(@Param('contentVersion') version: string, @Param('key') key: string) {
    // BOTH parameters are checked against their canonical grammar before
    // anything looks them up. The version becomes a filename inside the
    // resolver and the key becomes a bundle lookup; neither may be arbitrary
    // text, and `toContentVersion` is a branded cast rather than a check.
    // Malformed input is ABSENT — it names a resource that cannot exist — so
    // it is a 404 and never a path.
    if (!isPublishedVersion(version) || !isContentKey(key)) throw notFound();

    let bundle;
    try {
      bundle = await this.resolver.resolve(toContentVersion(version));
    } catch {
      // An unknown version is ABSENT, not a server fault: a client asking for
      // a bundle this deployment never published is asking for nothing.
      throw notFound();
    }
    const definition = bundle.definitions.get(key);
    const parsed = definition ? mapSchema.safeParse(definition) : undefined;
    if (!parsed?.success) throw notFound();
    return { contentVersion: bundle.version, map: parsed.data };
  }

  private async advanceRun(characterId: string, seen: boolean) {
    const claim = await this.prisma.occupancyClaim.findUnique({
      where: { characterId },
      select: { activityId: true },
    });
    if (!claim) return null;
    try {
      return await withTransaction(this.prisma, (tx) =>
        huntContext.advance(tx, {
          activityId: toActivityId(claim.activityId),
          resolver: this.resolver,
          now: new Date(),
          seen,
        }),
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
