# ADR-004 — An ItemInstance has exactly one custody scope

**Status:** `PROPOSED`
**Phase:** 0A.1
**Date:** 2026-09-20

## Context

Items are the centre of Global Idle's progression, and they move constantly: inventory to
equipment, inventory to market escrow, three items into a forge attempt where two are consumed,
escrow to a buyer's inventory.

Every one of those movements is an opportunity to duplicate value. The security baseline names
it first:

> *"Design from day one for: no item duplication; no currency double-spend."* —
> `docs/ARCHITECTURE.md`

And the market rules name the specific case:

> *"The same item should not be simultaneously committed to two listings."* — `docs/ECONOMY.md`

The conventional model — containers holding lists of items — makes "this item is in two places"
a *representable state*. Once a state is representable, preventing it becomes a validation
problem, and validation problems are lost to races eventually.

## Decision

**Custody is a property of the item, not a membership in a container.**

Every `ItemInstance` carries exactly one custody reference — a scope and a scope id — at any
instant:

| Scope | Meaning |
|---|---|
| `character_inventory` | held by a character |
| `character_equipment` | equipped in a specific slot |
| `market_escrow` | committed to a listing, under server control |
| `forge_input` | committed to a forge attempt |
| `consumed` | terminal — sacrificed, destroyed or used up |

Inventory and Equipment are therefore **custody locations that items point at**, not containers
that hold items. A custody transition is a transactional update of that single reference,
audited like any other value movement.

Corollaries:

- An item in escrow is, by construction, not in the seller's inventory. It cannot be equipped,
  forged, or listed a second time — not because a check forbids it, but because there is no
  state in which it is in two scopes.
- `consumed` is terminal. A consumed instance never returns to circulation.
- Instance ids are never reused.

## Consequences

**Benefits.**
- Duplication is not prevented by validation; it is unrepresentable. The market's
  two-listings rule and the forge's sacrifice semantics both fall out of the same invariant.
- A single uniqueness constraint in the persistence layer enforces the whole class, and it wins
  races that application-level checks lose.
- Forge semantics become clean: the target's custody never changes, the two sacrifices
  transition to `consumed`, and a failed attempt is a no-op on custody — matching the locked
  rule that *"target not destroyed by failed attempt."*
- Auditing an item's history is reading its custody transitions in order.

**Costs.**
- "Show me a character's inventory" becomes a query over items by custody rather than a read of
  a container. Entirely ordinary, but it wants an index (0A.3).
- Adding a new custody scope — a future stash, mail attachment, or event vault — touches an
  enumeration that several systems read. This is a feature: new ways to hold an item should be
  a deliberate, reviewed change.
- Bulk moves are N updates rather than one list write. Acceptable at this scale.

**Constraints created.**
- No system may hold an item reference that implies ownership without transitioning custody.
- No code path may create an `ItemInstance` outside a transaction that also records why it
  exists.

## Alternatives considered

**Containers holding item lists.** Rejected. It makes duplication representable and relies on
validation to prevent it. Every dupe exploit in the genre lives in the gap between "the
container list says X" and "the item says Y".

**Dual bookkeeping — both a container list and an owner field.** Rejected as strictly worse:
two sources of truth that can disagree, plus reconciliation work to detect when they have.

**A soft "reserved" flag instead of an escrow scope.** Rejected. A flag alongside an unchanged
owner means the item is still in the seller's inventory as far as every other code path is
concerned, and each of those paths must then remember to check the flag. The escrow scope
removes the item from inventory queries entirely.

## Product constraints requiring this architecture

- *"no item duplication"* — `docs/ARCHITECTURE.md`, security baseline
- *"The same item should not be simultaneously committed to two listings."* — `docs/ECONOMY.md`
- *"item ownership transition; audit record"* — `docs/ECONOMY.md`
- Forge: target preserved on failure, two sacrifices consumed — `docs/DECISIONS.md`
- *"rarity/affixes live on ItemInstance"* — `docs/DECISIONS.md`
- Market principles: *"server-side escrow"*, *"atomic transaction"*, *"anti-duplication"* —
  `MASTER_DEVELOPMENT_ROADMAP.md` §17
