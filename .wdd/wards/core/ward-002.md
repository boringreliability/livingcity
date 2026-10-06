---
ward: 2
revision: null
name: "Demand, routing and metrics"
epic: "core"
status: "gold"
dependencies: ["core-001"]
layer: "rust"
estimated_tests: 24
created: "2026-10-06"
completed: null
---
# Ward core-002: Demand, routing and metrics

## Scope
Make the city generate its own traffic and send it along sensible routes: seeded, reproducible demand (a pure function of seed and tick), a separate behavior RNG, congestion-aware link costs with epoch smoothing, a deterministic shortest-path router that respects zones, and the metric set the UI will show. After this ward a `World` built from a scenario runs by itself. Trips appear, get routes from the router, drive, queue and complete.

## Inputs
- core-001: `Network` (zones, `in_lanes`), `World` (lanes, discharge, admission, movement, completion, `link_exit_count`, `completed_log`, `check_invariants`, spawn validation).
- Model contract `.wdd/epics/core.md`: sections Demand, Routing, Metrics (binding, including exact expressions).

## Outputs
- `sim_core::rng`: `splitmix64`, `mix3`, `unit_f64`, `BehaviorRng { new(seed), next_u64, next_f64 }` exactly as in the contract.
- `sim_core::demand`: `OdFlow { origin, dest, veh_per_hour }`, `Profile { points: Vec<(f64, f64)> }` + `Profile::at(sim_s)`, `DemandModel { flows, profile }` + `validate(&Network) -> Result<(), DemandError>`, `DemandError::{BadOrigin(NodeId), SameOriginDest(usize), BadRate(usize), BadProfile}`, `TripRequest { flow_index, origin, dest }`, `pub fn trips_at(model, demand_seed, tick) -> Vec<TripRequest>` (**pure**).
- `sim_core::routing`: `free_flow_cost(&Link) -> f64`, `cost_key(cost) -> u64`, `Router` (per-destination trees, cached per cost epoch). The router is used by `World` and also exposed through `World::shortest_route`.
- `World` additions:
  - `Scenario { network, demand: DemandModel, demand_seed, behavior_seed }`, `World::from_scenario(Scenario) -> Result<World, DemandError>`. `World::new(network)` = empty demand, seeds 0.
  - Tick step 2 (demand) and step 3 (epoch cost update) per the contract. Demand vehicles get a router route from origin to dest at spawn (pre-update costs of that tick). With no route, they become `NoRoute` in the origin buffer (retry/removal semantics are core-003; admission skips NoRoute).
  - `generated_trips() -> &[GeneratedTrip { trip_id, flow_index, origin, dest, created_tick }]` (demand only).
  - `link_cost(LinkId) -> f64`, `cost_epoch() -> u64`, `shortest_route(from, to) -> Option<(Vec<LinkId>, f64)>` (current costs).
  - `vehicle(VehicleId) -> Option<VehicleInfo { trip_id, route, route_pos, state, speed_factor, lane, s, v, created_tick }>`, `vehicle_ids() -> Vec<VehicleId>` (ascending), `VehicleState::{WaitingAtOrigin, OnLink(LinkId), NoRoute}`.
  - `metrics() -> Metrics { tick, sim_time_s, trips_generated, spawned, active, on_network, waiting_at_origin, no_route, queued, completed, removed_unreachable, unreachable, mean_travel_time_s: Option<f64>, incomplete, mean_incomplete_age_s: Option<f64> }`, `mean_travel_time_s_between(from_tick, to_tick) -> Option<f64>` (trips with `completed_tick` in `[from, to)`).
- `Counts` gains `no_route`, and the invariants include `active == on_network + waiting_at_origin + no_route`.
- Example `smoke`: a two-zone scenario printing metrics every 60 s sim.

## Specification
See the contract (Demand, Routing, Metrics). Additional:
- `trips_at` uses only its arguments. `World` calls exactly it in step 2, and nothing else in the world can influence demand.
- Trip ids: one global counter shared with explicit spawns. Demand trips are spawned in `trips_at` order.
- `mean_travel_time_s = Σ(completed − created) × DT / n` over the completed log (log order). `mean_incomplete_age_s` = mean of `(tick − created) × DT` over all active vehicles (`vehicle_ids` order).

## Tests

