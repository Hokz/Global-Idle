# Global Idle

**Working title.** Browser-based idle strategy RPG built around a large navigable world, endless hunts, dungeon-style quests, boss progression, party management, equipment strategy, player economy and long-term progression.

This repository is the product/engineering home for the project.

## Core idea

The player does **not** manually walk every tile or actively execute every attack.

Instead, the player:

1. navigates an interactive surface world map;
2. chooses hunts, dungeons, bosses and services;
3. builds characters and parties;
4. configures equipment, supplies and progression;
5. lets the server simulate combat;
6. receives XP, gold and loot;
7. improves equipment, skills, Wheel, class tree and unlocks;
8. interacts with a player-driven economy.

The strategic layer replaces much of the manual execution layer.

## Product pillars

- **Idle first, not passive only:** combat is automated, but build, routing, progression, unlocks and economy require decisions.
- **Equipment matters:** rarity, affixes, Forge, Imbuements and item sinks are central.
- **World matters:** the map is an interactive atlas, not a stage list.
- **Party identity matters:** each vocation has a clear role.
- **Progression must have friction:** death, supplies, unlocks and resource sinks create consequences.
- **Server authoritative:** damage, loot, rarity, Forge, currencies and market transactions are resolved on the server.
- **Free remains competitive:** Premium should be valuable mainly through convenience, automation and capacity.

## Read first

Development agents must read:

1. `AGENTS.md`
2. `docs/MASTER_DEVELOPMENT_ROADMAP.md`
3. `docs/PRODUCT_VISION.md`
4. `docs/GAME_SYSTEMS.md`
5. `docs/ARCHITECTURE.md`
6. `docs/MVP_SCOPE.md`
7. `docs/ROADMAP.md`
8. `docs/DECISIONS.md`
9. `docs/OPEN_QUESTIONS.md`
10. `docs/REFERENCES.md`

## Current phase

**Phase 0 — Project Foundation**

No production gameplay implementation should begin until the architecture, data boundaries and MVP vertical slice are reviewed.

## Working process

```text
Product Owner
    ↓
Product specification
    ↓
Architect
    ↓
Technical specification
    ↓
Builder (Codex / Claude Code)
    ↓
Pull Request
    ↓
Independent Reviewer (ChatGPT)
    ↓
Fix loop if needed
    ↓
Merge
```

The implementer should not be the only final reviewer of the same change.

## Repository status

Initial documentation foundation only. Gameplay code comes after Phase 0 review.
