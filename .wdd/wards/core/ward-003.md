---
ward: 3
revision: null
name: "Closures, rerouting, commands and determinism"
epic: "core"
status: "complete"
dependencies: ["core-002"]
layer: "rust"
estimated_tests: 36
created: "2026-10-06"
completed: "2026-10-06"
---
# Ward core-003: Closures, rerouting, commands and determinism

## Scope
User interventions as tick-keyed commands (close/open a link), the brief's exact closure semantics, budgeted and staggered route reconsideration with hysteresis, forced rerouting at decision points, NoRoute/stranded vehicles with bounded retry and explicit removal, a full-state hash that proves determinism, and the shared test city `three_bridges`. This completes the headless model: "close a bridge → traffic reroutes" works natively and deterministically.

## Inputs
- core-001 physics, core-002 demand/router (`Tree`, `RouterCache`, `cost_keys`, `smoothed`)/metrics/`Phase::NoRoute`.
- Contract `.wdd/epics/core.md`: **Closures and rerouting**, **Commands and determinism**, Metrics (stranded, unreachable).

## Outputs
- `sim_core::command`: `Command { tick, kind }`, `CommandKind::{CloseLink(LinkId), OpenLink(LinkId)}`, `CommandError::{InPast, UnknownLink(LinkId)}`.
- `World`: `schedule(Command) -> Result<(), CommandError>`, `command_log() -> &[Command]`, `is_closed(LinkId)`, `closed_links() -> Vec<LinkId>` (ascending), `state_hash() -> u64`, `reroute_stats() -> RerouteStats { budgeted_total, forced_total, retries_total, switches_total, max_budgeted_in_a_tick }`.
- `VehicleInfo` gains `stranded: bool`, `no_route_retries: u32`, `route_switches: u32` (route changes after spawn, any cause). `VehicleState` is **unchanged** (a stranded vehicle is `OnLink(l)` with `stranded = true`).
- `Metrics` gains `stranded`, and `unreachable = no_route + stranded + removed_unreachable`. `Counts` gains `stranded`.
- `sim_core::cities::three_bridges(demand_seed, behavior_seed) -> City { scenario, landmarks: Landmarks { north_bridge, central_bridge, south_bridge: [LinkId; 2] /* [west→east, east→west] */ }, zones: Vec<Zone { name: String, node: NodeId, kind: ZoneKind } > }`, `ZoneKind::{Residential, Workplace, Hospital}`.
- Example `bridge`: three_bridges, 20 min, close the central bridge (both directions), 20 min more. Per minute it prints exits per bridge, queued, stranded, unreachable.

## Three-bridges city (test city; epic `city` replaces it)
- River along x ∈ [−60, 60] m. West junctions at x ∈ {−1000, −550, −100}, east at x ∈ {100, 550, 1000}, rows y ∈ {−700, 0, 700} (south, center, north).
- Streets: two-way between horizontal and vertical neighbours on each bank. The center row (y = 0) is an arterial at 13.9 m/s with 2 lanes; other streets are 11.1 m/s with 1 lane.
- Bridges (two-way, 200 m): **central** (y = 0) 13.9 m/s 2 lanes; **north** (y = 700) and **south** (y = −700) 11.1 m/s 1 lane.
- Zones (two-way connectors to the outer junctions, 150 m outward in x, 11.1 m/s, 2 lanes):
  - West residential: Westbrook (north, y = 700), Old Town (center), Riverside (south).
  - East: Tech Park (workplace, north), Harbor Works (workplace, center), St. Mary's Hospital (hospital, south).
- Demand (constant profile): each residential → each workplace 300 veh/h; each residential → hospital 60 veh/h; each east zone → each west zone 80 veh/h.
- **Exact construction order** (fixes all ids; implementations must follow it):
  1. Nodes: west junctions `W(r,c)` (id = 3r + c) for r = 0..3 (y = −700, 0, 700), c = 0..3 (x = −1000, −550, −100) → ids 0–8; east junctions `E(r,c)` (id = 9 + 3r + c; x = 100, 550, 1000) → ids 9–17; zones (x = −1150 west / 1150 east, y of their row): Riverside (W row 0), Old Town (W row 1), Westbrook (W row 2), St. Mary's Hospital (E row 0), Harbor Works (E row 1), Tech Park (E row 2) → ids 18–23.
  2. Links, each pair by `two_way(a, b)` (a→b, then b→a): west horizontals (r, then c: `W(r,c)`–`W(r,c+1)`), west verticals (c, then r: `W(r,c)`–`W(r+1,c)`), east horizontals, east verticals, then bridges south `W(0,2)`–`E(0,0)`, central `W(1,2)`–`E(1,0)`, north `W(2,2)`–`E(2,0)`, then connectors in zone-id order (zone → its outer junction: west zones to `W(r,0)`, east zones to `E(r,2)`).
  3. Flows: for each west zone in id order: hospital 60, Harbor Works 300, Tech Park 300; then for each east zone in id order: each west zone in id order, 80.

