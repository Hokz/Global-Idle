# ADR-005 — Active Party is ordered configuration, not an entity

**Status:** `ACCEPTED`
**Phase:** 0A.1
**Date:** 2026-09-20
**Amended by:** [ADR-022](./ADR-022-game-account-main-character-and-companions.md) (2026-09-25) —
the Main Character is always in the Active Party; see the note under *Decision*.

## Context

`PARTY_SYSTEM_FOUNDATION.md` defines a Character Roster of up to five unique-vocation
characters and an Active Party of one to four of them, with Slot 1 designated the Frontline.

The word "party" carries baggage from multiplayer games, where a party is a real object with
members who join and leave, an invite lifecycle, a leader, and sometimes shared state. Global
Idle's party is none of that:

> *"A Global Idle Party belongs to one player account and one online session ... All characters
> in the Active Party are controlled by the same player."* — `PARTY_SYSTEM_FOUNDATION.md` §1

The question is whether Active Party is an entity with its own identity and lifecycle, or
simply a stored selection.

## Decision

**The Active Party is durable configuration on the Account: an ordered list of at most four
character ids.** It has no identity of its own, no progression, no inventory, and nothing that
outlives a composition change.

- **Order is the only representation of position.** Slot 1 *is* the Frontline. There is no
  separate `isFrontline` field.
- **Shared XP eligibility is a derived predicate**, computed from the composition's highest and
  lowest active Base Levels. It is never stored.
- **A running Activity holds an immutable roster snapshot**, and **formation editing is
  rejected while an Activity is running**. The command fails with a clear reason; it does not
  silently succeed-and-do-nothing.

> **Amended by [ADR-022](./ADR-022-game-account-main-character-and-companions.md), 2026-09-25.** A
> Game Account now has exactly one Main Character, and further vocations are companions. The
> personal Active Party is the Main plus up to three companions — four actors at most — and the
> Main is **always** in it, at whatever position the player puts it. So the first benefit below no
> longer holds: the configuration must contain its Game Account's Main, which every formation write
> checks. Everything else in this record stands — ordered configuration, order as position, Slot 1
> as the Frontline, Shared XP eligibility derived rather than stored, and formation edits refused
> while an Activity runs. *"Roster max 5"* in the constraints below is now the Main and at most four
> companions, never five equivalent Characters.

## Consequences

**Benefits.**
- The locked rule *"the Origin Character is not permanently required in Slot 1 or even in the
  Active Party"* needs no enforcement: there is nothing pinning any character anywhere.
- Frontline cannot disagree with position, because there is only one representation of it.
- Shared XP eligibility cannot go stale. A stored flag would silently rot the moment a member
  levels up; a derived predicate is correct by construction.
- Composition changes are cheap and leave no orphaned party records behind.
- `PARTY_SYSTEM_FOUNDATION.md` §27's conceptual state — `activePartyCharacterIds[]`,
  `frontlineCharacterId`, `sharedXpEligibility` — collapses to one ordered list plus a
  computation, which is less state to keep consistent.

**Costs.**
- Eligibility is recomputed on every read. Trivial: it is a max, a min and a comparison over at
  most four numbers.
- There is no natural place to hang party-level history, should the product later want named
  saved formations or per-party statistics. That would be a new concept, not a change to this
  one — and it is not in any current design document.
- A player must end the current activity to change formation. The cost is bounded and known:
  Hunt room progress never persisted between sessions anyway, so stopping loses nothing that
  would otherwise have survived.

**Constraints created.**
- Nothing may attach durable state to "the party" as such. Anything durable belongs to the
  Account or to a Character.
- Activity start snapshots composition and order. Combat values are not snapshotted — they are
  refreshed per settlement checkpoint (`ADR-006`).
- The application layer must reject formation changes during a running activity rather than
  accepting and discarding them.

## Alternatives considered

**Party as a persistent entity with its own id and lifecycle.** Rejected. It buys an identity
nothing needs, and it creates the orphan problem: what happens to "party #412" when the player
swaps a member? Either it mutates — in which case the id was meaningless — or a new one is
created and the old lingers. Multiplayer games need this because a party outlives any single
member's session; here it does not.

**Storing a `frontlineCharacterId` alongside the ordered list.** Rejected. Two representations
of one fact, which can disagree. Order alone already says it.

**Storing `sharedXpEligible` as a flag.** Rejected. It describes a relationship between levels
that change during play, so the flag is wrong the instant a member levels up. Every read would
need to re-derive it to be safe, at which point the stored value is pure liability.

**Modelling party membership as a field on Character** (`partySlot: 1..4 | null`). Rejected as
a weaker version of the same thing: it spreads one ordered list across four rows, making
"exactly one character in slot 2" a constraint to enforce rather than a property of a list.

## Product constraints requiring this architecture

- Active Party 1–4; roster max 5; five simultaneous active characters do not exist —
  `docs/DECISIONS.md`
- *"Active Party Slot 1 is the Frontline"* — `docs/DECISIONS.md`
- *"the Origin Character is not permanently required in Slot 1 or even in the Active Party"* —
  `PARTY_SYSTEM_FOUNDATION.md` §28
- Shared XP eligibility formula over highest and lowest active levels — `docs/DECISIONS.md`
- *"one player controls the entire Party; there is no multi-human party"* — `docs/DECISIONS.md`
