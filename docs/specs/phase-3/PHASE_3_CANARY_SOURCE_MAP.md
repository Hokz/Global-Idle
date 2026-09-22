# Phase 3 — Canary source map: itemization, inventory and logistics

**Baseline:** `Hokz/canary` at **`f6b81a855aa8e7e34cb98821ceb39ff97e3afa4e`** — the same commit
Phase 2 was verified against, so the two maps cannot disagree about a shared value.
**Machine-readable form:** [`tests/fixtures/canary/import-record.json`](../../../tests/fixtures/canary/import-record.json)
— one record for the whole project, extended rather than forked. SRC cases assert the authored
content against it, and re-verify the record itself against a real checkout when `CANARY_SOURCE`
points at one.

**No Canary code is copied into this repository.** A record row carries a *pattern* that locates
the value and the exact literal that was read — enough to re-verify, not enough to be a copy.

> `docs/REFERENCES.md` locks the **1× baseline**: the source's numbers are the numbers unless a
> divergence is recorded with its reason and its fixture. This document is where Phase 3's
> divergences are recorded. There are three, and each says what the source value is.

---

## 1. Method, including the one binary file

Most of this is regex over text — `.lua`, `.xml`, `.cpp`, `.hpp`, `schema.sql`. One datum is not:
**stackability**. `src/items/items.cpp` sets it from the client appearance protobuf —

```cpp
iType.stackable = object.flags().cumulative();
```

— and `data/items/appearances.dat` is a 4.8 MB binary. Guessing which items stack would be exactly
the kind of remembered fact this project refuses, so the record carries an **appearance probe**:
the id, the flag, and the decoded value. `tests/support/canary.ts` decodes the wire format directly
(`Appearances.object` field 1 → `Appearance.id` field 1, `Appearance.flags` field 3 →
`AppearanceFlags.cumulative` field 6, per `src/protobuf/appearances.proto`) and re-reads every one
of them when `CANARY_SOURCE` is set. No protobuf runtime is added: the three field numbers are the
whole schema this needs.

---

## 2. The Rat's loot table — all of it

`data-otservbr-global/monster/mammals/rat.lua`:

```lua
monster.loot = {
    { name = "gold coin", chance = 100000, maxCount = 4 },
    { id = 3607, chance = 39410 },                          -- cheese
}
```

`src/utils/const.hpp` → `MAX_LOOTCHANCE = 100000`, so the denominator is 100000 and:

| Entry | Source | Meaning | Decision |
|---|---|---|---|
| gold coin `3031` | chance 100000, maxCount 4 | **every** kill, 1–4 coins | **Adapt** — currency, not an item (§9) |
| cheese `3607` | chance 39410, no maxCount | **39.410%** of kills, exactly 1 | **Keep** |

**That is the entire table.** The Rat drops one physical item, and it is cheese. Phase 3 does not
invent a second one: Part O of the brief says so, and the source agrees. Rarity and affixes are
proven on authored fixtures over source-backed *eligible* item data (§7), not by giving a Rat a
sword it does not have.

---

## 3. The item catalogue Phase 3 imports

Every row from `data/items/items.xml` unless noted. Weight is in hundredths of an ounce, which is
the unit the engine compares against Capacity (§8).

| id | name | weight | armor | attack | defence | container | slot |
|---|---|---|---|---|---|---|---|
| `3355` | leather helmet | 2200 | 1 | — | — | — | head |
| `3562` | coat | 2700 | 1 | — | — | — | armor |
| `3559` | leather legs | 1800 | 1 | — | — | — | legs |
| `3552` | leather boots | 900 | 1 | — | — | — | feet |
| `3267` | dagger | 950 | — | 8 | 6 | — | hand |
| `2854` | backpack | 1800 | — | — | — | **20** | backpack |
| `3607` | cheese | 400 | — | — | — | — | — |
| `7876` | small health potion | 265 | — | — | — | — | — |
| `3031` | gold coin | 10 | — | — | — | — | — |

