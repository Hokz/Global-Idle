# MVP Scope

## Goal

Prove that the core loop is fun before building the full world.

## First playable vertical slice

The MVP should include:

1. browser login;
2. one account;
3. one character;
4. one vocation;
5. one small surface-map region;
6. one hunt;
7. rooms 1-10;
8. infinite room-10 loop;
9. supplies;
10. death;
11. XP;
12. gold;
13. loot;
14. a few BaseItems;
15. Common -> Stellar item-instance rarity;
16. simple affixes;
17. inventory;
18. equipment;
19. return-to-town;
20. sell-loot flow;
21. persistence;
22. server-side simulation that survives browser closure.

## Suggested vertical slice

A Cyclopolis-style early hunting area is a good product reference because it demonstrates:

- recognizable area identity;
- progressive monster density;
- melee-focused enemies;
- equipment drops;
- supplies;
- room escalation.

For any public/commercial build, use legally safe names/assets/content unless rights are confirmed.

## MVP success test

A new player can:

```text
create character
→ open map
→ select hunt
→ start simulation
→ spend supplies
→ gain XP/gold
→ receive randomized equipment
→ choose better equipment
→ return to town
→ sell unwanted loot
→ re-enter stronger
```

If that loop is not satisfying, do not scale content yet.

## Explicitly excluded from MVP

- full Market;
- Forge;
- Imbuement;
- Wheel;
- complete Skill Tree;
- multiple world continents;
- full quest library;
- complex boss rotation;
- Premium store;
- five-character party;
- complete content import;
- C++/WASM optimization.
