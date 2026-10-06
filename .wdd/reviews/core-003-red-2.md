# Review: core-003 — Red gate (round 2)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.

**Inputs read**
- `livingcity.md`, `.wdd/epics/core.md` (contract at `2153196`), `.wdd/wards/core/ward-003.md` (now with "Exact construction order")
- `crates/sim-core/tests/core_003_closures.rs` (26 tests), the unchanged stubs (`command.rs`, `cities.rs`, `todo!()` in `world.rs`)
- `.wdd/reviews/core-003-red-1.md`, and `git diff 38b5e28 HEAD`

The worktree is unchanged except for this file.

**Method**
- **Red check** (repo snapshot in `/tmp/stub003r2`):
  - core-001 20/20 and core-002 24/24 pass.
  - core-003 fails 0/26: 25 tests panic in `todo!()`, and test 25 fails on its own assertion before reaching a stub.
  - `cargo clippy -p sim-core --all-targets -- -D warnings` is clean.
- **Reference** (`/tmp/ref003`), updated to the current contract:
  - `three_bridges` follows the ward's exact construction order. Dumped and checked: nodes 0–8 W row-major, 9–17 E, zones 18–23; links 0–23 west, 24–47 east; bridges S 48/49, C 50/51, N 52/53; connectors 54–65; flows as specified.
  - Periodic enqueue skips stranded vehicles and anything already in **either** queue.
  - Queue entries are `(slot, trip_id)`.
  - Stats follow the contract's definitions: `retries_total` counts attempts, and a switch is counted only when the route actually changes.
  - `shortest_route` respects closures.
  - Stranded vehicles take no forced decisions and resume only on a retry.
- **Determinism of the fixed order.** Every test value is identical to round 1's default order (column-major node ids), because node ids only change node iteration order and that does not affect any result here. Link ids, which drive test 13, are now fixed by the ward. The values are therefore unique and well defined, and also robust to a misreading of the node-loop nesting.
- **Mutants.** 54 `MUT=` toggles: all 37 from round 1 plus 17 new ones for the clarifications. Each was run over all 70 tests (`--no-fail-fast`); survivors were also run against the proposed tests 27–30.
- **Fixes.** `/tmp/ref003/fixes2_tail.rs` (tests 27–30) is appended to the test file as `/tmp/ref003/crates/sim-core/tests/core_003_fixed2.rs`. It passes 30/30 on the reference in about 5.2 s and is clippy-clean.

## Verdict
REJECTED

## Prior findings status (round 1)

| # | Sev | Status |
|---|---|---|
| F1 test-13 layout dependence | BLOCKER | **Resolved.** Connectors are excluded, the premise is now `> 500` plus stranded/removals, and the layout is fixed. Reference: completed 1050, max_stranded 60, removed 1310. |
| F2 closed-link refusal in discharge/admission | MAJOR | **Resolved** by tests 17 and 18, which kill `enter_closed` and `admit_closed`. |
| F3 forced decisions | MAJOR | **Resolved** by test 17 (kills `no_forced` and `forced_no_count`). |
| F4 removal is not an exit | MAJOR | **Resolved** by test 19. |
| F5 hash coverage | MAJOR | **Resolved** by tests 20 and 21 (kill `hash_degenerate` and `nondet,hash_degenerate`). |
| F6 invalidation on open | MAJOR | **Resolved** by test 22 (kills `no_inval_open` and `cmd_after_demand`). |
| F7 periodic never switches | MAJOR | **Partly resolved.** Test 25 covers *waiting* vehicles only. On-link vehicles are still untested: see N1, a new MAJOR. |
| F8 creation order | MINOR | **Resolved.** The ward pins the order. |
| F9 open→close same tick | MINOR | **Resolved** by test 23. |
| F10 stranded forced/early resume | MINOR | **Resolved** by the contract wording plus test 24. |
| F11 priority before periodic | MINOR | **Resolved** by test 26 (kills `periodic_first`). |
| F12 partial hysteresis | MINOR | **Open.** `hyst_ratio_only` and `hyst_gain_only` still survive. A fix is supplied (test 29). |
| F13 contract ambiguities | MINOR | **Mostly resolved.** Still unstated: that a stranded vehicle keeps its old route, and whether a successful retry that yields the *same* route counts as a switch (see M3). |
| F14 ward 300 s vs 240 s | MINOR | **Resolved.** |
| F15 hash label / black-box limits | MINOR | **Open.** Test 15's "unused link's closed state" case still also differs in the command log. Cosmetic. |
| F16 equivalent mutants | — | n/a. `close_desc`, `hyst_priority` and `retry_every_tick` remain equivalent or unobservable. |

