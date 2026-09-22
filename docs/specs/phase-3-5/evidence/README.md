# Phase 3.5 — browser evidence

Five screenshots of the running stack: a real API, a real database, a real content bundle and a
real Chromium. Nothing here is a mockup, a render of a design, or a picture of something that does
not exist — each one is a `page.screenshot()` of the Game Window during a live Hunt.

**Recaptured at `f795892`**, after the correctness pass: the persisted step in flight, the
admissible A\* heuristic, the honestly single-floor map, the validated map route, and — the one
that changes what these pictures show — the scene being drawn one poll interval behind the newest
snapshot so a walk is continuous rather than a teleport.

**Not recaptured for the determinism pass, on purpose.** Making the random streams continuous
across settlements changes which numbers come out of them; it changes nothing about what is drawn,
how it is drawn, or what the window is allowed to do. Re-shooting would produce five different
fights that showed the same five things, and would say that something visible had changed when
nothing had. The files below are the `f795892` captures, unchanged.

| File | What it shows |
|---|---|
| `01-approach-desktop.png` | Room 1, desktop 1440×900. The Character mid-approach, the Rat two chambers up and across, **nobody in reach and nobody hurt** — 150/150 and 20/20. This is the state that did not exist before this phase: a fight you have to get to. |
| `02-combat-desktop.png` | The same encounter after contact. The clash mark sits between the two, the Rat is at 15/20, and the contact is **diagonal** — Chebyshev one is what melee range means in the source. |
| `03-room-6-desktop.png` | Room 6, three Rats converging on the Character, all three in contact — one above and two diagonally below. The camera has centred the Character on logical column 7. |
| `04-mobile.png` | 390×844 at DPR 3, the same account and the same run, showing **the same 15 × 11 world**: the same chamber, the same three Rats, the same Character position, the same readouts. It is a later instant of the same fight, so the health numbers have moved on; the visible world has not. |
| `05-debug-overlay-desktop.png` | The developer overlay, which exists only in a build made with `NEXT_PUBLIC_DEBUG_OVERLAY=1` and is off until toggled: the tile grid, coordinates every five tiles, run-local actor ids (`character`, `s1`) and `rev 9 · tick 18 · room 3 · you 15,3,7 · 2 alive`. |

Compare `03` and `04` directly: that pair **is** the viewport contract. A larger screen shows the
same corridor bigger, never more of it.

The far-away states in `03`, `04` and `05` were reached by fast-forwarding the **durable run row**
— `room`, `creatures`, `position` — exactly as `tests/e2e/support.ts` documents for the cases that
are about rendering rather than about progress. The window still learnt everything through the
real routes; it is the truth behind them that was moved, not the routes.
