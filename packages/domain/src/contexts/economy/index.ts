// Public surface of the Economy bounded context (ADR-001, ADR-003).
//
// This file is the ONLY legal entry point. Reaching past it into ledger.ts is
// a dependency-cruiser violation, inside this package as much as across it
// (§4.1, tests W8 and W11).
//
// Phase 0B built the CURRENCY foundation: append-only ledger, balance
// projection, transactional debit and credit, and reconciliation. Phase 2's
// correction added CUSTODY SCOPES to that same ledger (ADR-019) — still no
// ItemInstance, no Market and no Forge (§19).
export const CONTEXT_NAME = 'economy' as const;

export type {
  CurrencyCustody,
  CurrencyKind,
  CustodySubject,
  LedgerPosting,
  Reconciliation,
} from './ledger.js';
export {
  bankOf,
  characterIdOf,
  countReconciliationMismatches,
  post,
  pouchOf,
  readBalance,
  reconcile,
  subjectIdOf,
  transfer,
} from './ledger.js';
