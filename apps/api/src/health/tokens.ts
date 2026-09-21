/** Injection tokens for the composition root (§4.2). Symbols, so two providers
 *  cannot collide on a string by accident. */
export const APP_CONFIG = Symbol('APP_CONFIG');
export const PRISMA = Symbol('PRISMA');
export const REDIS_PROBE = Symbol('REDIS_PROBE');
export const CONTENT_RESOLVER = Symbol('CONTENT_RESOLVER');
export const METRICS = Symbol('METRICS');
export const MAINTENANCE_QUEUE_HANDLE = Symbol('MAINTENANCE_QUEUE_HANDLE');
