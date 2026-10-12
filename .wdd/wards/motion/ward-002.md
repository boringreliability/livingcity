---
ward: 2
revision: null
name: "Interpolated motion by identity"
epic: "motion"
status: "planned"
dependencies: ["motion-001"]
layer: "fullstack"
estimated_tests: 10
created: "2026-10-12"
completed: null
---
# Ward motion-002: Interpolated motion by identity

## Scope
This ward is contract **M2** of epic `motion`: cars that are convincing to watch. It resolves:
- **i1:** a car stops at the end of the curve, then jumps;
- **i2:** held cars are drawn inside the junction;
- **i4:** backward steps during steady playback;
- the c2/c3 remainder: discontinuities after a speed change or a delayed frame;
- the motion half of the user's task §1.

The facts are in `.wdd/memory/investigation-2026-10-12.md` § Motion. **This ward does not change the sim.** Held cars already stay on their own link at `s = length`, so i2 is a render choice.

## The model
- **Authoritative state** is the frame records: link, s, v, lane and flags, plus a new parallel `tripIds: Uint32Array`.
- **Presentation time `P`** is a sim time that never runs ahead of the newest authoritative frame.
  - It trails it by a small explicit delay: one tick, or the sim advance between two new-tick frames if that is larger.
  - It advances monotonically at the requested speed. It catches up smoothly if it falls further behind, and it settles on the newest frame when paused.
  - A and B share one `P` while comparing.
- **Interpolation.** Each car is drawn by interpolating between the two retained frames around `P`, matched by trip id, never by record index.
  - A trip that is only in the newer frame appears at its own position.
  - A trip that is only in the older frame disappears.
- **Visual path.**
  - On a link, a car is drawn along its lane up to that link's visual stop line at `length − STOP_M` (`STOP_M` = min(6 m, length / 2)). A car whose interpolated `s` lies beyond the stop line on the *same* link (held, or approaching) is drawn at the stop line.
  - The junction curve (from A's stop line to the next link's start, as today) is used **only** while a car moves between two frames from link A to the link it is on in the newer frame. Progress along A, then the curve, then the new link follows sim distance.
  - If the newer link is not entered from A's end node, the car moved more than one link in one frame (possible at high speed). It is then placed directly, without a fabricated path.
- **History resets.** History is cleared, with no interpolation across the change, when the frame's `scenario`, `world` or compare state changes, or when its tick goes backwards or jumps by a seek. `P` then restarts at the new frame.
- **Not extrapolated.** `P` never exceeds the newest frame. Nothing is drawn beyond an authoritative position, so nothing is drawn through a closure or into a stationary queue.

## Inputs
- motion-001 (quiet pause, `world` generations, `framesReceived`).
- `crates/sim-wasm/src/lib.rs` `encode_frame`, which already builds the per-record trip table.
- `web/src/sim/{host,protocol,frame}.ts` (FrameMessage).
- `web/src/render/motion.ts` (`vehicleDrawPosition`, `extrapolate`, `ExtrapolationClock`).
- `web/src/render/renderer.ts` (`VEH_VS`, `setFrame`, `trackedDraw` / `trackedWorldPosition`, the ring and the route).
- `web/src/render/picking.ts`.
- `web/src/App.tsx`:
  - the render loop with its rate, Follow and `drawnCams`;
  - `applyFrame` / `applyFrameB`;
  - the hooks `vehicleScreenCenter`, `vehicleDraw`, `trackedDraw`, `drawAt`, `trackedScreenCenter`, `pickAt` and `frameVehicle`.

## Outputs
- **Trip ids in the frame.** A frame carries `tripIds: Uint32Array(count)` in record order: a copy from wasm via `Sim.trip_ids()`, the same trip table `encode_frame` already builds. It adds 4 B per vehicle and leaves the 16 B record untouched.
- **A pure presentation module, `web/src/render/presentation.ts`, containing:**
  - the presentation clock (`P`, delay, catch-up, pause, resets);
  - the frame history (the last ≥ 2 frames per side, keyed by trip id);
  - `presentVehicle(...)`, which returns link, s, lane, the next link during a transition, and the pose;
  - the visual path rule (stop line, transition curve, direct placement on a multi-link skip).

  It is the single CPU rule.
