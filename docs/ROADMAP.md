# Roadmap

## Phase 0 — Foundation

Goal: prepare the project so implementation does not begin on ambiguous foundations.

Deliverables:
- documentation baseline;
- monorepo;
- web/API skeleton;
- PostgreSQL;
- Redis;
- ORM/migrations;
- Docker Compose;
- CI;
- shared types;
- game-data package;
- game-engine package;
- initial entities;
- simulation contract.

No full gameplay yet.

## Phase 1 — Character + World Map

- account;
- character creation;
- one vocation;
- basic stats;
- surface-map shell;
- one region;
- hunt marker;
- activity selection.

## Phase 2 — Hunt Simulation

- room system;
- rooms 1-10;
- room-10 infinite loop;
- monster encounters;
- supplies;
- death;
- XP;
- gold;
- persistent activity;
- browser-close continuity.

## Phase 3 — Loot + Itemization

- loot tables;
- BaseItem;
- ItemInstance;
- Common -> Stellar;
- affix generation;
- inventory;
- equipment;
- sell loop.

## Phase 4 — Skills + Party + Vocations

- final skill progression model;
- additional characters;
- party formation;
- role logic;
- all five vocation identities;
- configurable combat behavior.

## Phase 5 — Quest/Dungeon/Boss Framework

- generic dungeon rooms;
- basic puzzles;
- unlock framework;
- first-completion rules;
- bosses;
- daily limit;
- boss rotation.

## Phase 6 — Economy

- gold sinks;
- market;
- escrow;
- fees;
- price history;
- premium-currency market;
- transaction ledger;
- anti-duplication tests.

## Phase 7 — Forge / Imbuement / Wheel / Skill Tree

- Forge target + sacrifices;
- Tier 0-10;
- rarity/classification validation;
- Imbuements;
- quest unlocks;
- Wheel;
- gems;
- vocation Skill Tree.

## Phase 8 — Premium

- entitlements;
- fifth party slot;
- automation;
- remote services;
- loot automation;
- boss automation;
- analytics;
- final Free/Premium balance.

## Phase 9 — Content Expansion

- more regions;
- more hunts;
- more items;
- more quests;
- more bosses;
- more puzzles;
- endgame.

## Phase 10 — Scale / Hardening

- telemetry;
- economy balance;
- load tests;
- profiling;
- anti-abuse;
- backup/recovery;
- customer-support tooling;
- selective performance rewrites if necessary.
