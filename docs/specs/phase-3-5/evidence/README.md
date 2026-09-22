# Phase 3.5 — browser evidence

Five screenshots of the running stack: a real API, a real database, a real content bundle and a
real Chromium. Nothing here is a mockup, a render of a design, or a picture of something that does
not exist — each one is a `page.screenshot()` of the Game Window during a live Hunt.

**Recaptured at the corrected head**, after eight-direction movement, the authoritative movement
timeline, the version-pinned map resource and the locked 15 × 11 logical viewport.

| File | What it shows |
|---|---|
| `01-approach-desktop.png` | Room 1, desktop 1440×900. The Character mid-approach — the state that did not exist before this phase: a fight you have to get to. |
| `02-combat-desktop.png` | The Character in contact, clash marks between them, the Rat's health bar down. Reach is Chebyshev one, so contact includes the diagonals. |
| `03-room-6-desktop.png` | Room 6, three Rats converging, two already in contact — **one of them diagonally**, which is what melee range means in the source. The camera has centred the Character on logical column 7. |
| `04-mobile.png` | 390×844 at DPR 3, showing **the same 15 × 11 world** as the desktop capture: the same chamber, the same three Rats, the same Character position. Smaller pixels, identical gameplay information. |
| `05-debug-overlay-desktop.png` | The developer overlay, which exists only in a build made with `NEXT_PUBLIC_DEBUG_OVERLAY=1` and is off until toggled: the tile grid, coordinates every five tiles, run-local actor ids (`character`, `s0`, `s1`) and `rev 7 · tick 14 · room 3 · you 16,3,7 · 2 alive`. |

Compare `03` and `04` directly: that pair **is** the viewport contract. A larger screen shows the
same corridor bigger, never more of it.

The far-away states in `03`, `04` and `05` were reached by fast-forwarding the **durable run row**
— `room`, `creatures`, `position` — exactly as `tests/e2e/support.ts` documents for the cases that
are about rendering rather than about progress. The window still learnt everything through the
real routes; it is the truth behind them that was moved, not the routes.
