---
ward: 2
revision: null
name: "Interpolated motion by identity"
epic: "motion"
status: "red"
dependencies: ["motion-001"]
layer: "fullstack"
estimated_tests: 16
created: "2026-10-12"
completed: null
---
# Ward motion-002: Interpolated motion by identity

## Scope
This ward is contract **M2** of epic `motion`: cars that are convincing to watch. It resolves:
- **i1:** a car stops at the curve end, then jumps.
- **i2:** held cars are drawn inside the junction.
- **i4:** backward steps during steady playback.
- **The c2/c3 remainder:** discontinuities after a speed change or a delayed frame.
- **The motion half of the user's task §1.**

The facts are in `.wdd/memory/investigation-2026-10-12.md` § Motion. **There is no sim change.** Held cars already stay on their own link at `s = length`, so i2 is a render choice.

## The model
**Authoritative state.** The frame records (link, s, v, lane, flags) plus two new fields:
- `tripIds: Uint32Array`, one per record;
- `epoch: number`, a timeline epoch per side. The host increments it on init, seek, branch, view switch, discard and compare on or off: every jump that breaks continuity.

**Presentation time `P`.** A sim time per side that never runs ahead of the newest authoritative frame. It trails that frame by a small, explicit delay `D` = max(DT, the sim advance between the last two new-tick frames), capped at 4·DT.
- **Rate.** `P` advances at `rate`: the requested speed, or the achieved rate when behind, never faster than requested.
- **Catch-up.** If it lags by more than 2·D, it catches up at up to 1.5 × rate.
- **No jumps.** It never jumps: every step is ≤ 1.5 · rate · Δwall, except at a history reset.
- **Pause.** While paused it glides to the newest frame and stays there. On resume it continues from there.
- **Sharing.** One `PresentationClock` can be shared by the A and B presenters, so both sides show the same `P`.

**Interpolation.** Each car is drawn between the two retained frames around `P`, matched by trip id and never by record index.
- A trip found only in the newer frame appears at its own position.
- A trip found only in the older frame is not drawn.

**Visual coordinate on a link.** The visual coordinate `ŝ = visualS(length, s)` compresses the last 2·STOP_M of a link into STOP_M (`STOP_M` = min(6 m, length / 2)):
- `ŝ = s` for `s ≤ length − 2·STOP_M`;
- otherwise `ŝ = length − 2·STOP_M + (s − (length − 2·STOP_M)) / 2`.

A held car at `s = length` therefore sits exactly at the stop line `length − STOP_M`. A queue keeps ≥ 3.75 m between drawn cars up to the stop line, so cars do not overlap.

**Visual rule `visualPose(links, link, ŝ, lane, next)`, which is also the hook's `drawAt`:**
- **No next link** (`next = NO_NEXT`): the straight lane placement at min(ŝ, stop line).
- **Moving onto `next`:** the straight placement up to the stop line, then the junction curve from the stop line to `next`'s start. The curve is a **cubic** Bézier, P0 = the stop-line pose, P1 = P0 + d·h, P2 = P3 − e·h, P3 = `next`'s start in lane min(lane, next.lanes − 1), with h = |P3 − P0| / 3. It leaves along A's direction d and arrives along `next`'s direction e, so the heading never snaps at the stop line. (The old quadratic curve with its fallback control point turned up to 88° within 0.1 m in 504 of 1336 River City cases.)

**Transitions.** A car is in a transition only while it is on link A in the older frame and on link B in the newer one, where B starts at A's end node.
- Its path runs from its pose at `visualS(A, s_old)` along A, through the curve, to `visualS(B, s_new)` on B.
- It is traversed at a uniform rate along the drawn path, by α.
- Its presented `(link, s, next)` is `(A, ŝ, B)` on A or the curve, and `(B, ŝ, NO_NEXT)` on B.

If B does not start at A's end node, the car moved more than one link in one frame. It is then placed directly at its new position, with no fabricated path.

**History resets.** History is cleared, with no interpolation across the change, when the frame's `scenario`, `world`, `epoch` or compare state changes, or when its tick decreases. `P` restarts at the new frame.

**No extrapolation.** `P` never exceeds the newest frame. No car is drawn beyond its newest authoritative position, so none drives through a closure or into a stationary queue.

