# Global Idle — Tutorial & Rookgaard Roadmap

**Document status:** DESIGN BASELINE  
**Scope:** First-character onboarding, Rookgaard progression from Level 1 to Level 8, and the transition to Mainland.  
**Purpose:** Define what the player learns, in what order, and which systems are introduced before the real long-term progression begins.

---

# 1. Design Principle

Rookgaard is the player's **basic game school**.

The tutorial is not meant to teach every advanced system in detail. Its goal is to ensure that, before reaching Mainland, the player understands:

- how to interact with NPCs;
- how to buy and sell;
- how combat is presented;
- how Hunt Areas work;
- how Dungeons work;
- how Treasure Chests work;
- how XP and levels work;
- what Skills are;
- how loot, capacity and supplies work;
- how to navigate through the Atlas;
- what the five vocations are;
- that advanced progression systems such as Skill Tree and Wheel of Destiny exist.

The tutorial must be **linear and guided**.

The player should always understand:

1. what the current objective is;
2. why the system being shown matters;
3. what to click or do next.

The tutorial should teach mechanics **when the player needs to use them**, rather than presenting long theoretical explanations.

---

# 2. First Character vs Additional Characters

> **Read under
> [`ADR-022`](../../architecture/decisions/ADR-022-game-account-main-character-and-companions.md)
> (2026-09-25).** The first character is the Game Account's **Main Character**. Additional
> vocations are **companions**: they never enter Rookgaard and start at Base Level 8. A different
> Main vocation means another Game Account under the same login, and whether that Game Account's
> Main plays Rookgaard is open (GA-O9). The deletion edge case below now concerns the Main, and
> whether a replacement Main may exist after its purge is open for the PRE-4 specification
> (`ADR-020` DEL-O1).

The account must track whether the onboarding has already been completed.

Recommended account-level state:

```text
tutorialCompleted
tutorialVersionCompleted
```

Do not determine tutorial eligibility only by counting existing characters.

Example edge case:

```text
Player completes tutorial
→ deletes first character
→ creates another character
```

The account should still know that the tutorial was previously completed.

> **`LOCKED` — G4.1c, Product Owner, 2026-09-24.** This edge case is decided. Tutorial completion
> belongs to the Account, and deleting or purging the Origin Character does not reset it. A
> Character created after that purge does not restart the first-character tutorial automatically:
> it follows the later-character flow — Base Level 8, no Rookgaard, the post-Rookgaard state — and
> no one-time tutorial or account reward is awarded again. See
> [`DECISIONS.md`](../../DECISIONS.md) § *Character deletion* and
> [`ADR-020`](../../architecture/decisions/ADR-020-character-deletion-grace-and-purge.md) §5.1.
> The optional PLAY / SKIP offer below and the replay questions of §43 stay open, within that
> rule.

## First character / tutorial never completed

The Level 1–8 tutorial is mandatory.

> **`LOCKED` — G4.1c, pre-completion case, Product Owner, 2026-09-24.** If the Origin Character is
> permanently purged before the account completes Rookgaard, the next Character is a **new Origin
> Character** at Base Level 1, and this mandatory tutorial starts again. It receives a fresh
> **Bootstrap Kit** — enough to make the tutorial playable, bound to that Character, never
> movable to the Depot, the Stash or another Character, never tradeable, sellable or convertible
> into Account value, and destroyed with it. The kit is **not** a Tutorial Reward. Tutorial
> Rewards — the tutorial's real rewards, such as the Doublet of §19 — are Account-governed:
> one-time where defined as one-time (§43 decides which), and never replayed merely because the
> Origin Character was purged. See
> [`ADR-020`](../../architecture/decisions/ADR-020-character-deletion-grace-and-purge.md) §5.2,
> which also classifies today's starting grant.
>
> *Since 2026-09-25:* the kit's potions are Character-bound tutorial consumables under `ADR-021` —
> they may rest in the Depot, still bound — and how the starter gear is represented is open
> (`ADR-020` DEL-O4). The Doublet Quest's final chest is claimed once per Game Account, and the
> Doublet it holds is an ordinary item, never part of the kit (`ADR-023`, §19).

## Additional character after tutorial completion

The game may offer:

```text
PLAY TUTORIAL
SKIP TUTORIAL
```

The exact skip flow is a later design item.

