# Global Idle — Party & Character Roster System Foundation

**Document status:** DESIGN BASELINE / PARTIALLY OPEN  
**Scope:** Account character roster, vocation uniqueness, character-slot unlocks, Active Party composition, frontline positioning, Shared XP eligibility, and connection behavior.  
**Purpose:** Define the persistent product rules for how one player builds and controls a multi-character party before exact Party XP bonuses, unlock prices, and combat-role formulas are implemented.

---

# 1. Core Identity

Global Idle does **not** use a Tibia Global-style multiplayer party made of several human players.

A Global Idle Party belongs to **one player account and one online session**.

Conceptually:

```text
ONE PLAYER
↓
ONE ACCOUNT
↓
CHARACTER ROSTER
↓
ACTIVE PARTY
↓
SERVER-SIMULATED COMBAT
```

All characters in the Active Party are controlled by the same player.

There is no concept of:

```text
Player A controls Knight
Player B controls Druid
Player C controls Sorcerer
```

inside the normal Global Idle Party System.

---

# 2. Character Roster vs Active Party

The project must distinguish two concepts.

## Character Roster

The roster contains the characters/vocations the account has unlocked.

Maximum roster:

```text
5 characters
```

The five available vocations are:

- Knight;
- Druid;
- Sorcerer;
- Paladin;
- Monk.

## Active Party

The Active Party is the combat formation selected from the unlocked roster.

Active Party size:

```text
minimum: 1 character
maximum: 4 characters
```

Therefore:

```text
ROSTER MAX = 5
ACTIVE PARTY MAX = 4
```

If all five vocation characters are unlocked, at least one character must remain outside the Active Party.

---

# 3. One Character Per Vocation — LOCKED

An account may own **at most one character of each vocation**.

Duplicate vocations are prohibited.

Examples:

```text
Knight
Druid
Sorcerer
Paladin
Monk
```

is valid.

```text
Knight
Knight
Druid
Sorcerer
```

is invalid.

If the account started with Knight:

```text
Knight = already owned
```

Knight must not appear as an available future vocation unlock.

If the player later unlocks Druid:

```text
Knight = owned
Druid = owned
```

future unlock choices are limited to:

```text
Sorcerer
Paladin
Monk
```

The same vocation cannot be purchased/unlocked twice even if multiple roster slots are available.

This uniqueness rule is account-wide, not merely an Active Party restriction.

---

# 4. Initial / Origin Character

The first character is created through the normal onboarding flow.

```text
Create account
↓
Rookgaard
↓
Level 1
↓
Tutorial
↓
Reach Level 8
↓
Choose first vocation
```

This first character is the account's initial/origin character.

Example:

```text
Origin Character:
Knight
Level 8
```

The initial character is not required to remain permanently in the Active Party later.

After additional characters are unlocked, the player may freely remove the original character from the Active Party and play another unlocked character instead.

The original character therefore represents the account's starting character, not a permanent mandatory combat leader.

---

# 5. Character / Roster Slot Unlock Progression

The player begins with:

```text
Roster Slot 1
→ occupied by the Origin Character

Active Party Slot 1
→ available
```

Additional character capacity is unlocked through **in-game Gold**.

The current structural model is:

```text
Roster Slot 1 — starting character
Roster Slot 2 — unlock with Gold
Roster Slot 3 — unlock with Gold
Roster Slot 4 — unlock with Gold
Roster Slot 5 — unlock with Gold
```

Exact Gold prices and progression requirements are **OPEN**.

Each newly unlocked roster slot allows the player to create/unlock exactly one vocation that the account does not already own.

The first three additional roster unlocks can expand the usable Active Party toward the four-character maximum:

```text
1 unlocked character → Active Party up to 1
2 unlocked characters → Active Party up to 2
3 unlocked characters → Active Party up to 3
4+ unlocked characters → Active Party up to 4
```

Unlocking the fifth vocation expands the roster to five characters but does **not** create a fifth Active Party position.

The player chooses which four of the five unlocked characters, or fewer, are currently active.

---

# 6. Previous Fifth Active Party Slot Direction — SUPERSEDED

Any older project documentation that states or implies:

```text
5 active Party members
```

or:

```text
Premium unlocks a fifth Active Party slot
```

is superseded by this design.

The current locked limits are:

```text
5 characters in the account roster
4 characters maximum in the Active Party
```

Premium must not create a fifth simultaneous combat-party member under this design.

Future Premium benefits related to party management or convenience require separate product design.

---

# 7. Unlocking a New Character

A secondary character does **not** repeat the first-character tutorial.

A newly unlocked vocation character:

- does not start at Level 1;
- does not enter Rookgaard;
- starts at **Base Level 8**;
- begins directly in the post-Rookgaard game state;
- receives the appropriate initial Skill progression/Skill Points for a Level 8 character according to the final Skill system.

