---
ward: 3
revision: null
name: "Inspect vehicles and roads"
epic: "city"
status: "planned"
dependencies: ["city-002"]
layer: "typescript"
estimated_tests: 16
created: "2026-10-07"
completed: null
---
# Ward city-003: Inspect vehicles and roads

## Scope
The brief requires "inspect roads and vehicles" and "cars you can follow". Clicking a vehicle selects it:
- a panel shows its trip;
- its remaining route is highlighted on the map;
- an optional **Follow** mode keeps the camera on it.

Clicking a road shows real link statistics from the simulation (vehicles, queued, current travel cost vs free flow, capacity in veh/h, exits). The data follows `.wdd/epics/city.md` § C4: on-demand queries, one tracked vehicle and one link detail per frame, with no per-vehicle calls or JSON.

## Inputs
- core-004/005: `Sim` adapter, worker host and protocol, `client.ts`, `frame.ts` AoS decoder, `picking.ts`, `geometry.vehiclePosition`, renderer state texture, `SelectionPanel`, the `window.__livingcity` hook.
- city-001: `VehicleInfo.blocked_ticks`, `Link.sat_flow_per_lane`. city-002: River City and zones (names for origin/destination).

## Outputs
- **Rust:**
  - `World::vehicle_at(link, lane, index_from_front) -> Option<u64>`;
  - `World::vehicle_by_trip(trip_id) -> Option<VehicleInfo>` (live vehicles only);
  - `World::link_stats(link) -> LinkStats { vehicles: u32, queued: u32, cost_s: f64, free_flow_s: f64, exits: u64 }`;
  - `World::trip_outcome(trip_id) -> TripOutcome::{Live, Completed { travel_time_s }, RemovedUnreachable, RemovedGridlock, Unknown}`, which tells the UI why a followed vehicle vanished;
  - `VehicleInfo` gains `origin: NodeId` and `dest: NodeId`;
  - `NetworkExport.link_sat_flow`.
- **sim-wasm:** `Sim::vehicle_at`, `Sim::vehicle_detail(trip_id) -> Vec<f64>` (fixed header + remaining route ids, layout documented in `protocol.ts`), `Sim::link_detail(link) -> Vec<f64>`, `Sim::trip_outcome(trip_id) -> u32 + travel time`, `Sim::link_sat_flow()`.
- **Protocol:**
  - `ToWorker` gains `{ type: 'inspectVehicle', link, lane, index } | { type: 'inspectVehicle', clear: true }` and `{ type: 'inspectLink', link: number | null }`.
  - `FrameMessage` gains `tracked: TrackedVehicle | TrackedGone | null` and `linkDetail: LinkDetail | null`.
  - `NetworkArrays` gains `linkSatFlow`.
- **TS:**
  - `picking.pickVehicle(frame, geometry, camera, x, y, tolerancePx) -> { link, lane, index } | null` (CPU, from the decoded frame).
  - A `VehiclePanel` component.
  - Route highlight in the renderer.
  - Follow mode in `App`.
  - `snapshot()` gains `trackedTrip: number | null` and `following: boolean`.

