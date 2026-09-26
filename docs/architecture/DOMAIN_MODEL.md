# Global Idle — Domain Model

**Document status:** `PHASE_0A_COMPLETE` / `ARCHITECTURE_APPROVED`
**Phase:** 0A.1 — Domain Architecture
**Scope:** Core domain concepts, ownership boundaries, lifecycles and invariants.
**Non-scope:** Database tables, ORM schemas, API shapes, service decomposition, transport. Those belong to 0A.2–0A.8 and to Phase 0B.

---

## 1. How to read this document

This document answers four questions for every concept in the game:

1. **What is it for?**
2. **Who owns it?** — exactly one context is authoritative for each piece of state.
3. **When does it change, and what must be true before and after?**
4. **Is it durable truth, derived, or ephemeral?**

It deliberately does **not** decide storage. A domain concept is not a table. Several concepts
here will end up as columns, projections, or nothing at all in the physical model.

Every decision is tagged:

| Tag | Meaning |
|---|---|
| `LOCKED BY PRODUCT` | Already decided in `docs/DECISIONS.md` or a `docs/design/*` foundation. Architecture must conform. |
| `DECIDED IN PHASE 0A` | Decided here under the Phase 0A delegation. Defensible, applied consistently, subject to independent review. |
| `DEFERRED` | Real question, but it belongs to a later work package or to Phase 0B. |
| `DEFERRED PARAMETER` | A balance or monetization value. It is a configuration input; no boundary, interface or invariant depends on it. |

---

## 2. Three decisions that shape everything else

Most of this document follows from three choices. They are stated once here and applied
throughout.

### 2.1 Content is not state

`LOCKED BY PRODUCT` — `AGENTS.md` §5: *"Keep game data separate from engine logic."*

Two kinds of thing look similar and behave nothing alike:

| | **Content definition** | **Domain state** |
|---|---|---|
| Examples | Creature, BaseItem, Loot Table, Hunt, Room, World Location | Character, ItemInstance, Activity, Ledger entry |
| Authored by | the team, at build/deploy time | the game, at runtime |
| Mutated by | a deployment | a transaction |
| Identity | human-readable canonical key (`creature.rat`) | opaque surrogate |
| Versioning | the content set is versioned as a whole | per-row, per-entity |
| Player-specific | never | always |

`DECIDED IN PHASE 0A` — **content definitions are immutable at runtime.** Nothing in the
running system writes to a creature, a base item, a loot table or a hunt. Changing content is
a deployment, not a mutation. This is what makes the simulation reproducible: replaying an
activity needs only its inputs plus the content version.

Consequence: every runtime reference from state to content is a **key plus a content version**,
never an embedded copy and never a foreign key that could be edited underneath it.

### 2.2 In-flight activity state is activity-scoped, not character-scoped

`DECIDED IN PHASE 0A` — see `ADR-002`.

While a Hunt runs, the simulation produces XP, gold, loot, supply consumption and room
progression every tick. Two models were available:

- **(a) Write through.** Each tick mutates Character XP, Inventory and the currency ledger.
- **(b) Accumulate and settle.** The Activity owns an authoritative accumulator; it is folded
  into durable Character and Economy state at defined commit points.

**(b) is chosen.** The decisive reason is not performance, it is the reconnect policy:

> `LOCKED BY PRODUCT` — *"nothing progresses while paused: no XP, loot, gold, room progression
> or supply consumption"*

Under (a) that guarantee is distributed across every write path in the system and can only be
upheld by discipline. Under (b) it is one state transition on one aggregate, and it is
checkable in one place. The same structure delivers a second product rule for free:

> `LOCKED BY PRODUCT` — *"Room progress is not persistent between separate Hunt sessions."*

Room progress lives in the Activity. The Activity ends, the progress is gone. The rule is not
enforced — it is structural.

### 2.3 Value cannot exist in two places at once

`DECIDED IN PHASE 0A` — see `ADR-003` and `ADR-004`.

Two invariants carry the entire economy:

- an `ItemInstance` is in **exactly one custody scope** at any instant;
- a currency balance is a **projection of an append-only ledger**, never an independently
  writable number.

Everything in §7 is an application of these two sentences.

---

## 3. Bounded contexts

Seven contexts. Each owns its state exclusively; cross-context reads go through published
identifiers, never through reaching into another context's internals.

```text
┌─ IDENTITY & ACCESS ──────────┐   ┌─ CONTENT (read-only at runtime) ─┐
│  Account                     │   │  BaseItem                        │
│  Session                     │   │  CreatureDefinition              │
│  Entitlement                 │   │  LootTable                       │
└──────────────┬───────────────┘   │  WorldLocation / Atlas           │
               │                   │  HuntDefinition                  │
               │                   │  DungeonDefinition               │
               │                   └──────────────┬───────────────────┘
               │                                  │ read
       ┌───────▼────────────┐                     │
       │  CHARACTER         │                     │
       │   Character        │◄────────────────────┤
       │   Roster + capacity│                     │
       │   Progression      │                     │
       │   Skills           │                     │
       └───────┬────────────┘                     │
               │                                  │
       ┌───────▼────────────┐             ┌───────▼───────────┐
       │  PARTY             │             │  ACTIVITY         │
       │   Active Party     │────────────►│   HuntActivity    │
       │   (ordered ≤4)     │  snapshot   │   DungeonActivity │
       └────────────────────┘             │   SkillTraining   │
                                          └───────┬───────────┘
                                                  │ settlement
                    ┌─────────────────────────────┴──────────────┐
                    │                                            │
            ┌───────▼────────┐                          ┌────────▼───────┐
            │  ITEMS         │                          │  ECONOMY       │
            │   ItemInstance │◄────── escrow ──────────►│   Ledger       │
            │   Inventory    │                          │   Balances     │
            │   Equipment    │                          │   MarketListing│
            └────────────────┘                          └────────────────┘
```

**Direction of authority.** Activity reads Character and Content; it never writes Character
directly — it settles. Party reads Character; it never writes it. Economy is written only
through the ledger. Content is written only by deployment.

*Read since 2026-09-25 (`ADR-022`):* **Account** in this diagram and throughout this document is
the **Game Account** — one campaign. A login identity sits above it and may hold one or more Game
Accounts (§5.18). The Character context's roster is the Game Account's one **Main Character** and
its **companions**, and the personal Active Party is the Main plus up to three companions. How the
login identity and companions are represented is the owning phase's choice, not this document's.
Since the final synchronization the **Game Account** is also the deletion unit, and the Login
survives it (`ADR-024`).

---

## 4. Identity

`DECIDED IN PHASE 0A` — two identity families, deliberately different:

| Family | Form | Properties |
|---|---|---|
| **State entities** | **UUIDv7** | globally unique, immutable, never reused, carries no business meaning |
| **Content definitions** | canonical key, e.g. `creature.rookgaard.rat` | human-readable, stable across versions, namespaced by domain, greppable in content files |

State entity ids are **UUIDv7** (`DATA_ARCHITECTURE.md` §2), chosen for uniqueness without
coordination and for time ordering, which keeps index locality reasonable as tables grow.

**An identifier is not a secret and not an authorization control.** UUIDv7 embeds an observable
creation timestamp, and that is acceptable: nothing in the system relies on an id being
unguessable, unordered or unknown. The security boundary is **authorization plus
ownership-scoped loading plus rate limiting** (`CLIENT_SERVER_BOUNDARIES.md` §7) — every entity
is loaded scoped to the authenticated principal, so knowing an id, however obtained, grants
nothing.

"Opaque" here means **opaque to the domain**: the id encodes no business meaning, so nothing
parses one to learn what it refers to. It does not mean secret.

Readable keys for content make the content set reviewable in a pull request, which is the whole
point of separating it.

An imported reference to an external source (e.g. a Canary creature or item) is recorded as a
**source alias** on the content definition, never as the canonical key. `DEFERRED` to 0A.6.

---

## 5. State-bearing domain concepts

### 5.1 Account

**Purpose.** The **ownership and security principal**. Every question of the form *"who is
allowed to do this?"* resolves to an Account, and every durable player-owned thing — characters,
currency, items, entitlements, market listings — hangs off one.

`DECIDED IN PHASE 0A` — Account is deliberately **not** defined as "one human" or "one login".
Nothing in the design set locks a human to a single account, and nothing locks an account to a
single credential. Authentication identifiers are a **separate concept** (§5.18), so an account
can later gain a second sign-in method, or an operator can support account recovery, without
touching the ownership model.

`LOCKED BY PRODUCT` (2026-09-25, `ADR-022` §2) — **the Account is the Game Account**: one campaign,
with one Main Character and a roster of companions. One login identity may hold one or more Game
Accounts, which is the flexibility this paragraph kept open. Everything this document calls
Account-owned — the Bank, the Depot, the Stash, entitlements as implemented, tutorial completion,
one-time reward state, the roster and its unlocks — is Game Account state. Whether any of it should
attach to the login identity instead is open (`ADR-022` GA-O8).

