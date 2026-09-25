# Economy custody and reward destinations — baseline

**Status:** `BASELINE` — a durable statement of where value lives and what can take it away.
Phase 2 implements the Gold parts. Everything else is recorded, not built.

**Implemented now:** Gold Pouch, Bank (as a custody scope), death forfeiture.
**Not built yet:** Loot Pouch (Phase 3), Reward Chest (Phase 5), Bank services (Phase 6).

---

## 1. Three reward destinations, and they are not interchangeable

```text
GOLD POUCH     ordinary creature Gold          carried    at risk on death    Phase 2
LOOT POUCH     ordinary physical creature loot carried    at risk on death    Phase 3
REWARD CHEST   boss rewards                    stored     SAFE from death     Phase 5
```

A destination is decided by what produced the reward, not by what the player would prefer. Nothing
routes a boss reward into the Loot Pouch, and nothing routes a Rat's coins into the Reward Chest.

*Not to be confused (2026-09-25):* the **Reward Chest** is a custody where rewards are stored. A
quest's **final reward chest** is content that grants a reward; where it is one-time — a co-op
quest's is — it is claimed once per Game Account, whichever actor opens it (`ADR-023` §3). The two
have similar names and nothing else in common.

## 2. Gold Pouch vs Bank

| | Gold Pouch | Bank |
|---|---|---|
| Scope | a **Character** | the **Account** |
| Safe from death? | **no**, without Full Bless | **yes**, always |
| Weight / slots | none — it is a number, not coins | none |
| Filled by | Hunt rewards | deposits, and later sales and services |
| Emptied by | deposits, purchases, **death** | withdrawals, purchases, fees |

Both are projections of the one append-only ledger, discriminated by a custody dimension
(**[ADR-019](../architecture/decisions/ADR-019-currency-custody-scopes.md)**). Neither is a
mutable number that a code path may simply increment.

**Deposits are deliberate.** A Hunt does not sweep the Pouch into the Bank when it ends. If it
did, the Pouch would be a formality and death would stop costing anything — which is the defect
this whole model exists to remove.

**Future NPC spending priority:** Gold Pouch first, Bank as fallback. Recorded, not built.

## 3. What death takes, and what it cannot

Death is the only ending that costs anything. Leaving and losing a connection end the run and take
nothing.

**Without Full Bless:**
- the whole Gold Pouch;
- once Phase 3 exists, the whole ordinary Loot Pouch.

**With Full Bless (all seven regular blessings):**
- both are kept, in full.

**Always safe from this rule**, blessed or not: equipped items · the five Hunt containers and
their supplies · the Depot · the Stash · the Reward Chest · and, once it exists, a Character's
Store Container (`ADR-021`): a Character-bound consumable is never at risk on death.

**Carried-reward protection is BINARY.** Partial blessings reduce the experience and skill loss
exactly as the baseline says, and protect nothing carried. Six blessings lose the Pouch; seven
keep it.

**Full Bless is not a free death.** Experience loss still applies, Skill loss will apply when
Skills exist, the Hunt still ends, and blessings are consumed and must be reacquired — which is a
recurring Gold sink, and deliberately so.

## 4. Sinks and sources, as a shape

| Direction | Examples |
|---|---|
| Sources | Hunt Gold, later loot sales, quest rewards |
| Sinks | blessing reacquisition, Hunt container slot unlocks, supplies, later services, fees and the Market's cut |
| Destroyed | Gold forfeited on death — value leaves the economy, with a reason and an operation id |

A sink that destroys value is recorded as one. The ledger does not sum to zero across the economy
and never did; what matters is that every movement is explainable.

## 5. Bank, recorded for Phase 6

Direction only, not a specification:

- account-wide across the roster — the Main and its companions (`ADR-022`) — unless a concrete
  conflict disproves it;
- deposit, withdraw, balance and history;
- player-to-player transfer later;
- the Market's escrow later;
- Character-specific purchases (a Hunt container slot unlock) may debit the account Bank while the
  thing unlocked stays that Character's;
- Premium Auto-Sell proceeds land in the Bank.

## 6. Open

- exact deposit/withdraw ergonomics and whether either costs anything;
- whether a Party shares any custody scope, or only ever carries its members' own;
- blessing prices, and whether they scale with level;
- whether any content grants a temporary safe-carry effect.
