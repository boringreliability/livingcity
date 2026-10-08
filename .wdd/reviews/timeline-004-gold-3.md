# timeline-004 Gold review, round 3

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 1 MINOR)

Reviewer: a fresh adversarial Gold subagent. It saw only the artifacts: the ward spec, the T4 contract, the frozen tests, the diffs `c5a53fc..HEAD` and `HEAD~1..HEAD`, and the r1 and r2 verdicts.
- Implementation: HEAD ce92634 (the r2 fixes on top of 59bdeea).
- Red snapshot: c5a53fc.

The r2 MAJOR is fixed. The side labels now sit in the outer bottom corners of each half (`bottom: 50px`, A `left: 12px`, B `right: 12px`), and they are visible, unobstructed and clear of every road and panel at all four sizes I measured. Both r2 MINORs are fixed: the label regression test is now geometric and non-vacuous, and the diagnostics rows say A or A+B. Every suite is green and stable, and the lockstep equivalence probe still passes against HEAD.

## Test freeze
- `git diff c5a53fc HEAD -- web/tests web/e2e crates` touches only the **new** file `web/e2e/gold_timeline004.spec.ts`. That is the Gold regression file, not a frozen spec.
- sha256 `web/tests/compare.test.ts` = `b749a549…`, `web/e2e/compare.spec.ts` = `a5cf7547…`. Both are identical at c5a53fc and HEAD. ✓

## Commands run (from the worktree root)
| Command | Result |
|---|---|
| `cargo test --workspace` | 165 passed, 0 failed |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web build:wasm` | OK |
| `pnpm -C web test` | 20 files, **103/103 passed** |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web build` | OK |
| `pnpm -C web e2e` | **71 passed, 1 skipped** (the human-approved G4 skip), 11.4 min |
| `pnpm -C web exec playwright test compare.spec gold_timeline004 timeline.spec look.spec --repeat-each 2` | **62 passed, 0 failed, 0 flaky**, 16.0 min |
| r1's lockstep probe (`scratchpad/gold3-tl004/lockstep.test.ts`, real wasm through `createSimHost`, 10 hash checks) | passed against HEAD |

`git status` is clean after all runs.

## r1 and r2 findings
| Finding | Status | How it was verified |
|---|---|---|
| r1 **M1** disabled controls look live | **Fixed** | See the r2 row on the dotted edge below. |
| r1 **m1** stale hover | Fixed (r2) | `App.tsx` clears `hoveredRef` in the layout effect. This code is unchanged since r2. |
| r1 **m2** / r2 **M1** side labels over the roads / hidden by the scenario panel | **Fixed** | Measured with `getBoundingClientRect`, sampling 41 points per link per side. At **1280×800, 1280×720, 1100×800 and 1024×768**, both before and after a refit: 0 road points fall under a label. There is no overlap with any `.panel`, `.zone`, `.timeline` or `.side` child. A temporary `pointer-events: auto` hit test at each label centre returns the label itself (topmost). Each label lies inside its own half. Boxes at 1024×768: A [12,696,92,718], B [935,696,1012,718], comparison [307,566,717,718]. Screenshots `-02-labels-*` plus `-gray`. |
| r2 **m1** vacuous label test | **Fixed** | `gold_timeline004.spec.ts:51-89` is now geometric. It uses the label rects against the link points and the panel rects, and checks the texts and the containing half at all four sizes. Against r2's layout (labels inside `.scenarios` below 1200 px), the `covered` assertion would fail. |
| r2 **m2** diagnostics rows unlabelled | **Fixed** | In compare at 20× the rows read: "sim tick, A + B (median / p95) 0.100 / 0.200", "sim tick, A + B (mean) 0.119 ms", "frame encode (A)", "vehicles in A", "frame size (A)". Single view keeps the plain labels (`-05b`). |
| r2 obs. dashed edge means two things | **Fixed** | `styles.css:139-144`: disabled is now `dotted`, and dashed is used only by B's label. |
| r1 m3 (no refit on resize), m4 (road panel over B's NE corner), m6 (B's buffer not pooled), m7 remainder (`viewed` stays 1 until after `a.branch`, `host.ts:400-406`) | Deferred: **acceptable** | m3: a resize without re-entry still leaves the labels clear (the "noRefit" probe at every size). m4: still present, transient, and pinned by the frozen inset. m6: GC only. m7: unreachable, because validation matches `Timeline::branch`. Carry all four into CONTEXT.md and the epic-gate known issues. |

## Manual smoke test (Playwright MCP, vite on 5181, River City)
- **GPU.** `ANGLE Metal Renderer: Apple M4 Pro`.
- **Screenshots.** `.playwright-mcp/timeline-004-gold-3-*.png`, each with a `-gray` version.
- **Dialogs.** `alert` and `confirm` were stubbed: **0 native dialogs**.
- **Console.** Only a favicon 404.

1. **Branch and enter.** Pause, ←, then "Close the main bridge" made B at 2281. "Compare side by side" gave both sides at 2281, labelled halves, and a comparison panel with Incomplete. ✓
2. **Run.**
   - 20×: 40 samples at 250 ms, A's tick equal to B's every time.
   - Then 60× to 00:44:06 (+25 min after the branch): Generated 9073/9073, Completed 7407/6980 (−427 ▼), **Incomplete 1666/2093 (+427 ▲)**, Unserved 0/0, Mean 4:25/4:46 (+0:21 ▲), p95 7:50/10:40 (+2:50 ▲). B closed {284, 285}.
   - This is consistent with r1 (+25 min: 1831/2147, 4:26/4:56) and with timeline-002 (`-01`). ✓
