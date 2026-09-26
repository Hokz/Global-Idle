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

**There is no Phase 3.8.** Phase 3.7 is the last VERIFIED phase, and this gate comes next, then
Phase 4. Its next work product is the **PRE-PHASE-4 specification**, and the product decisions it
depends on are made (2026-09-25). What remains is to specify and implement the decided rules and
contracts, with independent validation: G4.1 to G4.5 below.

**Phase 4A — Playable Beta Slice / Creator Preview is not a gate.** It is a mandatory playable
milestone inside the Phase 4 program, after the Phase 4 foundation
([`design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md`](design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md)).
It adds nothing to this gate, and this gate is unchanged by it.

### G4.1 — Game Account deletion lifecycle (`ADR-024`, reusing `ADR-020`)

The rule is `LOCKED` by the Product Owner — on 2026-09-24, amended on 2026-09-25, and given its
current target in the final 2026-09-25 synchronization. It is recorded in
[`architecture/decisions/ADR-024-game-account-deletion-grace-and-purge.md`](architecture/decisions/ADR-024-game-account-deletion-grace-and-purge.md).
That record reuses the lifecycle mechanics of
[`ADR-020`](architecture/decisions/ADR-020-character-deletion-grace-and-purge.md), which
superseded `ADR-007`'s retirement. A deletion request puts the **whole Game Account** into a
reversible grace of exactly 720 elapsed hours, fully frozen. When it expires, a hard purge removes
all live Game Account state: the Main, every Companion, and everything the Game Account owns,
its Bank, Depot and Stash included. Nothing moves to another Game Account or to the Login, and the
Login survives. An internal history record remains; there is no public Deleted List. One lifecycle
serves every deletion source.

**Nothing of it is implemented.** The code still carries retirement: `retiredAt`, unique indexes
partial over non-retired rows, name and capacity checks over `retiredAt IS NULL`,
`retireCharacter` (reachable from no route), `ON DELETE RESTRICT` from every Character-owned
table, a ledger the application role cannot delete from, and an `AuthIdentity` that cannot outlive
its Account row. Phase 3's `RET1`–`RET2` filter is retirement-specific; it is replaced here, not
extended.

Before Phase 4 adds companions and the Active Party, all of the following hold, each proven by a
test:

**The lifecycle**

- the reversible lifecycle — `ACTIVE` → `PENDING_DELETION` → restored or purged — on the **Game
  Account**, with the deadline fixed when the request is accepted, on the server's clock:
  `purgeAt` is stored, exactly 720 elapsed hours after the accepted request, with no time-zone or
  calendar-day semantics (T1). No command shortens the grace, and a repeated request neither
  extends nor restarts it;
- **one lifecycle for every deletion source**: no command — the player's, an operator's or a
  moderation tool's — purges early, skips the grace or bypasses the purge (GD9–GD10);
- a request enters the grace only from a quiescent Game Account. It is refused while any of its
  actors holds an occupancy claim or is in a non-terminal Activity. As each system arrives, it is
  also refused while an actor is in a lobby or a frozen plan, or while the Game Account is party to
  any live escrow or obligation. Configured Active Party membership does not block it (`ADR-024`
  §2);
- **the whole Game Account is frozen.** Every command that would start an Activity with any of its
  actors, move, equip, use, sell or buy an item, touch a Pouch or the Bank, unlock a slot or a
  companion, create a Character or change a policy is refused — tested **per command**, not by
  sample. No command names the Game Account or one of its actors as a destination or counterparty;
- **the freeze includes time** (FZ1–FZ2): the request copies nothing — the same persisted Game
  Account is marked `PENDING_DELETION` — and nothing time-derived accrues to it. Each Character's
  Stamina is settled up to the accepted request and then recovers nothing; no read or view settles
  a pending Game Account; and no other elapsed-time recovery runs — tested by letting time pass
  across the grace and comparing every Game-Account-owned value, derived ones included;
- **other Game Accounts are untouched**: another Game Account of the same Login keeps playing
  throughout, and its state is identical before and after the first one's request, restore or
  purge.

**Restoration**

- restoration **before** the deadline returns every Game-Account-owned row exactly as it was —
  its Characters, progression, Stamina, items and container trees, slots, loot policies, Pouches,
  Bank, Depot, Stash and ledger — shown by comparing the whole closure before the request and
  after the restore;
