---
ward: 5
revision: null
name: "Integration: verified in the browser, measured"
epic: "motion"
status: "red"
dependencies: ["motion-001", "motion-002", "motion-003", "motion-004"]
layer: "typescript"
estimated_tests: 8
created: "2026-10-11"
completed: null
---
# Ward motion-005: Integration: verified in the browser, measured

## Scope
This is contract **M5** of epic `motion` (`.wdd/epics/motion.md`) and the § Verification and § Delivery parts of the user's task (`.wdd/memory/task-2026-10-11-motion-paused-consequences.md`). It is the epic's integration ward: no new feature. It proves that the four wards work **together** in a real browser, at 1× and at 20×, in the six flows the user named:
1. traffic crossing a junction;
2. queue formation and release;
3. closing and reopening the main bridge;
4. pause, inspect and resume;
5. rewind and branch;
6. side-by-side comparison.

Each flow is checked through successive observed frames, sampled on every animation frame, because screenshots alone cannot establish smooth movement. Screenshots record the layout. It also measures the epic as a whole, before against after, under comparable conditions. Finally it brings the documentation and the WDD state up to date: resolved issues are no longer listed as open, and the supersession log is complete.

## Inputs
- **motion-001:** a quiet pause (`snapshot().framesReceived` stays still while paused) and bounded frame pools; supersessions S1–S3.
- **motion-002:** the presenter (`trackedDraw`, `vehicleDraw`, `drawAt`, `diagnostics().presentation`), stop lines and junction curves; supersessions S4–S8.
- **motion-003:** consequences: `interventions()`, `crossings()`, `queuePins()`, `bridgeLabels()`, timeline markers, `comparison().crossings`.
- **motion-004:** character: `closureSigns()`, `trackedMarker()`, `routeEnd()`, `roadClasses()`, `districtSamples()`.
- **Earlier epics:** the timeline (seek, branch with `b` on the slider, compare) and the `@perf` harness (`e2e/perf.spec.ts`, `perf-results/*.json`), `scripts/paused_probe.mjs`, and `cargo run -p sim-core --release --example frame_cost_probe`.

## Outputs
- `web/e2e/motion005.spec.ts`: the six flows (tests 1–6), each at 1× and 20×. Each test attaches its sampled frames (JSON) and its screenshots to the Playwright report.
- `web/tests/motion005.test.ts`: the epic's wiring and documentation checks (test 7) and the measurement record (test 8).
- `web/perf-results/motion-epic-before-after.json`: the epic's before/after measurements (schema below).
- `docs/verification/motion-005.md` plus `docs/verification/motion-005/*.png`: one screenshot per flow and speed, with what each shows, and the sampled-frame summary per flow.
- `docs/performance.md` § "Epic motion: before and after".
- `docs/known-issues.md` and the WDD state (`CONTEXT.md`, the epic file) updated.

