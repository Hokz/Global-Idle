# Global Idle — Domain Model

**Document status:** `DRAFT` / PARTIALLY OPEN
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
| `OPEN — PRODUCT` | A game-design question. Architecture must not answer it. Recorded in §9. |

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
       │   Roster capacity  │                     │
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

---

## 4. Identity

`DECIDED IN PHASE 0A` — two identity families, deliberately different:

| Family | Form | Properties |
|---|---|---|
| **State entities** | opaque surrogate | globally unique, immutable, never reused, never guessable, never encodes meaning |
| **Content definitions** | canonical key, e.g. `creature.rookgaard.rat` | human-readable, stable across versions, namespaced by domain, greppable in content files |

`DEFERRED` to 0A.3: the concrete encoding (UUIDv7 / ULID / snowflake), key format rules, and
whether content keys carry a numeric alias for compactness on the wire.

Rationale: opaque ids for state prevent enumeration and stop business meaning leaking into
identifiers; readable keys for content make the content set reviewable in a pull request,
which is the whole point of separating it.

An imported reference to an external source (e.g. a Canary creature or item) is recorded as a
**source alias** on the content definition, never as the canonical key. `DEFERRED` to 0A.6.

---

## 5. State-bearing domain concepts

### 5.1 Account

**Purpose.** The ownership root. One human, one login, one wallet, one roster, one party. Every
question of the form *"who is allowed to do this?"* resolves to an Account.

| | |
|---|---|
| Identity | opaque surrogate, immutable |
| Owner | Identity & Access |
| Authoritative system | API/application layer |
| State | durable |
| Lifecycle | registered → active → suspended / closed. **Never hard-deleted** while it owns ledger or market history. |
| Mutable during an Activity | yes, but never in a way that alters the running Activity's participants |
| Transaction / audit | required for currency, entitlement and roster-capacity changes |

**Invariants.**
- `count(characters) ≤ rosterCapacity ≤ 5` — `LOCKED BY PRODUCT`
- character vocations are **distinct** within the account — `LOCKED BY PRODUCT`
- tutorial completion is tracked at account level, not inferred from character count —
  `LOCKED BY PRODUCT` (`TUTORIAL_ROOKGAARD_ROADMAP.md` §2)

**Relationships.** Owns Characters, roster capacity, currency balances, entitlements, market
listings. Is the subject of every ledger entry.

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

`OPEN — PRODUCT` — whether a second connection is refused, queued, or takes over and evicts
the first. §9.3. The single-claim invariant above holds under all three.

`DEFERRED` to 0A.4 — liveness mechanism, timeout detection, reconnect identity, and the exact
transport. Explicitly **not** choosing a heartbeat interval here.

---

### 5.3 Character

**Purpose.** A persistent vocation avatar with independent progression. Not a party slot, not
a companion — the party doc is explicit that unlocking a vocation *"creates a real persistent
character, not a temporary combat companion."*

| | |
|---|---|
| Identity | opaque surrogate, immutable |
| Owner | Character context |
| Authoritative system | API/application layer; mutated by Activity settlement |
| State | durable |
| Lifecycle | created → (origin: Rookgaard L1→8 \| unlocked: starts at L8) → progresses indefinitely |
| Mutable during an Activity | **progression only, and only through settlement.** Vocation, identity and roster membership are frozen. |
| Transaction / audit | settlement is transactional and carries an operation id |

**Invariants.**
- vocation is **immutable** once chosen at Level 8 — `LOCKED BY PRODUCT` (no respec rule exists)
- an unlocked (non-origin) character starts at Base Level 8, never enters Rookgaard, and
  receives no catch-up levels — `LOCKED BY PRODUCT`
- `DECIDED IN PHASE 0A` — the uniqueness of vocation per account must be enforced by a
  **persistence-level constraint**, not application logic alone. An application-only check
  loses to a concurrent double-unlock; this invariant is load-bearing for the entire roster
  model and deserves the database's guarantee.

**Relationships.** Belongs to Account. Owns Progression, Skills, Inventory, Equipment. May
appear in the Active Party. Is a participant in an Activity snapshot.