- **no catch-up** (FZ3): a restore credits nothing for the pending time. Immediately after it,
  Stamina and every other time-derived value equal their values at the accepted request, and
  recovery resumes from the restore instant;
- restoration **at or after** the deadline is refused, whether or not the purge has run, and
  restoration after the purge finds nothing to restore;
- **race tests at the deadline**: restore and purge run concurrently around `purgeAt`, exactly one
  wins, and the result is either the whole Game Account restored or the whole Game Account purged.

**Names** — with G4.4

- every Character name of a pending Game Account stays **globally** reserved throughout
  `PENDING_DELETION`, and is released **only** by the successful atomic purge, in the same commit
  that removes the Game Account. If a due purge fails to commit, the names stay reserved until it
  succeeds — the degraded condition below, never a normal state (NM2);
- name reuse is tested **only after** a successful purge: a same-name creation in **another** Game
  Account is refused before it and accepted immediately after it — with the internal history
  record present, because a historical record never reserves a name (NM3).

**The Login** (`ADR-024` §5)

- the Login is represented apart from the Game Account before the purge ships. After a purge the
  Login still signs in, its credentials are intact, and its other Game Accounts are identical;
- the PRE-4 specification states how a Login left with no Game Account starts a new one (`ADR-022`
  GA-O10), and that path is tested.

**No replacement and no carry-over**

- nothing creates a replacement Main, or any Character, inside a pending or purged Game Account
  (GD7);
- nothing of a purged Game Account reaches another Game Account or the Login — tested with a Login
  that holds two Game Accounts (GD6);
- a Companion leaves only with its Game Account. PRE-4 adds no command that deletes, dismisses,
  removes, replaces, rerolls or converts one, and Phase 4 adds none when companions arrive (GD8,
  `ADR-022` GA11).

**The purge**

- a **purge dependency graph** — a referential-closure inventory of **every** foreign key and
  **every** table that references the Game Account row or one of its Characters, derived from the
  schema by a test that fails on any reference without a declared action (`ADR-024` §3).
  String-keyed records that embed their ids or their Activities' ids — settlement operation ids,
  idempotency records — are in the same inventory;
- an explicit policy for each current `ON DELETE RESTRICT` relation: kept as the guard against
  every path but the purge, which deletes in dependency order, or redesigned. `CASCADE` only where
  everything it can reach belongs to the Game Account being purged;
- **idempotent**: a retry after a crash completes the purge or does nothing. It never destroys
  twice, and never touches another Game Account;
- **crash-safe**: interrupted at any point, it leaves either the whole Game Account or none of it —
  never a half-purged one;
- **no duplication**: nothing the Game Account owned reaches another Game Account or the Login;
- **no collateral deletion**: the Login and every other Game Account — the same Login's included —
  are identical before and after;
- **post-purge proof**: a scan of **live** product persistence — PostgreSQL and Redis — finds the
  Game Account's id, its Characters' ids and their names in no row, JSON and text columns included.
  The internal history record is the one declared exception: the scan knows where it is, and
  proves that nothing else names them (HR5);
- **the internal history record** (HR2–HR5): the purge writes it within the same final boundary,
  so that no purge commits without its record and no record exists for a purge that did not
  commit. Tests show that it holds at most HR3's fields, is written once under retry, cannot be
  updated or deleted by the application role, restores nothing, reserves no name and holds no
  ownership, custody, claim or uniqueness state;
- **no public Deleted List** (HR1): no route, view or export shows the record outside support;
- **no destroyed-value inventory is required** (HR4). Completeness is proven by the closure test
  and the post-purge scan. **PRE-4 builds no general telemetry**: XP, Hunt, loot and item-flow
  analytics are a game-wide direction that each gameplay or economy phase records for what it
  introduces (`ADR-020` DH6);
- **no damage to existing audit or analytics data**: a purge changes no durable audit or analytics
  record that it does not own — tested beside *no collateral deletion*, above;
- **a closure that can follow a binding**: nothing in the purge assumes that Character-owned
  `ItemInstance` rows are found by `characterId` alone, so a future bound item stored in the Depot
  joins the closure test without a redesign. PRE-4 implements no bound item unless the PRE-PHASE-4
  specification schedules the tutorial potions there (`ADR-024` DEL-O5), behind GBC.1;
- the purge runs under its own capability. The application role keeps no `UPDATE` or `DELETE` on
  the ledger. Whether the Game Account's ledger entries leave the ledger or stay as immutable
  history outside live state is the PRE-4 specification's choice (`ADR-024` §3);
