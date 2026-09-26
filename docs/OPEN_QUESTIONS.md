# Open Design / Research Questions

These are intentionally unresolved.

Agents should not silently invent permanent answers.

The existence of offline Hunt/Dungeon progression is **not** an open question. It is locked in
`docs/DECISIONS.md`: activity simulation is online-only, and dedicated Skill Training is the
only approved offline progression. Only that training's limits and rates remain open.

## Progression

- exact XP curve — Phase 2 implemented Canary's `getExpForLevel`, and the Product Owner has not
  locked it as Global Idle's curve (2026-09-25). It stands until a decision replaces it. **Not
  open:** `baseXp` is the truth and `baseLevel` its stored projection (`docs/DECISIONS.md`
  § *Base XP and Base Level*);
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
- affix pools by equipment slot — that pools are slot-specific is decided (2026-09-25); their
  contents are open;
- affix value ranges;
- affix reroll costs and limits — a reroll of one chosen affix slot is decided (2026-09-25,
  `docs/DECISIONS.md` § *Affixes*);
- whether certain special effects begin only at Legendary/Stellar.

## Forge

Decided 2026-09-25 (`docs/DECISIONS.md` § *Forge*): Forge Tier is a separate axis from rarity and
affixes; each tier consumes two matching sacrifices of the prior tier, recursively; an attempt has
a success and a failure chance. Open:

- success chance by:
  - Classification;
  - Rarity;
  - Tier;
- exact gold cost;
- exact dust cost;
- exact exaltation-core cost;
- maximum Fatal/effect scaling;
- whether pity/protection mechanics exist;
- whether some materials change failure behavior;
- any failure consequence beyond those locked — the target is never destroyed, and the sacrifices
  are consumed.

## Combat

**Not open** (2026-09-25, final synchronization): the exact Attack Value, Max Base Damage, Defense
Value and Armor Value formulas; Defense at Attack's core shape and weights at 0.50 scale, plus flat
Weapon Defense and ArmorValue; ArmorValue as its own check, excluding weapon and shield; Armor and
Defense deciding pass or block, never reducing damage that passes; Mitigation as a percentage of
passed damage; no hidden vocation multiplier — `docs/DECISIONS.md` § *Combat formulas — weapon
attack and defence*. Still open:

- the exact ranged Accuracy system;
- the exact damage-roll distribution and minimum damage, unless separately locked;
- the exact rounding stages, where not already specified;
- the exact tie, order and visual-mapping rules, where not already locked elsewhere;
- not stated when the formulas were locked: how the scores are compared, whether Skill and
  Shielding are base or effective values, and ShieldDefense without a shield or below the formulas'
  offset of 7;
- which phase implements the locked formulas. The Phase 2–3.6 engine stays as built, and verified,
  until then;
- final stat formulas;
- party targeting;
- rotations/behavior rules;
- aggro;
- support logic;
- debuff stacking;
- elemental resistance values, and whether penetration exists. That ordinary Hunts use
  resistances, sensitivities and weaknesses rather than absolute immunities is decided
  (2026-09-25, `docs/DECISIONS.md` § *Creature elemental design*);
- exact supply-consumption rules.

## Game Account, Main Character and companions

`ADR-022` (2026-09-25) supersedes the roster of five equivalent Characters. **Not open:** a Game
Account has exactly one Main Character; further vocations are companions; the personal Active
Party is the Main plus up to three companions, reorderable; human multiplayer takes one selected
actor per Game Account, the Main or a companion; one roster member per vocation, so at most four
companions; companions unlocked with Gold, starting at Base Level 8. All are in
`docs/DECISIONS.md`.

**Not open since the final synchronization (2026-09-25):** one Login — email / authentication —
owns one or more Game Accounts, each with its own name, Main, companions, campaign, progression,
quests, claims and economy, none of it shared (GA8–GA10). The vocation chosen on entering the Main
game is the Main's, and the other four are possible companions (GA12). An unlocked companion is
permanent and goes only with its Game Account (GA11). The Main / companion distinction adds no
hidden combat multiplier (GA13). Rookgaard is single-player and vocationless, and a player may stay
there (RK1–RK4). How a pending Character counts no longer arises, because the whole Game Account
is what is pending (`ADR-024`).

