---
ward: 1
revision: null
name: "Road network, vehicles, queues and discharge"
epic: "core"
status: "red"
dependencies: []
layer: "rust"
estimated_tests: 18
created: "2026-10-06"
completed: null
---
# Ward core-001: Road network, vehicles, queues and discharge

## Scope
Create the Cargo workspace and the `sim-core` crate with the directed road network, vehicle storage, the per-lane ordered queues, car-following-lite movement, and node discharge with saturation-flow credits and downstream-space checks. Vehicles are spawned with an **explicit route** (routing and demand come in core-002). This ward establishes the physical traffic model (tick steps 4–7 of the model contract in `.wdd/epics/core.md`), and every later ward builds on it.

## Inputs
- Model contract: `.wdd/epics/core.md` (constants, tick order, discharge, movement, conservation).

## Outputs
- `Cargo.toml` workspace with `crates/sim-core`.
- `sim_core::params`: all constants from the contract table (later wards add to this module, not elsewhere).
- `sim_core::network`: `NodeId`, `LinkId`, `Node`, `Link`, `Network`, `NetworkBuilder`, `NetworkError`.
- `sim_core::world`: `World`, `VehicleId`, `VehicleView`, `Counts`, `SpawnError`.
  - `World::new(network) -> World`
  - `World::spawn_with_route(route: Vec<LinkId>) -> Result<VehicleId, SpawnError>`: validates a contiguous route and enqueues the vehicle in the origin buffer of `route[0].from` (state WaitingAtOrigin).
  - `World::step()`: one tick (steps 4–7; steps 1–3 are no-ops until later wards).
  - `World::tick()`, `World::counts() -> Counts { spawned, active, on_network, waiting_at_origin, completed, removed }`.
  - `World::link_vehicles(LinkId) -> Vec<VehicleView { id, lane, s, v }>` (lane ascending, front-first within lane); `World::link_count(LinkId)`; `World::origin_buffer_len(NodeId)`; `World::link_exit_count(LinkId) -> u64` (cumulative vehicles that left the link by transfer or completion).
  - `World::completed_log() -> &[CompletedTrip { trip_id, created_tick, completed_tick }]`.
  - `World::check_invariants() -> Result<(), String>`: conservation, ordering/spacing, capacity, no NaN. Tests call it every tick.
- `World: Clone`. No `Rc`, no `HashMap` iteration, no wall clock.

## Specification
Implements exactly the contract's sections **Network**, **Vehicles**, **Tick order** steps 4–7, plus completion at the end of the route.
- `NetworkBuilder::node(x_m, y_m) -> NodeId`, `link(from, to, speed_limit_mps, lanes) -> LinkId` (length = Euclidean distance), `link_with_length(from, to, length_m, speed, lanes)`, `two_way(a, b, speed, lanes) -> (LinkId, LinkId)`, `build() -> Result<Network, NetworkError>`.
- Validation: unknown node, self-loop, length < 10 m (`MIN_LINK_LENGTH`) or non-finite, speed ≤ 0 or non-finite, lanes == 0 or > 8 → error. The builder never panics: `link()` to an unknown node returns an id and the error surfaces in `build()`.
- `Network::lane_capacity(link)` = `max(1, floor(len / 7.5))`, `Network::capacity(link)` = `lanes × lane_capacity`.
- Lane credit: at the start of each lane's discharge evaluation, `credit = min(1.0, credit + 0.25)`.
- Spawn validation: route non-empty, consecutive links share nodes (`a.to == b.from`) → else `SpawnError::NonContiguousRoute` / `EmptyRoute` / `UnknownLink`.
- Trip IDs assigned sequentially from 0 by spawn order. `created_tick` = tick at spawn.
- A vehicle on the last link of its route reaching the stop line completes in discharge (step 4) without using credit. It is logged in `completed_log` and leaves the link.
- `speed_factor` = 1.0 in this ward (behavior RNG arrives in core-002).

## Tests

