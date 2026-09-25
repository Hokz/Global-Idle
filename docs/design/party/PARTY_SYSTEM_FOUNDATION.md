# Global Idle — Party & Character Roster System Foundation

**Document status:** DESIGN BASELINE / PARTIALLY OPEN  
**Scope:** Account character roster, vocation uniqueness, character-slot unlocks, Active Party composition, frontline positioning, Shared XP eligibility, and connection behavior.  
**Purpose:** Define the persistent product rules for how one player builds and controls a multi-character party before exact Party XP bonuses, unlock prices, and combat-role formulas are implemented.

> **Amended 2026-09-25 —
> [`ADR-022`](../../architecture/decisions/ADR-022-game-account-main-character-and-companions.md).**
> The Product Owner replaced the roster of up to five **equivalent** Characters with **one Main
> Character per Game Account** plus **companions**:
>
> - a Game Account has exactly one Main Character — its campaign identity, this document's
>   *Origin Character* before Rookgaard — and unlocks further vocations as companions, at most one
>   per vocation, so at most four;
> - the personal Active Party is the Main plus up to three companions — 1 to 4 actors,
>   reorderable. The **Main is always present**, and need not hold Slot 1;
> - in human multiplayer each Game Account selects exactly one actor — its Main or a companion —
>   and the personal party never enters as a block.
>
> Superseded as written until 2026-09-24: §2's roster of five equivalent Characters, §4's Origin
> Character leaving the party, §5's roster slots as Characters, §8's *"real persistent character,
> not a temporary combat companion"*, the examples of §9, §11, §17 and §25 that leave the Main out
> of the party, and the matching lines of §28. Each carries a note where it stands. **Carried over
> unchanged:** one roster member per vocation, Gold unlocks, the Level-8 start with its own
> progression, the 1–4 Active Party, the Frontline, Shared XP eligibility and the connection rules.
> What the change leaves open is `ADR-022` §4. The current rules are in
> [`DECISIONS.md`](../../DECISIONS.md) § *Game Account, Main Character and companions* and
> § *Personal Active Party*.

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

*Since 2026-09-25 the account is the **Game Account**, and its roster is one Main Character plus
companions. A login identity above it may hold several Game Accounts (`ADR-022` §2).*

There is no concept of:

```text
Player A controls Knight
Player B controls Druid
Player C controls Sorcerer
```

inside the normal Global Idle Party System.

---

# 2. Character Roster vs Active Party

> **Superseded 2026-09-25 (`ADR-022`).** The roster is the Game Account's **Main Character** plus up
> to four **companions** — still five members at most, one per vocation — and the Active Party is
> the Main plus up to three companions. The limits below stand; *"characters"* in them means the
> Main and its companions.

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

An account may own **at most one roster Character of each vocation**.

Duplicate vocations are prohibited.

> **Character deletion — `ADR-020`, `LOCKED` 2026-09-24.** This replaces the earlier Phase 0A
> refinement (`ADR-007`, now `SUPERSEDED`), under which a *retired* Character stayed in persistence
> and freed its vocation at once. There is no retired Character any more. A deleted Character is
> `PENDING_DELETION` for 30 days and restorable, then **permanently purged**. During those 30 days
> it still holds its vocation, its roster place and, as the Origin Character, the Origin slot, so
> no replacement can make the promised restore impossible; only the purge frees them (G4.1b,
> `LOCKED` by the Product Owner).
> See `docs/DECISIONS.md` § *Character deletion*. *Since 2026-09-25 the grace is exactly 720
> elapsed hours and a full freeze, a historical record survives the purge, and the Character
> deleted is the Main; what happens to its companions is open (`ADR-020` §5.3).*

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

A vocation already held by a Character on the account cannot be purchased or unlocked again, even
if roster slots are free. A Character pending deletion still holds it throughout its 30-day
grace; only the **final purge** of that Character releases the vocation, and it becomes selectable
once more (`ADR-020` §5, G4.1b).

This uniqueness rule spans the whole **roster**, not merely the Active Party. *Carried over by
`ADR-022` §3: it spans the Main and every companion.*

---

# 4. Initial / Origin Character

> **Superseded in part 2026-09-25 (`ADR-022` PP2).** The first character is the Game Account's
> **Main Character**, and it is **always** in the personal Active Party. The two paragraphs below
> that let the player remove it from the party describe the superseded model. It is still not
> required to hold Slot 1 (PP3).

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

> **Read under `ADR-022` (2026-09-25).** Slot 1 holds the Main; slots 2–5 unlock **companions**,
> one vocation each. The capacity table stands, but the player now chooses which companions — up to
> three — join the Main, not which four of five characters are active. Whether an integer capacity
> stays the representation is Phase 4's choice.

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

*Since 2026-09-25: the Main and up to four companions in the roster, and the Main plus up to three
companions in the Active Party (`ADR-022`).*

Premium must not create a fifth simultaneous combat-party member under this design.

Future Premium benefits related to party management or convenience require separate product design.

---

# 7. Unlocking a New Character

> **Read under `ADR-022` (2026-09-25):** the newly unlocked character is a **companion**. Everything
> this section says of it is carried over.

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

> **Superseded wording 2026-09-25 (`ADR-022`).** A newly unlocked vocation is now a **companion**,
> and a companion is not an account-lifecycle Character equivalent to the Main (GA4). The sentence
> below used *"companion"* for something temporary; the progression it protects carries over: a
> companion has its own vocation, Base Level, Base XP and Skills, and inherits no level. Its
> custody, Stamina, occupancy, lifecycle and name are open (`ADR-022` §4).

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

