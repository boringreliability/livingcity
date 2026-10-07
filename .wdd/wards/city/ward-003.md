---
ward: 3
revision: null
name: "Inspect vehicles and roads"
epic: "city"
status: "approved"
dependencies: ["city-002"]
layer: "typescript"
estimated_tests: 17
created: "2026-10-07"
completed: null
---
# Ward city-003: Inspect vehicles and roads

## Scope
The brief requires "inspect roads and vehicles" and "cars you can follow".
- **Select a vehicle:** clicking it shows a panel with its trip, highlights its remaining route on the map, and offers **Follow**, which keeps the camera on it.
- **Inspect a road:** clicking a road shows real link statistics from the simulation: vehicles, queued, current travel cost vs free flow, capacity in veh/h, and exits.

Data follows `.wdd/epics/city.md` § C4: on-demand queries, one tracked vehicle and one link detail per frame, no per-vehicle calls, and no JSON of vehicles.

## Inputs
- core-004/005: `Sim` adapter, worker host and protocol, `client.ts`, `frame.ts` AoS decoder, `picking.ts`, `geometry.vehiclePosition`, renderer state texture, `SelectionPanel`, the `window.__livingcity` hook.
- city-001: `VehicleInfo.blocked_ticks`, `Link.sat_flow_per_lane`.
- city-002: River City and its zones (names for origin and destination).

## Outputs
- **Rust (`sim-core`)**
  - `World::vehicle_at(link, lane: u8, index_from_front: usize) -> Option<u64>` returns the trip id.
  - `World::vehicle_by_trip(trip_id) -> Option<VehicleInfo>`, for live vehicles only.
  - `World::link_stats(link) -> LinkStats { vehicles: u32, queued: u32, cost_s: f64, free_flow_s: f64, exits: u64 }`. Panics on an unknown link, like the other accessors.
  - `World::trip_outcome(trip_id) -> TripOutcome`, one of:
    - `Live`;
    - `Completed { travel_time_s }`;
    - `RemovedUnreachable`;
    - `RemovedGridlock`;
    - `Unknown` (never spawned).
  - The world keeps a `removed_log: Vec<(trip_id, RemovalKind)>`. It is state, so `state_hash` covers it. Spawned trip ids are dense, so `Unknown` means `trip_id >= next_trip_id`.
  - `VehicleInfo` gains `origin: NodeId` and `dest: NodeId`.
  - `NetworkExport.link_sat_flow: Vec<f32>`.
- **sim-wasm**
  - `Sim::vehicle_detail(trip_id: f64) -> Vec<f64>` uses `VEHICLE_DETAIL` (documented in `protocol.ts`):
    - header `[found, trip_id, origin_node, dest_node, state, link, lane, s, v, age_s, route_switches, blocked_ticks, route_len]`;
    - then `route_len` link ids: the remaining route `route[route_pos..]`, current link first (empty when waiting or NoRoute);
    - state codes: 0 = waiting at origin, 1 = driving, 2 = queued (on network, v < `QUEUED_SPEED`), 3 = stranded, 4 = no route. Stranded takes precedence over queued.
    - `found == 0` means "not live", with the rest zero.
  - `Sim::trip_outcome(trip_id) -> Vec<f64>`: `[code, travel_time_s]`. Codes are 0 live, 1 completed, 2 removed unreachable, 3 removed gridlock and 4 unknown; `travel_time_s` is NaN unless completed.
  - `Sim::link_detail(link) -> Vec<f64>`: `[vehicles, queued, cost_s, free_flow_s, exits, capacity_vph]`, where `capacity_vph = lanes × sat_flow × 3600`.
  - **Frame trip table.** `encode_frame` also records the trip id of every record of that frame, and the sim keeps the tables of its last 8 encoded frames.
  - `Sim::trip_at_record(frame_tick: f64, record: u32) -> f64` returns that trip id, or −1 if the frame is no longer retained or the record is out of range.
  - `Sim::link_sat_flow() -> Vec<f32>`.
