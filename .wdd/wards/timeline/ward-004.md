---
ward: 4
revision: null
name: "Two scenarios side by side"
epic: "timeline"
status: "red"
dependencies: ["timeline-003"]
layer: "fullstack"
estimated_tests: 18
created: "2026-10-08"
completed: null
---
# Ward timeline-004: Two scenarios side by side

## Scope
This ward implements contract **T4** (`.wdd/epics/timeline.md`):
- **Lockstep:** the worker advances A and B together, at the same tick.
- **Split view:** a side-by-side view with linked cameras.
- **Comparison panel:** window metrics from the branch tick for A and B at the shared tick, with the differences and incomplete trips always shown.

It also clears the timeline-003 MINORs that touch the same code.

## Inputs
- From timeline-003:
  - the host scenarios A/B (`scenarios`, `viewed`, `branchTick`), `afterJump`, `ready()` and `timelineStatus`;
  - the wasm methods `Sim.window_metrics` / `timeline_info` / `seek` / `forget_frames` / `free`;
  - `TimelineBar`, `ScenarioPanel`, `ConfirmReplace` and `intervene`.
- `CityRenderer`, `Camera` (`fitInsets`, `panBy`, `zoomAt`), `cityDecor` and `buildRoadGeometry`.
- From timeline-002: `WindowMetrics` (the cohort from the branch tick; incomplete trips).

## Outputs
**Protocol**
- `ToWorker`:
  - `compare { on: boolean }`, allowed only when B exists. Turning it on aligns B to A's tick, or the reverse, as described in § Specification.
  - `discardBranch` also ends comparing.
- `FrameMessage`:
  - `compare: 0 | 1` is added inside the numbers-only `timeline` object.
  - While comparing, the host posts **two frames per interval**: scenario 0, then scenario 1, with the same `tick`.
- `FromWorker`:
  - adds `{ type: 'comparison', tick, fromTick, a: Float64Array(9), b: Float64Array(9) }`, the `Sim.window_metrics(branchTick)` layout for each side;
  - it is sent at most every `COMPARISON_INTERVAL_MS = 500` ms of host time, and once at once on entering compare, after a seek and on pause;
  - this addresses the timeline-002 MINOR (throttle `window_metrics`).

**Host**
- While comparing:
  - `iterate` plans `n` ticks once and steps **both** sims by `n`, timing the pair. The clock's ms per tick is the pair's, so *behind* means the pair cannot keep up.
  - `seek {tick}` seeks both. It is refused unless the tick lies in the **shared window** `[max(windowStartA, windowStartB, branchTick), min(headA, headB)]`.
    - Both frames report the shared window as their `timeline` window, so the slider spans it.
    - A seek below `branchTick` is refused, because B did not exist yet.
  - `command` is refused with an error: interventions happen in single view.
  - `viewScenario` is refused with an error: the A/B buttons are disabled while comparing.
  - `inspectVehicle` is ignored and nothing is tracked, because vehicle picking is off while comparing.
  - `frame.scenario` names the **side** (0 = A, 1 = B) of each frame in a pair.
- A replaced or discarded B is freed as before. A replace now checks `fromTick` against A's window **before** building, and frees the old B before building the new one (the timeline-003 MINOR about the memory peak).
- A `branch` (a replace) while comparing ends comparing.

**UI**
- **Compare button.** A "Compare side by side" button (`aria-pressed`) sits in the scenario panel and is shown when B exists.
- **While comparing:**
  - Two canvases sit side by side, 50 % each, with a 2 px divider. The left one is A (`canvas.city`, unchanged), the right one B (`canvas.city.city-b`, `aria-label="City map, branch B"`). Each has its own `CityRenderer` and the same `Camera` object, so the **cameras are linked**: pan or zoom on either side moves both.
  - Each side has a corner label, "A: original" or "B: branch", in a pattern frame (text, not hue).
  - District labels are drawn on both sides.
  - **Road picking knows the side.** A click on the right half picks in B's geometry and frame.
    - The road panel heading names the side ("Link N (B)").
    - Its vehicles, queued and state come from that side's frame. There is no host link detail while comparing.
  - **Vehicles are not picked while comparing.** Cars stay visible, and no vehicle panel opens.
  - The UI holds a scenario-0 frame until its scenario-1 partner arrives, then applies and draws **both together**. `sides` reflects the committed pair.
  - The B canvas exists **only while comparing**. On exit it is unmounted, its renderer is disposed, and its WebGL context is released (`WEBGL_lose_context`), so repeated toggling never makes the browser drop A's context.
  - The interventions are disabled with the title "Exit comparison to change roads": "Close the main bridge", the road panel's Close/Reopen and the B key. The B key opens no confirmation and sets no pending cue.
  - The A/B scenario buttons are disabled.
  - The metrics strip and the legend are hidden.
  - A **comparison panel** (region "Comparison") sits above the timeline bar. It shows:
    - "sim time hh:mm:ss (both)" and "measured since hh:mm:ss (branch)";
    - rows for trips generated, completed, **incomplete**, unserved (removed), mean trip and p95 trip;
    - columns A, B and Δ (B − A). The sign is shown as "+"/"−" plus ▲/▼ glyphs, never by colour.
  - **Cell formats:**
    - counts are plain integers;
    - Unserved = `removed_unreachable + removed_gridlock` (indices 4 + 5);
    - times are "m:ss" of the rounded seconds;
    - an undefined value (NaN) shows "—", and so does its Δ;
    - a count Δ is "+n ▲", "−n ▼" or "0";
    - a time Δ is "+m:ss ▲", "−m:ss ▼" or "0:00".
  - The panel is a `<table>`: a header row of `columnheader`s ("", "A", "B", "Δ"), then one row per metric whose first cell is a `rowheader` ("Generated", "Completed", "Incomplete", "Unserved", "Mean trip", "p95 trip") followed by the A, B and Δ cells. Counts are plain integers; times are "m:ss".
  - The camera fits with `COMPARE_FIT_INSETS = { top: 120, right: 16, bottom: 230, left: 16 }` per half, on entering and on leaving (the single view uses `FIT_INSETS` again).