All in `crates/sim-core/tests/core_002_demand_routing.rs`.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `demand_is_pure_function_of_seed_and_tick` | `trips_at` is repeatable and evaluation-order independent; the world's `generated_trips` equal `trips_at` over the ticks run, with sequential trip ids |
| 2 | `demand_differs_across_seeds` | another seed gives a different trip sequence, and the totals are within 5 % |
| 3 | `demand_mean_rate_matches_model` | 600 veh/h × 4 h gives 2400 ± 5 %; 9000 veh/h × 1 h (1.25 per tick: floor + Bernoulli) gives 9000 ± 3 % |
| 4 | `profile_interpolates_in_sim_seconds` | multiplier 0 gives exactly 0 trips; a ramp 0 → 2 over 3600 s gives 3600 ± 3 % in hour 1 and 7200 ± 3 % in hour 2 (clamped after the last point); `Profile::at` exact values |
| 5 | `demand_ignores_world_state` | a world clogged with explicit spawns and an empty world produce identical demand `(flow, origin, dest, tick)` sequences |
| 6 | `router_matches_brute_force_and_avoids_zones` | 3×3 grid with varied speeds: for every node pair the router's cost equals a brute-force simple-path minimum (excluding paths through zones), and the routes are valid; a zone placed as a shortcut is never traversed |
| 7 | `router_ties_broken_by_lowest_link_id` | symmetric diamonds: the route uses the lower-id first link; swapping creation order swaps the choice |
| 8 | `unreachable_destination_yields_no_route_state` | one-way dead end: `shortest_route` → None, demand vehicles are `NoRoute`, never admitted or completed, `no_route + removed_unreachable` = unreachable trips (robust to core-003 removal); conservation holds |
| 9 | `congestion_raises_link_cost` | upstream of a bottleneck, cost > 1.5 × free flow within 10 min; an unused link stays exactly at free flow |
| 10 | `epoch_cost_update_is_exact` | in a congested run the test independently tracks enter/exit ticks and queued counts and recomputes the EMA. Every epoch matches `link_cost` within 1e-9, the cost is constant between epochs, and the cost is never below free flow |
| 11 | `demand_vehicles_follow_valid_routes_and_complete` | grid with zone corners: every live vehicle's route is contiguous from its trip origin to its dest, `OnLink(l)` ⇒ `l == route[route_pos]`, trips complete, invariants hold every tick |
| 12 | `behavior_rng_is_separate_from_demand` | speed factors in [0.9, 1.1], not constant, and reproducible for the same behavior seed; a different behavior seed gives an **identical** `generated_trips` (incl. trip ids) but different factors |
| 13 | `metrics_match_definitions` | every `Metrics` field is recomputed by hand from views/logs/vehicle info at many ticks and agrees exactly; windowed mean travel time is correct |
| 14 | `rng_primitives_and_cost_helpers_are_pinned` | golden vectors for splitmix64/mix3/unit_f64/BehaviorRng; literal free-flow cost and ms keys |
| 15 | `trips_at_matches_contract_formula` | `trips_at` equals an independent evaluation of the contract formula for 3000 ticks, 4 flows incl. ≥ 1/tick |
| 16 | `demand_routes_use_current_pre_update_costs` | every new trip's route equals the router's route under the pre-step costs; congestion changes some routes; the reported cost = Σ keys / 1000 |
| 17 | `created_tick_is_demand_tick` | the completed log and live vehicles carry the demand tick, so origin waiting counts |
| 18 | `validate_rejects_bad_models` | UnknownNode, BadOrigin, SameOriginDest, BadRate (negative, NaN), BadProfile (non-increasing, negative), flow-major |
| 19 | `speed_factor_draw_order` | the k-th demand trip (NoRoute included) gets the k-th behavior draw; explicit spawns draw nothing |
| 20 | `idle_links_decay_to_free_flow` | demand stops after 15 min: the EMA oracle matches every epoch, idle links (no exits) use `queue_term`, and all links end at exactly free flow |
| 21 | `validate_order_is_flow_major_and_source_nodes_are_origins` | precedence UnknownNode(origin→dest) → BadOrigin → SameOriginDest → BadRate per flow; a source node is a valid origin |
| 22 | `noroute_draws_in_trips_at_order` | with the unreachable flow first, NoRoute and routed trips still draw in `trips_at` order |
| 23 | `validate_rejects_non_finite_rates_and_profiles` | ∞ rate → BadRate; ∞/NaN multiplier and ±∞/NaN time → BadProfile; flows validated before the profile |
| 24 | `speed_factor_caps_free_flow_speed` | free-flowing vehicles peak at vmax × their own speed factor (within 1e-9), never above |

## Must NOT
- No transcendental float functions in sim logic. No `HashMap`/`HashSet`. No wall clock.
- Demand must never read world state. Don't change core-001 tests or expectations.
- No closures or reroute scheduling yet (core-003).

## Must DO
- Keep `World: Clone`, and keep the router cache clearly derived (rebuildable).
- All core-001 tests stay green unchanged. Clippy clean.

## Manual Smoke Test
### Setup
```
cargo build -p sim-core --examples
```
### Steps
1. Run: `cargo test -p sim-core`
   Expected: core_001 (20) and core_002 (24) pass.
2. Run: `cargo run -p sim-core --example smoke`
   Verify: one line per 60 s sim time with `generated active queued completed mean_tt`. `generated` grows at about the configured rate, completed > 0 after a few minutes, and `spawned == active + completed + removed` on every line.
3. Run: `cargo run -q -p sim-core --example smoke > /tmp/a.txt && cargo run -q -p sim-core --example smoke > /tmp/b.txt && diff /tmp/a.txt /tmp/b.txt && echo identical`
   Expected: `identical`.
### Pass criteria
- [ ] 44 tests green
- [ ] Smoke output plausible and conserving
- [ ] Two runs are byte-identical

## Verification
`cargo test -p sim-core` green, clippy clean, Gold reviewer reproduces the smoke test.