3. **Pan and zoom.** Wheel on B took the zoom from 0.588 to 3.489, then a drag on A. `linkScreenPointB − linkScreenPoint` = (640, 0) throughout, and `drawnCameras.a == .b` (`-04`). ✓
4. **Scrub.**
   - ← moved both sides and the position from 5293 to 5173, and the panel showed "sim time 00:43:06 (both)".
   - Home went to 2281 (the branch). A further ← and "Jump to start" stayed at 2281.
   - Live went to 5293. No error banner. ✓
5. **Disabled controls in compare** (`-03`). "Close the main bridge", "A: original", "B: branch from 00:19:00" and the road panel's "Reopen link" are `disabled`, with `opacity 0.45 / dotted / not-allowed` and the titles "Exit comparison to …". Play, Speed, ≡, timeline buttons, Compare and Discard are `1 / solid / pointer`. A forced click on the bridge button and on Reopen, plus the B key, change nothing: A closed [], B closed [284, 285], no confirmation. ✓
6. **Disabled controls with no WebGL2** (a fresh page with `getContext('webgl2')` → null) (`-08`). The alert "WebGL2 is not available…" shows. Play, Speed and "Close the main bridge" are `0.45 / dotted / not-allowed`. ≡ and Legend stay live. ✓
7. **Pick per side.** B's link 284 showed "Link 284 (B) … vehicles 0, state closed". A's showed "Link 284 (A) … vehicles 26, open". ✓
8. **Cost** (20×, from diagnostics):

   | | sim tick mean | median / p95 | render interval median / p95 | draw CPU median / p95 | achieved |
   |---|---|---|---|---|---|
   | single view (A) | **0.071 ms** | 0.1 / 0.2 ms | 8.3 / 9.9 ms | 0.0 / 0.1 ms | 20.0× of 20× |
   | lockstep pair | **0.119 ms** (×1.68) | 0.1 / 0.2 ms | 8.3 / 9.9 ms | 0.0 / 0.1 ms | 20.0× of 20× |

   The render interval is vsync-bound (120 Hz) in both modes. ✓
9. **15 enter/exit cycles.** Every removed B canvas is `isContextLost() === true` (15/15), and there was 0 `webglcontextlost` on A. After exit: one canvas, zoom 0.150, no side labels, and the legend and strip back (`-06`). ✓
10. **Discard while comparing.** Scenario A, `branchTick` null, no comparison, one canvas, focus on "Timeline" (`-07`). ✓
11. **Grayscale** (`-03-…-gray`, `-02-labels-1024x768-gray`).
    - The sides read by "A: original" in a solid frame and "B: branch" in a dashed, hatched frame.
    - Disabled controls read by fade and the dotted edge.
    - Δ reads by its sign and ▲/▼.
    - B's closed bridge keeps its hatched barrier.
    - No cue depends on hue. ✓

Vite on 5181 was killed afterwards. Port 4243 was not touched.

## Code review
- **The r2 fix diff** (`HEAD~1..HEAD`) changes only CSS, diagnostics labels and the Gold regression file. No logic changed.
- **Label placement.**
  - `.side-label` shares `bottom: 50px` with `.comparison`. The comparison panel is centred and about 410 px wide, so the two collide only below about 620 px window width, far under the supported 1024.
  - Vertically, the labels sit between the fit's bottom inset (230) and the timeline (bottom 10, height 32).
  - The diagnostics panel (top 132) and the road panel (top right) do not reach them.
  - When zoomed in, roads pass under the labels like under any HUD panel. That is expected, and roads stay clickable (`pointer-events: none`).
- **`button:disabled` rule.** Still global. In single view it hits only the no-WebGL2 controls (verified in step 6).
- **Host.** Unchanged since r2: the lockstep `iterate`, `postPair`, the shared-window seek refusal, `compare(off)` posting the viewed frame, and `discardBranch`/`branch` resetting `comparing`. Re-probed with r1's equivalence test (10 checks, all equal).
- **Exports.** No new orphaned exports or props. `DiagnosticsPanel.comparing` is consumed.

## BLOCKER
None.

## MAJOR
None.

## MINOR
- **m1. The scenario panel still says "Viewing B: branch" while both sides are shown.**
  - Where: the `ScenarioPanel` heading. This is the viewed scenario pinned by the frozen spec so that exit returns to it.
  - What: in compare, the heading keeps the dashed "Viewing B: branch" badge next to the disabled A/B buttons (`-02-labels-1024x768`, `-03`). That reads as if only B were on screen.
  - Repro: enter compare from B and look at the top panel.
  - Suggestion (cosmetic, not required for this ward): show "Comparing A and B" while comparing.

## Observations (no action required)
- **Known issues for the epic gate.** r1 m3 (no refit on resize while comparing), m4 (road panel over B's NE corner), m6 (B's frame buffer not pooled), and the m7 remainder (`viewed` not reset before `a.branch`). All four are judged acceptable in r2 and here.
- **Clipped district labels.** At the half edges they are still clipped by `overflow: hidden` ("Eastga|te", `-03`). This is cosmetic, and the inset is pinned by frozen test 11.
- **Faded bridge button text.** While comparing it reads "Close the main bridge" (A's state) although B has it closed. It is disabled and titled, so this is acceptable.
