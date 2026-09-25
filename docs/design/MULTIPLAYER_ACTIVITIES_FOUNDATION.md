# Multiplayer activities — foundation

**Status:** `BASELINE` — recorded so the architecture does not make it impossible. **Nothing here
is built, and nothing here should be built early.**

**Companion document:** the cooperative *experience* — the lobby checklist, the player-authored
conditional strategy, the frozen plan, spectators and the settlement rules — is
[`multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](multiplayer/COOPERATIVE_QUEST_STRATEGY.md). This
document stays the architectural foundation; that one is the product direction built on it.

**Phase 5 owns the quest engine** those cooperative runs later execute — generic, data-driven and
networking-free. See [`../MASTER_DEVELOPMENT_ROADMAP.md`](../MASTER_DEVELOPMENT_ROADMAP.md) §20.

---

## 1. Three different kinds of "together"

```text
ACTIVE PARTY        1-4 actors of ONE Game Account:                Phase 4
                    the Main + up to 3 companions
EXPEDITION GROUP    up to 5 GAME ACCOUNTS, one selected actor each Phase 5B slice 2
WARZONE             a large public activity on the same rails      Phase 5B slice 3
```

They are not the same system with a different size. An Active Party is one player's roster acting
at once — occupancy, Stamina and rewards are already per Character, which is what makes it
possible. An Expedition Group is several players, which brings lobbies, invitations, fairness,
disconnect policy and loot distribution — every one of which is a product decision nobody has made
yet. A Warzone is that same multi-account machinery at a scale that must be measured before it is
promised.

*Since 2026-09-25 (`ADR-022`):* the Active Party always contains its Game Account's Main. An
Expedition Group or a Warzone takes **exactly one selected actor per Game Account** — its Main or
any unlocked companion; the Main is not mandatory. The personal party never enters as a block, and
changing the selected actor creates no new account, reward entitlement or completion identity
(MP1–MP5).

**A personal Party is never re-labelled as a large Party.** Raising the Active Party cap is not
how cooperative play arrives; the Expedition Group is.

> **On the phrase "there is no multi-human party".**
> [`../DECISIONS.md`](../DECISIONS.md) locks that one account controls the entire Active Party.
> That is a statement about the **personal Party**, and it stands. It is **not** a statement that
> several humans will never share an Activity: the Expedition Group is explicitly supported
> future direction. Read the locked rule as *no multi-human **personal Party***.

## 2. Co-op / Warzones

Direction only:

- a lobby or group, formed across accounts;
- automated area and room progression, as Hunts already work;
- a final boss;
- rewards based on the current Tibia/Canary Warzone content — Warzones 1–9 are the recognisable
  candidates;
- the content stays replayable, and each Game Account claims a one-time final reward once,
  whichever actor it selected (`ADR-023`, 2026-09-25).

### Participant scale — `TENTATIVE`

| Activity | Target | Status |
|---|---|---|
| Expedition Group (first cooperative quest) | **5 humans, one selected actor per Game Account** — its Main or a companion | approved shape, Phase 5B slice 2 |
| Warzone | **~25 minimum to ~50 maximum entrants** | **TENTATIVE — tunable, to be benchmarked** |

The earlier illustrative "10? 20?" is **superseded** by that Warzone target. Neither number is a
locked balance parameter: they are a planning target to design and benchmark against, and the
real ceiling is whatever simulation cost, fairness and per-account settlement can actually carry.

A Warzone is shared objectives with sectors or subgroups — **not** fifty independent agents in one
15 × 11 arena.

**Open, and genuinely open:** scheduling, how contribution is measured, what a disconnect does to
the group and to the disconnected player, and how loot is distributed. Cross-account disconnect
behaviour is decided and tested **separately** from one-account Party behaviour — see
[`../PHASE_GATES.md`](../PHASE_GATES.md) § *Pre-5B*.

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

- everything above, plus the cooperative-play questions in
  [`multiplayer/COOPERATIVE_QUEST_STRATEGY.md`](multiplayer/COOPERATIVE_QUEST_STRATEGY.md) §9;
- whether Expedition rewards use the Reward Chest;
- whether PvP touches Stamina at all;
- whether a Party shares a custody scope or only ever carries its members' own pouches.
