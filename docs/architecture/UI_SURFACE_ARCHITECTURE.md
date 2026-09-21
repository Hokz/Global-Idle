# UI Surface Architecture — baseline

**Status:** `BASELINE` — a durable statement of which surface owns what, not a UI specification.
Phases add surfaces; nothing may merge two of them.

Global Idle's interface is **four distinct conceptual surfaces**. They may share a screen, a
stylesheet and a layout. They are never the same system.

```text
  GAME WINDOW        where the Character IS, drawn
  WORLD NAVIGATION   where the Character could GO, chosen
  SYSTEM UI          what the Character HAS and IS, managed
  CHAT / LOGS        what was SAID and what HAPPENED, read
```

---

## 1. Game Window

The visual representation of the Character's **current physical game context**.

- the Hunt scene, and later city, shop, depot, boat and NPC scenes;
- Character and creature movement;
- spells, auto-attacks and their effects;
- damage and state feedback.

**The player observes automatic combat; they do not drive it.** There is no WASD, no manual
attack, no click-to-move. The Character controls itself, and the window shows what the server
decided.

Presentation may interpolate between server states so movement reads smoothly. It may never
*originate* a state: position, target, damage, hit or miss, death, XP, Gold, supplies and room
progression are all server answers.

## 2. World Navigation

Choosing **where to go**.

- the World Atlas;
- later, regional and city mini-atlases;
- markers, locations and routes.

**The Atlas is not the Game Window.** It is a chooser that hands off; it is not where play
happens, and a Hunt in progress does not live inside it.

## 3. System UI

Managing what the Character **has and is**: Character, Equipment, Inventory, Skills, Bestiary,
Charms, Quests, Achievements, Outfits, Imbuements, Party, Market, Analyser, Settings, Store.

These panels open **over** an activity without interrupting it. A player reading their Skills is
still hunting.

## 4. Chat / Logs

What was **said** and what **happened**: NPC conversation, player channels, party/private/global,
Server Log, Loot channel, Help, and later system messages.

One visual surface is acceptable. **NPC dialogue and multiplayer messaging stay separate
technical systems** — one is content-driven and server-scripted, the other is routed between
players — and neither is ever gameplay-state authority. A log line reports a fact; it does not
establish one.

---

## The rule this document exists for

```text
Atlas        !=  Game Window
Game Window  !=  System menus
Chat / Logs  !=  gameplay state authority
```

Every one of those three has an obvious-looking shortcut that collapses it:

- rendering combat inside the Atlas because the markers are already there;
- opening Inventory *instead of* the scene because both need the screen;
- deriving what happened from what was logged, because the log is conveniently ordered.

Each works until it does not, and each is expensive to undo once a phase has shipped on it.

---

## Phase ownership

| Phase | Surface work |
|---|---|
| 1 | World Navigation — the Atlas, markers, region and hunt selection |
| 2 | **The first real Game Window** — the Rookgaard Sewers Hunt: Character, creatures, automatic combat, room and cycle, connection state, Stamina, session XP/Gold, supplies, death |
| later | city and NPC scenes; System UI panels; Chat and Logs as real systems |

Phase 2 implements the first useful Game Window and **nothing else from this document**. No city
scenes, no NPC chat, no Depot, no boat, no System UI panels, no multiplayer chat.
