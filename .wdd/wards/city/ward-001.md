---
ward: 1
revision: null
name: "Capacity attributes and gridlock relief"
epic: "city"
status: "planned"
dependencies: ["core-005"]
layer: "rust"
estimated_tests: 16
created: "2026-10-07"
completed: null
---
# Ward city-001: Capacity attributes and gridlock relief

## Scope
Two model extensions that River City needs. Both are specified in `.wdd/epics/city.md` § C1 and § C2.
- **C1: per-link saturation flow.** The limited-capacity Old Bridge discharges slower than a normal lane.
- **C2: deterministic gridlock relief.** Oversaturation after closing the Main Bridge must not freeze cycles of full links forever. A front blocked by a full downstream link for 60 s reroutes around it. After 10 min blocked, it is removed as an explicit, counted last resort.

Rust only. Nothing changes for existing scenarios unless they actually gridlock.

## Inputs
- core-001 discharge (`discharge_lane`, `choose_lane`, credit), core-002 router and costs, core-003 forced decisions, stranding and removal, `state_hash`, `RerouteStats`.
- Contract: `.wdd/epics/core.md` (Tick order step 4, Routing, Closures and rerouting) and `.wdd/epics/city.md` § C1, § C2.

## Outputs
- `Link.sat_flow_per_lane`, `NetworkBuilder::set_sat_flow`, `NetworkError::{InvalidSatFlow { from, to }, UnknownLink(LinkId)}`, `params::{MAX_SAT_FLOW_PER_LANE, GRIDLOCK_REROUTE_TICKS, GRIDLOCK_REMOVE_TICKS}`.
- `VehicleInfo.blocked_ticks: u32`, `RerouteStats.gridlock_reroutes: u64`, `Metrics.{removed_gridlock, unserved}: u64`. `Counts.removed` includes gridlock removals.
- `frame::METRIC_NAMES` gains `"removed_gridlock"` and `"unserved"`, appended at the end, and `metrics_to_array` follows.
- Example `gridlock`: a ring scenario printing per 30 s: blocked fronts, gridlock reroutes, gridlock removals, completed.

## Specification
- **Saturation flow.** Implement C1 exactly. The credit increment is `sat_flow_per_lane * DT`, computed with that expression. For the default it is bit-identical to the core constant 0.25.
- **Blocked check.** Implement C2 in `discharge_lane`, after the forced-decision block, using `choose_lane(next, entry_s)` with the same `entry_s` expression as the crossing.
- **Removal.** Gridlock removal uses the lane removal path of `remove_unreachable`, but with its own counter. It is not an exit and records no exit time.
- **Reroute search.** The gridlock reroute uses a non-caching search: the router algorithm with one extra excluded link. It must not change `RouterCache` contents.
- **Documented simplification.** Add "gridlock relief: reroute after 60 s blocked, removal after 10 min blocked" to the list of documented simplifications in `.wdd/epics/core.md` (Gold).

## Tests