## Specification
- **Picking.** A click first tries vehicles (nearest drawn vehicle centre within 8 CSS px, using the same extrapolation-free positions as the last frame), then roads (existing). The vehicle's `index_from_front` is its order in the frame records (links → lanes → front first, core-004), so the worker resolves it with `vehicle_at` on the same tick. If the frame's tick differs from the worker's current tick, the worker resolves it against the stored last-encoded frame's ordering (it keeps the last frame's `(link, lane, index) → trip_id` table) to avoid picking the wrong car.
- **Tracking.** Each frame, the worker encodes the tracked vehicle's detail:
  - trip id, origin/destination node, state (`driving`, `queued`, `waiting at origin`, `stranded`, `no route`), link, lane, s, v, age in sim s, route switches, `blocked_ticks`, remaining route.
  - When the vehicle leaves the network or the slot table, the next frame carries `{ gone, tripId, outcome, travelTimeS? }` once. Tracking then stops.
- **Route highlight.** The remaining route links are drawn with a screen-space dashed centre line of at least 2 px, light, not hue-coded, above the roads and below the vehicles. The tracked vehicle gets a ring of at least 3 px around it, visible in grayscale.
- **Follow.** While on, the camera centre is set to the tracked vehicle's extrapolated world position every rAF (no easing). Panning by drag or keys turns follow off. Escape clears the vehicle selection, then the road selection.
- **Vehicle panel.** It shows:
  - "Trip #id: Origin name → Destination name" (zone names from `ReadyMessage.zones`);
  - state as **text plus an icon** (never colour alone), speed in km/h, time on trip (sim), road (link id + street role), route switches, and "waiting for space 45 s" when `blocked_ticks > 0`;
  - "Follow" and "Stop following" buttons, keyboard reachable.
- **Road panel** (extends `SelectionPanel`):
  - capacity = `lanes × sat_flow × 3600` veh/h;
  - travel time now vs free flow (s), vehicles, queued, exits since start;
  - the Old Bridge shows its lower capacity explicitly.
- **Budget.** At most one `vehicle_detail` and one `link_detail` call per encoded frame. No per-vehicle JS↔WASM calls.

## Tests
Rust in `crates/sim-core/tests/city_003_inspect.rs`, Vitest in `web/tests/inspect.test.ts`, Playwright in `web/e2e/inspect.spec.ts`.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `vehicle_at_matches_frame_order` (rust) | for every on-network vehicle, `vehicle_at(link, lane, i)` returns the trip id of the i-th record of that lane in `write_vehicle_records` order. Out-of-range gives None |
| 2 | `vehicle_by_trip_reports_live_vehicles` (rust) | live trips return info with `origin`/`dest` matching `generated_trips`. Completed or removed trips return None |
| 3 | `trip_outcome_explains_disappearance` (rust) | Completed (with exact travel time), RemovedUnreachable, RemovedGridlock and Unknown, each produced by a real scenario |
| 4 | `link_stats_match_world` (rust) | vehicles/queued equal `link_count` and the queued definition. `cost_s == link_cost`. `free_flow_s` follows C1. `exits == link_exit_count` |
| 5 | `inspection_does_not_change_state` (rust) | calling every query each tick leaves `state_hash` identical to a run without queries |
| 6 | `vehicle_detail_layout_roundtrip` (vitest, real wasm) | the documented header layout decodes to the same values as `vehicle_by_trip`. The remaining route is the tail of `route` from `route_pos` |
| 7 | `worker_tracks_one_vehicle` (vitest, host) | after `inspectVehicle`, every frame carries `tracked` for that trip. After it completes, exactly one `gone` with outcome `completed`, then `null` |
| 8 | `pick_resolves_against_the_frames_tick` (vitest, host) | a pick sent with a stale frame's indices resolves to the vehicle that was at that index in that frame, not to a different vehicle that moved into the slot |
| 9 | `pickVehicle_nearest_within_tolerance` (vitest) | nearest centre within 8 px wins, ties go to the earlier record, and nothing is picked beyond the tolerance |
| 10 | `link_detail_capacity` (vitest) | the Old Bridge capacity shows ≤ 900 veh/h. A 2-lane default road shows 3600 veh/h |
| 11 | `click_vehicle_opens_panel` (e2e) | clicking a moving vehicle at fit zoom (paused) opens the vehicle panel with "Trip #… : origin → destination" names from the city's zones |
| 12 | `tracked_vehicle_ring_and_route_visible` (e2e, grayscale pixels) | after selecting, the ring pixels around the vehicle and a dashed line along the next route link are present in a grayscale screenshot, and absent before selecting |
| 13 | `follow_keeps_vehicle_centred` (e2e) | with Follow on and the sim running, the tracked vehicle's screen position stays within 12 px of the canvas centre over 3 s. A drag turns follow off |
| 14 | `vehicle_gone_message` (e2e) | following a vehicle to its destination (at 60×) shows "Arrived after m:ss" and stops following |
| 15 | `road_panel_real_stats` (e2e) | selecting the Old Bridge shows its capacity (≤ 900 veh/h) and travel time now vs free flow. Closing the main bridge makes "travel time now" rise above free flow within 5 sim min at 20× |
| 16 | `keyboard_escape_order` (e2e) | Escape first clears the vehicle selection, then the road selection. Both panel buttons are reachable with Tab and work with Enter |

## Must NOT
- Per-vehicle WASM calls, per-frame JSON of vehicles, or moving positions from Rust as x/y (the renderer still maps link + s).
- Colour-only state signalling in the panel or on the map.
- Edit approved earlier tests.

## Must DO
- Keep the frame record format (16 bytes) unchanged.
- Tracking costs O(route length) per frame, not O(vehicles).

## Manual Smoke Test
### Setup
```
pnpm -C web build:wasm && pnpm -C web dev
```
### Steps
1. Click a car on the Main Bridge.
   Verify: the panel shows its trip (district names). A ring and a dashed route appear. Follow keeps it centred.
2. Close the main bridge, then click a car approaching it.
   Verify: its route changes (switch count +1), and the dashed line moves to another bridge.
3. Click the Old Bridge.
   Verify: capacity ≤ 900 veh/h. After the closure, travel time now > free flow.
### Pass criteria
- [ ] All Rust, Vitest and Playwright tests green, clippy clean, build OK
- [ ] Follow is smooth (no jitter visible at 1×), and the ring and route are visible in grayscale

## Verification
The Gold reviewer performs the smoke steps with Playwright MCP (screenshots + grayscale check) and runs all suites.
