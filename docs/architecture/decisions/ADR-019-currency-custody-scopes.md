# ADR-019 — Currency lives in custody scopes, and the ledger says which

**Status:** `ACCEPTED`
**Phase:** 2 (correction pass)
**Date:** 2026-09-22
**Amends:** [ADR-003](./ADR-003-ledger-derived-currency-balances.md) — extends it, and contradicts
none of it.
**Amended by:** [ADR-020](./ADR-020-character-deletion-grace-and-purge.md) (2026-09-24) — one
guarantee row below; see the note under the table.

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

### What the database actually guarantees

This is the part worth stating precisely, because the first version of this ADR claimed more than
it held. It said the pairing was enforced, and what the migration actually wrote was:

```sql
CHECK (custody = 'BANK'  AND "subjectId" =  "accountId")
   OR (custody = 'POUCH' AND "subjectId" <> "accountId")
```

That is a **naming convention, not ownership**. It accepts a POUCH whose subject is a string
nobody ever issued, and it accepts Account A holding a pouch over a Character owned by Account B —
both of them money the ledger cannot attribute, which is the one thing a ledger exists to prevent.
Measured rather than argued: with the composite foreign key dropped and that CHECK restored, a row
naming a Character that does not exist is **accepted**.

What replaces it says the same sentence in a form the database can enforce. Every row carries an
explicit `characterId`, and:

| Guarantee | Held by |
|---|---|
| a BANK row is account-scoped and names no carrier | `CHECK`: `custody='BANK' AND "characterId" IS NULL AND "subjectId"="accountId"` |
| a POUCH row names a carrier, and the subject key IS that carrier | `CHECK`: `custody='POUCH' AND "characterId" IS NOT NULL AND "subjectId"="characterId"` |
| that carrier is a **real Character** | `FOREIGN KEY ("characterId","accountId") REFERENCES "Character"("id","accountId")` |
| that Character belongs to **the Account on the row** | the same foreign key — it is the pair that is checked, not the id alone |
| a Character that has carried Gold is never hard-deleted | `ON DELETE RESTRICT` (ADR-007/I12, now a database fact rather than a convention) |

> **Amended by [ADR-020](./ADR-020-character-deletion-grace-and-purge.md), 2026-09-24.** The last
> row no longer states a product rule: a Character is now hard-deleted by its final purge, 30 days
> after a deletion request, and its POUCH entries and balance are deleted with it rather than moved
> to the Bank. The foreign key may still refuse every other deletion path; how the purge removes
> the rows it guards is ADR-020 §7's to define. Every other guarantee in this table stands — in
> particular, a BANK row still names no Character, which is why the purge never has to touch one.

Three details make this work rather than merely look right:

- `Character` gains `UNIQUE (id, accountId)`. `id` alone was already unique, so the index
  constrains nothing new about Characters — it exists to be **pointed at**, because a composite
  foreign key needs a composite target.
- The pair is `MATCH SIMPLE`, PostgreSQL's default, so a BANK row with `characterId IS NULL` skips
  the foreign key entirely. BANK needs no exemption; it simply is not a reference.
- `ON DELETE RESTRICT` rather than `SET NULL`. Nulling the carrier would silently produce a row the
  CHECK above forbids, so the failure would surface later, somewhere it means nothing.

The projection is constrained identically to the ledger. A `CurrencyBalance` row cannot name a
Character its entries could not.

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
- A `POUCH` row must name a **real** Character **owned by the account on the row**, and a `BANK`
  row must name none. A composite foreign key and a CHECK enforce it, so it stays true of rows this
  code did not write — a hand-run `INSERT`, a future importer, a migration written in a hurry.
- Moving value between scopes is two entries under one operation id. A single-entry "move" would
  be value created in one place and destroyed in another, and reconciliation would be right to
  call it drift.

## Alternatives considered

**A `goldPouch` column on `Character`.** Rejected. It is a mutable balance no ledger explains, it
cannot answer where the gold went, and ADR-003 forbids it in as many words. It is also the one
number a player will argue about after a death.

**Keep `subjectId` polymorphic and validate it in TypeScript.** Rejected, and this was the first
version's mistake. `subjectIdOf` does reject a BANK that names a Character and a POUCH that names
none — but it can only reject what passes through it, and a ledger's integrity has to survive the
code being wrong. A polymorphic column also cannot be a foreign key at all, which is precisely the
guarantee that was missing.

**A constraint trigger instead of a foreign key.** Rejected. It would express the same rule as
procedural code the planner cannot use, that no `\d` shows a reviewer, and that has to re-derive
by hand what `ON DELETE RESTRICT` gives for free.

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
