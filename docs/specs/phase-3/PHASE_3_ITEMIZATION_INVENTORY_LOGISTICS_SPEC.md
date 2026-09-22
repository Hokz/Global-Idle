# Phase 3 — Itemization, Inventory and Loot Logistics: Implementation Specification

**Document status:** `IMPLEMENTATION_SPEC_READY`
**Phase:** 3 — real items, real equipment, real containers, and the loop that moves them.
**Baseline:** Phase 0A `ARCHITECTURE_APPROVED` (ADR-001–ADR-019) · Phase 0B `VERIFIED` at `922e1c3`
· Phase 1 `IMPLEMENTATION_SPEC_READY` · Phase 2 **`VERIFIED`** at `03058b5`
**Source evidence:** [`PHASE_3_CANARY_SOURCE_MAP.md`](./PHASE_3_CANARY_SOURCE_MAP.md) — every number
below traces to a file and a symbol in `Hokz/canary` at `f6b81a8`.

> This document removes implementation ambiguity. Where a value could have been invented, the
> source map says where it came from; where Global Idle deliberately differs, it is labelled a
> decision. Where a number is genuinely still open, it is marked **INITIAL/TUNABLE** and lives in
> content or config so tuning is not a code change.

---

## 1. Goal and non-goals

### 1.1 What a player can do when Phase 3 is complete

The Origin Character wears **real items**. It carries a **real backpack** in the first of its five
Hunt Container Slots, with **real potions** in it. It enters the Rookgaard Sewers, kills a Rat, and
two different things happen: Gold credits the numeric **Gold Pouch** (Phase 2, unchanged) and,
39.41% of the time, a **cheese** is rolled, filtered by the **Loot Policy**, checked against
**space and Capacity**, and lands in the **Loot Pouch**.

Then it either survives or it does not. On death without Full Bless the Gold Pouch **and every
physical item in the Loot Pouch** are gone; the equipment, the containers, the supplies and
anything in the Depot or Stash are safe. On surviving, it leaves the Hunt, moves the kept loot into
a container, the **Depot** or the **Stash**, sells the cheese at a Rookgaard counter for Bank Gold,
buys more potions — paid **Gold Pouch first, Bank second** — and **Manage Containers** routes them
into the container that asked for potions. Combat next run uses whatever it is actually wearing.

**Phase 2's temporary itemless combat profile is deleted.** Not bypassed, not left beside the real
path: removed, with a test that asserts its absence.

### 1.2 What Phase 3 deliberately does not do

No Party. No vocation Skill progression and no durable Skill death loss. No Promotion or blessing
acquisition. No Reward Chest, boss, dungeon or quest framework. No Market, player transfer, PvP or
Warzone. No Bestiary, Charm, Forge, Imbuement, Wheel or Skill Tree. No Premium Auto-Sell and no
remote Premium refill. No regional progression rollout. No NPC chat tree or city simulation.

Seams only where a seam is genuinely cheaper than a later migration — §6.4 lists every one.

---

## 2. The two halves of an item

The distinction is **locked** and is the spine of this phase.

| | `ItemDefinition` | `ItemInstance` |
|---|---|---|
| What | immutable game data | an individual physical thing |
| Where | the **content bundle** — authored, hashed, published, versioned | the **database** |
| Identity | a stable `key` | a row id |
| Changes | by publishing new content | by moving, splitting, merging, equipping, selling, dying |

`ItemDefinition` is content for the same reason a creature is: it is authored, it is the same for
everyone, and a retune must be a content publish rather than a migration. It joins `creature` and
`hunt` in the existing bundle and inherits Phase 2's whole content pipeline — validation, hashing,
`ContentBundle`, the resolver, and the bootstrap check that the published version is the one the
health endpoint reports.

**There are not six static versions of an item for six rarities.** One definition; rarity and
affixes live on the instance.

### 2.1 `ItemDefinition` fields — Phase 3 needs only

```text
key              string        e.g. "item.cheese" — the stable Global Idle identity
sourceId         int           the Canary item id, e.g. 3607, for the source map
name             string        "cheese"
category         enum          FOOD | POTION | EQUIPMENT | CONTAINER | VALUABLE
weight           int           HUNDREDTHS of an ounce, the source's own unit
stackable        bool          from AppearanceFlags.cumulative
maxStack         int           255 for an ordinary stackable, 1 otherwise (§4)
stashEligible    bool          may enter the Stash (§10)
sellable         bool          may be sold at a counter
slot             enum?         HEAD | ARMOR | LEGS | FEET | LEFT | BACKPACK — equipment only
containerSpaces  int?          containers only
combat           object?       { armor?, attack?, defense? }
trade            object?       { buyPrice?, sellPrice? } — what a counter charges/pays
rarityEligible   bool          may be individualized with rarity and affixes (§5)
```

