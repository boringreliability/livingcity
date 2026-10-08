---
ward: 3
revision: null
name: "Timeline in the worker and UI"
epic: "timeline"
status: "red"
dependencies: ["timeline-002"]
layer: "fullstack"
estimated_tests: 18
created: "2026-10-08"
completed: null
---
# Ward timeline-003: Timeline in the worker and UI

## Scope
This ward implements contract **T3** (`.wdd/epics/timeline.md`). It wires timeline-001/002 into the wasm `Sim`, the worker host and the UI, which makes these user actions possible:
- **Scrub backwards and forwards** through the retained window, which is shown together with its memory budget.
- **Create scenario B** by intervening in A's past. A is preserved, and if a B already exists the user confirms "Replace the branch".
- **Switch the viewed scenario** (A / B) and **discard B**.

Only the viewed scenario runs. timeline-004 adds lockstep, the split view and the comparison panel.

## Inputs
- From sim-core: `Timeline` (`step_n`, `seek`, `schedule`, `branch`, `window`, `world`), `WindowMetrics` and `SNAPSHOT_INTERVAL_TICKS`.
- From sim-wasm: `Sim` (frame encoding, inspection, trip tables).
- From the host: `createSimHost` (chunked warm-up, deferred commands, `SimClock` with `resetExecuted` / `resync`, inspection, perf).
- From the UI: `App`, `ControlPanel`, `MetricsStrip`, `Legend`, `testHook`, `FIT_INSETS` (bottom band 120 px).

## Outputs
**sim-wasm `Sim`**
- `Sim` wraps a `Timeline` instead of a `World`. The constructors use `REPLAY_BUDGET_BYTES = 48 MiB`. Every read uses `timeline.world()`, and `step(n)` is `timeline.step_n(n)`.
- `close_link` / `open_link` schedule at the position through `Timeline::schedule`, which edits the future below the head (T1).
- New methods:
  - `seek(tick: u32) -> bool`: false outside the window, with nothing changed. On success it clears the retained frame trip tables.
  - `timeline_info() -> Vec<f64>`: `[window_start, head_tick, position_tick, snapshot_bytes, budget_bytes, snapshots]`.
  - `branch(at: u32) -> Result<Sim, JsError>`: an independent `Sim`. It shares the static network export, landmarks and zones, starts with empty frame state, and uses the same budget.
  - `window_metrics(from: u32) -> Vec<f64>`: `[from, to, generated, completed, removed_unreachable, removed_gridlock, incomplete, mean_s | NaN, p95_s | NaN]`.

**Protocol (`protocol.ts`)**
- `ToWorker` gains:
  - `seek { tick }`: applies to the viewed scenario;
  - `branch { fromTick, then?: { kind, link }[] }`: creates or replaces B from A at `fromTick`, applies `then` to B, and makes B viewed;
  - `viewScenario { scenario: 0 | 1 }`;
  - `discardBranch`.
- `FrameMessage` gains:
  - `scenario: 0 | 1` (the viewed one);
  - `timeline { windowStartTick, headTick, positionTick, branchTick, snapshotBytes, budgetBytes }`, all numbers, with `branchTick = -1` without B.
- `REPLAY_BUDGET_BYTES = 48 * 1024 * 1024` is mirrored in TS.

**Host (`host.ts`)**
- The host holds `scenarios: [A, B?]` and `viewed`. Each scenario has its own position, so it also has its own executed ticks, which the clock reflects for the viewed one.
- **`seek`:**
  - pauses (`setRunning(false)`) and calls `sim.seek(tick)`;
  - on success: `clock.resetExecuted(tick)`, `resync()`, the perf window is reset, the inspected vehicle is cleared, and a frame is posted at once;
  - on failure: `error("seek outside the replay window: …")`, with no change.
  - During the warm-up, `seek`, `branch` and `viewScenario` are refused with an error, like commands before init.
