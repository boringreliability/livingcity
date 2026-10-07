# city-003 Gold review, round 2

**Verdict: REJECTED** (2 MAJOR, 0 BLOCKER)

Reviewer: fresh adversarial Gold subagent (round 2). Implementation = 19ff7cd (fix commit, diff vs f75526d). Red snapshot = 8522c56.

## Test freeze
`git diff --name-status 8522c56 HEAD -- crates/sim-core/tests web/tests web/e2e` shows only **added** files (`web/e2e/gold_city003.spec.ts`, `web/tests/gold_city003.test.ts`). No frozen test was changed.

## Commands run
| Command | Result |
|---|---|
| `cargo test --workspace --release` | all green (city_001 28, city_002 12, city_003 5, core_001 20, core_002 24, core_003 36, core_004 5) |
| `cargo test -p sim-core` (debug) | all green (city_002: 4 passed, 8 ignored, the pre-existing release-only tests) |
| `cargo clippy -p sim-core -p sim-wasm --all-targets -- -D warnings` | clean |
| `pnpm -C web build:wasm` / `typecheck` / `build` | OK |
| `pnpm -C web test` | 13 files, 54/54 passed |
| `pnpm -C web e2e` (full suite, port 5190) | **27 passed, 1 failed**: `inspect.spec.ts › keyboard_escape_order` (frozen test 16), see M-B |
| `playwright test -g keyboard_escape_order --repeat-each=8` | 8/8 passed |
| `playwright test city review1 review2 gold5 inspect --repeat-each=2` | 46/46 passed |
| `playwright test inspect gold_city003 --repeat-each=3` | **23 passed, 1 failed**: `inspect.spec.ts › follow_keeps_vehicle_centred` (frozen test 13): tracked car 15.06 px from the centre, limit 12. See M-A |
| Scratch Playwright measurements (port 5192) | see below. Scripts: `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/g003b/{review,junction}.mjs` |

Across my runs, the frozen e2e tests failed 2 times: test 13 failed once in 6 runs and test 16 once in 14 runs. In round 1 they were 4/4 green. The gate requires all tests green, and that is not reliable at the moment.

## Round-1 findings: status
- **M1 (per-tick lurch while following at 1×): fixed in steady state.**
  - Measurement: per-rAF camera samples at 1× while following trip 414, zoom 2.24, 45 s (1730 steps), starting 500 ms after Play.
  - Median 0.95 px/rAF, p95 0.96, p99 1.43.
  - Tick-boundary steps on the same link (n = 89): median 0.81 px. The only one above 3 px is the second tick after Play (7.5 px), see M-A.
  - No driving stalls longer than 60 ms. One straight junction crossing: 0.3–1.5 px.
  - **But** the transient right after Play is not fixed (M-A).
- **M2 (stale panel): fixed.**
  - Host: an unresolvable pick keeps the current `trackedTrip`.
  - App: a `tracked: null` frame clears `trackedRef`, the ring, the panel and Follow.
  - Repro: I tracked trip 904 and ran at 20×. I blocked the main thread for 600 ms, then clicked: the extrapolated pick now misses, so a road was selected.
  - Over the next 2.4 s the ticks went 524 → 609 and `trackedTrip` stayed 904. The panel updated live ("on trip 1:32 → 2:33 → 2:53", link 284 → 174 → 176).
  - Vitest `fix M2` is meaningful. 30 iterations at 20× is about 19 ticks, more than the 8 retained, so `trip_at_record` returns −1. With the old `trackedTrip = null` line, `now?.tripId` would be `undefined` and the test fails.
- **m1 (picking vs extrapolation): fixed.** `pickVehicle(..., dtSim)` uses the same formula as the shader, `min(s + v·dt, len)`.
  - Consequence: while running, `pickAt(vehicleScreenCenter(i))` (unextrapolated) no longer has to hit `i`.
  - All frozen tests pick while paused (dtSim = 0), so they are unaffected.
  - The ward's Outputs text still says pickVehicle uses "no extrapolation". Update the spec wording (doc drift, nit).
- **m2:** unchanged, which was judged acceptable in round 1.
- **m3 (`blockedTicks * DT`): fixed.**
- **m4 (gone title keeps names): fixed** via `lastTitleRef`.
- **m5 (stranded text): fixed** ("stranded (no way onward)").
- **m6 (Escape on a focused button): fixed.**
  - Escape with focus on "Stop following" cleared the vehicle and Follow.
  - Escape on the Speed select is still ignored, which is correct.
  - Space on a focused Follow button activates the button and does not toggle running.
- **m7 (narrow layout): fixed.** Rects:
  - 520 px: controls 16–302 × 16–116, side 16–256 × 150–326, no overlap.
  - 375 px: side 16–256 × 150–344, no overlap.
  - 700 px: side on the right.
  - Pre-existing, not this ward: at 375 px the metrics bar (16–499) is wider than the viewport.
- **m8 (init reset): fixed.** Vitest `fix m8` covers it.
- **m9:** not addressed. That is acceptable at this scale.

## Findings

### MAJOR

**M-A: Follow lurches by a whole tick right after Play at 1×, and frozen test 13 is flaky because of it.**

Cause: the render loop extrapolates with `simPerMs = achievedTicksPerS × DT / 1000`. `achievedTicksPerS` is the tick count in the last 1 s window (`clock.status`). After a pause it is **0** until the first tick lands, and then 1 tick/s for the next half second. Since the M1 fix, extrapolation runs for a whole tick, so the rate matters:
- During the first tick after Play, every car (and the followed camera) stands still. Then it jumps one full tick.
- During the second tick, cars move at half speed. Then they jump half a tick.