`forgeTier` is **not** a definition field and **not** a Phase 3 feature; `ItemInstance.forgeTier`
defaults to 0 and nothing reads it (§6.4).

### 2.2 `ItemInstance` — one row is one physical thing

**A row is an instance. A row of a stackable definition is one *stack* of an interchangeable
item.** That single rule satisfies every constraint at once:

- 600 potions are **three rows** (255 / 255 / 90), not 600 — the brief's worked example;
- a dagger is one row with `quantity = 1`, and its row id is its durable identity, carrying its
  rarity and affixes;
- unique equipment cannot be duplicated by stack logic, because `maxStack = 1` makes any quantity
  above 1 unrepresentable;
- an instance is in exactly one place, because custody is columns on the row and a database CHECK
  makes every other combination unrepresentable;
- nothing is a JSON inventory blob.

```text
id               uuid          the instance identity
definitionKey    string        into the content bundle
quantity         int           1..maxStack, CHECK quantity >= 1
accountId        string        always, for account-wide queries and the ownership FK
characterId      string?       set for EQUIPPED, CHARACTER_CONTAINER, LOOT_POUCH; null for DEPOT
location         enum          EQUIPPED | CHARACTER_CONTAINER | LOOT_POUCH | DEPOT
slot             enum?         EQUIPPED only
containerId      uuid?         CHARACTER_CONTAINER only — the container instance it sits in
rarity           enum          COMMON..STELLAR, default COMMON
affixes          jsonb         [] by default
forgeTier        int           0, reserved (§6.4)
createdAt        timestamp
```

**The Stash is not an `ItemInstance` table.** It is fungible by definition and aggregates past
`maxStack`, so it is `StashEntry(accountId, definitionKey, quantity)` — §10. Conceptually it is the
fifth location; physically it is the one place quantity is a number rather than a row.

---

## 3. Custody — one instance, one place, enforced by the database

`ItemLocation` values and what each requires:

| location | characterId | containerId | slot | slotIndex | meaning |
|---|---|---|---|---|---|
| `EQUIPPED` | required | null | **required** | null | worn; drives combat |
| `HUNT_CONTAINER` | required | null | null | **required 1..5** | an ACTIVE top-level container |
| `CHARACTER_CONTAINER` | required | **required** | null | null | inside an active container |
| `LOOT_POUCH` | required | null | null | null | collected by a Hunt, at risk on death |
| `DEPOT` | **null** | null | null | null | account storage, safe |

A `CHECK` enforces that table exactly, so "an instance in two locations" and "an equipped instance
also sitting in a backpack" are **unrepresentable**, not merely rejected. Ownership reuses the
ADR-019 pattern that Phase 2's integrity correction established: a composite foreign key
`(characterId, accountId) -> Character(id, accountId)`, so an instance cannot name a Character that
does not exist or one belonging to another Account.

**An active container is its own custody, not worn gear.** A Character wears one backpack and
installs up to five containers, so `EQUIPPED/BACKPACK` could never have represented slots 2 to 5.
`HUNT_CONTAINER` carries the `slotIndex` on the instance itself, and the slot row points back with
a **three-column foreign key**:

```text
CharacterContainerSlot(containerInstanceId, characterId, slotIndex)
  -> ItemInstance(id, characterId, slotIndex)
```

That one key is what makes four separate things true at once, in the database rather than in a
service:

| Guarantee | How |
|---|---|
| the container belongs to the Character whose slot it is | the pair `(id, characterId)` must match |
| a **Depot** container cannot be installed | a Depot row's `characterId` is null and the slot's is not |
| another **Account's** container cannot be installed | the instance's own `(characterId, accountId)` key already fixes the account |
| an installed container cannot move away leaving a dangling slot | its `slotIndex` would stop matching, so the move is refused unless the slot is cleared in the SAME transaction |

A container instance holds children that point at it with `containerId` — and with
`(containerId, characterId) -> ItemInstance(id, characterId)`, so **contents belong to the same
Character as their parent**. A CHECK forbids `containerId = id`.

**Uninstalling requires an EMPTY container.** Chosen and written down rather than left to whichever
branch ran first: moving a loaded container would have to answer "where did its contents go", and
every answer is worse than asking the player to empty it. Re-slotting an installed container from
slot 1 to slot 3 is not leaving, so it keeps its contents.

### 3.1 The five top-level Hunt Container Slots

**Locked: exactly five per Character.** One row per slot:

```text
CharacterContainerSlot(characterId, slotIndex 1..5, unlockedAt?, containerInstanceId?, routingCategory?)
PRIMARY KEY (characterId, slotIndex)
CHECK (slotIndex BETWEEN 1 AND 5)                      -- there is no slot 6
CHECK (containerInstanceId IS NULL OR unlockedAt IS NOT NULL)
```

