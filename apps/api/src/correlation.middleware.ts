/**
 * Carry the request's correlation id into the domain (§12.2).
 *
 * nestjs-pino puts the id on the request and on every HTTP log line, but a
 * domain event reported three layers down is emitted through the domain's own
 * logger, which reads the id from an AsyncLocalStorage. Without this the two
 * halves of one request produce lines that cannot be joined.
 */
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CORRELATION_ID_HEADER, withCorrelationId } from '@global-idle/domain';

interface CorrelatedRequest {
  readonly id?: unknown;
  readonly headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: CorrelatedRequest, _response: unknown, next: () => void): void {
    const header = request.headers[CORRELATION_ID_HEADER];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    const id = (typeof request.id === 'string' ? request.id : undefined) ?? fromHeader;
    withCorrelationId(id ?? randomUUID(), next);
  }
}
