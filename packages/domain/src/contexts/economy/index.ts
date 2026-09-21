// Public surface of the Economy bounded context (ADR-001, ADR-003).
//
// This file is the ONLY legal entry point. Reaching past it into ledger.ts is
// a dependency-cruiser violation, inside this package as much as across it
// (§4.1, tests W8 and W11).
//
// Phase 0B builds the CURRENCY foundation only: append-only ledger, balance
// projection, transactional debit and credit, and reconciliation. No
// ItemInstance, no custody, no Market, no Forge (§19).
export const CONTEXT_NAME = 'economy' as const;

export type { CurrencyKind, LedgerPosting, Reconciliation } from './ledger.js';
export { countReconciliationMismatches, post, readBalance, reconcile } from './ledger.js';
