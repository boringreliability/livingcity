---
ward: 2
revision: null
name: "Demand, routing and metrics"
epic: "core"
status: "planned"
dependencies: ["core-001"]
layer: "rust"
estimated_tests: 13
created: "2026-10-06"
completed: null
---
# Ward core-002: Demand, routing and metrics

## Scope
Make the city generate its own traffic and send it along sensible routes. Seeded, reproducible demand (a pure function of seed and tick), a separate behavior RNG, congestion-aware link costs with epoch smoothing, a deterministic shortest-path router, and the metric set the UI will show. After this ward a `World` built from a scenario runs by itself: trips appear, find routes from the router, drive, queue and complete.

## Inputs
- core-001: `Network`, `World` (lanes, discharge, movement, completion, `link_exit_count`, `completed_log`, `check_invariants`).
- Model contract `.wdd/epics/core.md`: sections Demand, Routing, Metrics.

## Outputs
- `sim_core::rng`: `splitmix64(u64) -> u64`, `mix3(a, b, c) -> u64`, `unit_f64(u64) -> f64` in [0, 1) (53-bit), `BehaviorRng` (stateful, `Clone`, `next_u64`, `next_f64`).
- `sim_core::demand`: `OdFlow { origin, dest, veh_per_hour }` (origin must be a zone or a source node; `DemandModel::validate(&Network)` rejects other origins), `Profile` (piecewise-linear `(sim_s, multiplier)` points, constant outside the range, empty = 1.0), `DemandModel { flows, profile }`, `pub fn trips_at(model: &DemandModel, demand_seed: u64, tick: u64) -> Vec<TripRequest { flow_index, origin, dest }>` (**pure**; flow order, then k).
- `sim_core::routing`: `free_flow_cost(link) -> f64`, `Router` (reverse Dijkstra per destination; trees cached per `(dest, cost_epoch)`; integer-millisecond keys; tie → lower link id).
- `World` additions:
  - `Scenario { network, demand: DemandModel, demand_seed: u64, behavior_seed: u64 }` and `World::from_scenario(Scenario)`. `World::new(network)` remains (empty demand, seeds 0).
  - Demand spawn in tick step 2: each `TripRequest` becomes a vehicle in its origin buffer with `created_tick = tick`, `speed_factor` ~ U[0.9, 1.1] from `BehaviorRng`, route from the router (origin → dest). With no route, it enters `NoRoute` in the origin buffer (retry/removal semantics are core-003).
  - `World::generated_trips() -> &[GeneratedTrip { trip_id, flow_index, origin, dest, created_tick }]` (demand-generated only; explicit `spawn_with_route` is not demand).
  - `World::link_cost(LinkId) -> f64` (current smoothed cost, s), `World::cost_epoch() -> u64`, `World::shortest_route(from: NodeId, to: NodeId) -> Option<(Vec<LinkId>, f64)>`.
  - `World::vehicle(VehicleId) -> Option<VehicleInfo { trip_id, route, route_pos, state, speed_factor, lane, s, v }>`, `World::vehicle_ids() -> Vec<VehicleId>` (ascending), `VehicleState { WaitingAtOrigin, OnLink(LinkId), NoRoute }`.
  - `World::metrics() -> Metrics { tick, sim_time_s, trips_generated, spawned, active, on_network, waiting_at_origin, no_route, queued, completed, removed_unreachable, unreachable, mean_travel_time_s: Option<f64>, incomplete, mean_incomplete_age_s: Option<f64> }` and `World::mean_travel_time_s_between(from_tick, to_tick) -> Option<f64>` (trips completed in `[from, to)`).
- `Counts` gains `no_route`, and the invariant becomes `active == on_network + waiting_at_origin + no_route`.

## Specification
- **Demand** exactly as in the contract: `expected = veh_per_hour / 3600 × DT × profile(tick × DT)`, count = `floor(expected)` + (`unit_f64(splitmix64(mix3(seed, tick, flow_index))) < frac(expected)`). No `exp`/`ln`/trig anywhere in the sim (native ≡ WASM).
- Trip IDs: one global sequential counter shared with explicit spawns (core-001 behavior unchanged). Demand trips are spawned in `trips_at` order.
- **Behavior RNG**: `BehaviorRng::new(behavior_seed)`, used only for behavioral draws (speed factor now). Never used by demand.
- **Link costs**: initial = `free_flow_cost = length/vmax + 1/(lanes × SAT_FLOW_PER_LANE)`. Each exit records `(exit_tick − link_enter_tick) × DT` into per-link epoch accumulators. At ticks where `tick > 0 && tick % COST_EPOCH_TICKS == 0`, in step 3: `obs = max(mean_exit_time if any, queue_term)`, `queue_term = count / (lanes × SAT_FLOW_PER_LANE) + length / vmax`, `smoothed = α·obs + (1−α)·smoothed`, `cost = max(free_flow, smoothed)`, accumulators reset, `cost_epoch += 1`. Costs therefore change only at epoch boundaries.
- **Router**: reverse Dijkstra from `dest` over in-links, key `round(cost × 1000) as u64`, ties broken by lower link id (then lower node id). **Never relaxes through a zone**: a zone node can only be a route's origin or its destination (decision `zone-centroids`). Returned routes always pass core-001 spawn validation. The cache is invalidated by epoch change (and, in core-003, closure changes). The cache is not part of `state_hash` (derived data).
- **Metrics**: `queued` = on-network vehicles with `v < QUEUED_SPEED`. `mean_travel_time_s` over all completed trips, `(completed − created) × DT`. `incomplete = active`, `mean_incomplete_age_s` = mean of `(tick − created) × DT` over active vehicles. `unreachable = removed_unreachable + no_route`.

