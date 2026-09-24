# Economy Integrity and Security Architecture

**Document status:** `PHASE_0A_COMPLETE` / `ARCHITECTURE_APPROVED`
**Phase:** 0A.7
**Depends on:** `ADR-003`, `ADR-004`, `ADR-009`, `DATA_ARCHITECTURE.md`

---

## 1. The two invariants everything rests on

> **An `ItemInstance` occupies exactly one custody scope at any instant.** (`ADR-004`)
> **A currency balance is a projection of an append-only ledger.** (`ADR-003`)

Every mechanism below is an application of those two sentences. The design target is not "dupes
are prevented" but **"a dupe is not a representable state"** — validation can be raced, a
uniqueness constraint cannot.

---

## 2. Custody scopes

| Scope | Holds items that are |
|---|---|
| `character_inventory` | carried by a character |
| `character_equipment` | equipped, in a specific slot |
| `market_escrow` | committed to a listing, under server control |
| `forge_input` | committed to a forge attempt |
| `consumed` | terminal — sacrificed, sold, destroyed |

Exactly one, always. An item in escrow is *not* in the seller's inventory, so listing it twice,
equipping it, or forging with it are not states the system can reach.

`consumed` is terminal. Instance ids are never reused.

**There is no `account_recovery` scope.** Phase 0A listed one here, to hold a retired Character's
items (`ADR-007`). It was never built, and `ADR-020` removes it: a Character pending deletion keeps
its items where they are for 30 days, and its final purge **destroys** every item it still owns.
Nothing moves to the Account at purge. Items the player moved into Account custody — the Depot or
the Stash — before requesting deletion are the Account's, and the purge does not touch them.

---

## 3. Ledger model

Append-only. No updates, no deletes — enforced by **database permissions**, not convention.

**One designed exception** (`ADR-020`): a Character's final purge deletes that Character's POUCH
entries and POUCH balance, 30 days after a deletion request, and nothing else. The value still in
the Pouch is destroyed with them — it is **not** moved to the Bank. The purge never deletes or
changes a BANK entry, so every Account's ledger, balances and reconciliation are untouched by it.
The purge runs under its own capability; the application role still cannot delete an entry.

Each entry records: subject account, currency type, signed amount, reason code, operation id,
counterparty where applicable, timestamp, resulting balance.

- Balance projections are updated **only** inside the transaction that appends the matching
  entries.
- Corrections are **compensating entries**, never edits. The original stays.
- Reconciliation verifies `sum(entries) == projection` per subject.

`DECIDED IN PHASE 0A` — **a reconciliation mismatch halts economy writes for the affected
subject** and raises a P1. Continuing to serve a balance that disagrees with its own ledger
converts a detectable bug into distributed, permanent corruption.

---

## 4. Atomic operations

Each is exactly one transaction. A partially applied economy operation is not a state the
system can be in.

### Market purchase

```text
lock buyer, seller, listing, item   (deterministic order — DATA_ARCHITECTURE §4)
  verify listing active, buyer funds, buyer ≠ seller
  debit buyer            → ledger
  credit seller net fee  → ledger
  record fee             → ledger
  item custody: market_escrow → buyer inventory
  listing → SOLD
commit
```

### Market listing

`item custody: inventory → market_escrow`, listing row created, fee debited, ledger appended.
Escrow is what makes the double-listing rule structural rather than validated.

### Forge attempt

```text
lock target, sacrificeA, sacrificeB, account
  verify custody of all three, same classification, same rarity, costs available
  debit costs           → ledger
  sacrifices → consumed
  roll outcome (server-side, seeded, recorded)
  on success: target forge tier += 1
  on failure: target unchanged        ← LOCKED BY PRODUCT
commit
```

The target's custody never changes, on either outcome.

### Settlement

Progression, loot materialization into `character_inventory`, gold credit and ledger append —
one transaction (`ADR-002`).

### Roster slot unlock

Gold debit, ledger append, capacity increment — one transaction.

---

## 5. Idempotency

Two mechanisms, deliberately separate (`ADR-017`, `DATA_ARCHITECTURE.md` §5):

**Client-originated commands** carry a client idempotency key whose identity is
`(authenticated principal, command namespace, client key)`, stored with a canonical request
fingerprint. Same identity + same fingerprint returns the original result; same identity +
**different** fingerprint is an **explicit conflict reject**; a key from another account is a
different identity entirely, so there is no collision and no result leakage. A client key is
never treated as globally unique.

**Server settlements** carry a deterministic server-generated operation id derived from activity
id plus checkpoint sequence, enforced by its own uniqueness constraint, so a retry after a lost
response cannot double-apply.

Together these are what make a dropped mobile connection safe during a purchase — and what stop
a buggy client that reuses one key for two different purchases from silently getting the wrong
one.

---

## 6. Trust boundaries

