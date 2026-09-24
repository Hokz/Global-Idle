# Phase gates

**Status:** `APPROVED DIRECTION`. Nothing here is implemented; each gate names work that must be
done and proven **before** the phase behind it starts.

**Related:** [`MASTER_DEVELOPMENT_ROADMAP.md`](MASTER_DEVELOPMENT_ROADMAP.md) §20 ·
[`PROJECT_STATE.json`](PROJECT_STATE.json) · [`DESIGN_INDEX.md`](DESIGN_INDEX.md)

---

## What a gate is

A gate is a small set of correctness obligations that a later phase would otherwise discover the
expensive way — after its data shape has hardened, or after two accounts already share a run.

A gate is **not** a phase. It has no matrix of its own unless the work lands in a phase that
does, it does not appear in `PROJECT_STATE.json` as an active phase, and passing one never
changes any phase's verification record.

**This document records requirements. It does not record status.** Implementation and
verification live in [`PROJECT_STATE.json`](PROJECT_STATE.json) and in each phase's own
specification.

---

## PRE-PHASE-4 GATE — before Party and vocations

### G4.1 — Character deletion lifecycle (`ADR-020`)

The rule is `LOCKED` by the Product Owner (2026-09-24) and recorded in
[`architecture/decisions/ADR-020-character-deletion-grace-and-purge.md`](architecture/decisions/ADR-020-character-deletion-grace-and-purge.md),
which **supersedes** `ADR-007`'s retirement. A deletion request starts a 30-day reversible grace;
when it expires, a hard purge removes the Character and everything it owned, and nothing moves to
the Bank or to a recovery custody.

**Nothing of it is implemented.** The code still carries retirement: `retiredAt`, unique indexes
partial over non-retired rows, name and capacity checks over `retiredAt IS NULL`,
`retireCharacter` (reachable from no route), `ON DELETE RESTRICT` from every Character-owned
table, and a ledger the application role cannot delete from. Phase 3's `RET1`–`RET2` filter is
retirement-specific; it is replaced here, not extended.

Before Phase 4 multiplies the number of Characters in play, all of the following hold, each
proven by a test:

**The lifecycle**

- the 30-day reversible lifecycle — `ACTIVE` → `PENDING_DELETION` → restored or purged — with the
  deadline fixed when the request is accepted, on the server's clock. No command shortens the
  grace, and a repeated request neither extends nor restarts it;
- a request enters the grace only from a quiescent Character — refused while it holds an occupancy
  claim or is in a non-terminal Activity, and, as each system arrives, while it is in the Active
  Party, a lobby or any live escrow or obligation (`ADR-020` §3);
- a `PENDING_DELETION` Character cannot take part in gameplay: every command that would start an
  Activity with it, or move, equip, use, sell or buy its items, touch its Pouch, unlock its slots
  or change its policies, is refused — tested **per command**, not by sample.

**Restoration**

- restoration **before** the deadline returns every Character-owned row exactly as it was —
  progression, Stamina, items and container trees, slots, loot policy, POUCH entries and balance
  — shown by comparing the whole closure before the request and after the restore;
- restoration **at or after** the deadline is refused, whether or not the purge has run, and
  restoration after the purge finds nothing to restore;
- **race tests at the deadline**: restore and purge run concurrently around `purgeAt`, exactly one
  wins, and the result is either the whole Character restored or the whole Character purged.

**The name**

- the name stays reserved throughout `PENDING_DELETION`, and is released **only** by the
  successful atomic purge, in the same commit that removes the Character and its closure. If a
  due purge fails to commit, the name stays reserved until it succeeds — the degraded condition
  below, never a normal state;
- name reuse is tested **only after** a successful purge: a same-name creation is refused before
  it and accepted immediately after it.

**The purge**

- a **purge dependency graph** — a referential-closure inventory of **every** foreign key and
  **every** table that references `Character`, derived from the schema by a test that fails on any
  reference without a declared action (`ADR-020` §6). String-keyed records that embed a Character
  or its Activities' ids — settlement operation ids, idempotency records — are in the same
  inventory;