`OPEN — PRODUCT` — character deletion. §9.1. This is a live gap, not a hypothetical: the
tutorial document already describes a player deleting their first character.

---

### 5.4 Character Roster

**Purpose.** The set of characters an account has, and the capacity it has paid for.

`DECIDED IN PHASE 0A` — **the roster is not an entity.** It is two things wearing one name:

| Aspect | What it actually is |
|---|---|
| The *membership* | a **derived collection** — every Character whose owner is this Account. Nothing to store. |
| The *capacity* | **durable Account state** — an integer, because it is bought with Gold and must be auditable |

Modelling the roster as its own entity would create a second place where membership could
disagree with reality. Deriving membership makes divergence impossible.

| | |
|---|---|
| Identity | none of its own — addressed through the Account |
| Owner | Character context (membership) / Identity & Access (capacity) |
| State | membership derived; capacity durable |
| Lifecycle | capacity starts at 1 and only ever increases |
| Mutable during an Activity | capacity yes; membership yes — but neither affects a running Activity, which holds a snapshot |
| Transaction / audit | **required.** A capacity increase spends Gold, so it is a ledgered economy operation. |

**Invariants.**
- `1 ≤ rosterCapacity ≤ 5` — `LOCKED BY PRODUCT`
- capacity is monotonic — `DECIDED IN PHASE 0A`, pending the deletion question in §9.1
- a vocation already owned is never offered as an unlock choice — `LOCKED BY PRODUCT`

---

### 5.5 Active Party

**Purpose.** The player's chosen combat formation, drawn from the roster.

`DECIDED IN PHASE 0A` — see `ADR-005`. **The Active Party is durable configuration, not an
entity with its own progression.** It is an ordered list of at most four character ids held
against the Account. It has no XP, no level, no inventory, no identity that outlives a
composition change.

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
| Mutable during an Activity | **the configuration may be edited; the running Activity is unaffected**, because it holds an immutable participant snapshot |
| Transaction / audit | ordinary write, no ledger |

**Invariants.**
- `1 ≤ size ≤ 4` — `LOCKED BY PRODUCT`
- every entry is a Character of the same Account — `LOCKED BY PRODUCT`
- no entry appears twice; order is significant — `DECIDED IN PHASE 0A`
- five simultaneous active characters cannot be represented — `LOCKED BY PRODUCT`

**Shared XP eligibility** is a **derived predicate**, never stored as truth:

```text
minimumShareLevel = ceil(highestActiveLevel × 2 / 3)
eligible          = lowestActiveLevel >= minimumShareLevel
```

`DECIDED IN PHASE 0A` — eligibility is computed from the composition, never persisted as a
flag that could drift from the levels it describes. The UI preview in the party document
(*"Highest 250 / Lowest 166 / Required 167 / NOT ELIGIBLE"*) is the same computation rendered,
not a second stored value.

`OPEN — PRODUCT` — *when* eligibility is evaluated: snapshotted at activity start, or
re-evaluated continuously as members level up mid-hunt. §9.2. The domain model supports both
and does not choose.

---

### 5.6 Activity — the abstract concept

**Purpose.** A bounded run of simulated gameplay that produces progression. This is where the
game actually happens.

`DECIDED IN PHASE 0A` — see `ADR-002`. An Activity owns:

1. **Run state** — where the party is in the activity (room index, floor, supplies remaining).
2. **A participant snapshot** — the party composition and the character stats the run started
   with, frozen.
3. **An unsettled accumulator** — XP, gold, loot and consumption produced but not yet folded
   into durable state.
4. **A lifecycle state** — see 0A.4.

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

`OPEN — PRODUCT` — whose death ends the hunt in a multi-character party, and whether Loot
Capacity is per-character or pooled. §9.4, §9.5.

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

`DEFERRED` to 0A.6 — where unlock state lives (a per-account unlock set vs. flags) and how
puzzle/lever interaction state is represented.

**Terminology conflict, unresolved.** Dungeons use *floors*, Hunt Areas use *rooms*, and
`MASTER_DEVELOPMENT_ROADMAP.md` §9 describes a boss hall as *"10 encounter rooms"*. Three
structures, two words. This document uses the design documents' own terms and does not
unify them. §9.6.

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