All in `crates/sim-core/tests/core_001_physics.rs` (Given/When/Then comments).

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `builder_computes_length_and_capacity` | Euclidean length, lane_cap = floor(len/7.5) (min 1), cap = lanes·lane_cap, sorted adjacency |
| 2 | `builder_rejects_invalid_links` | unknown node, self-loop, < 10 m, zero speed, zero/too many lanes → specific `NetworkError` |
| 3 | `spawn_rejects_invalid_routes` | empty, unknown link, non-contiguous route rejected; nothing counted as spawned |
| 4 | `free_flow_vehicle_travel_time_matches_kinematics` | lone vehicle on a 1000 m, 10 m/s link completes within the analytic time ± 2 ticks; speed never exceeds the limit; per-tick displacement ≤ vmax·DT |
| 5 | `vehicles_never_overlap_or_reorder` | heavy load on 1- and 3-lane links: every tick, consecutive vehicles in a lane keep `s_leader − s_follower ≥ 7.5 − 1e-3`, and `s` is non-decreasing per vehicle while on a link |
| 6 | `storage_capacity_never_exceeded` | saturating demand: `link_count ≤ capacity` for every link, every tick |
| 7 | `discharge_rate_bounded_by_saturation_flow` | 1-lane and 2-lane links under demand above capacity pass ≤ lanes·0.5·T + lanes vehicles in T seconds and ≥ 90 % of lanes·0.5·T when downstream is free (2 lanes: standing queue; 1 lane: entry-bound) |
| 8 | `queue_spills_back_through_two_links` | 3-lane → 1-lane bottleneck → sink: the bottleneck fills (≥ 95 % of cap), then the upstream link fills (≥ 95 %) with a front stopped at its stop line, then the origin buffer grows (≥ 5) |
| 9 | `blocked_front_vehicle_holds_followers` | while downstream is full, no vehicle crosses the node; the front waits at the stop line (s = length, v = 0) |
| 10 | `conservation_holds_every_tick` | `spawned == active + completed + removed` and `active == on_network + waiting_at_origin` every tick of a mixed scenario |
| 11 | `completion_logs_travel_time` | completed trips are logged with correct created ticks and exact completed ticks (65/75/85), and they leave the network |
| 12 | `merge_shares_capacity_round_robin` | two saturated feeders into one link, plus a third in-link whose trips end at the merge node: each feeder gets 40–60 % over 10 minutes (completions don't advance `rr_next`) |
| 13 | `lane_credit_limits_moving_platoon` | moving traffic denser than 0.5 veh/s at a 1-lane stop line: from the first exit, crossings ≤ 1 + 0.25·n over n ticks (credit cap 1.0, 0.25/tick) |
| 14 | `lane_choice_prefers_most_room_and_vehicles_keep_lane` | asymmetric arrivals (ticks 0,0,5,12) give lanes 0,1,0,1, which distinguishes "tail furthest ahead" from "lowest feasible lane"; no lane changes (also checked under congestion in test 5) |
| 15 | `origin_admission_is_rate_limited_fifo_and_starts_at_rest` | ≤ 2 admissions per origin per tick, FIFO, at s = 0 and v = 0; a blocked first link blocks only later vehicles for the same link |
| 16 | `sink_completion_does_not_consume_credit` | free-flowing feed (asserted) into a 1-lane final link: completions exceed 1.3 × the credit rate |
| 17 | `empty_lanes_bank_credit` | a lone cruising vehicle crosses a 10 m link without slowing below 5 m/s, travel exactly 152 ticks (credit banked while the lane was empty) |
| 18 | `speed_limit_change_along_route` | 13.9 → 8.0 m/s route: never above the current link's limit; completes at tick 85 |

## Must NOT
- No routing, demand, closures or RNG (later wards). No WASM/browser dependencies in `sim-core`.
- No `HashMap`/`HashSet` in simulation state or iteration. No `std::time`. No `unsafe`.
- No screen coordinates or drawing concepts.
- Don't weaken test thresholds to make them pass.

## Must DO
- Follow the tick order and formulas in the model contract exactly. If an ambiguity is found, update the contract (epic file) and note it in the review.
- Make `World` and `Network` `Clone + Debug`.
- Have `check_invariants()` cover conservation, ordering/spacing, capacity and finite values.

## Manual Smoke Test
### Setup
```
cd <worktree root>
cargo build -p sim-core --examples
```
### Steps
1. Run: `cargo test -p sim-core --test core_001_physics`
   Expected: `test result: ok. 18 passed`
2. Run: `cargo run -p sim-core --example bottleneck`
   Verify: the printed table (every 30 s sim time) shows the bottleneck link reaching its capacity first, then the upstream link filling, then the origin buffer growing. Discharged count per minute ≈ 30 for the 1-lane bottleneck.
### Pass criteria
- [ ] All 18 tests pass
- [ ] Bottleneck example output shows spillback order: bottleneck → upstream → origin
- [ ] `cargo clippy -p sim-core -- -D warnings` clean

## Verification
`cargo test -p sim-core` green, clippy clean, Gold reviewer reproduces the smoke test output.