- **Slot 1 is free** and is created unlocked with the Character.
- **Slots 2–5 are bought with Gold by that Character**, debited from the safe **Bank** (§11), and
  are **not account-wide**: five vocation Characters can hold up to 25 independent unlocks. It is
  an intentional, heavy, permanent sink.
- `containerInstanceId` is the one active container in that slot. **One slot, one container.**
- **No active-Hunt capacity multiplication through nesting:** a container instance may not have a
  `containerId`. Containers live in slots, never inside other containers. That is one CHECK, and
  it removes the whole class of exploit rather than policing it.

Prices are **content/config data**, INITIAL/TUNABLE, defaulting to the brief's discussed curve:

| slot | Gold |
|---|---|
| 1 | free |
| 2 | 10,000 |
| 3 | 100,000 |
| 4 | 1,000,000 |
| 5 | 100,000,000 |

---

## 4. Stacking

**Locked.** `ItemDefinition.maxStack` is authoritative:

- non-stackable → `maxStack = 1`;
- ordinary stackable → **255** by default.

255 is a game/content rule, not a language or database limit — and the source map records that it
is also **Canary's own parser ceiling**, while Canary's default is 100. The divergence is recorded,
not silent.

Operations, all server-authoritative and all atomic:

- **merge** — two rows of the same definition, same rarity, same affixes, same location, combine up
  to `maxStack`; the remainder stays in the source row, and a row that reaches 0 is deleted;
- **split** — a row splits into two, both `>= 1`;
- **partial move** — moving `n` of a stack is a split followed by a move of the new row;
- **max validation** — two limits, and they are not the same promise. The **database** holds
  `1 <= quantity <= 255`: a CHECK cannot read `maxStack`, because `maxStack` lives in a content
  bundle on disk and no constraint can open a file. 255 is the PHYSICAL ceiling, and it is the
  source's own parser ceiling. The **item-specific** `maxStack` is the domain's, asserted in the
  one function that brings rows into existence and in the one that adds to them, so a Dagger with
  a quantity of 2 is refused on every path rather than on the paths somebody remembered (**ITM11**);
- **no zero or negative quantity**, by the same CHECK;
- **conservation** — every operation preserves total quantity per definition per account, and the
  concurrency cases prove it under retry and under two writers.

**Individualized instances never merge.** A definition with `rarityEligible` produces rows whose
rarity and affixes are part of their identity, so two of them are two rows even when both are
Common with no affixes. That is what "unique equipment is not duplicated by stack logic" means in
practice.

---

## 5. Rarity and affixes

**One vocabulary, the existing one.** There is exactly one rarity enum in the repository:

```text
COMMON · SEMI_RARE · RARE · MYSTIC · LEGENDARY · STELLAR
```

No `Epic`. No second enum. Phase 3 adds no rarity name.

Generation, for a `rarityEligible` definition only:

```text
definition selected  ->  rarity roll  ->  affix roll(s)  ->  ItemInstance
```

- **Deterministic**, from the run's own identity stream — kept separate from combat and from
  physical loot so a rarity change cannot move a hit, and **continued across settlements** rather
  than reseeded at each one (Phase 3.5 §10, superseding the `createSeededRandom(\`${rngSeed}:${tick}\`)`
  rule this line used to state). A replay produces the same instance and a retry does not reroll.
- **Exponentially rarer** as rarity climbs. The initial distribution is **INITIAL/TUNABLE**, content
  driven, and deliberately conservative:

| rarity | weight | affixes |
|---|---|---|
| Common | 1000 | 0 |
| Semi-Rare | 100 | 1 |
| Rare | 10 | 1 |
| Mystic | 1 | 2 |
| Legendary | 0.1 | 2 |
| Stellar | 0.01 | 3 |

- The **minimal representative affix set** is two: `ARMOR_PLUS` and `ATTACK_PLUS`, each a small
  integer. That is enough to prove generation, persistence, combat effect and non-merging without
  designing an affix system this phase does not own.

**The Rat does not drop rarity-eligible equipment** — its entire table is gold and cheese. So the
live Hunt proves real physical loot, and rarity/affixes are proven on **deterministic authored
fixtures** over source-backed eligible item data. No creature is added to stage a demo.

No Forge. No Imbuement. `forgeTier` exists as a column defaulting to 0 and nothing reads it.

---

## 6. Equipment

### 6.1 Slots

From `Slots_t` (source map §7). Phase 3 implements `HEAD`, `ARMOR`, `LEGS`, `FEET`, `LEFT` (the
weapon hand) and `BACKPACK`; `NECKLACE`, `RIGHT`, `RING` and `AMMO` are in the enum so a later
amulet or ring is a content edit rather than a schema change.

### 6.2 Rules

