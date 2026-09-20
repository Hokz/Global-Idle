# Global Idle — Combat, Base Level & Skills Foundation

**Document status:** DESIGN BASELINE / PARTIALLY OPEN  
**Scope:** Base Level, Skills, skill training, vocation aptitudes, baseline combat power, and how later systems modify combat.  
**Purpose:** Establish a clean technical model before exact formulas are implemented.

---

# 1. Core Principle

Global Idle separates:

```text
HOW THE CHARACTER PROGRESSES
from
HOW CHARACTER STATS PRODUCE COMBAT POWER
```

This distinction is critical.

Example:

```text
Progression system determines:
Sword = 80

Combat system determines:
What Sword 80 means when attacking
```

The project can therefore use a custom idle progression model while using Canary/Tibia combat formulas as a reference for the relationship between:

- Level;
- Skills;
- weapons;
- spells;
- runes;
- healing;
- shielding;
- defense;
- armor;
- resistances;
- other combat components.

---

# 2. Terminology

## Base Level

The character's general level.

Gained primarily from combat/activity XP.

## Base XP

Experience used to advance Base Level.

## Skills

Permanent proficiencies that influence combat.

Examples:

- Sword;
- Axe;
- Club;
- Distance;
- Shielding;
- Magic Level.

Additional skills can be defined later.

## Skill Tree

Advanced vocation development system.

Not the same as Skills.

## Wheel of Destiny

Advanced specialization system.

Not the same as Skills.

## Spells / Abilities

Actions or effects available to the character.

They may be strengthened by:

- Skill Tree;
- Wheel of Destiny;
- equipment;
- character stats;
- other modifiers.

Spells are not "Skills" in the numeric proficiency sense.

---

# 3. Skill Philosophy

Skills are one of the main foundations of **raw character power**.

They should influence baseline combat behavior before advanced progression is applied.

Conceptually:

```text
Base Level
+
Base Skills
+
Base Equipment
+
Vocation parameters
↓
Baseline Combat Power
```

Later systems modify this baseline.

---

# 4. Hunting Progression

When killing creatures, the character receives progression toward:

```text
Base Level
and
Skill development
```

The exact split/mechanics of "Skill XP from hunting" are still to be finalized.

The key locked direction is:

> A character must not be 100% dependent on dedicated training to improve Skills, and must not be 100% dependent on creature killing either.

Both normal gameplay and dedicated training contribute to skill development.

---

# 5. Distributable Skill Points

Current product direction:

- character progression grants distributable Skill Points;
- the player chooses where to invest them;
- higher Skill values cost progressively more to increase;
- vocation affects how expensive/effective particular Skills are.

The Product Owner proposed:

```text
3 distributable points
when relevant level/skill progression occurs
```

Important technical note:

The exact trigger is **not fully locked yet**.

Two possible interpretations exist:

### Model A — Base Level only

```text
Every Base Level gained
→ +3 Skill Points
```

Advantages:

- predictable economy;
- no self-feeding Skill Point loop;
- easy to calibrate against Level 1000.

### Model B — Base Level and/or Skill Level milestones

This matches the broader wording of the original design discussion but introduces a risk:

```text
spend Skill Points
→ Skill Level rises
→ gain more Skill Points
→ spend again
```

This can create feedback loops if not constrained.

### Decision required

Before implementation, lock one exact Skill Point award rule.

Do not silently choose in code.

---

# 6. Level 1000 Calibration Target

A strong design anchor has been proposed:

> A character around Base Level 1000, without using Exercise Weapons, investing essentially all natural progression into one main Skill, should reach approximately Skill 100.

This is a **balance target**, not yet an approved final formula.

If Skill Points are awarded only from Base Level:

```text
Level 1 → Level 1000
= 999 level-ups

999 × 3 points
= 2,997 natural Skill Points
```

This provides a clean total budget for curve design.

The exact starting Skill values and total cost curve must still be defined.

---

# 7. Skill Cost Curve

Skills should become progressively more expensive.

Desired behavior:

```text
low Skill
→ relatively cheap

mid Skill
→ increasingly expensive

high Skill
→ very expensive

extreme off-class Skill
→ potentially extremely slow
```

The curve should not be linear.

Candidate families for later evaluation:

- exponential;
- polynomial;
- piecewise exponential;
- Tibia-inspired progression ratios;
- vocation-adjusted base curves.

The exact formula is **OPEN**.

---

# 8. Vocation Aptitude

