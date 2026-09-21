# Future product directions — RECORDED, NOT IMPLEMENTED

**Status:** `DIRECTION` — recorded so later phases inherit intent instead of re-deriving it.
**Nothing here is implemented, and nothing here is a commitment to exact numbers.** Where a
number appears it is illustrative; the owning phase decides it.

No Requirement engine, Bestiary, Charm system, regional-point system, Imbuement material farming,
outfit system or achievement engine is to be coded before the phase that owns it — and not in
Phase 2 at all, beyond a tiny primitive Phase 2 genuinely cannot avoid.

---

## 1. World / regional progression

Rookgaard is the **first mandatory progression area**. Everything after it branches.

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

Tibia identity is the baseline (`REFERENCES.md`).

- creature **kill counters** unlock Bestiary entries and their information;
- Bestiary progress awards **Charm Points**;
- Charm Points unlock **Charm Runes**;
- Global Idle may use a **multi-stage** Charm progression; the exact numbers are later design.

Bestiary and Charms are **progression separate from Gold and Base Level**. A player who has
neither levelled nor earned still has something advancing.

## 4. Imbuement materials, outfits, achievements

- creature materials feed future **Powerful Imbuements** (one tier only — `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §6);
- **outfits, addons and auras** are earned through quests, materials or the store, as configured;
- **achievements** track meaningful progression milestones.

---

## Why this is written down now

Each of these changes what a *later* phase's data needs to carry. A creature that will one day
feed a Bestiary counter and drop an Imbuement material is better defined once, with that in
view, than redefined three times. Recording the direction costs a page; discovering it after
three phases of content costs a migration.