- **Exiting** via the button, a discard or a replace returns to the single view of the viewed scenario.
- **Fixes carried from timeline-003:**
  - The scenario panel wraps to two rows below 1,200 px width, so it no longer covers the control panel.
  - Cancel and Replace in the confirmation return focus to the slider.
  - The confirmation takes focus when it opens: its primary button is focused.
- **Test hook additions:**
  - `snapshot().compare` (boolean);
  - `snapshot().sides`: `{ a: { tick, closed }, b: { tick, closed } } | null` while comparing;
  - `comparison()`: the latest comparison message as plain arrays, or null;
  - `pickAt(x, y)` also returns `side: 'A' | 'B'`. While comparing, its `vehicle` is always null;
  - `snapshot().drawnCameras`: `{ a: { cx, cy, zoom }, b: { cx, cy, zoom } } | null`, the camera each renderer last drew with;
  - `linkScreenPointB(link, t)`: like `linkScreenPoint`, but in page coordinates of the B canvas (null when not comparing).

## Specification
- **Aligning on entry.** Let `t` = the viewed scenario's position.
  - The other scenario seeks to `t` if `t` is in its window.
  - If `t` is beyond its head, it steps forward to `t`, unpaced and in bounded chunks, as in the warm-up.
  - If `t` is below its window, compare is refused with an error.
  - Both are paused after aligning.
- **Lockstep.** On every iteration both sims advance by the same `n`, and every pair of frames has equal ticks. Each side's state equals a separate run of that scenario: A with its commands; B with A's commands < branch tick plus its own.
- **Comparison.** No comparison message is sent outside compare. The `fromTick` of a comparison message is `branchTick`. `a` and `b` are taken at the same tick, which is the tick of the frames posted in the same iteration. The panel shows them unchanged. The Δ of the mean and p95 is shown only when both sides are defined, and "—" otherwise.
- **Cost.** Lockstep doubles the tick cost, measured by the pair. Rendering is two canvases, drawn in the same rAF.
- **Colourblind.** Sides are told apart by text labels and pattern frames, and differences by a sign plus a glyph. No hue is used.

