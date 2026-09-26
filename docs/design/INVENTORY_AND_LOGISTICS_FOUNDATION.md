# Inventory and logistics — foundation

**Status:** `BASELINE` — recorded for Phase 3, built by Phase 3. **Nothing here exists yet.**

Phase 2 deliberately ships none of this: no `BaseItem`, no `ItemInstance`, no inventory, no
equipment, no loot table, no rarity, no affixes — and no shadow version of any of them. The Hunt's
supplies are charges on a content-authored combat profile, and its Gold is a currency custody
scope. Both are explicitly temporary.

---

## 1. Five Hunt container slots per Character

Every Character owns exactly **five** top-level Hunt container slots. *Since 2026-09-25 that
Character is the Game Account's Main; whether a companion has slots of its own or shares the
Main's is open (`ADR-022` GA-O3).*

| Slot | How it is obtained |
|---|---|
| 1 | free |
| 2–5 | purchased with Gold, by **that Character** |

**Unlocks are per Character, not per Account.** A Knight's four unlocks do not unlock a Druid's.
Five playable vocations means up to **25** unlocks, which is intentional: this is meant to be a
heavy, permanent Gold sink that keeps mattering after the early game.

The shape of the cost is locked; the numbers are data and stay open until balancing:

```text
slot 1   free
slot 2   ~10k
slot 3   ~100k
slot 4   ~1kk
slot 5   ~100kk
```

**No capacity multiplication through nesting.** A container inside a container does not give an
active Hunt more room. A container occupies one top-level slot, has its own space count, and may
have a small physical weight.

Typical contents are SUPPLIES: potions, runes, rings, amulets and collars, food, utility items.
**Ordinary loot does not consume these five slots** — it goes to the Loot Pouch.

## 2. Stacking, space and capacity are three different limits

```text
top-level Container Slots     how many containers a Character can carry     (5)
container spaces / stacks     how much fits inside one container            (~20 baseline)
physical weight / Capacity    what the Character can carry at all           (per Character)
```

Confusing them is how a design ends up with a backpack that is full and empty at the same time.

**Stacking is data:** `ItemDefinition.maxStack`. Baseline is **1** for a non-stackable physical
item and **255** for an ordinary stackable one. 255 is a content default, not a technical limit of
the database or the language.

**Capacity is per Character**, and stays per Character in a Party:

```text
Character Free Capacity     = Character Effective Capacity - carried physical weight
Party Available Capacity    = SUM(each participating Character's Free Capacity)
```

Featherweight and other modifiers apply to the Character or item that has them. A Knight's
modifier changes the Knight's contribution, not the Party's percentage. Vocation capacity rules
are sourced from the baseline in Phase 4.

## 3. Loot Pouch

Ordinary physical creature loot goes to the **Loot Pouch**, never into the five supply containers.

**Inbound is automatic only.** There is no move that puts something INTO it:

```text
Backpack -> Loot Pouch   no
Depot    -> Loot Pouch   no
Stash    -> Loot Pouch   no
NPC      -> Loot Pouch   no
```

**Outbound is the player's:** to a Character container, to the Depot, to the Stash, or to
Auto-Sell. Enforced server-side — a client that asked for a forbidden move is refused, not
trusted.

## 4. Loot policy and Auto-Sell are two different questions

```text
Loot Policy   "do I collect this?"          decided at the drop
Auto-Sell     "having collected it, keep or sell?"   decided after
```

**Loot Policy** supports *Collect All except Skipped* and *Accepted Only*, with precedence:

```text
item override  ->  category  ->  rarity  ->  default
```

Rejected loot never enters the Pouch at all.

**Auto-Sell** is Premium automation (Phase 8) and may use item, category, rarity or a default.
Protected state always wins over a generic sale rule: locked or favourited, quest or bound,
non-sellable, and any other explicit protection.

Auto-Sell does not bypass legal collection:

```text
drop -> Loot Policy -> capacity and collection -> Loot Pouch -> Auto-Sell
```

**Premium is not infinite storage.**

**One rarity vocabulary**, and it already exists: Common · Semi-Rare · Rare · Mystic · Legendary ·
Stellar. Do not create a second enum.

## 5. Depot, Stash and moving things

| | Holds | For |
|---|---|---|
| **Depot** | physical, individual custody | equipment instances, unique or affixed items, containers |
| **Stash** | large fungible quantities | creature products, materials, eligible potions and runes, commodities |
| **Store Container** (future, `ADR-021`) | a per-Character system custody — not a backpack, not a Hunt Container Slot, not equipment, not the Loot Pouch | Character-bound consumables; its capacity is open |

Normal accessible movement: container ↔ container · container ↔ Depot · container ↔ Stash (when
eligible) · Depot ↔ Stash (when eligible) · Loot Pouch → any valid accessible storage.

~~**Except a Bootstrap Kit item** (G4.1c, 2026-09-24): it stayed in its own Character's custody,
never moved to the Depot, the Stash or another Character, never sold, listed or traded~~ —
**retired 2026-09-25**. The tutorial's starter gear — armour, dagger, backpack — is ordinary,
low-value items that move like any other, and the tutorial potions follow the Character-bound
consumable rule below ([`DECISIONS.md`](../DECISIONS.md) § *Tutorial starting items*).

**Except a Character-bound consumable** (`LOCKED`, `ADR-021`): its only storage movement is between
its bound Character's Store Container and the Depot, and the Depot does not make it the Account's —
it stays its Character's, and no other Character may withdraw it. It never goes to a Hunt
container, a Character container, the Loot Pouch, the Stash, equipment, another Character, a
market, a trade or an NPC sale. A configured action slot uses a bound potion straight from the
Store Container, so it never needs a Hunt container (`ADR-021` U5). **Not implemented**: owned by
the first phase that ships one — since 2026-09-25 possibly the tutorial, whose Health and Mana
potions are bound; which phase is open (`ADR-024` DEL-O5).

Desktop affordances: drag and drop, context actions, stack splitting.
Touch affordances: long press or context action, **Move**, amount selection.
Server authoritative, both.

**No remote Depot or Stash access during a Hunt** unless a future service explicitly grants it.

`ItemDefinition` carries at least: `stackable`, `maxStack`, `stashEligible`, `category`, `weight`.

## 6. Manage Containers — routing

Each Character container may declare category routing (Potions, Runes, Rings, Amulets, Utility…).
An NPC purchase or a Depot withdrawal routes into the preferred destination, obeying stack size,
space and Capacity, with a deterministic fallback. A Character-bound consumable is never routed
into a container: it goes back to its own Character's Store Container, or stays in the Depot.

**Items never disappear.** A routing rule that cannot be satisfied is a refusal or a fallback, not
a deletion.

## 7. Open

- exact slot prices;
- container space counts beyond the ~20 baseline;
- which items are stash-eligible;
- whether routing is per container or per category;
- Party loot distribution.