## Inputs
- motion-001: quiet pause, `world`, `framesReceived`.
- `crates/sim-wasm/src/lib.rs` `encode_frame`: its trip table and `trip_at_record`.
- `web/src/sim/{host,protocol,frame}.ts`.
- `web/src/render/motion.ts`: `vehicleDrawPosition`, `extrapolate`, `ExtrapolationClock`.
- `web/src/render/renderer.ts`: `VEH_VS`, `setFrame`, the tracked ring and route.
- `web/src/render/picking.ts`.
- `web/src/App.tsx`:
  - the render loop: rate, Follow, `drawnCams`;
  - `applyFrame` / `applyFrameB`;
  - the hooks `vehicleScreenCenter`, `vehicleDraw`, `trackedDraw`, `drawAt`, `trackedScreenCenter`, `pickAt` and `frameVehicle`.

## Outputs
- **Frame fields.**
  - `tripIds: Uint32Array(count)` in record order: a copy from wasm via a new `Sim.trip_ids()`, the same table `trip_at_record` reads. It adds 4 B per vehicle, and the 16 B record is unchanged.
  - `epoch: number`, the per-side timeline epoch described above.
- **`web/src/render/presentation.ts`**, a pure module. It is the single CPU rule and exposes:
  - `STOP_M`, `stopLine` and `visualS`;
  - `visualPose`;
  - `PresentationClock`;
  - `Presenter`: `push`, `advance`, `lagS`, `vehicles` and `vehicle`.

  `PresentFrame` carries `epoch`.
- **Renderer.**
  - The GPU draws exactly what the CPU rule says: per-instance older and newer states plus α, or the presented poses uploaded from the CPU.
  - While comparing, the A and B renderers share one `PresentationClock`.
  - `ExtrapolationClock`, `extrapolate` and `vehicleDrawPosition` are no longer used by the renderer, but stay exported, because the frozen `motion.test.ts` imports them and its kept test 2 must still load.
- **Presented positions everywhere.** Picking, Follow, the tracked ring and route, and the hooks `vehicleScreenCenter`, `vehicleDraw`, `trackedDraw`, `drawAt` and `trackedScreenCenter` all use the presented position. Their signatures are kept.
  - `drawAt(link, ŝ, lane, next)` = `visualPose`.
  - `trackedDraw` and `vehicleDraw` report the presented `(link, ŝ, next)`.
  - So `trackedDraw().page` equals `drawAt(...)` of the same values. The frozen `motion.spec` test 8 relies on this.
  - `vehicleDraw(record)` gains `length`, the link's sim length.
  - `frameVehicle(record)` gains `lane` and `next`: the frame's next link for that record, or NO_NEXT.
  - A new hook `linkInfo(link)` returns `{ length, lanes }`, or null for an unknown link.
- **Latency.**
  - `diagnostics().presentation` = `{ tickA, tickB (null outside compare), lagS, lagMs }`. `tickA` and `tickB` are the `P / DT` each side last drew with. `lagMs` = `lagS` / (current rate in sim s per ms), and is 0 while paused.
  - The Diagnostics panel shows the lag.
- **Docs.** `docs/architecture.md` describes the model. `docs/known-issues.md` marks i1, i2 and i4 resolved, and the supersessions are logged.

## Supersessions (authorized 2026-10-11; valid intent kept)
| Frozen test | Pinned (unwanted) | Valid intent, now carried by |
|---|---|---|
| `web/tests/motion.test.ts` test 3 | (a) a car at `s = length` is drawn at the next link's start | Its sweep of every junction pair and lane: a smooth curve onto the next link, straight placement off it, and no-next placement → test 3b (a network-wide `visualPose` sweep) and tests 2, 3 and 2b |
| `web/tests/motion.test.ts` test 4 | Extrapolation clamped at the link end and drawn at the next link's start (i1 + i2) | Never beyond an authoritative position → tests 4 and 2 |
| `web/tests/motion.test.ts` test 5 | The `ExtrapolationClock` API | No backward step and no jump on a speed change → test 4 |
| `web/tests/motion.test.ts` test 6 | "> 0.5": extrapolation must happen | A bounded run-ahead: never ahead of the newest frame, bounded catch-up → tests 4 and 8 |
| `web/e2e/motion.spec.ts` test 7 | Held cars drawn on the curve | The GPU draws where the CPU rule says, and the old points stay empty → test 9 |