All in `crates/sim-core/tests/city_001_relief.rs`. A "ring" is 4 junctions in a square, with one-lane links between them in one direction. It is fed from zones via connectors and filled by `spawn_with_route` so that every ring link is full and every ring front's next link is the next ring link. This is a real deadlock.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `default_sat_flow_is_core_value` | links without an override have `sat_flow_per_lane == SAT_FLOW_PER_LANE`. A standing 1-lane queue still discharges with exactly 4-tick headways |
| 2 | `set_sat_flow_last_call_wins` | the last override is the one stored. Other links are unaffected |
| 3 | `invalid_sat_flow_rejected` | NaN, ±∞, 0, −0.1 and `2.0 + 1e-9` → `InvalidSatFlow { from, to }`; 2.0 and 1e-6 accepted. On the same link `InvalidLanes` is reported first. An earlier link's error is reported before a later link's sat-flow error |
| 4 | `unknown_link_override_rejected` | overrides for nonexistent ids → `UnknownLink(lowest id)`, reported only when every link is otherwise valid |
| 5 | `reduced_sat_flow_discharge_headway` | a standing queue of 10 on a 1-lane link discharging into an empty long link: sat 0.25 → consecutive transfers exactly 8 ticks apart; 0.125 → 16 |
| 6 | `sat_flow_scales_costs` | `free_flow = length / vmax + 1 / (lanes × sat)`, and the epoch's `queue_term` uses `lanes × sat` (exact value with a known queued count) |
| 7 | `blocked_counter_counts_downstream_full_only` | a front at the stop line whose next link is full gets `blocked_ticks` 1, 2, 3, … on consecutive ticks. When space appears and it transfers, its `blocked_ticks` is 0 on the new link |
| 8 | `credit_limited_front_is_not_blocked` | with sat 0.125 and space downstream, a front waiting for credit keeps `blocked_ticks == 0` |
| 9 | `closed_next_link_and_stranded_fronts_are_not_blocked` | a front whose next link is closed (forced decision, rerouted or stranded) and a stranded front keep `blocked_ticks == 0`. A front on its final link is never blocked |
| 10 | `gridlock_reroute_after_60s` | ring with one alternative exit at a ring node: at the evaluation where the front's `blocked_ticks` reaches 120, it switches to the alternative from the stop-line node and keeps the driven prefix. `gridlock_reroutes == 1` and `switches_total` +1. If the alternative has space it crosses in the same evaluation |
| 11 | `gridlock_reroute_repeats_without_reset` | if the new next link is also full, the counter continues (not reset). Further attempts happen at 240, 360, …, and `gridlock_reroutes` counts only attempts that found a path |
| 12 | `gridlock_removal_after_10_minutes` | pure deadlock ring (no alternative): a front is removed exactly at the evaluation where its `blocked_ticks` reaches 1200. `removed_gridlock` +1; it is not completed, not an exit (`link_exit_count` unchanged), and its slot is freed. Afterwards the ring moves again, and the remaining ring vehicles complete within 30 min |
| 13 | `gridlock_metrics_and_conservation` | every tick: `spawned == active + completed + removed_unreachable + removed_gridlock`; `Counts.removed == removed_unreachable + removed_gridlock`; `unserved == unreachable + removed_gridlock`. `METRIC_NAMES` ends with `removed_gridlock`, `unserved`, and `metrics_to_array` matches by index |
| 14 | `state_hash_covers_gridlock_state` | the hash differs for worlds that differ only in a vehicle's `blocked_ticks`, and for worlds that differ only in `removed_gridlock` / `gridlock_reroutes` history |
| 15 | `relief_is_deterministic_and_clone_safe` | two runs of the deadlock ring have equal `state_hash` every tick for 30 min. A clone taken while fronts are blocked matches the original every tick |
| 16 | `normal_traffic_untouched_by_relief` | three_bridges, 1 h baseline and a 1 h run with the central bridge closed at 10 min: `gridlock_reroutes == 0` and `removed_gridlock == 0` |

## Must NOT
- Change any earlier test or any core reference value. Default-sat-flow worlds must behave bit-identically wherever no front is blocked for 60 s.
- Let the gridlock search touch the router cache, or spend reroute budget.
- Use HashMap/HashSet, the wall clock or transcendental functions (clippy.toml).

## Must DO
- The 85 earlier Rust tests stay green unchanged. If one breaks because relief triggers in it, **stop and escalate** (contract conflict). Do not tune constants to dodge it.
- Keep `World: Clone`. Update `check_invariants` with the new conservation.

## Manual Smoke Test
### Setup
```
cargo build -p sim-core --release --examples
```
### Steps
1. Run: `cargo test -p sim-core`
   Expected: core 85 + city_001 16 pass.
2. Run: `cargo run -p sim-core --release --example gridlock`
   Verify: blocked fronts appear. A reroute happens at 60 s blocked where an alternative exists, and a removal happens at 10 min in the pure deadlock. After that the ring drains and completes.
3. Run it twice and `diff` the outputs.
   Expected: identical.
### Pass criteria
- [ ] 101 Rust tests green, clippy clean (`cargo clippy --all-targets -- -D warnings`)
- [ ] The gridlock example shows reroute, removal and recovery
- [ ] Deterministic output

## Verification
`cargo test -p sim-core` + clippy. The Gold reviewer runs the example and compares the bridge example's output with the pre-ward version (identical).