## Tests

All in `crates/sim-core/tests/core_003_closures.rs`. "Close the central bridge" = close both of its links at tick `T = 1200` (10 min) unless stated otherwise.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `three_bridges_city_is_valid` | the scenario validates; each bridge link goes from x < 0 to x > 0 or back; every west zone reaches every east zone and back; in a 30 min baseline the central bridge carries more than half the west→east crossings |
| 2 | `closed_link_admits_no_new_vehicles` | after closure, every vehicle seen on a closed bridge link was already on it at the closure tick, and its count never increases |
| 3 | `vehicles_on_closed_link_may_leave` | all vehicles on the closed bridge at closure leave it within 150 s by transfer or completion, none removed |
| 4 | `affected_vehicles_reroute_around_closure` | 60 s after closure no live vehicle's remaining route contains a closed link; north + south bridge exits in [T+300 s, T+1500 s) exceed the same window of a run without closure |
| 5 | `routes_change_only_at_valid_decision_points` | every tick, for every vehicle: OnLink(l) ⇒ route[route_pos] == l; the route stays contiguous origin→dest; the already-driven prefix `route[..=route_pos]` is never rewritten (with closures, reopenings and periodic reroutes over 40 min) |
| 6 | `no_route_retries_then_removed_on_schedule` | closing all six bridge links at T: the cross-river vehicles that become NoRoute or stranded at T get `no_route_retries` 1…10 at T+60k and are removed exactly after step T+600, not completed; `removed_unreachable` and conservation match every tick; stranded ones stay on their lane until removal |
| 7 | `reopen_restores_access` | closing all bridges at T and reopening at T+240 s: NoRoute/stranded vehicles resume on their next retry and later complete, with 0 removed; reopening the central bridge after a single closure brings its exits back |
| 8 | `reroute_budget_respected` | 3000 waiting vehicles routed over road A; closing A gives `max_budgeted_in_a_tick ≤ 200`, the backlog drains over ≥ 15 ticks, and after it no remaining route uses A |
| 9 | `hysteresis_limits_route_switching` | two near-equal parallel roads under load for 1 h: ≥ 95 % of vehicles switch ≤ 1 time, and the total switch count ≤ 10 % of trips |
| 10 | `commands_take_effect_at_their_tick` | with a closure scheduled for T, all observable state (link vehicles, metrics, costs, closed set) equals a run without it through step T−1; after step T the link is closed and the hashes differ; `InPast`/`UnknownLink` rejected; `command_log` keeps acceptance order; same-tick commands apply in acceptance order |
| 11 | `same_seed_and_commands_give_identical_state` | two worlds, same scenario and command log (close at 10 min, reopen at 30 min): `state_hash` equal at every tick for 2 h |
| 12 | `intervention_does_not_change_demand` | with vs. without closing the central bridge: identical `generated_trips` (incl. trip ids), different `state_hash` after the closure |
| 13 | `conservation_under_random_closure_stress` | 50 seeded random close/open commands on non-connector links over 1 h: invariants every tick, conservation, the unreachable split; traffic keeps flowing (> 500 completed) and the stress produced stranded vehicles and removals |
| 14 | `clone_continues_identically` | a clone taken mid-run with pending commands matches the original's hash every tick for 30 min |
| 15 | `state_hash_covers_state` | the hash differs for worlds differing only in: behavior seed (before any draw), one pending future command, the closed state of an unused link, or one extra tick; and is equal for independently built identical worlds |
| 16 | `stranded_vehicle_semantics` | vehicles (on the connector and L1) whose only continuation closes become stranded on their lanes (front blocks the lane, counted in `stranded`, `on_network`, `unreachable`), `VehicleState` stays `OnLink`, and it resumes immediately on the first retry after reopening |
| 17 | `backlog_forced_decision_never_enters_closed_link` | with a priority backlog > budget, nobody enters the closed link; a vehicle reaching the stop line before its priority turn is forced onto the alternative (exactly at tick 33) |
| 18 | `admission_refuses_closed_first_link_under_backlog` | vehicles still queued for reroute are never admitted onto a closed first link, and become NoRoute when there is no way out |
| 19 | `removal_is_not_an_exit` | removals do not change `link_exit_count`; everything stranded/NoRoute is removed exactly once |
| 20 | `state_hash_covers_vehicle_state` | the hash differs for worlds differing only in routes or slot assignment |
| 21 | `same_seed_and_commands_give_identical_observables` | identical metrics, reroute stats, vehicle infos, link vehicles and costs every 300 ticks (determinism not resting on the hash) |
| 22 | `reopen_off_epoch_is_routable_immediately` | after a reopen at a non-epoch tick, new trips are routable at once (cache invalidated on open) |
| 23 | `same_tick_open_then_close_ends_closed` | same-tick commands apply in acceptance order (the reverse case of test 10) |
| 24 | `stranded_not_resumed_before_retry` | stranded vehicles act only on their retry schedule: not resumed at the reopen tick, and stranded fronts take no forced decisions |
| 25 | `periodic_reconsideration_switches_when_clearly_better` | waiting vehicles on a clearly worse route switch exactly once at their periodic due tick |
| 26 | `priority_drains_exactly_at_budget` | the priority backlog shrinks by exactly 200 per tick (priority served before periodic) |
| 27 | `periodic_reconsideration_reaches_vehicles_on_links` | vehicles already on a link reconsider at their due tick and switch once to a clearly better continuation, keeping the driven prefix |
| 28 | `shortest_route_respects_closures` | the public query avoids closed links and reports None when every crossing in that direction is closed |
| 29 | `hysteresis_requires_both_conditions` | no switch when only the ratio or only the ≥ 20 s gain condition holds |
| 30 | `retry_stats_count_attempts_outside_the_budget` | `retries_total` counts failed and successful attempts; retries spend no budget |
| 31 | `reopen_is_picked_up_by_staggered_periodic_reconsideration` | reopening forces nothing; vehicles return to the reopened link exactly at their own staggered due ticks, on distinct ticks |
| 32 | `stranded_keeps_route_and_noroute_route_is_empty` | stranded vehicles keep their route and resume it with 0 switches; NoRoute vehicles have an empty route and count 1 switch on resuming |
| 33 | `retry_count_restarts_for_each_stranding` | a second stranding after a successful retry starts a fresh count (0, then k at S+60k) and is removed exactly at S+600 |
| 34 | `noroute_retry_count_restarts_and_ignores_unrelated_commands` | NoRoute (origin) and stranded vehicles both start a fresh count per episode; an unrelated close/open mid-episode neither resets nor resumes them; removal exactly at S+600 |
| 35 | `forced_decision_without_route_strands_at_the_stop_line` | a forced decision that finds no route strands the vehicle at the stop line (it never crosses into the closed link), with the normal retry/removal schedule |
| 36 | `forced_decision_reroutes_from_the_stop_line_node` | a forced reroute starts at the current link's `to` node (never the `from` node's shortcut), keeps the driven links and crosses onto the new next link in the same evaluation (closure 47, forced and on B1 at 60) |

## Must NOT
- No scripted outcomes. Rerouting must emerge from router + costs.
- No unbounded per-tick work: budgeted reroutes ≤ budget; forced only at stop lines; retries only for due vehicles.
- No `HashMap`/`HashSet`, wall clock or transcendental functions (clippy.toml). Don't edit earlier ward tests.

## Must DO
- Keep `World: Clone`. Router cache invalidated on epoch, close and open.
- core-001 (20) and core-002 (24) stay green unchanged.

## Manual Smoke Test
### Setup
```
cargo build -p sim-core --examples --release
```
### Steps
1. Run: `cargo test -p sim-core`
   Expected: core_001 20, core_002 24, core_003 36 pass.
2. Run: `cargo run -p sim-core --release --example bridge`
   Verify: before closure the central bridge carries the most west→east exits per minute. After closure its exits drop to 0 within about a minute, north/south exits rise, queued rises near the alternative crossings, and `unreachable` stays 0.
3. Run it twice and `diff` the outputs.
   Expected: identical.
### Pass criteria
- [ ] 80 tests green, clippy clean
- [ ] Bridge example shows emergent rerouting and queue growth
- [ ] Deterministic output

## Verification
`cargo test -p sim-core` + clippy clean; Gold reviewer reproduces the bridge example.