Open, from `ADR-022` §4:

- ~~**GA-O1** companion lifecycle~~ — **resolved** 2026-09-25: permanent (GA11);
- ~~**GA-O2** the Main's deletion and the Game Account~~ — **resolved** 2026-09-25: the Game
  Account is deleted as a whole, with no replacement Main (`ADR-024`);
- **GA-O3** companion custody — its own equipment, Hunt Container Slots, Loot Pouch, Gold Pouch
  and Store Container, or the Main's;
- **GA-O4** companion Stamina — its own, or the Main's;
- **GA-O5** companion occupancy — whether a companion outside the Active Party may act on its own
  while the Main hunts;
- **GA-O6** how a low-level companion levels, now that the Main is always present. XP behaviour
  when a multi-actor formation is not Shared-XP eligible, below, is part of it;
- **GA-O7** companion names — *narrowed*: they are Character names, globally unique (`ADR-024`
  NM1–NM2). Whether the player chooses them, and when, stays open;
- **GA-O8** whether Premium and other entitlements, sessions, the newest-connection rule and the
  one activity claim attach to the login identity or to each Game Account;
- **GA-O9** — *resolved in part*: every Game Account's Main begins in Rookgaard, vocationless,
  and nothing is shared across one Login's Game Accounts (RK3, GA10). Still open:
  whether a later Game Account may skip the guided tutorial (`TUTORIAL_ROOKGAARD_ROADMAP.md` §2);
- **GA-O10** the owning phase and UX for creating, listing and switching Game Accounts. PRE-4
  needs a minimum: the Login apart from the Game Account, and a way for a Login whose only Game
  Account was purged to start a new one (`ADR-024` §5). Phase 4A's journey selects or creates a
  Game Account, so a minimal select / create flow exists by then (*Phase 4A*, below);
- **GA-O11** Game Account names — whether they are unique, in what scope, and whether a pending
  Game Account's name is reserved. They are a separate namespace from Character names.

Carried from before, still open:

- the exact Gold price of each companion unlock (roster slots 2–5);
- whether unlock costs scale linearly, exponentially or by milestones;
- whether prerequisites besides Gold exist;
- XP behavior when a multi-actor formation is not Shared-XP eligible;
- exact adopted Tibia Global Shared XP bonus and distribution values;
- exact definition of a "qualifying Hunt XP reward" for Stamina activation;
- the identities of the five bosses in the Powerful Imbuement unlock set (the count is locked at five);
- combat consequences of Party ordering beyond Slot 1 being the Frontline;
- final name for the "Origin Character" concept — *settled in substance*: it is the Main itself,
  from creation, in its vocationless Rookgaard state, and *Origin Character* survives only as a
  legacy and code name. Whether the code identifiers are renamed is left to the phase that touches
  them;
- final Skill Point state granted to a newly unlocked Level 8 companion.

## Game Account deletion

The lifecycle itself is **not** open. The deletion target is the **Game Account** — the whole
campaign — and its Login survives. The grace is 720 elapsed hours with the whole Game Account
fully frozen, then a hard purge of all live Game Account state. Nothing transfers to another Game
Account or to the Login, and nothing creates a replacement Main. One lifecycle serves every
deletion source, and a purge leaves an internal history record for support, with no public
Deleted List — `LOCKED` in `docs/DECISIONS.md` § *Game Account deletion* (2026-09-25, final
synchronization), architecture in `ADR-024` reusing `ADR-020`, work in the PRE-4 gate
(`PHASE_GATES.md` § *G4.1*). These stay open around it.

**1. Narrowed from `ADR-020`'s DEL-O items** (`ADR-024` §9):

- **DEL-O3** moderation authority — who may start a rules or moderation deletion, and who may
  restore one during its grace. The lifecycle is locked: the same 720-hour grace and purge, no
  instant purge, no bypass. Owned by the phase that builds moderation tooling; until then no
  moderation deletion path exists;
- **DEL-O5** when the tutorial potions become bound — PRE-4, building `ADR-021`'s foundation
  behind GBC.1, or the phase that builds the action slots. How they are used is decided
  (`ADR-021` U5). For the PRE-PHASE-4 specification.

