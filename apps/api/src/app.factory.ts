/**
 * Build the application without starting it.
 *
 * `main.ts` starts a process; a test needs the same wiring on an ephemeral
 * port, with one dependency deliberately broken. Both go through here, so what
 * a test exercises is what runs in production — and NestJS resolves from
 * apps/api's own dependencies rather than from the repository root, which
 * would put a framework within reach of every package (§3.1, §5.2).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AppConfig } from '@global-idle/domain';
import { AppModule } from './app.module.js';

export async function createApp(
  overrides: Partial<AppConfig> = {},
  options: { readonly bufferLogs?: boolean } = {},
): Promise<INestApplication> {
  // `bufferLogs` holds startup logs until a logger is attached; without one
  // the caller is a test, and `logger: false` keeps its output readable.
  const app = await NestFactory.create(
    AppModule.forRoot(overrides),
    options.bufferLogs ? { bufferLogs: true } : { logger: false },
  );
  app.enableShutdownHooks();
  return app;
}
