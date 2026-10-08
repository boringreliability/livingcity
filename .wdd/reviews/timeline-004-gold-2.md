# timeline-004 Gold review, round 2

**Verdict: REJECTED** (0 BLOCKER, 1 MAJOR, 2 MINOR)

Reviewer: a fresh adversarial Gold subagent. It saw only the artifacts: the ward spec, the T4 contract, the frozen tests, the diffs `c5a53fc..HEAD` and `HEAD~1..HEAD`, and the r1 verdict.
- Implementation: HEAD 59bdeea (r1 fixes on top of 8c2e364).
- Red snapshot: c5a53fc.

Every suite is green and stable, and four of the five r1 fixes hold. But the m2 fix (side labels moved up from `top: 128px` to `top: 92px`) moved them **under the wrapped scenario panel at every window narrower than 1200 px**. There the halves have no "A"/"B" text at all. r1 saw them clear at 1024×768, so this is a regression. The new regression test that should guard the labels cannot fail, because it hit-tests an element that has `pointer-events: none`.

## Test freeze
- `git diff c5a53fc HEAD -- web/tests web/e2e crates` touches only the **new** file `web/e2e/gold_timeline004.spec.ts`.
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
| `pnpm -C web e2e` | **69 passed, 1 skipped** (the human-approved G4 skip), 11.0 min |
| `pnpm -C web e2e compare.spec gold_timeline004 timeline.spec look.spec city.spec --repeat-each 2` | **68 passed, 0 failed, 0 flaky**, 15.5 min |

`git status` stays clean after all runs.

## r1 findings
| r1 | Status | How it was verified |
|---|---|---|
| **M1** disabled controls look live | **Fixed** | In compare, the computed style of the bridge button, "A: original", "B: branch from …" and the road panel's "Reopen link" is `opacity 0.45, border dashed, cursor not-allowed`. "Compare side by side" and Play stay at `1 / solid / pointer`. The hatch icon fades with its button. A forced click and the B key change nothing, with no alert (`-02`, `-07`, and the grayscale versions). |
| **m1** stale hover | **Fixed** | `App.tsx:416`. I hovered link 150 in single view (double-line halo visible in `-01`), then entered compare. The A and B crops around link 150 are identical (mean abs diff 0.44 / 255, from vehicle noise; `-03-hover-crops`). |
| **m2** side labels over the roads at 1280×720 | **Fixed at ≥ 1200 px, regressed below**: see **M1** | Geometric test (41 samples per link per side against the label boxes): 0 points under the labels at 1280×800 and 1280×720 (`-05`). |
| **m3** no refit on resize | Deferred: **acceptable** | It matches the single view. Re-entering refits, the cameras stay linked, and nothing breaks (1024 → 1280 in compare, `-10`). Record it as a known issue. |
| **m4** road panel over B's NE corner | Deferred: **acceptable** | Still present (`-07`). The panel is transient (Escape closes it), the user can pan, and the inset is pinned by frozen test 11. Record it. |
| **m5** diagnostics unlabelled | **Partly fixed**: see m2 below | The tick percentile label reads "sim tick, A + B" and the vehicles label reads "vehicles in A". |
| **m6** B's frame buffer not reused | Deferred: **acceptable** | GC pressure only, no leak. The pair costs about 0.12 ms/tick at 20× (diag), so there is no measurable effect. Record it. |
| **m7** `sim` dangling during a replace | **Fixed** | `host.ts:400`: `sim = a` before `free(B)`. Residual (observation only): `viewed` stays 1 until line 406. If `a.branch` ever threw, `command` would skip the "A in its past" guard (`viewed === 0`). This is unreachable today. |

## Manual smoke test (Playwright MCP, vite on 5182, River City, Apple GPU)
- **Screenshots.** `.playwright-mcp/timeline-004-gold-2-*.png`, plus `-gray` versions of each.
- **Dialogs.** `alert` and `confirm` were stubbed: **0 native dialogs**.

1. **Branch and enter.** Pause, ←, then "Close the main bridge" made B at 2300. "Compare side by side" gave the shared window [2300, 2300] and both sides at 2300, with 0/0/0 and "—" (`-02`). ✓
2. **20× run.** In 40 samples at 250 ms, A's tick equalled B's every time. B closed {284, 285}. At +10 min: Incomplete 1602 vs 1741 (+139 ▲). At +15 min: 1646 vs 1890 (+244 ▲), p95 7:21 vs 9:06 (+1:45 ▲). Generated is equal and Unserved is 0/0. ✓
3. **Diagnostics in compare.** Shows "sim tick, A + B (median / p95) 0.100 / 0.200 ms", "sim tick (mean) 0.119 ms", "vehicles in A …", "frame size 25760 B" and "frame encode 0.10 ms" (`-04`). See m2.
4. **Pan and zoom.** Wheel on B took the zoom from 0.099 to 0.588, then a drag on A. `linkScreenPointB − linkScreenPoint` = (640, 0) throughout, and `drawnCameras.a == .b` (`-06`). ✓
5. **Scrub.**
   - ← moved both sides from 4143 to 4023, and the comparison tick was 4023.
   - Home went to 2300 (the branch). A further ← and "Jump to start" stayed at 2300 with no alert.
   - End and Live went to 4143 on both sides. ✓