| | |
|---|---|
| Identity | opaque surrogate, immutable |
| Owner | Identity & Access |
| Authoritative system | API/application layer |
| State | durable |
| Lifecycle | registered → active (→ suspended, a Phase 0A concept not yet designed). Deletion: `ACTIVE` → `PENDING_DELETION` for exactly 720 elapsed hours, **wholly frozen** → restored exactly, or **hard-purged** with everything it owns, its Characters included (`ADR-024`). The Login survives the purge. *Superseded 2026-09-25:* the Phase 0A rule *"never hard-deleted while it owns ledger or market history"* |
| Mutable during an Activity | yes, but never in a way that alters the running Activity's participants |
| Transaction / audit | required for currency, entitlement and roster-capacity changes |

**Invariants.**
- `count(roster members) ≤ rosterCapacity ≤ 5` — `LOCKED BY PRODUCT`: the Main and at most four
  companions (`ADR-022` §3). Every existing Character counts. How a companion is represented and
  counted is Phase 4's choice
- a Game Account has **one Main Character** — `LOCKED BY PRODUCT` (2026-09-25, `ADR-022` GA1). At
  any instant it has at most one, and nothing may create a second (I24). The character a Game
  Account starts with **is** its Main, from creation: vocationless in Rookgaard, and the same Main
  selects its vocation on proceeding to the Mainland (RK3–RK4). No replacement Main exists: a Game
  Account is deleted as a whole (`ADR-024` GD7)
- the vocations of the Main and its companions are **distinct** — `LOCKED BY PRODUCT`
- an unlocked companion is **permanent**, and leaves only with its whole Game Account — `LOCKED BY
  PRODUCT` (2026-09-25, `ADR-022` GA11, I28)
- the Game Account has its own **name**, in a namespace separate from Character names — `LOCKED BY
  PRODUCT` (`ADR-022` GA9). Its uniqueness is open (GA-O11)
- tutorial completion is tracked at account level, not inferred from character count —
  `LOCKED BY PRODUCT` (`TUTORIAL_ROOKGAARD_ROADMAP.md` §2). It is Game Account state, and the
  purge removes it with the rest (`ADR-024` GD5). *Until 2026-09-25 it had to survive a Character's
  purge (G4.1c, superseded)*
- a one-time Tutorial Reward is Game-Account-governed: recorded in Game-Account-owned claim state
  wherever a reward is defined as one-time — `LOCKED BY PRODUCT` (G4.1c; `ADR-023`)
- every one-time reward claim is Game Account state — never the actor's and never the Login's —
  claimed at most once whichever actor claims it and however often replayable content is run —
  `LOCKED BY PRODUCT` (2026-09-25, `ADR-023` QR6, QR9, I25). A co-op quest's final chest is such a
  reward; any other reward is one-time only where its definition says so
- deletion: the whole Game Account is frozen while pending and purged at `purgeAt`. Nothing it owns
  reaches another Game Account or the Login — `LOCKED BY PRODUCT` (2026-09-25, `ADR-024`, I12,
  I17, I19)

Roster capacity is stored against the Account row but is **owned by the Character context** —
see §5.4. Physical location does not determine the bounded context.

**Relationships.** Owns Characters, currency balances, entitlements, market listings. Is the
subject of every ledger entry.

**Depended on by.** Everything. This is the authorization root.

---

### 5.2 Session

**Purpose.** An authenticated, *connected* presence. The online-activity policy is expressed
entirely in terms of Sessions, so this concept carries more weight here than in a typical
web application: it is not a cookie, it is the liveness signal that a Hunt's existence depends
on.

| | |
|---|---|
| Identity | opaque surrogate, one per connection lifetime |
| Owner | Identity & Access |
| Authoritative system | API/application layer; liveness observed at the realtime edge |
| State | **hybrid** — liveness is ephemeral; the *claim* a session holds on an Activity must survive a server process restart within the grace window |
| Lifecycle | `UNAUTHENTICATED → AUTHENTICATED → CONNECTED → (DISCONNECTED → GRACE) → ENDED` |
| Mutable during an Activity | the Session *is* the thing that changes; the Activity reacts |
| Transaction / audit | no ledger, but session-lifecycle events must be observable for support |

**Invariants.**
- `DECIDED IN PHASE 0A` — **at most one Session may hold the Activity claim for an Account at
  any instant.** Whatever the eventual duplicate-connection policy, two connections must never
  both advance the same Hunt. This is non-negotiable: it is the only thing standing between
  the game and double-settled XP from two browser tabs.
- a Session never carries authority the Account does not have.
- session identity is never accepted from the client as a claim of ownership.

**Relationships.** Belongs to Account. Holds at most one Activity claim.

*Since 2026-09-25:* the Account here is the Game Account. Whether sessions, the newest-connection
rule and the one Activity claim stay per Game Account when one login identity holds several is
open (`ADR-022` GA-O8).

`DECIDED IN PHASE 0A` — **the newest authenticated connection wins and evicts the previous
one.** See `ADR-008`. Refusing the second connection would lock a player out of their own
account for up to five minutes every time they close a laptop and pick up a phone, which is
hostile behaviour caused by a safety mechanism meant to protect them. Queuing has the same
effect with extra machinery. Eviction is safe because the Activity claim transfers atomically:
the evicted session is told why it was closed, and at no instant do two sessions hold the
claim.

`DEFERRED` to 0A.4 — liveness mechanism, timeout detection, reconnect identity, and the exact
transport. Explicitly **not** choosing a heartbeat interval here.

---

### 5.3 Character

**Purpose.** A persistent vocation avatar with independent progression. Not a party slot.

`LOCKED BY PRODUCT` (2026-09-25, `ADR-022`) — a Game Account has exactly one **Main Character**:
the player's primary created character and the Game Account's campaign identity. Further
vocations are **companions**. A companion keeps its own vocation, Base Level, Base XP and Skills,
but it is **not** an account-lifecycle Character equivalent to the Main. This section describes
the Main. Every Character in code today is one: the Main from its creation, in its vocationless
Rookgaard state, where it may stay (`ADR-022` RK1–RK4). *Origin Character* is only its legacy and
code name. How a companion is represented, and which of the rules below reach it, are Phase 4's
(`ADR-022` §2, §4).
Until 2026-09-24 this section said a Character was *"not a companion"*, quoting the party
document's *"real persistent character, not a temporary combat companion"*: that described the
superseded roster of five equivalent Characters.

| | |
|---|---|
| Identity | opaque surrogate, immutable |
| Owner | Character context |
| Authoritative system | API/application layer; mutated by Activity settlement |
| State | durable |
| Lifecycle | created → (the Main, from creation: begins in Rookgaard at Level 1, vocationless, may stay there indefinitely, and selects its vocation on proceeding to the Mainland \| a companion, from Phase 4: starts at L8, permanent) → progresses indefinitely. A Character has no deletion state of its own: it is frozen while its **Game Account** is `PENDING_DELETION` — 720 elapsed hours — and purged only with it, leaving an internal history record (`ADR-024`) |
| Mutable during an Activity | **progression only, and only through settlement.** Vocation, identity and roster membership are frozen. |
| Transaction / audit | settlement is transactional and carries an operation id |

**Invariants.**
- `DECIDED IN PHASE 0A` — vocation is **immutable** once confirmed at Level 8. This is *not*
  locked by product: `TUTORIAL_ROOKGAARD_ROADMAP.md` §36 says only that the vocation is
  *"permanently applied"* after confirmation, and explicitly records that *"exact
  respec/change-vocation rules are future design"*. Absence of a respec design is not a
  prohibition. Architecture needs an answer now because vocation determines skill aptitude,
  roster uniqueness and every combat profile, so it is decided here: vocation does not change
  through ordinary play. Should a respec ever be designed, it is an explicit, audited
  operation — never a field update — and it must re-validate roster vocation uniqueness.
- a newly unlocked companion starts at Base Level 8, never enters Rookgaard, and receives no
  catch-up levels — `LOCKED BY PRODUCT`, carried over by `ADR-022` §3
- `DECIDED IN PHASE 0A` — the uniqueness of vocation per account, across the Main and its
  companions, must be enforced by a **persistence-level constraint**, not application logic
  alone. An application-only check loses to a concurrent double-unlock; this invariant is
  load-bearing for the entire roster model and deserves the database's guarantee.

**Relationships.** Belongs to Account. Owns Progression, Skills, Inventory, Equipment,
**Stamina** and at most one **occupancy claim**. The Main is always in its Game Account's personal
Active Party (`ADR-022` PP2). Is a participant in an Activity snapshot. Which of these a companion
holds for itself — custody, Stamina, occupancy — is open (`ADR-022` GA-O3–GA-O5).

`DECIDED IN PHASE 0A` — a Character holds at most one occupancy claim, so it can perform only one
primary action at a time, and **Stamina is per-Character durable state** with a 42:00 maximum.
Both are specified in
[`ACTIVITY_OCCUPANCY_AND_TIMERS.md`](ACTIVITY_OCCUPANCY_AND_TIMERS.md) (`ADR-013`, `ADR-014`).

