---
ward: 1
revision: null
name: "Quiet pause and bounded buffer reuse"
epic: "motion"
status: "complete"
dependencies: []
layer: "typescript"
estimated_tests: 8
created: "2026-10-12"
completed: "2026-10-12"
---
# Ward motion-001: Quiet pause and bounded buffer reuse

## Scope
Contract **M1** of epic `motion`. While paused the engine stops doing unnecessary work, and frame buffers are reused within a fixed bound and safely across scenario changes. Resolves backlog e2 (paused frames), e3 (pool reuse) and k9 (late B returns), and the pause half of the user's task §2. Facts: `.wdd/memory/investigation-2026-10-12.md` § "Paused work and pools".

## Measured basis (before)
`web/perf-results/paused-before.json` was measured on 2026-10-12 at commit 19e9fbf: 1280×800, SwiftShader, load ~10. The frames and bytes are those received by the UI.

| Paused, after a 2 s settle | Frames/s | Bytes/s | Bytes/frame |
|---|---|---|---|
| River City, default demand | 50 | 1.65 MB | 33.0 kB |
| `?demand=5` | 49.8 | 5.03 MB | 101 kB |
| Comparing (A + B) | 100.3 | 3.30 MB | 32.8 kB |

## Inputs
- `web/src/sim/host.ts`:
  - `iterate`, a post every 16 ms with no running or dirty check;
  - `handle`;
  - `postFrame` and `postPair`;
  - the pools `pools[side]`, with exact-size `find` and `pools[side] = []` on every post;
  - the clears on init, compare off, branch and discard.
- `web/src/sim/clock.ts`: `report` pushes on every iteration, and `status` is the only place the window is trimmed.
- `web/src/sim/worker.ts`: a 4 ms `setTimeout` loop.
- `web/src/sim/client.ts`: `returnBuffer`, and a `Worker` created inside.
- `web/src/sim/protocol.ts`: `FrameMessage` and the `returnBuffer` message.
- `web/src/App.tsx`: `applyFrame`/`applyFrameB` return each frame's buffer with its side.
- The test hook (`ui/testHook.ts`).

## Outputs
- **Quiet pause (host).**
  - A handled message, except `returnBuffer`, marks the host *dirty*. Ignored and no-op messages count too.
  - `iterate` posts a frame (a pair while comparing) while running (as before, at most every 16 ms, whether or not a tick ran in that interval) or when it is dirty. A post clears dirty, but a post made inside a handler does not, so a frame from `iterate` always follows a handled message.
  - **Settling frame.** One settling frame is posted once the clock's achieved-rate window (1 s) has emptied after a pause, so the shown achieved speed reads 0.
  - **No idle posts.** Otherwise a paused, clean host posts nothing and calls `encode_frame` zero times. Comparison messages keep their rules: on pause, on compare-on, on seek, and every 500 ms while stepping.
- **Bounded clock window.** `SimClock.report` trims its window itself, so it is bounded whether or not `status()` is called. A read-only `windowSize()` exposes the count.
- **Bounded, safe pools.**
  - **Cap and order.** Each side keeps a LIFO pool of at most `POOL_MAX = 4` buffers. A post takes the most recently returned buffer of exactly the needed size and removes it; the rest stay, up to the cap, and the oldest are dropped first.
  - **Never reused:**
    - a buffer with `byteLength` 0 (detached or empty), or of a wrong size;
    - any buffer returned with a stale world.
  - **World generations.** Every frame carries `world`, a generation number per side. It changes on init, when B is branched or replaced, and when B is discarded. The client remembers, for each buffer it delivered, its frame's `world`, and adds it to `returnBuffer` (App already passes each frame's `scenario`), so App's calls stay unchanged.
  - **Pool clears.** A pool is cleared when its side's world changes, and B's pool when compare is left. A `returnBuffer` with no `world` (older tests, fakes) counts as the current world.