*Under `ADR-022` (2026-09-25) an additional vocation is a companion, which never enters Rookgaard.
This offer can only concern a replacement Main or a second Game Account's Main, and both are open
(DEL-O1, GA-O9).*

---

# 3. Character Entry Flow

```text
Public Landing Page
        ↓
Login
        ↓
Character Selection
        ↓
Existing Character
or
Create New Character
        ↓
Play
        ↓
Rookgaard Temple
```

Every new tutorial character starts:

```text
Base Level: 1
Location: Rookgaard Temple
Vocation: not yet chosen
```

The character's vocation is chosen only at Level 8.

*Read under `ADR-022` (2026-09-25):* a Game Account has one Main, so *character selection* becomes
choosing a Game Account once a login holds several, and that UX is open (GA-O10). Every new Main
starts as above; a companion never does.

---

# 4. Level 1 — Rookgaard Temple

The player's first gameplay interaction occurs in the Temple of Rookgaard.

The first NPC:

- welcomes the player;
- introduces the world;
- explains the most basic interface concepts;
- teaches NPC interaction;
- establishes the next objective.

The exact dialogue is not locked yet.

The intention is that the player feels that they have entered an RPG world, not merely an idle menu.

---

# 5. NPC Interaction Tutorial

The first phase introduces NPC conversation.

The UI can highlight interactive elements using:

- glow;
- pulse;
- arrows;
- bold text;
- focus masks;
- contextual tooltips.

Example:

```text
✨ NPC highlighted
"Click the NPC to begin a conversation."
```

The player is then directed toward a merchant/service NPC.

---

# 6. Buy / Sell Tutorial

The next tutorial block introduces commerce with NPCs.

The player learns:

- opening an NPC shop;
- buying;
- selling;
- that gold is a gameplay currency;
- that towns are important for resupplying and disposing of loot.

This phase should prepare the player for the first Hunt Area.

---

# 7. First Hunt — Rookgaard Sewers

The first Hunt Area is:

```text
Rookgaard Sewers
Primary creature: Rat
```

The character remains here until reaching **Level 2**.

This first hunt is a **combat tutorial hunt**.

The underlying combat must use the real Combat Engine. It must not use a special fake tutorial-only combat system.

The tutorial layer simply explains what the real system is doing.

---

# 8. Combat Interface Tutorial

During the Rat hunt, the game guides the player through the combat interface.

Systems that may be highlighted:

- character HP;
- character Mana;
- current enemy/enemies;
- battle state;
- damage feedback;
- XP gained;
- loot received;
- supplies;
- activity status;
- leave/stop Hunt controls.

The presentation should be sequential and intuitive.

Example:

```text
HP BAR highlighted
↓
short explanation

BATTLE / ENEMY area highlighted
↓
short explanation

XP / LOOT area highlighted
↓
short explanation
```

The character then continues hunting until reaching Level 2.

---

# 9. Level 2 — Tutorial Pause

When the character reaches Level 2:

```text
LEVEL 2 REACHED
→ Hunt pauses
→ tutorial overlay opens
```

The game uses this moment to introduce the broader progression model.

---

# 10. Base Level, Skills and Advanced Progression Preview

At Level 2 the player is introduced to three different concepts:

## Base Level

Base Level represents the character's general progression.

Combat and activities grant Base XP.

## Skills

Skills represent permanent proficiencies such as:

- Sword;
- Axe;
- Club;
- Distance;
- Shielding;
- Magic Level;
- other skills defined later.

Skills are **not** the same thing as spells or abilities.

Skills contribute to the character's basic combat power.

The detailed mathematical system is defined in the Combat & Progression document.

## Skill Tree

Skill Tree is an advanced vocation-development system.

During Rookgaard:

```text
SKILL TREE 🔒
Not yet usable
```

The player learns only that it will later allow deeper vocation-specific development.

## Wheel of Destiny

Wheel of Destiny is another advanced progression/specialization system.

During Rookgaard:

```text
WHEEL OF DESTINY 🔒
Not yet usable
```

The player receives only a conceptual preview.

### Important Rookgaard rule

Skill Tree and Wheel of Destiny are **not actively used in Rookgaard**.

They become real build systems only after:

```text
Level 8
→ choose vocation
→ travel to Mainland
```

---

# 11. Skills Training Preview

The Level 2 tutorial should also explain that Skills are not dependent exclusively on monster XP.

