---
ward: 2
revision: null
name: "Interpolated motion by identity"
epic: "motion"
status: "approved"
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

**Junction clearance (option A, chosen by the user on 2026-10-12 after the Red r3 escalation).** The clearance is render-only and computed once from the network geometry by `clearances(links, from, to)`, which returns `{ end, start }` per link.
- **`end[L]`** is the smallest `c` in {0.5, 0.75, 1, …} m such that a car of 4.5 × 2.0 m, centred in any lane of L at `s = length − c` and aligned with L, overlaps no road rectangle of another link at L's end node. The road rectangle is the drawn centreline ± width / 2. L's own reverse link is not counted.
- **`start[L]`** is the same at L's start node, at `s = e`.
- **Bound.** Both values are ≤ length / 2.

Measured on 2026-10-12:
- **Clearance values:** median 6.25 m and p95 19.75 m on River City.
- **Fit:** every link of both networks fits 2·end + 2·start.

The stop line is at `length − end[L]`, and the entry point at `start[L]`. A held car therefore sits outside every crossing road, and a car entering a link appears beyond the junction.

**Visual coordinate on a link.** `ŝ = visualS(L, s)` compresses each end zone into half its length:
- `s ≤ 2·start` → `start + s / 2`;
- `s ≥ length − 2·end` → `length − 2·end + (s − (length − 2·end)) / 2`;
- otherwise `ŝ = s`.

So a held car at `s = length` is drawn exactly at the stop line, and a car at `s = 0` at the entry point. Drawn cars in a queue stay ≥ 3.75 m apart, so they do not overlap.

**Visual rule `visualPose(links, C, link, ŝ, lane, next)` (C = the clearances), which is also the hook's `drawAt`:**
- **`next = NO_NEXT`:** the straight lane placement at ŝ clamped to [start, stop line].
- **`next` = B:** the straight placement up to the stop line. Past it, `u = (ŝ − stop line) / end[L]` runs along a **cubic** Bézier:
  - P0 is the stop-line pose and P3 is B's entry point in lane min(lane, B.lanes − 1);
  - P1 = P0 + d·h and P2 = P3 − e·h, where d and e are the directions of L and B and h = |P3 − P0| / 3.
  - It leaves along L and arrives along B. Measured on 2026-10-12: the heading changes at most 5.3° per 0.1 m of drawn arc, over all 1,336 River City pair × lane cases.

