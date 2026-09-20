# ADR-008 — The newest authenticated connection evicts the previous one

**Status:** `ACCEPTED`
**Phase:** 0A
**Date:** 2026-09-20

## Context

Hunts progress only while a session is connected, and an unexpected disconnect preserves the
activity for five minutes. That grace period creates a problem the policy does not address: what
happens when a second connection arrives for the same account while the first is still inside
its grace window?

The scenario is ordinary, not exotic. A player closes a laptop and opens the game on a phone. As
far as the server can tell, the laptop simply stopped responding — `docs/DECISIONS.md` is
explicit that browser or tab closure is indistinguishable from connection loss and gets the same
five minutes.

One invariant is non-negotiable regardless of the policy chosen: at most one session may hold an
account's Activity claim, or two tabs could both advance the same Hunt and settle the same XP
twice.

## Decision

**The newest authenticated connection wins.** On a successful authentication for an account that
already has a session:

1. the new session is established;
2. the Activity claim transfers to it **atomically**;
3. the previous session is closed and told why, with a reason the client can render as
   *"your account was opened elsewhere"*;
4. at no instant do two sessions hold the claim.

If the previous session was paused in reconnect grace, the new session **resumes the preserved
activity** rather than starting fresh. This is the reconnect path, arriving from a different
device.

## Consequences

**Benefits.**
- A player is never locked out of their own account by a safety mechanism designed to protect
  them. Refusal would mean waiting up to five minutes to play on a second device.
- The grace period keeps its intended meaning: it protects an *absent* player, and stops
  applying the moment the player demonstrably returns.
- Cross-device continuity is free. Closing a laptop and opening a phone resumes the same hunt.
- The single-claim invariant is enforced by an atomic transfer rather than by hoping two
  sessions behave.

**Costs.**
- Account sharing degrades into two people evicting each other. This is a feature: the design
  has no notion of shared accounts, and silent concurrent use would be worse.
- A flapping network could produce repeated evictions. Bounded by the atomic transfer — each
  eviction is consistent — but it deserves a metric so the pattern is visible in operations.
- The client must handle being evicted gracefully, which is a UI requirement rather than an
  architectural one.

**Constraints created.**
- Claim transfer is atomic. There is no window in which both sessions are valid, and no path
  where a tick executes during the transfer.
- Eviction carries a machine-readable reason, so the client never shows a generic disconnect.

## Alternatives considered

**Refuse the second connection until the first expires.** Rejected. Up to five minutes locked
out of your own account, caused by a mechanism meant to help you. The worst outcome for the most
common scenario.

**Queue the second connection.** Rejected. Same wait as refusal, plus machinery to manage the
queue, plus a worse failure mode when the queued connection also drops.

**Allow both, with only one holding the activity claim.** Rejected for now. It sounds
accommodating and creates a large surface of questions nothing in the design has answered: which
tab shows the hunt, what the idle tab is allowed to do, how the two are kept consistent. The
single-session model can be relaxed later if a real need appears; the reverse is much harder.

## Product constraints requiring this architecture

- The 5-minute reconnect grace, and *"when the server can only observe transport/session loss —
  browser or tab closure included — it applies the same 5-minute grace period"* —
  `docs/DECISIONS.md`
- *"one account/session owns the whole Active Party"* — `docs/DECISIONS.md`
- Zero progression while paused — `docs/DECISIONS.md`
