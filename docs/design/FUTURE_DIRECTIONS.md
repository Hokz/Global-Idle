# Future product directions — RECORDED, NOT IMPLEMENTED

**Status:** `DIRECTION` — recorded so later phases inherit intent instead of re-deriving it.
**Nothing here is implemented, and nothing here is a commitment to exact numbers.** Where a
number appears it is illustrative; the owning phase decides it.

No Requirement engine, Bestiary, Charm system, regional-point system, Imbuement material farming,
outfit system or achievement engine is to be coded before the phase that owns it — and not in
Phase 2 at all, beyond a tiny primitive Phase 2 genuinely cannot avoid.

---

## 1. World / regional progression

**Owner: Phase 9 — Content Expansion** (the primitive it leans on is Phase 5's Requirement /
Cost / Reward).

Rookgaard is the **first mandatory progression area**. Everything after it branches. *Since
2026-09-25 it is also a permanent, single-player region where a player may stay indefinitely
([`../DECISIONS.md`](../DECISIONS.md) § *Rookgaard*).*

- on reaching Mainland/Thais, regional objectives and tasks award **progression points**;
- points are spent to unlock **player-chosen** cities and routes;
- progression **branches** rather than forcing one linear city order;
- region unlocks are intended to be **account-wide**, unless a later design deliberately changes
  it — and that change would be a decision, not a drift;
- a **recommended level** may warn without hard-locking every Hunt. The game reports state; the
  player decides;
- special areas may sit behind quests, items or other requirements.

The open question this leaves is what generates points and at what rate, which is the owning
phase's to answer.

## 2. Requirements, costs and rewards

Hunts, Dungeons, Quests and Travel may **require or consume items**: Rope, Shovel, Machete,
Pickaxe, keys, quest materials, travel items.

Two rules keep this from becoming a tax:

- **requirements must not turn every Hunt into a toll.** The ordinary loop stays free;
- special or unusually rewarding access content is where recurring costs and permanent unlocks
  belong.

The intent is **item sinks and Market demand** — a reason for the economy to move — not friction
for its own sake.

## 3. Bestiary and Charms

**Owner: Phase 7 / 7A — Advanced Progression.** Not Phase 9: the content that feeds a kill counter
is a consumer of this system, not its owner.

Tibia identity is the baseline (`REFERENCES.md`). *`LOCKED` direction, 2026-09-25
(`DECISIONS.md` § *Bestiary*): the Tibia Global Bestiary is the baseline for structure, creature
characterization, categories and kill thresholds; the phase that builds it verifies the
then-current values from reliable sources and records what it adopts, and nothing is frozen from
memory before then. It reveals resistances and weaknesses through progression, for build
planning.*

- creature **kill counters** unlock Bestiary entries and their information;
- Bestiary progress awards **Charm Points**;
- Charm Points unlock **Charm Runes**;
- Global Idle may use a **multi-stage** Charm progression; the exact numbers are later design.

Bestiary and Charms are **progression separate from Gold and Base Level**. A player who has
neither levelled nor earned still has something advancing.

## 4. Imbuement materials, outfits, achievements

