# Phase 3.5 — browser evidence

Five screenshots of the running stack: a real API, a real database, a real
content bundle and a real Chromium. Nothing here is a mockup, a render of a
design, or a picture of something that does not exist — each one is a
`page.screenshot()` of the Game Window during a live Hunt.

| File | What it shows |
|---|---|
| `01-approach-desktop.png` | Room 4, desktop 1440×900. The Character at `(19,4)` and two Rats at `(19,2)` and `(22,5)` — nobody in reach, everybody at full health, the Character walking. This is the state that did not exist before this phase: a fight you have to get to. |
| `02-combat-desktop.png` | Room 1, desktop. The Character adjacent to a Rat, clash marks between them, the Rat at 13/20 and the Character at 147/150. Adjacency is the server's precondition for the attack; the picture is of the precondition being met. |
| `03-room-6-desktop.png` | Room 6, desktop. A different chamber, reached as a room transition, with three Rats converging and two of them already in contact. The camera has followed the Character to the middle of the map. |
| `04-mobile.png` | Room 6, 390×844 at DPR 3. Nine tiles across, seven down, the same scene and the same readouts, no horizontal scroll. |
| `05-debug-overlay-desktop.png` | The developer overlay, which exists only in a build made with `NEXT_PUBLIC_DEBUG_OVERLAY=1` and is off until toggled: the tile grid, coordinates every five tiles, actor ids, and `rev 7 · tick 14 · room 3 · you 15,3,7 · 2 alive`. |

The far-away states in `03` and `04` were reached by fast-forwarding the
**durable run row** — `room`, `creatures`, `position` — exactly as
`tests/e2e/support.ts` documents for the cases that are about rendering rather
than about progress. The window still learnt everything through the real
routes; it is the truth behind them that was moved, not the routes.