- **due at the deadline**: at `purgeAt` the Game Account is due for immediate final purge, and the
  purge job attempts it promptly. No command purges early or postpones a due purge;
- **a failed purge is a monitored, degraded condition** (`ADR-020` §7), proven by a test that
  makes the purge fail after the deadline. The Game Account stays non-playable, non-restorable and
  name-reserving; the purge is retried automatically; the overdue Game Account is visible and
  alerts; and the retry then purges it completely and releases the names in the same commit;
- **overdue purges are observable**: how many Game Accounts are due but not purged, and how late
  the oldest is. The numeric lateness target is **not** chosen here — it is a pre-launch
  obligation, below.

**Migration**

- `retiredAt`, and every partial-uniqueness assumption derived from it, removed: I1 and I1b and
  the capacity check rebuilt over every existing Character, and the `retiredAt: null` access
  filters made lifecycle-aware on the Game Account's lifecycle. Names move to G4.4's global rule;
- a migration strategy from the implemented retirement schema: forward-only and additive first.
  Any row that has `retiredAt` set is counted and reported, and the PRE-4 specification restates
  its conversion, because a Character no longer has a deletion state of its own (`ADR-020` §9);
- the VERIFIED tests that encode retirement — Phase 0B `D5` and `D6`, Phase 1 `D22`'s retirement
  step and `D24`'s filter, Phase 3 `RET1`–`RET2`, and the `retiredAt` assertion in
  `tests/integration/characters.test.ts` — superseded through explicit matrix amendments, never
  deleted quietly.

**Owner:** Phase 4 builder, before Party formation work, against the PRE-PHASE-4 specification.
The product questions this gate once named are all decided. What still awaits a decision is small
and listed in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) § *Game Account deletion*. The moderation
authority (DEL-O3) belongs to the phase that builds moderation tooling. The PRE-PHASE-4
specification decides when the tutorial potions become bound (DEL-O5) and the history record's
exact fields.
**Acceptance:** invariant, race and closure tests, not a manual audit.

#### G4.1a — the Gold Pouch at deletion — **RESOLVED** by the Product Owner, 2026-09-24

**No longer open**, and carried into the Game Account purge. During the grace the Pouch — its
entries and its balance — stays intact, so a restore returns it exactly. At the purge its live
state is **destroyed**. It is never transferred to a bank or placed in a recovery custody. Since
2026-09-25 the purge takes the whole Game Account, so the Bank goes with it, and nothing reaches
another Game Account or the Login (`ADR-024` GD5–GD6). The candidates this gate once listed — a
transfer to `BANK`, an audited restricted `POUCH`, another custody shape — stay rejected. What
survives of the old requirement is its integrity half: destruction happens inside the atomic
purge and is proven under retry and rollback. `ADR-020` §6.3's surviving BANK legs are
superseded: both legs of an operation within one Game Account go together.

#### G4.1b — what a pending Character still holds — **SUPERSEDED** 2026-09-25

Decided by the Product Owner on 2026-09-24: a `PENDING_DELETION` Character kept its vocation, its
roster place and — as the Origin Character — the Origin slot until its purge, so that no
replacement could take them and a restore could never conflict. Recorded in `ADR-020` §5.

**Superseded by `ADR-024`.** The whole Game Account is frozen, and nothing inside it can be created
or replaced (GD4, GD7). Its Character names are reserved across the whole game until the purge
(NM2). A restore therefore cannot conflict, and these holds have nothing left to protect.

#### G4.1c — tutorial completion and one-time grants after a purge — **SUPERSEDED** 2026-09-25

Decided by the Product Owner on 2026-09-24, recorded in `ADR-020` §5.1–§5.2. Tutorial completion
belonged to the Account and survived the purge of its Origin Character. A Character created after
that purge followed the later-character flow, and no one-time grant was awarded twice. An Origin
Character purged before Rookgaard was complete was replaced by a new Level-1 Origin Character with
a fresh, non-exploitable **Bootstrap Kit**.

**Superseded by `ADR-024`.** No Character is purged while its Game Account lives on. Tutorial
completion and one-time reward claims are Game Account state, and go with it (GD5). A new campaign
is a new Game Account, which starts in Rookgaard with claims of its own (GD7, `ADR-022` RK3). There
is no replacement Origin Character. The Bootstrap Kit is retired: the starter gear is ordinary
items, and the tutorial potions are Character-bound consumables under `ADR-021`
([`DECISIONS.md`](DECISIONS.md) § *Tutorial starting items*). They are no longer deletion
requirements. The Game Account's tutorial-completion state is built by the phase that builds the
tutorial state, and one-time claims by the reward-claim primitive (Phase 5, `ADR-023`). The purge
removes both with the rest.

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
  and the purge removes both with the Character. The internal history record's levels are copies
  taken from the frozen pairs — history, never a second live projection;