## Specification
- **No product change is expected.** If a flow fails, the defect is fixed in the ward that owns it, via a regression test in this ward's spec file. No frozen test changes.
- **Speeds.** "At 1× and 20×" means the flow's motion is observed at each speed: the per-frame samples are taken while the sim runs at that multiplier. A flow may use 20× (or 60×) to *build up* a state, such as a queue, before it observes at 1×.
- **Motion bound.** Between two successive animation frames, wall time `dt` ms apart at multiplier `m`, a car's drawn world position may move at most `3 · V_MAX · m · dt / 1000 + 2` m, with `V_MAX = 20` m/s, which is above every speed limit in both cities. This catches teleports and the old ~7 m junction jumps at 1× (bound ≈ 3 m), while the presenter's catch-up stays within it.
- **Measurements before and after** (test 8).
  - "Before" is commit `19e9fbf`, the last commit before the epic. "After" is this ward's Gold commit. Both are built from source: for "before", the scratch tree's own wasm, built from that commit's Rust.
  - The runs are interleaved (before, after, before, after) on the same machine within one hour, and the load is recorded.
  - They are kept in **two groups**: `swiftshader` (the headless harness) and `hardware` (a headed run on the machine's GPU). If a hardware run is not possible in this environment, the `hardware` group holds `{ "measured": false, "reason": "…" }`, and the report says so. SwiftShader numbers are never presented as hardware numbers.
- **Measurement JSON schema** (`web/perf-results/motion-epic-before-after.json`):
  ```
  { "epic": "motion", "before": { "commit": "19e9fbf" }, "after": { "commit": "<sha>" },
    "load1min": { "<run label>": number, … },
    "swiftshader": { "<metric>": { "before": [number…], "after": [number…], "unit": "…", "source": "…" }, … },
    "hardware": { "measured": false, "reason": "…" } | { "<metric>": { …as above… } , "renderer": "…" },
    "conditions": { "browser": "…", "renderer": "…", "viewport": {…}, "hardware": "…" } }
  ```
  - `swiftshader` has at least these metrics:
    - `tickMsMean` (harness, baseline 1×);
    - `nativeStepMsMedian` (frame_cost_probe);
    - `renderIntervalMedianMs` and `renderIntervalP95Ms` (baseline 1×, baseline 20× and stress);
    - `frameBytes` (baseline 20×);
    - `transferBytesPerS` (baseline 20×, measured as bytes received per wall second);
    - `pausedFramesPerS` and `pausedBytesPerS` (paused_probe);
    - `presentationLagMsMedian` (1× and 20×).
  - A metric with no "before" value (presentation lag: before the epic there was no presentation stage) has `"before": null` and a `"note"`.
- **Docs.**
  - `docs/known-issues.md` lists e2, e3, i1, i2, i4 and i5 as resolved, and nothing resolved as open.
  - `docs/performance.md` gets the epic table: each number in it appears in the JSON.
  - `docs/verification/motion-005.md` lists the 12 flow × speed cases with their screenshot files, which exist.
  - `docs/demo.md` describes the pause (quiet), the smooth motion, the consequences and the character in the steps where a user meets them.
- **Supersession log.** Every row S1…Sn in `.wdd/memory/supersessions.md` names:
  - the frozen file with a 64-hex sha256;
  - the test;
  - the pinned behaviour;
  - why it is unwanted;
  - the replacing tests.

  Each named test is `test.skip` in that file, with a comment that points to `supersessions.md`. The authorization paragraph names the user's task file.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `flow_junction_crossing` (e2e, River City, zoom ≥ 1.5 px/m; for m = 1 and m = 20) | Follow a moving car whose `trackedRoute` has ≥ 2 links. Sample `{t, trackedDraw, trackedMarker, trackedScreenCenter, trackedRoute}` on every animation frame until the car has entered ≥ 1 new link, for up to 40 s wall; if the car is gone, follow another (≤ 4 cars).<br>• ≥ 1 link change; every link entered is next on the remaining route (in the previous frame's route after its first link, or the first link of the route at that frame: rerouting is allowed), and never one visited before;<br>• on one link, ŝ never drops by more than 0.05 m;<br>• between successive samples the drawn world position moves at most the motion bound (also across the link change);<br>• the brackets stay on the car (marker ≤ 1.5 px from `trackedScreenCenter`).<br>Screenshots before and after the crossing; the samples are attached. |
