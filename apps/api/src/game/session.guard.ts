/**
 * Resolves the signed cookie into { accountId, sessionId } and refuses the
 * request without one (§3.3).
 *
 * The session is attached to the request; NOTHING reads an account or session
 * id from a body, a query string or a header. That is the whole authorization
 * boundary of Phase 1, and it is one place on purpose.
 */
import { Injectable, type CanActivate, type ExecutionContext, Inject } from '@nestjs/common';
import { SESSION_COOKIE, openSession, type SessionPayload } from '@global-idle/domain';
import { SESSION_SECRET } from './tokens.js';
import { unauthenticated } from './errors.js';

export interface RequestWithSession {
  headers: Record<string, string | string[] | undefined>;
  session?: SessionPayload;
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
    if (!session) throw unauthenticated();
    request.session = session;
    return true;
  }
}