Measured per rAF, from the moment Play was pressed, at 1× and zoom 2.24, in two runs:
- First tick: **15.4 / 15.8 px** jump (= 13.4 m/s × 0.5 s × 2.24 px/m) at t ≈ 530 ms.
- Second tick: **10.4 / 11.3 px**.
- Normal motion afterwards is about 4–6 px per (slow, ~150 ms) rAF in that run.

The same artefact explains the frozen test 13 failure: "15.06 px from the centre, limit 12".
- Test 13 takes its first sample 500 ms after Play, i.e. at the first tick.
- If the sample lands between the frame's arrival and the next rAF, `trackedScreenCenter()` already shows the new tick while the camera still shows the old position. That gap is exactly one tick of travel, 15 px.

This violates the pass criterion "Follow is smooth (no visible jitter at 1×)" every time the user presses Play. The new `gold_city003` M1 test hides it, because it sleeps 500 ms after Play and tolerates one lurch.

Fix (renderer/App only, no test change): extrapolate at the **target** rate unless the clock reports `behind`.
- For example, in the render loop: `simPerMs = f.clock.running ? (f.clock.behind ? f.clock.achievedTicksPerS * DT : f.clock.multiplier) / 1000 : 0`. Note that `targetTicksPerS × DT = multiplier`.
- Alternatively, measure the rate in the renderer from the arrival times of successive tick changes, initialised to the target rate.
- The 2 s cap already bounds the overshoot when behind.
- Extend the M1 regression test to sample from the moment of Play (no 500 ms sleep) and require no step above `typical × dt + 2.5 m` within the first 1.5 s.

**M-B: Frozen test 16 (`keyboard_escape_order`) failed in the full e2e run.**

What happened: the second Escape left `selectedLink = 284` for 30 s, after the first Escape had cleared the vehicle. It then passed 8/8 alone and 2/2 in the repeat run. My stress scripts did not reproduce it: 40 paused double-Escape sequences and 20 + 40 Escape-while-tracking trials gave 0 failures and 0 resurrections.

The most plausible mechanism is still the one round 1 described:
- Frames are posted every 16 ms, also while paused, and carry `tracked`.
- `clearVehicle` clears `trackedRef` immediately, but the worker learns of the clear only later.
- A frame posted before the worker handles the clear arrives afterwards and sets `trackedRef` again (`else if (f.tracked)`). The M2 fix removes it again only on the next null frame.
- A second Escape inside that window clears the "vehicle" again instead of the road. The panel also flickers back for one frame.
- The window is small, but the full suite runs under load.

Fix:
- Make vehicle-inspection replies unambiguous. Add a request sequence `seq` to `inspectVehicle` and echo it in frames (`trackedSeq`). Alternatively, in the App, after `clearVehicle`, ignore non-null `tracked` until a frame with `tracked === null` (or a new pick's trip) arrives.
- Then stress-run `keyboard_escape_order` (`--repeat-each=30`, under full-suite load) and report the result.
- If the root cause turns out to be something else, find it before the next gate. A frozen test that fails at about 1/14 is not a green gate.

### MINOR
- **m-A: Junction crossing step (asked to judge).**
  - Junction crossings are a step in the drawn path, not jitter. Driving straight through, I measured 0.3–1.5 px.
  - At turns, the drawn centrelines of consecutive links are offset. Over all 576 turn pairs in River City, the drawn end of A to the drawn start of B is median **4.6 m**, max 7.4 m. That is about 10 px (max ~17 px) at zoom 2.24, once per turn. Straight pairs: median 0, max 3.1 m.
  - When a car reaches the end of its link before the next tick, it also stops at `len` for the rest of that tick.
  - Judgement: **MINOR**, not MAJOR.
    - It is a single, explainable step per turn (every ~20–60 s of a route), not periodic jitter.
    - It applies to every car (a core-005 renderer property).
    - It follows from the link+offset model.
    - The ward criterion targets the per-tick lurch, which is fixed.
  - Suggested fix (keeps the car, ring and Follow at one position): draw the tracked vehicle on the CPU path.
    - Skip its instance in the instanced draw, e.g. with a `u_skipRecord` uniform compared against `gl_InstanceID`, or with a flag in the state texture.
    - Draw it with one `trackedWorldPosition` that extrapolates past `len` onto `route[1]` (`s' = s + v·dt − len`).
    - Blend over the last/first few metres around the node with a quadratic curve from A's drawn end, through the node, to B's drawn start.
    - The ring and Follow use the same function.
    - When the next tick puts the car on B at `entry_s ≈ s'`, nothing jumps.
    - Untracked cars can keep the current behaviour.
- **m-B: Stacked JSDoc in `renderer.ts`.** `extrapolationS` was inserted between `trackedWorldPosition`'s doc comment and its function, so the comment "Where the tracked vehicle is drawn…" now sits above `extrapolationS`. `trackedWorldPosition` and the draw loop also repeat the `min(2, max(0, …))` expression instead of calling `extrapolationS`. Move the comment and reuse the helper.
- **m-C: The new M1 regression test is too lenient for the criterion.** Skipping 500 ms after Play and allowing 1 lurch per 2 s let M-A through. See the fix under M-A.

## Checks that passed
- **No wall-clock time in sim-core and no Rust change in this fix commit.** `state_hash` coverage of `removed_log` was confirmed in round 1 and is unchanged.
- **Escape order with focus on buttons.** It works (vehicle first, then road). Space and other shortcuts are still ignored on buttons, so `review1 › fix G1` passes.
- **Extrapolated picking is consistent with the shader** (same `min(s + v·dt, len)` and lane offset). `pickAt` and clicks share `pickVehicleAt`.
- **Grayscale visibility.** In the 375 px screenshot, the ring and the dashed route are visible.