The player is introduced conceptually to:

- Skill Points / Skill progression;
- Exercise Weapons;
- Training Dummies;
- online training;
- offline training.

Detailed cost, timing and formulas are not part of the Rookgaard tutorial specification.

The tutorial goal is simply:

> "Skills can improve through normal character progression and through dedicated training systems."

---

# 12. Atlas Tutorial

After the Level 2 progression explanation, the game opens the **World Atlas**.

The Atlas represents the entire game world, but the tutorial camera is focused on **Rookgaard**.

The full world may be visible in a locked/unavailable state to create a sense of scale.

Example:

```text
WORLD ATLAS

Rookgaard     AVAILABLE

Mainland      🔒
Thais         🔒
Carlin        🔒
Edron         🔒
...
```

The exact geography and destinations are separate design work.

---

# 13. Atlas Interaction Tutorial

The Atlas tutorial teaches navigation through direct visual highlighting.

Use:

- glow;
- pulsing markers;
- bold labels;
- animated pinpoints;
- contextual explanations.

The Atlas may introduce icons/categories such as:

- Hunt Area;
- Dungeon / Quest;
- NPC / Service;
- town/service points;
- other categories introduced later.

The game should not overload the user with every future Atlas feature at once.

---

# 14. First Mandatory Quest / Dungeon

After the Atlas explanation, the next tutorial objective is mandatory:

```text
Complete your first Dungeon
```

The Atlas highlights the **Doublet Quest** location in Rookgaard.

The player is guided directly to it.

During this part of the tutorial, unrelated activities may remain visible but unavailable until the current onboarding objective is completed.

---

# 15. Dungeon vs Hunt Area — Core Distinction

This is a permanent game rule.

## Dungeon

Purpose:

- progression content;
- boss encounters;
- quests;
- special rewards;
- Treasure Chest opportunities.

Standard structure:

```text
Floor 1
↓
Floor 2
↓
...
↓
Floor 9
↓
Floor 10 — Boss
↓
Dungeon Complete
```

Each floor becomes progressively harder through:

- more creatures;
- stronger creatures;
- more dangerous combinations.

Floor 10 contains the boss encounter.

## Hunt Area

Purpose:

- repeatable farming;
- XP;
- gold;
- creature loot;
- character progression.

Hunt Areas are effectively endless until the player chooses or is forced to leave.

---

# 16. Standard Dungeon Structure

All standard Dungeons use a 10-floor encounter framework.

```text
Floors 1–9
Progressive creature encounters

Floor 10
Boss
```

The exact enemies, scaling, room layout and mechanics are configured per Dungeon.

The system should be generic.

Do not implement each Dungeon as a custom combat engine.

---

# 17. Dungeon Treasure Chests

Treasure Chests exist **only in Dungeons**.

Hunt Areas do not generate Dungeon Treasure Chests.

In normal Dungeons:

```text
Dungeon progression
↓
Treasure Chest chance
↓
No Chest
OR
Treasure Chest
```

Treasure Chests may contain:

- common rewards;
- uncommon rewards;
- rare rewards;
- equipment;
- special resources;
- other reward categories introduced later.

The exact tables are future balance work.

Future systems/items may increase:

```text
Dungeon Treasure Chest Chance
```

Exact modifiers are not yet defined.

---

# 18. Tutorial Dungeon Chest Exception

The first tutorial Dungeon must contain a **guaranteed Treasure Chest**.

This is a tutorial-only exception.

Recommended implementation concept:

```text
tutorialChestGuaranteed = true
```

Do not make "Floor 10 always gives a chest" a universal Dungeon rule.

The purpose is pedagogical:

> ensure every new player sees and understands the Dungeon Chest system.

---

# 19. First Dungeon — Doublet Quest

Current high-level encounter concept:

```text
Floors 1–9:
Rookgaard creatures

Possible examples:
Rat
Cave Rat
Wolf
Spider
Snake
other low-level Rookgaard creatures

Floor 10:
Boss TBD
Current candidate: Minotaur
```

The exact floor-by-floor enemy table is **not yet approved**.

The boss is also **not yet locked**.

## Completion flow

```text
Floor 10 Boss defeated
↓
Guaranteed tutorial Treasure Chest
↓
Player opens chest
↓
Doublet reward
↓
Dungeon Complete
```

The Doublet also creates a natural opportunity to introduce equipment as a reward system.