Different vocations must have different efficiency curves for different Skills.

Conceptually:

```text
Skill Cost
=
Base Skill Curve
× Vocation Aptitude Modifier
× High-Skill Scaling
```

This allows:

- Knight to train melee and Shielding efficiently;
- Sorcerer/Druid to train Magic Level efficiently;
- Paladin to train Distance efficiently;
- off-class Skills to remain possible but expensive.

---

# 9. Knight Direction

Current intended profile:

Efficient:

- Sword;
- Axe;
- Club;
- Shielding.

Less efficient:

- Distance;
- Magic Level.

Important design direction:

Magic Level should use a **soft cap**, not necessarily a hard cap.

Example concept:

```text
Knight ML 1–10
reasonable progression

ML 10–15
much slower

ML > 15
extremely expensive
```

The exact thresholds are NOT approved.

The design goal is:

> A very high Magic Level should be exceptional on a Knight, not impossible.

---

# 10. Sorcerer / Druid Direction

Primary aptitude:

```text
Magic Level
```

Melee and unrelated weapon Skills should be comparatively inefficient.

Exact differentiation between Sorcerer and Druid belongs to vocation design.

---

# 11. Paladin Direction

Primary aptitude:

```text
Distance
```

Also intended to have meaningful progression in:

- Shielding;
- Magic Level.

Exact curves remain open.

---

# 12. Monk Direction

The Monk skill profile is not yet finalized.

Its aptitudes must be designed alongside the vocation's final combat identity.

Do not assume a Tibia/Canary profile exists for Monk without deliberate project design.

---

# 13. Dedicated Skill Training

Skills can also be developed using dedicated training systems.

Core direction:

```text
Exercise Weapon
+
Training Dummy
↓
Skill Training Progress
```

The player can acquire Exercise Weapons with in-game gold.

This creates a major gold sink.

---

# 14. Exercise Weapons

Exercise Weapons train specific Skill categories.

Concept examples:

```text
Exercise Sword
→ Sword

Exercise Axe
→ Axe

Exercise Club
→ Club

Exercise Bow / Distance Weapon
→ Distance

Exercise Wand/Rod
→ Magic Level
```

Exact item names, charges, costs and efficiency are future balance work.

---

# 15. Public Training Dummy

The game will provide a free/public training area.

Current direction:

```text
Public Dummy
→ base training speed
→ usable with Exercise Weapons
```

The character may be able to train:

- online;
- offline.

Dedicated Skill Training is the only approved form of offline progression. It never grants
Base XP, and it is separate from Hunt/Dungeon simulation, which is online-only.

A Character may not Hunt and Skill Train at the same time - one primary action per Character -
but different Characters on the account may do both concurrently. For Stamina purposes a
Character at a Dummy counts as **recovering**: Skill Training does not block Stamina recovery.
See `docs/DECISIONS.md` and
`docs/architecture/ACTIVITY_OCCUPANCY_AND_TIMERS.md`.

Exact offline restrictions, rates and durations are open.

---

# 16. Premium / Store Training Dummy

The Store may provide access to a more efficient Dummy.

Direction:

```text
Store/Premium Dummy
→ higher Skill training efficiency
```

Exact percentage advantage is **not defined**.

This needs careful Free/Premium balance review before implementation.

The system should remain understandable:

```text
Public Dummy = standard rate
Premium/Store Dummy = faster rate
```

---

# 17. Training Does Not Replace Base Level

Dedicated Skill training must not grant normal Base XP by default.

Concept:

```text
Dummy Training
→ Skill Training Progress
→ Skill improvement

NOT
→ Base Level farming
```

This preserves the distinction between:

- adventuring progression;
- proficiency training.

---

# 18. Base Skill vs Effective Skill

The system should distinguish permanent trained Skill from bonuses.

Example:

```text
Base Sword:       80

Equipment:        +3
Skill Tree:       +2
Wheel:            +1

Effective Sword:  86
```

The Combat Engine uses the **Effective Skill** where appropriate.

The UI should allow the player to understand the difference.

Possible display:

```text
Sword 86
(Base 80)
```

or:

```text
Sword
80 +6
```

Exact UI is future work.

---

# 19. Source of Combat Formulas

Canary is the main technical reference for baseline Tibia-style combat behavior.

Research targets include:

- melee damage;
- distance damage;
- magic damage;
- rune damage;
- spell damage;
- healing;
- shielding;
- defense;
- armor;
- mitigation;
- resistances;
- elemental damage;
- critical;
- block behavior;
- other relevant combat systems.