Example:

```text
Existing:
Knight Level 250

Unlock:
Druid

Result:
Knight Level 250
Druid Level 8
```

The exact Level 8 Skill Point amount remains dependent on the still-open Skill Point award model.

No special catch-up levels are granted.

---

# 8. Newly Unlocked Characters Are Independent Characters

Unlocking a vocation creates a real persistent character, not a temporary combat companion.

Each character has its own progression state.

At minimum this includes:

- vocation;
- Base Level;
- Base XP;
- Skills;
- Skill progression.

Other character-specific systems such as equipment, Wheel, Skill Tree and additional progression layers follow their own system designs.

Characters do not automatically inherit the Origin Character's level.

Example:

```text
Knight      Level 250
Druid       Level 167
Sorcerer    Level 95
Paladin     Level 40
Monk        Level 8
```

is a valid roster state.

---

# 9. Unlock Does Not Mean Active

Unlocking a character never forces that character into the Active Party.

The player explicitly chooses the current combat composition.

Examples:

## Solo

```text
ACTIVE PARTY

[1] Druid
```

Even if Knight, Sorcerer and Paladin are also unlocked, only Druid participates.

## Duo

```text
[1] Knight
[2] Druid
```

## Trio

```text
[1] Knight
[2] Druid
[3] Sorcerer
```

## Full Party

```text
[1] Knight
[2] Druid
[3] Sorcerer
[4] Paladin
```

A fifth unlocked vocation can remain inactive and be swapped into the formation later.

---

# 10. Active vs Inactive Characters

Only Active Party members participate in the current Hunt/Dungeon combat activity.

Only Active Party members are candidates for Party XP / Shared XP from that activity.

Characters outside the Active Party:

- do not participate in combat;
- do not receive Hunt/Dungeon Shared XP merely because they are unlocked;
- remain available for future formation changes.

Unlocking all five vocations therefore creates roster strategy rather than automatic five-character combat.

---

# 11. Party Formation Is Player-Controlled

The player may choose to run:

```text
1 character
2 characters
3 characters
4 characters
```

The player is never required to use every unlocked character.

This allows intentional progression choices.

Example:

```text
Knight Level 250
Druid Level 8
```

The player may remove Knight from the Active Party and play:

```text
[1] Druid Level 8
```

to progress the Druid independently.

When Druid later reaches an appropriate level range, the player may form:

```text
[1] Knight
[2] Druid
```

and use Shared XP if all eligibility rules are satisfied.

---

# 12. Party Positioning

Active Party order matters.

Conceptually:

```text
Slot 1
Slot 2
Slot 3
Slot 4
```

## Slot 1 — Frontline

The character in Slot 1 is the Party's frontline character.

Example:

```text
[1] Knight
[2] Druid
[3] Sorcerer
```

Knight is frontline.

If reordered:

```text
[1] Druid
[2] Knight
[3] Sorcerer
```

Druid becomes frontline.

The system does not force Knight or any specific vocation into Slot 1.

The player is allowed to make strategically strong or weak formations.

Exact targeting, aggro, damage-distribution and positional combat effects belong to the Combat/Party implementation design.

---

# 13. Origin Character vs Current Frontline

The project should not treat these concepts as the same thing.

```text
Origin Character
=
the character that completed the initial Level 1–8 journey
```

```text
Current Frontline
=
the character currently placed in Active Party Slot 1
```

They may be different.

Example:

```text
Origin Character: Knight
Current Frontline: Paladin
```

Whether the final UI uses the exact label "Origin Character" is OPEN, but the underlying distinction is required.

---

# 14. Shared XP — Core Principle

Party members do not automatically qualify for Shared XP merely because they are in the same Active Party.

Global Idle uses the Tibia Global level-range principle as the locked Shared XP eligibility rule.

Eligibility is evaluated across the **entire Active Party**.

The important values are:

```text
highestLevel
lowestLevel
```

The intermediate member levels do not require separate pair-by-pair validation.

---

# 15. Shared XP Level Eligibility — LOCKED

For an Active Party with two or more characters:

```text
highestLevel = highest Base Level among active members
lowestLevel  = lowest Base Level among active members
```

Calculate:

```text
minimumShareLevel =
ceil(highestLevel × 2 / 3)
```

Shared XP is level-eligible only when:

```text
lowestLevel >= minimumShareLevel
```

Equivalent conceptual rule:

```text
the lowest-level member must be at least
two-thirds of the highest-level member
```

Always round the minimum required level **up**.

---

# 16. Shared XP Examples

## Example A — Valid Duo

```text
Knight 250
Druid 167
```

Calculation:

```text
ceil(250 × 2 / 3)
=
ceil(166.666...)
=
167
```

Result:

```text
Druid 167 >= 167
✅ Party is level-eligible for Shared XP
```

## Example B — Invalid Duo