- **Protocol and host**
  - `ToWorker` gains `{ type: 'inspectVehicle'; frameTick: number; record: number } | { type: 'inspectVehicle'; clear: true }` and `{ type: 'inspectLink'; link: number | null }`.
  - **Resolving a pick.** The host resolves a pick with `trip_at_record` (−1 → no selection), then tracks that trip.
  - **Every frame message carries:**
    - `tracked: TrackedVehicle | TrackedGone | null`:
      - `TrackedVehicle = { tripId, origin, dest, state, link, lane, s, v, ageS, routeSwitches, blockedTicks, route: Uint32Array }`;
      - `TrackedGone = { gone: true, tripId, outcome: 'completed' | 'removed_unreachable' | 'removed_gridlock' | 'unknown', travelTimeS: number | null }`, sent exactly once, after which tracking stops;
    - `linkDetail: LinkDetail | null`, where `LinkDetail = { link, vehicles, queued, costS, freeFlowS, exits, capacityVph }`.
  - `decodeVehicleDetail(arr) -> TrackedVehicle | null` and `decodeLinkDetail(link, arr) -> LinkDetail` live in `protocol.ts`.
  - `NetworkArrays` gains the **optional** `linkSatFlow?: Float32Array`, because frozen test literals lack it.
  - The new `SimLike` methods (`vehicle_detail`, `trip_outcome`, `link_detail`, `trip_at_record`, `link_sat_flow`) are **optional**, because existing fakes lack them. The host guards their use.
- **TS / UI**
  - `picking.pickVehicle(vehicles: DecodedVehicles, links: LinkGeom[], camera, sx, sy, tolerancePx = 8) -> number | null` returns a record index: the nearest record centre (`vehiclePosition`, no extrapolation) within the tolerance, with ties going to the lower index.
  - App keeps a copy of the latest frame's records, because the transferred buffer is returned to the worker.
  - **Picking rule (Red r1 M3).** Vehicles are pickable only when `camera.zoom ≥ VEHICLE_PICK_MIN_ZOOM` = 1.0 px/m. Then a click tries vehicles first (8 px), then roads. Below that, as at fit zoom, clicks select roads only: the network dominates at wide zoom (level of detail), busy roads stay selectable, and earlier road-click tests are unaffected.
  - `VehiclePanel` and the route highlight + tracked ring in the renderer.
  - **Follow mode.** The camera centre is set to the tracked vehicle every rAF, with no easing. A drag pan turns follow off.
  - **Escape order:** vehicle selection first, then road selection.
  - **`SelectionPanel` (road)** shows capacity, travel time now / free flow, vehicles, queued and exits. The values carry test ids `link-capacity`, `link-cost`, `link-freeflow`.
  - **Hook additions:**
    - `snapshot()` gains `trackedTrip: number | null`, `trackedRoute: number[]`, `trackedState: string | null`, `following: boolean`, `frameRecords: number` and `camera: { cx, cy, zoom }`;
    - `vehicleScreenCenter(record) -> [x, y] | null` for the current frame, unextrapolated;
    - `trackedScreenCenter() -> [x, y] | null`: where the tracked vehicle is drawn now, i.e. the same extrapolated position the renderer and Follow use (null when not tracked or not on a link);
    - `linkScreenPoint(link, t) -> [x, y] | null`, the point at fraction t along the drawn link;
    - `pickAt(x, y) -> { vehicle: number | null; link: number | null }`, exactly what a click there would select, without selecting.
  - **`TrackedVehicle.state`** is a string: `'waiting' | 'driving' | 'queued' | 'stranded' | 'no_route'`, mapped from the detail's state code.
  - **Selections coexist.** A selected road and a tracked vehicle can both be active: selecting one never clears the other.
  - **Vehicle panel.** It is a region labelled "Selected vehicle", with its title under test id `vehicle-title`. Its buttons are "Follow" and "Stop following".

