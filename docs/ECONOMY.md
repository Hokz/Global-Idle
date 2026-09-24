# Economy Principles

## Objective

Create a healthy player economy where:

- loot has value;
- items leave circulation;
- gold has persistent uses;
- Premium currency has utility;
- Free players can participate competitively;
- exploits cannot duplicate value.

## Gold sinks

Candidates:
- Forge;
- Skill Tree;
- services;
- supplies;
- travel;
- Market fees;
- respecs;
- progression unlocks;
- additional character/roster slot unlocks;
- repair/maintenance only if it adds meaningful strategy.

## Item sinks

Primary:
- Forge sacrifices.

Potential secondary:
- crafting/conversion;
- rerolls;
- upgrades;
- event sinks.

Do not add sinks purely to delete items; sinks should connect to progression.

## Markets

### Gold Market
Item listings priced in gold.

### Premium Currency Market
Item listings priced in premium currency.

The same item should not be simultaneously committed to two listings.

A Character-bound consumable — an XP Boost or a Store-bought Exercise Weapon, for example — is
never listed on either market, traded or sold
([`architecture/decisions/ADR-021-character-bound-consumables-and-store-container.md`](architecture/decisions/ADR-021-character-bound-consumables-and-store-container.md)).

## Transaction rules

Market operations need:
- escrow;
- database transaction;
- idempotency key;
- buyer/seller validation;
- currency ledger;
- item ownership transition;
- audit record.

## Premium currency

Do not hard-code a real-money value into game rules.

Commerce pricing is configuration.

Questions still open:
- package sizes;
- regional pricing;
- Premium time cost;
- trade restrictions;
- fees;
- chargeback handling.

## Free competitiveness

A Free player should be able to:
- reach endgame;
- acquire strong equipment;
- trade;
- earn wealth;
- potentially acquire premium currency through player trade if allowed.

Premium should primarily improve:
- automation;
- time efficiency;
- storage/capacity;
- management convenience.
