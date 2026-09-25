# Research References

## Internal reference repositories

### Global Idle
https://github.com/Hokz/Global-Idle

This repository is the product/implementation repository.

### Canary — the DEFAULT TECHNICAL BASELINE for Tibia gameplay behaviour
https://github.com/Hokz/canary

**Not "a reference". The baseline.** Where Tibia already answers a gameplay question, Global Idle
takes that answer from Canary rather than inventing a fresh generic-RPG one:

- creature HP, XP, speed, attacks, defence, armour, resistances and immunities;
- vocation baseline parameters;
- spells, runes and cooldowns;
- combat formulas, and the ORDER damage is reduced in (defence, then armour, then mitigation);
- RNG shape and rounding;
- death conditions;
- loot identities for later phases;
- the experience-per-level curve.

The distinction that keeps this honest:

```text
Tibia / Canary  =  baseline BEHAVIOUR and DATA
Global Idle     =  adaptation to AUTOMATIC / IDLE execution
```

### The baseline is 1x

Global Idle starts from the CURRENT Tibia Global / Canary baseline **at 1x**. Unless a deliberate
override is documented, the source's own numbers are the numbers:

creature HP · creature Base XP · creature attacks and damage · defences, armour, resistances and
immunities · ordinary loot identity and baseline chance · vocation baseline parameters · item
weight · spells, runes and cooldowns · combat formulas, their ORDER and their rounding · the
experience curve · the death-loss formula · blessing protection · Promotion protection.

**Documented override, 2026-09-25 — immunities.** Ordinary Hunt design avoids absolute 100%
creature immunities and uses resistances, sensitivities and weaknesses instead (`DECISIONS.md`
§ *Creature elemental design*). A baseline immunity is reference data; ordinary Hunt content does
not copy it as an absolute rule, and the resistance values used instead are content design, still
open.

**Not decided here — combat formulas.** A combat formula revision was discussed after PR #13 head
`86a7681` — attack coefficients, the auto-attack range, whether Canary's coefficient is adopted,
the starting Skill value, Defense and Armor rolls, rounding stages and skill scaling. It is
**open**, and handled separately; this page neither adopts nor rejects any of it. The formulas
Phases 2–3.6 implemented and verified stand until a decision replaces them.

**Do not globally scale HP, XP, damage or loot chance because this is an idle game.** An idle game
changes how often a fight happens and who presses the buttons. It does not change what a Rat is.
A server that multiplied everything by two would not be a faithful baseline with a knob on it; it
would be a different game that had stopped being able to check itself against anything.

What Global Idle IS free to adapt, and adapts deliberately:

- room composition and encounter pacing;
- autonomous target and action selection;
- automation itself;
- new Global-Idle-only items, resources and currencies;
- economy-specific drop overrides, sinks and sources;
- access and progression systems.

Every divergence records four things — **source baseline, Global Idle override, reason, and the
fixture that pins it** — in the same import record the formulas use. A divergence with no record
is not a design decision; it is a defect that has not been found yet.

| Question | Whose answer |
|---|---|
| A Rat's HP, XP, melee damage, resistances | **Canary** |
| Which target an automated Character picks | **Global Idle** |
| A spell's formula | **Canary** |
| The tick scheduler, checkpointing, determinism | **Global Idle** |
| Stamina bands, reconnect grace, room progression | **Global Idle** (its own locked design) |

So: do not invent vocation kits because this is a browser game, do not rebalance creatures from
scratch, and do not create a spell the baseline already provides.

#### Recording an import

Every formula or data element imported or adapted from Canary is recorded with:

| Field | Meaning |
|---|---|
| Source repository | `Hokz/canary`, at the commit read |
| File / path | the file the value or function lives in |
| Function / data definition | the exact symbol or table key |
| Observed meaning | what it does, in one line, as read |
| Keep / simplify / adapt | Global Idle's decision, and why |
| Test fixture | where the behaviour is pinned |

A formula copied without that record is not sourced, it is guessed with extra steps. Phase 2's
source map (`docs/specs/phase-2/PHASE_2_CANARY_SOURCE_MAP.md`) is the worked example.

#### What this is NOT

Canary does **not** become the Global Idle backend, and Canary code is **not** imported
wholesale. The smallest behaviour actually needed is re-implemented inside Global Idle's own
architecture — server-authoritative, deterministic, checkpointed — which Canary's C++ game loop
is not and does not try to be.

Global Idle stays free to **deliberately adapt** behaviour where the idle format requires it. A
deliberate adaptation is recorded as one; a silent divergence is a defect.

## Official Tibia/CipSoft

News archive:
https://www.tibia.com/news/

Use official sources first when researching current visible mechanics.

Official sources may not document:
- internal ordering;
- exact rounding;
- engine-only side effects.

Do not invent official certainty where it does not exist.

## CrystalServer

Repository:
https://github.com/zimbadev/crystalserver

Pull Requests:
https://github.com/zimbadev/crystalserver/pulls

Issues:
https://github.com/zimbadev/crystalserver/issues

Use CrystalServer as a reference implementation, not authority.

## Baiak Idle

Use Baiak Idle as a product/game-loop reference for:
- idle hunt UX;
- offline Skill Training;
- connection/reconnect/session-state handling;
- loot handling;
- party management;
- quality-of-life;
- monetization ideas;
- market/automation concepts.

Do not copy implementation blindly.

## Evidence hierarchy

When accuracy to an external game/system matters:

1. **current official Tibia / CipSoft behaviour**, where publicly documented;
2. **`Hokz/canary`** — the primary technical/code reference for the mechanics listed above;
3. reproducible current empirical behaviour;
4. other reference implementations (CrystalServer, community sources);
5. inference.

Official sources describe what a player sees; Canary describes what the server does. Where the
first is silent on ordering, rounding or an engine-only side effect — which it usually is — the
second is the answer, and the record says which one was used.

Label uncertainty honestly.

## IP reminder

Researching mechanics does not automatically grant rights to ship:
- maps;
- sprites;
- logos;
- text;
- names;
- lore;
- audio;
- proprietary assets.

Before public monetized release, perform an explicit licensing/legal review.