- **Renderer.** The GPU draws exactly what the CPU rule says.
  - The vertex shader gets the matched older and newer states per instance plus a shared α (or the CPU uploads presented poses).
  - A and B renderers use the same `P` while comparing.
  - `ExtrapolationClock` and `extrapolate` are removed or unused.
- **Same position everywhere.** Picking, Follow, the tracked ring and route, and the hooks `vehicleScreenCenter`, `vehicleDraw`, `trackedDraw`, `drawAt` and `trackedScreenCenter` all use the presented position. Their signatures are kept; `drawAt` becomes the new visual rule for a car at `s` on `link`, moving onto `next`, or not moving on when `next` is NO_NEXT.
- **Latency is reported.** The presentation delay (sim seconds behind the newest frame, and its wall-time equivalent) appears in Diagnostics and in `diagnostics().presentation`.
- **Docs.** `docs/architecture.md` describes the model. `docs/known-issues.md` marks i1, i2 and i4 resolved. The supersessions are logged.

## Supersessions (authorized 2026-10-11; valid intent kept)
| Frozen test | Pinned (unwanted) | Valid intent, now carried by |
|---|---|---|
| `web/tests/motion.test.ts` test 3 `draw_position_is_continuous_across_junctions` | (a) a car at `s = length` is drawn at the next link's start, so held cars appear inside junctions | (b) a smooth curve and (c) straight placement off the curve → tests 3 and 2 |
| `web/tests/motion.test.ts` test 4 `extrapolation_stops_at_the_end_on_the_curve` | Extrapolation clamped at the link end, drawn at the next link's start (i1 + i2) | Never drive past an authoritative position → tests 4 and 2 |
| `web/tests/motion.test.ts` test 5 `speed_change_never_moves_cars_back` | The `ExtrapolationClock` API | No backward step on a speed change → test 4 |
| `web/tests/motion.test.ts` test 6 `stall_cannot_overshoot` | "> 0.5", i.e. extrapolation must happen | A bounded run-ahead: never ahead of the newest frame → tests 4 and 8 |
| `web/e2e/motion.spec.ts` test 7 `gpu_draws_cars_where_the_cpu_says` | Held cars drawn on the curve (`vehicleDraw`, with the old rule) | The GPU draws where the CPU rule says → test 9 |

These frozen tests are kept and must stay green:
- `motion.test.ts` test 2;
- `motion.spec.ts` test 8 (the tracked car moves continuously, and the ring equals the car), tests 9 and 10;
- `polish_003_next_links.rs`;
- `gold_city003` (Follow lurch);
- the inspect/city Follow centring tests;
- every test that uses the record-index hooks;
- `core_004_frame.rs` (16 B records);
- `sim.test` / `host.test` (frame types and sizes);
- the determinism, replay and golden-hash tests.

