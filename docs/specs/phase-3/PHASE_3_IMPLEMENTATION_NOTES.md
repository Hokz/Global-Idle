# Phase 3 — Implementation notes

**Status:** `IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW`
**Spec:** [`PHASE_3_ITEMIZATION_INVENTORY_LOGISTICS_SPEC.md`](./PHASE_3_ITEMIZATION_INVENTORY_LOGISTICS_SPEC.md) ·
**Evidence:** [`PHASE_3_CANARY_SOURCE_MAP.md`](./PHASE_3_CANARY_SOURCE_MAP.md)

This document records what the implementation DECIDED, what it FOUND, and what
it COST — the things a specification cannot know in advance. It is not a
summary of the spec.

---

## 1. The one sentence this phase is built on

**One row is one physical thing, and it is in exactly one place.**

A row of a stackable definition is one STACK of an interchangeable item; a row
of a non-stackable definition is one individual whose id is its identity. That
single rule turns every constraint in §16 into something the database can hold:

| Invariant | Held by |
|---|---|
| an instance is in one location | `ItemInstance_location_shape_check` |
| a container cannot nest | a CHECK, plus the move refusing it by category |
| one item per equipment slot | a partial unique index `WHERE location = 'EQUIPPED'` |
| a quantity is 1..255 | `ItemInstance_quantity_check` |
| an item belongs to a real Character **of the stated Account** | the composite foreign key ADR-019 introduced for currency |
| there is no slot 6 | `CharacterContainerSlot_index_check` |

None of them is a service that must remember. All of them are rows that cannot
be written.

---

## 2. What the implementation found

### 2.1 A whole-stack move was destroying the item's identity

Found by `BNK5`, which sold an item by the id it had a moment earlier and got
`ItemNotFound`. The move was implemented as "create at the destination, delete
at the source", which copies the VALUE and loses the THING — and the loss only
surfaces in a phase that keys something on the id: a Forge tier, an imbuement,
a market listing, a trade history.

A whole-stack move with nothing to merge now **updates the row in place**, and
only a genuine SPLIT creates anything. `MOV2` pins it.

### 2.2 `Player::getDefense` was wrong from memory, and the test caught it

The first transcription was `(skill * weaponDefense * 0.146) / 5 + 1`, written
from recollection, which gives **2**. The source is:

```text
((defenseSkill / 4 + 2.23) * defenseValue * defenseFactor * scaling)
```

which gives **4** armed and **4** unarmed — the numbers Phase 2 recorded. SIM3
failed with "expected 5 to be 4" on the damage the Character TAKES, because a
defence of 2 lets more through. The formula was already written down in Phase
2's source map §3.5; the mistake was not reading it.

### 2.3 Supplies had to stop being a number

Phase 2's `combat-profile` carried `supply.charges = 20`. A charge is now a
real potion in a real container, so the count is however many were brought —
and drinking one has to REMOVE one, or the whole logistics loop is decorative.
`HNT5` proves the consumption; `EQP2` proves the charges come from the grant.

---

## 3. Decisions the implementation had to make

### P3-D1 — physical loot draws from a SECOND rng stream

Phase 2 is `VERIFIED` against a golden file that pins its exact draw sequence.
Interleaving loot rolls into the fight would have moved every subsequent hit
for a reason that has nothing to do with combat.

Two streams keep the fight identical AND make loot a pure function of the
persisted position — both properties, instead of trading one for the other.

**Measured rather than asserted:** stripping the new `loot` field from the
regenerated golden makes it byte-identical to the committed one. No tick, hit,
gold or event moved.

### P3-D2 — `armed` is explicit on a combat profile

`WeaponMelee::getWeaponDamage` rolls from `level / 5`; `Weapon::useFist` rolls
from zero. The two agree below Level 5 and diverge above it, so a Character
that took its weapon off must not keep the armed floor. At Level 1 they agree,
which is why the golden did not move when the flag was added.

### P3-D3 — the Loot Pouch is a CUSTODY, not an item

The source's loot pouch is a container item in an inventory slot. Global Idle's
cannot be moved, equipped, dropped or manually filled — modelling it as an item
would create five illegal states the server would then have to forbid one by
one. It is a location on the row instead.

The consequence is the nicest part: `ItemDestination` has `EQUIPPED`,
`CONTAINER` and `DEPOT` and **no** `LOOT_POUCH`, so "manual inbound is refused"
needs no runtime check anywhere. It is unspeakable.