- a settlement that rolls back rolls back **both**, so no partial write can leave them disagreeing;
- the projection holds across the curve including its boundaries, in both directions.

**Confirmed by the Product Owner, 2026-09-25** (`DECISIONS.md` § *Base XP and Base Level*):
`baseXp` is the truth and `baseLevel` its deterministic stored projection. PRE-4 must prove:

- XP is authoritative;
- the level is a deterministic projection of it;
- every XP write path syncs the level atomically;
- a rollback updates both or neither;
- migrations and backfills preserve the invariant.

The curve is Canary's reference, `getExpForLevel(level) = (((level - 6) * level + 17) * level - 12)
/ 6 * 100`, which Phase 2 implemented. Global Idle need not adopt that exact curve unless it is
separately locked. If a later decision changes the curve, the change is a migration that
recomputes every stored `baseLevel` from its `baseXp` — the invariant above, applied once more.

If any legacy or migrated row is found contradicting the contract, **document that row and its
origin explicitly** and reconcile it to the contract. Do not infer a different rule from it.

**Owner:** Phase 4 builder.
**Acceptance:** a projection test over the curve, a per-write-path test, and an invariant that the
pair never diverges. **None of this is written yet** — the gate is a requirement, not a record.

### G4.3 — An Actor / Participant combat contract

Phase 4 introduces up to 4 same-account actors: the Main and up to three companions (`ADR-022`
PP2). Phase 5B introduces participants from several accounts — **one selected actor per Game
Account**, its Main or any unlocked companion (MP2–MP4). The contract written now must support
both **without** building a multiplayer platform yet.

**Confirmed by the Product Owner, 2026-09-25.** The contract supports three shapes:

| Where | Actors |
|---|---|
| Rookgaard | **one** actor: the Main alone, vocationless and single-player (`ADR-022` RK2–RK3) |
| the Main game | the Main plus up to three Companions |
| later co-op | **exactly one** actor per Game Account — its Main or any Companion |

- combat actor identity is its **own** concept. The engine must not assume that an actor is the
  Login, the Game Account or the Main. It is not the account id, it is not one hard-coded
  Character, and it is not *"the Main"*: a companion is an actor too, and in multiplayer the Main
  is not mandatory (MP3);
- **settlement still knows the owning Game Account** of every actor, because rewards, claims and
  custody are Game Account state (`ADR-023` QR9);
- the contract admits several actors per side, and admits participants whose owning accounts
  differ, even though nothing yet creates that case;
- **compatibility adapters** keep previously VERIFIED Hunt behaviour and its fixtures intact. A
  single-Character Hunt must produce the same results, from the same seeds, as it does today;
- `Actor`, `Target` and `Side` stay neutral — the guardrail already recorded in
  [`design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md) §4.

**Explicitly not in scope:** lobbies, invitations, cross-account anything — no multiplayer
networking or lobby in PRE-4.

**Owner:** Phase 4 architect.
**Acceptance:** existing Hunt fixtures pass unchanged through the adapter, plus a contract test
showing a multi-actor side is representable.

### G4.4 — Globally unique Character names (`ADR-024` NM1–NM5)

`LOCKED` by the Product Owner, 2026-09-25. Character names are unique across the **entire game
and database**. This supersedes the per-Game-Account uniqueness Phase 1 implemented, which
`createCharacter` checks in application code, among one Account's playable Characters only.

- uniqueness is enforced at persistence level over **every existing Character**, a pending Game
  Account's included — a uniqueness guarantee, never a read-then-check alone — and two concurrent
  creations of the same name in two Game Accounts cannot both succeed;
- a pending Game Account's Character names stay reserved until its purge commits (G4.1), and the
  internal history record never reserves one;
- the PRE-4 specification states the comparison the rule uses — today names are trimmed and
  compared exactly — and how rows that already collide across Game Accounts are found and resolved
  before the constraint is added;
- Game Account display names are a separate namespace, untouched by this rule. Whether they must
  be unique is `ADR-022` GA-O11.