- one instance cannot be equipped and stored elsewhere — the location CHECK makes it
  unrepresentable;
- **one item per slot**, by unique index on `(characterId, slot)` where `location = 'EQUIPPED'`;
- equip and unequip are **atomic** and validate the definition's `slot` server-side; an invalid slot
  is refused with a typed error, never trusted from the client;
- equipment **weight counts** toward Capacity;
- equipment **survives death** — always, with or without Full Bless;
- equipment **persists** across reload and restart.

### 6.3 Combat comes from what is worn

**Phase 2's `combat-profile.origin.rookgaard` content definition is deleted.** Combat inputs are
derived, per settlement, from the Character and its equipped instances:

```text
armor        = sum of equipped combat.armor  (+ ARMOR_PLUS affixes)
attackValue  = equipped LEFT weapon's combat.attack x WEAPON_ATTACK_PERCENT (120%)   [+ ATTACK_PLUS]
             = 0 when the weapon hand is empty -> the UNARMED path
defense      = Player::getDefense, as Phase 2 transcribed it
maxHealth    = the Character's, not an item's
attackInterval = the vocation's 2000 ms, unchanged
```

**Unarmed still works.** Remove the weapon and `Weapon::useFist`'s path runs, with the source's
`attackValue = 7` and its roll from zero. Phase 2 measured what that costs and the number does not
change: it is a losing fight, and it is the player's choice to have one.

The four leather pieces sum to armour 4 and the dagger gives attack 9.6 — the exact numbers Phase
2's profile carried, now arrived at rather than authored. **That equality is a test**, and it is
how "real equipment replaced the shadow profile" is proven rather than asserted.

### 6.4 Every seam, listed

| Seam | Why now | What reads it |
|---|---|---|
| `ItemInstance.forgeTier` default 0 | adding a column to a live item table later is a migration of every item | nothing |
| `NECKLACE`/`RIGHT`/`RING`/`AMMO` in the slot enum | same | nothing |
| `ItemDefinition.rarityEligible` | rarity must be able to say no | §5 |
| `StashEntry` as an aggregate | §10 | §10 |
| `CharacterContainerSlot.routingCategory` | §12 | §12 |

Nothing else. No item event-sourcing, no generic "attribute" table, no plugin system.

---

## 7. Capacity and weight

Three separate constraints, deliberately not conflated:

1. **top-level Container Slots** — five, unlocked or not (§3.1);
2. **internal spaces** — a container holds `containerSpaces` rows, one row per space (a stack is
   one space, which is what makes 600 potions cost three);
3. **weight against Capacity** — the physical one.

**Carried weight** is the sum over `EQUIPPED`, `CHARACTER_CONTAINER` and `LOOT_POUCH` of
`definition.weight × quantity`, which is `Item::getWeight` exactly.

**Capacity**, source-backed and single-Character:

```text
capacityHundredths = 40000 + (baseLevel - 1) * 1000        -- 400.00 oz + 10.00 oz per level
```

**The Gold Pouch is weightless and slotless.** It is a currency custody scope, not items.

When Capacity is insufficient:
- a new collection or an inbound move is **refused**;
- **nothing already carried is destroyed** — ever;
- **Hunt combat continues.** Being overweight is not a death sentence and not an exit.

Phase 4 owns the five vocations' `gaincap` values and Party aggregation. Phase 3 implements the one
Character it can represent, and says so.

---

## 8. The Loot Pouch

A per-Character **custody**, not an item: it cannot be moved, equipped, dropped or manually filled,
so modelling it as an item in a slot would create illegal states the server would then have to
forbid one by one.

- **finite** — `LOOT_POUCH_SPACES`, **INITIAL 20**, config-driven and explicitly not locked. 20 is
  the source's own loot-pouch `containersize`;
- **stack-based** — a space holds one row, subject to `maxStack`;
- **contributes weight**;
- **persists**, and survives a normal Leave;
- **at risk on death** (§9);
- **distinct** from the Gold Pouch, the Hunt containers, the Depot, the Stash and the future
  Reward Chest.

**The only automatic inbound is creature-generated ordinary physical loot.** Every manual inbound is
refused server-side with a typed error — from a Container, from Equipment, from the Depot, from the
Stash, from a counter purchase. The UI does not get to decide this.

**Outbound**, when the Character is in a legal, non-Hunt context: to a Character Container, to the
Depot, to the Stash. Auto-Sell is Phase 8 and is not implemented (§13).

**When it is full:** further loot is **not collected**, the Hunt **continues**, and a reason is
emitted as a Hunt event so the Game Window can say why.

---

## 9. Death — extending a `VERIFIED` rule

Phase 2's death settlement is `VERIFIED` and is **extended, not rewritten**.

