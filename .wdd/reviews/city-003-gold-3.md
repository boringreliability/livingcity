# city-003 Gold review, round 3

**Verdict: REJECTED** (1 MAJOR, 0 BLOCKER)

Reviewer: fresh adversarial Gold subagent (round 3). Implementation = HEAD 2e0175b (round-2 fix commit). Red snapshot = 8522c56.

## Test freeze
`git diff --name-status 8522c56 -- crates/sim-core/tests web/tests web/e2e` shows only **added** files (`web/e2e/gold_city003.spec.ts`, `web/tests/gold_city003.test.ts`). No frozen test changed.

## Commands run
| Command | Result |
|---|---|
| `cargo test --workspace --release` | all green (city_001 28, city_002 12, city_003 5, core_001 20, core_002 24, core_003 36, core_004 5) |
| `cargo test -p sim-core` (debug) | all green (city_002: 4 passed, 8 ignored, the pre-existing release-only tests) |
| `cargo clippy -p sim-core -p sim-wasm --all-targets -- -D warnings` | clean |
| `pnpm -C web build:wasm` / `typecheck` / `build` | OK |
| `pnpm -C web test` | 13 files, 54/54 passed |
| `pnpm -C web e2e` (full suite) | 28/28 passed |
| `playwright test e2e/inspect.spec.ts --repeat-each=10 --workers=4` | **70/70 passed** (incl. 10× test 13 and 10× test 16 under 4-way load) |
| `playwright test e2e/city.spec.ts e2e/review1.spec.ts e2e/review2.spec.ts e2e/gold5.spec.ts --repeat-each=2` | 32/32 passed |
| `playwright test --workers=4 --repeat-each=2` (full suite under load) | 56/56 passed |
| Scratch Playwright measurements (port 5193) | `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/g003c/review.mjs` (modes `play`, `speedup`, `race`, `smoke`) |

## Round-2 findings: status
- **M-A (lurch right after Play): fixed.**
  - Follow at 1×, zoom 2.24, per-rAF camera samples started in the same task as the Play keydown (no sleep), 4 pause/play cycles (pauses 300 ms / 1.5 s / 4 s / 300 ms).
  - First 1.5 s after Play: max step 9.05 / 5.73 / 1.68 / 1.12 px. The first steps are 0.1–0.6 px, with no 10–15 px tick jump. The single 9 px step in cycle 0 is a link change (junction step, m-A from round 2). The −5.7 px backward step in cycle 1 is a deceleration at a tick boundary, an inherent property of linear extrapolation.
  - Frozen test 13: 10/10 in the stress run, plus green in every other run.
  - `extrapolationS` is now used everywhere, and the JSDoc is fixed (m-B from round 2).
- **M-B (in-flight frames resurrect a cleared vehicle): fixed for the case it targets.**
  - Frozen test 16 passed 10/10 under 4-way load and in both full runs.
  - **But the fix introduces a new MAJOR (M-C below).**
- **Regression checks requested:**
  - *Extrapolating at the multiplier when the engine is behind but not yet flagged.* Following at 1× then switching to 60×: no backward steps above 1 px in 3 s. One forward step of 85 px (≈68 m) appears at the switch moment, because the elapsed time since the anchor is re-scaled retroactively at the new multiplier (capped at 2 s). Switching to 5× gives max 8 px. MINOR, see m-1.
  - *Anchor restart on resume vs vehicles drawn.* `setFrame` and `frameRef` update in the same handler. The App loop uses `simPerMs = 0` until the first `running` frame, which is also the frame that restarts the anchor. No stale-anchor jump was seen (data above). OK.
  - *Ignoring tracking after a clear when a new pick follows immediately.* **Broken.** See M-C.

## Findings

### MAJOR

**M-C: A vehicle pick that follows a clear within about one frame is lost, and vehicle inspection then stays dead until that (invisible) trip ends.** Status: (a), a verified defect with a concrete fix.

Mechanism (`web/src/App.tsx`):
- `clearVehicle` sets `awaitingClearRef = true`.
- The flag only resets on a frame with `tracked === null`.
- The worker handles `inspectVehicle{clear}` and the following `inspectVehicle{frameTick, record}` in the same gap between two `postFrame`s. That happens when both messages are posted within one 16 ms frame interval, or are queued behind a busy main thread or a long `sim.step`.
- In that case no null frame is ever posted: the next frame already carries the new vehicle.
- The App ignores every frame from then on, because `tracked` is never null while the worker tracks B.