- **`branch`:**
  - creates B with `A.sim.branch(fromTick)` (refused outside A's window, with an error);
  - applies `then`, sets `viewed = 1`, pauses, sets `branchTick = fromTick`, resets the clock to B's tick, and posts a frame.
  - An existing B is replaced. The confirmation is the UI's job.
- **`viewScenario`:**
  - switches the viewed scenario; the scenario left behind keeps its position, frozen;
  - pauses, resets the clock to the newly viewed scenario's tick, clears inspection, and posts a frame.
- **`discardBranch`:** drops B, views A, and sets `branchTick = -1`.
- **`command`** applies to the viewed scenario: at A's head it is ordinary, and in B it may edit B's future. The UI never sends a command for A below its head; it sends `branch` instead. The host refuses one with an error, so A can never be edited in the past.

**UI**
- **`TimelineBar`** (new component) sits in the bottom band, full width under the metrics strip and legend; those two move up so they still clear the city. It contains:
  - a track drawn from `windowStartTick` to `headTick`, with the retained range shaded, a playhead at `positionTick`, a head marker and a branch marker;
  - sim-time labels for the window start, the playhead and the head (`hh:mm:ss`, labelled "sim time");
  - memory text `"<x.x> / 48 MiB replay memory"`;
  - buttons "Jump to start", "−1 min", "+1 min" and "Live" (jump to the head);
  - the track itself: `role="slider"`, accessible name "Timeline", `aria-valuemin` / `aria-valuemax` / `aria-valuenow` in ticks, `aria-valuetext` "sim time hh:mm:ss".
    - Keys: ←/→ move ±120 ticks (1 sim min), Home jumps to the window start, End to the head.
    - Pointer: a click or drag seeks, throttled to at most one seek per 100 ms while dragging, and a final seek on release.
- **Scenario control** (when B exists): two toggle buttons "A: original" and "B: branch from hh:mm:ss" (`aria-pressed`), and a "Discard branch" button.
  - The viewed scenario is also named in a pattern-framed label on the canvas corner, "Viewing A: original" or "Viewing B: branch". The label is text and pattern, never hue.
- **Interventions in A's past.** "Close the main bridge" (button or B key) and the road panel's Close/Reopen, while A is viewed with position < head:
  - **without B:** they send `branch { fromTick: position, then }`;
  - **with B:** an inline confirmation (not a native dialog) asks "Replace the branch?" with the buttons "Replace the branch" and "Cancel". Replace sends `branch`; Cancel does nothing.
- **DOM order.** The timeline bar and the scenario control come **after** the legend in the DOM. The frozen Tab-budget tests (Follow within 25 Tabs, Legend within 30) must keep passing.
- **Test hook additions:**
  - `snapshot().scenario` (`'A' | 'B'`);
  - `snapshot().timeline` (the frame's six numbers);
  - `snapshot().branchTick` (`number | null`);
  - `seekForTest(tick)`, which sends a `seek` exactly as the slider would. It is test-only: it lets e2e tests seek to an exact tick (for example back to an old head) to check determinism.

## Specification
- **Seek semantics** follow T1. A seek never advances the head. Playing from a position below the head replays deterministically, and reaching the head continues as live.
- **Scrubbing past the window start** is impossible: the slider minimum is `windowStartTick`, and the host refuses it anyway.
- **Data budget.** No frame carries more than before plus the numeric `timeline` object. `window_metrics` is not sent in this ward (timeline-004).
- **Performance.** `sim.seek` in wasm must stay under 20 ms median at a full 48 MiB window, and `sim.branch` under 40 ms; both are measured in the Gold smoke test. A drag never queues more than one pending seek: the UI throttles, and the host handles messages in order.
- **Colourblind.** Every scenario cue (A/B buttons, corner label, branch marker) uses text and shape. The branch marker is a diamond with a label.

## Tests
- Vitest (host on real wasm, fake clock): `web/tests/timeline.test.ts`, tests 1–10.
- Playwright: `web/e2e/timeline.spec.ts`, tests 11–18.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `seek_restores_and_pauses` | after running to about 1,000 ticks at 60×, `seek(500)` gives a frame at tick 500, paused, with `timeline.positionTick` 500 and `headTick` ≥ 1,000. The sim's state hash equals a fresh `Sim` stepped to 500 |
| 2 | `seek_outside_window_is_refused` | `seek(head+1)` produces an error message, no change to the next frame's tick or timeline, and stays paused |
| 3 | `frames_carry_timeline_numbers` | every frame has `scenario` and numeric `timeline` fields with `budgetBytes` = 48 MiB, `snapshotBytes` ≤ budget, start ≤ position ≤ head, and `branchTick` = −1. The frame payload rule holds (numbers or typed arrays only) |
| 4 | `seek_resets_clock_and_inspection` | after a seek: `clock.executedTicks` = tick, backlog 0, `tracked` null, and an `inspectVehicle` with a pre-seek `frameTick` resolves nothing |
| 5 | `replay_after_seek_is_identical` | hashes recorded on the way to 1,200 equal those after `seek(400)` and replaying to 1,200 |
| 6 | `branch_preserves_a` | at A position 800 (head 1,200): `branch { fromTick: 800, then: close main }` makes frames `scenario 1`, `branchTick 800`, main closed. `viewScenario 0` shows A at 800 with head 1,200 and A's hash unchanged, and A's main bridge is open |
| 7 | `command_on_a_below_head_is_refused` | a `command` while A is viewed below its head is refused with an error and does not change A's command log or head |
| 8 | `command_on_b_edits_b` | in B, seeking back and closing a road sets B's head to the position. A is untouched |
| 9 | `discard_and_replace_branch` | `discardBranch` returns to A with `branchTick` −1. A second `branch` replaces B; frames show the new `branchTick` |
| 10 | `timeline_messages_during_warmup_are_refused` | `seek`, `branch` and `viewScenario` before `ready` produce errors and are not applied after the warm-up |
| 11 | `timeline_bar_shows_window_and_memory` (e2e) | after load: a slider named "Timeline" with `aria-valuemin` = `windowStartTick`, `aria-valuemax` = `headTick`, `aria-valuetext` containing "sim time", and the memory text matching `/\d+(\.\d)? \/ 48 MiB/`. The bar does not cover the city (canvas hit tests at the city's bottom edge) |
| 12 | `keyboard_scrub` (e2e) | focusing the slider and pressing ← pauses, and the position goes down by 120. → goes back up, Home jumps to the window start, End to the head |
| 13 | `pointer_scrub` (e2e) | a click at 25 % of the track seeks to within ±2 % of that tick. A drag issues seeks while moving and ends at the release point |
| 14 | `play_from_the_past_replays_then_continues` (e2e) | after seeking 2 min back and pressing Play, the position passes the old head and the head grows. The metrics at the old head equal those recorded before (determinism) |
| 15 | `close_in_the_past_creates_branch` (e2e) | seeking back and pressing "Close the main bridge" shows the scenario control with "B: branch from hh:mm:ss" pressed, and the corner label "Viewing B: branch". `branchTick` = the seek position, and the bridge is closed in B. Switching to A shows A's bridge open at its own position |
| 16 | `replace_branch_needs_confirmation` (e2e) | with B present, viewing A in its past and pressing B shows the "Replace the branch?" confirmation. Cancel leaves B unchanged; "Replace the branch" makes a new B at the new tick. No native dialog appears |
| 17 | `discard_branch` (e2e) | "Discard branch" returns to A's view: the scenario control is gone and `branchTick` is null |
| 18 | `timeline_is_keyboard_and_label_accessible` (e2e) | the slider and the timeline buttons are reachable by Tab and have accessible names. The A/B buttons use `aria-pressed`. The corner label is text |

## Must NOT
- Edit scenario A in its past.
- Send window metrics or per-frame JSON.
- Use native `confirm` or `alert`.
- Break earlier tests. Frozen tests stay unchanged; the timeline bar must not cover the points the earlier e2e tests click.

## Must DO
- Seek ≡ replay (determinism, verified through the wasm hash).
- The memory window is visible.
- The keyboard-operable slider.
- Update CONTEXT and the epic table.

## Manual Smoke Test
### Setup
```
pnpm -C web build:wasm && pnpm -C web dev
```
### Steps
1. Open the app and watch the timeline bar. Verify: the window grows, the memory text rises towards 48 MiB, and the labels say "sim time".
2. Drag the playhead back about 5 minutes. Verify: the city shows that moment, paused, and the metrics match.
3. Press "Close the main bridge". Verify: B is created, labelled "Viewing B: branch" (with a pattern frame), and the bridge is closed. Switch to A: it is still open at its own time.
4. Go further back in A and press B. Verify: the inline "Replace the branch?" appears. Cancel, then do it again and replace.
5. Discard the branch.
6. Measure the wasm seek and branch time in the console (diagnostics or `performance.now` around the messages). Verify the bounds in § Specification.
### Pass criteria
- [ ] All suites green, clippy clean, build OK
- [ ] The smoke steps behave as stated
- [ ] Seek < 20 ms median and branch < 40 ms, measured

## Verification
The Gold reviewer runs everything, performs the smoke test with Playwright MCP (screenshots in colour and grayscale), and verifies that A is never edited in its past (code plus a probe).