**2. For the PRE-PHASE-4 specification:** the internal history record's exact fields and its
*broad campaign summary*; how a Login left with no Game Account starts a new one (GA-O10); how
names that already collide are resolved (G4.4); and how a Character that carries `retiredAt` today
is converted. The draft specification,
[`specs/pre-phase-4/PRE_PHASE_4_SPEC.md`](specs/pre-phase-4/PRE_PHASE_4_SPEC.md), proposes an
answer to each, and to DEL-O5 (its SD-3, SD-13 to SD-15 and SD-19). They stay open until it is
independently reviewed and approved. **No longer open**, decided by the Product Owner on
2026-09-26: the ledger entries and entitlement-audit rows move at the purge into append-only
archives outside live state (PO-1), and global name uniqueness is case-insensitive (PO-2).

**3. With `ADR-022` GA-O8:** whether an entitlement's time keeps running while its Game Account is
pending, decided with the level entitlements attach to.

**4. The final tutorial potion quantities.** The direction is 20 Health and 20 Mana potions
(`ADR-021` S6); neither number is final while combat balance is calibrated.

**5. Purge lateness, backups, logs, restores and history retention — operations (PRE-LAUNCH
gate).**

- The **purge lateness target**: how long after `purgeAt` a due purge may take before it counts as
  a breach. The contract is fixed — at `purgeAt` the Game Account is due for immediate final purge,
  and a purge that has not committed is a retried, alerting, degraded condition, never a normal
  state (`ADR-020` §7). Only the number is open, and it is chosen before production.
- How long may database backups and operational logs retain a purged Game Account? The purge's
  guarantee covers live product persistence — PostgreSQL and Redis — and nothing else yet.
- How long are internal history records retained, and who in support may read them? They keep
  names (HR3).
- A restore from backup brings back Game Accounts purged after the backup point, and loses
  deletion requests and restores made after it. A pending Game Account whose deadline has passed
  would be purged again at once — including one its owner restored inside the lost window.
  Recommended until decided: after any restore the purge job stays paused until operators have
  reconciled the lifecycle transitions lost in the window (`DATA_ARCHITECTURE.md` §10). Game
  Accounts that fall due during that pause are overdue purges, visible and alerting — the pause is
  recovery, not a deferral.

**Not open:**

- the deletion target — the **Game Account**. Deleting it deletes its Main and every Companion;
  the Login and its other Game Accounts are untouched (`ADR-024` GD1–GD2, 2026-09-25);
- the grace — exactly **720 elapsed hours** from the accepted request, `purgeAt` stored, no
  calendar or time-zone semantics (T1), with the whole Game Account **fully frozen**, Stamina and
  every other elapsed-time recovery included, and a restore that credits nothing for the pending
  time (FZ1–FZ3);
- what the purge removes — **all live Game Account state**, its Bank, Depot and Stash included —
  and that nothing transfers to another Game Account or becomes Login-level value (GD5–GD6);
- whether a replacement Main may follow a purge — **obsolete**: a purged Game Account is gone, and
  a new campaign is a new Game Account (GD7). `ADR-020` DEL-O1 is resolved;
- a Companion's own deletion or dismissal — **none**: a Companion is permanent and goes only with
  its Game Account (GD8, `ADR-022` GA11). `ADR-020` DEL-O2 is resolved;
- rules and moderation deletion — the **same** lifecycle, grace and purge, with no instant purge
  and no bypass (GD9–GD10). Only its authority stays open (DEL-O3, above);
- the starter gear — **ordinary low-value items**, with no binding and no special custody.
  `ADR-020` DEL-O4 is resolved;
- a public Deleted List — **there is none** (HR1). `ADR-020` DEL-O6 is obsolete;
- what the purge leaves — an **internal history record for support**, which may keep names,
  vocations, levels, dates and a broad campaign summary, and need not record destroyed value
  (HR2–HR5);
- the Gold Pouch at deletion — intact during the grace, **destroyed** at the purge, never moved to
  a bank or a recovery custody (G4.1a, `RESOLVED`, carried into the Game Account purge);
- what a pending Character holds, and tutorial completion or one-time grants after a Character's
  purge — G4.1b and G4.1c, decided on 2026-09-24 and **superseded**: no Character is purged apart
  from its Game Account (`ADR-024` §8);
