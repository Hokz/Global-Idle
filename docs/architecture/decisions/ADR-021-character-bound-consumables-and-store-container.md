# ADR-021 — Character-bound consumables and the Store Container

**Status:** `ACCEPTED` — the product rule is `LOCKED` by the Product Owner (2026-09-24). Reviewed
independently at PR #13 head `5ed5b26` and returned for two narrow corrections: the Store
Container's representation (§3) and the binding's representation (§6, §7) are no longer fixed.
Validated with those corrections at PR #13 head `86a7681`.
**Amended 2026-09-25** by Product Owner decisions made after `86a7681`: tutorial utility
consumables are Character-bound consumables under this record (S6), which opens a conflict with
the tutorial's starter gear and a sequencing question against PRE-4 (§5, §7, §9). **The amendment
is pending independent review.**
**Extends:** [ADR-004](./ADR-004-item-single-custody.md) — one new custody scope, and a binding
that is independent of custody; ADR-004 itself is unchanged.
[ADR-020](./ADR-020-character-deletion-grace-and-purge.md) — the purge reaches a bound item
wherever it is stored, the Depot included (§6).
**Owning gate:** the BOUND-CONSUMABLE gate —
[`PHASE_GATES.md`](../../PHASE_GATES.md) § *GBC.1* — owned by the first phase that introduces a
Character-bound consumable. **Nothing in this record is implemented.**
**Date:** 2026-09-24

## Context

The Product Owner wants a class of consumables that belong permanently to one Character: XP
Boosts, Exercise Weapons bought with Store Coin or premium currency, Daily Reward consumables,
Event consumables, and any other consumable explicitly configured the same way. The Product Owner
may call them *"Unique Items"*. This record calls them **Character-bound consumables**, because
every `ItemInstance` is already unique by identity (`ADR-004`), and the two meanings must not
collide.

What exists today:

- physical items have five custody locations: `EQUIPPED`, `HUNT_CONTAINER`,
  `CHARACTER_CONTAINER`, `LOOT_POUCH` and `DEPOT`;
- the five Hunt Container Slots are a Character's gameplay logistics;
- `DEPOT` is Account storage, and its rows carry `characterId = null`;
- an item's custody is the only thing that says whose it is. There is no Store Container, no
  Store Pouch, no soulbound or Character-bound item, and no field that could hold a binding.

That last point is the problem this record solves. For an ordinary item, **where it is** and
**whose it is** coincide: the items in a Character's custody are that Character's, and an item in
the Depot is the Account's. A Character-bound consumable stored in the Depot separates them. Its
custody is the Account's; it is still the Character's.

`ADR-020` requires every reference to a Character to declare what the purge does with it. A
binding is such a reference.

## Decision

### 1. The rule — `LOCKED BY PRODUCT`

**Scope and monetization**

| # | Rule |
|---|---|
| S1 | The Character-bound Store system is for **consumables**, not combat equipment. |
| S2 | Combat equipment is **not** sold through the Store for real-money or premium-currency value. |
| S3 | An Exercise Weapon belongs to this system because it is a charge-based training consumable, not because it is combat equipment. |
| S4 | Outfits and mounts are **outside** this model. They get their own cosmetic unlock or entitlement design and are never forced into Store Container semantics. |
| S5 | Acquisition source and binding are separate dimensions. A Store, Daily Reward or Event source makes an item bound only when its item or reward definition says so. |
| S6 | *2026-09-25.* **Tutorial utility consumables** — the tutorial's Health and Mana potions, for example — are Character-bound, and they use this record's Store Container model. The current tutorial direction is 20 Health and 20 Mana potions; neither quantity is final while combat balance is calibrated. |

**Binding**

