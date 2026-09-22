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

## 0. The integrity / usability correction

Independent review accepted the large majority of Phase 3 and raised **seven**
structural findings. Every one was the same shape as the two it raised against
Phase 2: **a guarantee that was stated rather than held.** What follows is what
each turned out to be.

### 0.1 An active Hunt container was a pointer, not a custody

The starting backpack sat at `EQUIPPED/BACKPACK` and a `CharacterContainerSlot`
row named it by id. `installContainer` checked two things — the slot is
unlocked, the definition is a `CONTAINER` — and four things that had to be true
were nobody's to enforce:

| Was not proved | Now held by |
|---|---|
| the container belongs to the Character whose slot it is | `CharacterContainerSlot(containerInstanceId, characterId, slotIndex) -> ItemInstance(id, characterId, slotIndex)` |
| a **Depot** container is not installed | the same key — a Depot row's `characterId` is null and the slot's is not |
| another **Account's** container is not installed | the same key, plus the instance's own `(characterId, accountId)` |
| moving an installed container clears its slot atomically | the same key — the instance's `slotIndex` stops matching, so the move is refused unless the slot is cleared first |
| contents belong to the same Character as their parent | `ItemInstance(containerId, characterId) -> ItemInstance(id, characterId)` |

And a fifth thing was not merely unproved but **unrepresentable in the old
shape**: one Character wears ONE backpack, so `EQUIPPED/BACKPACK` could never
have held slots 2 to 5 at all. `HUNT_CONTAINER` is a location of its own, and
the instance carries the `slotIndex` so the slot's foreign key can name it.

**Measured, not argued.** ACT1 to ACT7 go around every service and drive the
tables directly: setting an installed container's `slotIndex` to 2 by hand, or
pointing slot 2 at another Character's backpack, or flipping an installed
container to `DEPOT`, each come back as a foreign-key violation rather than as
a row.

**The uninstall rule is chosen and written down:** a container must be EMPTY to
leave its slot. Moving it loaded would have to answer "where did its contents
go", and every answer is worse than asking the player to empty it. Re-slotting
from slot 1 to slot 3 is not leaving, so it keeps its contents.

### 0.2 Slots 2 to 5 were unlockable and unusable

There was no way to obtain a second container, and no destination for one if
you had it — a container cannot route into a container. Slot 2 was a Gold sink
with nothing behind it.

The counter now sells a **real, source-backed** container: `al_dee.lua`,
`{ itemName = "backpack", clientId = 2854, buy = 10 }`. Lee'Delle sells the
same backpack for 9, and that row is in the import record too, so the choice of
the dearer price is visible rather than silent. Nothing was invented.

A purchased CONTAINER is delivered by being **installed** in the first free
unlocked slot, which is what makes unlocking one worth the Gold. With every
unlocked slot full the purchase fails atomically and nothing is charged.

### 0.3 The API claimed idempotency and did not implement it

§17 said *"Every mutating call carries a client-supplied idempotency key"*. The
controller generated operation ids from `Date.now()`, so a double-submitted
purchase bought twice and a retried deposit transferred twice.

Every mutating Phase 3 route now **requires** an `Idempotency-Key`, through the
Phase 0B port Phase 1's Hunt entry already uses. The fingerprint is the
CLIENT's command and nothing else, and the operation id each ledger post uses
is derived from the same key so the settlement guard and the command guard
agree. IDM7 sweeps every route rather than sampling one.

One implementation detail worth recording: the record stores `null` rather than
the domain result. Not laziness — the domain returns BigInt Gold, which has no
JSON form, and a record that could not be written would turn a command that had
already happened into a 500.

### 0.4 The Stash and routing were built and unreachable

Both were fully implemented in the domain, tested against the domain, and
exposed through no route. Four routes were added — stash deposit, stash
withdraw, routing category, and container install/uninstall as destinations of
the one move — and the System UI grew the controls for each, tap-reachable.

**Bank withdrawal was the opposite case: a claim with nothing behind it.** §11
promised it; no route existed. Nothing in the Phase 3 loop needs one — a
purchase debits the Bank directly when the Pouch is short — so the CLAIM was
removed rather than the route invented. Moving safe Gold somewhere a death can
take it is a feature for the phase that wants it.

### 0.5 The access rule lived in the controller

`moveItem` did not know that the Depot is unreachable from a Hunt; the HTTP
layer checked it before calling. That makes the invariant a property of every
future caller's memory. It now lives inside the movement primitive, and MOV9
proves it by calling the DOMAIN with no controller present.

### 0.6 The `maxStack` CHECK could not read `maxStack`

§4 said the database enforced `1..maxStack` "against the definition resolved at
write time". A CHECK cannot open a content bundle. What the database actually
held — and still holds — is `1 <= quantity <= 255`, the physical ceiling the
source's own parser enforces.

The item-specific limit is now asserted in `createItem` and in the one function
that adds to a stack, so a Dagger with a quantity of 2 is refused on **every**
path (ITM11). The documentation says which limit is whose.

### 0.7 Free space was counted without holding the destination

`moveItem` locked its rows, but `route`, the Stash withdrawal and the Loot
Pouch counted free spaces and then inserted. Two arrivals that both read "one
left" both wrote.

Every destination is now locked before it is counted, in §8.5 order: the
Account for the Depot, the Character for its Loot Pouch, the slot row for an
install, the container's own instance row for everything else. LCK1 to LCK4 use
a BARRIER rather than two promises and hope — the first transaction is held
open after taking the lock and the second is asserted **blocked** before
anything else is asserted.

---

## 0.8 The second correction pass — a retrospective audit's four findings