- whether deletion is reversible — for exactly 720 hours, then never.

**Names — not open** (`ADR-024` NM1–NM5, 2026-09-25): Character names are **globally unique**
across the whole game and database, which supersedes the per-account uniqueness Phase 1
implemented. Since 2026-09-26 the comparison is case-insensitive, and each Character keeps the
capitalization it was created with (PO-2). A pending Game Account's Character names stay reserved
everywhere until its purge commits, and a historical record never reserves one. Game Account names
are a separate namespace; whether they must be unique is `ADR-022` GA-O11.

## Balance telemetry

**Not open:** the direction — XP production, hunt efficiency, loot and drop generation, item
creation and destruction, deletion history and balance analysis are preserved or collected
(`ADR-020` DH6, 2026-09-25). It is game-wide: each gameplay or economy phase records the telemetry
it introduces. The deletion lifecycle records only its internal history record, which need not
count destroyed value (`ADR-024` HR4). Open:

- what each phase records, and in what form;
- where analytics live, and how later balance work reads them;
- how long they are kept, and who may read them — they may keep identifying fields (DH4).

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

Decided 2026-09-25 (`docs/DECISIONS.md` § *Vocation Skill Trees and respec*): one Skill Tree per
vocation, never a universal one; a vocation-specific number of paths; further paths gated by
progression, with long-term crossover; Gold as the node currency and a major sink; and a respec
that refunds nothing and never leaves a tree invalid. Open:

- each vocation's paths — their number and identities — and the node catalog;
- the gates for further paths — the earlier Level 1000 and 2000 examples are illustrations only;
- number of ranks;
- gold curve;
- how a respec handles a removed node's dependent descendants;
- whether an extreme endgame can eventually buy every node, or keeps an exclusive specialization;
- the Monk's branch identity.

## Bosses

- exact daily limits;
- reward scaling;
- which boss rewards are one-time per Game Account and which repeat (`ADR-023` §4);
- whether auto-rotation consumes additional resources;
- individual cooldown exceptions.

## Premium

- Premium duration/price;
- Gold and premium-currency costs of Imbuement materials;
- Premium Party-management benefit, now that the fifth active Party slot is superseded;
- whether Premium attaches to the login identity or to each Game Account (`ADR-022` GA-O8);
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
- premium-currency transfer restrictions;
- multi-account farming: one-time reward claims are per Game Account, and one Login may own
  several (`ADR-022` GA8–GA10). Whether, and how, a tradeable one-time reward farmed across several
  Game Accounts is limited is decided before player trade ships (`PHASE_GATES.md` § *G6.4*).

## Rookgaard

**Not open** (2026-09-25, final synchronization): Rookgaard is a full playable, single-player
region, without vocation, Companions, Main-game Party or co-op. A Game Account's Main — the Main
from creation — begins there vocationless and may stay indefinitely. The same Main selects its
vocation on proceeding to the Mainland — `docs/DECISIONS.md` § *Rookgaard*, `ADR-022` RK1–RK4. Open
(`TUTORIAL_ROOKGAARD_ROADMAP.md` §43):

- whether a player who has stayed in Rookgaard may still proceed to the Mainland later;
- what Rookgaard offers a Rookstayer beyond Level 8 — its content and progression;
- whether the Level 8 event still stops a running Hunt and returns the character to the Temple,
  now that staying is allowed.

## Tactical action slots

**Not open** (2026-09-25): Health Potion, Mana Potion, Healing Spell and Attack Spell slots, with
Rune and other tactical slots later; a configured slot acts by its own rule or threshold, and may
consume an eligible Character-bound potion straight from the Store Container — `docs/DECISIONS.md`
§ *Tactical action slots*. Open (Phase 4):

- each slot's exact rules and thresholds;
- which source a slot draws from first when the Store Container and carried supplies both hold an
  eligible potion.

## Tunable configuration

**Not open** (2026-09-25): PROVISIONAL and TUNABLE defaults live in one authoritative,
server-side, validated, versioned configuration surface with safe defaults and fixtures, and
ownership, identity, claims, names, bindings, deletion guarantees, transactions and security are
never configuration — `docs/DECISIONS.md` § *Tunable configuration*, `ADR-025`. Left to the
PRE-PHASE-4 specification (`PHASE_GATES.md` § *G4.5*): the surface's physical form, how its
version relates to the content version, and which existing `INITIAL/TUNABLE` values move into it
first. The draft specification proposes all three (§9 and SD-18 there); they stay open until it is
approved.

