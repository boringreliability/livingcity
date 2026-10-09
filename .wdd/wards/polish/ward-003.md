---
ward: 3
revision: null
name: "Calm motion and clear markers in the renderer"
epic: "polish"
status: "complete"
dependencies: ["polish-002"]
layer: "fullstack"
estimated_tests: 10
created: "2026-10-09"
completed: "2026-10-09"
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
  - It writes one entry per vehicle record, in exactly the record order: the vehicle's next link on its route, or `NO_NEXT_LINK = u16::MAX` when it is on its final link or stranded (no valid way on).
  - It reads the world only.
- sim-wasm exposes it with each encoded frame (pointer and length, or a copy).
- The host adds `nextLinks: Uint16Array` (length `count`) to `FrameMessage`, sent as a transferable or a fresh copy.
- The UI and renderer consume it. No per-vehicle JS↔wasm calls are added.

**One placement rule, CPU and GPU (`web/src/render/motion.ts`, new)**
- `vehicleDrawPosition(links, link, s, lane, next)` returns `{ x, y, hx, hy }`: the world position and the unit heading.
  - **Outside the blend zone:** identical to today's `vehiclePosition`, with heading along the link.
  - **Blend zone:** the last `B = min(6 m, length / 2)` of a link whose `next` is set. The car follows a quadratic Bézier from `P0` (its lane point at `length − B`) to `P2` (the start of `next` at `s = 0`, in lane `min(lane, next.lanes − 1)`).
    - The control point `C` is the intersection of the in-lane line and the out-lane line, but only if it lies ahead of `P0` along the in-direction, behind `P2` along the out-direction, and within `|P2 − P0|` of both.
    - Otherwise (parallel lines, right-turn geometry, offsets), `C = P2 − dir(out) · |P2 − P0| / 2`.
  - The heading is the curve's tangent, falling back to the next link's direction when the tangent is degenerate. At `s = length` the car is exactly at the next link's start, heading along it.
- `extrapolate(links, link, s, v, dtSim, next)` returns `{ link, s: min(s + v·dtSim, length) }`. It never goes past the link end, because the sim holds cars at stop lines and stops them instantly: extrapolating onto the next link would snap cars back 3–7 m when the next frame arrives (Red r1 B1). With a `next`, the end of the link is the next link's start (the end of the curve), so the next frame continues from where the car was drawn.
- The vehicle vertex shader implements the same rule. It reads `next` as a second per-instance attribute and uses the link table it already samples.
- `trackedWorldPosition`, the ring and Follow use `motion.ts`.

**Extrapolation clock (`motion.ts`, `ExtrapolationClock`)**
- It replaces the inline anchor logic in `setFrame` and `extrapolationS`.
- **Speed change:** the anchor is re-based so the extrapolated sim time is continuous at the moment of the change (c2).
- **Cap:** the extrapolated sim time is capped at `1.5 ×` the expected sim advance between frames, so a stall cannot run cars ahead (c3). The expected advance is the tick delta between the last two new-tick frames × DT (0.5 s); until two have arrived, the cap is today's 2 s.
- Pause and resume keep today's semantics.

**Markers**
- **Hover (c4)** reads by shape as well as lightness. A hovered road shows a **dashed bright stroke along its centre** (dash and gap of a few CSS px each) instead of the light-grey halo, so it can never read as a wider, lighter (congested) road. Congestion never produces a dash pattern. Selection keeps its white halo. (A gap-separated outline was rejected: on two-way pairs, the partner road 1 m away produces the same road–gap–light pattern.)
- **Closures (c5)** are visible at every zoom down to `MIN_ZOOM`. A barrier glyph is drawn at the midpoint of every closed link at every zoom, in addition to the hatch and the end barriers wherever those are drawn. It has a white core of at least 6 × 6 CSS px inside a dark outline.

