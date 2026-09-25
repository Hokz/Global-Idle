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

- **the combat formula revision discussed after PR #13 head `86a7681`** — attack coefficients, the
  minimum and maximum auto-attack formulas, whether Canary's coefficient is adopted, the starting
  Skill value, the Defense score and its roll, the Armor roll, the rounding stages, skill scaling,
  and any balance target derived from them. **Not decided**, and handled separately; the formulas
  Phases 2–3.6 implemented and verified stand until a decision replaces them;
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
companions; companions unlocked with Gold, starting at Base Level 8; and how a Character **pending
deletion** counts — until its purge it keeps its roster place, its vocation and its Main slot, the
Origin slot (G4.1b, `LOCKED`). All are in `docs/DECISIONS.md`.

Open, from `ADR-022` §4:

- **GA-O1** companion lifecycle — whether a companion can be dismissed or deleted, with what
  grace, and what happens to what it holds;
- **GA-O2** the Main's deletion and the Game Account — the companions while the Main is pending
  and at its purge, and whether a replacement Main may exist (the PRE-4 specification, as
  `ADR-020` DEL-O1);
- **GA-O3** companion custody — its own equipment, Hunt Container Slots, Loot Pouch, Gold Pouch
  and Store Container, or the Main's;
- **GA-O4** companion Stamina — its own, or the Main's;
- **GA-O5** companion occupancy — whether a companion outside the Active Party may act on its own
  while the Main hunts;
- **GA-O6** how a low-level companion levels, now that the Main is always present. XP behaviour
  when a multi-actor formation is not Shared-XP eligible, below, is part of it;
- **GA-O7** companion names, and their uniqueness;
- **GA-O8** whether Premium and other entitlements, sessions, the newest-connection rule and the
  one activity claim attach to the login identity or to each Game Account;
- **GA-O9** whether a second Game Account's Main plays Rookgaard, and whether anything is shared
  across one login's Game Accounts;
- **GA-O10** the owning phase and UX for creating, listing and switching Game Accounts.

Carried from before, still open:

- the exact Gold price of each companion unlock (roster slots 2–5);
- whether unlock costs scale linearly, exponentially or by milestones;
- whether prerequisites besides Gold exist;
- XP behavior when a multi-actor formation is not Shared-XP eligible;
- exact adopted Tibia Global Shared XP bonus and distribution values;
- exact definition of a "qualifying Hunt XP reward" for Stamina activation;
- the identities of the five bosses in the Powerful Imbuement unlock set (the count is locked at five);
- combat consequences of Party ordering beyond Slot 1 being the Frontline;
- final name for the "Origin Character" concept — since 2026-09-25, the Main before it completes
  Rookgaard;
- final Skill Point state granted to a newly unlocked Level 8 companion.

## Character deletion

The lifecycle itself is **not** open: a 30-day reversible grace — exactly 720 elapsed hours, fully
frozen — then a hard purge of the live Character and everything it owns, with nothing moved to the
Bank or to a recovery custody, and an immutable historical deletion record and public Deleted List
entry left behind — `LOCKED` in `docs/DECISIONS.md` § *Character deletion* (amended 2026-09-25),
architecture in `ADR-020`, work in the PRE-4 gate (`PHASE_GATES.md` § *G4.1*). These are open
around it.

**1. For the PRE-4 specification, with Product Owner confirmation, before the purge is built**
(`ADR-020` §5.3):

- **DEL-O1** the sole Main and its Game Account — what happens to the companions while the Main is
  pending and at its purge; whether the Game Account ends with its Main or may create a
  replacement Main; and how configured Active Party membership counts in the quiescence rule
  (`ADR-022` GA-O2);
- **DEL-O2** companion lifecycle — whether a companion can be deleted or dismissed on its own, and
  under which of these rules (`ADR-022` GA-O1);
- **DEL-O3** rules and moderation deletion — whether it takes the same 720-hour grace and restore
  path, and who may restore;
- **DEL-O4** the starter gear — how the armour, dagger and backpack that Rookgaard needs equipped
  are represented. `ADR-021`'s consumable custody cannot hold equipped gear, and the gear is not
  forced into it;