`LOCKED BY PRODUCT` (2026-09-25, final synchronization) — **a Character is deleted only with its
Game Account.** See `ADR-024`, which reuses `ADR-020`'s lifecycle mechanics. `ADR-020`'s
Character deletion (2026-09-24, amended 2026-09-25) superseded the Phase 0A retirement (`ADR-007`),
and is itself superseded in its target.

- A deletion request moves the whole **Game Account** from `ACTIVE` to `PENDING_DELETION`. Nothing
  is copied. For exactly **720 elapsed hours** from the accepted request, with `purgeAt` stored,
  the Game Account and every Character in it stay intact and **fully frozen**: no gameplay, no
  change to anything they own, no elapsed-time recovery, Stamina included. The owner may restore it
  while `now < purgeAt`, exactly as it was when the deletion was accepted, with nothing credited for
  the pending time (`ADR-020` T1, FZ1–FZ3).
- At `purgeAt` the purge is due. It deletes the Game Account's Main, every Companion and
  **everything the Game Account owns** — progression, Stamina, items, containers, policies, the
  Pouches, the Bank, the Depot, the Stash, claims, and its activity history. Nothing moves to
  another Game Account or to the Login, and no value survives. A failed purge is a degraded, frozen
  condition, never an extension, and a retried purge changes nothing twice (FZ4–FZ5).
- No **live** record survives — nothing that could restore it, own or hold anything, or take part
  in a uniqueness rule. An **internal history record for support** does, and it may keep names,
  vocations, levels and dates. There is no public Deleted List (`ADR-024` HR1–HR5).
- Every Character name of a pending Game Account stays reserved, **globally**, until the purge
  commits. Names are unique across the whole game (NM1–NM2, I27). A historical record never
  reserves a name.
- **Playable** now means a Character of an `ACTIVE` Game Account. The Characters of a pending Game
  Account are not playable, but they still exist for the name, vocation and capacity rules.
- There is no replacement Main and no replacement Origin Character: a new campaign is a new Game
  Account (GD7). A companion is never deleted or dismissed on its own (GA11).

*Superseded 2026-09-25:* the Character-deletion rules this section carried until then, which
`ADR-020` keeps as history. They covered a pending Character holding its vocation, roster place and
Origin slot (G4.1b); tutorial completion surviving its purge, the later-character flow and the
Bootstrap Kit (G4.1c); the public Deleted List; and names unique per account. Each assumed a
Character could be purged while its Game Account lived on.

The code still implements retirement (`retiredAt`) until the PRE-PHASE-4 gate replaces it
(`PHASE_GATES.md` § *G4.1*).

---

### 5.4 Character Roster

**Purpose.** The set of characters an account has, and the capacity it has paid for.

*Since 2026-09-25 (`ADR-022`):* the roster is the Game Account's **Main Character** and its
unlocked **companions** — at most one per vocation, so at most four companions. The
derived-membership decision below stands. Whether an integer capacity stays the representation of
companion unlocks is Phase 4's choice; an unlock is bought with Gold and is permanent either way.

`DECIDED IN PHASE 0A` — **the roster is not an entity.** It is two things wearing one name:

| Aspect | What it actually is |
|---|---|
| The *membership* | a **derived collection** — every Character that exists for this Account, those of a `PENDING_DELETION` Game Account included until its purge (`ADR-024`). A purged Character does not exist. Nothing to store. |
| The *capacity* | **durable state owned by the Character context** — an integer, because it is bought with Gold and must be auditable |

Modelling the roster as its own entity would create a second place where membership could
disagree with reality. Deriving membership makes divergence impossible.

`DECIDED IN PHASE 0A` — **the Character context owns roster capacity**, not Identity & Access.
The capacity value physically lives on the Account row, but storage location does not decide
ownership. Capacity is a constraint on how many Characters may exist; it is bought with Gold
through ordinary gameplay progression, and every invariant it participates in
(`count(roster members) ≤ rosterCapacity`) is a Character-context invariant. Identity &
Access owns authentication, authorization and entitlements — none of which capacity is. An
earlier draft split membership and capacity across two contexts, which violated the
single-owner rule of `ADR-001`; that split is removed.

| | |
|---|---|
| Identity | none of its own — addressed through the Account |
| Owner | **Character context** — both membership and capacity |
| State | membership derived; capacity durable |
| Lifecycle | capacity starts at 1 and only ever increases |
| Mutable during an Activity | capacity yes; membership yes — but neither affects a running Activity, which holds a snapshot |
| Transaction / audit | **required.** A capacity increase spends Gold, so it is a ledgered economy operation. |

**Invariants.**
- `1 ≤ rosterCapacity ≤ 5` — `LOCKED BY PRODUCT`: the Main and at most four companions
- capacity is **monotonic** — `DECIDED IN PHASE 0A`. Nothing reduces or refunds purchased
  capacity; it goes only with its Game Account at a purge, and is never refunded to the Login
  (`ADR-024` GD6). An unlocked companion is permanent (`ADR-022` GA11), so no roster place is ever
  freed inside a Game Account.
- a vocation held by the Main or a companion is not offered as a companion unlock — `LOCKED BY
  PRODUCT`. Because companions are permanent and the Main is never replaced, a vocation once held
  stays held for the life of the Game Account

---

### 5.5 Active Party

**Purpose.** The player's chosen combat formation, drawn from the roster.

`DECIDED IN PHASE 0A` — see `ADR-005`. **The Active Party is durable configuration, not an
entity with its own progression.** It is an ordered list of at most four character ids held
against the Account. It has no XP, no level, no inventory, no identity that outlives a
composition change.

`LOCKED BY PRODUCT` (2026-09-25, `ADR-022` PP1–PP3) — this is the **personal** Active Party of one
Game Account. Its **Main Character is always present**, and up to three companions may join it.
The player may reorder it, and the Main need not hold Slot 1. It never enters human multiplayer as
a block (MP4, §5.6).

Position is meaning, not a flag: *"Active Party Slot 1 is the Frontline"* is satisfied by list
order alone. A `isFrontline` boolean would be a second source of truth for something the order
already says, and the two could disagree.

| | |
|---|---|
| Identity | none — addressed through the Account |
| Owner | Party context |
| Authoritative system | API/application layer |
| State | durable configuration |
| Lifecycle | exists from the first character onward; edited freely between activities |
| Mutable during an Activity | **no — formation editing is locked while an Activity is running** (`DECIDED IN PHASE 0A`, see below) |
| Transaction / audit | ordinary write, no ledger |

**Invariants.**
- `1 ≤ size ≤ 4` — `LOCKED BY PRODUCT`
- every entry is the Main or a companion of the same Game Account — `LOCKED BY PRODUCT`
- the Main is always an entry — `LOCKED BY PRODUCT` (2026-09-25, `ADR-022` PP2)
- no entry appears twice; order is significant — `DECIDED IN PHASE 0A`
- five simultaneous active characters cannot be represented — `LOCKED BY PRODUCT`
- every entry references a **playable** Character — `DECIDED IN PHASE 0A`. Since `ADR-024`,
  playable means a Character of an `ACTIVE` Game Account. The Active Party is Game Account
  configuration: it is frozen with its Game Account during the grace and purged with it, and a
  configured membership does not block a deletion request — only a running Activity does
  (`ADR-024` §2). *This resolves the reading `ADR-020` §3 left open for the Main (DEL-O1)*

`DECIDED IN PHASE 0A` — **formation editing is rejected while an Activity is running.** An
earlier draft allowed the configuration to be edited with the running Activity simply ignoring
it. That is worse than it sounds: because the participant profile refreshes at each settlement
checkpoint (§5.6), an "ignored" edit would either silently take effect at the next checkpoint —
a mid-run power swap — or produce a UI that accepts a change and visibly does nothing. Both are
bad. The application layer rejects the command with a clear reason, and the client surfaces
*"stop the current activity to change your party"*. The player loses nothing: ending a Hunt is
always available and costs only the room progress, which never persisted anyway.

**Shared XP eligibility** is a **derived predicate**, never stored as truth:

```text
minimumShareLevel = ceil(highestActiveLevel × 2 / 3)
eligible          = lowestActiveLevel >= minimumShareLevel
```

`DECIDED IN PHASE 0A` — eligibility is computed from the composition, never persisted as a
flag that could drift from the levels it describes. The UI preview in the party document
(*"Highest 250 / Lowest 166 / Required 167 / NOT ELIGIBLE"*) is the same computation rendered,
not a second stored value.

`DECIDED IN PHASE 0A` — **eligibility is re-evaluated at each settlement checkpoint**, on the
same cadence as the participant profile refresh (§5.6). Continuous per-tick evaluation would
make a mid-tick level-up change the rules of the tick that produced it; evaluating only once at
activity start would freeze a party out of Shared XP for an endless Hunt even after its lowest
member crossed the threshold. The checkpoint is the boundary at which progression becomes
durable, so it is the natural and only place where the party's derived properties change.

---

### 5.6 Activity — the abstract concept

