---
ward: 3
revision: null
name: "Closures, rerouting, commands and determinism"
epic: "core"
status: "planned"
dependencies: ["core-002"]
layer: "rust"
estimated_tests: 13
created: "2026-10-06"
completed: null
---
# Ward core-003: Closures, rerouting, commands and determinism

## Scope
Add user interventions as tick-keyed commands (close/open a link), the exact closure semantics from the brief, budgeted and staggered route reconsideration with hysteresis, forced rerouting at decision points, bounded NoRoute retry with explicit removal, and a full-state hash that proves determinism. This completes the headless Rust model: "close a bridge → traffic reroutes" works natively.

## Inputs
- core-001 physics, core-002 demand/router/costs/metrics and `VehicleState::NoRoute`.
- Model contract `.wdd/epics/core.md`: Closures and rerouting, Commands and determinism.

## Outputs
- `sim_core::command`: `Command { tick: u64, kind: CommandKind }`, `CommandKind::{CloseLink(LinkId), OpenLink(LinkId)}`, `CommandError::{InPast, UnknownLink}`.
- `World` additions:
  - `schedule(Command) -> Result<(), CommandError>` (tick ≥ current tick; same-tick commands keep insertion order), `command_log() -> &[Command]` (all accepted commands in application order), `is_closed(LinkId)`, `closed_links() -> Vec<LinkId>`.
  - `state_hash() -> u64`: FNV-1a over **all** simulation state (tick, vehicles incl. float bits, lane queues, credits, rr pointers, origin buffers, RNG state, costs + accumulators, closure set, pending commands, reroute queues, counters, logs). Excludes only the derived router cache.
  - `reroute_stats() -> RerouteStats { budgeted_total, forced_total, switches_total, max_budgeted_in_a_tick }`.
  - `VehicleInfo` gains `route_switches: u32` and `no_route_retries: u32`.
- Frame flags groundwork: `VehicleInfo.on_closed_link: bool`.
- `sim_core::cities::three_bridges(demand_seed, behavior_seed) -> City { scenario: Scenario, landmarks: Landmarks { central_bridge: [LinkId; 2], north_bridge: [LinkId; 2], south_bridge: [LinkId; 2] }, zones: Vec<Zone { name, node, kind }> }`. This is the shared test city. core-004 exposes it through WASM and core-005 renders it (epic `city` replaces it with the final city).

## Specification
- Commands are applied in tick step 1. **Close** marks the link closed, invalidates the router cache, and pushes every vehicle whose route **after its current position** contains the link onto the priority reroute queue (ascending vehicle id). Vehicles waiting at their origin whose route contains it are pushed too. **Open** clears the flag and invalidates the cache. Nothing is forced.
- Discharge/origin admission refuse closed links (core-001 rule extended). Vehicles on a closed link continue and may leave.
- Step 3 order: (a) epoch cost update; (b) priority queue, then the periodic FIFO, until `REROUTE_BUDGET_PER_TICK` route computations are spent this tick (the rest waits). Periodic due rule: `(tick + trip_id) % REROUTE_PERIOD_TICKS == 0` for vehicles OnLink or WaitingAtOrigin, enqueued at most once.
- Reroute from the **valid decision point**: the current link's `to` node (OnLink), or the origin (WaitingAtOrigin). The current link is never replaced. Priority reroutes (current route invalid) always take the best route. Periodic reroutes switch only if `new < SWITCH_RATIO × current_remaining` **and** `current_remaining − new ≥ SWITCH_MIN_GAIN_S` (remaining = cost of route links after the current one).
- **Forced decision**: in discharge, a front vehicle whose next link is closed (or whose route is invalid) is rerouted on the spot (counted in `forced_total`, not the budget). It crosses only if the new next link admits it; otherwise it waits.
- **NoRoute**: when no route exists (priority, forced or origin), the vehicle enters `NoRoute { retries, next_retry_tick = tick + NO_ROUTE_RETRY_TICKS }` and stays put (at its stop line or in its origin buffer). On a retry tick it routes again (outside the budget). After `NO_ROUTE_MAX_RETRIES` failed retries it is removed: it leaves its lane/buffer, `removed_unreachable += 1`, and conservation holds. A front vehicle in NoRoute blocks its lane, which is a real consequence of a dead end.
- Reopening does not resurrect removed vehicles. NoRoute vehicles resume on their next retry.

