# Open Design / Research Questions

These are intentionally unresolved.

Agents should not silently invent permanent answers.

The existence of offline Hunt/Dungeon progression is **not** an open question. It is locked in
`docs/DECISIONS.md`: activity simulation is online-only, and dedicated Skill Training is the
only approved offline progression. Only that training's limits and rates remain open.

## Progression

- exact XP curve;
- exact skill-progression model;
- universal Skill XP vs skill-specific XP vs hybrid;
- vocation skill-efficiency curves;
- death XP loss;
- death skill loss;
- blessing/protection formulas.

## Rarity

- drop probability by rarity;
- rarity scaling by content difficulty;
- affix count per rarity;
- affix pools by equipment slot;
- affix value ranges;
- whether certain special effects begin only at Legendary/Stellar.

## Forge

- success chance by:
  - Classification;
  - Rarity;
  - Tier;
- exact gold cost;
- exact dust cost;
- exact exaltation-core cost;
- maximum Fatal/effect scaling;
- whether pity/protection mechanics exist;
- whether some materials change failure behavior.

## Combat

- final stat formulas;
- party targeting;
- rotations/behavior rules;
- aggro;
- support logic;
- debuff stacking;
- elemental penetration/resistance;
- exact supply-consumption rules.

## Party and roster

Roster maximum (5), Active Party maximum (4) and the one-character-per-vocation rule are
locked in `docs/DECISIONS.md` and are **not** open. Neither is how a Character **pending deletion**
counts against them: until its purge it keeps its roster place, its vocation and, if it is the
Origin Character, the Origin slot (G4.1b, `LOCKED`).

- exact Gold price for Roster Slots 2-5;
- whether unlock costs scale linearly, exponentially or by milestones;
- whether prerequisites besides Gold exist;
- XP behavior when a multi-character formation is not Shared-XP eligible;
- exact adopted Tibia Global Shared XP bonus and distribution values;
- exact definition of a "qualifying Hunt XP reward" for Stamina activation;
- the identities of the five bosses in the Powerful Imbuement unlock set (the count is locked at five);
- combat consequences of Party ordering beyond Slot 1 being the Frontline;
- final name for the "Origin Character" concept;
- final Skill Point state granted to a newly unlocked Level 8 character.

## Character deletion

The lifecycle itself is **not** open: a 30-day reversible grace, then a hard purge of the Character
and everything it owns, with nothing moved to the Bank or to a recovery custody — `LOCKED` in
`docs/DECISIONS.md` § *Character deletion*, architecture in `ADR-020`, work in the PRE-4 gate
(`PHASE_GATES.md` § *G4.1*). These are open around it.

**1. Two readings of the locked rule, for confirmation.** The builder had to choose these to write
`ADR-020`; either can be corrected without touching anything else:

- *"exactly 30 days"* is read as **720 hours** on the server's clock, from the instant the request
  is accepted (`ADR-020` §2) — not calendar days in any time zone;
- *"exact restoration"* is read as: every stored Character-owned row comes back unchanged. What the
  rules **derive from time** instead of storing — today Stamina recovery (`ADR-014`) — keeps
  running during the grace, exactly as it would for any idle Character (`ADR-020` §4).

**2. Which items of the current starting grant are the Bootstrap Kit — Product Owner (PRE-4
gate).** The pre-completion rule is `LOCKED` (`ADR-020` §5.2): a new pre-completion Origin
Character receives a fresh, Character-bound Bootstrap Kit, while one-time Tutorial Rewards are
never reissued. `ADR-020` §5.2 classifies today's grant item by item. The four armour pieces, the
dagger and the backpack are Bootstrap Kit: the reference game's own pre-vocation armour, a weapon
measured as necessary, and the container that loot needs. Still to decide:

- **the 20 small health potions.** No document records why the pre-vocation kit needs them: they
  came from Phase 2's temporary tutorial profile, and Canary's own pre-vocation kit has none — the
  same file gives ten at the Knight trial, after a vocation is chosen. They are also the most
  valuable part of the grant: the Rookgaard counter sells the same potion for 20 Gold. Are they
  Bootstrap Kit, and if so is 20 the number the tutorial needs, or are they a Tutorial Reward?