**Purpose.** A bounded run of simulated gameplay that produces progression. This is where the
game actually happens.

`DECIDED IN PHASE 0A` — see `ADR-002`. An Activity owns:

1. **Run state** — where the party is in the activity (room index, supplies remaining,
   encounter state).
2. **A roster snapshot** — *which* characters are participating and in what order. Immutable
   for the life of the Activity.
3. **A participant profile** — the effective combat values the engine is currently using for
   each participant. **Refreshed at every settlement checkpoint**, not frozen at start.
4. **An unsettled accumulator** — XP, gold, loot and consumption produced but not yet folded
   into durable state.
5. **A lifecycle state** — see 0A.4.

`LOCKED BY PRODUCT` (2026-09-25, `ADR-022` MP1–MP5) — a **human multiplayer** Activity takes
exactly **one** selected actor per participating Game Account: its Main or any unlocked companion.
A personal Active Party never enters one as a block, and changing the selected actor creates no
new account, reward entitlement or completion identity.

`DECIDED IN PHASE 0A` — **composition is frozen; power is not.** See `ADR-006`.

An earlier draft froze both together, which produced a serious gameplay consequence in the
game's central loop. A Hunt is *endless by design* — room 10 repeats indefinitely — so a
character who levelled up after three hours would keep fighting with the stats it had at minute
zero, forever. The longer a player committed to the loop the more stale their own power became,
which inverts the intent of the progression system the loop exists to feed.

The two concerns are therefore separated:

| | **Roster snapshot** | **Participant profile** |
|---|---|---|
| Holds | character ids and slot order | effective levels, skills, derived combat values |
| Changes during the run | **never** | at each settlement checkpoint |
| Why | a mid-run swap would be a power exploit and breaks the fairness of a run | progression earned in the run must apply to the run |

**Refresh at the checkpoint, not per tick.** Per-tick re-derivation would mean reading durable
Character state on every tick, which destroys engine purity and the accumulator model in one
move. The settlement checkpoint is already the transactional boundary where progression becomes
durable; making it also the boundary where the engine's view of the party refreshes keeps one
boundary instead of two, and gives a player a bounded, explainable delay between "I levelled"
and "I hit harder".

**Settlement** is the transactional fold of (3) into Character progression, Inventory and the
Economy ledger. It is idempotent, carries an operation id, and is the *only* path by which an
activity changes durable state.

`DECIDED IN PHASE 0A` — **Activities come in two families with genuinely different lifecycles.**
Treating them as one abstraction would be a mistake:

| | **Session-bound** | **Wall-clock** |
|---|---|---|
| Members | Hunt, Dungeon | Skill Training |
| Requires a live session | **yes** | **no** |
| On disconnect | pauses, 5-minute grace, then terminates | unaffected |
| Advances by | simulated ticks while connected | elapsed real time |
| Settles | at commit points during the run and at end | on claim/read |
| Grants Base XP | yes | **never** |

They share the words "activity" and "settlement" and almost nothing else. 0A.5 will decide
whether they share an interface; this document only records that they are not the same thing.

---

### 5.7 Hunt Activity

**Purpose.** The endless idle loop. The game's primary progression engine.

| | |
|---|---|
| Identity | opaque surrogate |
| Owner | Activity context |
| Authoritative system | Game engine (rules) + application layer (orchestration, settlement) |
| State | durable while it exists, but **intentionally short-lived** — it does not outlive the run |
| Lifecycle | `STARTED → ONLINE_ACTIVE ⇄ RECONNECT_GRACE_PAUSED → ENDED` |
| Mutable during an Activity | it *is* the activity |
| Transaction / audit | every settlement is transactional and audited |

**Invariants.**
- room index ∈ `1..10`; after 10 it repeats 10 — `LOCKED BY PRODUCT`
- room progress does **not** survive the Activity — `LOCKED BY PRODUCT`, and structural here
- ends on death, manual exit, or a player-configured stop condition — `LOCKED BY PRODUCT`
- supply exhaustion and full Loot Capacity **do not end it**; they raise warnings and change
  engine behaviour (no further loot collected) — `LOCKED BY PRODUCT`
- zero accumulator growth while paused — `LOCKED BY PRODUCT`, enforced structurally by
  refusing to tick a paused Activity

**Loot handling.** `DECIDED IN PHASE 0A` — the engine *resolves* loot into the accumulator as
a deterministic record (base item key, rarity, rolled affixes, seed). `ItemInstance` rows are
*materialized* at settlement, transactionally. Rationale: creating item rows mid-tick means a
crash can leave items that exist but were never earned, or vice versa; materializing at
settlement makes item creation share the transaction with the XP and gold it was earned
alongside. Loot Capacity is therefore computed from committed inventory **plus** the pending
accumulator, and that combined figure is an engine input.

`DECIDED IN PHASE 0A` — **Loot Capacity is pooled across the Active Party for the duration of
an activity.** The pool is the sum of the participating characters' individual capacities, so
`TUTORIAL_ROOKGAARD_ROADMAP.md` §28's *"Characters have a maximum Loot Capacity"* still holds
per character — the activity simply spends them as one budget. Per-character capacity would
force the player to decide which character picks up which drop, which is precisely the
tile-by-tile busywork the product exists to remove, and it would make a full Knight stop
collecting while a Druid with room stood next to the same corpse.

`DECIDED IN PHASE 0A` — **a Hunt ends on full party wipe, not on the first death.** A downed
character stops contributing to combat and stops accruing Shared XP from that point; survivors
continue; the activity ends when no participant is standing. Ending the run on the first death
would make a four-character party strictly more fragile than a solo character, since it would
have four independent chances to trigger the same ending — the opposite of what forming a party
is for. For a solo player the two readings are identical, so `docs/DECISIONS.md`'s *"the Hunt
ends on death"* remains true as written for the MVP's single-character slice. Death remains
punitive; what a wipe costs each participant is a `DEFERRED PARAMETER` of the death-penalty
design, not an architectural question.

---

### 5.8 Dungeon Activity

**Purpose.** Bounded, progression-gated content with a boss and a chest.

Same ownership, settlement and pause semantics as Hunt Activity. Differences that matter to the
domain model:

- progresses through **floors 1–10**, floor 10 being a boss encounter — `LOCKED BY PRODUCT`
- completion can grant unlocks (bosses, services, blessings, imbuements), which are durable
  **Account or Character** state, not Activity state
- Treasure Chests exist only here — `LOCKED BY PRODUCT`
- the first tutorial dungeon has a guaranteed chest as a **tutorial-scoped exception**, not a
  universal floor-10 rule — `LOCKED BY PRODUCT`
- **replay and one-time reward claims are separate** — `LOCKED BY PRODUCT` (2026-09-25,
  `ADR-023`). Whether content can be replayed is defined by the content: a human multiplayer /
  co-op quest can be, and for solo, tutorial, story and dungeon content it is content-specific and
  open. A reward is one-time where its definition says so — a co-op quest's final or primary chest
  is — and it is claimed at most once per **Game Account**, whichever actor opens it; replay never
  re-enables it. Claim state is a typed, exactly-once concept, kept apart from completion and
  progression state (I25)

`DEFERRED` to 0A.6 — where unlock state lives (a per-account unlock set vs. flags) and how
puzzle/lever interaction state is represented. *Since 2026-09-25 a one-time reward claim is never
an untyped flag (`ADR-023` §2); its physical representation is Phase 5's.*

**Terminology, resolved.** `DECIDED IN PHASE 0A` — the domain and the engine use **Room** as
the single generic unit of activity progression. *Floor* survives only as a dungeon-flavoured
**display label** for the same concept, and boss halls are rooms too.

The design set used three words for one structure: Dungeons progress through *floors*, Hunt
Areas through *rooms*, and `MASTER_DEVELOPMENT_ROADMAP.md` §9 calls a boss hall *"10 encounter
rooms"*. `TUTORIAL_ROOKGAARD_ROADMAP.md` §16 requires a **generic** dungeon engine — *"Do not
implement each Dungeon as a custom combat engine"* — and a generic engine cannot have two
incompatible names for its own progression unit. Player-facing text keeps saying "floor" in
dungeons where that reads better; the domain model, the engine and the content schema say
`room`. `docs/DECISIONS.md` carries the same note so there is one source of truth.

---

### 5.9 Skill Training Activity

**Purpose.** The **only** approved disconnected progression. — `LOCKED BY PRODUCT`

| | |
|---|---|
| Identity | opaque surrogate |
| Owner | Activity context |
| State | durable; survives logout by design |
| Lifecycle | started → accrues against wall-clock → claimed/settled → ended or exhausted |
| Mutable during an Activity | independent of any Hunt/Dungeon activity |
| Transaction / audit | settlement is transactional; consumes Exercise Weapon charges, which are item state |

**Invariants.**
- **never grants Base XP** — `LOCKED BY PRODUCT`
- `DECIDED IN PHASE 0A` — this must be a **structural guarantee, not a convention.** The
  settlement path for Skill Training is given no capability to mutate Base Level or Base XP at
  all. A rule this important should be impossible to violate by accident, not merely
  documented. 0A.5 will express this as a narrowed settlement interface.