Canary is a **reference**, not a requirement to copy every behavior unchanged.

For each formula:

```text
1. Inspect Canary
2. Understand current behavior
3. Determine if it fits Global Idle
4. Keep / simplify / modify deliberately
5. Document the final formula
6. Implement tests
```

---

# 20. Baseline Combat Power

Combat should first calculate a clean baseline.

Concept:

```text
BASE LEVEL
+
BASE/EFFECTIVE SKILL
+
WEAPON / BASE ITEM STATS
+
VOCATION BASE PARAMETERS
↓
BASELINE RESULT
```

Examples:

```text
Melee Auto Attack
Level + melee Skill + weapon Attack + vocation parameters
```

```text
Distance Auto Attack
Level + Distance + weapon/ammunition + vocation parameters
```

```text
Spell
Level + Magic Level + spell coefficients + vocation parameters
```

```text
Rune
Level + Magic Level + rune coefficients
```

```text
Healing
Level + Magic Level + healing coefficients
```

These are conceptual relationships.

Exact formulas must be extracted/researched before implementation.

---

# 21. Layered Combat Architecture

Do not create one giant formula containing every system.

Preferred architecture:

```text
BASELINE COMBAT
        ↓
EQUIPMENT MODIFIERS
        ↓
VOCATION MODIFIERS
        ↓
WHEEL MODIFIERS
        ↓
SKILL TREE MODIFIERS
        ↓
TEMPORARY BUFFS / DEBUFFS
        ↓
TARGET DEFENSE / RESISTANCE
        ↓
FINAL RESULT
```

Each layer should have a clear responsibility.

This improves:

- balance;
- debugging;
- testing;
- future patches;
- UI explanations.

---

# 22. Equipment as Combat Modifier

Equipment may affect combat through:

- weapon Attack;
- Defense;
- Armor;
- Skill bonuses;
- Magic Level bonuses;
- resistances;
- rarity affixes;
- Forge;
- Imbuements.

Equipment should modify the baseline rather than replace the Skill system.

---

# 23. Rarity / Affix Interaction

Equipment uses the project's rarity system:

1. Common
2. Semi-Rare
3. Rare
4. Mystic
5. Legendary
6. Stellar

Rarity and affixes live on `ItemInstance`.

Conceptually:

```text
Base Item
+
Rarity
+
Affixes
+
Forge Tier
+
Imbuements
```

Affixes may increase effective combat stats.

Example:

```text
+2 Sword
+3% Fire Resistance
+HP
+Critical modifier
```

Exact affix pools and values are separate design work.

---

# 24. Forge Interaction

Forge Tier is separate from Rarity.

Forge can improve the item without changing:

```text
Base Item identity
Rarity
Affixes
```

Forge effects may contribute to combat through dedicated modifier layers.

Exact Forge combat effects are separate design work.

---

# 25. Imbuement Interaction

Imbuements are another independent modifier layer.

Potential effects include:

- leech;
- elemental conversion;
- resistances;
- other specialization.

Do not merge Imbuement logic into the raw Skill formula.

---

# 26. Wheel of Destiny

Wheel of Destiny is an advanced progression system.

Its role is to:

- specialize builds;
- improve selected combat properties;
- unlock/enhance perks;
- potentially grant Skill bonuses;
- improve spells or other vocation mechanics.

Important:

Wheel should **modify** baseline combat.

It should not be required to understand the fundamental damage formula.

---

# 27. Skill Tree

Skill Tree is a separate advanced progression system.

It can:

- improve vocation abilities;
- improve particular spells;
- improve passive stats;
- buff Skills;
- alter gameplay behaviors.

Example conceptual node:

```text
Sword Mastery
+1 effective Sword per rank
```

or:

```text
Exori Mastery
+X% damage
```

Exact nodes are future design.

---

# 28. Skills vs Skill Tree vs Spells

This distinction must be maintained in code and UI.

```text
SKILLS
Sword / Axe / Club / Distance / Shielding / Magic Level
→ numeric proficiency

SKILL TREE
class progression / passive or active upgrades

WHEEL OF DESTINY
specialization and build shaping

SPELLS / ABILITIES
combat actions
```

Naming must avoid confusing players.

---

# 29. Auto-Attack

Auto-attack baseline should be driven by:

```text
Base Level
+
relevant effective Skill
+
weapon stats
+
vocation parameters
```

Then apply modifier layers.