| 2 | `flow_queue_forms_and_releases` (e2e, River City) | **Form:** close the Main Bridge, run at 20× until `queuePins()` has ≥ 1 pin with queued ≥ 10 (≤ 20 sim min); pause and zoom ≥ 3 px/m at the longest pin. **Observe at m = 1, then m = 20** (running): for 3 s wall each, on every animation frame, every queued car on that pin's link (from `frameVehicle`) is drawn by `vehicleDraw` at ŝ ≤ its `stop` + 0.05 (held behind the stop line, never in the junction), and ≥ 20 frames at each speed have ≥ 1 queued car on the link. That keeps the check from being vacuous; the queue may drain at 20×. Per-car backward steps need trip identity and are motion-002 test 7's job. **Release:** reopen at 20×. Within 15 sim min, the summed `linkQueued` over the links that had pins at the reopen drops to ≤ 50 % of its value at the reopen, and the closure ring is gone (`closureSigns()` empty). Screenshots: the formed queue (zoom ≥ 3 at the pin) and the released road. |
| 3 | `flow_close_and_reopen_main_bridge` (e2e, River City; m = 1, then m = 20) | At each speed:<br>• **Close** with the button. Within 2 s wall `closed` contains both central links; `closureSigns()` has a ring within 2 px of each central link's drawn midpoint; `interventions()` gains an entry of kind `close` labelled "Main Bridge" at a tick ≥ the tick before the click; the timeline gains a `.timeline-intervention` marker.<br>• **Run** (at 20× in both cases for ≥ 300 ticks): the vehicles on the central links (`linkCounts`) never increase after the close tick is applied, and reach 0.<br>• **Reopen** with the same button: within 2 s `closed` lacks the central links, `closureSigns()` is empty, and `interventions()` gains an entry of kind `open` labelled "Main Bridge", with one more `.timeline-intervention` marker.<br>Screenshots of the closed and the reopened bridge. |
| 4 | `flow_pause_inspect_resume` (e2e, River City, zoom ≥ 1.5; m = 1 and m = 20) | Run at m, pause (Space).<br>• **Quiet pause:** over 2 s wall `framesReceived` grows by ≤ 2, `tick` is unchanged and `renderFrames` grows by ≥ 30.<br>• **Inspect:** click a road, so `selectedLink` is set and the *Selected road* panel shows it; Escape. Click a car, so `trackedTrip` is set and `trackedMarker()` is ≤ 1.5 px from `trackedScreenCenter()`. Over 1 s, `trackedDraw().world` moves ≤ 0.01 m (paused).<br>• **Resume** (Space): within 3 s wall `tick` advances, and the tracked car's progress (ŝ, or a later route link) increases, with no backward step and every step within the motion bound.<br>Screenshot of the paused inspection. |
| 5 | `flow_rewind_and_branch` (e2e, River City; m = 1 and m = 20) | Run at m for ≥ 3 s wall, pause, and press "−1 min" once, sampling on every animation frame for 1.5 s from the click. **No stale motion:** on every sample after the new frame arrived (≥ 10 samples; tick < the tick before; one frame, paused):<br>• `presentation.tickA` equals that tick (the presentation stands on the new frame);<br>• ≥ 95 % of the sampled cars (up to 40 with a screen position) are drawn on their new record's link with |ŝ − s| ≤ 15 m (the end-zone compression);<br>• no car's drawn position moves by more than 0.01 m.<br>A presenter that kept history from before the seek would animate cars from their old places. Oracles that use `drawAt` need the presenter's own ŝ, so they would be circular. **Branch:** focus the slider and press `b`. This is a decision in the past: it toggles the Main Bridge, which creates branch B there (demo step 4). `scenario` becomes "B" and `branchTick` = the position tick. **Resume** at m: B's tick advances, and the tracked-car rule of test 1 holds over 3 s wall for a followed car on B. Screenshot after the branch. |
| 6 | `flow_side_by_side_compare` (e2e, River City; m = 1 and m = 20) | The demo's flow: close the Main Bridge on A at 20×, run ≥ 600 ticks, pause, press "−1 min" once (still after the closure), press `b` on the slider (B reopens the bridge there), and press "Compare side by side". At m = 1 and at m = 20, for 3 s wall each:<br>• on every animation frame, `sides.a.tick === sides.b.tick` and the drawn cameras are equal;<br>• `diagnostics().presentation.tickA === tickB` on ≥ 95 % of the frames.<br>Then:<br>• `comparison()` has `tick` = both sides' tick, metrics arrays of equal length, and `crossings` with a non-negative `baseTick`;<br>• the decision shows: `sides.a.closed` contains the central links (A kept the closure) and `sides.b.closed` does not (B reopened);<br>• the comparison panel shows incomplete and unserved trips.<br>Screenshot of the comparison. |
| 7 | `epic_wiring_and_docs` (vitest, static) | **Supersessions:** every row S1…Sn of `supersessions.md` has a file with a 64-hex sha256, a test name, a pinned behaviour, a reason and a "Replaced by" cell, all non-empty. Each named test is `test.skip(` in that file within 3 lines after a comment that mentions `supersessions.md` (or the skip line mentions it). The authorization paragraph names `task-2026-10-11-motion-paused-consequences.md`.<br>**Known issues:** the lines for e2, e3, i1, i2, i4 and i5 each contain "resolved" (case-insensitive), and no line says one of them is open.<br>**WDD state:** the frontmatter status of wards motion-001…004 is "complete"; `CONTEXT.md` mentions motion-005.<br>**Verification doc:** `docs/verification/motion-005.md` names each of the six flows at "1×" and at "20×", and every `.png` it links exists under `docs/verification/motion-005/`. |
| 8 | `epic_measured_before_and_after` (vitest, static) | `web/perf-results/motion-epic-before-after.json` follows the schema:<br>• `before.commit` is "19e9fbf"; `after.commit` is a hex sha of ≥ 7 characters;<br>• `swiftshader` has every required metric, each with `before` and `after` arrays of ≥ 2 finite numbers (interleaved runs), or `before: null` with a `note` for presentation lag only;<br>• `conditions.renderer` contains "SwiftShader";<br>• `hardware` is either `{measured: false, reason}` with a reason of ≥ 20 characters, or holds metrics whose renderer does not contain "SwiftShader";<br>• `load1min` has an entry per run.<br>`docs/performance.md` has a section "Epic motion: before and after" that links the JSON and has a table row whose first cell names each of `renderIntervalMedianMs`, `frameBytes` and `pausedFramesPerS`; every number in that row's value cells (after the first cell) equals a value in the JSON (to 1 decimal). |