`DEFERRED PARAMETER` — maximum offline accrual duration, training rates, charge settlement.
Recorded in `docs/OPEN_QUESTIONS.md`. These are configuration inputs: the settlement path, its
capability boundary and its timestamp source are fixed regardless of their values.

---

### 5.10 Character Progression

**Purpose.** Base Level and Base XP. The character's general advancement.

| | |
|---|---|
| Identity | none — a component of Character |
| Owner | Character context |
| State | durable |
| Mutable during an Activity | only via settlement |
| Transaction / audit | yes |

**Invariants.**
- Base XP is monotonically non-decreasing **except** through the death penalty —
  `LOCKED BY PRODUCT` (death is punitive and affects level/XP; the numbers are open)
- `DECIDED IN PHASE 0A` — the death penalty is an explicit, audited, negative settlement
  operation, not an ad-hoc subtraction. Anything that can reduce a player's progress must be
  as traceable as anything that increases it.
- **Base XP is the truth; Base Level is its deterministic, stored projection** — `LOCKED BY
  PRODUCT` (2026-09-25; already implemented in Phase 2). Every XP write path updates the level in
  the same transaction, a rollback reverts both or neither, and migrations and backfills keep the
  pair consistent (I29, `PHASE_GATES.md` § *G4.2*). The curve implemented is Canary's
  `getExpForLevel`. The Product Owner has not locked it as Global Idle's, so the exact curve stays
  open (`DECISIONS.md` § *Base XP and Base Level*)

---

### 5.11 Character Skills

**Purpose.** Numeric proficiencies — the classic set: Magic Level, Sword, Axe, Club, Shielding,
Distance and Fist. There is no Fishing skill (`LOCKED BY PRODUCT`, 2026-09-25, `DECISIONS.md`
§ *Classic Skills and the build philosophy*). The list decides no combat formula. The weapon
attack and defence formulas that read Skill, Shielding and Level are locked separately
(`DECISIONS.md` § *Combat formulas — weapon attack and defence*); they consume these values and add
no state.

`LOCKED BY PRODUCT` — the combat foundation draws a hard line between **Base Skill** (trained,
permanent) and **Effective Skill** (base + equipment + Wheel + Skill Tree bonuses).

`DECIDED IN PHASE 0A` — **only Base Skill is durable state. Effective Skill is always derived,
never stored.** Storing it would create a value that silently rots whenever an item is
unequipped, a Wheel node is bought, or an imbuement expires. The engine computes it from
inputs at resolution time; the UI displays the same computation.

| | |
|---|---|
| Owner | Character context |
| State | base durable; effective derived |
| Mutable during an Activity | base only via settlement (hunting and training both contribute) |
| Transaction / audit | yes |

`DEFERRED PARAMETER` — the Skill Point award trigger (Model A vs Model B) and the cost curve
remain open in `COMBAT_LEVEL_SKILLS_FOUNDATION.md` §5, §45. The domain model works unchanged
under either; the choice changes numbers, not boundaries.

---

### 5.12 Inventory and Equipment

**Purpose.** Custody scopes for item instances.

`DECIDED IN PHASE 0A` — **Inventory and Equipment do not contain items; they are custody
locations that item instances point at.** The alternative — a container holding a list — makes
"the same item in two containers" representable, which is precisely the bug class the economy
cannot tolerate. See `ADR-004`.

Equipment adds slot semantics on top of custody: a character has a fixed set of equip slots,
each holding at most one instance.

| | |
|---|---|
| Owner | Items context |
| State | durable |
| Mutable during an Activity | loot arrives via settlement; **equipment changes are rejected for participating characters** (see below) |
| Transaction / audit | every custody transition is transactional and audited |

`DECIDED IN PHASE 0A` — **equipment changes are rejected while a character is participating in
a running Activity.** This follows directly from the formation lock (§5.5) and the checkpoint
refresh (`ADR-006`): because the participant profile is re-derived at each settlement, a mid-run
gear swap would take effect at the next checkpoint. That is the same power-swap exploit the
formation lock exists to prevent, arriving through a different door — swap in a damage weapon for
the boss room, swap back for the trash. Locking both closes it consistently.

Characters **not** in the running Activity may be re-equipped freely; nothing about them feeds
the run. Items may also be sold, listed or forged as long as they are not held by a participating
character, since their custody is not frozen — **except** a Character-bound consumable, which is
never sold, listed or forged at all (§5.13). *(The Bootstrap Kit that shared this exception until
2026-09-25 is retired: the starter gear is ordinary items.)*

`LOCKED BY PRODUCT`, **not implemented** — each Character will also have a **Store Container**
(`ADR-021`): a system custody for Character-bound consumables. It is not a physical backpack and
not a Hunt Container Slot — it consumes none of the five — and it is not equipment or the Loot
Pouch. Its capacity, and how it is represented, are not decided. Since 2026-09-25 the tutorial's
Health and Mana potions are Character-bound consumables in this model (`ADR-021` S6–S7), and
whether a companion has a Store Container of its own is open (`ADR-022` GA-O3). A configured
tactical action slot may consume an eligible bound potion **straight from the Store Container**,
so a bound potion never enters a Hunt Container (`ADR-021` U5, `DECISIONS.md` § *Tactical action
slots*).

**Loot Capacity** is pooled across the Active Party for the duration of an activity (§5.7) and
consumed by the engine as an input. Full capacity stops collection without stopping combat —
`LOCKED BY PRODUCT`.

---

### 5.13 ItemInstance

**Purpose.** A unique, individually-rolled object. The reason equipment is interesting.

`LOCKED BY PRODUCT` — one BaseItem definition; rarity and affixes live on the instance; never
six static copies.

| | |
|---|---|
| Identity | opaque surrogate, immutable, **never reused** |
| Owner | Items context |
| Authoritative system | server only — *"the browser must never decide loot, rarity, forge success"* |
| State | durable |
| Lifecycle | materialized at settlement (loot), by an economy operation (purchase, forge), or issued at Character creation (the starting grant) → custody transitions → consumed (forge sacrifice, a potion drunk) or destroyed |
| Mutable during an Activity | created by settlement; custody is otherwise frozen for participating characters |
| Transaction / audit | **always** |

**Invariants.**
- exactly one custody scope at any instant — `DECIDED IN PHASE 0A`, `ADR-004`
- base item key + content version is immutable for the life of the instance
- `DECIDED IN PHASE 0A` — rarity is rolled once at creation and is not rerolled by any
  currently designed system. What *is* locked is narrower: the Forge preserves the target's
  rarity and affixes (`docs/DECISIONS.md`). No source forbids a future reroll mechanic, so this
  is recorded as an architectural decision rather than a product prohibition. Should a reroll
  system ever be designed, it is a new audited economy operation producing a new rolled state
  on the same instance — never an in-place edit outside a transaction. *Since 2026-09-25 an
  **affix** reroll is designed at direction level — one chosen affix slot is rerolled from the
  legal pool, and the others stay exactly as they were (`DECISIONS.md` § *Affixes*) — and it is
  exactly such an operation. No rarity reroll is designed.*
- forge tier changes never alter rarity or affixes — `LOCKED BY PRODUCT`
- affixes, forge tier and imbuements are **independent layers** — `LOCKED BY PRODUCT`
- a consumed instance is terminal: it never returns to circulation
- **binding is separate from custody.** A Character-bound consumable has one immutable bound
  Character. It is only ever in that Character's Store Container or in the Account's Depot, and a
  move between the two never changes the binding. It is used only by its bound Character, and it
  never reaches the Stash, another Character, a market, a trade, an NPC sale, a Forge input or any
  conversion into value — `LOCKED BY PRODUCT`, **not implemented** (`ADR-021`, I22–I23)
- a tutorial potion is a **Character-bound consumable on the ordinary potion's definition**: the
  binding lives on the instance, never on the definition or its effect, so every other copy of that
  potion stays ordinary. A binding is never encoded through Canary's `UNIQUEID` or `ACTIONID` —
  `LOCKED BY PRODUCT` (2026-09-25, `ADR-021` S7, B6), **not implemented**
- the tutorial's **starter gear** — armour, dagger, backpack — is ordinary, unbound items —
  `LOCKED BY PRODUCT` (2026-09-25). *The Bootstrap Kit binding of G4.1c (2026-09-24), which kept
  the kit out of the Depot, the Stash, trade and sale, is retired (`ADR-024` §8)*
- an item that comes from a quest is an ordinary item unless its definition binds it — the
  tutorial's Doublet included — `LOCKED BY PRODUCT` (2026-09-25, `ADR-023` QR8)

**Relationships.** References a BaseItem definition. Held by exactly one of: character
inventory, character equipment, the Account's Depot, a Character's Store Container (future,
`ADR-021`), market escrow, forge input, or a terminal consumed state. A Character-bound consumable
also names its bound Character, which is not a custody (`ADR-021` §2).

---