## Findings

### N1. MAJOR: periodic reconsideration of vehicles already on a link is untested
- **Where:**
  - contract "Periodic due rule … `WaitingAtOrigin` **or on-link-not-final**";
  - "Valid decision point";
  - brief: "congestion-aware routing", "budgeted, staggered route recalculation", "affected vehicles recalculate routes at valid decision points".
- **Mutant `periodic_waiting_only`:** only waiting vehicles are enqueued periodically, which is equivalent to an `on_final()` bug that treats every on-link vehicle as final. It passes all 70 tests.
  - Test 25 uses waiting vehicles only.
  - Test 9 measures 0 switches.
  - The 72–110 switches in the city tests are all closure-driven (priority).
- **Consequence:**
  - Once a vehicle has left its origin it never reacts to congestion. That covers spill-back after a closure, a jammed alternative bridge, and a reopening, which is picked up "through periodic reconsideration" per the contract.
  - Example: after a reopen, every vehicle already driving keeps its detour. This defeats the ward's central mechanism for the majority of vehicles: in three_bridges almost all live vehicles are on links, since `waiting_at_origin` is about 0.
- **Fix (verified): test 27, `periodic_reconsideration_reaches_vehicles_on_links`.**
  - Setup: 20 vehicles on a 3000 m first link L0, routed over the slow branch B (≈116 s) while A (≈73 s) passes both hysteresis conditions.
  - After 260 ticks every vehicle is still on L0, has route `[l0, pj, a, q]` and has `route_switches == 1`.
  - It kills `periodic_waiting_only` and `no_periodic_switch`.

### N2. MAJOR: `shortest_route` respecting closures (a clarification added this round) is untested, and the current code violates it
- **Where:**
  - contract "`World::shortest_route` uses the current costs **and** current closures";
  - `crates/sim-core/src/world.rs:272-278` builds the tree with `|_| true`.
- **Mutant `sr_no_closed`:** passes all 70 tests. Test 1 only calls `shortest_route` before any closure.
- **Problem:** this is not a hypothetical slip. Leaving the core-002 method untouched gives exactly this mutant, and the implementer is only required to change `route_for` to get the suite green.
- **Consequence:** the public routing query (UI route preview, "alternative route" displays, later `city` tests) returns routes over a closed bridge and reports trips as reachable when they are not. That is a direct contract violation through public API.
- **Fix (verified): test 28, `shortest_route_respects_closures`.**
  - Old Town → Harbor Works uses the central bridge (link 50) when open.
  - With link 50 closed it avoids it; with 48, 50 and 52 closed it returns `None`.
  - East→west is unaffected.

### M1. MINOR (was F12): partial hysteresis
- **Problem:** `hyst_ratio_only` and `hyst_gain_only` survive.
- **Fix (verified): test 29, `hysteresis_requires_both_conditions`.**
  - Case 1: ratio ≈ 0.89 with a 43 s gain (long common tail Q) must not switch.
  - Case 2: ratio ≈ 0.69 with a 10 s gain must not switch.
  - It kills both mutants and also `no_hysteresis` and `periodic_waiting_only`.

### M2. MINOR: retry stats and budget isolation untested
- **Problem:** `retries_fail_only` (counts only failed retries) and `retry_budgeted` (retries spend budget) both survive.
- **Fix (verified): test 30, `retry_stats_count_attempts_outside_the_budget`.**
  - Uses the test-16 corridor.
  - `retries_total` goes `n → 2n` at the successful retry (ct+120), and `budgeted_total` is unchanged at that tick (n = 11).

### M3. MINOR: switch counting on a "successful retry" that restores the same route
- **Problem:** the contract lists "successful retry" among the causes of `switches_total`. The reference counts only actual route changes, so a stranded vehicle resuming its unchanged route adds 0 (test 24: `switches_total` 0).
- **Effect:** `switch_no_retry` and `switch_count_all` are unobservable.
- **Fix:** state "counted only if the new route differs from the old".

### M4. MINOR: budget-accounting variants are not observable
- **Mutants:** `final_costs` (final-link entries cost 1), `noroute_costs` (dropped NoRoute/stranded entries cost 1), `forced_budget` (forced counted as budgeted), `periodic_dup_prio` and `periodic_nodedup` (dedup gaps), `periodic_stranded`, `slot_only` (entries matched by slot only).
- **Effect:** they change only budget usage, stats or hash.
- **Why MINOR:** correctness is protected by the forced decisions (test 17) and by test 26's exact drain. Note that `slot_only` would reroute a fresh vehicle in a reused slot, which is harmless since a priority reroute takes the best route anyway.

