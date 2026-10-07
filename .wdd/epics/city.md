---
epic: "city"
name: "River city"
status: "active"
created: "2026-10-07"
---
# Epic: River city

## Goal
Replace the core test city with the final, hand-designed **River City** and make the demo's consequences visible and understandable. The brief's step 4 is "visible queue propagation and sensible rerouting". Concretely:
- A river splits the town. There are three crossings: a 2+2-lane Main Bridge, a North Bridge, and an **Old Bridge** with limited capacity (the brief's "alternative route with limited capacity").
- The town has residential districts, workplaces and a hospital.
- Fixed demand calibrated to **≈ 2,000 active vehicles**. Closing the Main Bridge oversaturates the alternatives, so queues visibly spill back through streets.
- Gridlock relief, so oversaturation never freezes the city.
- The user can inspect and follow a vehicle and inspect a road.
- The 2D miniature-city look: water, bridges, buildings, district labels, level of detail, plus the open renderer MINORs from core-005.
- A living opening screen, an expandable diagnostics panel, and **measured** browser performance.

Timeline, branching and comparison stay in epic `timeline`. Accessibility pass, first-run walkthrough and optimisation stay in epic `polish`.

## Wards
| Ward | Name | Status |
|------|------|--------|
| city-001 | Capacity attributes and gridlock relief | planned |
| city-002 | River City network and calibrated demand | planned |
| city-003 | Inspect vehicles and roads | planned |
| city-004 | The miniature city look | planned |
| city-005 | Living opening screen, diagnostics and measured performance (integration ward) | planned |

## Contract additions (binding; the core contract in `.wdd/epics/core.md` stays in force)

### C1. Per-link saturation flow (city-001)
- `Link` gains `sat_flow_per_lane: f64` (veh/s per lane). The default is `SAT_FLOW_PER_LANE` (0.5).
- `NetworkBuilder::set_sat_flow(link: LinkId, veh_per_s_per_lane: f64)` overrides it. The last call wins. The builder never panics.
- `build()` validation runs per link in id order, after that link's existing checks:
  - The value must be finite and in `(0, MAX_SAT_FLOW_PER_LANE = 2.0]`, else `NetworkError::InvalidSatFlow { from, to }`.
  - After all links are validated, an override for a link id that does not exist gives `NetworkError::UnknownLink(LinkId)`. With several such ids, the lowest one is reported.
- Lane credit per tick is `link.sat_flow_per_lane * DT`, still capped at `LANE_CREDIT_CAP` = 1.0. For the default this is exactly 0.25, so every core result is unchanged.
- Routing uses `lanes × sat_flow_per_lane` wherever the core contract says `lanes × SAT_FLOW_PER_LANE`: in `free_flow` and in `queue_term`.

### C2. Gridlock relief (city-001)
The core contract allows gridlock in cycles. With oversaturation (closing the Main Bridge) the city must not freeze. Relief is deterministic, local and bounded.

- **Blocked front.** In step 4, a lane front whose evaluation reaches the stop line (`reach ≥ length`) is **blocked** iff all of these hold:
  - it is not stranded;
  - it has a next link, which is open (after any forced decision);
  - `choose_lane(next, entry_s)` finds no lane.

  Credit is ignored here: "blocked" is about downstream space, not discharge credit. The check is a pure read, made even when credit < 1.
- **Counter.** Each vehicle has `blocked_ticks: u32`.
  - In an evaluation where the front is blocked: `blocked_ticks += 1`.
  - In any other evaluation of that vehicle as a front (no reach, transfer, completion, credit-limited with space available, stranded, forced decision without route): `blocked_ticks = 0`.
  - It is 0 on entering a link. Vehicles that are not lane fronts keep the value 0.
- **Evaluation order.** Within one evaluation: decide whether the front is blocked → apply the counter (at most one increment per evaluation) → if `blocked_ticks == GRIDLOCK_REMOVE_TICKS`, remove (Relief 2; no reroute attempt) → else, if it is a positive multiple of 120, attempt Relief 1.
- **Relief 1: reroute.** When an evaluation leaves `blocked_ticks` at a positive multiple of `GRIDLOCK_REROUTE_TICKS` = 120 (60 s) **below** `GRIDLOCK_REMOVE_TICKS`, the front is rerouted from its decision point (the current link's `to` node, keeping `route[..=route_pos]`).
  - The search uses current costs and closures, plus the **blocked next link treated as closed for this one search**. It is a fresh Dijkstra with the same algorithm and tie rules as the router, and it is neither cached nor written to the cache.
  - If a path exists, it is assigned (it counts as a switch iff the route changes), and `gridlock_reroutes += 1`. The normal crossing rules then apply to the new next link in the same evaluation. If that new next link also has no space, the vehicle stays blocked: the count continues, it is **not** reset. If it has space but credit < 1, the vehicle stays on its link with the count unchanged in this evaluation (and the next evaluation resets it, credit-limited with space).
  - If no path exists, the route is kept.
  - No hysteresis applies. Gridlock reroutes spend no reroute budget.
- **Relief 2: removal (last resort).** When an evaluation leaves `blocked_ticks == GRIDLOCK_REMOVE_TICKS` = 1200 (10 min), the vehicle is removed from its lane:
  - `removed_gridlock += 1` and `removed += 1`;
  - it is not completed and not an exit;
  - its slot is freed.

  This is the analogue of SUMO's time-to-teleport, chosen over teleporting because it never jumps a vehicle forward. It is documented as a simplification.
- **Metrics.**
  - `Metrics` gains `removed_gridlock` and `unserved` = `unreachable + removed_gridlock`.
  - `Counts.removed` = `removed_unreachable + removed_gridlock`.
  - `RerouteStats` gains `gridlock_reroutes`.
  - `VehicleInfo` gains `blocked_ticks`.
  - `frame::METRIC_NAMES` and `metrics_to_array` stay exactly as in core (core_004 pins them). New `frame::EXTENDED_METRIC_NAMES` = `METRIC_NAMES` + `["removed_gridlock", "unserved"]` and `metrics_to_extended_array` (same order). `sim-wasm` exposes the extended list and array (the web reads metrics by name).
- **Determinism.** `state_hash` covers `blocked_ticks`, `removed_gridlock` and `gridlock_reroutes`. Conservation becomes `spawned == active + completed + removed_unreachable + removed_gridlock` at every tick.

### C3. River City (city-002)
`sim_core::cities::river_city(demand_seed, behavior_seed) -> City`, the city the app shows. `three_bridges` stays for the core tests.

- **River.** It runs roughly north–south. In simulation data it is a corridor `x ∈ [RIVER_WEST_X, RIVER_EAST_X]`, exported as `City.river = (west_x, east_x)`. Only bridge links cross it. The river's visual shape (meanders, banks) is render-side.
- **Crossings.** Exactly three crossings, each a two-way pair:
  - **Main Bridge** (`landmarks.central_bridge`): 2 lanes each way, arterial speed.
  - **North Bridge** (`landmarks.north_bridge`): 1 lane each way.
  - **Old Bridge** (`landmarks.south_bridge`, south): 1 lane each way, `sat_flow_per_lane ≤ 0.25` (≤ 900 veh/h) and ≤ 30 km/h. This is the limited-capacity alternative.
- **Zones.**
  - At least 4 residential zones on the west bank.
  - At least 3 workplace zones, with at least 2 on the east bank.
  - Exactly 1 hospital zone on the east bank.
  - Every zone has a unique name.
- **Demand.** A constant profile, so the demo is the same whenever you look. It is calibrated, not scripted. The targets are verified by tests at seeds (2026, 7), plus at least one other seed pair:
  - **Baseline** (no intervention), mean over sim minutes 30–60:
    - mean `active` in [1600, 2600];
    - `unserved` = 0 and `removed_gridlock` = 0;
    - no link stays ≥ 95 % full for 10 consecutive minutes;
    - the Main Bridge carries > 50 % of west→east crossings.
  - **Main Bridge closed** at 20 min (both directions), measured 10–40 min after the closure:
    - mean `queued` ≥ 2 × the baseline mean over the same window;
    - there is spillback: on at least one approach to the North or Old Bridge, at least 2 consecutive upstream links are each ≥ 80 % full at the same tick;
    - the mean travel time of west→east trips completed in the window is ≥ 1.25 × baseline;
    - `removed_gridlock` ≤ 1 % of trips generated;
    - North + Old Bridge exits exceed baseline.
  - **Reopened** 30 min after the closure: 30 min later, mean `queued` (over 5 min) ≤ 1.5 × baseline.
- `three_bridges` and `river_city` share `City`. `City` gains `name: &'static str` and `river: (f64, f64)`.

### C4. Inspection (city-003)
- **Sim queries, on demand and never per vehicle per frame:**
  - `World::vehicle_at(link, lane, index_from_front) -> Option<u64 /* trip_id */>`;
  - `World::vehicle_by_trip(trip_id) -> Option<VehicleInfo>`;
  - `World::link_stats(link) -> LinkStats { vehicles, queued, cost_s, free_flow_s, exits }`.
- **Worker boundary:**
  - The client sends `inspectVehicle { link, lane, index }` / `inspectVehicle null` and `inspectLink { link } | null`.
  - Every frame carries `tracked` (the followed vehicle's detail plus its remaining route as link ids, or `{ gone: 'completed' | 'removed' }` once) and `linkDetail` for the selected link.
  - Exactly one tracked vehicle and one link detail per frame.
- `NetworkArrays` gains `linkSatFlow` (veh/s/lane), so road capacity can be shown in veh/h.

### C5. Diagnostics (city-005)
- The worker measures the wall time of each `step` batch and of each frame encode. Each frame message carries `perf { tickMsMedian, tickMsP95, encodeMs, ticksMeasured }` over a sliding window of the last 1,000 ticks (median/p95 of per-tick ms = batch ms ÷ ticks in batch).
- The UI measures rAF-to-rAF interval and draw CPU time (median/p95 over the last 300 frames).
- Both are shown in an expandable diagnostics panel, collapsed by default, with vehicle count and frame bytes. Measurement never affects the sim.

## Integration Points
- Builds on `sim_core::{network, world, routing, cities, frame}`, `sim-wasm::Sim`, and `web/src/{sim,render,ui}` from epic core.
- `timeline` will need `World: Clone` (kept), the extended `state_hash`, and the command log. Gridlock state (`blocked_ticks`) is part of the snapshot state.
- `polish` gets the first-run walkthrough, the accessibility audit and optimisation, with a perf baseline from city-005.

## Completion Criteria
- All earlier tests (85 Rust, 45 Vitest, 17 Playwright) stay green **unchanged**, and all city tests are green. Clippy is clean, and the production build works.
- In the browser, the app opens directly on a living River City (≈ 2,000 active vehicles). "Close the main bridge" visibly spills queues back from the Old and North Bridge approaches, and rerouting emerges. A vehicle can be clicked, inspected and followed, and a road can be inspected.
- Measured performance is reported: sim tick and render frame time separately, with median/p95, vehicle counts, browser and hardware, for normal traffic and for the closure burst.
- Human epic gate: demo + commands + review log.