| | without Full Bless | with Full Bless |
|---|---|---|
| Base XP | lost by Canary's formula | **lost by Canary's formula** |
| Gold Pouch | lost | kept |
| **Loot Pouch contents** | **all lost** | **kept** |
| equipment | safe | safe |
| Hunt containers and contents | safe | safe |
| brought supplies | safe | safe |
| Depot, Stash | safe | safe |

Full Bless is still not a free death: the XP loss applies and the Hunt ends.

**Mechanics.** The forfeiture runs inside the same transaction, under the **same terminal row lock**
the Phase 2 integrity correction established — the run row is locked and tested in one statement,
so a second concurrent caller applies nothing. It is atomic with the death, once-only under retry,
concurrency and restart, and it touches nothing outside `location = 'LOOT_POUCH'` for that
Character.

**Auditable enough to explain the loss:** a `hunt.death.loot-forfeit` domain event carries every
definition key and quantity that was destroyed, beside the existing experience and gold numbers.
This is deliberately **not** an item ledger: the brief forbids building universal item
event-sourcing that the invariants do not require, and the invariant here is "explain one event",
not "replay all history".

---

## 10. Depot and Stash

### 10.1 Depot — account-level physical storage

Holds `ItemInstance` rows with `location = 'DEPOT'` and `characterId = NULL`: instances, containers,
unique affixed equipment, and physical stacks that were not stashed. It exists so one Character can
leave something for another.

- **account-scoped**, not Character Carry Capacity — Depot contents have no weight;
- accessible only in a valid service/safe context, **never during an active Hunt**;
- **bounded and paginated**, not an unbounded account blob: `DEPOT_SPACES`, **INITIAL 200**,
  config-driven, with the API paging. Two different promises, and both are kept: the STORE is
  bounded by `DEPOT_SPACES`, and the RESPONSE is bounded by a window — `GET …/depot?offset&limit`,
  applied by the database with `total` beside it, default 50 and maximum 200. The inventory read
  carries the first page so the System UI has something to draw. A nonsense window is refused
  rather than clamped.

### 10.2 Stash — account-level fungible bulk

```text
StashEntry(accountId, definitionKey, quantity)   PRIMARY KEY (accountId, definitionKey)
```

- only definitions with `stashEligible = true` may enter — creature products, materials, eligible
  consumables. **Individualized affixed equipment is refused**, and so is anything with affixes or
  a rarity above Common;
- conceptually `itemKey -> large quantity`, which is why it is an aggregate rather than rows;
- **transfers**: Container → Stash, Loot Pouch → Stash, Depot stack → Stash, Stash → Container,
  Stash → Depot;
- **withdrawal materializes legal `maxStack` stacks** — asking for 600 potions produces
  255 / 255 / 90 across three spaces, and fails atomically if there is not room for all three;
- **no active-Hunt access**;
- cap is `STASH_MAX_PER_ENTRY`, **INITIAL 100,000**, tunable.

---

## 11. Bank interaction — only what this phase needs

Phase 6 still owns the Bank product. Phase 3 implements:

- **display** the Bank balance and the Gold Pouch, separately;
- **deposit** Gold Pouch → Bank, as ADR-019 double entry;
- **container slot unlock** debits the **Bank**;
- **sale proceeds credit the Bank**.

Nothing bypasses the ledger or the custody scopes. Every movement is an ordinary `post`/`transfer`
with a reason code and an operation id.

**Purchase spending priority is locked: Gold Pouch first, Bank second.** A purchase that needs both
is one transaction with two debits under one operation id.

**There is deliberately NO Bank withdrawal.** An earlier draft of this section claimed one, and the
API never had it. Nothing in the Phase 3 loop needs it: a purchase already debits the Bank directly
when the Pouch is short, the slot unlock debits the Bank, and a sale credits it. The only thing a
withdrawal would add is a way to move safe Gold somewhere a death can take it — a feature, when
Phase 6 wants one, not an omission. The claim is removed rather than the route invented.

---

## 12. Manage Containers — routing

Each unlocked slot may carry a `routingCategory`. Examples: Potions, Runes, Rings, Amulets,
Utility. It is used when items arrive from a **known, legal, non-loot** source:

- a counter purchase or refill;
- a Stash withdrawal;
- a Depot withdrawal.

**Ordinary creature loot never routes here.** It enters the Loot Pouch and nowhere else.

Routing respects the unlocked slot, the installed container, `maxStack`, free spaces, Capacity and
category compatibility. The fallback is a stable, three-step ladder:

1. the **preferred** container whose category matches;
2. otherwise the compatible active containers, in **ascending slot order**;
3. otherwise the operation **fails atomically** — the source keeps its items, the Gold is not
   charged, and the error says which constraint stopped it.

**Items never disappear**, and no partial charge is ever taken for an undelivered good.

---