| Boundary | Rule |
|---|---|
| Client → API | no outcome, amount, timestamp or success flag is ever accepted (`CLIENT_SERVER_BOUNDARIES.md` §6) |
| API → Engine | the engine resolves rolls but **cannot create or move an item or currency** |
| Engine → Persistence | none. The engine has no I/O (`ADR-010`) |
| Application → Ledger | append only; no application path updates or deletes an entry |
| Purge capability → Ledger | deletes **only** the POUCH entries of a Character whose purge it has itself verified — `PENDING_DELETION`, deadline passed — in the same transaction; never a BANK entry, never an update (`ADR-020` §7) |
| Admin tooling | subject to the same transactional and audit rules as gameplay; it cannot purge early or restore after a purge |

`DECIDED IN PHASE 0A` — **admin and support tooling is not a privileged bypass.** A grant, a
refund or a correction is an ordinary ledgered operation with an operation id and an actor
recorded. Tools that write directly are how unexplainable balances happen, and they make an
audit trail decorative.

---

## 7. Abuse boundaries

| Vector | Mitigation |
|---|---|
| Item duplication | single custody + uniqueness constraint (`ADR-004`) |
| Currency double-spend | pessimistic row locks + ledger + operation id |
| Retry-driven double-charge | idempotency keys |
| Two-tab concurrent play | one activity claim per account (`ADR-008`) |
| Client-inflated rewards | no reward field exists in any command |
| Fabricated offline training time | elapsed time computed from persisted server timestamps only |
| Market self-dealing / wash trading | buyer ≠ seller enforced; fees make round-trips lossy; price history retained for analysis |
| Listing spam | listing fees, rate limits |
| Enumeration of accounts or items | ownership-scoped queries and rate limiting are the control; non-sequential UUIDv7 ids raise the cost but are **not** the security boundary (`DATA_ARCHITECTURE.md` §2) |
| Race on roster vocation uniqueness | persistence-level constraint over existing Characters; whether a `PENDING_DELETION` Character counts is `OPEN` (`ADR-020` §5) |
| Deletion used to bank carried value | impossible by rule: nothing Character-owned moves to the Bank or to any recovery custody at purge — it is destroyed (`ADR-020`, L7–L8) |
| Restore/purge race at the deadline | both lock the Character and decide against the authoritative clock after the lock; exactly one wins (`ADR-020` §7) |
| Starting-grant farming through delete → purge → recreate | `OPEN` — the tutorial-replay and starting-grant rule after a purge is a Product Owner decision (PRE-4 gate, `PHASE_GATES.md` § *G4.1c*) |

`DEFERRED PARAMETER` — fee percentages, listing limits, rate-limit thresholds. They are tuning
values; the mechanisms are architectural.

---

## 8. Failure, retry and rollback

| Failure | Behaviour |
|---|---|
| Validation fails | reject before any write; nothing to roll back |
| Constraint violation mid-transaction | full rollback; operation id remains free to retry |
| Crash mid-transaction | database rolls back; no partial economy state exists |
| Response lost after commit | client retries with the same idempotency key and receives the original result |
| Reconciliation mismatch | halt economy writes for the subject; P1 |
| Restore from backup | reconciliation runs **before** the economy reopens (`DATA_ARCHITECTURE.md` §10) |

There is deliberately no compensating-saga machinery: everything economic lives in one
PostgreSQL instance precisely so that real transactions are available (`ADR-012`).

---

## 9. What is logged

Enough to answer *"where did this come from?"* years later:

- every ledger entry, with operation id and reason code;
- every custody transition;
- for high-value randomized outcomes — rarity above a threshold, forge results — the table
  rolled, the seed position, the result, and the operation id
  (`GAME_ENGINE_ARCHITECTURE.md` §5);
- authentication and session-eviction events;
- every admin action, with the acting operator.

Never logged: credential material, session tokens, or anything that would let a log reader
impersonate a player.

---

## 10. Premium currency

Treated as a currency type in the same ledger, with the same guarantees.

`DECIDED IN PHASE 0A` — **no real-money exchange rate exists in game logic.** Pricing is
commerce configuration, outside the domain, matching `docs/ECONOMY.md`'s
*"Do not hard-code a real-money value into game rules."* Purchase fulfilment credits premium
currency through an ordinary ledgered operation with an operation id derived from the payment
provider's transaction id, which makes payment retries idempotent by construction.

`DEFERRED` — payment provider integration, chargeback handling, regional pricing. Commerce, not
architecture.

---

## 11. Economy checklist

- [x] Single custody makes duplication unrepresentable
- [x] Balances derive from an append-only ledger
- [x] Ledger append-only at the permission level
- [x] Every value movement is one transaction
- [x] Every value movement carries an operation id, constraint-enforced
- [x] Locks acquired in a globally consistent order
- [x] Escrow removes listed items from every other scope
- [x] Forge preserves the target on failure
- [x] Admin tooling uses the same audited paths
- [x] Reconciliation gates the economy after restore, and halts on mismatch
- [x] No real-money rate in game logic