**Owner:** the PRE-PHASE-4 specification and implementation.
**Acceptance:** a persistence-level constraint, a concurrent-creation race test, and the
reservation tests of G4.1.

### G4.5 — The tunable configuration surface (`ADR-025`)

`LOCKED` direction, Product Owner, 2026-09-25. PROVISIONAL and TUNABLE defaults live in one
authoritative server-side configuration surface — the purpose Canary's `config.lua` and its stages
serve, though not necessarily Lua. Before Phase 4 adds its tunable values — companion unlock prices
and Shared XP bonuses among them — the surface exists, with:

- validated types and ranges, refused on load rather than clamped at use;
- versioned and traceable values, pinned for a running Activity as its content version is, so that
  no change alters a run in flight;
- server authority: no client input sets or overrides a value;
- safe defaults;
- test fixtures that pin the defaults they rely on.

Never configuration: ownership, the Login–Game Account relation, Main and Companion identity,
exactly-once claims, global name uniqueness, binding integrity, the atomic deletion and purge
guarantees, transaction semantics and security or authority boundaries (`ADR-025` NC1–NC9).

**Owner:** the PRE-PHASE-4 specification, which defines the surface's first form and what happens
to the values already marked `INITIAL/TUNABLE` in code and content.
**Acceptance:** validation, versioning and pinning tests, and a test that no NC item is reachable
as configuration.

---

## PRE-5B GATE — before two accounts share one Activity

### G5B.1 — Multi-account Activity membership invariants

