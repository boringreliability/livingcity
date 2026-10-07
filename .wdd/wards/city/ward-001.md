---
ward: 1
revision: null
name: "Capacity attributes and gridlock relief"
epic: "city"
status: "red"
dependencies: ["core-005"]
layer: "rust"
estimated_tests: 22
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
- `frame::EXTENDED_METRIC_NAMES` + `metrics_to_extended_array` (core list + `removed_gridlock`, `unserved`). `METRIC_NAMES`/`metrics_to_array` unchanged (core_004 pins them). `sim-wasm` `metric_names()`/`metrics()` switch to the extended list.
- Example `gridlock`: a ring scenario printing per 30 s: blocked fronts, gridlock reroutes, gridlock removals, completed.

## Specification
- **Saturation flow.** Implement C1 exactly. The credit increment is `sat_flow_per_lane * DT`, computed with that expression. For the default it is bit-identical to the core constant 0.25.
- **Blocked check.** Implement C2 in `discharge_lane`, after the forced-decision block, using `choose_lane(next, entry_s)` with the same `entry_s` expression as the crossing.
- **Removal.** Gridlock removal uses the lane removal path of `remove_unreachable`, but with its own counter. It is not an exit and records no exit time.
- **Reroute search.** The gridlock reroute uses a non-caching search: the router algorithm with one extra excluded link. It must not change `RouterCache` contents.
- **Documented simplification.** Add "gridlock relief: reroute after 60 s blocked, removal after 10 min blocked" to the list of documented simplifications in `.wdd/epics/core.md` (Gold).

## Tests

All in `crates/sim-core/tests/city_001_relief.rs`. Two constructions:

- **Ring.** 4 junctions in a 75 m square with one-lane ring links. A zone feeds each junction, and each junction has an exit to a dead-end sink. 40 vehicles per zone circle once and exit at their own junction. Probed against the core implementation, it deadlocks deterministically at tick 346, with 4 × 10 vehicles and no movement afterwards.
- **Fork.** Zone Z ─L1 (200 m)─▶ A. From A, P (A→B, 10 m, lane capacity 1) or optionally Q1 (A→E, 10 m) + Q2 (E→B, 10 m). Then R (B→D, 200 m), plus CX (B→X) and CY (E→Y), both closed at tick 0. Blocker b1 (route L1,P,CX) and, optionally, b2 (L1,Q1,CY) strand on their 10 m links. The probe vehicle v (L1,P,R) then reaches A's stop line with P full.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `default_sat_flow_is_core_value` | links without an override have `sat_flow_per_lane == SAT_FLOW_PER_LANE`. Explicitly setting 0.5 on every link of three_bridges gives an identical `state_hash` every tick for 30 min |
| 2 | `set_sat_flow_last_call_wins` | the last override is the one stored. Other links are unaffected |
| 3 | `invalid_sat_flow_rejected` | NaN, ±∞, 0, −0.1 and `2.0 + 1e-9` → `InvalidSatFlow { from, to }`; 2.0 and 1e-6 accepted. On the same link `InvalidLanes` is reported first. An earlier link's error is reported before a later link's sat-flow error, and an earlier link's sat-flow error before a later link's `TooShort` |
| 4 | `unknown_link_override_rejected` | overrides for nonexistent ids → `UnknownLink(lowest id)`, reported only when every link is otherwise valid |
| 5 | `reduced_sat_flow_discharge_headway` | demand far above capacity through a 1-lane 300 m link: with sat 0.25, consecutive exits are exactly 8 ticks apart over 600 ticks after warm-up; with 0.125, 16 |
| 6 | `sat_flow_scales_costs` | initial cost = `length / vmax + 1 / (lanes × sat)`. At an epoch with no exits on a link holding a known queued count `q`, the new cost = `max(ff, 0.5 × (length / vmax + q / (lanes × sat)) + 0.5 × previous)` |
| 7 | `blocked_counter_counts_downstream_full_only` | fork without Q: v's `blocked_ticks` rises by exactly 1 per tick from its first blocked evaluation. At 120, 240, … there is no path, so it keeps counting. When b1 is removed (unreachable, T+600) v crosses in the same tick, and its `blocked_ticks` is 0 on P |
| 8 | `credit_limited_front_is_not_blocked` | a 1-lane link with sat 0.125 and an empty downstream link: fronts wait at the stop line for credit, and every vehicle's `blocked_ticks` stays 0 throughout |
| 9 | `stranded_and_final_link_fronts_are_never_blocked` | in the fork and ring runs: stranded vehicles (b1, b2) and vehicles on their final link always have `blocked_ticks == 0` |
| 10 | `gridlock_reroute_after_60s_crosses_when_free` | fork with Q free: in the step where v's count reaches 120 (119 before), v switches to (L1,Q1,Q2,R), keeping the driven prefix, and crosses onto Q1 in the same evaluation (`blocked_ticks` 0 there). `gridlock_reroutes` +1 and `switches_total` +1 |
| 11 | `gridlock_reroute_without_space_keeps_counting` | fork with Q blocked by b2: at 120 v switches to the Q route but stays (count 120, not reset). At 240 it switches back to P. At 360 to Q again, each time `gridlock_reroutes` +1. When the blockers are removed, v crosses and its count resets to 0 |
| 12 | `gridlock_removal_after_10_minutes` | pure ring: no gridlock reroute ever finds a path. Every vehicle that disappears without completing is a front whose count was 1199 before the step, and `removed_gridlock` rises by exactly their number. The removed vehicle's link gets no exit in that step. No count ever reaches 1200. All ring vehicles have completed or been removed within 30 min after the first removal |
| 13 | `gridlock_metrics_and_conservation` | every tick in the ring and fork runs: `spawned == active + completed + removed_unreachable + removed_gridlock`; `Counts.removed == removed_unreachable + removed_gridlock`; `unserved == unreachable + removed_gridlock`. `METRIC_NAMES` is unchanged; `EXTENDED_METRIC_NAMES` = core list + `removed_gridlock`, `unserved`, and `metrics_to_extended_array` matches by index |
| 14 | `gridlock_reroute_spends_no_budget` | in test 10's relief step (with no periodic reroute due): `budgeted_total` and `forced_total` are unchanged |
| 15 | `relief_is_deterministic_and_clone_safe` | two ring runs have equal `state_hash` and per-vehicle `blocked_ticks` every tick for 4,000 ticks. A clone taken at tick 700 (fronts blocked) matches the original every tick |
| 16 | `normal_traffic_untouched_by_relief` | three_bridges, 1 h baseline and a 1 h run with the central bridge closed at 10 min: `gridlock_reroutes == 0` and `removed_gridlock == 0` |
| 17 | `blocked_counts_while_credit_is_low` | (Red r1, M1) with L1 at sat 0.125 v reaches the stop line (P full) while the lane is still re-earning credit: it is counted from its first tick at the line |
| 18 | `gridlock_search_does_not_touch_router_cache` | (Red r1, M4) a demand trip generated the tick after the gridlock reroute gets the normal shortest route via P |
| 19 | `removal_at_1200_makes_no_reroute_attempt` | (Red r1, M2/M3) P held for good by a credit-starved vehicle (sat 1e-6), Q1 closed until v's count is 1190 (no search may use it); at 1200 v is removed, never rerouted, `gridlock_reroutes == 0` |
| 20 | `stranding_resets_a_blocked_count` | (Red r2, M1) v blocked to count 200, then its next link closes: stranded, count 0; after reopen and a successful retry it is blocked again starting at 1 |
| 21 | `gridlock_removal_records_no_exit_time` | (Red r2, M2) after test 19's removal, L1 is empty; the next epoch's L1 cost is exactly the queue-only update (no exit-time sample) |
| 22 | `gridlock_search_uses_current_costs` | (Red r2, m1) two alternatives; the one cheaper at free flow is congested; the relief takes the one cheaper by current costs |

`state_hash` coverage of `blocked_ticks`, `removed_gridlock` and `gridlock_reroutes` is checked by the Gold reviewer in the hash code. Worlds differing only in those fields cannot be built through the public API.

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
   Expected: core 85 + city_001 22 pass.
2. Run: `cargo run -p sim-core --release --example gridlock`
   Verify: blocked fronts appear. A reroute happens at 60 s blocked where an alternative exists, and a removal happens at 10 min in the pure deadlock. After that the ring drains and completes.
3. Run it twice and `diff` the outputs.
   Expected: identical.
### Pass criteria
- [ ] 107 Rust tests green, clippy clean (`cargo clippy --all-targets -- -D warnings`)
- [ ] The gridlock example shows reroute, removal and recovery
- [ ] Deterministic output

## Verification
`cargo test -p sim-core` + clippy. The Gold reviewer runs the example and compares the bridge example's output with the pre-ward version (identical).