- **whether the binding ends when Rookgaard is complete.** The locked rules set no end, so
  `ADR-020` §5.2 records the binding as permanent: a kit item can never be sold or stored in the
  Depot or the Stash for as long as its Character exists, after the tutorial as well.

Both are decided before the kit is implemented (`PHASE_GATES.md` § *G4.1*).

**3. A non-identifying record of what a purge destroyed.** The purge destroys the Pouch balance and
every item the Character owned, and deletes the Pouch's ledger history with them. The rule forbids
keeping the Character; it does not forbid an account-level fact. Should the purge leave one — for
example the amount of each currency destroyed, with no Character id or name — for support and for
economy sink reporting? Separately, `ADR-020` §6.3 recommends recording which Account operations
lost their POUCH leg to a purge, so that a genuinely missing ledger leg is still detectable.
Product Owner and architecture.

**4. Purge lateness, backups, logs and restores — operations (PRE-LAUNCH gate).**

- The **purge lateness target**: how long after `purgeAt` a due purge may take before it counts as
  a breach. The contract is fixed — at `purgeAt` the Character is due for immediate final purge,
  and a purge that has not committed is a retried, alerting, degraded condition, never a normal
  state (`ADR-020` §7). Only the number is open, and it is chosen before production.
- How long may database backups and operational logs retain a purged Character? The purge's
  guarantee covers product persistence — PostgreSQL and Redis — and nothing else yet.
- A restore from backup brings back Characters purged after the backup point, and loses deletion
  requests and restores made after it. A pending Character whose deadline has passed would be
  purged again at once — including one its owner restored inside the lost window. Recommended
  until decided: after any restore the purge job stays paused until operators have reconciled the
  lifecycle transitions lost in the window (`DATA_ARCHITECTURE.md` §10). Characters that fall due
  during that pause are overdue purges, visible and alerting — the pause is recovery, not a
  deferral.

**Not open:**

- what happens to a deleted Character's **Gold Pouch** — decided by the Product Owner (gate item
  G4.1a, `RESOLVED`): intact during the grace, **destroyed** at the purge, never moved to the Bank
  or to a recovery custody;
- whether deletion is reversible — for exactly 30 days, then never;
- what a pending Character still holds — decided by the Product Owner (gate item G4.1b,
  `RESOLVED`): its roster place, its vocation and, if it is the Origin Character, the Origin slot,
  all released only by the successful final purge. No replacement may consume them, so a restore
  never fails;
- tutorial completion and one-time grants after a purge — decided by the Product Owner (gate item
  G4.1c, `RESOLVED`): completion belongs to the Account and survives the purge; once Rookgaard is
  complete, a later Character starts at Base Level 8 and skips Rookgaard; no one-time reward is
  awarded again;
- an Origin Character purged **before** Rookgaard is complete — decided by the Product Owner with
  G4.1c: a new Level-1 Origin Character replaces it, must complete Rookgaard, and receives a fresh
  Bootstrap Kit that can never leave it or become Account value. One-time Tutorial Rewards are
  never reissued.

**Unchanged by this decision:** Character names are unique **per account**, as Phase 1
implemented. `ADR-020` changes *when* a name is released, not *where* it must be unique; making
names unique across all accounts would be a separate Product Owner decision.

## Vocation balance

- Druid support/damage ceiling;
- Sorcerer mastery benefits;
- Paladin physical/Holy split;
- Monk debuff catalog;
- Knight tank threat and mitigation;
- HP/mana growth final values.

## Wheel

- exact adaptation from level 1;
- node layout;
- gem economy;
- reset/respec costs.

## Skill Tree

- node catalog;
- number of ranks;
- gold curve;
- unlock requirements;
- respec model.

## Bosses

- exact daily limits;
- reward scaling;
- whether auto-rotation consumes additional resources;
- individual cooldown exceptions.

## Premium

