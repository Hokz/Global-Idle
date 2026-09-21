/**
 * Resolves the signed cookie into { accountId, sessionId } and refuses the
 * request without one (§3.3).
 *
 * The session is attached to the request; NOTHING reads an account or session
 * id from a body, a query string or a header. That is the whole authorization
 * boundary of Phase 1, and it is one place on purpose.
 */
import { Injectable, type CanActivate, type ExecutionContext, Inject } from '@nestjs/common';
import {
  SESSION_COOKIE,
  observability,
  openSession,
  type SessionPayload,
} from '@global-idle/domain';
import { SESSION_SECRET } from './tokens.js';
import { unauthenticated } from './errors.js';

export interface RequestWithSession {
  headers: Record<string, string | string[] | undefined>;
  session?: SessionPayload;
  /** Express fills this in before guards run; it is the route TEMPLATE. */
  route?: { path?: string };
  url?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The route TEMPLATE for the `authorization_rejects_total{route}` label
 * (§18). Never a concrete id: a label whose values are character ids is an
 * unbounded-cardinality bug that takes a Prometheus server down, and it tells
 * an operator nothing the id does not already ruin.
 */
export function routeTemplate(request: RequestWithSession): string {
  const fromRouter = request.route?.path;
  if (fromRouter) return fromRouter;
  const path = (request.url ?? '').split('?')[0] ?? '';
  return (
    path
      .split('/')
      .map((segment) => (UUID.test(segment) ? ':id' : segment))
      .join('/') || 'unknown'
  );
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SESSION_SECRET) private readonly secret: string) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const raw = request.headers['cookie'];
    const cookie = readCookie(Array.isArray(raw) ? raw[0] : raw, SESSION_COOKIE);
    const session = openSession(this.secret, cookie);
    if (!session) {
      observability().metrics.authorizationReject(routeTemplate(request));
      throw unauthenticated();
    }
    request.session = session;
    return true;
  }
}