- creature materials feed future **Powerful Imbuements** (one tier only — `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §6);
- **outfits, addons and auras** are earned through quests, materials or the store, as configured.
  They are cosmetic unlocks, outside `ADR-021`'s Character-bound item model, and never Store
  Container items — their own unlock model is still open;
- **achievements** track meaningful progression milestones.

---

## 5. Engineering deadlines the retrospective audit found — GATED, NOT OPEN

An audit across PR #1 to PR #8 found no reason to rewrite the architecture and a set of things
that must land **before a named gate**. They are written with their gate so they cannot become
forgotten OPEN notes.

### Before Phase 4 (roster)

- **Game Account deletion lifecycle** (`LOCKED`, `ADR-024`, reusing `ADR-020`'s mechanics;
  `ADR-020` superseded the retirement this item used to describe). A deletion request puts the
  **whole Game Account** into a reversible grace of exactly 720 elapsed hours, fully frozen; then
  a hard purge removes all live Game Account state — the Main, every companion, items, Pouches,
  Bank, Depot, Stash, progression and claims. Nothing transfers to another Game Account or the
  Login, which survives, and nothing creates a replacement Main. One lifecycle serves every
  deletion source, moderation included, and an internal history record for support remains — no
  public Deleted List. The work is the purge's closure inventory and its atomic, idempotent,
  race-safe execution, the replacement of `retiredAt`, and a Login represented apart from its Game
  Accounts. Phase 3's `RET1` and `RET2` were a retirement filter, not a flow, and are superseded
  rather than extended. The Character-scoped rules of 2026-09-24 — G4.1b's holds, G4.1c's tutorial
  survival and the Bootstrap Kit — are superseded; G4.1a's destroyed Gold Pouch stands — see
  [`../PHASE_GATES.md`](../PHASE_GATES.md) § *G4.1*.
- **Globally unique Character names**, enforced at persistence level, with a pending Game
  Account's names reserved until its purge — [`../PHASE_GATES.md`](../PHASE_GATES.md) § *G4.4*.
- **One authoritative tunable configuration surface** (`ADR-025`) before Phase 4 adds its tunable
  values — [`../PHASE_GATES.md`](../PHASE_GATES.md) § *G4.5*.
- **Enforce the `baseXp` → `baseLevel` projection.** Not a question of which is authoritative:
  `baseXp` is the durable truth and `baseLevel` its stored projection, already decided and
  implemented (`schema.prisma`, `contexts/hunt/progression.ts`). What is missing is enforcement on
  every write path, migration and rollback, so the pair cannot drift —
  [`../PHASE_GATES.md`](../PHASE_GATES.md) § *G4.2*.

### Before Market / Forge / Imbuement

- **An ADR for `ItemDefinition` version semantics.** What happens to live `ItemInstance` rows when
  a definition's weight, stackability or slot changes in a new content bundle. Phase 3 pins the
  bundle per Activity; a traded or forged item outlives one Activity.
- **Validate impossible rarity/affix identities.** Today an affix array is JSON the domain writes
  and trusts. A market lets someone else's row reach your inventory.

### Before the first Character-bound consumable (Store, Daily Reward, Event or tutorial)

- **Binding separate from custody, and the Store Container** (`LOCKED`, `ADR-021`). A consumable
  bound permanently to one Character — an XP Boost, a Store-bought Exercise Weapon, a Daily Reward
  or Event consumable — moves only between that Character's Store Container and the Account's
  Depot, is used only by that Character, is never sold, traded, listed, stashed, forged or
  converted, and is purged with its Game Account wherever it is stored. It belongs to no fixed
  phase: Phase 8 is the obvious consumer, but whichever phase ships the first bound item builds
  this first — [`../PHASE_GATES.md`](../PHASE_GATES.md) § *GBC.1*. The Store sells consumables,
  never combat equipment. Since 2026-09-25 the tutorial's Health and Mana potions are bound
  consumables too, used straight from the Store Container through the action slots. Which phase
  first issues them bound is open (`ADR-024` DEL-O5).

### Before Phase 5B (multiplayer)

> These, and the Phase 4 and market gates, are now stated in full in
> [`../PHASE_GATES.md`](../PHASE_GATES.md). This list is the origin; that document is the
> canonical statement.

- **Multi-account Activity membership**, the Character→membership invariant, and competitive
  liveness semantics. `MULTIPLAYER_ACTIVITIES_FOUNDATION.md` has the design,
  [`multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](multiplayer/COOPERATIVE_QUEST_STRATEGY.md) has
  the player-facing model, and the invariants are the part that must exist before two accounts
  share one Activity.

### Before beta / scale

- `IdempotencyRecord` retention; `SettlementOperation` retention and a compaction proof; content
  bundle archival policy; an object-storage provider; a backup/restore rehearsal; production rate
  limiting and auth hardening; load profiling.

---

## 6. Product directions the audit surfaced — RECORDED, NOT IMPLEMENTED

Each shapes Phase 4+ design. None expands Phase 3.5.