`LOCKED` 2026-09-25 (`ADR-023`): the Doublet Quest can be run again like any quest, but its
guaranteed final chest is claimed **once per Game Account**, and a replay never re-enables it. The
**Doublet is an ordinary item** — movable, sellable, tradeable and discardable under the normal
item rules — never Character-bound for coming from a quest.

---

# 20. Dungeon Completion

After the player completes the first Dungeon:

```text
CONGRATULATIONS
First Dungeon Completed
```

The tutorial then explicitly explains:

```text
DUNGEON
→ 10-floor challenge
→ boss content
→ Treasure Chest chance

HUNT AREA
→ repeatable farming
→ XP
→ gold
→ normal loot
→ long-term character progression
```

The Atlas opens again.

---

# 21. First Main Hunt Area Tutorial

The tutorial selects a first regular Hunt Area.

Current working example:

```text
Wolf Cave
```

The exact location/name can be changed later.

The tutorial remains linear.

The player is guided to the selected Hunt Area.

---

# 22. Hunt Area Structure

Hunt Areas use a room/respawn progression model.

```text
Room 1
↓
Room 2
↓
Room 3
↓
...
↓
Room 9
↓
Room 10
↓
Room 10
↓
Room 10
↓
Infinite loop
```

Each cleared room transitions to a harder respawn.

Difficulty can increase through:

- creature count;
- stronger creatures;
- creature combinations.

Room 10 is the Hunt's **maximum respawn intensity**.

There is no Room 11, 12, 13, etc.

---

# 23. Room 10 Infinite Loop

After the player reaches Room 10:

```text
Room 10 spawn
↓
clear
↓
respawn Room 10
↓
clear
↓
respawn Room 10
↓
...
```

This continues indefinitely while the character remains in the Hunt.

A Hunt may theoretically continue for a very long time if the character can sustain it.

---

# 24. Leaving a Hunt

The player may leave a Hunt Area at any time.

The game must not force a specific stay duration.

When the player leaves:

```text
Hunt activity ends
```

If the player later re-enters:

```text
Start again at Room 1
```

Room progress is **not persistent** between separate Hunt sessions.

## Staying online

Hunts require the character to remain online. The server simulates combat only while the
session is connected.

- a background or minimized browser may keep hunting while the connection stays alive;
- losing the connection pauses the Hunt and holds it for 5 minutes; reconnecting in time
  resumes the same Hunt exactly where it stopped;
- if the player does not return in time the Hunt ends, and a later re-entry starts again at
  Room 1, as above;
- offline progression is limited to Skill Training.

The tutorial only needs to convey the gameplay implication: the character hunts while you are
connected, and a short disconnection is forgiven.

---

# 25. XP Tutorial

The first Hunt Area explains that farming creatures provides:

- Base XP;
- Skill-related progression;
- gold;
- normal creature loot.

The player is taught that Hunt Areas are the primary repeatable environment for developing the character.

---

# 26. Experience Boost

During the Hunt tutorial, the player is informed that an **Experience Boost** system exists.

Current direction:

- Experience Boost can be acquired through the Store;
- it increases XP gains;
- exact multiplier;
- cost;
- duration;
- limits;
- stacking rules

are **not yet defined**.

The tutorial should explain the concept without overwhelming the player with monetization.

A Store XP Boost is a **Character-bound consumable** (`LOCKED`,
[`ADR-021`](../../architecture/decisions/ADR-021-character-bound-consumables-and-store-container.md)):
bound to one Character, never traded or sold.

---

# 27. Creature Loot vs Dungeon Treasure Chest

The game must clearly explain:

```text
CREATURE LOOT
≠
DUNGEON TREASURE CHEST
```

## Creature Loot

Generated by killing normal creatures/bosses according to their loot tables.

Can include:

- gold;
- creature products;
- equipment;
- consumables;
- other item types.

## Dungeon Treasure Chest

Special Dungeon-only reward opportunity.

This distinction should remain clear throughout the game.

---

# 28. Loot Capacity

Characters have a maximum **Loot Capacity**.

Creature loot fills this capacity.

Example UI:

```text
Loot Capacity
██████████████░░░░░░
72%
```

When Loot Capacity reaches 100%:

- the character may continue hunting;
- the Hunt is not automatically stopped;
- new loot is no longer collected;
- the game displays a clear warning.