### M5. MINOR: `forced_wait` survives
- **Mutant:** a forced vehicle does not cross in the same evaluation, which costs one tick per forced decision.
- **Possible fix:** pin test 17's reference value exactly (first z vehicle on B1 at tick **33**).

### M6. MINOR: the stranded route is still not stated in the contract
- **Problem:** the contract does not say that the vehicle keeps its old route (from F13).
- **Why MINOR:** an implementation that truncates the route would fail test 5 only if test 5 ever had a stranded vehicle, and it has none. The ambiguity is harmless for the suite.

### M7. MINOR: ward cosmetics
- In the test table, row 16 comes after row 26.
- In the construction-order text, "for r = 0..3 …, c = 0..3" could state "id = 3r + c" explicitly. All results are invariant to this reading anyway (see Method).

## Reference results (`/tmp/ref003`, current contract, fixed construction order)

| # | Test | Result | Key values |
|---|---|---|---|
| 1 | three_bridges_city_is_valid | pass | central **727** of **876** W→E crossings (0.83); north 125, south 24 |
| 2 | closed_link_admits_no_new_vehicles | pass | 13 on the bridge at closure |
| 3 | vehicles_on_closed_link_may_leave | pass | 0 left after 300 ticks; bridge empty after 34 ticks |
| 4 | affected_vehicles_reroute_around_closure | pass | dc **635** vs db **112**; at tick 4200 completed 1293, active 203; rs budgeted 3094, forced 0, switches 71, max 71 |
| 5 | routes_change_only_at_valid_decision_points | pass | switches_seen **87**; rs budgeted 3437 |
| 6 | no_route_retries_then_removed_on_schedule | pass | tracked 654 (80 stranded); removed_seen **417**; retries_total 5277; budgeted 794 |
| 7 | reopen_restores_access | pass | unreachable 241, done **241**; completed 1711 @5280; marks [212, 212, 282, 813] |
| 8 | reroute_budget_respected | pass | budget_ticks 30; budgeted 3382; switches 3000; max 200 |
| 9 | hysteresis_limits_route_switching | pass | 2454 trips; 0 switches; used [1038, 754]; completed 1761, waiting 577; budgeted 10303, max 3 |
| 10 | commands_take_effect_at_their_tick | pass | |
| 11 | same_seed_and_commands_give_identical_state | pass | 2 h: generated 5235, completed 5061, active 174; budgeted 10272, switches 72 |
| 12 | intervention_does_not_change_demand | pass | |
| 13 | conservation_under_random_closure_stress | pass | completed **1050**, max_stranded **60**, removed **1310**, no_route 201 at end; retries 14014 |
| 14 | clone_continues_identically | pass | |
| 15 | state_hash_covers_state | pass | |
| 16 | stranded_vehicle_semantics | pass | |
| 17 | backlog_forced_decision_never_enters_closed_link | pass | first z on B1 at tick **33**; forced **2**; budgeted 3692; switches 3010 |
| 18 | admission_refuses_closed_first_link_under_backlog | pass | no_route **50**; waiting 1994; on_network 6; budgeted 2243; switches 2000 |
| 19 | removal_is_not_an_exit | pass | stuck 11 → removed **11**; completed 1 |
| 20 | state_hash_covers_vehicle_state | pass | |
| 21 | same_seed_and_commands_give_identical_observables | pass | |
| 22 | reopen_off_epoch_is_routable_immediately | pass | removed 0; at tick 1830 completed 346 |
| 23 | same_tick_open_then_close_ends_closed | pass | |
| 24 | stranded_not_resumed_before_retry | pass | n = 11 stranded; forced 0; retries 11 after ct+119 |
| 25 | periodic_reconsideration_switches_when_clearly_better | pass | waiting **204**; switches_total 258; budgeted 282 |
| 26 | priority_drains_exactly_at_budget | pass | uses_a 3000 → 2800 … 200 → 0 at t = 24 |
| core-001 / core-002 | | 20/20, 24/24 | |
| 27–30 (proposed) | | 4/4 | |

- **Runtime** (profile.test opt-level 2, parallel):
  - core-003: 5.5 s;
  - whole `cargo test -p sim-core --tests`: about 11 s wall, including the build check;
  - the fixed 30-test file: 5.2 s.

## Mutation table (70 tests; "fix" = proposed tests 27–30)