## 13. NPC services — the smallest Rookgaard loop

One content-authored **service counter**, not an NPC chat tree and not a city.

**BUY / REFILL** — small health potion `7876` at **20 gold** (source-backed):
- spending priority **Gold Pouch → Bank**;
- delivery routed through Manage Containers (§12);
- **atomic**: insufficient funds, no space or insufficient Capacity fails the whole thing;
- **never charge if delivery fails**;
- refill is the same operation with a convenient quantity, stacking and routing correctly.

**SELL** — cheese `3607` at **2 gold** (source-backed):
- proceeds credit the **Bank**;
- the sold quantity or instance leaves custody exactly once;
- protected and non-sellable definitions are refused;
- **no selling during an active Hunt**.

### 13.1 Service access — no remote cheats

Two contexts, and the server decides which one the Character is in:

| | in an active Hunt | in a safe/service context |
|---|---|---|
| Depot | **refused** | allowed |
| Stash | **refused** | allowed |
| buy / refill / sell | **refused** | allowed |
| Bank display | allowed | allowed |
| Bank deposit/withdraw | **refused** | allowed |
| move between carried locations | allowed | allowed |

"Active Hunt" is exactly the Phase 2 occupancy claim. Infinite remote supplies are not possible
because there is no path that reaches a counter while the claim is held.

---

## 14. Hunt integration and determinism

On a kill, in this order, inside the existing checkpoint transaction and under its operation id:

1. Phase 2 reward eligibility — Stamina, Premium band, everything already `VERIFIED`;
2. the **deterministic physical loot roll**, from the same seeded stream as the fight;
3. **zero Stamina blocks the reward** — no XP, no Gold, **no physical loot** — and combat continues;
4. **Loot Policy** decides collection (§15);
5. **space and Capacity** are checked;
6. accepted, legal loot enters the **Loot Pouch**;
7. the checkpoint persists the whole reward state atomically.

The **engine** rolls what dropped; the **domain** decides what is collected. That split is why a
replay is identical: the roll is a pure function of the persisted position, and policy, space and
Capacity are durable state the engine never sees.

A retry or restart must not reroll a settled kill, duplicate a stack or an instance, roll rarity or
affixes twice, or leave XP, Gold and items disagreeing about whether a kill settled. The existing
`settlementOperationId(activityId, sequence)` + `claimSettlement` pair already guarantees this, and
Phase 3 adds nothing outside it.

---

## 15. Loot Policy

Server-authoritative. It answers **"pick it up?"** and nothing else; what happens after collection
is Phase 8's Auto-Sell and is not implemented here.

**Modes**
1. `COLLECT_ALL_EXCEPT_SKIPPED` — take everything except what is explicitly skipped;
2. `ACCEPTED_ONLY` — take only what is explicitly accepted.

**Precedence**, highest first: **item override → category → rarity → default/mode.**

A rejected drop **never enters the Pouch**, uses **no space**, uses **no Capacity**, and is **not**
auto-sold. It simply did not happen, and the Game Window says so.

Policy is **per Character** for this implementation, with the row shaped so account-level presets
remain possible without a migration.

---

## 16. Concurrency and anti-duplication

This phase creates valuable assets, so the guarantees are stated as invariants and each has a case:

| Invariant | Held by |
|---|---|
| an instance id is unique | primary key |
| an instance is in exactly one location | the location CHECK |
| an instance belongs to a real Character of the stated Account | composite foreign key, ADR-019's pattern |
| a container cannot nest | CHECK `containerId IS NULL` for CONTAINER definitions |
| one item per equipment slot | partial unique index |
| quantity is 1..maxStack | CHECK |
| stack total is conserved | split/merge in one transaction, proven under a race |
| move/move cannot clone | row lock on the instance, in the §8.5 order |
| move/sell cannot both win | the same lock |
| equip/move cannot both win | the same lock |
| a death forfeits once | the Phase 2 terminal lock, unchanged |
| a slot unlock happens once | operation id + unique `(characterId, slotIndex)` unlock |

**Lock order** extends §8.5 without reordering it:

```text
Account -> Character (asc id) -> Activity (and its HuntRun)
        -> ActivityParticipant -> OccupancyClaim
        -> ItemInstance (asc id) -> CurrencyBalance (asc subjectId) -> LedgerEntry
```

`ItemInstance` sits after the claim and before the balances, because an item operation that also
moves money always moves the item first.

No universal item event-sourcing is built. The invariants above are held by constraints and locks,
which is cheaper and stronger than a log nobody replays.

---

## 17. API

All server-authoritative, all under the existing session and character authorization.