| # | Rule |
|---|---|
| B1 | A bound item has exactly one bound Character, and that identity is immutable. Conceptually: `binding = CHARACTER_PERMANENT`, `boundCharacterId = <Character>`. |
| B2 | `boundCharacterId` is **not** the item's custody or location. |
| B3 | Moving the item to the Account's Depot neither removes nor changes the binding. |
| B4 | No other Character — the same Account's included — can withdraw, use, receive, trade, consume or otherwise take ownership or control of it. |
| B5 | The binding can never be removed, reassigned, sold, gifted or converted. |

**The Store Container**

| # | Rule |
|---|---|
| C1 | Every Character may have a **Store Container** custody. |
| C2 | It is a system custody. It is not a physical backpack and not one of the five Hunt Container Slots, and it consumes none of them. |
| C3 | It is not equipment, and it is not the Loot Pouch. |
| C4 | Its capacity or slot count is **not** decided (§10), and no weight or capacity limit is invented for it unless another locked rule forces one. |

**Custody**

| # | Rule |
|---|---|
| G1 | The only ordinary storage movement of a Character-bound consumable is between its bound Character's **Store Container** and the Account's **Depot**. |
| G2 | Moving it to the Depot changes neither `boundCharacterId` nor whose it is. The Depot is only where it is stored: for binding and deletion, the item stays the Character's. |
| G3 | It never moves to a Hunt Container, a Character container, the Loot Pouch, the Stash, another Character, Market escrow, any trade, mail, gift or social-transfer custody, a Forge input, or an equipment slot. |

**Use**

| # | Rule |
|---|---|
| U1 | Only its bound Character may use it, according to the item's own use rule. |
| U2 | Use is **not** a custody transfer. It is terminal, or it decrements the item — an XP Boost consumed or activated; an Exercise Weapon's charges spent by Skill Training. |
| U3 | Every use enforces, on the server: the caller owns the Account; the target Character is `boundCharacterId`; that Character is `ACTIVE` and eligible; and no output turns the item into transferable Account value, unless a future Product Owner decision designs one explicitly. |
| U4 | Where a use is started — from the Store Container, from the Depot, or from a dedicated panel — is **not** decided here (§10). It is specified with the first concrete item. |

**Forbidden economic and social interactions.** A Character-bound consumable:

| # | Rule |
|---|---|
| F1 | cannot be listed on either Market — Gold or premium currency. |
| F2 | cannot be sold to, or bought from, another player; cannot be traded, gifted or mailed; cannot move through any social or exchange interaction. |
| F3 | cannot be sold to an NPC or counter. |
| F4 | cannot be converted into Gold, premium currency, or any other transferable currency or value. |
| F5 | cannot be a Forge sacrifice or input. |
| F6 | cannot be moved to the Stash. |
| F7 | cannot be transferred to another Character, including one on the same Account. |
| F8 | These restrictions are **server-authoritative**. Hiding an action in the UI is never the security boundary. |

**Death**

| # | Rule |
|---|---|
| D1 | Its only storage custodies are the Store Container and the Depot, so it is outside the Loot Pouch's death-at-risk path. Ordinary Character death neither destroys nor drops it. |

**Character deletion (`ADR-020`)**

| # | Rule |
|---|---|
| X1 | While the Character is `PENDING_DELETION`, its Store Container and every item bound to it stay intact and restorable. |
| X2 | During that grace there is no Store Container ↔ Depot movement, no use or consumption, and no new Character-bound grant that targets the pending Character. |
| X3 | A restore returns the exact pre-deletion bound-item state. |
| X4 | At the final purge the Store Container, which is Character-owned, is deleted. |
| X5 | Every item whose `boundCharacterId` is that Character is deleted with it — **including bound items stored in the Depot**. |
| X6 | Those items never transfer to another Character, never become unbound, never remain as orphaned Depot items, never move to the Stash, never refund Store Coin or premium currency, and never convert into Bank Gold or any other value. |

These rules are Global Idle's. Nothing further is inferred from how any other game treats bound
items.

### 2. Binding and custody are two axes — architecture

