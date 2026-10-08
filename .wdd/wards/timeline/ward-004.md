---
ward: 4
revision: null
name: "Two scenarios side by side"
epic: "timeline"
status: "red"
dependencies: ["timeline-003"]
layer: "fullstack"
estimated_tests: 16
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
  - `seek {tick}` seeks both. It is refused unless the tick is in both windows.
  - `command` is refused with an error: interventions happen in single view.
  - `viewScenario` keeps comparing, and only decides which side the metrics strip and inspection follow.
- A replaced or discarded B is freed as before. A replace now checks `fromTick` against A's window **before** building, and frees the old B before building the new one (the timeline-003 MINOR about the memory peak).

**UI**
- **Compare button.** A "Compare side by side" button (`aria-pressed`) sits in the scenario panel and is shown when B exists.
- **While comparing:**
  - Two canvases sit side by side, 50 % each, with a 2 px divider. The left one is A (`canvas.city`, unchanged), the right one B (`canvas.city.city-b`, `aria-label="City map, branch B"`). Each has its own `CityRenderer` and the same `Camera` object, so the **cameras are linked**: pan or zoom on either side moves both.
  - Each side has a corner label, "A: original" or "B: branch", in a pattern frame (text, not hue).
  - District labels are drawn on both sides.
  - Picking knows the side: a click on the right half picks in B's frame. The road panel and inspection show the clicked side, named in their heading ("Selected road (B)").
  - The interventions ("Close the main bridge", the road panel's Close/Reopen, the B key) are disabled, with the title "Exit comparison to change roads".
  - The metrics strip and the legend are hidden.
  - A **comparison panel** (region "Comparison") sits above the timeline bar. It shows:
    - "sim time hh:mm:ss (both)" and "measured since hh:mm:ss (branch)";
    - rows for trips generated, completed, **incomplete**, unserved (removed), mean trip and p95 trip;
    - columns A, B and Δ (B − A). The sign is shown as "+"/"−" plus ▲/▼ glyphs, never by colour.
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
  - `pickAt(x, y)` also returns `side: 'A' | 'B'`;
  - `linkScreenPointB(link, t)`: like `linkScreenPoint`, but in page coordinates of the B canvas (null when not comparing).

## Specification
- **Aligning on entry.** Let `t` = the viewed scenario's position.
  - The other scenario seeks to `t` if `t` is in its window.
  - If `t` is beyond its head, it steps forward to `t`, unpaced and in bounded chunks, as in the warm-up.
  - If `t` is below its window, compare is refused with an error.
  - Both are paused after aligning.
- **Lockstep.** On every iteration both sims advance by the same `n`, and every pair of frames has equal ticks. Each side's state equals a separate run of that scenario: A with its commands; B with A's commands < branch tick plus its own.
- **Comparison.** The `fromTick` of a comparison message is `branchTick`. `a` and `b` are taken at the same tick, which is the tick of the frames posted in the same iteration. The panel shows them unchanged. The Δ of the mean and p95 is shown only when both sides are defined, and "—" otherwise.
- **Cost.** Lockstep doubles the tick cost, measured by the pair. Rendering is two canvases, drawn in the same rAF.
- **Colourblind.** Sides are told apart by text labels and pattern frames, and differences by a sign plus a glyph. No hue is used.

## Tests
- Vitest, host on real wasm with a fake clock: `web/tests/compare.test.ts`, tests 1–8.
- Playwright: `web/e2e/compare.spec.ts`, tests 9–16.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `compare_aligns_and_pauses` | with A at 1,000 (head 1,200) and B branched at 600 and run to 900: `compare on` while viewing B aligns A to 900 (a seek), both frames are at 900 and paused. Viewing A instead aligns B to A's position (B steps forward unpaced) |
| 2 | `lockstep_equals_separate_runs` | after `compare on` and 600 lockstep ticks, every frame pair has equal ticks. A's and B's hashes equal separately stepped references (A from its commands, B as branch + its commands) |
| 3 | `comparison_messages` | on entering, after a seek and while running (at most one per 500 ms of host time): `fromTick` = branchTick, `tick` = the frames' tick, and `a` / `b` equal the sims' `window_metrics(branchTick)`. `incomplete` (index 6) is present and partitions |
| 4 | `seek_in_compare_moves_both` | `seek(700)` puts both at 700. A tick outside B's window or above either head is refused with an error, and nothing changes |
| 5 | `commands_refused_in_compare` | a `command` while comparing produces an error, and neither hash changes |
| 6 | `behind_counts_the_pair` | fake tick cost of 5 ms per sim step, so one sim manages ≤ 200 ticks/s and the pair ≤ 100. At 60× (target 120 ticks/s), single view is not behind (achieved ≈ 120). Comparing is behind, with an achieved rate within ±10 % of 100 |
| 7 | `exit_compare_single_view` | `compare off` posts frames for the viewed scenario only. `discardBranch` while comparing ends compare and frees B |
| 8 | `compare_refused_without_branch_or_below_window` | without B, `compare on` is refused with an error, and frames keep `compare 0`. The below-window case cannot be set up with the fixed 48 MiB budget; the Gold reviewer checks it in code |
| 9 | `compare_split_view` (e2e) | after branching and "Compare side by side": two canvases each half the width, with the labels "A: original" and "B: branch" visible. The comparison region shows "sim time … (both)", rows including **Incomplete**, and columns A, B, Δ |
| 10 | `comparison_matches_host_numbers` (e2e) | while paused, the panel's A and B values for generated, completed and incomplete equal the hook's `comparison()` arrays at the hook's tick |
| 11 | `matching_sim_time` (e2e) | while running at 20×, sampled 10 times: `sides.a.tick === sides.b.tick`, and the panel's sim time equals the shared tick |
| 12 | `linked_cameras` (e2e) | a wheel zoom over the left half changes `camera.zoom`; a drag on the right half pans. Both canvases redraw with the same camera, so the same road's screen point is equal relative to each canvas |
| 13 | `picking_per_side` (e2e) | clicking a road on the right half selects it with `pickAt(...).side === 'B'`, and the road panel heading reads "(B)". On the left it reads "(A)" |
| 14 | `interventions_disabled_while_comparing` (e2e) | "Close the main bridge" is disabled with the title "Exit comparison to change roads". The B key does nothing: no closure appears, there is no error alert, and the scenario is unchanged |
| 15 | `exit_compare_returns_to_single_view` (e2e) | "Compare side by side" toggled off, or "Discard branch", gives one full-width canvas, the metrics strip and legend visible again, and no comparison region |
| 16 | `layout_and_focus_fixes` (e2e) | at 1024×768 with B present, the scenario panel does not cover the control panel's buttons (`elementFromPoint`). After "Replace the branch?" → Cancel, focus is on the slider; the confirmation's primary button has focus when it opens |

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
- **Two canvases (two WebGL contexts) instead of one context with two viewports.** This reuses `CityRenderer` unchanged per side. The cost is double GPU buffers, which are small.
- **Interventions are disabled while comparing.** T4 does not say which side a control would act on. Comparing is for observing, and changes are made in the single view.

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