- an explicit policy for each current `ON DELETE RESTRICT` relation: kept as the guard against
  every path but the purge, which deletes in dependency order, or redesigned. `CASCADE` only
  where everything it can reach is Character-owned;
- **idempotent**: a retry after a crash completes the purge or does nothing. It never destroys
  twice, and never touches another Character or Account;
- **crash-safe**: interrupted at any point, it leaves either the whole Character or none of it —
  never a half-purged Character;
- **no duplication**: nothing Character-owned reaches the Bank, the Depot, the Stash or another
  Character;
- **no collateral deletion**: the Bank balance and every BANK entry, the Depot, the Stash,
  entitlements, roster capacity and every other Character are identical before and after;
- **post-purge proof**: a scan of product persistence — PostgreSQL and Redis — finds the
  Character's id and name in no row, JSON and text columns included;
- the purge runs under its own capability. The application role keeps no `UPDATE` or `DELETE` on
  the ledger;
- **due at the deadline**: at `purgeAt` the Character is due for immediate final purge, and the
  purge job attempts it promptly. No command purges early or postpones a due purge;
- **a failed purge is a monitored, degraded condition** (`ADR-020` §7), proven by a test that makes
  the purge fail after the deadline and shows that the Character stays non-playable,
  non-restorable and name-reserved, that the purge is retried automatically, that the overdue
  Character is visible and alerts, and that the retry then purges it completely and releases the
  name in the same commit;
- **overdue purges are observable**: how many Characters are due but not purged, and how late the
  oldest is. The numeric lateness target is **not** chosen here — it is a pre-launch obligation,
  below.

**Migration**

- `retiredAt`, and every partial-uniqueness assumption derived from it — I1, I1b, the name and
  capacity checks, the `retiredAt: null` access filters — removed or redesigned;
- a migration strategy from the implemented retirement schema: forward-only and additive first,
  with any row that has `retiredAt` set counted, reported and converted as `ADR-020` §9 describes;
- the VERIFIED tests that encode retirement — Phase 0B `D5` and `D6`, Phase 1 `D22`'s retirement
  step and `D24`'s filter, Phase 3 `RET1`–`RET2`, and the `retiredAt` assertion in
  `tests/integration/characters.test.ts` — superseded through explicit matrix amendments, never
  deleted quietly.

**Owner:** Phase 4 builder, before Party formation work — and only once G4.1b is answered.
**Acceptance:** invariant, race and closure tests, not a manual audit.

#### G4.1a — the Gold Pouch at deletion — **RESOLVED** by the Product Owner, 2026-09-24

**No longer open.** The Product Owner decided it as part of the lifecycle:

- during the 30-day grace, the Pouch — its POUCH entries and its balance — stays with the
  Character, intact, so a restore returns it exactly;
- at the final purge, the Character-scoped POUCH value and state are **destroyed** with the
  Character;
- it is **not** transferred to the Bank, and **not** placed in any recovery custody.

The candidates this gate used to list — a transfer to `BANK` with paired entries, an audited
restricted `POUCH`, another custody shape — are all rejected by that decision. What survives of
the old requirement is its integrity half: the destruction happens inside the atomic purge, never
duplicates value into the Bank, and is proven under retry and rollback. Every BANK entry is
untouched; `ADR-020` §6.3 covers the operations that had both a BANK and a POUCH leg.

#### G4.1b — what a pending Character still holds — **OPEN**, Product Owner

The name is `LOCKED`: reserved until the purge. Still undecided — during the 30 days, does a
`PENDING_DELETION` Character:

- count against `rosterCapacity`;
- keep its vocation reserved;
- keep the Origin slot (I1b), if it is the Origin Character;

and therefore, may the player create a replacement before the purge?