**Transitions.** A car is in a transition only while it is on link A in the older frame and on link B in the newer one, where B starts at A's end node.
- Its path runs from its pose at `visualS(A, s_old)` along A to the stop line, through the curve to B's entry point, then along B to `visualS(B, s_new)`.
- It is traversed at a uniform rate along the drawn path, by α.
- If the newer lane on B differs from `min(laneA, B.lanes − 1)`, the lateral change is spread over the transition path. The presented `lane` may be fractional, and the pose stays `visualPose` of the presented values. (Red r4 F1: 43 % of River City transitions change lane.)
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
  - `clearances`, `stopLine` and `visualS`;
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
  - `vehicleDraw(record)` gains `length` (the link's sim length) and `stop` (its stop line ŝ).
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
| 2 | `held_car_stays_at_its_stop_line_without_overlap` (vitest, pure) | Frames arrive as time passes. A head car is held at `(A, length)` with v = 0, and a follower is at `(A, length − 7.5)`. At every `P`:<br>• The head car is drawn exactly at the stop-line pose (`ŝ = length − end[A]`, in its lane) with `next = NO_NEXT`.<br>• Its 4.5 × 2.0 m body overlaps no other road at the junction.<br>• The follower is drawn at `visualS(A, length − 7.5)`, ≥ 3.6 m from the head car.<br>• A car outside both end zones is drawn at exactly its own `s`. |
| 2c | `interpolation_is_linear_in_the_visual_coordinate` (vitest, pure) | Pure 1× and 20× cases. A trip stays on link A across three frames, with `s` = 10, 17, 24, and a second trip moves inside the compression zone, from `length − 10` to `length − 2`. For every sample with P between ticks k and k + 1, the presented ŝ equals visualS(s_k) + α·(visualS(s_k+1) − visualS(s_k)) within 1e-6, where α = P / DT − k. This excludes a car that waits at its old position and then jumps (i1). |
| 2b | `release_from_a_held_state_is_continuous` (vitest, pure) | Several frames have the car at `(A, length, v = 0)`, then one at `(B, 2)`, with frames pushed as time passes. The cases are the straight continuation, the sharpest turn and a right turn. Across the release interval:<br>• the first pose is the stop-line pose;<br>• each step is ≤ 1.5 × its share of the path + 1 mm;<br>• the heading changes ≤ 30° per step;<br>• it ends at B's placement of `visualS(B, 2)`;<br>• the presented `next` is B while on A or the curve. |
| 3 | `junction_transition_is_continuous` (vitest, pure) | Frames are pushed as time passes, starting with a priming frame. The cases are every junction pair of three_bridges and a spread of River City pairs, ≥ 120 in total, including turns of ≥ 85°. A trip at `(A, length − 12)` is then at `(B, 3)`: the poses go from A's placement of `visualS(length − 12)` to B's placement of 3. Each step is ≤ 1.5 × its share of the path (Δα × path length) + 1 mm, and the heading changes ≤ 30° per step. If B does not leave A's end node, each sample lies on A's or B's lane line only. |
| 3d | `transition_into_another_lane_is_continuous` (vitest, pure; Red r4 F1) | River City junction pairs (both ≥ 30 m) where A or B has ≥ 2 lanes, every lane pair with `lb ≠ min(la, B.lanes − 1)`, a deterministic spread of ≥ 100 covering la < lb and la > lb. Test 3's schedule with lane `la` on A and `lb` on B: the poses start at A's placement in lane la, end at B's placement of `visualS(B, 3)` in lane lb, and are smooth as in test 3. |
| 3c | `clearances_keep_cars_out_of_junctions` (vitest, pure) | **River City and three_bridges, every link and every lane.**<br>• A 4.5 × 2.0 m car at `(L, length − end[L])` overlaps no road rectangle of another link at L's end node (L's reverse excluded), and likewise at `(L, start[L])` at L's start node.<br>• The values are minimal: at `end[L] − 0.25` (and `start[L] − 0.25`) some overlap exists, unless the value is 0.5.<br>• Both are ≤ length / 2, and 2·end + 2·start ≤ length. |
| 3b | `visual_rule_sweep` (vitest, pure; carries the S4 breadth) | **River City and three_bridges.** For **every** link A, every lane, and every B that leaves A's end node (not A's reverse):<br>• `visualPose(A, ŝ, lane, NO_NEXT)` equals the straight placement at ŝ clamped to [start[A], stop line];<br>• with `next = B`, sweeping ŝ from 0 to `length` in steps of at most 0.01 m:<br>&nbsp;&nbsp;– each step is ≤ 0.75 m;<br>&nbsp;&nbsp;– the heading changes ≤ 10° per 0.1 m of drawn arc, including across the stop line;<br>&nbsp;&nbsp;– the pose equals the straight placement before the stop line;<br>&nbsp;&nbsp;– at ŝ = `length` it equals B's entry point (`start[B]`, lane min(lane, B.lanes − 1)) with B's heading within 1e-3. |
| 4 | `forward_playback_is_smooth` (vitest, pure, real wasm frames) | Recorded run of ≥ 200 frames at 20×, 5×, 60× and 1×, with jittered arrivals (8–40 ms), varying ticks per frame and one delayed frame (300 ms). Results:<br>• `P` is non-decreasing, never exceeds the newest frame, and every step is ≤ 1.5 · rate · Δwall + 1e-9, where rate is the larger of the last two frames' requested multipliers (sim s per ms).<br>• For every trip, progress on a link is non-decreasing, and a link change goes only to a link the trip holds in a retained frame.<br>• No trip is drawn beyond its newest authoritative position.<br>A separate stall case: steady 20× frames, then a 600 ms gap with no frames, then frames resume ~24 ticks further on. `P` never steps by more than 1.5 · rate · Δwall, and catches up within 3 s. |
| 4b | `pause_and_resume_have_no_jump` (vitest, pure) | At 1× and 20×, the pause lands mid-interval while `P` still trails the newest frame. In one variant a single paused frame is followed by no frames at all (the quiet pause of motion-001). After the pause, `P`:<br>• glides: at least one sample still has lag > 0.1 sim s;<br>• rises monotonically, each step ≤ 1.5 · rate · Δwall, to the newest frame time;<br>• then stays there exactly.<br>On resume, the new-tick frames continue from there with no backward step and no jump. |
| 5 | `identity_not_record_index` (vitest, pure) | Frame k: records [trip 10 @ (A, 10), trip 11 @ (A, 25)]. Frame k + 1: [11 @ (A, 29), 12 @ (A2, 5), 10 @ (A, 14)], i.e. swapped and with a new trip. In between, trip 10 ∈ [10, 14] and trip 11 ∈ [25, 29], each on its own trip. Trip 12 is drawn only at its own position. After frame k + 2 without trip 11, trip 11 is not drawn. |
| 5b | `shared_clock_gives_one_presentation_time` (vitest, pure) | Two presenters share one `PresentationClock`. B's frames carry the same ticks as A's, but arrive 3 ms later. At every sampled wall time, both presenters return the same `P`, and it is ≤ the newest frame of **both** sides. |
| 6 | `history_resets_on_epoch_scenario_world` (vitest, pure) | After a frame with a new `epoch` (seek back or forward), a lower tick, a different `scenario` or `world`, or a compare change, the first presented positions equal the new frame's placement exactly, and `P` equals the new frame's time. A frame 30 ticks ahead with the **same** epoch (a stall) does not reset. |
| 7 | `compare_shares_one_presentation_time` (e2e) | While comparing at 20×, sampled every animation frame for 2 s: `diagnostics().presentation.tickA === tickB`, and both advance. |
| 8 | `presentation_latency_is_bounded` (vitest pure + e2e) | **Vitest:** steady lag is ≤ 0.55 sim s at 1× and ≤ 4·DT at 20×. **E2e:** the median `lagMs` is ≤ 600 at 1× and ≤ 120 at 20×; `lagMs` ≈ `lagS` / rate within 25 %; the values are logged. |
| 9 | `gpu_draws_where_presentation_says` (e2e; replaces `motion.spec` test 7) | Main Bridge closed at `?demand=3`.<br>**Paused:** every held car (frame `s = length`, queued) is presented on its own link with `ŝ ≤ stop` (the hook's `vehicleDraw(record).stop`) and `next = NO_NEXT`. At zoom ≥ 4, the camera is panned to held head cars (frame `s = length`) whose next link has one lane, one by one (Gold amendment, Red r5: at `?demand=3` only 2–8 such cars without a follower within 9.5 m exist city-wide, so one view never held 6; a follower is behind the head car on its own link and cannot cover the old point). ≥ 6 of them are drawn at their presented point (Δluminance ≥ 30 shown vs hidden). Their **old-rule points** (the old rule drew them at the next link's start) are empty in ≥ half of them.<br>**Running at 20× for 2 s:** a car whose newest frame shows it held (`s = length`) is never presented past its stop line. |
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