```text
GET    /api/characters/:id/inventory          equipment, slots, containers, loot pouch, capacity, gold, stash
GET    /api/characters/:id/depot              ?offset&limit — a window, with the total beside it
POST   /api/characters/:id/items/move         { instanceId, quantity?, to: {...} }
POST   /api/characters/:id/slots/:n/unlock    Bank-debited
PUT    /api/characters/:id/slots/:n/routing   { category | null }
PUT    /api/characters/:id/loot-policy        { mode, rules }
POST   /api/characters/:id/service/buy        { definitionKey, quantity }
POST   /api/characters/:id/service/sell       { instanceId, quantity? }
POST   /api/characters/:id/stash/deposit      { instanceId, quantity? }
POST   /api/characters/:id/stash/withdraw     { definitionKey, quantity, containerId }
POST   /api/characters/:id/gold/deposit       pouch -> bank
```

There is no separate equip/unequip route and no `items/install`: **equipping and installing are
destinations of the one move**, `to.kind` of `EQUIPPED` or `HUNT_CONTAINER`. One primitive, one
place where every legality rule lives. And there is no `gold/withdraw`, for the reason §11 gives.

**Every mutating call REQUIRES an `Idempotency-Key` header**, exactly as Phase 1's Hunt entry does,
and refuses with `IDEMPOTENCY_KEY_REQUIRED` (422) without one. The fingerprint is the CLIENT's
command and nothing else — no timestamp, no server-resolved content version — so a retry after a
lost response replays instead of buying a second backpack, and the same key with a different
command is an explicit `IDEMPOTENCY_CONFLICT` (409). The operation id every ledger post uses is
derived from the same key, so the settlement guard and the command guard agree.
Every one validates ownership, source custody, destination acceptance, access context, stack limits,
space, Capacity, slot legality, `stashEligible`, the Loot Pouch inbound prohibition and
`quantity > 0` — **on the server**, regardless of what the UI sent.

---

## 18. System UI

A **third surface**, beside the Atlas (navigation) and the Game Window (watching). It manages.

Shows and manages: equipment; the five top-level Container Slots with their locked/unlocked state
and prices; container contents; the Loot Pouch; Capacity and weight; the Gold Pouch; the Bank; the
Loot Filter; the Depot and Stash when accessible; and buy/sell/refill when accessible.

**Desktop:** drag and drop, context actions, a split/move amount control, and clear feedback on an
invalid drop that says *why*.

**Touch:** no hover dependency anywhere. Tap to select, long press for a context sheet, an explicit
**Move** action, an amount selector, equip/unequip, deposit/stash/sell.

**The Game Window additionally shows** physical loot events, Loot Pouch occupancy, and the reason a
drop was skipped — policy, no space, or over Capacity.

---

## 19. Persistence and migrations

Three migrations, hand-written in the established style. The first adds `ItemInstance`,
`CharacterContainerSlot`, `StashEntry`, `CharacterLootPolicy`, the enums, and every CHECK and index
§3 and §16 name. The second adds the `HUNT_CONTAINER` enum value alone — PostgreSQL will not let a
transaction use a value it added itself. The third adds `ItemInstance.slotIndex`, moves every
already-installed container into its real custody, and replaces the two single-column foreign keys
with the composite ones §3 describes. It must
apply cleanly from an empty database and from the previous migration state, and leave no drift.

The Origin Character's grant (source map §11) is applied at character creation: four armour pieces
equipped, a backpack **installed** in Slot 1, and small health potions inside it.

---

## 20. Test matrix

Machine-countable, in `docs/specs/phase-3/…` §20 and counted by `scripts/count-matrix.mjs` beside
the three existing matrices. **Phase 0B 92/92, Phase 1 87/87 and Phase 2 106/106 are preserved
exactly — no id is renumbered and no case is deleted.**