Exact Canary formula is not yet imported/approved.

---

# 30. Spell Damage

Spell baseline should be driven by:

```text
Base Level
+
Magic Level
+
spell power/coefficient
+
vocation parameters
```

Then:

```text
equipment
Wheel
Skill Tree
buffs/debuffs
target resistances
```

modify the result.

---

# 31. Rune Damage

Rune baseline should similarly derive from:

```text
Level
+
Magic Level
+
rune coefficients
```

with later modifier layers.

Exact formula remains pending Canary analysis.

---

# 32. Healing

Healing should use the same architectural philosophy:

```text
Level
+
Magic Level
+
healing coefficients
↓
base heal
↓
vocation / equipment / Wheel / Skill Tree modifiers
↓
final heal
```

Exact formulas remain open.

---

# 33. Shielding and Defense

Shielding is part of the baseline defensive identity.

Concept:

```text
Shielding
+
shield/equipment stats
+
vocation parameters
↓
base defensive capability
```

Later systems can modify:

- mitigation;
- block;
- protection;
- defense scaling;
- other mechanics.

Canary should be studied before the exact Global Idle model is locked.

---

# 34. Resistances

Damage should eventually account for:

- physical;
- fire;
- ice;
- earth;
- energy;
- death;
- holy;
- other supported elements.

Exact resistance ordering, rounding and interaction with armor/defense must be deliberately specified.

Do not assume Canary ordering without review.

---

# 35. Combat Tick / Time Model

Not yet decided.

Open questions include:

- simulation tick duration;
- auto-attack cadence;
- attack speed;
- spell cooldowns;
- GCD/shared cooldown concepts;
- how a paused activity resumes mid-tick after a reconnect;
- deterministic/reproducible RNG needs.

Combat simulation is **online-only**. The 5-minute reconnect grace *pauses* combat; it does not
simulate it offline, and nothing progresses while paused. Dedicated Skill Training is the only
approved disconnected progression, and its exact limits and rates remain open.

These must be discussed before the Combat Engine implementation phase.

---

# 36. Targeting

Not yet decided.

Open questions:

- target selection;
- threat/aggro;
- tanking;
- taunt;
- ranged behavior;
- support targeting;
- heal priority;
- AoE targeting.

This belongs to the formal Combat Design phase.

---

# 37. Death

The project direction is that death matters.

Potential losses:

- Base XP / level progression;
- Skill progression.

Exact death formulas, blessing behavior and recovery rules are not yet locked.

This must be part of Combat/Progression design later.

---

# 38. Rookgaard Constraint

During Rookgaard:

- player learns what Skills are;
- player learns that Exercise Training exists;
- player previews Skill Tree;
- player previews Wheel of Destiny.

But:

```text
Skill Tree = not actively used
Wheel = not actively used
```

Advanced build development begins in Mainland after vocation selection.

Exact timing for first Skill Point allocation is still to be finalized.

---

# 39. Vocation Selection and Skills

Vocation is chosen at Base Level 8.

This matters because vocation influences Skill aptitude/cost.

Therefore the design must resolve:

- whether Skill Points can be spent before vocation selection;
- whether points are stored until Level 8;
- whether Rookgaard uses neutral costs;
- whether the first allocation happens only in Mainland.

Current recommended direction:

```text
Rookgaard
→ accumulate / preview

Level 8
→ choose vocation

Mainland
→ begin real allocation using vocation curves
```

This recommendation is not yet formally approved.

---

# 40. Combat System Development Order

When the project reaches the Combat System phase, work should proceed in controlled steps:

## Combat 1 — Time Model

Define:

- ticks;
- attack cadence;
- cooldowns;
- pause/resume behavior across the reconnect grace period.

## Combat 2 — Character Stats

Define:

- Level contribution;
- Skill contribution;
- vocation base parameters.

## Combat 3 — Auto-Attacks

Define:

- melee;
- distance;
- hit logic;
- damage ranges.

## Combat 4 — Defense

Define:

- Shielding;
- defense;
- armor;
- resistances;
- mitigation;
- block semantics.

## Combat 5 — Magic

Define:

- spells;
- runes;
- Magic Level;
- healing.

## Combat 6 — Conditions / Elements

Define:

- elemental interactions;
- DoTs;
- debuffs;
- buffs.

## Combat 7 — Targeting / Party

Define:

- aggro;
- tanks;
- support targeting;
- group combat.

## Combat 8 — Modifier Layers

Integrate:

- equipment;
- rarity/affixes;
- Forge;
- Imbuements;
- Wheel;
- Skill Tree.

## Combat 9 — Validation

Use:

- unit tests;
- deterministic fixtures;
- reference comparisons;
- progression simulations;
- edge cases.

---

# 41. Canary Research Checklist

Before locking final formulas, extract/review at minimum:

```text
[ ] Base melee formula
[ ] Base distance formula
[ ] Level contribution
[ ] Weapon Attack contribution
[ ] Skill contribution
[ ] Magic Level formula
[ ] Rune formula
[ ] Spell formula
[ ] Healing formula
[ ] Critical
[ ] Defense
[ ] Shielding
[ ] Armor
[ ] Mitigation
[ ] Element resistance
[ ] Damage order
[ ] Block order
[ ] Rounding
[ ] Minimum/maximum damage behavior
[ ] Vocation-specific coefficients
```

Every copied or adapted formula should have:

```text
Source
Canary file/function
Observed behavior
Global Idle decision
Test examples
```

---

# 42. Mathematical Balance Tests

The final system should include automated sanity tests.

Examples:

```text
Level 1000 natural progression
→ target main Skill range
```

```text
Knight high melee Skill
→ clearly more efficient than off-class melee
```

```text
Knight ML progression
→ slows dramatically at high values
```

```text
Sorcerer/Druid ML
→ materially more efficient
```

```text
Paladin Distance
→ materially more efficient
```

Tests should validate both:

- absolute targets;
- relative vocation identities.

---

# 43. Balance Simulation Tool

Strong recommendation:

Create a developer-only progression simulator.

Inputs:

```text
Vocation
Base Level
Skill allocation
Exercise training amount
Equipment
Wheel
Skill Tree
```

Outputs:

```text
Base Skills
Effective Skills
Auto-attack DPS
Spell damage
Healing
Defense
Estimated progression cost
```

This tool will make balancing much easier than manually changing formulas and testing in the game client.

---

# 44. Current Locked / Strongly Established Decisions

The following are established product directions:

- Skills are distinct from spells/abilities;
- Skills contribute to baseline combat power;
- Base Level contributes to baseline combat power;
- normal gameplay contributes to progression;
- dedicated Skill training exists;
- Exercise Weapons can be purchased with in-game gold;
- Training Dummies exist;
- public/free Dummy exists;
- a faster Store/Premium training option is intended;
- vocation affects Skill efficiency;
- off-class Skill progression should remain possible but inefficient;
- Canary is the baseline technical reference for Tibia-style combat formulas;
- Wheel and Skill Tree modify the character on top of baseline Skills;
- Rookgaard introduces advanced systems but does not fully use them.

---

# 45. Open Decisions

Must still be designed explicitly:

- exact Skill Point award trigger;
- exact starting Skill values;
- exact Base Level XP curve;
- exact Skill XP/progress mechanics from hunting;
- exact Skill cost curve;
- exact Level 1000 → Skill 100 calibration formula;
- exact vocation aptitude matrix;
- exact soft-cap behavior;
- exact Exercise Weapon charges/costs;
- exact public Dummy rate;
- exact Premium Dummy advantage;
- exact online/offline Skill Training rules;
- exact Canary formulas to preserve;
- combat tick rate;
- attack speed;
- cooldown system;
- auto-attack formula;
- spell formula;
- rune formula;
- healing formula;
- shielding;
- armor;
- mitigation;
- resistance order;
- critical;
- targeting;
- aggro;
- party behavior;
- death penalties;
- blessing interactions;
- Skill Tree nodes;
- Wheel nodes;
- modifier stacking/rounding order.

These are future design discussions and must not be silently invented by the Builder.

---

# 46. Architecture Summary

```text
PROGRESSION
Base XP
↓
Base Level
↓
natural Skill progression / points

Dedicated Training
Exercise Weapons + Dummy
↓
Skill progression

             ↓

CHARACTER FOUNDATION
Base Level
Base Skills
Vocation
Equipment
             ↓
Effective Skills
             ↓

BASELINE COMBAT
Auto Attack
Spells
Runes
Healing
Defense
             ↓

MODIFIERS
Equipment
Rarity / Affixes
Forge
Imbuements
Wheel
Skill Tree
Buffs / Debuffs
             ↓

TARGET DEFENSE
Armor
Shielding
Resistances
Mitigation
             ↓

FINAL COMBAT RESULT
```

This layered model is the foundation for the future Combat Engine.