The four armour pieces sum to **armour 4**, which is the flat number Phase 2's temporary profile
carried. Phase 3 does not re-author it: it equips the four items and adds them up, which is the
point of the phase.

---

## 4. Stackability — decoded, not assumed

`AppearanceFlags.cumulative`, read from `data/items/appearances.dat`:

| id | name | cumulative | Global Idle |
|---|---|---|---|
| `3607` | cheese | **true** | stackable |
| `7876` | small health potion | **true** | stackable |
| `3031` | gold coin | true | not materialised — currency (§9) |
| `3577` | meat | true | not imported |
| `3355` `3562` `3559` `3552` | the leather kit | **false** | one instance each |
| `3267` | dagger | **false** | one instance |
| `2854` | backpack | **false** | one instance |
| `23721` | gold pouch | false | not materialised (§10) |

---

## 5. Stack size — the first divergence, and the source's own ceiling

Two source facts, and they are different facts:

```cpp
// src/items/items.hpp
uint8_t stackSize = 100;                                   // the DEFAULT
```

```cpp
// src/items/functions/item/item_parse.cpp — ItemParse::parseStackSize
auto stackSize = pugi::cast<uint16_t>(valueAttribute.value());
if (stackSize > 255) {
    stackSize = 255;
    g_logger().warn("... Stack size must be between 1 and 255.");
}
```

So **100 is the default and 255 is the engine's maximum**, settable per item from content. Measured:
`data/items/items.xml` contains **zero** `stacksize` attributes, so in this checkout every
stackable item stacks to 100.

**Divergence, recorded.** Global Idle's `ItemDefinition.maxStack` defaults to **255** for an
ordinary stackable and **1** for a non-stackable. The Product Owner locked that value, and it is
not an invented one: it is the ceiling the source's own parser enforces and the message it prints.
The override stays inside the source's range rather than leaving it.

- source baseline: `stackSize` default **100**
- source ceiling: **255**, `ItemParse::parseStackSize`
- Global Idle: **255** default for stackables, **1** for non-stackables, authoritative on
  `ItemDefinition.maxStack` and overridable per definition
- fixture: `item.stack.maxStack`, and the worked case 600 → 255 / 255 / 90

---

## 6. Containers

`data/items/items.xml` → backpack `2854`:

```xml
<attribute key="containersize" value="20"/>
<attribute key="weight" value="1800"/>
<attribute key="script" value="moveevent">
    <attribute key="slot" value="backpack"/>
</attribute>
```

**Twenty, verified rather than remembered.** The backpack occupies the `backpack` slot, weighs
18.00 oz, and holds 20 spaces. A space holds one stack or one instance; nothing in the source makes
a space hold "one item of any quantity" — `Item::getWeight` is the giveaway (§8).

---

## 7. Equipment slots

`src/creatures/creatures_definitions.hpp` → `Slots_t`:

```text
1 HEAD · 2 NECKLACE · 3 BACKPACK · 4 ARMOR · 5 RIGHT · 6 LEFT
7 LEGS · 8 FEET · 9 RING · 10 AMMO · 11 STORE_INBOX
```

Phase 3 imports the vocabulary whole and implements the slots the tutorial actually uses —
`HEAD`, `ARMOR`, `LEGS`, `FEET`, `LEFT` (weapon hand), `BACKPACK`. `NECKLACE`, `RIGHT`, `RING` and
`AMMO` exist in the enum so a later phase adds an amulet or a ring **without a schema rewrite**,
which is what Part K asks for. `STORE_INBOX` is not a Global Idle concept and is not imported.

A definition's slot comes from its own `moveevent` attribute, e.g. leather helmet →
`<attribute key="slot" value="head"/>`. It is data, not a hard-coded list.

---

## 8. Capacity — weight, and the one pre-vocation number

Three source facts:

```cpp
// src/items/item.cpp — Item::getWeight
const uint32_t baseWeight = getBaseWeight();
if (isStackable()) { return baseWeight * std::max<uint32_t>(1, getItemCount()); }
return baseWeight;
```

