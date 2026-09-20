// apps/api — HTTP and realtime adapters plus the composition root (§4.2).
// Thin: adapters and wiring, no domain logic. It reaches the domain only
// through packages/domain, and never imports apps/worker (§5.2, test W10).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const DEFAULT_PORT = 3001;

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const port = Number(process.env['API_PORT'] ?? DEFAULT_PORT);
  await app.listen(port);
}

if (process.env['NODE_ENV'] !== 'test') {
  await bootstrap();
}