| Direction | What it is | Likely owner |
|---|---|---|
| **Tactical Automation Profiles** | target priorities, movement policy, supply thresholds, risk/retreat behaviour — the player's *strategy* rather than their *reflexes* | Phase 4 |
| **Hunt Route Strategy** | Safe / Balanced / Aggressive / Loot-oriented route policy over a real map | after Phase 3.5 gives routes a map |
| **Spatial Party Formation** | frontline, range, support radius, vocation positioning | Phase 5B |
| **Tactical policy primitives** | target selection, healing, supply use, risk/retreat, role — baseline gameplay, never paywalled | Phase 4 |
| **Run Analyzer** | XP/h, Gold/h, loot, supply burn, movement vs combat time, damage/healing, capacity utilisation | Phase 4 |
| **Balance Simulation Laboratory** | a headless bulk-run tool for balancing, over the deterministic simulator that already exists | Phase 4 |
| **Deterministic Run Replay / Debug Inspector** | reproduce one Activity from seed + content + state | Phase 4 |

The last two are nearly free: the simulator is already deterministic from `(seed, content, state,
elapsed)`. What is missing is a harness, not an engine.

---

## Why this is written down now

Each of these changes what a *later* phase's data needs to carry. A creature that will one day
feed a Bestiary counter and drop an Imbuement material is better defined once, with that in
view, than redefined three times. Recording the direction costs a page; discovering it after
three phases of content costs a migration.

---

## Recorded in their own documents

Three areas outgrew this file during the Phase 2 correction pass and moved into documents of their
own. They are still FUTURE and still NOT IMPLEMENTED; they are simply too specific to live in a
list.

| Area | Document | Owning phase |
|---|---|---|
| Gold custody, reward destinations, death forfeiture, Bank | [`ECONOMY_CUSTODY_AND_REWARD_DESTINATIONS.md`](./ECONOMY_CUSTODY_AND_REWARD_DESTINATIONS.md) | 2 (Gold), 3 (Loot), 5 (Reward Chest), 6 (Bank) |
| Container slots, stacking, capacity, Loot Pouch, filters, Depot, Stash, routing | [`INVENTORY_AND_LOGISTICS_FOUNDATION.md`](./INVENTORY_AND_LOGISTICS_FOUNDATION.md) | 3, with Auto-Sell in 8 |
| Active Party, Expeditions, Warzones, PvP Arena | [`MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](./MULTIPLAYER_ACTIVITIES_FOUNDATION.md) | 4 and 5B |

## World and regional progression — FUTURE, NOT IMPLEMENTED

- Rookgaard is the first mandatory area; Thais is the first mainland base.
- Regional objectives award progression points; the player chooses which city or region to unlock
  next, so the path branches.
- Unlocks are account-wide in intent.
- A recommended level **warns**; it does not arbitrarily hard-lock. Special areas may still
  require a quest, an item or a progression state.

## Requirement / cost / reward — FUTURE, NOT IMPLEMENTED

Four distinct shapes, and they are not one system:

```text
permanent unlock                 pay once, keep forever
recurring cost                   pay each time
non-consuming possession         hold the thing, it is not spent
progression / objective gate     reach the state
```

**Do not toll every Hunt.** Build the smallest generic primitive only when a real content slice
needs more than one of these shapes at once.

## Bestiary and Charms — FUTURE, NOT IMPLEMENTED

Current Tibia identity as the baseline: kill counters, Bestiary progress, Charm Points, Charm
Runes, developed in stages. A **separate progression axis** from Gold and Base Level, deliberately.
The Tibia Global values are verified when the phase is built, never frozen from memory, and the
Bestiary reveals resistances and weaknesses (2026-09-25, §3 above).

## Imbuements, outfits, achievements — FUTURE, NOT IMPLEMENTED

- creature materials feed Powerful Imbuements later;
- **Featherweight belongs to real per-Character/per-container Imbuement state**, not to a global
  capacity fudge;
- outfits, addons and auras may come from quests, materials or the store, as configured;
- achievements track meaningful progression rather than participation.
