# ADR-007 — Character deletion is retirement, not erasure

**Status:** `PROPOSED`
**Phase:** 0A
**Date:** 2026-09-20

## Context

`TUTORIAL_ROOKGAARD_ROADMAP.md` §2 explicitly contemplates deletion:

> *"Player completes tutorial → deletes first character → creates another character."*

`PARTY_SYSTEM_FOUNDATION.md` builds a roster of permanent, Gold-purchased, vocation-unique slots
and never mentions it. The two documents describe the same account from incompatible angles, and
the Character lifecycle cannot be specified until they are reconciled.

Erasure is not available as an option. A character is the subject of ledger entries, market
listings and item custody history. Deleting the row either orphans that history or cascades
through the audit trail, and an audit trail with holes in it is not an audit trail.

## Decision

**Deletion is retirement.** A retired character:

- is **excluded from the roster** — it does not count against `rosterCapacity`, cannot be placed
  in the Active Party, and does not appear in character selection;
- **frees its vocation** for a future unlock, so the tutorial's scenario works;
- **keeps its identity and history**, so every ledger entry and market record that names it
  stays referentially intact;
- **does not refund roster capacity or the Gold that bought it**;
- **hands its items to an account-level recovery custody scope** rather than destroying them.

Consequences for other rules:

- The vocation-uniqueness constraint applies to **active** characters only. This is the concrete
  shape of the persistence-level constraint required by `DOMAIN_MODEL.md` §5.3.
- `count(active characters) ≤ rosterCapacity` — retirement frees a place, not capacity.
- The Origin Character may be retired. The account's tutorial-completion flag is unaffected,
  which is exactly the edge case the tutorial document raises.
- Retirement is an audited operation. Whether it is reversible is a `DEFERRED PARAMETER`; the
  model supports un-retirement provided the vocation is still free.

## Consequences

**Benefits.**
- The tutorial's stated scenario works without weakening the roster model.
- The audit trail stays whole. "Which character earned this gold" remains answerable years later.
- Player value is not destroyed by a single click, which removes an entire category of support
  ticket.
- Freeing the vocation but not the capacity keeps the Gold sink honest: the player keeps what
  they bought, and rebuilding costs time rather than money.

**Costs.**
- Every query over "the account's characters" must filter by active status. Easy to get right
  once, easy to forget; it belongs in the repository layer, not in each call site.
- The recovery scope needs a product surface eventually — players must be able to see and
  retrieve those items. Until it exists, items are held safely and invisibly, which is
  acceptable but not indefinitely.
- Retired characters accumulate. Harmless at this scale; a retention policy is a later concern.

**Constraints created.**
- No code may hard-delete a Character.
- Vocation uniqueness is enforced over active characters, and the constraint must be written
  that way from the first migration.

## Alternatives considered

**Hard delete.** Rejected. It orphans ledger and market history or cascades into it, and it
destroys player items irreversibly.

**Refund the Gold and the capacity.** Rejected. It makes roster capacity a rentable resource and
invites churn: unlock, play, refund, repeat. It also makes the Gold sink — one of the economy's
main drains — reversible, which undermines the reason it exists.

**Keep the vocation locked after retirement.** Rejected. It makes retirement purely punitive and
breaks the tutorial document's own scenario, where deleting the first character is a normal
thing a player does.

**Destroy the retired character's items.** Rejected. Silent destruction of earned value is the
worst possible default, and it makes the operation unforgiving in a way nothing in the design
asks for.

## Product constraints requiring this architecture

- The deletion scenario in `TUTORIAL_ROOKGAARD_ROADMAP.md` §2
- Roster max 5, one character per vocation, Gold-purchased slots — `docs/DECISIONS.md`
- Account-level tutorial completion, *"Do not determine tutorial eligibility only by counting
  existing characters"* — `TUTORIAL_ROOKGAARD_ROADMAP.md` §2
- *"Economy operations must be transactional and auditable."* — `AGENTS.md` §5