Exact restoration constrains the answer. Releasing any of the three early lets a replacement make
the promised restore violate I1, I1b or I2, so the restore would have to be refused — which the
locked rule forbids. **Recommended minimal safe invariant:** all three stay held until the purge.
The consequence to weigh: an account at capacity 1 that deletes its only Character cannot create
another for 30 days, although it can restore it. Detail: `ADR-020` §5 and
[`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) § *Character deletion*.

No implementation may release any of these early, and G4.1's implementation does not start, until
this is answered.

#### G4.1c — tutorial replay and the starting grant after a purge — **OPEN**, Product Owner

Purging an Origin Character frees the Origin slot, so the account can create a new Level-1 Origin
Character. Tutorial completion stays Account-level and is never inferred from counting Characters
(`TUTORIAL_ROOKGAARD_ROADMAP.md` §2), but whether the tutorial is then replayed, offered with a
SKIP, or refused — and whether the starting grant is given again — is undecided. Without a rule,
*delete → purge → recreate* farms the starting grant into the Depot. Carried forward from the
Phase 1 specification's open item and from `design/FUTURE_DIRECTIONS.md`.

**Owner:** Product Owner decision; the Phase 4 builder implements it.

### G4.2 — enforce the `baseXp` → `baseLevel` projection everywhere

**This is NOT an open question, and the gate must not reopen it.** The authority is already
decided and implemented:

| fact | where it is stated |
|---|---|
| **`baseXp` is the durable truth** | `packages/domain/prisma/schema.prisma` — *"DURABLE Base XP … the XP is the truth and the level is its consequence"* |
| **`baseLevel` is a derived projection, stored alongside** so a read need not recompute it | the same comment |
| the projection functions | `packages/domain/src/contexts/hunt/progression.ts` — `levelForXp`, `xpForLevel` |
| reward and death settlement already use them | `contexts/hunt/run.ts`, `contexts/hunt/death.ts` |

The Character row therefore holds two numbers that must agree, and two numbers that must agree
are two numbers that can drift. The gate is to **prove and enforce the established contract**, not
to choose again:

- every write path that touches `baseXp` also writes `baseLevel = levelForXp(baseXp)` — reward
  settlement, death loss, any future XP source, and any migration or backfill;
- the deletion lifecycle (G4.1) writes neither number: a restore returns both exactly as stored,
  and the purge removes both with the Character;
- a settlement that rolls back rolls back **both**, so no partial write can leave them disagreeing;
- the projection holds across the curve including its boundaries, in both directions.

If any legacy or migrated row is found contradicting the contract, **document that row and its
origin explicitly** and reconcile it to the contract. Do not infer a different rule from it.

**Owner:** Phase 4 builder.
**Acceptance:** a projection test over the curve, a per-write-path test, and an invariant that the
pair never diverges. **None of this is written yet** — the gate is a requirement, not a record.

### G4.3 — An Actor / Participant combat contract

Phase 4 introduces up to 4 same-account actors. Phase 5B introduces participants from several
accounts. The contract written now must support both **without** building a multiplayer platform
yet.

- combat actor identity is its **own** concept. It is not the account id, and it is not one
  hard-coded Character;
- the contract admits several actors per side, and admits participants whose owning accounts
  differ, even though nothing yet creates that case;
- **compatibility adapters** keep previously VERIFIED Hunt behaviour and its fixtures intact. A
  single-Character Hunt must produce the same results, from the same seeds, as it does today;
- `Actor`, `Target` and `Side` stay neutral — the guardrail already recorded in
  [`design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md) §4.

**Explicitly not in scope:** lobbies, invitations, cross-account anything.

**Owner:** Phase 4 architect.
**Acceptance:** existing Hunt fixtures pass unchanged through the adapter, plus a contract test
showing a multi-actor side is representable.

---

## PRE-5B GATE — before two accounts share one Activity

### G5B.1 — Multi-account Activity membership invariants