## Character-bound consumables

The model is **not** open: consumables permanently bound to one Character, stored only in that
Character's Store Container or the Account's Depot, used only by that Character, never sold,
traded, listed, stashed, forged or converted, and purged with their Game Account wherever they are
stored — `LOCKED` in `docs/DECISIONS.md` § *Character-bound consumables and the Store Container*,
architecture in `ADR-021`, work in the gate `PHASE_GATES.md` § *GBC.1*. Combat equipment is not
sold through the Store. Since 2026-09-25 the tutorial's Health and Mana potions are Character-bound
consumables too, sharing the ordinary potion's definition and bound on the instance (S6–S7). A
configured action slot uses them straight from the Store Container (U5). Canary's `UNIQUEID` and
`ACTIONID` never encode a binding (B6). The tutorial's starter gear is ordinary items and is not
in this model. Open around it:

- the Store Container's capacity or slot count;
- whether the Store Container has player-facing sorting or subcontainers;
- whether anything but Character-bound consumables may ever be placed in the Store Container;
- exact Store Coin pricing;
- which Daily Rewards and Events grant bound items, and which grant unbound ones;
- exact XP Boost numbers and durations;
- Exercise Weapon Store pricing and charge counts;
- the use UI, and whether a use starts from the Store Container, the Depot or a dedicated panel,
  for bound items that are not used through an action slot;
- the outfit and mount storage and unlock model — outside this item model by decision, and not yet
  designed;
- which phase first issues the tutorial potions as bound instances (`ADR-024` DEL-O5);
- the final tutorial Health and Mana potion quantities.

## Quests and reward claims

**Not open:** content replayability and one-time reward claims are separate; a human multiplayer
/ co-op quest can be replayed, and its final or primary reward chest is claimed once per Game
Account, whichever actor opens it; a one-time claim belongs to the Game Account, never to the
actor; and a quest reward item is ordinary unless its definition binds it — `LOCKED` in
`docs/DECISIONS.md` § *Replay and one-time reward claims*, architecture in `ADR-023`. Since the
final synchronization a claim is never the Login's either, and each Game Account of a Login keeps
its own (QR9). A Game Account's claims are purged with it (`ADR-024`). Open around it (Phase 5
unless named):

- whether solo, tutorial, story and dungeon quest content can be replayed — each content's own
  decision; no rule makes every quest replayable;
- which rewards, per quest and per boss, are one-time and which repeat, beyond the co-op final
  chest;
- what a replay yields when the final chest is already claimed — ordinary loot, nothing, or a
  lesser table;
- the empty-chest presentation;
- whether helping another group yields anything to the helper;
- the tutorial reward tables, including whether the Doublet Quest's chest is one-time, and
  whether the Doublet Quest can be replayed (`TUTORIAL_ROOKGAARD_ROADMAP.md` §43).

## Equipment

Decided 2026-09-25 (`docs/DECISIONS.md` § *Equipment*): Tibia-like armour slots; vocations told
apart by eligibility, weapon and off-hand options and their systems, never by a hidden per-vocation
Armor or Defense multiplier; shields for any vocation where the item and the rules allow; the
per-vocation weapon directions. Open:

- the Monk's final equipment identity;
- each item's exact vocation, class and level requirements;
- every slot and item number. The formulas they feed are locked — Armor Value sums the
  armour-bearing slots, excluding weapon and shield — but no item's Attack, Defense or Armor number
  is (*Combat*, above).

## Bestiary

Direction decided 2026-09-25 (`docs/DECISIONS.md` § *Bestiary*): the Tibia Global Bestiary is the
baseline, its then-current values are verified and recorded when the phase is built, and it reveals
resistances and weaknesses through progression. Open (Phase 7A):

- the exact values adopted, verified at that time;
- the reveal UX;
- any deliberate divergence from the baseline.

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

**Not open** (2026-09-25): each participating Game Account selects exactly one actor — its Main or
any unlocked companion — and a personal Active Party never enters as a block (`ADR-022` MP1–MP5);
a cooperative quest stays replayable, and its final reward chest is claimed once per Game Account
(`ADR-023`).

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