## Specification
- **Panel text.** The vehicle panel title is `Trip #<id>: <origin zone name> → <destination zone name>` (names from `ReadyMessage.zones`; a non-zone node shows `node <id>`). State is shown as text plus an icon, never colour alone. It also shows speed in km/h, time on trip (sim), road (link id), route switches, and "waiting for space <n> s" when `blockedTicks > 0`. "Follow" and "Stop following" buttons are keyboard reachable.
- **Gone.** After `TrackedGone` the panel shows "Arrived after m:ss" (completed), "Removed: no route" or "Removed: gridlock", follow turns off, and the selection clears when the user dismisses the panel or presses Escape.
- **Route highlight.** A dashed centre line ≥ 2 CSS px along the remaining route links, near-white (luminance ≥ 235) and not hue-coded. It is drawn above the roads and below the vehicles.
- **Tracked ring.** A ring around the tracked vehicle, symmetric about the vehicle: line width ≥ 2 px, outer radius 7–12 CSS px in screen space (independent of zoom), near-white (luminance ≥ 235) with a dark edge, visible in grayscale.
- **Road panel formats.** Capacity is a plain integer plus ` veh/h` (e.g. `900 veh/h`). Travel times are seconds as an integer or one decimal plus ` s` (e.g. `57 s`, `57.5 s`).
- **Budget.** At most one `vehicle_detail`, one `trip_outcome` (only when the detail says not live) and one `link_detail` per encoded frame. The trip table costs O(on-network) per encode, and that work is already done in `write_vehicle_records`.
- **Determinism.** The queries are read-only. `removed_log` is the only new state (needed for `trip_outcome`).

