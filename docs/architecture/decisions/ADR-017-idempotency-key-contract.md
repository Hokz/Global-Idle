# ADR-017 — Idempotency keys are account-scoped and bound to a request fingerprint

**Status:** `PROPOSED`
**Phase:** 0A (tightens `CLIENT_SERVER_BOUNDARIES.md` §3)
**Date:** 2026-09-20

## Context

Value-moving commands carry a client-supplied idempotency key so a retried purchase cannot
double-charge. The original statement — *"a repeat of the same key returns the original result"*
— leaves two holes large enough to matter.

**Cross-account collision.** If keys live in one namespace, a key chosen by account A could
collide with one chosen by account B. A client generating UUIDs will not collide by accident,
but the contract should not depend on clients behaving well, and a naive or malicious client
could return another account's result.

**Payload mismatch.** If the same key arrives with a *different* request body — buy listing X,
then buy listing Y under the same key — returning the first result silently performs the wrong
operation from the caller's point of view. Performing the second breaks idempotency entirely.
The original contract said nothing.

## Decision

**An idempotency record is scoped and fingerprinted.**

```text
key identity  =  (authenticated account/principal, command namespace, client key)
stored with   =  canonical fingerprint of the request payload
```

Resolution:

| Case | Behaviour |
|---|---|
| Key unseen | execute, store `(fingerprint, result)`, return result |
| Key seen, **fingerprint matches** | return the **original result**; do not execute |
| Key seen, **fingerprint differs** | **reject explicitly** with a distinct error; do not execute, do not overwrite |
| Key from another account | **not visible** — it is a different key identity entirely |

The fingerprint is a canonical hash of the semantically significant request fields, so field
ordering or formatting cannot produce a false mismatch.

**Settlement operation ids are unchanged**: server-generated, deterministic, derived from
activity id plus checkpoint sequence (`DATA_ARCHITECTURE.md` §5). They are not client keys and
do not use this contract.

## Consequences

**Benefits.**
- Account A cannot observe, collide with, or expose account B's result. Scoping makes it
  structurally impossible rather than statistically unlikely.
- A retry with a changed payload fails loudly instead of doing the wrong thing quietly. A client
  bug that reuses keys becomes a visible error at the first occurrence.
- The safe case — genuine network retry, identical payload — behaves exactly as before.
- The contract is explicit enough to test, which the original was not.

**Costs.**
- Storing a fingerprint per key, and computing it per request. Negligible against the cost of a
  transaction.
- Canonicalization must be stable across client versions, or a legitimate retry could mismatch.
  This makes the canonical form part of the API contract, which it should have been anyway.
- Idempotency records need a retention policy. Long enough to cover any plausible retry window;
  a `DEFERRED PARAMETER`, not an architecture question.

**Constraints created.**
- No idempotency lookup may be performed outside the authenticated principal's scope.
- Every value-moving command defines which fields are semantically significant.
- A fingerprint mismatch is never resolved by executing.

## Alternatives considered

**Global key namespace.** Rejected. It makes cross-account exposure depend on clients generating
good keys, which is not a property the server can rely on.

**Ignore the payload; key alone decides.** Rejected. Same key with a different body silently
returns a result for an operation the caller did not request — the worst kind of failure,
because it looks like success.

**Overwrite on mismatch (last write wins).** Rejected. It abandons idempotency: two retries with
different bodies would both execute.

**Server-generated keys for client commands.** Rejected. The client needs the key *before* the
first attempt, precisely so it can retry an attempt whose response it never saw. A
server-generated key cannot exist yet at that moment.

## Product constraints requiring this architecture

- *"Economy operations must be transactional and auditable."* — `AGENTS.md` §5
- *"no item duplication; no currency double-spend"* — `docs/ARCHITECTURE.md`
- Market operations need an idempotency key — `docs/ECONOMY.md`
- Authorization on every account mutation — `docs/ARCHITECTURE.md`, security baseline