| | Custody | Binding |
|---|---|---|
| answers | *where is the item?* | *whose is it, and who may act on it?* |
| cardinality | exactly one scope at any instant (`ADR-004`) | none, or exactly one Character, forever |
| changes | by an audited custody transition | never (B1, B5) |

For an ordinary item the two coincide. A bound item stored in the Depot is where they part: its
custody is the Account's, its binding is still the Character's.

**`ADR-004` stands unchanged.** The item still has exactly one custody at any instant. The
binding is not a second custody, and it claims nothing about location. It is not the *"soft
reserved flag"* `ADR-004` rejected either. That flag kept an item in the seller's inventory while
claiming it for a listing, so every path had to remember it. The binding narrows, permanently,
which custody transitions and which actors are legal. Every path must still honour it, so its
rules are enforced inside the domain's custody-transition and use functions — never at call
sites (F8).

### 3. The Store Container — architecture

- **A new custody scope, per Character.** `ADR-004` anticipated this: *"Adding a new custody
  scope … should be a deliberate, reviewed change."* This record is that change.
- **Character-owned.** The purge deletes it (§6).
- **What is decided, and what is not.** It is not a physical backpack, not a Hunt Container Slot —
  it consumes none of the five — not equipment and not the Loot Pouch (C2, C3). Its capacity or
  slot count is open (C4). How it is represented — a container row or entity, a virtual custody, a
  projection, or something else — and whether any weight or space rule applies to it are **not**
  decided here. The implementing phase chooses, within C1–C4, and invents no limit that a locked
  rule does not force.
- **What it holds.** It exists for Character-bound consumables. Whether anything else — an
  unbound item from the same sources, say — may ever be placed in it is not decided (§10).

### 4. The custody graph — architecture

```text
        bound Character's                          Account's
         STORE_CONTAINER   <------------------->     DEPOT
                \                                     /
                 `-- use by the bound Character: consume, or spend charges --'
                     (not a custody transfer)

  never:  HUNT_CONTAINER · CHARACTER_CONTAINER · LOOT_POUCH · EQUIPPED · STASH · another
          Character · Market escrow · trade, mail, gift or social transfer · Forge input ·
          NPC sale · any conversion into currency or value