## Tests

All in `crates/sim-core/tests/core_002_demand_routing.rs`.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `demand_is_pure_function_of_seed_and_tick` | `trips_at` is order-independent and repeatable; the world's demand log equals `trips_at` over the ticks run |
| 2 | `demand_differs_across_seeds` | another seed gives another trip sequence with a similar total |
| 3 | `demand_mean_rate_matches_model` | 600 veh/h over 4 h sim gives 2400 ± 5 % trips; a 7200 veh/h flow (expected > 1 per tick) is also within ± 3 % |
| 4 | `profile_scales_demand` | multiplier 0 gives no trips; a piecewise ramp interpolates linearly; 2× multiplier gives ≈ 2× trips |
| 5 | `demand_ignores_world_state` | a congested world (lots of explicit spawns) and an empty world produce identical demand logs (flow, origin, dest, tick) |
| 6 | `router_finds_free_flow_shortest_path` | 3×3 grid with a fast ring and zones on two corners: the router picks the analytically cheapest path, reports its cost, and never routes through a third zone even when it would be shorter |
| 7 | `router_ties_broken_by_lowest_link_id` | symmetric diamond: always routes via the lower link id, independent of builder insertion of other links |
| 8 | `unreachable_destination_yields_no_route_state` | one-way dead end: `shortest_route` → None, the demand vehicle enters `NoRoute`, and metrics count it as unreachable |
| 9 | `congestion_raises_link_cost` | a congested link's cost rises > 1.5× free flow, and an unused link stays at free flow |
| 10 | `costs_change_only_at_epochs_and_relax_to_free_flow` | cost is constant within an epoch, never below free flow, and returns to free flow within 10 epochs after the network empties |
| 11 | `demand_vehicles_follow_valid_routes_and_complete` | grid OD demand: every vehicle's route is contiguous from its trip origin to its dest, its current link = route[route_pos], trips complete, and conservation holds every tick |
| 12 | `behavior_rng_is_separate_from_demand` | speed factors lie in [0.9, 1.1] and are not constant; the same behavior seed gives the same factors; a different behavior seed gives an **identical** demand log but different factors |
| 13 | `metrics_match_definitions` | `queued`, `active`, `unreachable`, `mean_travel_time_s` (and windowed), `incomplete` and its mean age are recomputed by hand from vehicle views and logs and agree exactly |

## Must NOT
- No transcendental float functions (`exp`, `ln`, `powf`, trig) in sim logic. No `HashMap`/`HashSet`. No wall clock.
- Do not let demand generation read or mutate any world state other than appending spawned trips.
- No closures or reroute scheduling yet (core-003). Don't change core-001 test expectations.

## Must DO
- Keep `World: Clone`. Put the router cache in a field that is clearly derived (documented as rebuildable).
- Run every core-001 test unchanged and green.
- Add a `smoke` example that runs a small two-zone scenario and prints metrics every 60 s sim time.

## Manual Smoke Test
### Setup
```
cargo build -p sim-core --examples
```
### Steps
1. Run: `cargo test -p sim-core`
   Expected: core_001 (12) and core_002 (13) all pass.
2. Run: `cargo run -p sim-core --example smoke`
   Verify: every 60 s sim-time line shows `generated`, `active`, `queued`, `completed`, `mean_tt`. `generated` grows ≈ at the configured rate, completed > 0 after the first few minutes, `generated == active + completed + removed` on every line.
3. Run the smoke example twice and `diff` the outputs.
   Expected: identical output (determinism).
### Pass criteria
- [ ] 25 tests green
- [ ] Smoke output plausible and conserving
- [ ] Two runs are byte-identical

## Verification
`cargo test -p sim-core` green, `cargo clippy -p sim-core -- -D warnings` clean, Gold reviewer reproduces the smoke test.