## Tests
Rust tests are in `crates/sim-core/tests/city_003_inspect.rs`, Vitest in `web/tests/inspect.test.ts`, and Playwright in `web/e2e/inspect.spec.ts`.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `vehicle_at_matches_frame_order` (rust) | for every on-network vehicle, `vehicle_at(link, lane, i)` returns the trip id of the i-th record of that lane in `write_vehicle_records` order. Out-of-range lane or index gives None |
| 2 | `vehicle_by_trip_reports_live_vehicles` (rust) | live trips return info whose `origin`/`dest` match `generated_trips`. Completed and removed trips return None, and so do never-spawned ids |
| 3 | `trip_outcome_explains_disappearance` (rust) | a completed trip reports its exact travel time; a removed unreachable trip, a gridlock-removed trip (ring), a live trip and a never-spawned id report their own outcomes. Each comes from a real scenario |
| 4 | `link_stats_match_world` (rust) | `vehicles` = `link_count`; `queued` = vehicles with v < 2; `cost_s == link_cost`; `free_flow_s` follows C1; `exits == link_exit_count` |
| 5 | `inspection_does_not_change_state` (rust) | calling every query on every tick leaves `state_hash` identical to a run without queries |
| 6 | `vehicle_detail_layout_roundtrip` (vitest, real wasm) | for a sample of frame records, `decodeVehicleDetail(sim.vehicle_detail(sim.trip_at_record(tick, i)))` gives that record's link, lane and s (f32 rounding), state codes consistent with the record's flags, and a route starting with the current link |
| 7 | `worker_tracks_one_vehicle` (vitest, host) | a vehicle on its final link with ≥ 30 m to go (tick ≈ 288): after `inspectVehicle`, every frame carries `tracked` for that trip. When it completes, exactly one `gone` frame with outcome `completed` and its travel time arrives, then `null`. A counting Proxy checks ≤ 1 `vehicle_detail` / `trip_outcome` / `link_detail` per iteration |
| 8 | `pick_resolves_against_the_frames_tick` (vitest, host) | a pick with an older frame's tick resolves to the vehicle that was at that record in that frame, even though a different vehicle is at that record now. A tick that is no longer retained selects nothing |
| 9 | `pickVehicle_nearest_within_tolerance` (vitest) | the nearest centre within 8 px wins, ties go to the lower record, and nothing is picked beyond the tolerance |
| 10 | `link_detail_capacity` (vitest, real wasm) | the Old Bridge link detail shows `capacityVph ≤ 900`. A 2-lane default road shows 3600. `cost_s ≥ free_flow_s`. `NetworkArrays.linkSatFlow` matches |
| 11 | `click_vehicle_opens_panel` (e2e) | paused and zoomed to ≥ 1.5 px/m (the picking rule), clicking a vehicle's screen centre opens the vehicle panel titled "Trip #… : origin → destination" with zone names, and `trackedTrip` is set |
| 12 | `tracked_vehicle_ring_and_route_visible` (e2e, grayscale pixels) | from tick ≥ 450, zoomed in and paused: after selecting, near-white pixels appear around the tracked vehicle off the road axis on *both* sides (≥ 4 each, ≥ 12 total; the ring, not a one-sided route line), and around the midpoint of a remaining route link ≥ 30 px away. The boxes are verified to be canvas, and the pixels are absent before selecting |
| 13 | `follow_keeps_vehicle_centred` (e2e) | from tick ≥ 450, zoomed to ≥ 2 px/m, a *driving* vehicle with ≥ 2 route links left, followed at 1×: ≥ 4 samples within 12 px of the canvas centre over 3 s, and the camera centre moves ≥ 5 m. A drag turns follow off |
| 14 | `vehicle_gone_message` (e2e) | following a vehicle to its destination at 60× shows "Arrived after m:ss" (or a removal reason) and stops following |
| 15 | `road_panel_real_stats` (e2e) | selecting the Old Bridge shows capacity ≤ 900 veh/h and travel time now vs free flow, in the pinned formats. It is not congested before. After closing the main bridge, "travel time now" exceeds free flow within 6 sim min at 20× |
| 16 | `keyboard_escape_order` (e2e) | with a road selected at fit zoom and a vehicle tracked after zooming in: Escape first clears the vehicle selection (and following), then the road selection. The Follow button is reachable with Tab and works with Enter |
| 17 | `fit_zoom_clicks_select_roads_not_vehicles` (e2e) | (Red r1 M3) at fit zoom, `pickAt` on vehicle centres never returns a vehicle and returns the road. A click there selects a road and tracks nothing |

## Must NOT
- Per-vehicle WASM calls, per-frame JSON of vehicles, or x/y positions from Rust (the renderer still maps link + s).
- Colour-only state signalling in the panel or on the map.
- Editing approved earlier tests.

## Must DO
- Keep the frame record format (16 bytes) unchanged.
- Tracking costs O(route length) per frame plus the trip table, never O(vehicles) JS work.
- All earlier suites stay green unchanged. The Gold reviewer runs `city.spec`, `review1`, `review2` and `gold5` three times each: their road clicks happen at fit or one-notch zoom, below `VEHICLE_PICK_MIN_ZOOM`.
- The Gold reviewer reads `state_hash` to confirm that it covers `removed_log`.

## Manual Smoke Test
### Setup
```
pnpm -C web build:wasm && pnpm -C web dev
```
### Steps
1. Click a car on the Main Bridge.
   Verify: the panel shows its trip with district names. A ring and a dashed route appear. Follow keeps it centred.
2. Close the main bridge, then click a car approaching it.
   Verify: its route changes (the switch count rises by 1), and the dashed line moves to another bridge.
3. Click the Old Bridge.
   Verify: capacity ≤ 900 veh/h. After the closure, travel time now > free flow.
### Pass criteria
- [ ] All Rust, Vitest and Playwright tests green, clippy clean, build OK
- [ ] Follow is smooth (no visible jitter at 1×), and the ring and route are visible in grayscale

## Verification
The Gold reviewer performs the smoke steps with Playwright (screenshots and a grayscale check) and runs all suites.