A retrospective audit from PR #1 through PR #8 found no reason to rewrite the
architecture and four things that were real NOW.

### 0.8.1 Two operations still asked the ACCOUNT's permission, not the Character's

`moveItem` was corrected to refuse a cross-Character source. `sell()` and
`stow()` were not: both resolved the source with `readItem(accountId, …)`
while the safe-context check was asked about the ACTING Character. So a safe
Character A could sell or stash a potion out of Character B's backpack — while
B was in the Hunt that needed it.

The question now has one place to be asked:
`readItemForCharacterAction(accountId, characterId, instanceId, allow)`. It
refuses another Character's item as **NOT FOUND** (whose it is, is not
information the asker is entitled to) and refuses a source in the wrong custody
BY NAME — *"unequip it first"*, *"take the container out of its slot first"* —
which is also what stops worn equipment and an installed container from
vanishing through a sale that never went past the slot holding it.

**The source-state rule, settled and written down:** a Character may sell or
stash only from `CHARACTER_CONTAINER` and `LOOT_POUCH`. Equipment is unequipped
first, an installed container is taken out first, and the Depot is account
storage reached by an explicitly Depot-based move. `OWN1`–`OWN6` pin it,
including that the legitimate same-Character and account-Depot paths still work.

### 0.8.2 One player-facing loader did not filter retirement

`world.controller.ts` and `game.controller.ts` both scoped their Character
lookups with `retiredAt: null`. `InventoryController.owned()` did not, so a
retired Character still had a live inventory surface. Normalized; `RET1` and
`RET2` assert that every surface now agrees.

**Deliberately NOT built here:** the retirement product flow. Retirement must
eventually settle occupancy, move item custody safely, prevent repeated
tutorial-grant abuse and preserve history — that is roster work, and it is
recorded as a Phase 4 gate rather than half-built now.

### 0.8.3 Malformed input could become a 500

`BigInt("abc")` throws; `Number("abc")` is `NaN` and reaches the database as a
parameter; an unbounded JSON array reached a `Json` column intact. A client
that sends nonsense should be told so.

`apps/api/src/game/input.ts` is six functions, not a DTO framework: a whole
number in a range, an optional one, a positive amount, a bounded identifier, a
value from a closed set, and loot rules bounded in shape and count. Zod lives
in `@global-idle/game-data` and validates CONTENT; pulling it into the API for
six bounds would be a dependency for a decision rather than for a problem.
`VAL1`–`VAL5` drive each one from outside.

### 0.8.4 The mandatory agent instructions were two phases stale

`AGENTS.md` — the one file an agent is REQUIRED to read — said *"Current phase:
Phase 1"* while Phase 3 was being implemented. That is not a documentation nit;
it is the first thing a new agent believes.

There is now exactly one canonical statement of project state,
`docs/PROJECT_STATE.json`, and `scripts/check-project-state.mjs` **fails CI**
when `AGENTS.md` stops pointing at it or stops naming the active phase. The
roadmaps and README point at it rather than repeating it, because a marker
copied into five documents is a marker that goes stale in four.

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

### 2.4 The Depot was bounded and not paged, and §10.1 claimed both

`DEPOT_SPACES = 200` bounded the STORE. The API returned every Depot row
inside the inventory read, so nothing bounded the RESPONSE — and §10.1 said
"bounded and paginated … with the API paging", which is the same shape of
defect as the two Phase 2 review found: **a guarantee that was stated rather
than held**. It was found by reading the specification back against the
controller before opening the PR, not by a test, because no test asked.

`GET /api/characters/:id/depot?offset&limit` now applies the window in the
DATABASE, with `total` beside it; the inventory read carries the first page
(default 50, maximum 200) so the System UI still draws in one request. A
nonsense window (`limit=abc`, `offset=-1`, `limit=0`, over the maximum) is
**refused with `INVALID_REQUEST`**, not silently clamped to page one — a
client that asked for it is wrong about something, and answering with page one
hides that. Five unnumbered cases in `tests/integration/items-api.test.ts`
cover it; **the §20 matrix stays at 125 with the same ids**.

---

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
| Depot page size | **50**, max 200 | the response window, not the store bound; a product decision once a client pages for real |
| Container price at the counter | **10 gold** | Al Dee's price. Lee'Delle sells the same backpack for 9, and both are recorded — which of the two source prices a shop charges is tuning, the fact that it is a SOURCE price is not |

---

## 7. How to check this

```sh
pnpm install
pnpm build
node scripts/count-matrix.mjs          # 92/92, 87/87, 106/106, 169/169
pnpm test:unit && pnpm test:fixtures   # includes ISR and ITM
pnpm test:integration                  # includes EQP, ACT, CSL, STK, CAP, LPH,
                                       # POL, DTH, DPT, STH, MOV, RTE, BNK, NPC,
                                       # HNT, IDM, LCK, MIG
pnpm test:invariants
# The integration and invariant suites TRUNCATE every table between cases,
# including ContentBundle, so re-seed before the browser suite — and REBUILD
# the bundle first, or the seed republishes a stale artifact and the browser
# sees content that no longer matches the repository. Cost one full browser run
# to rediscover; CI does not hit it because its browser job builds content as
# its own step.
pnpm --filter @global-idle/game-data run build:bundle && pnpm seed
pnpm test:e2e                          # includes SYS1-SYS16, desktop and touch

# Re-verify the Canary import record against a real checkout — including the
# six BINARY appearance probes, which decode data/items/appearances.dat:
CANARY_SOURCE=/path/to/canary pnpm test:fixtures
```