```cpp
// src/io/functions/iologindata_load_player.cpp
player->capacity = result->getNumber<uint32_t>("cap") * 100;
```

```cpp
// src/creatures/players/player.cpp — per level
capacity += vocation->getCapGain();     // Vocation::getCapGain() returns gainCap
```

`data/XML/vocations.xml` → vocation `id="0" name="None"` → `gaincap="10"`. And `schema.sql`'s own
sample Rookgaard character is the arithmetic check:

```sql
(1, 'Rook Sample', 1, 1, 2, 0, ... `cap` 410, ...)      -- level 2, vocation 0
```

Level 2 at 410 minus one `gaincap` of 10 gives **400 oz at level 1**, which is exactly the member
default `uint32_t capacity = 40000` in hundredths.

**The Phase 3 rule, source-backed and deliberately small:** a pre-vocation Character has
**Capacity 400.00 oz**, gaining **10.00 oz per level**. Carried weight is the sum of equipped
items, containers, their contents, supplies and Loot Pouch contents, with a stackable counting
`weight × quantity`. Phase 4 owns the five vocations' different `gaincap` values and Party
aggregation; Phase 3 implements the one Character it can actually represent.

---

## 9. Gold stays a ledger scope — the second divergence, inherited

Canary carries Gold as item stacks: `gold coin 3031` weighs 10 each and is `cumulative`. Global
Idle's Gold Pouch is a **currency custody scope** (ADR-019), weightless and slotless, decided in
Phase 2 and **unchanged here**. Part E of the brief restates it: ordinary creature Gold goes to the
numeric Gold Pouch, and no physical gold/platinum/crystal coin stack is created.

The consequence Phase 3 must keep true: a Rat kill produces **two** settlements of different kinds
— a currency credit and, 39.41% of the time, a physical item.

---

## 10. The Loot Pouch — the source has one, and what Global Idle takes

`data/items/items.xml` → `23721`:

```xml
<item id="23721" article="a" name="gold pouch">
    <attribute key="description" value="A infinity bag where you can hold coins."/>
    <attribute key="containersize" value="20"/>
    <attribute key="movable" value="0"/>
</item>
```

`src/utils/utils_definitions.hpp` → `ITEM_GOLD_POUCH = 23721`; `src/creatures/players/player.cpp`
→ `Player::getLootPouch()` returns that container; `src/creatures/npcs/npc.cpp` sells directly out
of it; `config.lua.dist` → `lootPouchMaxLimit = 2000`.

So the source's loot pouch is a **20-space, immovable container** with a server-configurable
ceiling. Global Idle's Loot Pouch takes the shape and not the name — the name is already spent on
the currency scope (§9):

| Source | Global Idle |
|---|---|
| a container item, id 23721 | a per-Character **custody**, not an item |
| `containersize` 20 | **20 spaces**, config-driven, INITIAL/TUNABLE |
| holds coins | holds **physical loot only**; coins are the currency scope |
| immovable | cannot be moved, equipped or manually filled |
| `lootPouchMaxLimit = 2000` | recorded; the Phase 3 limit is the 20 spaces |

**Divergence, recorded.** The exact long-term space count is explicitly open in the brief; 20 is
the source's number and a defensible starting point, and it lives in config so tuning is not a
code change.

---

## 11. The tutorial kit, and the one Global Idle grant

`data-otservbr-global/scripts/movements/others/dawnport_vocation_trial.lua`:

```lua
-- First items, added only in first step and having no vocation
local function addFirstItems(player)
    local firstItems = { slots = {
        [CONST_SLOT_HEAD]  = Game.createItem(3355),   -- leather helmet
        [CONST_SLOT_ARMOR] = Game.createItem(3562),   -- coat
        [CONST_SLOT_LEGS]  = Game.createItem(3559),   -- leather legs
        [CONST_SLOT_FEET]  = Game.createItem(3552),   -- leather boots
    } }
```

**Armour only. No weapon, and no container.** The same file's Knight trial — which runs *after* a
vocation is chosen — grants `3267` dagger, `3412` wooden shield, `7876` small health potion ×10,
`268` mana potion ×2 and `3577` meat.