### 5.14 Currency and balances

**Purpose.** Gold and premium currency.

`DECIDED IN PHASE 0A` — see `ADR-003`. **Currency is not an entity.** A balance is a
`(owner, currencyType) → amount` projection maintained inside the same transaction that appends
to the ledger. The ledger is the truth; the balance is a cache that must never be writable on
its own.

`DECIDED IN PHASE 0A` — **Gold is account-scoped, not character-scoped.** This is a
product-adjacent call made under the Phase 0A delegation, and the existing documents point
firmly at it: Gold buys roster slots (account-level), pays market fees (account-level), and
funds skill trees and services for a party that is one player. Per-character wallets would
force a transfer mechanism between a single player's own characters, which is friction with no
design intent behind it. Flagged for review in §9.7.

| | |
|---|---|
| Owner | Economy context |
| State | balance is a durable projection; the ledger is durable truth |
| Mutable during an Activity | only via settlement |
| Transaction / audit | **always, without exception** |

---

### 5.15 Economy Ledger

**Purpose.** The append-only record of every value movement. The thing that makes "where did
my gold go" answerable and "there are two of this sword" detectable.

| | |
|---|---|
| Identity | opaque surrogate per entry; every entry also carries an **operation id** |
| Owner | Economy context |
| State | durable, **append-only, never updated**. Removed from live state only by a Game Account's final purge, and then only that Game Account's entries, BANK and POUCH, which the purge moves into an append-only archive outside live state (`ADR-024` §3, PO-1) |
| Lifecycle | written once, and retained until the purge of the Game Account they belong to, or kept as immutable history outside live state (`ADR-024` §3) |
| Mutable during an Activity | appended by settlement |
| Transaction / audit | it *is* the audit |

**Invariants.**
- entries are immutable — `DECIDED IN PHASE 0A`
- nothing but the purge deletes an entry, and a purge deletes only its own Game Account's entries
  (`ADR-024` §3). *Until 2026-09-25 a Character's purge never deleted a BANK entry, because the
  Account survived it (`ADR-020`); a Game Account's purge takes its Bank with it.* A BANK entry
  still names no Character
- every entry carries the operation id that caused it, making replays detectable and
  settlement idempotent
- the sum of a subject's entries reconciles to its balance projection; a reconciliation
  discrepancy is a **P1 incident**, not a rounding curiosity
- a correction is a **new compensating entry**, never an edit

`DEFERRED` to 0A.7 — entry schema, reconciliation cadence, retention.

---

### 5.16 Market Listing

**Purpose.** A player-to-player offer, in Gold or premium currency.

| | |
|---|---|
| Identity | opaque surrogate |
| Owner | Economy context |
| State | durable |
| Lifecycle | `LISTED → (SOLD \| CANCELLED \| EXPIRED)` — all terminal |
| Mutable during an Activity | yes; listing is independent of hunting |
| Transaction / audit | **always** |

**Invariants.**
- `LOCKED BY PRODUCT` — listing moves the item into **escrow**. Escrow is a custody scope, so
  a listed item is by construction not in the seller's inventory and cannot be equipped,
  forged, or listed twice.
- *"The same item should not be simultaneously committed to two listings"* — `LOCKED BY
  PRODUCT`, and structurally impossible under single-custody.
- a sale is one transaction: currency debit, currency credit, fee, custody transfer, ledger
  entries. Partial application is not a state the system can be in.
- `LOCKED BY PRODUCT` — a Character-bound consumable is never listed, in Gold or in premium
  currency (§5.13; `ADR-021`). *The Bootstrap Kit that shared this rule until 2026-09-25 is
  retired.*

---

### 5.17 Entitlement

**Purpose.** Premium and other account-level grants.

`DECIDED IN PHASE 0A` — **an entitlement may be permanent or time-bounded.** An earlier draft
defined all entitlements as time-bounded, which would have baked "everything expires" into the
model. Premium time does expire; a cosmetic unlock, a one-off convenience purchase or a
founder grant plausibly does not, and none of that is decided yet. Expiry is therefore an
optional property, not part of the definition.

| | |
|---|---|
| Identity | opaque surrogate |
| Owner | Identity & Access |
| State | durable; **permanent or time-bounded** |
| Lifecycle | granted → active → (expired \| revoked). An entitlement with no expiry simply never leaves `active`. |
| Mutable during an Activity | yes — but see the invariant below |
| Transaction / audit | required; purchase is an economy operation |

Outfits and mounts are outside `ADR-021`'s item binding. Whatever unlock model they get — still
open — they are never Store Container items.

**Invariants.**
- `LOCKED BY PRODUCT` — **entitlement never grants a fifth Active Party member.** Party
  capacity is not an entitlement dimension at all.
- `DECIDED IN PHASE 0A` — **roster capacity is not an entitlement.** It is bought with Gold, it
  is permanent, and it does not expire. Modelling it as an entitlement would wrongly imply it
  could lapse. It is owned by the Character context (§5.4) and merely stored on the Account row.
  The superseded documentation conflated capacity with Premium; the domain model keeps them
  apart.

*Since 2026-09-25:* an entitlement belongs to the Account — the Game Account — as implemented, and
reaches every actor of it: the Main and its companions. Whether Premium and other entitlements
should attach to the login identity instead is open (`ADR-022` GA-O8). A Game Account's own
entitlements go with it at its purge, and nothing is refunded to the Login (`ADR-024` GD6).

`DEFERRED PARAMETER` — what Premium *does* offer for party management now that the fifth slot is
superseded. This is a monetization question, and the Phase 0A scope is explicit that monetization
values are not architecture's to invent. **No architecture depends on the answer**: entitlements
are modelled generically, may be permanent or time-bounded, and gate orchestration rather than
domain rules. Whatever is chosen plugs into the existing model. Recorded in
`docs/OPEN_QUESTIONS.md`.

---

### 5.18 Authentication Identity

**Purpose.** A way of proving you are the holder of an Account. Kept deliberately separate from
the Account itself.

`DECIDED IN PHASE 0A` — **credentials are not the Account.** Modelling them as one field on the
Account would hard-code "exactly one sign-in method, forever", which nothing in the design set
requires and which is painful to undo once accounts exist. Separating them costs one indirection
now and leaves room for a second sign-in method, an operator-assisted recovery flow, or a
migration between providers, none of which need to be designed today.

| | |
|---|---|
| Identity | opaque surrogate |
| Owner | Identity & Access |
| Authoritative system | API/application layer |
| State | durable |
| Lifecycle | registered → active → revoked |
| Mutable during an Activity | yes; it has no bearing on a running Activity |
| Transaction / audit | authentication events must be observable for support and abuse handling |

**Invariants.**
- every identity resolves to exactly one Account — **as implemented**. *Since 2026-09-25 a Login —
  email / authentication — may own one or more Game Accounts: `LOCKED BY PRODUCT` in the final
  synchronization (`ADR-022` GA8). The phase that builds that changes this cardinality, and
  chooses how the login identity is represented (GA-O8, GA-O10)*
- **the Login survives the purge of any of its Game Accounts** — `LOCKED BY PRODUCT` (`ADR-024`
  GD2). Today `AuthIdentity` references the Account row itself, so the PRE-4 implementation
  represents the Login apart from the Game Account before the purge ships (`ADR-024` §5)
- an Account may have one or more identities — the cardinality is deliberately not fixed
- credential material is never returned to a client and never logged

`DEFERRED` to 0A.7 — credential storage, hashing, rotation and session-token mechanics.

---

## 6. Content definitions

All of these share one pattern, stated once.

**The Content Definition pattern.** `DECIDED IN PHASE 0A`:

| | |
|---|---|
| Identity | canonical key, stable across versions |
| Owner | Content context |
| Authoritative system | the deployed content set — **no runtime writer exists** |
| State | immutable at runtime; versioned as a set |
| Lifecycle | authored → validated → published with a content version → superseded |
| Mutable during an Activity | **never.** A running Activity is pinned to the content version it started with. |
| Transaction / audit | not transactional; changes arrive through deployment and are auditable through version control |

Pinning matters: a content deployment mid-hunt must not change the creature a player is
already fighting.

`DECIDED IN PHASE 0A` — see `ADR-016`. **A referenced bundle is never withdrawn.** Published
bundles are immutable and live in durable addressable storage; the running server can resolve and
load any bundle a persisted activity or item still references, so an activity pinned to version N
stays recoverable across any number of deployments. There is no migration story for a withdrawn
version because withdrawal of a referenced version cannot happen. Removing a genuinely
unreferenced bundle is an explicit audited operation, never an automatic sweep. Invariant I16.

