# Multiplayer activities — foundation

**Status:** `BASELINE` — recorded so the architecture does not make it impossible. **Nothing here
is built, and nothing here should be built early.**

---

## 1. Two different kinds of "together"

```text
ACTIVE PARTY        several Characters owned by ONE Account        Phase 4
EXPEDITION GROUP    several ACCOUNTS in one shared Activity        Phase 5B
```

They are not the same system with a different size. An Active Party is one player's roster acting
at once — occupancy, Stamina and rewards are already per Character, which is what makes it
possible. An Expedition Group is several players, which brings lobbies, invitations, fairness,
disconnect policy and loot distribution — every one of which is a product decision nobody has made
yet.

## 2. Co-op / Warzones

Direction only:

- a lobby or group, formed across accounts;
- automated area and room progression, as Hunts already work;
- a final boss;
- rewards based on the current Tibia/Canary Warzone content — Warzones 1–9 are the recognisable
  candidates.

**Open, and genuinely open:** participant cap (10? 20?), scheduling, how contribution is measured,
what a disconnect does to the group and to the disconnected player, and how loot is distributed.

## 3. PvP

Direction only:

- an Arena queue;
- matchmaking;
- Party vs Party automatic combat;
- tournament and rating points;
- ranking and leaderboards;
- seasonal use of the rating later.

Do not build lobby, matchmaking or ranking infrastructure now.

## 4. The one architectural guardrail

**Do not make Team A vs Team B impossible.**

That is a much weaker requirement than "generalise the combat engine now", and the difference
matters. `simulateHunt` may stay Hunt-specific: a speculative PvP refactor of a simulator that has
one caller would be complexity bought against a feature nobody has specified.

What IS asked: when reusable combat primitives emerge naturally — a damage roll, a reduction
chain, an initiative order — keep their **Actor**, **Target** and **Side** concepts neutral rather
than naming them "character" and "creature" in ways that would have to be unpicked.

## 5. Open

- everything above;
- whether Expedition rewards use the Reward Chest;
- whether PvP touches Stamina at all;
- whether a Party shares a custody scope or only ever carries its members' own pouches.