## Tests
- Vitest, host on real wasm with a fake clock: `web/tests/compare.test.ts`, tests 1–10.
- Playwright: `web/e2e/compare.spec.ts`, tests 11–18.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `compare_aligns_and_pauses` | A at 1,000 (head 1,200), B branched at 600 and running. `compare on` aligns A to B's tick by a seek (A keeps head ≥ 1,200). The pairs are strict (A, B), at that tick, each side paused. With A viewed at 1,100 (> B's head), re-entering steps B forward to 1,100. There are no errors |
| 2 | `lockstep_equals_separate_runs` | strict pairs with equal ticks while running. A's and B's hashes equal separate references. The last pair's frames come from their own side: B closed / A open, and each frame's `metrics` = its sim's `metrics()` |
| 3 | `comparison_messages` | none before compare. One on entering and one after a seek. While running, at most one per 500 ms of host time. Each has `fromTick` 600, a tick that is the tick of a posted pair, and partitioned arrays, with both sims' `window_metrics(600)` called at that tick. One on pause, equal to the sims' values. No errors |
| 4 | `seek_in_compare_moves_both` | `seek(700)` moves both to 700. The shared window starts at the branch tick (600) and ends at the common head. Seeks above the shared head or below the branch tick are refused, with no change |
| 5 | `commands_refused_in_compare` | a `command` produces an error. After running, B is still closed and the ticks are equal |
| 6 | `behind_counts_the_pair` | 3 ms per sim step. Single view: ≥ 115 ticks/s and not behind. Comparing: behind, with 90–110 ticks/s. A host timing one sim fails. No iteration exceeds the budget + 2 × cost |
| 7 | `exit_compare_single_view` | after `compare off`: frames for the viewed scenario only, and no comparisons. `discardBranch` while comparing ends compare, frees B, and no comparisons follow |
| 8 | `compare_refused_without_branch` | without B: an error, `compare 0`, and no comparison |
| 9 | `view_switch_and_vehicle_picks_refused_in_compare` | `viewScenario` while comparing produces an error. `inspectVehicle` is ignored (no `tracked`), and the pairs continue |
| 10 | `replace_order_and_compare_end` | an out-of-window `branch` is refused before any `free` or `branch` call, and compare stays on. A valid replace calls `free(B)` **before** `A.branch`, then ends compare |
| 11 | `compare_split_view` (e2e) | two half-width canvases, with "A: original" and "B: branch" corner labels (not buttons) inside them. The comparison region has the sim-time and since lines, the rows (incl. **Incomplete**) and the A/B/Δ column headers. The metrics strip and legend are hidden. The main bridge lies inside B's `COMPARE_FIT_INSETS` rectangle |
| 12 | `comparison_matches_host_numbers` (e2e) | right after entering, an undefined mean shows "—" (with a "—" Δ). Later, Generated / Completed / Incomplete equal `comparison()`, and their Δ has the sign, ▲/▼ and number. Unserved = 4 + 5. Mean and p95 are "m:ss". The sim-time and since lines match |
| 13 | `matching_sim_time_and_scrub` (e2e) | at 20×, `sides.a.tick === sides.b.tick` in 10 samples (pairs are committed together), and the panel's sim time is the shared tick. ← on the slider moves both sides by 120, and the panel follows |
| 14 | `linked_cameras` (e2e) | a wheel zoom anchored at a point on the right half keeps that point (±2 px). A drag on the right half pans B's points by exactly the drag. `drawnCameras.a` equals `drawnCameras.b` |
| 15 | `picking_per_side` (e2e) | the closed central bridge picked on the right gives side B, the bridge link, and a road panel with "(B)" and "state closed". On the left it gives "(A)" and "state open". No vehicle is picked and no vehicle panel opens |
| 16 | `interventions_disabled_while_comparing` (e2e) | the bridge button and the road panel's Close/Reopen are disabled with the title. The B key gives no confirmation and no pending cue; after running, the closed sets and the scenario are unchanged and there is no alert |
| 17 | `exit_compare_returns_to_single_view` (e2e) | exiting gives one full-width canvas with the B canvas **removed**, no comparison region, and the strip and legend back. After 18 toggles, A's context is not lost, it keeps rendering, there is exactly one canvas, and the console shows no context-loss messages. Discarding while comparing returns to the single view |
| 18 | `layout_and_focus_fixes` (e2e) | at 1024×768 with B present, the scenario panel covers no control-panel control. The confirmation focuses its primary button on opening. Both Cancel and Replace return focus to the slider |

## Must NOT
- Step the two scenarios separately while comparing, or let their ticks differ in any posted pair.
- Use hue to tell the sides or the differences apart.
- Allow interventions while comparing.
- Change frozen tests or the single-view behaviour.

## Must DO
- Lockstep is bit-identical to separate runs.
- Window metrics come from the same tick on both sides.
- Incomplete trips are always shown.
- Cameras are linked.
- Record the deviations from T4 (two canvases, interventions disabled) for the epic gate.

## Deviations from T4
- **Two canvases (two WebGL contexts) instead of one context with two viewports.** This reuses `CityRenderer` unchanged per side. The cost is double GPU buffers, which are small. B's context exists only while comparing.
- **Interventions are disabled while comparing.** T4 does not say which side a control would act on. Comparing is for observing, and changes are made in the single view.
- **Vehicle inspection is off while comparing, and so is the A/B view switch.** Road inspection works per side. Inspecting a vehicle per side would need per-side tracking in the host; that is left to the single view.
- **Seeks below the branch tick are refused while comparing.** The slider spans the shared window.

## Manual Smoke Test
### Setup
```
pnpm -C web build:wasm && pnpm -C web dev
```
### Steps
1. Close the main bridge in the past to create B, then press "Compare side by side". Verify: two labelled halves at the same sim time, and the comparison panel with incomplete trips.
2. Run at 20× for a few sim minutes. Verify: B's incomplete count and mean trip rise above A's, consistent with the probed timeline-002 numbers.
3. Pan and zoom on one side. Verify: both follow.
4. Scrub back on the timeline. Verify: both sides move to the same tick and the panel updates.
5. Take a grayscale screenshot. Verify: the sides and the Δ are readable.
6. Measure the lockstep tick cost (diagnostics) and the render interval against single view.
### Pass criteria
- [ ] All suites green
- [ ] The smoke steps hold
- [ ] The lockstep and render costs are measured and stated

## Verification
The Gold reviewer runs everything, does the smoke test with Playwright MCP (colour and grayscale), and checks the lockstep equivalence with a probe.