Stated in full in [`PHASE_GATES.md`](PHASE_GATES.md). There is no Phase 3.8: after the VERIFIED
Phase 3.7 comes the PRE-4 gate. Its specification is drafted —
[`specs/pre-phase-4/PRE_PHASE_4_SPEC.md`](specs/pre-phase-4/PRE_PHASE_4_SPEC.md) — and pending
independent review, and its product decisions are made (2026-09-25; PO-1 and PO-2 on 2026-09-26).
Phase 4A, inside Phase 4, is not a gate (*Phase 4A*, below). Open until that review approves an
answer:

- the narrowed deletion items — DEL-O3, moderation authority, for the phase that builds
  moderation tooling, and DEL-O5, when the tutorial potions become bound — and the specification
  details listed under *Game Account deletion*, above (**PRE-4 gate**);
- the shape of the Actor/Participant combat contract — the vocationless Main alone in Rookgaard,
  the Main and up to three companions in the Main game, one actor per Game Account in later co-op —
  and which compatibility adapters keep the verified Hunt fixtures intact (**PRE-4 gate**, G4.3;
  proposed in the draft's §7);
- how names that already collide are resolved (**PRE-4 gate**, G4.4; proposed in the draft's
  SD-15). The comparison itself is decided: case-insensitive (PO-2);
- the configuration surface's physical form and first contents (**PRE-4 gate**, G4.5; proposed in
  the draft's §9);
- `ItemDefinition` version semantics for live `ItemInstance` rows (**PRE-MARKET gate**).

**Not open:** which of `baseXp` and `baseLevel` is authoritative. `baseXp` is the durable truth and
`baseLevel` is its stored projection — decided, implemented and stated in
`packages/domain/prisma/schema.prisma` and `contexts/hunt/progression.ts`, and confirmed by the
Product Owner on 2026-09-25. The PRE-4 gate enforces that contract across every write path,
rollback, migration and backfill; it does not revisit it.

**No longer open:** the deletion target and everything around it — the Game Account, the Login's
survival, the whole-account freeze and purge, companions' permanence, one lifecycle for every
source, global names and the internal history record (`ADR-024`, 2026-09-25). The Product
Owner decided the Gold Pouch's fate (G4.1a) on 2026-09-24, and it stands. G4.1b and G4.1c were
decided the same day and are superseded. On 2026-09-25 the grace's length, the full freeze and the
tutorial potions' binding were decided, and so were the starter gear and how the potions are used.
On 2026-09-26 the Product Owner decided, for the PRE-PHASE-4 specification, that the ledger and
entitlement-audit history is archived outside live state at the purge (PO-1) and that name
uniqueness is case-insensitive (PO-2).

## Phase 4A — Playable Beta Slice

**Not open** (approved by the Product Owner after the final 2026-09-25 synchronization): Phase 4A
is a mandatory playable milestone inside the Phase 4 program, between the Phase 4 foundation and
its remainder — not a replacement for Phase 4 and not a gate. Its acceptance journey, minimum
Atlas, creator tooling, combat inspector and non-goals are recorded in
[`design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md`](design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md)
and `docs/DECISIONS.md`. Open, for the Phase 4 specification (milestone §9):

- which Phase 4 deliverables form the foundation and which the remainder, and which of the
  journey's missing pieces 4A builds itself;
- what *staging* is, and how its authentication is protected;
- how the privileged creator identity is represented and granted, and how creator commands are
  recorded;
- whether any creator capability ever reaches production — moderation authority is `ADR-024`
  DEL-O3;
- the shape of the reusable NPC / dialogue flow, and which NPC comes first;
- which potion 4A's action slot uses — an ordinary carried one, or a Character-bound one from the
  Store Container, which needs GBC.1 first (*Tactical action slots*, above);
- which combat model the inspector shows at 4A — whether the locked formulas are implemented by
  then;
- which test content is approved for teleport, and which progression flags are safe to reset;
- how the journey is proven — its matrix cases and its browser evidence.

## IP / launch

- final product name;
- rights/licensing strategy;
- map/assets;
- creature/item names;
- lore/quest text;
- public commercial release boundary.