- **DEL-O5** the tutorial consumables' sequencing — whether PRE-4 builds `ADR-021`'s foundation for
  the Character-bound tutorial potions, or the starting grant changes shape until GBC.1's phase;
  and how a Hunt drinks a bound potion held in the Store Container (`ADR-021` U4);
- **DEL-O6** the public Deleted List's presentation — which of the deletion or purge date it shows,
  and the reason categories' wording.

The same specification defines the historical deletion record's shape — the purge manifest and
its analytics facts (DH3, DH6) — and whether a purged Character's POUCH ledger entries leave the
ledger or stay as immutable history outside live custody (`ADR-020` §6.1).

**2. The final tutorial potion quantities.** The direction is 20 Health and 20 Mana potions
(`ADR-021` S6); neither number is final while combat balance is calibrated.

**3. Purge lateness, backups, logs, restores and history retention — operations (PRE-LAUNCH
gate).**

- The **purge lateness target**: how long after `purgeAt` a due purge may take before it counts as
  a breach. The contract is fixed — at `purgeAt` the Character is due for immediate final purge,
  and a purge that has not committed is a retried, alerting, degraded condition, never a normal
  state (`ADR-020` §7). Only the number is open, and it is chosen before production.
- How long may database backups and operational logs retain a purged Character? The purge's
  guarantee covers live product persistence — PostgreSQL and Redis — and nothing else yet.
- How long are historical deletion records, purge manifests and deletion analytics retained, and
  who may read them? They may keep identifying fields (DH4). How long does a public Deleted List
  entry stay listed?
- A restore from backup brings back Characters purged after the backup point, and loses deletion
  requests and restores made after it. A pending Character whose deadline has passed would be
  purged again at once — including one its owner restored inside the lost window. Recommended
  until decided: after any restore the purge job stays paused until operators have reconciled the
  lifecycle transitions lost in the window (`DATA_ARCHITECTURE.md` §10). Characters that fall due
  during that pause are overdue purges, visible and alerting — the pause is recovery, not a
  deferral.

**Not open:**

- the grace's length — exactly **720 elapsed hours** from the accepted request, `purgeAt` stored,
  no calendar or time-zone semantics (T1, Product Owner, 2026-09-25). This confirms the reading
  this section asked about until then;
- what a pending Character does while it waits — nothing: it is **fully frozen**, Stamina and every
  other elapsed-time recovery included, and a restore credits nothing for the pending time
  (FZ1–FZ3, 2026-09-25). The builder's reading this section asked about until then — Stamina
  recovery running during the grace — is **reversed**;
- whether a purge leaves a record — it leaves an **immutable historical deletion record** and a
  public Deleted List entry, and internal history may keep identifying fields (DH1–DH6,
  2026-09-25). The non-identifying account-level record this section proposed until then is
  superseded by it;
- the 20 small health potions of today's grant — the tutorial's Health and Mana potions are
  Character-bound tutorial consumables under `ADR-021` (S6, 2026-09-25), never a Tutorial Reward.
  Whether the kit's binding ends with Rookgaard is no longer a separate question: how the starter
  gear is represented is DEL-O4;
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
  never reissued. *Under `ADR-022` that describes a replacement Main, whose existence is DEL-O1.*

**Unchanged by this decision:** Character names are unique **per account**, as Phase 1
implemented. `ADR-020` changes *when* a name is released, not *where* it must be unique; making
names unique across all accounts would be a separate Product Owner decision. *Since 2026-09-25 the
public Deleted List shows former Characters' names from every account, and one login may hold
several Game Accounts, so that decision is open: per Game Account, per login, or across all. A
historical record never takes part in any uniqueness rule (DH5).*

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
- premium-currency transfer restrictions.

## Character-bound consumables