## Tests

All in `crates/sim-core/tests/core_003_closures.rs`. A shared test city: two river banks joined by a **north**, **central** and **south** bridge, with grid streets and OD demand across the river.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `closed_link_admits_no_new_vehicles` | after closing the central bridge, its exit count grows only by vehicles already on it, and its count never increases |
| 2 | `vehicles_on_closed_link_may_leave` | vehicles on the bridge at the moment of closure all leave it (complete or transfer) |
| 3 | `affected_vehicles_reroute_around_closure` | within 60 s of closure, no vehicle's remaining route contains the bridge; north/south bridge exit rates rise vs. the same run without closure |
| 4 | `reroute_only_at_valid_decision_points` | for every vehicle every tick: `route[route_pos]` == current link and the route stays contiguous; the current link is never replaced |
| 5 | `no_route_waits_retries_then_removed` | with all crossings closed, cross-river vehicles enter NoRoute, retry exactly every 30 s, are removed after 10 retries, and conservation holds every tick |
| 6 | `reopen_restores_access` | closing then reopening the bridge: new trips use it again, and NoRoute vehicles resume on retry (before removal) |
| 7 | `reroute_budget_respected` | `max_budgeted_in_a_tick ≤ REROUTE_BUDGET_PER_TICK` under a closure burst with > 1000 affected vehicles; the backlog drains over several ticks |
| 8 | `hysteresis_prevents_flapping` | two near-equal parallel routes under load: per-vehicle `route_switches` ≤ 2 for ≥ 95 % of vehicles, and the total switch count is bounded |
| 9 | `commands_take_effect_at_their_tick` | a closure scheduled for tick T leaves state at T−1 identical (hash) to a run without it; past-tick commands → `InPast` |
| 10 | `same_seed_and_commands_give_identical_state` | two worlds, same scenario + command log: `state_hash` equal at every tick for 2 h of sim time |
| 11 | `intervention_does_not_change_demand` | with vs. without closing the bridge: identical `generated_trips` (incl. trip ids), different `state_hash` after the closure |
| 12 | `conservation_under_random_closure_stress` | 50 pseudo-random close/open commands (seeded): invariants, capacity and no-overlap hold every tick; spawned = active + completed + removed |
| 13 | `clone_continues_identically` | a cloned world stepped N ticks matches the original stepped N ticks (hash). This prepares snapshots |

## Must NOT
- No scripted outcomes. Rerouting must come from the router and costs.
- No unbounded per-tick work: budgeted reroutes ≤ budget, and forced reroutes only for vehicles at a decision point.
- No `HashMap`/`HashSet`, wall clock or transcendental functions. Don't edit earlier ward tests.

## Must DO
- Document the closure semantics and simplifications in the epic contract if anything is clarified.
- Add a `bridge` example: the test city, run 20 min, close the central bridge, run 20 min, printing per-bridge flow and queued counts every minute.

## Manual Smoke Test
### Setup
```
cargo build -p sim-core --examples --release
```
### Steps
1. Run: `cargo test -p sim-core`
   Expected: all core_001/002/003 tests pass (38).
2. Run: `cargo run -p sim-core --release --example bridge`
   Verify: before closure, the central bridge carries the most flow. After closure its flow drops to 0 within about a minute, north/south flows rise, queued vehicles rise near the alternative crossings, and `unreachable` stays 0.
3. Run it twice and `diff`.
   Expected: identical.
### Pass criteria
- [ ] 38 tests green
- [ ] Bridge example shows emergent rerouting and queue growth
- [ ] Deterministic output

## Verification
`cargo test -p sim-core` + clippy clean, Gold reviewer reproduces the bridge example.
