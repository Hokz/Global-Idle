/**
 * Phase 1 adds ONE token. PRISMA and CONTENT_RESOLVER already exist in the
 * health composition root and are re-exported here rather than redeclared:
 * two symbols for one dependency means two providers, and eventually two
 * Prisma clients.
 */
export { CONTENT_RESOLVER, PRISMA } from '../health/tokens.js';
export const SESSION_SECRET = Symbol('SESSION_SECRET');
export const COOKIE_POLICY = Symbol('COOKIE_POLICY');