The model is **not** open: consumables permanently bound to one Character, stored only in that
Character's Store Container or the Account's Depot, used only by that Character, never sold,
traded, listed, stashed, forged or converted, and purged with the Character wherever they are
stored — `LOCKED` in `docs/DECISIONS.md` § *Character-bound consumables and the Store Container*,
architecture in `ADR-021`, work in the gate `PHASE_GATES.md` § *GBC.1*. Combat equipment is not
sold through the Store. Since 2026-09-25 the tutorial's Health and Mana potions are Character-bound
consumables too (S6); the tutorial's starter gear is not in this model, and its representation is
open (`ADR-020` DEL-O4). Open around it:

- the Store Container's capacity or slot count;
- whether the Store Container has player-facing sorting or subcontainers;
- whether anything but Character-bound consumables may ever be placed in the Store Container;
- exact Store Coin pricing;
- which Daily Rewards and Events grant bound items, and which grant unbound ones;
- exact XP Boost numbers and durations;
- Exercise Weapon Store pricing and charge counts;
- the use UI, and whether a use starts from the Store Container, the Depot or a dedicated panel;
- the outfit and mount storage and unlock model — outside this item model by decision, and not yet
  designed;
- how a Hunt uses a bound tutorial potion held in the Store Container, and whether PRE-4 or a later
  phase builds this foundation for the tutorial consumables (`ADR-020` DEL-O5);
- the final tutorial Health and Mana potion quantities.

## Quests and reward claims

The separation is **not** open: content access and replay are separate from one-time reward
claims; a quest's final or primary reward chest is claimed once per Game Account, whichever actor
opens it; and a quest reward item is ordinary unless its definition binds it — `LOCKED` in
`docs/DECISIONS.md` § *Replay and one-time reward claims*, architecture in `ADR-023`. Open around
it (Phase 5 unless named):

- which rewards, per quest and per boss, are one-time and which repeat;
- what a replay yields when the final chest is already claimed — ordinary loot, nothing, or a
  lesser table;
- the empty-chest presentation;
- whether helping another group yields anything to the helper;
- the tutorial reward tables besides the Doublet (`TUTORIAL_ROOKGAARD_ROADMAP.md` §43).

## Equipment

Decided 2026-09-25 (`docs/DECISIONS.md` § *Equipment*): Tibia-like armour slots; vocations told
apart by eligibility, weapon and off-hand options and their systems, never by a hidden per-vocation
Armor or Defense multiplier; shields for any vocation where the item and the rules allow; the
per-vocation weapon directions. Open:

- the Monk's final equipment identity;
- each item's exact vocation, class and level requirements;
- every slot and item number, which waits on the combat formulas (*Combat*, above).

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

Stated in full in [`PHASE_GATES.md`](PHASE_GATES.md). Open where the answer is not yet written:

- DEL-O1 to DEL-O6 — the sole Main and its Game Account, companion lifecycle, moderation deletion,
  the starter gear's representation, the tutorial consumables' sequencing, and the Deleted List's
  presentation (**PRE-4 gate**) — detailed under *Character deletion*, above;
- the shape of the Actor/Participant combat contract — for the Main and its companions, and for one
  selected actor per Game Account in multiplayer — and which compatibility adapters keep the
  verified Hunt fixtures intact (**PRE-4 gate**);
- `ItemDefinition` version semantics for live `ItemInstance` rows (**PRE-MARKET gate**).

**Not open:** which of `baseXp` and `baseLevel` is authoritative. `baseXp` is the durable truth and
`baseLevel` is its stored projection — decided, implemented and stated in
`packages/domain/prisma/schema.prisma` and `contexts/hunt/progression.ts`. The PRE-4 gate enforces
that contract across every write path; it does not revisit it.

**No longer open:** the fate of a deleted Character's Gold Pouch (G4.1a), what a pending
Character still holds (G4.1b), and tutorial completion and one-time grants after a purge (G4.1c),
including an Origin Character purged before Rookgaard is complete. The Product Owner decided all of
them — see *Character deletion*, above. So, on 2026-09-25, were the grace's length, the full
freeze, the purge's historical record and the tutorial potions' binding.

## IP / launch

- final product name;
- rights/licensing strategy;
- map/assets;
- creature/item names;
- lore/quest text;
- public commercial release boundary.