- **Testable client.** `createSimClient` accepts an optional worker factory.
- **Diagnostics while paused.** The Diagnostics panel's render rows (interval and draw) refresh from the UI's own timer (≈ 2/s, the existing `RENDER_STATS_REFRESH_MS`), not only when a worker frame arrives. Without that, the frozen `city.e2e.spec.ts` `diagnostics_panel_toggle` (lines 126–135: the paused render row follows the hook) would break once paused frames stop.
- **Implementation note.** The frozen `polish005` test 7b's regex pins the client's literal `send({ type: 'returnBuffer', buffer, scenario }`, so `world` has to be added inside `send` or a wrapper, not in that literal.
- **Test hook.** `snapshot().framesReceived` counts the frames the UI received, for both sides.
- **Measured after.** `web/perf-results/paused-after.json`, from the same probe under the same conditions, is cited in `docs/performance.md`.
- **Supersessions.** Logged in `.wdd/memory/supersessions.md` (see below).

## Supersessions (authorized 2026-10-11; the valid intent moves to this ward's tests)
| Frozen test | Pinned (unwanted) | Valid intent kept by |
|---|---|---|
| `web/tests/review2.test.ts` G4 (line 121: ≥ 95 frames in 100 paused iterations) | Full frames every 16 ms while paused | Test 4 (tick unchanged while paused, a closure while paused applies at the first resumed tick, ≤ 4 ticks, no error) and test 2 (a frame after each message) |
| `web/tests/review3.test.ts` G4b (line 122: ≥ 9 frames in 10 paused iterations) | The same | Test 4 (no paused frame shows the closure) |
| `web/tests/review2.test.ts` G8 (a returned buffer that fits a later frame, but not the next one, is never used) | "Drop the whole pool on every post", which prevents bounded reuse | Test 6 (bounded LIFO pool, no unbounded growth, no wrong-size or detached reuse) and test 7 (no reuse across worlds) |

Kept frozen, and must stay green:
- `host.test.ts` F6 (`byteLength === count·16`, content equals an unpooled twin);
- `polish005.test.ts` tests 6, 7 and 7b;
- `polish006.test.ts` tests 4 and 4b;
- `compare.test.ts` test 9;
- `timeline.test.ts` tests 2, 4 and 8;
- `gold_fixes` F1;
- `gold_city003` m8;
- `host.test.ts` F3;
- `city.e2e.spec.ts` `diagnostics_panel_toggle` (the paused render row follows the measurement).