> **Read under `ADR-022` (2026-09-25):** every formation includes the Main. The solo formation is
> the Main alone, the examples below hold only where the Main is one of the listed characters, and
> the fifth vocation that sits out is a companion.

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

*Since 2026-09-25 only companions can be outside the Active Party; the Main is always in it.*

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

> **Superseded example 2026-09-25 (`ADR-022` PP2).** If the Knight is the Main, it cannot leave the
> Active Party, so the Druid cannot be played alone this way. How a low-level companion progresses
> is open (GA-O6). Human multiplayer, where any unlocked companion may be the selected actor (MP3),
> is one path.

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

The system does not force Knight or any specific vocation into Slot 1 — nor the Main (`ADR-022`
PP3).

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

*Since 2026-09-25 the Origin Character is the Game Account's Main. It is always in the Active
Party, and it need not be the Frontline (`ADR-022` PP2–PP3).*

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

> **Read under `ADR-022` (2026-09-25):** a companion cannot be played solo — the Main is always
> present — so the first option below no longer exists for a companion, and how a low-level
> companion levels is open (GA-O6). The rule itself, no exception, stands.

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

*Since 2026-09-25 this matters more: the Main is always present, so a Level-250 Main with a new
Level-8 companion is exactly this case (`ADR-022` GA-O6).*

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
- remove companions from the Active Party — never the Main (`ADR-022` PP2);
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

Additional character/roster unlocks are an intentional Gold sink. *Since 2026-09-25 they are
companion unlocks (`ADR-022`).*

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

*Read under `ADR-022` (2026-09-25):* the Knight is the Main, so it never leaves the party, and how
*"develop Druid"* happens while it is present is open (GA-O6).

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

*Since 2026-09-25 the Main is always one of the four, so the choice is which companion sits out.*

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

*Since 2026-09-25 it also needs to know which member is the Main, which every formation contains
(`ADR-022`).*

This is **not** an implementation schema.

Exact database fields, APIs and transport contracts belong to a later implementation specification.

---

# 28. Locked Decisions Summary

The following are LOCKED unless the Product Owner explicitly changes them. *Updated 2026-09-25 for
`ADR-022`.*

## Ownership / Roster

- one player controls the entire Party;
- a Game Account has exactly one **Main Character**; further vocations are **companions**
  (`ADR-022`, 2026-09-25);
- maximum roster = 5: the Main and up to four companions;
- the roster supports the five vocations: Knight, Druid, Sorcerer, Paladin, Monk;
- maximum one roster member per vocation per Game Account;
- duplicate vocation characters are prohibited. A deleted Character is restorable for 30 days —
  exactly 720 elapsed hours, fully frozen — and then permanently purged; it holds its vocation and
  its roster place until the purge, and only the purge frees them (`ADR-020` §5, G4.1b — which
  supersedes `ADR-007`'s retirement). The deleted Character is the Main; what happens to its
  companions is open (`ADR-020` DEL-O1);
- companions are unlocked with in-game Gold;
- exact unlock costs remain OPEN.

## Active Party

- minimum Active Party size = 1 — the Main alone;
- maximum Active Party size = 4 — the Main and up to three companions;
- the **Main is always present** (`ADR-022` PP2, 2026-09-25);
- an unlocked companion does not have to be active;
- the player may run a solo, duo, trio or four-actor Party, and every one includes the Main;
- five active characters are not allowed;
- the older Premium fifth-active-party-slot direction is superseded.

## New Characters

- the first character — the Main, the *Origin Character* before Rookgaard — performs Rookgaard
  Level 1–8;
- companions do not perform Rookgaard;
- companions start at Level 8;
- companions receive Level 8-appropriate Skill progression according to the final Skill model;
- no automatic catch-up level is granted.

## Formation

- Active Party can be reordered;
- Slot 1 is the current Frontline;
- the Main is not required in Slot 1. ~~Nor even in the Active Party~~ — **superseded
  2026-09-25**: the Main is always in it (`ADR-022` PP2).

## Shared XP

- only active characters participate in Party Shared XP;
- level eligibility applies to the entire Active Party;
- use highest and lowest active Base Levels;
- `minimumShareLevel = ceil(highestLevel × 2 / 3)`;
- Shared XP level eligibility requires `lowestLevel >= minimumShareLevel`;
- one out-of-range member invalidates Shared XP eligibility for the whole formation;
- newly unlocked companions get no exception;
- Tibia Global Shared Experience metrics are the reference direction for bonus/distribution;
- exact adopted bonus table must be verified/documented before implementation.

## Connection

- one account/session controls the Party;
- disconnect pauses the entire Active Party;
- the global 5-minute reconnect grace applies to the entire current activity.

## Human multiplayer — 2026-09-25

- each participating Game Account selects exactly one actor: its Main or any unlocked companion;
- the personal Active Party never enters multiplayer as a block (`ADR-022` MP1–MP5).

---

# 29. Open Decisions

The following remain OPEN and must not be silently decided by a builder:

- exact Gold cost for Roster Slots 2–5 — the companion unlocks;
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
- Premium/convenience benefits related to Party management now that there is no fifth active Party slot;
- *since 2026-09-25* (`ADR-022` §4): a companion's lifecycle (GA-O1); what happens to the
  companions when the Main is deleted (GA-O2); companion custody, Stamina, occupancy and names
  (GA-O3–GA-O5, GA-O7); and how a low-level companion levels with the Main always present (GA-O6).

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

**2026-09-25.** This document's own roster of five equivalent Characters is superseded in turn by
`ADR-022`: one Main Character per Game Account, up to four companions, and a personal Active Party
that always contains the Main. The limits above still read true as numbers — five roster members,
four active — with the Main as one of each.