### P3-D4 — the Stash is an aggregate, not rows

It is the one place a quantity may exceed `maxStack`, which is exactly why it
is not `ItemInstance`. Withdrawing MATERIALIZES legal stacks — 600 potions come
back as 255 / 255 / 90 — and if there is not room for all three, nothing
leaves. A partial withdrawal that loses the remainder is the failure this shape
exists to prevent.

### P3-D5 — a purchase routes BEFORE it charges

A delivery that cannot happen therefore cannot be paid for, which is the
difference between a failed purchase and a theft. `NPC3` fills the only
container and asserts the Bank balance is untouched to the coin.

### P3-D6 — a slot unlock debits the SAFE Bank

A permanent unlock paid out of money a death could have taken would make the
purchase a bet on surviving the walk home. `BNK3` proves carried Gold does not
pay for one.

### P3-D7 — `ItemInstance` locks after the occupancy claim, before the balances

§8.5's order gains one position. An operation that moves an item AND money
always moves the item first, so `MOV7` (a move racing a sale) cannot deadlock
and cannot let both win.

---

## 4. What Phase 2 cost, and what it did not

Four things changed outside Phase 3's own files, and each changed because the
SOURCE of a value moved rather than because a rule was weakened:

| What | Why |
|---|---|
| `SRC4` | the authored `combat-profile` is gone, so the case now ASSEMBLES the same numbers from the baseline and the equipped items — and asserts the old kind's absence |
| `SIM*` fixtures | the profile is built from the grant instead of read from content |
| `PS3` | the plan needs the Character's equipment and supplies |
| the golden file | one `loot: []` field per reward, and nothing else (§P3-D1) |

**No Phase 0B, Phase 1 or Phase 2 case was deleted, renumbered or weakened.**
Phase 0B is 92/92, Phase 1 is 87/87 and Phase 2 is 106/106.

---

## 5. What Phase 3 deliberately did NOT do

No Party. No vocation Skill progression and no durable Skill death loss. No
Promotion or blessing acquisition. No Reward Chest, boss, dungeon or quest
framework. No Market, player transfer, PvP or Warzone. No Bestiary, Charm,
Forge, Imbuement, Wheel or Skill Tree. No Premium Auto-Sell and no remote
Premium refill. No regional progression rollout. No NPC chat tree or city.

The seams that exist are listed in spec §6.4 and nothing else was left open.
`ITM10` asserts that `forgeTier` is genuinely unread rather than half-built.

---

## 6. Open, and honestly labelled

Every one of these is a NUMBER, not a mechanism, and each lives in content or
config so tuning is a publish rather than a deploy:

| Value | Now | Why it is open |
|---|---|---|
| Loot Pouch spaces | **20** | the source's own loot-pouch `containersize`; the brief leaves the long-term count explicitly open |
| Depot spaces | **200** | bounded so it is not an unbounded account blob; the real number is a product decision |
| Stash cap per entry | **100,000** | the same |
| Container slot prices | 0 / 10k / 100k / 1kk / 100kk | the brief's discussed curve, marked INITIAL/TUNABLE |
| Rarity weights | 1000 / 100 / 10 / 1 / 0.1 / 0.01 | conservative and exponential; the SHAPE is the decision, the numbers are not |
| Affix set | `ARMOR_PLUS`, `ATTACK_PLUS` | the minimum that proves generation, persistence, a combat effect and non-merging |

---

## 7. How to check this

```sh
pnpm install
pnpm build
node scripts/count-matrix.mjs          # 92/92, 87/87, 106/106, 125/125
pnpm test:unit && pnpm test:fixtures   # includes ISR and ITM
pnpm test:integration                  # includes EQP, CSL, STK, CAP, LPH, POL,
                                       # DTH, DPT, STH, MOV, RTE, BNK, NPC, HNT, MIG
pnpm test:invariants
# The integration and invariant suites TRUNCATE every table between cases,
# including ContentBundle, so re-seed before the browser suite.
pnpm --filter @global-idle/game-data run build:bundle && pnpm seed
pnpm test:e2e                          # includes SYS1-SYS12, desktop and touch

# Re-verify the Canary import record against a real checkout — including the
# six BINARY appearance probes, which decode data/items/appearances.dat:
CANARY_SOURCE=/path/to/canary pnpm test:fixtures
```