`OPEN — PRODUCT` — maximum offline accrual duration, training rates, charge settlement. Already
recorded in `docs/OPEN_QUESTIONS.md`; not architecture's to answer.

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

---

### 5.11 Character Skills

**Purpose.** Numeric proficiencies — Sword, Axe, Club, Distance, Shielding, Magic Level.

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

`OPEN — PRODUCT` — the Skill Point award trigger (Model A vs Model B) and the cost curve remain
open in `COMBAT_LEVEL_SKILLS_FOUNDATION.md` §5, §45. The domain model works under either.

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
| Mutable during an Activity | loot arrives via settlement; `OPEN — PRODUCT` whether the player may re-equip mid-activity |
| Transaction / audit | every custody transition is transactional and audited |

**Loot Capacity** is a property of the owning character consumed by the engine as an input.
Full capacity stops collection without stopping combat — `LOCKED BY PRODUCT`.

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
| Lifecycle | materialized at settlement (loot) or by an economy operation (purchase, forge) → custody transitions → consumed (forge sacrifice) or destroyed |
| Mutable during an Activity | created by settlement; `OPEN — PRODUCT` for equip changes mid-run |
| Transaction / audit | **always** |

**Invariants.**
- exactly one custody scope at any instant — `DECIDED IN PHASE 0A`, `ADR-004`
- base item key + content version is immutable for the life of the instance
- rarity is rolled once at creation and never rerolled — `LOCKED BY PRODUCT`
- forge tier changes never alter rarity or affixes — `LOCKED BY PRODUCT`
- affixes, forge tier and imbuements are **independent layers** — `LOCKED BY PRODUCT`
- a consumed instance is terminal: it never returns to circulation

**Relationships.** References a BaseItem definition. Held by exactly one of: character
inventory, character equipment, market escrow, forge input, or a terminal consumed state.

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
| State | durable, **append-only, never updated, never deleted** |
| Lifecycle | written once, retained indefinitely |
| Mutable during an Activity | appended by settlement |
| Transaction / audit | it *is* the audit |

**Invariants.**
- entries are immutable — `DECIDED IN PHASE 0A`
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

---

### 5.17 Entitlement

**Purpose.** Premium and other account-level grants.

| | |
|---|---|
| Identity | opaque surrogate |
| Owner | Identity & Access |
| State | durable, time-bounded |
| Lifecycle | granted → active → expired/revoked |
| Mutable during an Activity | yes — but see the invariant below |
| Transaction / audit | required; purchase is an economy operation |

**Invariants.**
- `LOCKED BY PRODUCT` — **entitlement never grants a fifth Active Party member.** Party
  capacity is not an entitlement dimension at all.
- `DECIDED IN PHASE 0A` — **roster capacity is Account state, not Entitlement state.** It is
  bought with Gold, it is permanent, and it does not expire. Modelling it as an entitlement
  would wrongly imply it could lapse. The superseded documentation conflated these; the domain
  model keeps them apart.

`OPEN — PRODUCT` — what Premium *does* offer for party management now that the fifth slot is
superseded. Already recorded in `docs/OPEN_QUESTIONS.md`.

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
already fighting. `DEFERRED` to 0A.6 — pinning mechanics and the migration story when a
content version a running activity depends on is withdrawn.

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
| I1 | One character per vocation per account | persistence constraint |
| I2 | `count(characters) ≤ rosterCapacity ≤ 5` | persistence constraint + transaction |
| I3 | Active Party size 1–4, entries distinct, all owned by the account | transaction |
| I4 | An ItemInstance is in exactly one custody scope | persistence constraint |
| I5 | Balance projection reconciles to the ledger | transaction + reconciliation job |
| I6 | Ledger entries are append-only | persistence permission |
| I7 | Settlement is idempotent under its operation id | uniqueness constraint on operation id |
| I8 | A paused Activity cannot advance | Activity state machine — no tick path exists from the paused state |
| I9 | At most one Session holds an account's Activity claim | Activity ownership + atomic claim |
| I10 | Skill Training cannot write Base XP | interface capability, not runtime check |

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

## 9. Unresolved ownership and lifecycle questions