- Premium duration/price;
- Gold and premium-currency costs of Imbuement materials;
- Premium Party-management benefit, now that the fifth active Party slot is superseded;
- premium-currency package pricing;
- maximum offline Skill Training duration;
- Exercise Weapon charge settlement while offline;
- offline training-rate rules;
- automation entitlements;
- storage/loot limits;
- regional pricing.

## Market

- listing fees;
- sale tax;
- listing duration;
- market limits;
- price-history window;
- anti-manipulation rules;
- premium-currency transfer restrictions.

## Character-bound consumables

The model is **not** open: consumables permanently bound to one Character, stored only in that
Character's Store Container or the Account's Depot, used only by that Character, never sold,
traded, listed, stashed, forged or converted, and purged with the Character wherever they are
stored — `LOCKED` in `docs/DECISIONS.md` § *Character-bound consumables and the Store Container*,
architecture in `ADR-021`, work in the gate `PHASE_GATES.md` § *GBC.1*. Combat equipment is not
sold through the Store. Open around it:

- the Store Container's capacity or slot count;
- whether the Store Container has player-facing sorting or subcontainers;
- whether anything but Character-bound consumables may ever be placed in the Store Container;
- exact Store Coin pricing;
- which Daily Rewards and Events grant bound items, and which grant unbound ones;
- exact XP Boost numbers and durations;
- Exercise Weapon Store pricing and charge counts;
- the use UI, and whether a use starts from the Store Container, the Depot or a dedicated panel;
- the outfit and mount storage and unlock model — outside this item model by decision, and not yet
  designed.

## World, Atlas and regions

Owned by Phase 9, except where noted. Direction:
[`design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md`](design/world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md).

- where calibrated region polygons come from, and what licence covers them;
- whether a region boundary is one polygon or a multi-polygon with holes;
- whether the world atlas and the regional mini-atlas share one coordinate space or two;
- what the region highlight does at a boundary two regions share.

The navigation hierarchy itself and the "no invented coordinate" rule are **not** open: they are
approved direction in that document.

## Cooperative play

Owned by Phase 5B unless a gate is named. Direction:
[`design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md).

- whether a dead participant still receives rewards, and whether revival exists at all
  (slice 2 — **do not invent this**);
- what a cross-account disconnect does. Decided and tested **separately** from one-account Party
  behaviour; one player's disconnect must not automatically pause everybody without a separately
  approved rule (**PRE-5B gate**);
- how contribution is measured, and whether it affects reward;
- how loot is distributed across accounts, and whether the Reward Chest is the vehicle;
- how much conditional logic the plan-authoring surface should allow;
- what happens when a frozen plan becomes unsatisfiable mid-run;
- scheduling and matchmaking for Warzone entry;
- the real Warzone entrant ceiling. The ~25–50 target is **tentative and to be benchmarked**, not
  a locked balance parameter (slice 3).

## Pre-phase gates

Stated in full in [`PHASE_GATES.md`](PHASE_GATES.md). Open where the answer is not yet written:

- which items of the current starting grant are the Bootstrap Kit, and whether the kit's binding
  ends with the tutorial (**PRE-4 gate**) — detailed under *Character deletion*, above;
- the shape of the Actor/Participant combat contract, and which compatibility adapters keep the
  verified Hunt fixtures intact (**PRE-4 gate**);
- `ItemDefinition` version semantics for live `ItemInstance` rows (**PRE-MARKET gate**).

**Not open:** which of `baseXp` and `baseLevel` is authoritative. `baseXp` is the durable truth and
`baseLevel` is its stored projection — decided, implemented and stated in
`packages/domain/prisma/schema.prisma` and `contexts/hunt/progression.ts`. The PRE-4 gate enforces
that contract across every write path; it does not revisit it.

**No longer open:** the fate of a deleted Character's Gold Pouch (G4.1a), what a pending
Character still holds (G4.1b), and tutorial completion and one-time grants after a purge (G4.1c),
including an Origin Character purged before Rookgaard is complete. The Product Owner decided all of
them — see *Character deletion*, above.

## IP / launch

- final product name;
- rights/licensing strategy;
- map/assets;
- creature/item names;
- lore/quest text;
- public commercial release boundary.