| Group | Cases | What it fixes |
|---|---|---|
| **ISR** — item source and data | ISR1–ISR8 | the Canary item and loot fixtures, the Rat's physical loot, weights, stackability, container capacity, and invalid content rejected |
| **ITM** — item model | ITM1–ITM11 | ItemDefinition vs ItemInstance, unique identity, stack and non-stack, maxStack (**ITM11**: the DOMAIN refuses a quantity above the definition's), one rarity enum, deterministic rarity and affixes |
| **EQP** — equipment | EQP1–EQP8 | the real tutorial equipment, combat derived from it, equip and unequip, invalid slot, persistence, survives death, unarmed still works |
| **ACT** — active Hunt containers | ACT1–ACT7 | installed is a fact both rows carry; another Character's and another Account's container refused; a Depot container is not active; an installed one cannot slip away behind its slot; contents cannot change owner; five slots, no sixth |
| **CSL** — container slots | CSL1–CSL11 | exactly five, slot 1 free, slots 2–5 per-Character Gold unlock, Bank debit, no duplicate, no slot 6, another Character unaffected, **and the whole acquire → install → route → remove flow** |
| **STK** — stack and space | STK1–STK7 | 255, 600 → 255/255/90, split, merge, a full container, no nesting exploit |
| **CAP** — capacity | CAP1–CAP5 | physical weights count, Gold does not, overweight collection and moves refused, nothing destroyed |
| **LPH** — loot pouch | LPH1–LPH9 | Rat loot enters, Gold does not, manual inbound refused, outbound valid, finite, full stops collection and not combat |
| **POL** — loot policy | POL1–POL6 | both modes, and the item → category → rarity → default precedence |
| **DTH** — death extension | DTH1–DTH6 | no Full Bless loses pouch and gold once, Full Bless keeps both, equipment/containers/Depot/Stash safe, concurrent and retry safe |
| **DPT** — depot | DPT1–DPT4 | account ownership, deposit, withdraw, inaccessible during a Hunt |
| **STH** — stash | STH1–STH8 | stashEligible only, quantity, withdrawal materializes stacks, unique equipment refused, inaccessible during a Hunt, **and reachable through the API in both directions** |
| **MOV** — movement | MOV1–MOV10 | split, merge, cross-storage, illegal destination, ownership violation, move/move race, move/sell race, conservation, **the access rule proved at the DOMAIN**, and a loaded container that cannot leave its slot |
| **RTE** — routing | RTE1–RTE6 | purchase to preferred, fallback, full preferred, no destination → no charge, **and a category set through the API** |
| **BNK** — bank and gold | BNK1–BNK6 | balanced deposit, Pouch-first/Bank-fallback, slot unlock debit, sale to Bank, zero reconciliation mismatches |
| **NPC** — service | NPC1–NPC5 | buy, refill, sell, and no remote service during a Hunt |
| **HNT** — hunt integration | HNT1–HNT6 | deterministic loot, zero Stamina, retry without duplicate, reload and restart, Room 10 continues |
| **OWN** — who may act on an item | OWN1–OWN6 | A cannot sell or stash B's item, nor touch it while B hunts; equipped and installed must be released first; the Character's own carried items and the account Depot still work |
| **RET** — retirement | RET1–RET2 | a retired Character is not playable, and every player-facing surface agrees |
| **VAL** — the input edge | VAL1–VAL5 | a non-numeric amount, a NaN quantity or slot, an unknown routing category, malformed or oversized loot rules, and an over-long idempotency key are all **4xx**, never 500 |
| **IDM** — idempotency | IDM1–IDM7 | a key is required; duplicate buy, deposit and partial sell each apply once; the same key with a different command conflicts; a retry returns the durable result; every mutating route swept, not sampled |
| **LCK** — the last free space | LCK1–LCK4 | two concurrent arrivals, the loser not charged, concurrent Stash withdrawals, concurrent drops into the last Pouch space |
| **SYS** — System UI and E2E | SYS1–SYS16 | the System UI, equipment, five slots, desktop drag, touch move, the Loot Pouch, a filter change affecting future loot, Depot/Stash context, purchase and refill, Hunt physical loot, death loot loss, reload, **unlock-and-install, taking a container back out, a touch Stash round trip, and a routing preference that survives a reload** |
| **MIG** — migration and invariants | MIG1–MIG6 | empty database, previous state, no drift, the custody constraints, no duplication |

**Totals: 24 groups, 169 cases** — ISR 8, ITM 11, EQP 8, ACT 7, CSL 11, STK 7, CAP 5, LPH 9,
POL 6, DTH 6, DPT 4, STH 8, MOV 10, RTE 6, BNK 6, NPC 5, HNT 6, IDM 7, LCK 4, **OWN 6**,
**RET 2**, **VAL 5**, SYS 16, MIG 6.

Two correction passes added 44 cases and **renumbered none**: every id from the reviewed 125
means what it meant, and the new ones continue their groups or open new ones.

Every prefix is three letters and none of them collides with an existing group: the counter routes
an id by its longest matching prefix, and `STK`/`STH` win over Phase 2's `ST`, `SYS` over Phase 1's
`S`, `CAP`/`CSL` over Phase 0B's `C`, and so on. That is the whole reason the codes are not `S3`,
`C3` and friends.

---

## 21. Definition of Done

1. Phase 2 stays `VERIFIED` and untouched: 106/106, and no Phase 2 case weakened.
2. Phase 0B 92/92 and Phase 1 87/87 unchanged.
3. The Phase 3 matrix is green, and `scripts/count-matrix.mjs` reports four matrices.
4. Every gate: format, lint, boundaries, typecheck, fixtures, Canary fidelity, content validation,
   migration validation, integration, invariants, builds, Playwright desktop and touch, `pnpm dev`.
5. The Phase 2 combat profile is **gone**, and a test asserts its absence.
6. The full diff is self-reviewed.
7. Status: **`IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`**. No self-merge.
