// apps/worker — job consumers plus the composition root (§4.2).
//
// The SAME container image as apps/api, a different start command. It calls a
// bounded context's public surface from packages/domain, exactly as apps/api
// does, and never imports apps/api on any path (ADR-018, §5.2, test W10).
import { activity } from '@global-idle/domain';

export function describeWorker(): string {
  return `worker ready; activity context surface: ${activity.CONTEXT_NAME}`;
}

if (process.env['NODE_ENV'] !== 'test') {
  console.warn(describeWorker());
}