The Character→membership invariant and competitive liveness semantics must exist before any
shared run. The design is in
[`design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md);
the invariants are the gate.

- per-Character occupancy still holds when the Activity spans accounts;
- one shared run identity, and membership that cannot silently fork;
- liveness rules stated per participant;
- Character deletion across accounts (`ADR-020` §6.2): a Character in a lobby or a frozen plan
  cannot be put up for deletion, and when a participant is later purged, the other accounts keep
  their own results while no shared record names the purged Character.

### G5B.2 — Cross-account disconnect, decided separately

**A one-account Party pauses on disconnect because one session owns all of it.** That reasoning
does not transfer.

Cross-account disconnect behaviour is a **separate product decision**, separately tested. One
player's disconnect must **not** automatically pause everybody unless that specific rule is
approved on its own merits. Until it is decided, no shared quest ships.

### G5B.3 — Reward ledger safety across accounts

A shared run pays several accounts. Before the first one runs:

- no double-pay and no lost payout under retry, rollback or partial failure;
- settlement is per account and auditable;
- spectator-only reads cannot claim, influence or alter any of it.

**Owner:** Phase 5B slice 1.
**Acceptance:** concurrency and idempotency tests at the account boundary.

---

## PRE-MARKET GATE — before Market, Forge or Imbuement

### G6.1 — Minimum cross-account settlement, early

The **minimum** multi-account reward and penalty settlement must be implemented and proven before
the first Phase 5B shared quest — it does not wait for the full Market. See G5B.3; this gate is
the statement that the dependency runs the other way round from the phase numbers.

### G6.2 — Definition versioning

An ADR for `ItemDefinition` version semantics: what happens to live `ItemInstance` rows when a
definition's weight, stackability or slot changes in a new bundle. An Activity pins its bundle; a
traded or forged item outlives one Activity.

### G6.3 — Rarity and affix validation

Impossible rarity/affix identities must be rejected at the boundary. Today an affix array is JSON
the domain writes and trusts; a market lets someone else's row reach your inventory.

### G6.4 — Deletion meets escrow

Every Market, Forge and Imbuement table that references a Character declares its purge action
before it ships (`ADR-020` §6.2): a live listing, escrow, trade or forge input **refuses** a
deletion request, and completed trades keep the counterparty's facts — price, item definition,
time, its own side — without naming the purged Character.

**Owner:** Phase 6, before any market, forge or imbuement surface exists.

---

## PRE-LAUNCH GATE — and what must NOT wait for it

Phase 10 owns scale and hardening. It does **not** own everything risky.

> **Security, retry/idempotency, economy correctness and realistic load tests happen at the phase
> that introduces their risk — never all postponed to Phase 10.**

A phase that introduces a new way to lose money, duplicate an item or admit an untrusted actor
carries that phase's hardening with it. What Phase 10 owns is the work that genuinely cannot be
done earlier: whole-system load profiling, backup and restore rehearsal, retention and
compaction, anti-abuse at real traffic, and support tooling.

Carried from [`design/FUTURE_DIRECTIONS.md`](design/FUTURE_DIRECTIONS.md) § *Before beta /
scale*: `IdempotencyRecord` retention, `SettlementOperation` retention with a compaction proof,
content bundle archival, an object-storage provider, production rate limiting and auth hardening.

Character deletion (`ADR-020`) adds one obligation and two `OPEN` operational questions here,
tracked in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) § *Character deletion*:

- **before production**, choose a measurable **purge lateness target** — how long after `purgeAt`
  a due purge may take before it counts as a breach — and alert on it. G4.1 requires overdue
  purges to be retried and observable; only the number is left to this gate, and nothing earlier
  invents it;
- how long **backups and logs** may keep a purged Character;
- what the purge job does after a **restore from backup**, which brings back Characters purged
  after the backup point and loses deletion requests and restores made after it.

The purge's own obligations — idempotency and settlement records that name the Character
included — are **not** deferred to this gate: they belong to G4.1.

---

## Operational gate — integration, not accumulation

- **Do not endlessly stack open pull requests.** Accepted PRs are integrated in order, with the
  Product Owner's authorization, and CI is verified on the **actual integration base** rather than
  on a branch's own stale base.
- **Every `VERIFIED` status applies to a named reviewed commit**, never to a branch head that
  keeps moving. A verification record names the SHA it verified.
- A docs or design PR never advances `activePhase` and never marks a phase `VERIFIED`.