Phase 2 measured what "no weapon" costs: a Level-1 fist build deals **0.05 damage per hit** against
a Rat and loses 88% of fights. Phase 3 does not re-litigate that; it materialises the finding as
real items.

**Third divergence, recorded — and stated precisely.**

| | |
|---|---|
| Source spawns, pre-vocation | leather helmet, coat, leather legs, leather boots — **four items, four slots** |
| Source spawns, Knight trial | dagger `3267`, wooden shield, potions, meat |
| Global Idle grants, pre-vocation | the same four armour pieces **plus** a backpack `2854` in Container Slot 1, a dagger `3267` in the weapon hand, and small health potions `7876` |
| Why | a Character with no container cannot carry loot, and a Character with no weapon cannot survive the first Hunt. Both are Global Idle tutorial grants, not Canary behaviour |

**Canary does not spawn the dagger for a vocation-less Character.** Every item Global Idle grants
is a real source item with real source stats; what is adapted is *when they are given*, and that is
what this row records. The wooden shield is **not** granted: Phase 3 implements the weapon hand and
leaves the off-hand for the phase that needs it.

Unarmed combat stays implemented and reachable. Remove the dagger and `Weapon::useFist` is the
path that runs, with the source's `attackValue = 7` and its roll from zero.

---

## 12. NPC services — Rookgaard, and only what the loop needs

| Service | Source | Value |
|---|---|---|
| Buy small health potion `7876` | `data-otservbr-global/npc/lily.lua` | **20 gold** — `{ itemName = "small health potion", clientId = 7876, buy = 20 }` |
| Buy backpack `2854` | `data-otservbr-global/npc/al_dee.lua` | **10 gold** — `{ itemName = "backpack", clientId = 2854, buy = 10 }` |
| Sell cheese `3607` | `data-otservbr-global/npc/willie.lua` | **2 gold** — `{ itemName = "cheese", clientId = 3607, sell = 2, count = 1 }` |

**The backpack, and why Al Dee.** A Character with an unlocked slot 2 and no way
to obtain a second container has bought nothing, so the counter has to sell one
— and the container it sells is a real source item at a real source price
rather than a prop. Two Rookgaard merchants sell it: Al Dee at **10** and
Lee'Delle at **9**. Both rows are in the import record, so the choice of the
dearer price is visible as a choice. The source names them itself, in Dixi's
own line: *"You should never embark on an adventure without it. Ask {Al Dee} or
{Lee'Delle} for it!"* — which is stronger evidence of who sells backpacks in
Rookgaard than a coordinate would be.

The direction is the source's, not a guess: `src/creatures/npcs/npc.cpp` reads `itemBuyPrice` on
the purchase path (`totalCost = buyPrice * amount`, charged to the player) and `sellPrice` on the
sale path (`totalCost = sellPrice * soldAmount`, paid to the player). `buy` is what the player pays;
`sell` is what the player receives.

Lily is Rookgaard's potion brewer — her own dialogue says so. Willie's food shop is the cheese
buyer. Phase 3 builds **one** service counter carrying both trades, not two NPCs with chat.

And the potion the tutorial hands out is the potion the shop refills, which is what makes the loop
close: `data/scripts/actions/items/potions.lua` → `[7876] = { health = { 60, 90 }, flask = 285 }`.
Phase 2's supply profile already used `healMin 60, healMax 90`; Phase 3 replaces the profile's
`charges` with a real stack of a real item that heals the same amount.

---

## 13. Deliberately NOT imported

Flask returns (`flask = 285`), food regeneration, mana potions, runes, the wooden shield and the
off-hand, the Bestiary block on the Rat, `lookType`/outfit data, imbuement slots on the boots and
backpack, `Storage.Dawnport.*` quest storage, the Dawnport tile scripts themselves, the store
inbox, `upgradeClassification`/Forge tiers, and every NPC keyword tree.

Each is either a later phase's or has no Global Idle meaning yet. Naming them here is how a future
phase knows the value was seen and skipped rather than missed.
