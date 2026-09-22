# ADR-019 — Currency lives in custody scopes, and the ledger says which

**Status:** `ACCEPTED`
**Phase:** 2 (correction pass)
**Date:** 2026-09-22
**Amends:** [ADR-003](./ADR-003-ledger-derived-currency-balances.md) — extends it, and contradicts
none of it.

## Context

Phase 2 posts every Rat's Gold straight into the account's `CurrencyBalance`. That makes Hunt
Gold **safe the instant it drops**, which quietly removed the risk the Product Owner intended a
Hunt to carry. The locked product rule is:

```text
creature Gold  ->  Gold Pouch      carried, at risk, forfeited on death without Full Bless
Bank           ->  stored Gold     safe
Gold Pouch    !=   Bank
```

So the economy needs a second place Gold can be, and death needs to be able to destroy what is in
one of them.

The obvious shortcut — a second mutable balance column, or a `goldPouch` integer on `Character` —
is exactly the shape ADR-003 exists to forbid: *"A stored balance that any code path can increment
is the shape of every currency duplication bug ever shipped."* A pouch that is not ledger-derived
would be unauditable, undetectably driftable, and would make "where did my gold go" unanswerable
for the one movement most likely to be disputed: a death.

## Decision

**Custody is a dimension of the ledger, not a second ledger.**

A `CurrencyCustody` discriminates where value sits:

| Custody | Subject | Safe? | Phase |
|---|---|---|---|
| `BANK` | the **Account** | yes | now |
| `POUCH` | the **Character** | no — forfeited on death without Full Bless | now |

Both the append-only `LedgerEntry` and the `CurrencyBalance` projection carry `(subjectId,
custody, currency)`. `subjectId` is the Account for `BANK` and the Character for `POUCH`;
`accountId` stays on both rows, denormalised, so an account-wide audit never has to join through
`Character`.

Everything ADR-003 decided still holds, unchanged:

- the ledger is append-only; a correction is a compensating entry;
- a balance is a projection, written only in the transaction that appends its entries;
- every movement carries a unique operation id, so a replay is a no-op;
- reconciliation recomputes from the entries — now **per custody scope**, which is the same
  guarantee stated at the granularity the data now has.

Three movements follow from it, and all three are ordinary ledger writes:

```text
Hunt reward        +N  ->  (character, POUCH, GOLD)          reason hunt.reward
Deposit            -N  ->  (character, POUCH, GOLD)          reason gold.deposit   } one
                   +N  ->  (account,   BANK,  GOLD)          reason gold.deposit   } operation
Death forfeiture   -N  ->  (character, POUCH, GOLD)          reason hunt.death.forfeit
```

A deposit is **double-entry**: two entries, one operation id, one transaction, sum zero. A
forfeiture is a single negative entry and is a genuine **sink** — the value leaves the economy,
and the ledger says when, whose, and why.

**The Pouch is per Character, not per Account.** ADR-003 scoped Gold to the account and flagged it
for review; this does not reverse that — the **Bank** stays account-wide, which is what roster
slot unlocks and market fees need. What is carried is per Character because it is carried *by* a
Character: a Knight's death cannot cost a Druid its Gold, and an Active Party of several
Characters must be able to carry several pouches at once. Choosing this now costs one column;
choosing it after Party ships costs a migration of live money.

## Consequences

**Benefits.**
- Hunt Gold is at risk again, which is the product rule, and the risk is auditable.
- "Where did my gold go" survives a death: there is an entry, with a reason and an operation id.
- Deposit and withdraw are already expressible, and already balanced, before the Bank UI exists.
- Reconciliation still catches drift, now per scope, so a pouch cannot silently disagree with its
  entries any more than a bank balance could.
- A future custody — escrow for the Market, a Reward Chest, a shared Party pool — is a new enum
  value and a new subject, not a new table and not a new invariant.

**Costs.**
- The projection's key widens, so `post` and `readBalance` take a custody subject rather than an
  account. Every existing call site had to say which scope it meant, which is the point.
- Two rows exist per currency per player instead of one, and an account-wide total is a sum rather
  than a read. Worth it: the two numbers are genuinely different numbers, and showing them as one
  was the defect.
- A forfeiture destroys value, so the ledger no longer sums to zero across the economy. It never
  did — rewards create value too — but the sinks are now first-class and must be reported as such.

**Constraints created.**
- No code may credit or debit without naming a custody scope. There is no default, deliberately:
  a reward that forgot to say would otherwise land in the Bank, which is the bug this ADR exists
  to remove.
- A `POUCH` row must name a Character and a `BANK` row must not. The database enforces it rather
  than trusting every call site.
- Moving value between scopes is two entries under one operation id. A single-entry "move" would
  be value created in one place and destroyed in another, and reconciliation would be right to
  call it drift.

## Alternatives considered

**A `goldPouch` column on `Character`.** Rejected. It is a mutable balance no ledger explains, it
cannot answer where the gold went, and ADR-003 forbids it in as many words. It is also the one
number a player will argue about after a death.

**A second ledger table for pouch movements.** Rejected. Two append-only logs need two
reconciliation routines, two retention strategies and a rule for which one a transfer writes to.
One log with a scope column answers every question the two would, and cannot disagree with itself.

**Keep one account-scoped balance and mark Hunt Gold "unbanked" with a flag on the entries.**
Rejected. The projection would still be a single number, so the balance shown to the player would
still be the safe one, and "how much is at risk right now" would be a scan of the ledger on every
read — the O(n) read ADR-003 already rejected.

**Auto-deposit the pouch at the end of every Hunt.** Rejected as a product decision, not a
technical one: it would make the pouch a formality and restore the original defect for every death
that happens between Hunts. Deposit stays a deliberate act so that carrying Gold is a real choice.

**Make the Pouch account-scoped like the Bank.** Rejected. It reads identically today, with one
Character, and breaks the first time two Characters hunt at once — at which point one Character's
death would forfeit another's earnings.

## Product constraints requiring this architecture

- *"creature Gold -> Gold Pouch; Gold Pouch != Bank"* — Product Owner, Phase 2 reconciliation
- *"WITHOUT Full Bless: lose ALL Gold currently in Gold Pouch"* — Product Owner, death policy
- *"Never mutate balances casually."* — `docs/ARCHITECTURE.md`
- *"no item duplication; no currency double-spend."* — `docs/ARCHITECTURE.md`, security baseline
- *"must not be silently account-global in a way that breaks future concurrent Characters"* —
  Product Owner, Phase 2 reconciliation