Example:

```text
LOOT CAPACITY FULL

Your character can continue hunting,
but new loot will no longer be collected.
```

The player decides whether to remain or return to town.

---

# 29. Supplies

Hunts consume supplies such as:

- Health Potions;
- Mana Potions;
- ammunition;
- other future resources.

When supplies run out:

- the Hunt does not automatically stop;
- the player receives a warning;
- the character may continue;
- the risk of death increases.

Example:

```text
SUPPLIES DEPLETED

Your character has run out of healing
or mana supplies.

You may continue hunting,
but the risk of death is higher.
```

The game informs.

The player decides.

*2026-09-25:* the tutorial's own Health and Mana potions are **Character-bound tutorial
consumables** in the Store Container model (`ADR-021` S6). The direction is 20 Health and 20 Mana
potions, neither final while combat balance is calibrated. How a Hunt uses a bound potion held in
the Store Container is open (`ADR-020` DEL-O5). Potions bought at a counter stay ordinary items.

---

# 30. Core Hunt Management Philosophy

Permanent design principle:

> The game reports the state and the risk. The player decides what to do.

Do not automatically force the character out of a Hunt merely because:

- Loot Capacity is full;
- potions are gone.

Potential future configurable automation may exist, but it must be an explicit player-controlled feature.

Examples for future design:

```text
Leave at 90% Loot Capacity
Leave when Health Potions < 20
Leave when Mana Potions < 20
Leave after X hours
Leave at Base Level X
```

These are not default forced rules.

---

# 31. Main Tutorial Objective — Reach Level 8

After the first full Hunt tutorial, the guided tutorial largely steps back.

The Main Quest becomes:

```text
REACH LEVEL 8
```

The player now understands enough of the basic loop to progress.

The objective remains visible.

---

# 32. Level 8 Event

When the character reaches Base Level 8:

```text
LEVEL 8 REACHED
↓
Current Hunt stops
↓
Character is automatically returned to Rookgaard Temple
↓
NPC tutorial resumes
```

The player is told that they have reached the point where they can choose a vocation and leave for Mainland.

Rookgaard is presented as a one-way introductory land.

The narrative direction is:

> Your training in Rookgaard is complete.  
> Choose your vocation.  
> Travel to Mainland.  
> Your real adventure begins there.

Exact dialogue remains open.

---

# 33. Oracle Objective

After the Level 8 explanation:

```text
Atlas opens
↓
Rookgaard focused
↓
Oracle NPC marker glows/pulses
↓
Player is directed to the Oracle
```

The Oracle starts the Vocation Selection flow.

---

# 34. Vocation Selection

Five vocation options:

- Knight;
- Druid;
- Sorcerer;
- Paladin;
- Monk.

Each vocation should have:

- a reference image/illustration;
- name;
- short identity description;
- primary role;
- concise gameplay description.

Desktop:

- hover can reveal/expand information.

Mobile/touch:

- tap must expose the same information.

The system cannot depend on hover alone.

---

# 35. Vocation Identity — Current Direction

## Knight

Role:

```text
Tank / Melee
```

High durability, melee specialization, protection and control.

## Druid

Role:

```text
Support / Healer
```

Healing, sustain, cleansing and allied support.

## Sorcerer

Role:

```text
Elemental DPS
```

Offensive magic, burst and area damage.

## Paladin

Role:

```text
Ranged / Holy DPS
```

Ranged physical and Holy-oriented damage.

## Monk

Role:

```text
Debuff / Hybrid Support
```

Enemy debuffs, ally support/cleanse and mid-tier damage.

Exact stats and abilities belong to later vocation design.

---

# 36. Vocation Confirmation

Vocation choice must require confirmation.

Example:

```text
You have chosen:

KNIGHT

[ BACK ]
[ CONFIRM KNIGHT ]
```

Only after confirmation is the vocation permanently applied.

Exact respec/change-vocation rules are future design.

---

# 37. End of Rookgaard Tutorial

After vocation selection:

```text
Vocation chosen
↓
Mainland unlocked
↓
Rookgaard tutorial completed
↓
Account tutorial flag updated
↓
Travel to Mainland
```

Important:

Skill Tree and Wheel of Destiny were previewed in Rookgaard but **are not actively used there**.

Actual advanced character build development begins in Mainland.

---

# 38. Rookgaard Learning Summary