| Concept | Purpose | Notes |
|---|---|---|
| **BaseItem** | the immutable identity of an item — base stats, classification, equip rules, imbuement slots | `LOCKED BY PRODUCT`: exactly one definition per item. Rarity and affixes are **not** here. |
| **CreatureDefinition** | stats, behaviour parameters, elemental profile, loot table reference | Consumed by the engine as pure input |
| **LootTable** | drop probabilities over base items and resources | Rolled by the server only. Rarity/affix rolls are a **separate layer applied after** the table decides an item drops — `LOCKED BY PRODUCT` |
| **WorldLocation / Atlas** | the navigable surface map, activity markers, services | Player-specific availability is **derived** from unlock state, never stored on the location |
| **HuntDefinition** | rooms 1–10, creature pools per room, level guidance | Room 10 repeat behaviour is a property of the definition, not of the running activity |
| **DungeonDefinition** | floors 1–10, encounters, boss, chest rules, prerequisites | Generic engine, per-dungeon configuration — `LOCKED BY PRODUCT`: *"Do not implement each Dungeon as a custom combat engine."* |
| **Affix definitions, progression tables, vocation parameters** | balance data | Same pattern. Listed for completeness; detailed in 0A.6. |

---

## 7. Invariant register

The invariants that must survive concurrency, retries and partial failure. `DECIDED IN PHASE
0A` — these are the ones that deserve enforcement below the application layer, because an
application-only check loses a race.

| # | Invariant | Enforced by |
|---|---|---|
| I1 | One roster member per vocation per Game Account — the Main and every companion hold distinct vocations (`ADR-022` §3) | unique constraint over every existing Character, a pending Game Account's included (`ADR-024`); how companions enter it is Phase 4's. **Today** still `ADR-007`'s partial index over non-retired rows, until the PRE-4 gate replaces it |
| I2 | `count(roster members) ≤ rosterCapacity ≤ 5` — the Main and at most four companions | persistence constraint + transaction, counting every existing Character, as for I1; how a companion is counted is Phase 4's |
| I3 | Active Party size 1–4, entries distinct, all **playable** and owned by the Game Account, and the Main always present (`ADR-022` PP2). The party is frozen and purged with its Game Account; a configured membership never blocks a deletion request (`ADR-024` §2) | transaction |
| I4 | An ItemInstance is in exactly one custody scope | persistence constraint |
| I5 | Balance projection reconciles to the ledger | transaction + reconciliation job |
| I6 | Ledger entries are append-only — never updated; removed from the live ledger only by a Game Account's final purge, and then only its own entries, BANK and POUCH, which the purge moves into an append-only archive outside live state (PO-1) | persistence permission: the application role has no `UPDATE` or `DELETE`; only the purge capability may delete (`ADR-020` §7, `ADR-024` §3) |
| I7 | Settlement is idempotent under its operation id | uniqueness constraint on operation id |
| I8 | A paused Activity cannot advance | Activity state machine — no tick path exists from the paused state |
| I9 | At most one Session holds an account's Activity claim | Activity ownership + atomic claim |
| I10 | Skill Training cannot write Base XP | interface capability, not runtime check |
| I11 | Formation and equipment cannot change for a running activity's participants | command rejected at the application layer |
| I12 | A Game Account — and with it every one of its Characters — is hard-deleted **only** by its final purge: at or after its `purgeAt`, 720 elapsed hours after the accepted request, atomically, never partially. No Character is hard-deleted on its own | one privileged purge path, and no other delete path (`ADR-020` §7, `ADR-024`). **Superseded:** *"a Character is never hard-deleted"* (`ADR-007`), which the code still enforces until the PRE-4 gate |
| I13 | At most one occupancy claim per Character | persistence constraint (`ADR-013`) |
| I14 | An exhausted Character receives no Hunt reward by any path, including Shared XP | reward distribution filters recipients after computing the pool (`ADR-014`) |
| I15 | Active-use duration is never consumed outside a qualifying state | timers settle from `qualifyingSince`, which only a state transition writes (`ADR-015`) |
| I16 | A referenced content bundle is never deleted | no automatic GC exists (`ADR-016`) |
| I17 | A `PENDING_DELETION` Game Account is fully frozen: no command changes anything it or its Characters own, or makes one of them a participant, except restore and purge; nothing time-derived — Stamina included — accrues, and a restore credits nothing for the pending time | lifecycle state checked in every command's transaction, and no read settles a pending Game Account (`ADR-020` §4, FZ2–FZ3; `ADR-024` §2) |
| I18 | A Character's name stays reserved while its row exists — its Game Account pending included — and only the successful purge releases it; a historical record never reserves it | global uniqueness over every existing row, I27 (`ADR-024` NM2–NM3) |
| I19 | After a purge, no **live** product-persistence row names the purged Game Account, its Characters or their names, and the Login and every other Game Account are unchanged apart from documented scrubs. The internal history record (I26) and the ledger and entitlement-audit archives (`ADR-024` §3, PO-1) are the declared non-live locations | schema-derived closure test + post-purge scan over live persistence (`ADR-020` §7, `ADR-024` §3) |
| I20 | ~~A Bootstrap Kit item never leaves its Character~~ — **retired 2026-09-25**: the starter gear is ordinary items, and the tutorial potions follow I22–I23 (`ADR-024` §8) | — |
| I21 | A one-time Tutorial Reward is awarded at most once per Game Account | Game Account-owned claim state, checked in the awarding transaction; a case of I25 |
| I22 | A Character-bound consumable's binding is immutable and independent of its custody: a move between its Store Container and the Depot never changes it | enforced, never by convention; the binding is a referentially safe relation to one Character that the purge closure test and reference inventory can enumerate — its physical form is the implementing phase's choice (`ADR-021` §6–§7) |
| I23 | A Character-bound consumable is only ever in its bound Character's Store Container or the Account's Depot, is used only by that Character, never reaches the Stash, another Character, a market, a trade, an NPC sale, a Forge input or any currency conversion, and is deleted by that Character's purge wherever it is stored | server-side check on every custody, use and sale path, per instance; the purge selects by binding (`ADR-021`) |
| I24 | A Game Account has at most one Main Character at any instant, and nothing creates a second or a replacement | a persistence-level guarantee; its form is the implementing phase's (`ADR-022` GA1, `ADR-024` GD7). **Today** every Character is a Main in its vocationless Rookgaard state — an Origin Character, in the code's legacy name — and I1b allows at most one un-vocationalized one per Account; no constraint named for I24 exists |
| I25 | A one-time reward is claimed at most once per Game Account — never per actor, never per Login — whichever actor claims it and however often its content is replayed, and the claim commits with its grant | a uniqueness guarantee over the Game Account and the reward, in the granting transaction (`ADR-023` §2, QR9) |
| I26 | A historical deletion record never takes part in live ownership or custody, in restoring gameplay, in reward claims, or in any gameplay uniqueness rule, names included | written by the purge, immutable, and read by no gameplay path (`ADR-020` DH5, FZ6; `ADR-024` HR5) |
| I27 | A Character name is unique across the **whole game** — every existing Character of every Game Account | a persistence-level uniqueness guarantee (`ADR-024` NM1, `PHASE_GATES.md` § *G4.4*). **Today** only an application check per Account, among playable rows |
| I28 | An unlocked companion is never removed from its Game Account except by that Game Account's purge | no command path exists to delete, dismiss, replace, reroll, convert or re-lock one (`ADR-022` GA11) |
| I29 | `baseLevel` always equals the deterministic projection of `baseXp` | every XP write path updates both in one transaction; a rollback reverts both; migrations and backfills recompute the level (`PHASE_GATES.md` § *G4.2*) |

I17–I28 are **not implemented**. I17–I19, I26 and I27 are requirements of the PRE-PHASE-4 gate
(`PHASE_GATES.md` § *G4.1*, *G4.4*); I22–I23 of the bound-consumable gate (§ *GBC.1*). I24 must
hold wherever a Main is created, and no path replaces one (`ADR-024` GD7); Phase 4 extends it to
companions, together with I28. I25 is Phase 5's reward primitive; the one-time Tutorial Rewards of
I21 are its first case. I20 is retired. I29 is implemented on the Phase 2 write paths, and the
PRE-4 gate proves it on every path, rollback, migration and backfill (§ *G4.2*).

I8 and I10 are stated as *structural* rather than *validated*. A check that can be forgotten is
weaker than a path that does not exist.

---

## 8. Client authority — explicitly nothing

`LOCKED BY PRODUCT`. Stated here because the domain model is where authority leaks originate.

The client **never** owns: combat outcomes, RNG, loot, rarity, affixes, forge success, XP,
skills, currency balances, item ownership, market transfers, unlock state, activity progress,
elapsed time, or its own liveness claim.

The client owns: rendering, local UI preferences, and the *intent* to do something.

`DECIDED IN PHASE 0A` — **elapsed time is server-owned.** A client-supplied timestamp is never
an input to settlement, for either activity family. Wall-clock skill training is especially
exposed here: a client that can say how long it trained can mint skill progress.

---

## 9. Decisions taken under the Phase 0A delegation

The 0A.1 draft left six questions open. Under the delegated authority they are now **decided**
and applied consistently across the architecture set. Each is recorded where it belongs in §5;
this section is the index, with the reasoning compressed.