6. **Pick per side.** B's central bridge showed "Link 284 (B) … closed", with "Reopen link" disabled and faded. A showed "Link 284 (A) … vehicles 20, open". ✓
7. **15 enter/exit cycles.** Each of the 14 removed B canvases is `isContextLost() === true`, with 14 `webglcontextlost` events, all on removed canvases. One canvas after exit, and the single-view zoom is 0.150 (`-08`). ✓
8. **Discard while comparing.** Back on A, `branchTick` null, no comparison region, focus on the "Timeline" slider. ✓
9. **No-WebGL2 fallback** (a fresh page with `getContext('webgl2')` → null). The alert "WebGL2 is not available…" shows. Play, Speed and "Close the main bridge" are disabled and now render faded, dashed and not-allowed (`-12`). They read clearly as unavailable, and the frozen `no_webgl2_fallback` test passes. ✓ No other control in single view is disabled, so the global `button:disabled` rule changes nothing else.
10. **Layouts.** At 1280×800 and 1280×720 the side labels are clear of the roads and the panels. At **1024×768, 1100×800 and 1180×720 they are hidden**: see M1 (`-09`, `-11`).
11. **Grayscale** (`-07-pick-B-gray`). Disabled controls read by fade and dashed edge. Δ reads by its sign and glyph. B's closed bridge keeps its hatched barrier. ✓

Vite on 5182 was killed afterwards. Port 4243 was not touched.

## Code review of the fixes
- `styles.css:139-144` is a global `button:disabled, select:disabled` rule. Outside compare, it hits only the no-WebGL2 controls (verified). Fine.
- `DiagnosticsPanel` gets `comparing` from `App.tsx:894`. There is no new orphaned prop or export.
- `gold_timeline004.spec.ts`: the disabled-look test is real. The label test is not: see m1.
- Lockstep, pairs, buffers, B context release and interventions off are unchanged since r1, and r1's probes still apply (the host diff is only `host.ts:400`).

## BLOCKER
None.

## MAJOR
**M1. Below 1200 px wide, the side labels "A: original" and "B: branch" are hidden behind the scenario panel, so the halves carry no A/B text.** This is a regression from the m2 fix.
- **Where.** `.side-label { top: 92px }` (`styles.css:531`), with A at `right: calc(50% + 12px)` (`:542`) and B at `left: calc(50% + 12px)`, both right next to the divider.
- **Why they collide.** Under `@media (max-width: 1199px)` (`styles.css:591`) the scenario panel wraps to three rows, centred at `50% + 70px`.
- **Measured geometry.**
  - 1024×768: the scenario panel is [408, 16, 756, 125]. Label A is [420, 92, 500, 114] and label B is [524, 92, 601, 114], both fully inside it.
  - 1100×800 and 1180×720: the same overlap.
  - 1280 wide: the panel ends at y = 59 and the labels are visible.
- **Visual check.** The screenshot `-09-1024x768` and the clip `-11-labels-hidden-1024` show no "A: original" or "B: branch" anywhere: the panel paints over them.
- **Effect.**
  - Ward spec §60-61 says "each side has a corner label … text and pattern, never hue". §109 says sides are told apart by text labels and pattern frames, and those frames are the labels' own borders.
  - At a common laptop width, the user therefore cannot tell which half is the original. The only remaining cue is incidental (B's barrier, once the closure has applied).
  - r1 measured the labels clear at 1024×768 with `top: 128px`, so the fix traded the 1280×720 overlap for this.
- **Why no test caught it.** Frozen test 11 runs only at 1280×800. The new regression test is vacuous (m1).
- **Fix direction.** Place the labels relative to the scenario panel's real bottom, or lower them in the narrow media query. They must clear both the roads and the panel at 1024×768, 1280×720 and 1280×800. Then make the regression test geometric and add 1024×768.

## MINOR
- **m1. The new side-label regression test cannot fail** (`web/e2e/gold_timeline004.spec.ts:63`).
  - The test counts link points where `document.elementFromPoint(p).closest('.side-label')` is truthy. But `.side-label` has `pointer-events: none` (`styles.css:537`), and hit-testing skips such elements.
  - Verified: `elementFromPoint` at a point *inside* the label box returns the canvas ("miss") at every size I tried.
  - So the test returns 0 even when a label covers a road, and it did not catch M1's overlap either.
  - Fix: compare the link points with `getBoundingClientRect()` of each label. For M1, also check that the label box does not intersect `.scenarios`, `.controls` or `.comparison`.
- **m2. The r1 m5 fix is incomplete: three diagnostics rows still mean something else while comparing, and nothing says so** (`DiagnosticsPanel.tsx:37,40,45`).
  - "sim tick (mean)" is the **pair** cost (0.119 ms in compare vs about 0.07 single, as measured by r1), but it is labelled like the single-view per-tick cost.
  - "frame encode" and "frame size" are A's frame only.
  - The percentile row was relabelled "A + B", so the mean row now contradicts its neighbour.
  - Label all three, for example "sim tick, A + B (mean)", "frame encode (A)" and "frame size (A)".

## Observations (no action required)
- **Clipped district labels.** At 1280×800 compare, the district labels at the outer columns are clipped by each half's `overflow: hidden`: "Eastga|te" on both halves at x ≈ 600–640 and 1240–1280, and B's "⌂ Hillside" starts at the divider. This is cosmetic, and the inset that would fix it is pinned by frozen test 11.
- **The dashed edge means two things.** The disabled-button cue (dashed edge) is the same pattern that marks B's side label. The text resolves it ("A: original" disabled reads dashed), and the fade keeps disabled unambiguous, so it is acceptable. A dotted edge for disabled would keep "dashed = B" exclusive.
- **Bridge button label.** While comparing, the faded bridge button reads "Close the main bridge" (A's state) even though B has the bridge closed. It is disabled with the tooltip "Exit comparison to change roads", so this is acceptable.
- **Known issues for the epic gate:** r1 m3, m4 and m6 (judged acceptable above), and the m7 residual (`viewed` not reset before `a.branch`).
