// Public surface of the Identity & Access bounded context (ADR-001).
//
// This file is the ONLY legal entry point (§4.1, tests W8 and W11).
// Phase 0B builds foundations: Account, AuthIdentity and Entitlement state.
// Phase 1 owns the user-facing authentication and session flows (§19).
export const CONTEXT_NAME = 'identity' as const;

export { entitlementPort, grant, revoke } from './entitlement/index.js';
export type {
  Entitlement,
  EntitlementKind,
  EntitlementPort,
  RateSegment,
} from './entitlement/index.js';