By the time the player leaves Rookgaard, they should understand:

```text
NPC interaction
Buy / Sell
Basic combat interface
Base XP / Level
Skills concept
Exercise Training concept
Atlas navigation
Dungeon structure
Boss encounters
Dungeon Treasure Chests
Hunt Area structure
Room progression
Infinite Room 10
Creature loot
Loot Capacity
Supplies
Player-controlled Hunt exit
Vocation identities
Skill Tree preview
Wheel of Destiny preview
```

---

# 39. Systems Explicitly NOT Fully Taught in Rookgaard

Rookgaard is not the advanced build tutorial.

The following belong mainly to Mainland:

- actual Skill Tree spending;
- actual Wheel of Destiny spending;
- advanced vocation mechanics;
- full spell progression;
- advanced elemental combat;
- Forge;
- Imbuements;
- player Market;
- advanced party systems;
- endgame bosses;
- advanced quest mechanics;
- equipment optimization;
- deep economy systems.

---

# 40. Visual Map Development Constraint

The complete visual Hunt/Dungeon maps are **not required for the first implementation**.

The tutorial mechanics must be able to run using placeholder activity arenas.

Architecture must support:

```text
Activity logic
+
optional Visual Map
```

Later:

```text
visualMapId = actual edited map
```

can replace the placeholder without changing gameplay rules.

The World Atlas is a separate system and may be implemented earlier.

---

# 41. Tutorial State Model — Concept

Suggested conceptual state tracking:

```text
tutorialVersion
tutorialStep
tutorialCompleted

currentObjective
rookgaardProgress
firstDungeonCompleted
firstHuntTutorialCompleted
atlasTutorialCompleted
vocationSelected
```

Exact schema belongs to implementation design.

Tutorial progress must persist across logout/browser closure.

---

# 42. Tutorial Roadmap Summary

```text
LEVEL 1
Rookgaard Temple
↓
First NPC
↓
Basic UI
↓
NPC interaction
↓
Buy / Sell
↓
Rookgaard Sewers
↓
Rat Hunt
↓
Combat Interface Tutorial
↓

LEVEL 2
Pause
↓
Base Level / Skills explanation
↓
Exercise Training preview
↓
Skill Tree preview 🔒
↓
Wheel of Destiny preview 🔒
↓
Atlas Tutorial
↓
Doublet Quest
↓
Dungeon Floors 1–9
↓
Floor 10 Boss
↓
Guaranteed Treasure Chest
↓
Doublet
↓
Dungeon Complete
↓
Dungeon vs Hunt explanation
↓
Atlas
↓
First regular Hunt Area
↓
XP / Loot / Capacity / Supplies tutorial
↓
Room 1 → Room 10
↓
Infinite Room 10
↓

MAIN QUEST
Reach Level 8
↓

LEVEL 8
Return to Rookgaard Temple
↓
Oracle highlighted in Atlas
↓
Choose Vocation
↓
Knight / Druid / Sorcerer / Paladin / Monk
↓
Confirm Vocation
↓
Leave Rookgaard
↓
Tutorial Complete
↓
Mainland
```

---

# 43. Open Tutorial Decisions

Not yet locked:

- exact NPC dialogue;
- exact tutorial NPC identities;
- exact first merchant inventory;
- exact floor-by-floor Doublet Dungeon creatures;
- exact first Dungeon boss;
- exact first standard Hunt Area name/location;
- exact Rookgaard XP pacing;
- exact Atlas icon set;
- exact Level 2 UI copy;
- tutorial skip behavior — since 2026-09-25 only a replacement Main or a second Game Account's
  Main could concern it, because companions never enter Rookgaard (`ADR-022` GA-O9, `ADR-020`
  DEL-O1);
- exact visual effects/highlights;
- exact Mainland destination flow after vocation selection;
- whether all Rookgaard systems are replayable after tutorial completion;
- exact tutorial reward tables besides the guaranteed Doublet, and which *other* tutorial
  rewards are one-time per account (G4.1c): a one-time Tutorial Reward is never replayed for a
  replacement Origin Character. The Doublet Quest's final chest is decided — one-time per Game
  Account (`ADR-023`, 2026-09-25);
- the final tutorial Health and Mana potion quantities, and how the starter gear is represented
  (`ADR-020` DEL-O4).

These must be discussed before implementation if they materially affect behavior.