| # | Question | Decision | Where |
|---|---|---|---|
| 9.1 | Character deletion | **Superseded 2026-09-24 by the Product Owner:** a 30-day reversible grace, then a hard purge of the Character and everything it owns (`ADR-020`), amended on 2026-09-25 with 720 elapsed hours and a full freeze. **Superseded again 2026-09-25 (final synchronization):** the deletion target is the **Game Account** — a 720-hour frozen grace, then a hard purge of the whole campaign; the Login survives, nothing transfers, and an internal history record remains, with no public Deleted List (`ADR-024`). The Phase 0A decision — retirement, identity kept, items to an account recovery scope — is kept as history in `ADR-007`. | §5.3, `ADR-020`, `ADR-024` |
| 9.2 | Shared XP eligibility timing | **Re-evaluated at each settlement checkpoint**, on the same cadence as the participant profile. | §5.5, `ADR-006` |
| 9.3 | Concurrent session policy | **Newest connection wins and evicts the previous.** The activity claim transfers atomically. | §5.2, `ADR-008` |
| 9.4 | Loot Capacity scope in a party | **Pooled for the activity**, as the sum of participating characters' capacities. | §5.7 |
| 9.5 | Whose death ends a Hunt | **Full party wipe**, not first death. Downed members stop contributing and stop accruing. | §5.7 |
| 9.6 | "Floors" vs "rooms" | **Room** is the generic unit in domain, engine and content. *Floor* is a display label. | §5.8, §6 |
| 9.7 | Gold scope | **Account-scoped.** | §5.14, `ADR-003` |
| 9.8 | Vocation mutability | **Immutable through ordinary play** — decided here, not locked by product. | §5.3 |
| 9.9 | Party editing during an activity | **Rejected while an Activity runs**, with a clear reason to the client. | §5.5, `ADR-005` |

None of these is left to a builder to invent. Where a decision also changes a project-level
design rule — 9.6 in particular — `docs/DECISIONS.md` carries the same statement, so there is
one source of truth rather than an architecture document quietly disagreeing with the design
set.

### What remains genuinely undecided

Only **deferred parameters** — balance values that do not change any boundary, interface or
invariant:

- exact death penalty magnitudes (level/XP/skill loss, blessing effects);
- Gold prices for companion unlocks — roster slots 2–5;
- Shared XP bonus and distribution percentages;
- Skill Point award trigger and cost curves;
- rarity probabilities, affix pools and value bands;
- Forge success curves and costs;
- Exercise Weapon charges, dummy rates, offline training limits;
- combat tick duration and settlement checkpoint interval.

Each is consumed by the architecture as a **configuration input**, not as a structural
assumption. Changing any of them later is a content or config change, not a redesign. The
settlement checkpoint interval in particular is a tuning knob with a stated cost model: a
shorter interval bounds crash loss and shortens the level-up-to-power delay, a longer one
reduces write volume.

---

## 10. What 0A.1 deliberately did not decide

| Question | Belongs to |
|---|---|
| Every deferred parameter listed in §9 | balance design, not architecture |
| Credential storage, hashing, rotation, token mechanics | 0A.7 |

All other questions previously deferred from 0A.1 are answered in the completed package:
`CLIENT_SERVER_BOUNDARIES.md`, `DATA_ARCHITECTURE.md`, `SESSION_AND_ACTIVITY_LIFECYCLE.md`,
`GAME_ENGINE_ARCHITECTURE.md`, `CONTENT_DATA_ARCHITECTURE.md`, `ECONOMY_INTEGRITY.md` and
`OPERATIONS_ARCHITECTURE.md`. `ARCHITECTURE_OVERVIEW.md` is the entry point.

---

## 11. Architecture decisions recorded from this package

| ADR | Title | Status |
|---|---|---|
| [ADR-001](decisions/ADR-001-bounded-contexts-and-single-ownership.md) | Bounded contexts and single ownership of state | `ACCEPTED` |
| [ADR-002](decisions/ADR-002-activity-owns-in-flight-state.md) | Activity owns in-flight state; durable progression changes only at settlement | `ACCEPTED` |
| [ADR-003](decisions/ADR-003-ledger-derived-currency-balances.md) | Currency balances are ledger-derived projections | `ACCEPTED` |
| [ADR-004](decisions/ADR-004-item-single-custody.md) | ItemInstance has exactly one custody scope | `ACCEPTED` |
| [ADR-005](decisions/ADR-005-active-party-as-configuration.md) | Active Party is ordered configuration, not an entity | `ACCEPTED` — amended by `ADR-022` |
| [ADR-006](decisions/ADR-006-participant-profile-refresh.md) | Composition is frozen for a run; power refreshes at settlement checkpoints | `ACCEPTED` |
| [ADR-007](decisions/ADR-007-character-retirement.md) | Character deletion is retirement, not erasure | `SUPERSEDED` by `ADR-020` |
| [ADR-008](decisions/ADR-008-newest-connection-wins.md) | The newest authenticated connection evicts the previous one | `ACCEPTED` |
| [ADR-009](decisions/ADR-009-postgres-sole-durable-truth.md) | PostgreSQL is the sole durable truth; Redis holds nothing that cannot be rebuilt | `ACCEPTED` |
| [ADR-010](decisions/ADR-010-pure-engine-injected-clock-and-rng.md) | The engine is a pure function over explicit inputs, with injected clock and RNG | `ACCEPTED` |
| [ADR-011](decisions/ADR-011-content-as-versioned-artifact.md) | Content is a versioned build artifact, and activities pin their version | `ACCEPTED` |
| [ADR-012](decisions/ADR-012-modular-monolith.md) | One deployable modular monolith for Phase 0B | `ACCEPTED` |
| [ADR-013](decisions/ADR-013-character-activity-occupancy.md) | One primary action per Character, atomically enforced | `ACCEPTED` — amended by `ADR-022` |
| [ADR-014](decisions/ADR-014-per-character-stamina.md) | Stamina per Character, activated by first qualifying XP | `ACCEPTED` — amended by `ADR-022` |
| [ADR-015](decisions/ADR-015-active-use-duration-timers.md) | Active-use timers settle at checkpoints | `ACCEPTED` |
| [ADR-016](decisions/ADR-016-content-bundle-retention.md) | Content bundles retained while referenced | `ACCEPTED` |
| [ADR-017](decisions/ADR-017-idempotency-key-contract.md) | Idempotency keys account-scoped and fingerprinted | `ACCEPTED` |
| [ADR-018](decisions/ADR-018-domain-package-source-layout.md) | Bounded contexts in `packages/domain` — amends `ADR-012`'s layout | `ACCEPTED` |

Recorded later, outside this package: `ADR-019` (currency custody scopes, Phase 2),
[`ADR-020`](decisions/ADR-020-character-deletion-grace-and-purge.md) (Character deletion: a 30-day
reversible grace, then a hard purge — supersedes `ADR-007`),
[`ADR-021`](decisions/ADR-021-character-bound-consumables-and-store-container.md)
(Character-bound consumables and the Store Container),
[`ADR-022`](decisions/ADR-022-game-account-main-character-and-companions.md) (one Main Character
per Game Account; further vocations are companions),
[`ADR-023`](decisions/ADR-023-quest-replay-and-one-time-reward-claims.md) (quest replay is separate
from one-time reward claims),
[`ADR-024`](decisions/ADR-024-game-account-deletion-grace-and-purge.md) (Game Account deletion — it
supersedes `ADR-020`'s Character target) and
[`ADR-025`](decisions/ADR-025-tunable-configuration-surface.md) (one authoritative tunable
configuration surface). `ARCHITECTURE_OVERVIEW.md` is the full index.

---

## 12. The rest of the Phase 0A package

| Work package | Document |
|---|---|
| 0A.2 Client / server boundaries | [`CLIENT_SERVER_BOUNDARIES.md`](CLIENT_SERVER_BOUNDARIES.md) |
| 0A.3 Data and persistence | [`DATA_ARCHITECTURE.md`](DATA_ARCHITECTURE.md) |
| 0A.4 Session, presence and activity lifecycle | [`SESSION_AND_ACTIVITY_LIFECYCLE.md`](SESSION_AND_ACTIVITY_LIFECYCLE.md) |
| 0A.5 Game engine / simulation | [`GAME_ENGINE_ARCHITECTURE.md`](GAME_ENGINE_ARCHITECTURE.md) |
| 0A.6 Content / game data | [`CONTENT_DATA_ARCHITECTURE.md`](CONTENT_DATA_ARCHITECTURE.md) |
| 0A.7 Economy integrity and security | [`ECONOMY_INTEGRITY.md`](ECONOMY_INTEGRITY.md) |
| 0A.8 Infrastructure, observability, operations | [`OPERATIONS_ARCHITECTURE.md`](OPERATIONS_ARCHITECTURE.md) |
| 0A.9 Integration review | [`ARCHITECTURE_OVERVIEW.md`](ARCHITECTURE_OVERVIEW.md) |
| Occupancy, Stamina, active-use timers, Imbuements | [`ACTIVITY_OCCUPANCY_AND_TIMERS.md`](ACTIVITY_OCCUPANCY_AND_TIMERS.md) |