**Kept, and must stay green:**
- `motion.test.ts` test 2;
- `motion.spec.ts` tests 8, 9 and 10;
- `polish_003_next_links.rs`;
- `gold_city003` (Follow lurch);
- the inspect and city Follow-centring tests;
- every test that uses the record-index hooks;
- `core_004_frame.rs` (16 B records);
- `sim.test` and `host.test`;
- the determinism, replay and golden-hash tests.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `frame_carries_trip_ids_and_epoch` (vitest, host on wasm) | `tripIds` is a `Uint32Array` of length `count`, unique within the frame, and every entry equals `sim.trip_at_record(tick, i)`. Over two consecutive running frames, ≥ 50 % of ids reappear, each on the same link with `s` not smaller, or on that link's next link. The ids are correct after a seek and in B. `epoch` increments on seek, branch, view switch, discard and compare on or off, and not on plain running frames. `vehicles.byteLength = count·16`. |
| 2 | `held_car_stays_at_its_stop_line_without_overlap` (vitest, pure) | Frames arrive as time passes. A head car is held at `(A, length)` with v = 0, and a follower sits at `(A, length − 7.5)`. At every `P`, the head car is drawn exactly at the stop-line pose (`ŝ = length − STOP_M`, lateral offset of its lane), with `next = NO_NEXT`, and never at B's start. The follower is drawn at `visualS(length − 7.5)`, and the two are ≥ 3.6 m apart. A car at `s ≤ length − 2·STOP_M` is drawn at exactly its own `s`. |
| 2c | `interpolation_is_linear_in_the_visual_coordinate` (vitest, pure) | Pure 1× and 20× cases. A trip stays on link A across three frames, with `s` = 10, 17, 24, and a second trip moves inside the compression zone, from `length − 10` to `length − 2`. For every sample with P between ticks k and k + 1, the presented ŝ equals visualS(s_k) + α·(visualS(s_k+1) − visualS(s_k)) within 1e-6, where α = P / DT − k. This excludes a car that waits at its old position and then jumps (i1). |
| 2b | `release_from_a_held_state_is_continuous` (vitest, pure) | Several frames have the car at `(A, length, v = 0)`, then one at `(B, 2)`, with frames pushed as time passes. Across the release interval: the first pose is the stop-line pose; each step is ≤ 1.5 × path length / steps + 1 mm; the heading changes ≤ 30° per step; it ends at B's placement of 2; and the presented `next` is B while on the curve. |
| 3 | `junction_transition_is_continuous` (vitest, pure) | Frames are pushed as time passes, starting with a priming frame. The cases are every junction pair of three_bridges and a spread of River City pairs, ≥ 120 in total, including turns of ≥ 85°. A trip at `(A, length − 12)` is then at `(B, 3)`: the poses go from A's placement of `visualS(length − 12)` to B's placement of 3. Each step is ≤ 1.5 × its share of the path (Δα × path length) + 1 mm, and the heading changes ≤ 30° per step. If B does not leave A's end node, each sample lies on A's or B's lane line only. |
| 3b | `visual_rule_sweep` (vitest, pure; carries the S4 breadth) | **River City and three_bridges.** For **every** link A, every lane, and every B that leaves A's end node (not A's reverse):<br>• `visualPose(A, ŝ, lane, NO_NEXT)` equals the straight placement for ŝ ≤ stop line, and the stop-line pose beyond it;<br>• with `next = B`, sweeping ŝ from 0 to `length` in 0.1 m steps, each step is ≤ 0.75 m and the heading changes ≤ 10° per step, including across the stop line. The pose equals the straight placement before the stop line, and at ŝ = `length` it equals B's start in lane min(lane, B.lanes − 1), with B's heading within 1e-3. |
| 4 | `forward_playback_is_smooth` (vitest, pure, real wasm frames) | Recorded run of ≥ 200 frames at 20×, 5×, 60× and 1×, with jittered arrivals (8–40 ms), varying ticks per frame and one delayed frame (300 ms). Results:<br>• `P` is non-decreasing, never exceeds the newest frame, and every step is ≤ 1.5 · rate · Δwall + 1e-9, where rate is the larger of the last two frames' requested multipliers (sim s per ms).<br>• For every trip, progress on a link is non-decreasing, and a link change goes only to a link the trip holds in a retained frame.<br>• No trip is drawn beyond its newest authoritative position.<br>A separate stall case: steady 20× frames, then a 600 ms gap with no frames, then frames resume ~24 ticks further on. `P` never steps by more than 1.5 · rate · Δwall, and catches up within 3 s. |
| 4b | `pause_and_resume_have_no_jump` (vitest, pure) | At 1× and 20×, the pause lands mid-interval while `P` still trails the newest frame. In one variant a single paused frame is followed by no frames at all (the quiet pause of motion-001). After the pause, `P`:<br>• glides: at least one sample still has lag > 0.1 sim s;<br>• rises monotonically, each step ≤ 1.5 · rate · Δwall, to the newest frame time;<br>• then stays there exactly.<br>On resume, the new-tick frames continue from there with no backward step and no jump. |
| 5 | `identity_not_record_index` (vitest, pure) | Frame k: records [trip 10 @ (A, 10), trip 11 @ (A, 25)]. Frame k + 1: [11 @ (A, 29), 12 @ (A2, 5), 10 @ (A, 14)], i.e. swapped and with a new trip. In between, trip 10 ∈ [10, 14] and trip 11 ∈ [25, 29], each on its own trip. Trip 12 is drawn only at its own position. After frame k + 2 without trip 11, trip 11 is not drawn. |
| 5b | `shared_clock_gives_one_presentation_time` (vitest, pure) | Two presenters share one `PresentationClock`. B's frames carry the same ticks as A's, but arrive 3 ms later. At every sampled wall time, both presenters return the same `P`, and it is ≤ the newest frame of **both** sides. |
| 6 | `history_resets_on_epoch_scenario_world` (vitest, pure) | After a frame with a new `epoch` (seek back or forward), a lower tick, a different `scenario` or `world`, or a compare change, the first presented positions equal the new frame's placement exactly, and `P` equals the new frame's time. A frame 30 ticks ahead with the **same** epoch (a stall) does not reset. |
| 7 | `compare_shares_one_presentation_time` (e2e) | While comparing at 20×, sampled every animation frame for 2 s: `diagnostics().presentation.tickA === tickB`, and both advance. |
| 8 | `presentation_latency_is_bounded` (vitest pure + e2e) | **Vitest:** steady lag is ≤ 0.55 sim s at 1× and ≤ 4·DT at 20×. **E2e:** the median `lagMs` is ≤ 600 at 1× and ≤ 120 at 20×; `lagMs` ≈ `lagS` / rate within 25 %; the values are logged. |
| 9 | `gpu_draws_where_presentation_says` (e2e; replaces `motion.spec` test 7) | Main Bridge closed at `?demand=3`.<br>**Paused:** every held car (frame `s ≥ stop line`, queued) is presented on its own link with `ŝ ≤ stop line` and `next = NO_NEXT`. The camera is zoomed onto held head cars (frame `s = length`) that have a next link with one lane and no follower within 9.5 m. ≥ 6 of them are drawn at their presented point (Δluminance ≥ 30 shown vs hidden). Their **old-rule points** (the old rule drew them at the next link's start) are empty in ≥ half of them.<br>**Running at 20× for 2 s:** a car whose newest frame shows it held is never presented past its stop line. |
| 10 | `tracked_car_never_steps_back_in_the_browser` (e2e) | At 1× and 20×, a tracked car sampled every animation frame for 3 s: progress on a link never decreases (0.05 m tolerance), and it never returns to an earlier link. The ring stays on the car within 1 px. |

## Must NOT
- Change the sim, the 16 B record or the golden hashes.
- Weaken a kept frozen test.
- Extrapolate beyond the newest frame.
- Use an ALLOWLIST entry for `no_orphaned_exports`. The exports must be used.

## Must DO
- Log supersessions S4–S8 with full hashes, and mark them `test.skip` with a pointer.
- Measure before and after: render interval and draw time at 1× and 20× (SwiftShader), frame payload (+4 B per vehicle) and presentation latency.
- Update the docs.

## Manual Smoke Test
### Setup
`pnpm -C web build:wasm && pnpm -C web dev`
### Steps
1. At 1×, zoom into a junction. Cars queue up to the stop line without overlapping, wait outside the junction, and turn through it in one smooth motion when released. No car stops at the curve end and then jumps.
2. At 20×, follow a car for 30 s: it never steps back, and its turns are continuous.
3. Change the speed 20× → 5× → 60× at a junction: no jumps.
4. Close the main bridge: queues form behind the stop lines, and no car drives into the closed bridge. Reopen it: the queue releases smoothly.
5. Pause, then resume: cars settle and continue without a jump.
6. Seek back, branch and compare: no car slides from a stale position, and both sides move together.
### Pass criteria
- [ ] Motion is coherent at 1× and 20× (recorded frames).
- [ ] No held car inside a junction, and no overlap at queue fronts.
- [ ] The latency is measured and stated.