The Character→membership invariant and competitive liveness semantics must exist before any
shared run. The design is in
[`design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md);
the invariants are the gate.

- **exactly one selected actor per participating Game Account** — its Main or any unlocked
  companion — and never a personal Active Party as a block (`ADR-022` MP2–MP4). Changing the
  selected actor creates no new account, reward entitlement or completion identity (MP5);
- per-Character occupancy still holds when the Activity spans accounts — for a companion, as
  Phase 4 specifies it (`ADR-022` GA-O5);
- one shared run identity, and membership that cannot silently fork;
- liveness rules stated per participant;
- Game Account deletion across accounts (`ADR-024` §3): a Game Account with an actor in a lobby
  or a frozen plan cannot be put up for deletion. When a participating Game Account is later
  purged, the others keep their own results, and no **live** shared record names the purged Game
  Account or its Characters. Whether the completed run's history keeps a name is the phase's
  declaration: SCRUB, or immutable history within HR5.

### G5B.2 — Cross-account disconnect, decided separately

**A one-account Party pauses on disconnect because one session owns all of it.** That reasoning
does not transfer.

Cross-account disconnect behaviour is a **separate product decision**, separately tested. One
player's disconnect must **not** automatically pause everybody unless that specific rule is
approved on its own merits. Until it is decided, no shared quest ships.

### G5B.3 — Reward ledger safety across accounts

A shared run pays several accounts. Before the first one runs:

- no double-pay and no lost payout under retry, rollback or partial failure;
- settlement is per Game Account and auditable;
- a **one-time reward** is claimed at most once per Game Account, whichever actor it selected, and
  replaying the quest never re-enables it (`ADR-023` QR3–QR6). The claim is the Game Account's —
  never the actor's or the Login's — and each Game Account of one Login claims for itself (QR9). A
  retried or concurrent claim grants at most once;
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

Every Market, Forge and Imbuement table that references a Game Account or a Character declares
its purge action before it ships (`ADR-024` §3): a live listing, escrow, trade or forge input
**refuses** a deletion request, and completed trades keep the counterparty's facts — price, item
definition, time, its own side. Whether the purged Game Account stays named there is the phase's
declaration: SCRUB, or immutable history within `ADR-024` HR5, which never lets it own or hold
anything. An operation that spans two Game Accounts keeps the survivor's leg, and this phase
restates the leg-balance check for it.

A Character-bound consumable is never listed on either Market, escrowed, traded, gifted, mailed,
sold to an NPC or used as a Forge input (`ADR-021`, gate GBC.1 below). The tutorial's starter gear
is ordinary items (`DECISIONS.md` § *Tutorial starting items*); the Bootstrap Kit restriction that
stood here until 2026-09-25 is retired with the kit.

**Multi-account farming.** One-time reward claims are per Game Account, and one Login may own
several. Whether, and how, a tradeable one-time reward farmed across several Game Accounts is
limited is **open** for this phase, before player trade ships (`OPEN_QUESTIONS.md` § *Market*).

**Owner:** Phase 6, before any market, forge or imbuement surface exists.

---

## BOUND-CONSUMABLE GATE — before the first Character-bound consumable ships

### GBC.1 — Character-bound consumables and the Store Container (`ADR-021`)

The rule is `LOCKED` by the Product Owner (2026-09-24) and recorded in
[`architecture/decisions/ADR-021-character-bound-consumables-and-store-container.md`](architecture/decisions/ADR-021-character-bound-consumables-and-store-container.md).
**Nothing of it is implemented**: there is no Store Container, no binding and no bound item.

This gate belongs to **no fixed phase**. Phase 8 (Premium) is the obvious first consumer, but a
Daily Reward or an Event may introduce a Character-bound consumable earlier — and since 2026-09-25
so may the tutorial, whose Health and Mana potions are Character-bound consumables (`ADR-021`
S6–S7). How a Hunt uses them is decided: a configured action slot consumes an eligible bound potion
straight from the Store Container (`ADR-021` U5). Which phase first issues them as bound instances
— PRE-4, or the phase that builds the action slots — is open (`ADR-024` DEL-O5), for the
PRE-PHASE-4 specification. Whichever phase ships the first bound item implements this foundation
**first**. No bound item — Store, Daily Reward, Event or tutorial — ships before all of the
following hold, each proven by a test:

- the binding survives `STORE_CONTAINER` → `DEPOT` → `STORE_CONTAINER`;
- another Character on the same Account — a Companion of the same Game Account included — cannot
  use or move the bound item;
- a Market listing fails, on either Market;
- player trade, gift and mail fail;
- an NPC sale fails;
- a move to the Stash fails;
- a move into a Forge input fails;
- no currency or value conversion path exists;
- a bound item can be used only by its own Character;
- a Character of a `PENDING_DELETION` Game Account cannot move, use or receive bound items;
- a restore preserves every bound item exactly;
- the purge deletes the Store Container's contents;
- the purge also deletes bound items stored in the Depot;
- a purge of one Game Account deletes nothing of another Game Account's, bound or unbound. *(Until
  2026-09-25 this read "ordinary unbound Depot items survive that same purge". Since `ADR-024` the
  purge takes the whole Game Account, its Depot included);*
- no orphaned `boundCharacterId` remains after a purge;
- a repeated or retried purge cannot delete another Game Account's items;
- a binding is never encoded through Canary's `UNIQUEID` or `ACTIONID` (`ADR-021` B6);
- an action slot consumes only an eligible potion bound to its own Character (`ADR-021` U5);
- a concurrent Depot move and a deletion request or purge are safely serialised;
- if bound items are stackable, a split or merge never changes the binding.

Every restriction is enforced on the server; a hidden button is never the test. The binding is
referentially safe — it can never name a Character that does not exist — and the `ADR-020` closure
test and reference inventory can enumerate it, a bound item in the Depot included. It declares its
purge action before it ships. Its physical representation, like the Store Container's, is the
implementing phase's choice (`ADR-021` §3, §7).

**Owner:** the first phase that introduces a Character-bound consumable.
**Acceptance:** the tests above, not a manual audit.

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

Game Account deletion (`ADR-024`) adds one obligation and three `OPEN` operational questions
here, tracked in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) § *Game Account deletion*:

- **before production**, choose a measurable **purge lateness target** — how long after `purgeAt`
  a due purge may take before it counts as a breach — and alert on it. G4.1 requires overdue
  purges to be retried and observable; only the number is left to this gate, and nothing earlier
  invents it;
- how long **backups and logs** may keep a purged Game Account;
- how long the **internal history records** are retained, and who in support may read them — they
  keep names (HR3). There is no public list to retain (HR1);
- what the purge job does after a **restore from backup**, which brings back Game Accounts purged
  after the backup point and loses deletion requests and restores made after it.

The purge's own obligations — idempotency and settlement records that name the Game Account or its
Characters included — are **not** deferred to this gate: they belong to G4.1.

---

## Operational gate — integration, not accumulation

- **Do not endlessly stack open pull requests.** Accepted PRs are integrated in order, with the
  Product Owner's authorization, and CI is verified on the **actual integration base** rather than
  on a branch's own stale base.
- **Every `VERIFIED` status applies to a named reviewed commit**, never to a branch head that
  keeps moving. A verification record names the SHA it verified.
- A docs or design PR never advances `activePhase` and never marks a phase `VERIFIED`.