```

- A Store Container ↔ Depot move is a mutation of Character-owned state even when its
  destination is the Depot. It locks in the global order (`DATA_ARCHITECTURE.md` §4) — the Account,
  then the bound Character, then the item — and checks after the locks that the bound Character is
  `ACTIVE`. The purge locks the same Account and Character (`ADR-020` §7), and a deletion request
  must too, so a move serialises with either of them: it lands entirely before the request or the
  purge, or it is refused after it.
- Every item-moving, stowing, selling, listing, trading, mailing, gifting or converting command
  that exists or is added later refuses a bound instance, except the one legal edge above.

### 5. Use — architecture

- A use is a value-moving command. It carries an idempotency key (`ADR-017`), and the charge or
  item it consumes and the effect it grants commit in one transaction.
- **Exercise Weapons.** Skill Training (`ADR-013`) spends a bound Exercise Weapon's charges where
  it is stored. The weapon never moves into the Character's gameplay custody, which G3 forbids.
  Which of its two custodies a use may start from is open (U4). An Exercise Weapon that is **not**
  bound — the Gold-bought kind the Skills foundation describes — is an ordinary item and is not
  governed by this record (S5).
- **Timed effects.** An activated XP Boost is a timed effect, and timed effects measure active use,
  not wall-clock time (`DECISIONS.md` § *Active-use timers*, `ADR-015`). A `PENDING_DELETION`
  Character is never in a qualifying state, so the grace consumes none of an active effect, and a
  restore returns it exactly (X3).
- **Tutorial potions (S6) — open.** A Hunt drinks potions automatically, and Phase 3 draws them
  from what the Character carries in its Hunt containers (`broughtSupplies`). G3 keeps a bound item
  out of every Hunt container, so how a Hunt uses a Character-bound potion held in the Store
  Container is not decided. It is U4 for a concrete item, recorded as `ADR-020` DEL-O5 and settled
  before the tutorial's bound potions ship.
- **No hidden conversion.** No use, and no by-product of a use, yields Gold, premium currency, a
  transferable item, or any other transferable value (U3).

### 6. Character deletion and the purge — reconciliation with `ADR-020`

**During the grace.** `ADR-020` §4 freezes every Character-owned thing. A bound item is
Character-owned by its binding wherever it is stored, so the freeze covers the Store Container and
every bound item in the Depot (X1–X3). A new bound grant that would target the pending Character —
a Store purchase, a Daily Reward, an Event grant — is refused (X2).

**At the purge.**

- The Store Container is DELETE-OWNED (X4).
- Every bound item is DELETE-OWNED **by its binding, not by its custody** (X5). `ADR-020` §6 finds
  Character-owned `ItemInstance` rows by `characterId`, and a bound Depot row has
  `characterId = null`. The purge must therefore also select by the binding.
- **Ownership follows the binding, not only custody:**

  ```text
  ordinary, unbound Depot item      ->  KEEP      (the Account's)
  Character-bound Depot item        ->  DELETE    (its bound Character's)
  ```

- Nothing is refunded (X6). The ledger entry that paid for a bound item belongs to the Account and
  stays. It names no Character, in any column, the operation id included — the rule BANK entries
  already follow (`ADR-020` §6.3). That rule outlives `ADR-020` L12, superseded on 2026-09-25,
  because the BANK ledger is live persistence and the post-purge proof covers it.
- **Found by the closure test.** The binding is a relation to `Character`, so `ADR-020`'s closure
  test and reference inventory must enumerate it and act on it — every binding, a bound item
  stored in the Depot included — and it declares DELETE-OWNED. Referential integrity is mandatory:
  a binding can never name a Character that does not exist. Which physical mechanism provides it
  is the implementing phase's choice (§7).
- **Nothing left behind.** `ADR-020` §7's post-purge scan finds the purged Character's id in no
  live row, so no orphaned binding can survive. The historical deletion record (`ADR-020` DH1) may
  name the purged Character and what it held, but binds nothing and owns nothing.
- **Only its own.** The purge selects exactly the rows bound to the Character being purged, so a
  retry after a crash, or a repeated purge, can never delete another Character's items
  (`ADR-020` §7, idempotence).

### 7. Data-model direction — not a schema

```text
ItemInstance
  location            the custody scope (the Store Container is one more, however represented)
  characterId?        the custody carrier, where the scope has one (every scope today but DEPOT)
  binding?            CHARACTER_PERMANENT, when the item is bound
  boundCharacterId?   the bound Character — immutable, independent of location
```

Names and shapes are illustrative and conceptual. The implementing phase chooses the cleanest
schema representation, provided the binding is **enforceable, discoverable by the purge closure and
reference inventory, immutable, and impossible to orphan**:

- **non-negotiable:** a Store Container ↔ Depot move never erases or changes whom the item is bound
  to;
- the binding never changes once set, and a binding always names exactly one Character — both
  enforced, never left to convention;
- a bound item in a Store Container is always in its bound Character's own Store Container. In the
  Depot the item has no custody Character (`characterId` is `null` today), and its binding still
  names the Character;
- the binding is a durable, referentially safe relation to exactly one `Character`, which the
  purge's closure test and reference inventory can enumerate (§6). Whether that is a foreign-key
  column, a separate binding row or another mechanism is not fixed here;
- **stacks**, if bound consumables are ever stackable: a stack never merges across different
  bound Characters, or with an unbound instance, and a split or merge preserves the binding. No
  further stack behaviour is invented here.

**The Bootstrap Kit was a different binding** (`ADR-020` §5.2). If both are represented on
`ItemInstance`, the representation distinguishes them, so that neither's custody rules leak into
the other. As validated at `86a7681`:

| | Bootstrap Kit | Character-bound consumable |
|---|---|---|
| what | the starting items that make the Level-1 tutorial playable | consumables from the Store, Daily Rewards, Events, or another explicitly configured source |
| where it may be | its Character's own gameplay custody — **never** the Depot | its Character's Store Container, or the Depot — **never** gameplay custody |
| used | in play — worn, carried, consumed | only by its bound Character, by the item's use rule |
| at the purge | destroyed with its Character | destroyed with its Character, wherever it is stored |

**Since 2026-09-25 (S6)** the kit's utility consumables — its potions — are Character-bound
consumables under this record: Store Container or Depot, never gameplay custody. That leaves an
**unresolved conflict** for the rest of the kit. The starter gear — armour, dagger, backpack — must
be equipped and used in Rookgaard, and this record's custody (consumables only, Store Container ↔
Depot only, never an equipment slot — G3) cannot express that. The gear is **not** forced into this
model, and no path is chosen here: it is open, as `ADR-020` DEL-O4, for the PRE-4 specification
with Product Owner confirmation. A quest reward is never bound merely because it came from a quest
(`ADR-023` QR8): the Doublet is an ordinary item.

### 8. Relation to other records

- **`ADR-004`** — unchanged: one custody at any instant. `STORE_CONTAINER` is the deliberate new
  scope it anticipated, and the binding is orthogonal to custody (§2).
- **`ADR-020`** — extended, not reopened. Its current-schema row that keeps Depot items (§6.1)
  stays true while no bound item exists. From the first bound item, a Depot row is KEEP only when
  it is unbound (§6.2).
- **`ADR-003` / `ADR-019`** — unchanged. A Store purchase or premium-currency payment is a ledger
  operation like any other.
- **`ADR-013`**, **`ADR-015`** — unchanged; §5 says how a bound consumable meets them.
- **Phase 3 item logistics** — built without any of this. Its five custody locations and its Depot
  convention (`characterId = null`) are the record of what Phase 3 built. They are not rewritten
  as though this record existed then; current design documents carry a pointer here.

### 9. Who implements it, and what it must prove

**As validated at `86a7681`: not PRE-4.** PRE-4 implements the deletion lifecycle, and all it owes
this record is compatibility: its purge closure must stay extensible to a binding that is
independent of custody. Nothing in the PRE-4 design may assume that Character-owned `ItemInstance`
rows are found by `characterId` alone (`PHASE_GATES.md` § *G4.1*).

**Since 2026-09-25 that is an open question.** The tutorial's utility consumables are
Character-bound (S6), and G4.1c ships the Bootstrap Kit with the purge. Either PRE-4 builds this
record's foundation — and passes GBC.1 — for the tutorial consumables, or the starting grant
changes shape until the phase that does. Which one is `ADR-020` DEL-O5, decided in the PRE-4
specification with Product Owner confirmation. Until then this record does not claim PRE-4, and
PRE-4 does not ship a bound item without GBC.1.

**The first phase that introduces a Character-bound consumable** implements this foundation first.
Phase 8 (Premium) is the obvious consumer. A Daily Reward, an Event — or, now, the tutorial — may
need it earlier, and whichever ships first owns it. **No bound item ships before the
BOUND-CONSUMABLE gate passes** (`PHASE_GATES.md` § *GBC.1*). That implementation must prove:

- the binding survives `STORE_CONTAINER` → `DEPOT` → `STORE_CONTAINER`;
- another Character on the same Account cannot use or move the bound item;
- a Market listing fails;
- player trade, gift and mail fail;
- an NPC sale fails;
- a move to the Stash fails;
- a move into a Forge input fails;
- no currency or value conversion path exists;
- a bound item can be used only by its own Character;
- a `PENDING_DELETION` Character cannot move, use or receive bound items;
- a restore preserves every bound item exactly;
- the purge deletes the Store Container's contents;
- the purge also deletes bound items stored in the Depot;
- ordinary unbound Depot items survive that same purge;
- no orphaned `boundCharacterId` remains after a purge;
- a repeated or retried purge cannot delete another Character's items;
- a concurrent Depot move and a deletion request or purge are safely serialised;
- if bound items are stackable, a split or merge never changes the binding.

### 10. Open — not decided here

- the Store Container's capacity or slot count;
- whether it has player-facing sorting or subcontainers;
- whether anything but Character-bound consumables may ever be placed in it;
- exact Store Coin pricing;
- which Daily Rewards and Events grant bound items and which grant unbound ones;
- exact XP Boost numbers and durations;
- Exercise Weapon Store pricing and charge counts;
- the use UI, and whether a use starts from the Store Container, the Depot or a dedicated panel;
- the outfit and mount storage and unlock model;
- *2026-09-25:* how a Hunt uses a bound tutorial potion held in the Store Container, and whether
  PRE-4 or a later phase builds this foundation for the tutorial consumables (`ADR-020` DEL-O5);
- *2026-09-25:* how the tutorial's starter gear is represented (`ADR-020` DEL-O4);
- *2026-09-25:* the final tutorial Health and Mana potion quantities.

Left to the implementing phase, within §1 and §6–§7: how the Store Container is represented,
whether any weight or space rule applies to it, and the physical representation of the binding.

## Consequences

**Benefits.**

- Consumables bought with real-money or premium-currency value can never become tradeable value,
  sale proceeds or another Character's items.
- A player may store bound consumables in the Depot without losing them, and without making them
  the Account's.
- Deletion stays clean: a purge leaves no bound item behind, in any custody.
- The Store is kept away from combat power: its bound items are consumables, and it never sells
  combat equipment.

**Costs.**

- A second ownership axis. Every item path — today's and every later one — must check the binding
  as well as the custody.
- The purge can no longer find Character-owned items by custody alone; it must select by binding
  too, and its closure test must see the binding.
- Depot queries must tell bound rows from unbound ones: what another Character may withdraw is no
  longer "everything in the Depot".

**Constraints created.**

- A Character-bound consumable moves only between its bound Character's Store Container and the
  Account's Depot.
- No command removes, reassigns, sells, gifts or converts a binding.
- No item path — Market, trade, mail, gift, NPC sale, Stash, Forge, another Character, currency
  conversion — accepts a bound consumable.
- The Store never sells combat equipment for real-money or premium-currency value.
- The purge deletes every item bound to the purged Character, wherever it is stored.

## Alternatives considered

**Represent the binding by custody alone.** Rejected. A bound item may be stored in the Depot,
whose rows carry no Character, so custody alone would forget whose it is (B3).

**Store bound items in the Depot with `characterId` set.** Rejected. It would make `characterId`
mean custody for some rows and ownership for others, and change what every Depot query means.

**Make the Store Container a sixth Hunt Container Slot, or a backpack.** Rejected by C2. It would
also let a bound consumable into gameplay custody, which G3 forbids.

**Model Store consumables as entitlements.** Rejected for consumables: they are items, stored and
consumed like items. Outfits and mounts go the other way, into their own unlock or entitlement
design (S4).

**Let a bound item be sold to an NPC for a nominal price.** Rejected by F3. Any conversion would
turn premium-currency purchases into Gold.

## Product constraints requiring this architecture

- The rules of §1 — Product Owner, 2026-09-24; S6 — Product Owner, 2026-09-25.
- *"no item duplication"* — `docs/ARCHITECTURE.md`, security baseline.
- *"Premium should primarily improve: automation; time efficiency; storage/capacity; management
  convenience."* — `docs/ECONOMY.md`
- *"Avoid exclusive endgame combat power as the main Premium value."* —
  `MASTER_DEVELOPMENT_ROADMAP.md` §16
- The purge removes all Character-owned state, value and data from live persistence — `ADR-020`
  L6, L8. (L10 and L12, which also required that no surviving record keep the Character's
  identity, are superseded by `ADR-020` DH1–DH5 since 2026-09-25.)