These are genuine gaps found by cross-reading the design set. They are **not** answered here.
Items 9.1, 9.4, 9.5 and 9.6 are new findings from this pass.

### 9.1 Character deletion — `OPEN — PRODUCT` — **new finding**

`TUTORIAL_ROOKGAARD_ROADMAP.md` §2 explicitly contemplates it: *"Player completes tutorial →
deletes first character → creates another character."* But `PARTY_SYSTEM_FOUNDATION.md` defines
a roster built on permanent, Gold-purchased, vocation-unique slots and never mentions deletion.

Unanswered: does deleting a Knight make Knight unlockable again? Is the Gold refunded? Is the
roster slot freed, or consumed forever? What happens to that character's items, and to ledger
entries naming it? Can the Origin Character be deleted at all?

This blocks the Character lifecycle. Architecture can implement any answer; it cannot pick one.

### 9.2 Shared XP eligibility evaluation timing — `OPEN — PRODUCT`

Snapshot at activity start, or continuous re-evaluation as members level? A party that starts
ineligible and crosses the threshold mid-hunt behaves differently under each. The model
supports both.

### 9.3 Concurrent session policy — `OPEN — PRODUCT`

Refuse the second connection, queue it, or evict the first? Recorded as open by the task scope
itself. Invariant I9 holds regardless.

### 9.4 Loot Capacity scope in a party — `OPEN — PRODUCT` — **new finding**

The tutorial document says *"Characters have a maximum Loot Capacity"* — per character. But a
party of four hunts as one unit against one loot stream. Is capacity per-character, or pooled
across the Active Party? Does a full Knight stop collecting while the Druid continues? This
changes both the engine's collection rule and the warning UX.

### 9.5 Whose death ends a Hunt — `OPEN — PRODUCT` — **new finding**

`docs/DECISIONS.md` says a Hunt *"ends on death"*, written before the party model existed. With
four active characters: does the first death end the run, or a full wipe? Do dead members stop
earning while survivors continue? Death is punitive and affects progression, so this is not
cosmetic.

### 9.6 "Floors" vs "rooms" — `OPEN — PRODUCT` — terminology

Dungeons use floors, Hunt Areas use rooms, and the master roadmap calls a boss hall "10
encounter rooms". Worth unifying before the dungeon engine is specified. Already raised on
PR #1.

### 9.7 Gold scope — `DECIDED IN PHASE 0A`, flagged for review

Decided account-scoped in §5.14 with rationale. Recorded here because it is product-adjacent
and the Product Owner may want it per-character. Reversible cheaply now, expensively after the
ledger ships.

---

## 10. What 0A.1 deliberately did not decide

| Question | Belongs to |
|---|---|
| Database tables, columns, indexes, Prisma schema | 0A.3 / Phase 0B |
| API endpoints, command shapes, event payloads | 0A.2 |
| Session liveness mechanism, heartbeat interval, transport | 0A.4 |
| Engine interface signatures, tick model, RNG seeding | 0A.5 |
| Content file format, validation, versioning mechanics, source aliasing | 0A.6 |
| Ledger entry schema, escrow mechanics, reconciliation cadence | 0A.7 |
| Monorepo layout, CI, observability, deployment | 0A.8 |
| Every `OPEN — PRODUCT` item in §9 and in `docs/OPEN_QUESTIONS.md` | the Product Owner |

---

## 11. Architecture decisions recorded from this package

| ADR | Title | Status |
|---|---|---|
| [ADR-001](decisions/ADR-001-bounded-contexts-and-single-ownership.md) | Bounded contexts and single ownership of state | `PROPOSED` |
| [ADR-002](decisions/ADR-002-activity-owns-in-flight-state.md) | Activity owns in-flight state; durable progression changes only at settlement | `PROPOSED` |
| [ADR-003](decisions/ADR-003-ledger-derived-currency-balances.md) | Currency balances are ledger-derived projections | `PROPOSED` |
| [ADR-004](decisions/ADR-004-item-single-custody.md) | ItemInstance has exactly one custody scope | `PROPOSED` |
| [ADR-005](decisions/ADR-005-active-party-as-configuration.md) | Active Party is ordered configuration, not an entity | `PROPOSED` |
