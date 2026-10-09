---
ward: 3
revision: null
name: "Calm motion and clear markers in the renderer"
epic: "polish"
status: "planned"
dependencies: ["polish-002"]
layer: "fullstack"
estimated_tests: 10
created: "2026-10-09"
completed: null
---
# Ward polish-003: Calm motion and clear markers

## Scope
This ward covers contract **P3** of epic `polish` and resolves backlog ids c1–c5 (`.wdd/memory/polish-backlog.md`); c6 is only rechecked in the smoke test. The brief asks for "cars you can follow" and "an unmistakable physical marker" on closed roads. Today:

- **c1, junctions.** A car jumps 4.6 m (median) and up to 7.4 m when it passes a junction, because each direction of a two-way road is drawn 2.25 m to the right of the node line (plus lane offsets). The tracked car, its ring and Follow jump with it.
- **c2/c3, extrapolation.** Cars can step backwards after a speed change, and a worker stall lets them run ahead for up to 2 s.
- **c4, hover.** The hover halo has nearly the same lightness as a congested road.
- **c5, closures.** The closure hatch disappears below zoom ≈ 0.07.

The fix keeps the sim/render boundary: the sim sends what rendering needs (each vehicle's **next link**) and the renderer computes the geometry.

## Inputs
- **sim-core.** `frame::write_vehicle_records` (its output is pinned by `core_004_frame.rs`, so the flag bits stay as they are). `World::for_each_on_network` and `for_each_on_network_trip`, which both use the same record order. Vehicle routes.
- **sim-wasm.** `Sim::encode_frame`, the frame buffers and `RETAINED_FRAMES`.
- **web.**
  - `sim/host.ts`: frame building, transferables, the frame pool.
  - `sim/protocol.ts`: `FrameMessage`, the record layout.
  - `render/geometry.ts`: `LinkGeom`, `vehiclePosition`, `LANE_WIDTH_M`, `MEDIAN_GAP_M`.
  - `render/renderer.ts`: `VEH_VS`, `setFrame`, `extrapolationS`, `trackedWorldPosition`, the halo and hatch passes, `MIN_ZOOM`.
  - `App.tsx`: the test hook (`frameVehicle`, `vehicleScreenCenter`, `trackedScreenCenter`, `setDebug`).
- **Measured baseline (city-003 Gold reviews).** At junctions the drawn link ends are offset by 4.6 m median and 7.4 m maximum, which is 9–17 px at 2.24 px/m.

## Outputs
**Next links in the frame**
- sim-core gets `frame::write_next_links(world, out: &mut Vec<u16>)`.
  - It writes one entry per vehicle record, in exactly the record order: the vehicle's next link on its route, or `NO_NEXT_LINK = u16::MAX` when it is on its final link or has no route.
  - It reads the world only.
- sim-wasm exposes it with each encoded frame (pointer and length, or a copy).
- The host adds `nextLinks: Uint16Array` (length `count`) to `FrameMessage`, sent as a transferable or a fresh copy.
- The UI and renderer consume it. No per-vehicle JS↔wasm calls are added.

**One placement rule, CPU and GPU (`web/src/render/motion.ts`, new)**
- `vehicleDrawPosition(links, link, s, lane, next)` returns `{ x, y, hx, hy }`: the world position and the unit heading.
  - **Outside the blend zone:** identical to today's `vehiclePosition`, with heading along the link.
  - **Blend zone:** the last `B = min(6 m, length / 2)` of a link whose `next` is set. The car follows a quadratic Bézier from its lane point at `length − B` (control point: where the in-lane line and the out-lane line intersect, or the in-lane end if they are parallel) to the start of `next` at `s = 0`, in lane `min(lane, next.lanes − 1)`.
  - The heading is the curve's tangent. `s = length` lands exactly on the next link's start point.
- `extrapolate(links, link, s, v, dtSim, next)`: past the link end with a `next`, the car continues on `next` at the overshoot (capped at that link's length). Without a `next` it stops at the end.
- The vehicle vertex shader implements the same rule. It reads `next` as a second per-instance attribute and uses the link table it already samples.
- `trackedWorldPosition`, the ring and Follow use `motion.ts`.

**Extrapolation clock (`motion.ts`, `ExtrapolationClock`)**
- It replaces the inline anchor logic in `setFrame` and `extrapolationS`.
- **Speed change:** the anchor is re-based so the extrapolated sim time is continuous at the moment of the change (c2).
- **Cap:** the extrapolated sim time is capped at `1.5 ×` the expected sim advance between frames, measured from the last frames, so a stall cannot run cars ahead (c3).
- Pause and resume keep today's semantics.

**Markers**
- **Hover (c4)** reads by shape as well as lightness. The halo is drawn as an outline separated from the road by a dark gap of at least 1 px on both sides, so it cannot read as a wider, lighter (congested) road. Selection keeps its white halo and gets the same gap.
- **Closures (c5)** are visible at every zoom down to `MIN_ZOOM`. When a link is too short on screen for the hatch, a barrier glyph of at least 6 × 6 CSS px (white with a dark outline) is drawn at its midpoint. This happens in addition to the existing barriers wherever those are drawn.

**Test hook additions**
- `vehicleDraw(record)` returns `{ link, s, lane, next, world: [x, y], page: [x, y] } | null`: the CPU draw position of a record of the current frame at the current extrapolation.
- `trackedDraw()` returns `{ link, lane, world: [x, y] } | null`.

## Specification
- **Pinned (do not change):**
  - `write_vehicle_records` output, flags included (`core_004_frame.rs`);
  - the record layout in `protocol.ts`;
  - `FrameMessage` fields keep their meaning (`nextLinks` is added).
- **Determinism:** writing next links must not change the world. The `state_hash` after `encode_frame` equals the hash before it.
- **Units:** world metres (y up). The reference zoom for "px" is 2.24 CSS px/m.
- **Lane on the next link:** the entry lane is chosen by the sim at entry and cannot be known earlier. The predicted lane is `min(lane, next.lanes − 1)`. A crossing where the sim picks another lane may still show a lateral move of one lane width; continuity is required where the predicted lane is the entry lane.
- **Performance:** frame bytes grow by 2 per vehicle. No per-frame allocation is added on the host's steady path.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `next_links_follow_routes` (Rust, native) | In a busy River City world (and three_bridges with closures and stranded vehicles), `write_next_links` has exactly one entry per record. Entry i is the route's next link of the vehicle at record i (matched through `for_each_on_network_trip`), or `u16::MAX` on its final link or without a route. At least 10 % of the entries are `u16::MAX` and at least 50 % are not. `state_hash` is unchanged by encoding. |
| 2 | `frame_carries_next_links` (vitest, real wasm through the host) | Every frame has `nextLinks` of length `count`. Each value is `< linkCount` or `0xFFFF`. A non-`0xFFFF` value is a link that starts at the end node of the record's link (it is reachable). This holds again after a seek and in B after a branch. |
| 3 | `draw_position_is_continuous_across_junctions` (vitest, pure) | For every River City pair (in → out, where out starts at in's end node) and every lane with a valid predicted lane: (a) the position at `s = length` on in, with next = out, equals the position at `s = 0` on out within 1 mm, and the heading there equals out's direction within 0.05 rad; (b) along in, steps of Δs = 0.1 m move at most 0.25 m, with no jump; (c) outside the blend zone, and on any link without a next, the result equals `vehiclePosition` within 1e-9 m. |
| 4 | `extrapolation_continues_onto_the_next_link` (vitest, pure) | Overshooting the link end with a next: the result is on next at the overshoot (capped at next's length), and the draw position is continuous across the change (≤ 0.25 m for a 0.1 m step). Without a next: capped at the end. |
| 5 | `speed_change_never_moves_cars_back` (vitest, pure `ExtrapolationClock`) | Frames arrive, then the multiplier changes from 20 to 5, from 5 to 60, and to 1. The extrapolated sim time is continuous at each change (no jump greater than one frame's advance at the new rate) and never decreases between frames of the same tick. Pause makes it 0. After resume it restarts from 0 at the first frame. |
| 6 | `stall_cannot_overshoot` (vitest, pure) | Frames come every 50 ms with an advance of 0.5 sim s per frame. When a gap of 2 s follows (a stall), the extrapolated sim time never exceeds 0.75 sim s (1.5 × the expected advance). The same holds after a speed change. |
| 7 | `gpu_draws_cars_where_the_cpu_says` (e2e) | Paused at zoom ≥ 4 px/m, at least 8 vehicles inside a blend zone are each checked with `vehicleDraw` on a canvas point. The drawn picture there (vehicles shown) differs from the same point with `setDebug({ hideVehicles: true })` by a luminance of at least 30. The same holds for 8 vehicles outside blend zones. So the shader places cars by the same rule. |
| 8 | `tracked_car_moves_continuously` (e2e) | At 1× speed and zoom 2.24 px/m, a tracked car is sampled every animation frame with `trackedDraw` for 60 s of wall time, or until it has crossed 3 junctions with an unchanged predicted lane. Between consecutive samples the world displacement never exceeds `v_max × Δt_sim + 0.9 m` (2 px), including at those junctions. The run must contain at least 3 such crossings. |
| 9 | `hover_differs_from_congestion_by_shape` (e2e) | A congested link (occupancy ≥ 0.8) and an uncongested one are each hovered in turn, with vehicles hidden. A luminance profile across the road shows, on both sides, a gap of at least 1 px darker than the road core before the halo. The same congested link unhovered shows no such gap pattern. |
| 10 | `closed_road_marked_at_every_zoom` (e2e) | The main bridge is closed. At zooms 0.05 (`MIN_ZOOM`), 0.07 and 0.2 px/m, a 14 × 14 px window at the closed link's screen midpoint contains at least 12 pixels with luminance ≥ 220 and at least 12 with luminance ≤ 40 (the white barrier with its dark outline). The same window at the same zoom before the closure does not meet both counts. |

## Must NOT
- Change the vehicle record words or flags.
- Put screen coordinates, cameras or colours in Rust.
- Edit frozen tests.
- Rely on hue for hover or closure.

## Must DO
- Update the frame layout comment in `protocol.ts` and `docs/architecture.md` (data flow).
- Measure frame bytes before and after, at the default demand.
- Add regression coverage in new files only.
- Update CONTEXT.

## Manual Smoke Test
### Setup
`pnpm -C web build:wasm && pnpm -C web dev` (on any port except 4243).
### Steps
1. Zoom to the Main Bridge (about 2–4 px/m) at 1× and watch cars turn at junctions. They curve smoothly and do not jump.
2. Track and follow a car through several turns. The ring stays on the car and the view does not jerk.
3. Switch speed 20× → 5× → 60× while watching. No car steps backwards.
4. Hover a congested road and an empty one. The hover outline is clearly a ring, not a wider road.
5. Close the main bridge and zoom fully out. The closure marker is still visible. Recheck c6: the bridge railings are visible over land and over water.
### Pass criteria
- [ ] Turns are smooth and the tracked car does not jump.
- [ ] No backward steps on a speed change.
- [ ] Hover and congestion are distinguishable without hue.
- [ ] The closure is visible at every zoom.