## Red phase: what fails before Gold
- **Tests 7 and 8 fail** until Gold has written the verification doc, the measurement JSON and the epic section in `docs/performance.md`.
- **Tests 1–6 are integration tests of behaviour the epic already built, so they are expected to pass on the current code.** What makes them meaningful is that each fails when a resolved defect comes back. The Red reviewer checks this with mutations:
  - test 1 and test 5 (resume on B) fail if the junction jump comes back, for example presentation off, so cars are drawn at their frame records;
  - test 4 fails if paused frames are posted again (motion-001);
  - test 2 fails if held cars are drawn past the stop line (motion-002);
  - test 3 fails if the closure ring or the intervention entry is missing (motion-003/004);
  - test 5 fails if the presenter keeps the history across a seek;
  - test 6 fails if A and B get separate presentation times.

## Must NOT
- Change product behaviour without a failing regression test that names the ward the defect belongs to.
- Change, skip or supersede any frozen test (no user authorization in this ward).
- Present SwiftShader numbers as hardware performance, or claim an improvement without a before/after measurement.
- Deploy (the user's task: "Do not deploy unless separately authorized").
- Commit test-results, videos or temporary configs.

## Must DO
- Run the full suites (Rust `cargo test --workspace`, clippy, vitest, the full e2e) and the six flows at both speeds.
- Run the epic's before/after measurements interleaved, and record the load.
- Attempt one headed hardware-GPU run of the baseline. If it is not possible, record why.
- Update `docs/known-issues.md`, `docs/performance.md`, `docs/demo.md`, `docs/verification/motion-005.md`, `CONTEXT.md` and the epic file.
- Check that GitHub Actions is green on the pushed commit (the epic's completion criterion).

## Manual Smoke Test
### Setup
`pnpm -C web build:wasm && pnpm -C web dev`, then open the app at 1280×800 in Playwright. Use a headed browser on the GPU if available, and SwiftShader otherwise; say which.

### Steps
1. **At 1× and at 20×, record a short video** (Playwright `video: 'on'` or successive screenshots ≥ 10 per second) of a followed car crossing a junction. Cars glide through the curve, with no jump, no backward step and no car waiting inside the junction.
2. **Close the Main Bridge.**
   - At 20× queues form: pins appear and the cars in a queue can be counted at close zoom.
   - Reopen: the queues drain and the ring goes.
3. **Pause.**
   - The Diagnostics panel shows no frame traffic while paused.
   - Hover and select a road, and follow a car: everything responds.
   - Resume: motion continues smoothly.
4. **Rewind 2 minutes and branch.** No car smears or jumps on the seek.
5. **Compare side by side.** Both maps move together, and the metrics and crossings read at the same sim time.
6. **Read `docs/verification/motion-005.md` and the epic table in `docs/performance.md`:** they match what you saw.

### Pass criteria
- [ ] All six flows behave as described at 1× and at 20×, confirmed by recordings or successive frames, not stills.
- [ ] The measurements are interleaved before/after, with SwiftShader and hardware apart.
- [ ] All suites are green locally and on GitHub Actions.

## Verification
The Red gate approves tests 1–8. Gold makes them pass, with product fixes only through failing regression tests. Gold also records the measurements and the docs and runs every suite. The Gold reviewer reruns the flows, performs the smoke test (with a recording) and checks the integration: no orphaned exports, no hooks without consumers, no UI control without effect.