## Specification
- **Delay.** `D` = max(DT, sim advance between the last two new-tick frames), capped at 4·DT. `P` advances at `rate` = the requested speed, or the achieved rate when behind, but never faster than the requested speed.
- **Catch-up.** If `P` lags the newest frame by more than 2·D, it catches up at up to 1.5 × rate. If `P` would pass the newest frame, it holds there until the next frame arrives.
- **Retained frames.** A frame enters the history when it arrives, and at most 8 frames per side are kept.
- **Lane changes.** A lane change within one link is interpolated along the lane offset.
- **Measured.** The added latency is measured at 1× and 20× in the browser and reported in `docs/performance.md`.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `frame_carries_trip_ids` (vitest, host on wasm) | `tripIds` is a `Uint32Array` of length `count`, unique within a frame, and equals `trip_at_record(tick, i)` for every record. A vehicle keeps its id across frames: it is found again by id while its record index changes. It is correct after a seek and in B. `vehicles.byteLength` is still `count·16`. |
| 2 | `held_car_stays_behind_its_stop_line` (vitest, pure) | A trip at `(A, length)` with v = 0 in several consecutive frames, with another link existing after A, is presented at an along-A coordinate ≤ `length − STOP_M` at every `P`. It is never on the curve and never at B's start. A queued car at `s < length − STOP_M` is drawn exactly at its own `s`. Off the junction, the presented pose equals the straight lane placement. |
| 3 | `junction_transition_is_continuous` (vitest, pure) | A trip at `(A, length − 4)` in frame k and `(B, 3)` in frame k + 1, where B starts at A's end node. Sampling `P` in 50 steps across the interval: the pose starts at A's lane placement of `s` and ends at B's placement of 3. Each step is ≤ 1.5 × path length / 50 + 1 mm, and the heading changes by ≤ 30° per step. The same holds for a sharp turn (≥ 120°). When B does not start at A's end node, the car is placed directly, with no path through other links. |
| 4 | `forward_playback_never_steps_back` (vitest, pure) | Simulated playback of a recorded run (≥ 200 frames, real wasm) at 1× and 20×. It has jittered frame arrivals (8–40 ms), varying ticks per frame, one delayed frame (300 ms) and speed changes 20× → 5× → 60× → 1×. Results: `P` is non-decreasing and never exceeds the newest frame. For every trip present in consecutive samples, its along-route progress is non-decreasing. No trip is drawn beyond its newest authoritative position. |
| 5 | `identity_not_record_index` (vitest, pure) | Two frames whose records are reordered, where one record index is reused by a new trip. Each trip interpolates only between its own states. The new trip is first drawn at its own position, and a trip that disappeared is not drawn. |
| 6 | `history_resets_on_seek_scenario_and_world` (vitest, pure) | After a frame with a lower tick (seek back), a forward jump of more than 8 ticks (seek), a different `scenario`, a different `world`, or a compare on/off change, the first presented positions equal the new frame's authoritative placement exactly. `P` equals the new frame's time. Nothing is interpolated from the old frames. |
| 7 | `compare_shares_one_presentation_time` (e2e) | While comparing and running at 20×, sampled every animation frame for 2 s, `diagnostics().presentation` reports the same presented tick for A and B. |
| 8 | `presentation_latency_is_bounded` (vitest pure + e2e measurement) | **Vitest:** in steady playback the lag of `P` behind the newest frame is ≤ D + one frame interval: ≤ 0.55 sim s at 1×, and ≤ 4·DT at 20×. **E2e:** `diagnostics().presentation.lagMs` (wall) has a median ≤ 600 ms at 1× and ≤ 120 ms at 20×. Both values are logged. |
| 9 | `gpu_draws_where_presentation_says` (e2e; replaces `motion.spec` test 7) | Main Bridge closed, paused with queues. For ≥ 8 sampled records, the `vehicleDraw(record).page` pixel differs by ≥ 30 luminance with vehicles shown versus hidden. Every held car with `s ≥ length − STOP_M` is drawn at an along-link coordinate ≤ `length − STOP_M`, i.e. none is inside a junction. |
| 10 | `tracked_car_never_steps_back_in_the_browser` (e2e) | At 1× and at 20×, a tracked car sampled every animation frame for 3 s has non-decreasing route progress (link index in its route plus s, tolerance 0.05 m). The ring stays on the car within 1 px. |

## Must NOT
- Change the sim, the 16 B record or the golden hashes.
- Weaken any kept frozen test.
- Extrapolate beyond the newest authoritative frame.

## Must DO
- Log supersessions S4–S8 in `.wdd/memory/supersessions.md`, with full hashes, before Red approval. Mark them `test.skip` with a pointer.
- Measure before and after: the render interval and draw time at 1× and 20× (SwiftShader), the frame payload (+4 B per vehicle), and the presentation latency.
- Update the docs.

## Manual Smoke Test
### Setup
`pnpm -C web build:wasm && pnpm -C web dev`
### Steps
1. At 1×, zoom into a junction. Cars slow down and stop at the stop line, wait outside the junction, then turn through it in one smooth motion when released. No car stops at the end of the curve and then jumps.
2. At 20×, follow a car for 30 s. It never steps backwards, and turns are continuous.
3. Change the speed 20× → 5× → 60× while watching a junction. There are no jumps.
4. Close the main bridge. Queues form behind the stop lines and no car drives into the closed bridge. Reopen it, and the queue releases smoothly.
5. Pause, then resume. Cars settle and continue without a jump.
6. Seek back, branch, compare. No car slides from a stale position after the jump. Both sides move together.
### Pass criteria
- [ ] Motion looks coherent at 1× and 20× (recorded frames).
- [ ] No held car inside a junction.
- [ ] The latency is measured and stated.
