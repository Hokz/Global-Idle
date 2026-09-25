# ADR-023 — Quest replay is separate from one-time reward claims

**Status:** `ACCEPTED` — the product rules are `LOCKED` by the Product Owner (2026-09-25). Recorded
in the governance synchronization that follows PR #13 head `86a7681`. The independent review of
head `e2d0e04` found its replay rule over-generalized, and it is corrected here: the Product
Owner's replay rule covers **human multiplayer / co-op** quests, not every quest (§1, *Scope*).
**The correction is pending independent review.**
**Relates to:** [ADR-022](./ADR-022-game-account-main-character-and-companions.md) — claim state
belongs to the Game Account, never to the selected actor.
[ADR-020](./ADR-020-character-deletion-grace-and-purge.md) — a one-time Tutorial Reward is the
same concept, and no purge resets it.
**Owning phases:** Phase 5 builds the quest, dungeon and boss engine and its reward-claim
primitive; Phase 5B's cooperative quests are the first content that QR2 makes replayable.
**Nothing in this record is implemented.**
**Date:** 2026-09-25

## Context

Documents written before this decision could be read as calling a quest *one-time*: a boss hall
behind a *"one-time unlock dungeon"*, a first cooperative quest, a tutorial Doublet that is
*"one-time per account"*. For human multiplayer and co-op content the Product Owner separated the
two things that phrase ran together: whether the content can be **played again**, and whether a
**reward** can be claimed again.

Nothing of it exists in code. No quest, dungeon, chest or reward state is implemented; the only
reward-like state is the Hunt's creature loot and Gold.

## Decision

### 1. The rules — `LOCKED BY PRODUCT` (2026-09-25)

| # | Rule |
|---|---|
| QR1 | **Content replayability** and **one-time reward claims** are separate concepts. |
| QR2 | A **human multiplayer / co-op** quest may be run again. Its shared quest, boss and content may be repeated, its hunt areas stay usable under the content's access rules, a player may help other groups again, and a Game Account may select a different actor — its Main or a companion — on a later run. |
| QR3 | Replay never re-enables a one-time reward. |
| QR4 | A co-op quest's **final or primary reward chest** is one-time **per Game Account** (campaign). |
| QR5 | Unclaimed: opening the eligible chest grants the reward exactly once, and the authoritative claim state becomes `CLAIMED`. Claimed: opening it grants nothing a second time; the UI may show the chest as empty. |
| QR6 | The claim state belongs to the **Game Account**, not to the selected actor. Choosing the Main or a companion never resets it. |
| QR7 | Wherever content is replayable, quest completion and progression state and reward-claim state are never conflated. |
| QR8 | An ordinary quest reward item is a normal item unless its definition says otherwise: movable, sellable, tradeable and discardable under the normal item rules. Coming from a quest never makes equipment Character-bound — the Doublet included. |

**Scope.** QR2 and QR4 are the Product Owner's rules for **human multiplayer / co-op** quests.
Whether any other content — solo, tutorial, story or dungeon — can be replayed is **defined by that
content**, and stays open until it is decided. Nothing in this record makes every quest
replayable. Outside QR4, a reward is one-time only where its own reward definition says so; when
it is, its claim follows QR5–QR7 and uses the primitive of §2.

*"One-time quest"* is therefore never a description of a co-op quest's access. A Soul War-style
cooperative quest stays playable after completion; what is one-time is its final reward claim.

### 2. A reusable, typed reward-claim primitive — architecture

- **One concept, typed, reusable.** A one-time reward claim — a co-op quest's final chest, a
  one-time Tutorial Reward, or any later reward whose definition says one-time — is recorded as
  one named, typed concept: conceptually a `QuestRewardState` or reward-claim record keyed by Game
  Account and reward. It is never a set of scattered, untyped storage flags whose meaning lives
  only in the code that reads them. The name and physical representation are the implementing
  phase's.
- **Exactly once.** A claim and the grant it authorises commit together, and a retried or
  concurrent claim for the same Game Account and reward grants at most once — the same
  idempotency discipline every settlement already follows (`DATA_ARCHITECTURE.md` §5). A uniqueness
  guarantee over the Game Account and the reward, rather than a read-then-write check, is what
  makes it hold under a race.
- **Separate from progression.** A quest's completion or progress record answers *"has this Game
  Account done it, and how far?"*; the claim answers *"has it taken this reward?"*. Neither is
  derived from the other, so where content is replayable a replay can advance or repeat
  progression without touching a claim.
