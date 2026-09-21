/**
 * Phase 1's routes (spec §3.2, §12).
 *
 * The dev credential provider is registered HERE, behind both gates, so a
 * production build does not merely hide the route — it does not have one. A
 * 403 would still tell an attacker the mechanism exists.
 *
 * PRISMA and CONTENT_RESOLVER come from HealthModule, which already builds
 * them. A second Prisma client would be a second connection pool, and a second
 * resolver a second cache that can disagree with the first.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import {
  assertDevAuthSafe,
  devAuthEnabled,
  sessionCookiePolicy,
  type AppConfig,
} from '@global-idle/domain';
import { HealthModule } from '../health/health.module.js';
import { COOKIE_POLICY, SESSION_SECRET } from './tokens.js';
import { GameController } from './game.controller.js';
import { WorldController } from './world.controller.js';

@Module({})
export class GameModule {
  static forRoot(config: AppConfig, health: DynamicModule): DynamicModule {
    // A misconfiguration is a BOOT FAILURE, not a warning nobody reads.
    assertDevAuthSafe();

    return {
      module: GameModule,
      imports: [health],
      controllers: devAuthEnabled() ? [GameController, WorldController] : [WorldController],
      providers: [
        { provide: SESSION_SECRET, useValue: config.SESSION_SECRET },
        // Decided once, here, from configuration — never per request.
        { provide: COOKIE_POLICY, useValue: sessionCookiePolicy(config.PUBLIC_ORIGIN) },
      ],
    };
  }
}

export { HealthModule };