Consequences:
- No panel, ring or route for B.
- Every later click on a vehicle is also ignored: it only changes the worker's `trackedTrip`, and the frames still carry a vehicle.
- Escape cannot recover, because `trackedRef` is null, so Escape goes to `select(null)`.
- The state clears only when the last-picked trip ends (gone → null frame). At 1× that can be minutes.

Reproduction (`MODE=race` in the scratch script, River City, paused, zoom 1.5, a driving vehicle A tracked):

| Trigger | Lost picks |
|---|---|
| Escape + click on B dispatched in the same task (GAP 0) | 1/1 |
| GAP 10 ms | 2/4 |
| GAP 30 ms | 0/4 |
| GAP 80 ms | 0/4 |
| **Real input** (`keyboard.press('Escape')`, then a real `mouse.click` on B 120 ms later, both issued during a 400 ms main-thread block, i.e. ordinary jank) | **5/5** |
| Control: the same jank without Escape | 0/4 lost |

In every lost case, a further normal click on another vehicle 1 s later also tracked nothing. In 3/5 cases a click after running 5 s more still tracked nothing.

Fix (renderer/App/host, no test change):
- Tag each `inspectVehicle` request (clear and pick) with an increasing `seq`. The host stores it and echoes `trackedSeq` in frames. The App ignores `tracked` from frames whose `trackedSeq` is lower than the last sent `seq`. This removes both the M-B window and this lock.
- A minimal alternative: set `awaitingClearRef.current = false` when a pick is sent (pointer-up → `inspectVehicle`). The old vehicle may then flash for one frame in the clear-then-pick case, but nothing can lock.
- Add a Gold regression e2e: track A, then in one `page.evaluate` dispatch Escape and pointerdown/up on vehicle B. Expect `trackedTrip` non-null and the panel visible within 2 s. Also cover the jank variant.
- There is still no regression test for M-B itself (only the frozen test 16 covers it indirectly). Add one with the same fix.

### MINOR
- **m-1: Speed change re-scales the current extrapolation retroactively.** `simPerMs` is applied to `now − frameAtMs`, so changing speed mid-tick re-scales the elapsed part.
  - 1× → 60× while following produced one forward jump of ~85 px (68 m, within the 2 s cap) before the next tick snapped back to it.
  - 60× → 1× gives the inverse (a backward snap).
  - Fix: restart the anchor when `clock.multiplier` changes, the same way as on resume. Pass the multiplier into `setFrame`, or re-anchor in the App when it changes.
- **m-2 (carried over, round 2 m-A): junction step.** A link change still gives one step of ~5–9 px at zoom 2.24 (measured 9.05 px). MINOR, as judged in round 2.
- **m-3: The behind/extrapolation interaction is only bounded by the 2 s cap.** If a long `sim.step` stalls the worker before `behind` is flagged (1 s grace after setRunning/setSpeed), cars extrapolate at the full multiplier for up to 2 s of sim time and then snap back. This was not observed in my runs (`behind` was never raised at 60× on this machine). Note it, and consider capping `dtSim` at about 1.5 × the expected inter-frame advance.

## Manual smoke test (Playwright, screenshots in `.playwright-mcp/city003-g3-*.png`)
1. **Car on the Main Bridge:** trip #777 on link 284.
   - Panel: "Trip #777: Old Town → Tech Park, ▶ driving, 48 km/h, on trip 1:36, link 284, route changes 0, Follow".
   - Ring and dashed route visible (`02-main-bridge-car.png`).
   - Follow at 1× for 4 s: the tracked car sits 0.5–0.8 px from the canvas centre (`03-follow-1x.png`). **Pass.**
2. **Approaching car, then close the Main Bridge:** trip #486 (Riverside → St. Mary's Hospital), route `[38, 284, 172, …]`, route changes **0**.
   - After the closure: route `[38, 135, 133, 131, 288, …]` (via the Old Bridge), route changes **1**.
   - The dashed line now turns south before the closed (hatched) bridge (`05-rerouted.png`). **Pass.**
3. **Old Bridge (link 288):**
   - Capacity 900 veh/h (≤ 900).
   - After the closure: travel time now 72.2 s > free flow 52.2 s (`06-old-bridge.png`). **Pass.**
4. **Grayscale:** the ring (white outline) and the dashed near-white route are luminance-distinct from the grey roads. The closed bridge uses a hatch pattern. **Pass.**

## Checks that passed
- No Rust change since round 2. Determinism, `state_hash` and the sim-core API are unchanged.
- Picking uses the same `extrapolationS` anchor as the shader and Follow.
- Escape on a focused button still clears the vehicle first and then the road.
- The worktree is clean after the review. Scratch files live only under `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/g003c/`; the screenshots are in the git-ignored `.playwright-mcp/`.