- **Independent of access.** The primitive works the same whether its content can be replayed or
  not. Content that is run once still records its one-time claims this way.
- **Server-authoritative.** Whether a chest is eligible, and whether it is claimed, is decided on
  the server. An empty-looking chest in the client is a rendering of the claim state, never its
  source.

### 3. Relation to other records

- **The Reward Chest custody** (`ECONOMY_CUSTODY_AND_REWARD_DESTINATIONS.md`, Phase 5) is where
  some rewards are *stored* — a custody safe from Hunt death. A quest's final reward chest is
  *content* that grants a reward. They are different things with similar names.
- **Tutorial Rewards** (`ADR-020` §5.1) are one-time rewards in this sense wherever they are
  defined as one-time: Game-Account-owned claim state that no deletion or purge resets. The
  tutorial's Doublet Quest ends in its guaranteed Treasure Chest
  (`TUTORIAL_ROOKGAARD_ROADMAP.md` §18–§19). Whether that chest is a one-time Tutorial Reward, and
  whether the Doublet Quest can be replayed at all, are open (§43 of that document). If the chest
  is one-time, it uses this primitive and is claimed once per Game Account. The Doublet itself is
  an ordinary item (QR8).
- **Character deletion** (`ADR-020`) — reward-claim state is Game Account state. A purge never
  resets it, whichever actor claimed the reward.
- **Cooperative quests** (Phase 5B) — each participating Game Account has its own claim, whichever
  actor it selected (`ADR-022` MP3–MP5), and cross-account settlement stays per Game Account
  (`PHASE_GATES.md` § *G5B.3*).
- **Bosses** — *"repeatable after unlock"* (`DECISIONS.md` § *Bosses*) is content access, decided
  for bosses there. Unlocking a boss hall once is access; what a repeat completion yields is each
  boss's reward design.

### 4. Open — not decided here

- whether, and how, solo, tutorial, story and dungeon quest content can be replayed — each
  content's own decision;
- which rewards, per quest and per boss, are one-time and which repeat, beyond QR4;
- what a replay yields when the final chest is already claimed — ordinary loot, nothing, or a
  lesser table;
- the empty-chest presentation;
- whether helping another group yields anything to the helper;
- the tutorial reward tables, including whether the Doublet Quest's chest is one-time
  (`TUTORIAL_ROOKGAARD_ROADMAP.md` §43).

## Consequences

**Benefits.**

- A co-op quest never locks itself away. After completion it is still a place to play, help and
  farm.
- One-time rewards stay one-time across replays, actor changes, deletions and purges.
- The Main/companion choice cannot become a reward duplicator.
- One claim primitive serves every one-time reward, whatever content defines it and whether or not
  that content can be replayed.

**Costs.**

- Every quest defines its access and replay rules and its one-time claims separately.
- The reward primitive needs an exactly-once claim, not merely an idempotent grant.

**Constraints created.**

- No document calls a co-op quest one-time when it means its reward.
- No document makes a quest replayable, or not, without that content's own definition or a Product
  Owner decision.
- A one-time claim is keyed by Game Account, never by actor.
- A claim commits with its grant, exactly once, under retry and concurrency.
- A quest reward item is ordinary unless its definition binds it.

## Alternatives considered

**One-time co-op quests: completion locks the content.** Rejected by QR2.

**Every quest replayable by rule.** Not adopted. The Product Owner's replay rule is for human
multiplayer and co-op quests; any other content's replayability is its own decision (§1, *Scope*).

**Claim state on the actor.** Rejected by QR6. Switching between the Main and a companion would
re-enable every reward.

**Untyped storage flags per reward.** Rejected: nothing enforces what a flag means, two quests can
reuse one by accident, and none of them is auditable.

**Bind quest equipment to the Character that earned it.** Rejected by QR8.

## Product constraints requiring this architecture

- QR1–QR8 — Product Owner, 2026-09-25; QR2 and QR4 for human multiplayer / co-op quests, as the
  independent review of `e2d0e04` confirmed.
- *"Tutorial Rewards … stay one-time where defined as one-time, are never reissued merely because a
  Character was deleted or purged"* — `DECISIONS.md` § *Character deletion* (G4.1c).
- Per-account settlement of shared runs — `PHASE_GATES.md` § *G5B.3*.