```text
Knight 250
Druid 166
```

Result:

```text
minimum = 167

166 < 167
❌ Party is not level-eligible for Shared XP
```

## Example C — Valid Full Party

```text
Knight      250
Druid       220
Sorcerer    190
Paladin     167
```

```text
highest = 250
lowest  = 167
minimum = 167
```

Result:

```text
✅ Shared XP level eligibility passes for the whole Party
```

## Example D — One Member Invalidates the Whole Party

```text
Knight      250
Druid       220
Sorcerer    190
Paladin     166
```

```text
highest = 250
lowest  = 166
minimum = 167
```

Result:

```text
❌ Shared XP level eligibility fails for the whole Party
```

One out-of-range active member is enough to make the Active Party fail Shared XP level eligibility.

---

# 17. No New-Character Shared-XP Exception

A newly unlocked Level 8 character receives **no special exception** to the Shared XP level-range rule.

Example:

```text
Knight Level 250
Druid Level 8
```

```text
minimum share level for highest Level 250 = 167
Druid = 8
```

Therefore:

```text
❌ Shared XP eligibility
```

The game must not bypass this rule to power-level newly unlocked vocation characters.

If the player wants to develop the Druid, they may:

- play the Druid solo;
- use a lower-level eligible composition;
- develop the Druid until it reaches the valid range for higher-level members.

This progression friction is intentional.

---

# 18. Shared XP Bonus / Distribution Metrics

Product direction:

> The Party Shared XP bonus/distribution model should use Tibia Global's Party Shared Experience metrics as its source reference.

However, this document locks the **level-range eligibility rule** and the Party structure, not a frozen numeric bonus table.

Before implementation:

- research/verify the current Tibia Global Shared Experience bonus and distribution rules;
- record the exact adopted Global Idle values in the Party implementation specification;
- do not silently invent different bonus percentages.

If the project later chooses to diverge from Tibia Global, that requires an explicit Product Owner decision.

---

# 19. Party With Shared XP Disabled — OPEN

It is not yet defined how Hunt XP is allocated when multiple characters remain in the Active Party but Shared XP eligibility is not satisfied.

Example:

```text
Knight 250
Druid 8
```

The composition can exist, but Shared XP is not eligible.

Before implementation, define whether:

- only specific characters receive XP;
- normal non-shared contribution rules apply;
- another explicit rule is used.

Do not invent this behavior in code.

---

# 20. Party Session and Disconnect Behavior

Because all Active Party members belong to one player account/session, there is no per-human-member Party disconnect problem.

Conceptually:

```text
PLAYER SESSION
↓
ACTIVE PARTY
├── Character 1
├── Character 2
├── Character 3
└── Character 4
```

If the player's connection is unexpectedly lost:

```text
ENTIRE ACTIVE PARTY
↓
RECONNECT_GRACE_PAUSED
```

The locked Global Idle 5-minute reconnect policy applies to the entire current activity.

During the reconnect grace:

- all Party combat is paused;
- no XP progresses;
- no loot is generated;
- no gold is generated;
- no room progression occurs;
- no supplies are consumed.

Reconnect within 5 minutes:

```text
same Party session resumes
```

Grace expires:

```text
current activity ends
```

Explicit logout/manual activity exit bypasses the grace period according to the global online-activity policy.

---

# 21. Party and Hunt Re-entry

If a disconnected Party fails to reconnect before the grace period ends, the Hunt session terminates.

A later Hunt entry follows the normal Hunt rule:

```text
start again at Room 1
```

The Party composition may be changed before beginning the next activity.

---

# 22. Party UI — Product Direction

The game should provide a dedicated Party/Roster management interface where the player can:

- see unlocked characters;
- see locked/unavailable vocations;
- identify each character's vocation and level;
- choose which unlocked characters are active;
- remove characters from the Active Party;
- reorder the Active Party;
- choose Slot 1 / Frontline;
- see whether the current formation is Shared-XP eligible;
- understand why Shared XP is disabled when the level-range rule fails.

Exact UI layout is future interface design.

A useful eligibility preview can expose:

```text
Highest Level: 250
Lowest Level: 166
Required Minimum: 167

Shared XP: NOT ELIGIBLE
```

This avoids making the player manually calculate the rule.

---

# 23. Vocation Unlock UI

When purchasing/unlocking a new character, the selection UI must show only vocations that the account does not already own.

Example:

```text
Owned:
Knight
Druid

Available:
Sorcerer
Paladin
Monk
```

It must not show Knight or Druid as purchasable duplicate characters.

Once a vocation is unlocked, it is removed from future vocation-unlock choices.

Exact confirmation flow and visuals are OPEN.

---

# 24. Gold Sink

Additional character/roster unlocks are an intentional Gold sink.

Conceptually:

```text
Play
↓
Earn Gold
↓
Unlock additional character slot
↓
Choose one remaining vocation
↓
Develop new character
↓
Expand Party strategy
```

Exact costs may scale per unlock.

Exact values and any non-Gold prerequisites remain OPEN.

---

# 25. Character Unlock Progression Loop

Example account path:

```text
START
Knight Level 8
Active Party: Knight
↓
progress / earn Gold
↓
unlock Roster Slot 2
choose Druid
↓
Knight 120
Druid 8
↓
develop Druid
↓
Druid enters valid Shared XP range
↓
Knight + Druid
↓
unlock additional vocation
↓
build larger formation
↓
eventually:
5 unique vocation characters unlocked
but
maximum 4 active at once
```

The system intentionally creates both:

- character progression;
- roster progression.

---

# 26. Strategic Consequence of Five Vocations / Four Active Slots

Once all five vocations are unlocked:

```text
Knight
Druid
Sorcerer
Paladin
Monk
```

the player cannot deploy all five simultaneously.

They must select up to four.

Example:

```text
ACTIVE
Knight
Druid
Sorcerer
Paladin

INACTIVE
Monk
```

or:

```text
ACTIVE
Knight
Druid
Paladin
Monk

INACTIVE
Sorcerer
```

This makes composition choice a permanent strategy layer rather than a simple progression toward using every character at once.

---

# 27. Party State — Conceptual

A conceptual Party state may eventually need to represent:

```text
rosterCharacters[]
activePartyCharacterIds[]
frontlineCharacterId
sharedXpEnabled
sharedXpEligibility
```

This is **not** an implementation schema.

Exact database fields, APIs and transport contracts belong to a later implementation specification.

---

# 28. Locked Decisions Summary

The following are LOCKED unless the Product Owner explicitly changes them.

## Ownership / Roster

- one player controls the entire Party;
- maximum roster = 5 characters;
- the roster supports the five vocations: Knight, Druid, Sorcerer, Paladin, Monk;
- maximum one character per vocation per account;
- duplicate vocation characters are prohibited;
- additional character slots/unlocks use in-game Gold;
- exact unlock costs remain OPEN.

## Active Party

- minimum Active Party size = 1;
- maximum Active Party size = 4;
- an unlocked character does not have to be active;
- the player may run solo, duo, trio or four-character Party;
- five active characters are not allowed;
- the older Premium fifth-active-party-slot direction is superseded.

## New Characters

- first/origin character performs Rookgaard Level 1–8;
- later unlocked vocation characters do not perform Rookgaard;
- later characters start at Level 8;
- later characters receive Level 8-appropriate Skill progression according to the final Skill model;
- no automatic catch-up level is granted.

## Formation

- Active Party can be reordered;
- Slot 1 is the current Frontline;
- the Origin Character is not permanently required in Slot 1 or even in the Active Party.

## Shared XP

- only active characters participate in Party Shared XP;
- level eligibility applies to the entire Active Party;
- use highest and lowest active Base Levels;
- `minimumShareLevel = ceil(highestLevel × 2 / 3)`;
- Shared XP level eligibility requires `lowestLevel >= minimumShareLevel`;
- one out-of-range member invalidates Shared XP eligibility for the whole formation;
- newly unlocked characters get no exception;
- Tibia Global Shared Experience metrics are the reference direction for bonus/distribution;
- exact adopted bonus table must be verified/documented before implementation.

## Connection

- one account/session controls the Party;
- disconnect pauses the entire Active Party;
- the global 5-minute reconnect grace applies to the entire current activity.

---

# 29. Open Decisions

The following remain OPEN and must not be silently decided by a builder:

- exact Gold cost for Roster Slots 2–5;
- whether unlock costs scale linearly, exponentially or by milestones;
- whether additional prerequisites besides Gold exist;
- exact final name for "Origin Character";
- exact Party/Roster UI;
- exact Shared XP bonus percentages and distribution table after Tibia Global verification;
- exact XP behavior when multiple active characters are not Shared-XP eligible;
- exact combat consequences of Party ordering beyond Slot 1 being Frontline;
- targeting/aggro rules between Party positions;
- (resolved in Phase 0A architecture: formation **and equipment** changes are rejected while an
  Activity is running - see `docs/architecture/DOMAIN_MODEL.md` §5.5 and §5.12)
- final Skill Point state granted to a newly unlocked Level 8 character;
- Premium/convenience benefits related to Party management now that there is no fifth active Party slot.

---

# 30. Documentation Supersession Notes

This document supersedes older project assumptions that describe:

```text
five-character Active Party
```

or:

```text
Premium fifth Active Party slot
```

The authoritative distinction is:

```text
ACCOUNT ROSTER
maximum 5 unique vocation characters

ACTIVE PARTY
maximum 4 selected characters
```

Existing project documents must be updated to match this rule before Party implementation begins.
