import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';
import { ReadinessIndicator } from './readiness.service.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(ReadinessIndicator) private readonly readiness: ReadinessIndicator,
  ) {}

  /**
   * LIVENESS — the process is running, and NOTHING ELSE (§12.1).
   *
   * There is no dependency check here and there must never be one: a liveness
   * probe that fails on a database blip restarts healthy processes during an
   * incident and turns a database problem into an outage. It is deliberately
   * not a Terminus health check, so there is no list for a future dependency
   * to be added to (test H1).
   */
  @Get('live')
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  /** READINESS — all four conditions of §12.1, each able to hold traffic back
   *  on its own (tests H2-H5). */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.readiness.database(),
      () => this.readiness.migrations(),
      () => this.readiness.cache(),
      () => this.readiness.content(),
    ]);
  }
}