## Specification
- **Dirty.** Every `handle(msg)` except `returnBuffer` sets dirty, also when it errors or is ignored. Warm-up is unchanged: frames come after `ready` as before.
- **Settling.** The settling frame is due at `pauseTime + WINDOW_MS + 16 ms`, and is sent once per pause.
- **Pool cap.** The cap of 4 per side keeps memory bounded: at most 4 × frame size per side.
- **No sim change.** The golden hashes hold. Commands keep their timing: scheduled at the current tick and applied at the next step.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `paused_host_is_quiet` (vitest, host on wasm, fake clock, `encode_frame` counted through a Proxy) | Single view and comparing: once the settling frame has passed after a pause, 300 iterations of 4 ms post no frame or pair, no comparison, and make 0 `encode_frame` calls. The tick is unchanged. |
| 2 | `every_handled_message_gets_a_frame_then_quiet` (vitest) | Paused: for each of close, open, `setSpeed`, `inspectLink`, `inspectVehicle`, a redundant `setRunning(false)`, `viewScenario(0)` and seek, one iteration yields ≥ 1 frame. The next 100 iterations yield none. While comparing, an ignored `inspectVehicle` yields a pair, then quiet. `returnBuffer` yields no frame. |
| 3 | `pause_settles_achieved_speed_to_zero` (vitest) | Running at 60×, then paused: within 1.2 s of fake time a frame arrives with `clock.running === false` and `achievedTicksPerS === 0`. At most 3 frames arrive between pause and settle, and none in the next 2 s. |
| 4 | `closure_while_paused_applies_at_the_first_resumed_tick` (vitest; the valid intent of G4/G4b) | Paused, close both Main Bridge links. The frames that answer the commands have the paused tick, and `closed` excludes both links. After resume, the first frame with a new tick is ≤ 4 ticks later and contains both links. No error. |
| 5 | `clock_window_is_bounded_without_status` (vitest, SimClock) | 100,000 paused `plan()` + `report(0)` at 4 ms with no `status()`: `windowSize()` ≤ 300. After `setRunning(true)` and 2 s of running at 20×, `status().achievedTicksPerS` is within ±2 of 40. |
| 6 | `pool_is_bounded_lifo_and_safe` (vitest) | Paused, constant frame size: a 0-length and a wrong-size buffer are returned, then 10 buffers of exactly the frame size (side A, current world). The next 10 message-driven frames carry exactly returned #10, #9, #8 and #7, in that order (the kept 4, newest first), and then none of the returned buffers. None is used twice without being returned again. The 0-length and wrong-size buffers are never reused. There are no errors. The frame size always equals `count·16`. |
| 7 | `returns_from_a_replaced_world_are_never_reused` (vitest: host, and the client with a fake worker) | **Host:** buffers returned with B's old `world` after a branch replace, or after a discard followed by the same branch again (same sizes), and buffers of either side returned with the old world right after a re-init, never appear in a later frame, even at a matching size. A buffer returned with the current world is reused. Frames carry `world`, which is new for B after a branch or discard and for both sides after init. **Client:** with frames delivered for A (world 3), B (world 7) and then B (world 8), returning the B-world-7 buffer and then the A buffer sends each back with its own frame's side and world: `[B, 1, 7]`, `[A, 0, 3]`. |
| 8 | `paused_app_is_quiet_and_responsive` (e2e) | Default demand, paused, after a 2 s settle: over 3 s, `snapshot().framesReceived` grows by ≤ 1. The paused UI stays responsive: <br>• a wheel zoom changes the camera and `renderFrames` advances; <br>• a hover sets the hovered link; <br>• clicking a road shows "Selected road" with numbers within 1 s; <br>• with the main thread loaded for 2.5 s (~120 ms per frame), the open Diagnostics panel's render p95 matches the hook's (≥ 100 ms) within max(5, 25 %); <br>• Space resumes, and frames flow again (≥ 20 in 1 s). |

## Must NOT
- Edit frozen tests other than the three superseded ones. Superseded tests are marked superseded and replaced as whole tests; their assertions are not weakened in place.
- Change the sim, its hashes or command timing.

## Must DO
- Log the supersessions in `.wdd/memory/supersessions.md` before Red approval, with each file's hash at that time.
- Measure after with the same probe (`paused_probe.mjs` from the Red phase, checked into `web/scripts/` if kept).
- Update `docs/known-issues.md` for e2, e3 and k9, and `docs/architecture.md` § "From epic polish". The ids e2 and e3 must stay in both places, because polish006 test 8 requires them; their status changes to resolved.

## Manual Smoke Test
### Setup
`pnpm -C web build:wasm && pnpm -C web dev`
### Steps
1. Play, then pause. In DevTools › Performance, record 3 s. The worker shows no frame posts after about 1 s, and the main thread shows no `applyFrame` work.
2. While paused: pan, zoom, hover a road, click a road (the panel fills), click a car (the vehicle panel fills).
3. While paused, close the main bridge. "(pending)" shows. Press Play, and the closure applies at once.
4. Branch, compare, pause. It stays quiet. Leave compare and re-enter it, and both sides still draw.
5. Achieved speed reads "0.0× of N×" about 1 s after pausing.
### Pass criteria
- [ ] Paused frame production is about 0 (measured: `paused-after.json`).
- [ ] All interactions still work while paused.
- [ ] All suites are green, and the frozen tests are unchanged apart from the logged supersessions.