| Mutant | Killed by (current suite) | Fix |
|---|---|---|
| enter_closed | 17 | |
| admit_closed | 18 | |
| no_forced | 17 | |
| close_no_waiting | 8, 17, 18, 26 | |
| replace_current / rewrite_past | 2, 3, 4, 5, 7, 10, 12, 13, 22 | |
| no_budget | 8, 17, 26 | |
| periodic_first | 26 | |
| no_hysteresis | 9 | 29 |
| hyst_ratio_only | **none** (MINOR, M1) | 29 |
| hyst_gain_only | **none** (MINOR, M1) | 29 |
| hyst_priority | none (equivalent) | |
| no_periodic_switch | 25 | 27 |
| retry_offbyone | 6 | |
| removal_completes | 6, core-002 ×2 | |
| removal_exit | 19 | |
| stranded_as_noroute | 6, 13, 16, 19 | |
| strand_removes | 6, 7, 13, 16, 19, 22 | |
| stranded_moves | 6, 16, 19, 24 | |
| no_inval_close | 8, 17, 26 | |
| no_inval_open | 22 | |
| cmd_late | 16, 18, 19, 22, 24, 26 | |
| cmd_after_demand | 22 | |
| cmd_reorder | 23 | |
| cmd_closes_last | 10 | |
| open_unstrands | 24 | |
| forced_on_stranded | 24 | |
| close_desc | none (unobservable) | |
| retry_every_tick | none (equivalent) | |
| hash_no_cmds / hash_no_rng | 15 | |
| hash_no_closed / hash_no_queues / hash_no_sv | none (not black-box isolable, F15) | |
| hash_degenerate | 20 | |
| nondet | 10, 11, 14, 15, 21, core-001 | |
| nondet,hash_degenerate | 10, 20, 21, core-001 | |
| **new:** periodic_waiting_only | **none, MAJOR (N1)** | 27, 29 |
| periodic_onlink_only | 25 | |
| sr_no_closed | **none, MAJOR (N2)** | 28 |
| stranded_pop (stranded enqueued and rerouted periodically) | 6, 19 | |
| periodic_stranded (enqueued, dropped at pop) | none (unobservable, M4) | |
| periodic_nodedup / periodic_dup_prio | none (budget/hash only, M4) | |
| slot_only | none (M4) | |
| retries_fail_only | none (MINOR, M2) | 30 |
| retry_budgeted | none (MINOR, M2) | 30 |
| switch_no_retry / switch_count_all | none (M3) | |
| forced_no_count | 17 | |
| forced_budget | none (M4) | |
| forced_wait | none (M5) | |
| final_costs / noroute_costs | none (M4) | |

## Notes for Gold reviewer
- **Exact reference values** come from `three_bridges(17, 23)` built in the ward's order: landmarks S [48, 49], C [50, 51], N [52, 53]; zones 18–23 = Riverside, Old Town, Westbrook, St. Mary's, Harbor Works, Tech Park. They are as listed in the table above, especially:
  - **Test 1:** 727 / 876 (north 125, south 24).
  - **Test 2:** 13 at closure; the bridge is empty after 34 ticks.
  - **Test 4:** 635 vs 112; tick 4200: completed 1293, active 203; stats (3094, 0, 0, 71, 71).
  - **Test 5:** 87.
  - **Test 6:** 654 / 80 / 417, retries 5277.
  - **Test 7:** 241 / 241, marks [212, 212, 282, 813].
  - **Test 8:** stats (3382, 0, 0, 3000, 200).
  - **Test 9:** 2454 trips, 0 switches, used [1038, 754].
  - **Test 11:** 5235 / 5061 / 174, stats (10272, 0, 0, 72, 71).
  - **Test 13:** 1050 completed, max_stranded 60, removed 1310.
  - **Test 17:** tick 33, forced 2.
  - **Test 18:** no_route 50.
  - **Test 19:** 11 removed.
  - **Test 24:** 11 stranded.
  - **Test 25:** 204 waiting, switches 258.
  - **Test 26:** 3000 − 200·(t − 9).
- **Proposed tests 27–30:**
  - **Test 27:** all 20 on L0 with route `[l0, pj, a, q]`, `route_switches == 1`.
  - **Test 29:** 0 switches in both cases, budgeted ≥ 20.
  - **Test 30:** retries 11 → 22, budgeted unchanged at ct+120.
- **To get APPROVED:** append `/tmp/ref003/fixes2_tail.rs` (tests 27–30, verified on the reference; 27 and 28 are required for N1 and N2), update the ward table and counts (30 tests / 74 total), and optionally clarify M3 and M6 in the contract.