**Test hook additions**
- `vehicleDraw(record)` returns `{ link, s, lane, next, inBlend, world: [x, y], page: [x, y], straightPage: [x, y] } | null`. This is the CPU draw position of a record of the current frame at the current extrapolation. `straightPage` is where today's straight rule (`vehiclePosition`) would put it. Picking uses the new rule.
- `trackedDraw()` returns `{ link, s, length, lane, next, nextLane, world: [x, y], page: [x, y] } | null`, as drawn after extrapolation. `nextLane` is the predicted lane on `next`.
- `drawAt(link, s, lane, next)` returns `[x, y]`: the pure draw rule (`vehicleDrawPosition`) in world metres.
- `vehicleScreenCenter` and picking use the new draw rule, because they describe where the car is drawn.

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
| 1 | `next_links_follow_routes` (Rust, native) | In a busy River City world (and three_bridges with closures and stranded vehicles), `write_next_links` has exactly one entry per record. Entry i is the route's next link of the vehicle at record i (matched through `for_each_on_network_trip`), or `u16::MAX` if that vehicle is stranded or on its final link. Some entries are `u16::MAX`. Among non-stranded records, at least half have a next link. three_bridges has stranded records. `state_hash` is unchanged by encoding. |
| 2 | `frame_carries_next_links` (vitest, real wasm through the host) | Every frame has `nextLinks` of length `count`. Each value is `< linkCount` or `0xFFFF`. A non-`0xFFFF` value is a link that starts at the end node of the record's link (it is reachable). This holds again after a seek and in B after a branch. |
| 3 | `draw_position_is_continuous_across_junctions` (vitest, pure) | For every River City pair (in → out, where out starts at in's end node, no U-turns) and every lane on in: (a) the position at `s = length` on in, with next = out, equals out's start in lane `min(lane, out.lanes − 1)` within 1 mm, and the heading there equals out's direction within 0.05 rad; (b) through the blend zone and the 0.5 m before it, the worst step of Δs = 0.1 m moves at most 0.75 m (the curve may be up to ~2.3 × B long; the junction jumps it replaces are 4.6 m). Explicit test timeout of 120 s; (c) outside the blend zone, and on any link without a next, the result equals `vehiclePosition` within 1e-9 m. |
| 4 | `extrapolation_stops_at_the_end_on_the_curve` (vitest, pure) | Within a link the result is `s + v·dt`. Past the end, with or without a next, it is the link end. With a next, the draw position there equals the next link's start. |
| 5 | `speed_change_never_moves_cars_back` (vitest, pure `ExtrapolationClock`) | Frames arrive, then the multiplier changes from 20 to 5, from 5 to 60, and to 1. The extrapolated sim time is continuous at each change (no jump greater than one frame's advance at the new rate) and never decreases between frames of the same tick. Pause makes it 0. After resume it restarts from 0 at the first frame. |
| 6 | `stall_cannot_overshoot` (vitest, pure) | Frames come every 50 ms with an advance of 0.5 sim s per frame. When a gap of 2 s follows (a stall), the extrapolated sim time never exceeds 0.75 sim s (1.5 × the expected advance). The same holds after a speed change. |
| 7 | `gpu_draws_cars_where_the_cpu_says` (e2e) | `?demand=3`, with the main bridge closed for 10 sim minutes so junction queues form, then paused. Drag the spot with the most blend-zone cars to the centre and zoom there to ≥ 4 px/m. At least 3 visible blend-zone vehicles (drawn ≥ 6 px off their straight point) and 8 plain vehicles are checked. At each one's `vehicleDraw.page`, the picture with vehicles shown differs from the picture with `setDebug({ hideVehicles: true })` by a mean luminance of at least 30. At least half of the curved vehicles' straight points show no such difference. So the shader uses the curve rule. |
| 8 | `tracked_car_moves_continuously` (e2e) | At 5× speed and zoom ≥ 2.24 px/m, moving cars are tracked (and followed) one after another, up to 4 minutes, until 3 junction crossings into the predicted lane are observed. `trackedDraw` is sampled every animation frame. **Geometric continuity:** between consecutive samples, the world displacement never exceeds the length of the drawn path between them + 0.9 m (2 px at 2.24 px/m). The path is measured with `drawAt` in 0.1 m sub-steps: on the same link from `s_prev` to `s_now`, or across a crossing into `next`, the rest of the old link plus the start of the new one. Exempt: a crossing where the sim chose another entry lane than `nextLane`, and a reroute between frames. The ring and Follow position (`trackedScreenCenter`) is within 1 px of `trackedDraw.page` at every sample. |
| 9 | `hover_differs_from_congestion_by_shape` (e2e) | `?demand=3`, paused, vehicles hidden, zoom ≥ 1.2 px/m. A visible congested link (occupancy ≥ 0.8) and an empty link are each hovered. The luminance along the link's centre (t 0.35–0.65) shows at least 3 dark→bright alternations (a dash pattern). The same congested link unhovered shows at most 1. |
| 10 | `closed_road_marked_at_every_zoom` (e2e) | With vehicles hidden, the main bridge is closed. At zooms of about 0.05 (`MIN_ZOOM`), 0.07 and 0.2 px/m, a 14 × 14 px window at the closed link's screen midpoint has at least 20 more pixels with luminance ≥ 220 than the same window at the same zoom before the closure (the white barrier glyph). |

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
