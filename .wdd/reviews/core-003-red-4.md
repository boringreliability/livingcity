# Review: core-003 — Red gate (round 4)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.

**Inputs read**
- `.wdd/epics/core.md` (unchanged since r3) and `.wdd/wards/core/ward-003.md`
- `crates/sim-core/tests/core_003_closures.rs` (32 tests), the unchanged stubs
- `.wdd/reviews/core-003-red-{1,2,3}.md`, and `git diff d126899 HEAD` (70e7656)

**What changed since round 3**
- Tests 31–32 are appended verbatim from `/tmp/ref003/fixes3_tail.rs`.
- The test-27 comment now states the due rule (M9).
- The ward table and counts are updated (32 tests / 76 total).
- The contract is unchanged.

**Method**
- **Red check** (snapshot `/tmp/stub003r4`):
  - core-001 20/20 and core-002 24/24 pass.
  - core-003 fails 0/32.
  - `cargo clippy -p sim-core --all-targets -- -D warnings` is clean, also with the proposed test 33 appended (0/33 pass on the stubs).
- **Reference** (`/tmp/ref003`): I checked it against the current contract. A concurrent reviewer had touched it; I read every core-003 path (commands, close/open, step 3 a–d, `try_reroute`, NoRoute/stranded entry, admission and removal) and found it consistent. Its test file was out of date (only the test-27 comment differed), so I synced it to HEAD. I backed up the reference to `world_r4_base.rs.bak`.
- **Mutants.** 71 `MUT=` toggles, each run over all 76 tests with `--no-fail-fast`:
  - the 60 from round 3;
  - `noroute_counts`, left by the concurrent reviewer;
  - 10 new ones: `noroute_blocks`, `noroute_requeue`, `close_incl_current`, `close_to_periodic`, `prio_lifo`, `periodic_drop_rest`, `prio_drop_rest`, `hyst_ignore_closed`, `retries_not_reset`, plus the combination `nondet,hash_degenerate`.
  - The results are in `/tmp/ref003/mut_r4.txt`.
- **Fix.** `/tmp/ref003/fixes4_tail.rs` holds test 33.
  - It passes on the reference: 33/33, core-003 in 5.4 s.
  - It fails on the stubs and is clippy-clean.
  - It kills `retries_not_reset`.

## Verdict
REJECTED

## Prior findings status (round 3)
| # | Sev | Status |
|---|---|---|
| R1 `open_enqueue_all` (reopen forces reroutes) | MAJOR | **Resolved.** Test 31 kills it. |
| R2 `no_stagger` (unstaggered periodic) | MAJOR | **Resolved.** Test 31 kills it, and also `due_minus`. |
| M8 clarifications not pinned (`noroute_keep_route`, `strand_truncate`, `switch_count_all`, `switch_no_retry`) | MINOR | **Resolved.** Test 32 kills all four, and also `noroute_counts`. |
| M9 test-27 comment | MINOR | **Resolved.** |
| M10 unobservable `hash_*` mutants | MINOR | **Open, accepted.** `hash_no_closed`, `hash_no_queues`, `hash_no_sv` and `close_desc` survive; `retry_every_tick` and `hyst_priority` are equivalent. |
| M4 budget/stats-only (`final_costs`, `noroute_costs`, `forced_budget`, `periodic_dup_prio`, `periodic_nodedup`, `periodic_stranded`, `slot_only`) | MINOR | **Open, accepted.** |

## Findings

### N1. MAJOR: the retry count is not proven to restart for each NoRoute/stranded episode (`retries_not_reset`)
- **Where:** contract, No route: "A vehicle entering NoRoute/stranded at tick `T` is therefore retried at `T+60, …, T+600` and, if none succeeds, removed at tick `T + 600` exactly". The schedule is per episode.
- **Why the mutant is plausible:**
  - In the stub, `no_route_retries` is a separate counter on the vehicle, documented as "Failed NoRoute/stranded retries **so far**". That wording reads naturally as cumulative.
  - Forgetting to reset a counter, both on a successful retry and on re-entry, is a classic bug.
- **Mutant `retries_not_reset`:** the counter is never reset. It passes all 76 tests. Every test that removes vehicles strands each vehicle only once, and test 13's random stress gives identical metrics: completed 1050, removed 1310.
- **Consequence, measured on the reference:**
  - Scenario: three_bridges(17, 23), all six bridge links closed at 10 min, reopened at 12 min, closed again at 15 min, reopened at 20 min (tick 2400 = T + 600, so the reopen comes before removal).
  - Correct implementation: **0** removed, 1120 completed.
  - Mutant: **12** vehicles vanish as "unreachable" at about tick 2220, even though the bridges reopen and their roads exist; completed falls to 1108.
  - The longer a vehicle has spent stranded in earlier episodes, the earlier it is removed. After 9 failed retries in total, one 30 s blockage removes it.
  - This is wrong, user-visible `Unreachable`/removal behavior, precisely in the repeated close/open interaction the product is built around. It violates the contract's "removed at `T + 600` exactly".
- **Fix (verified): test 33, `retry_count_restarts_for_each_stranding`** (`/tmp/ref003/fixes4_tail.rs`).
  - Six vehicles on a corridor with a 1500 m L1 are stranded at `ct`. They fail once (`no_route_retries == 1` at `ct+60`) and resume at `ct+120` after the reopen at `ct+90`.
  - They are stranded again at `S = ct+150` with `no_route_retries == 0`, have `k` retries after step `S+60k` (k = 1…9), and are all removed exactly after step `S+600` (`removed_unreachable` 0 → 6).
  - Recommended contract wording: "`no_route_retries` counts the failed retries of the current NoRoute/stranded episode. It is 0 on entering NoRoute/stranded and reset by a successful retry." Also fix the stub doc comment ("so far").

### N2. MINOR: queue-order and budget-overflow variants survive
- `close_to_periodic`: closure-affected vehicles go into the periodic FIFO. Hysteresis still switches them, because the current cost is ∞.
- `prio_lifo`: the priority backlog is popped newest first.
- `periodic_drop_rest`: periodic entries beyond the budget are dropped instead of carried over.
- `close_incl_current`: the closure also enqueues vehicles whose current link is the closed one; they get a best-route reroute from its `to` node.
- `hyst_ignore_closed`: the current cost is finite despite a closed remaining link. This is equivalent in practice, since the priority entry is served first.
- **Why MINOR:** these only affect ordering inside a budget backlog that lasts a few ticks, skipped periodic passes, or extra best-route reroutes. No route ever enters a closed link, and none of them showed a user-visible effect in the suite's scenarios. Test 26 pins "priority before periodic" only with an empty periodic queue. A periodic-backlog variant of test 26 would kill `close_to_periodic` and `periodic_drop_rest`; this is optional.

### N3. MINOR: NoRoute vehicles in origin buffers, inherited code
- `noroute_blocks`: a NoRoute vehicle blocks every later vehicle at its origin.
- `noroute_requeue`: a successful retry moves the vehicle to the buffer tail.
- Both survive. Core-002 test `unreachable_destination_yields_no_route_state` (z1 → z2 unreachable, z1 → j2 reachable) never asserts that the reachable trips flow.
- **Why MINOR:** the existing core-002 admission code already skips NoRoute correctly, so a core-003 implementer has no reason to touch it.
- **Optional:** add to that core-002 test `completed_log` contains z1 → j2 trips.

## Reference results (`/tmp/ref003`, contract at 70e7656)

| # | Test | Result | Key values |
|---|---|---|---|
| 1 | three_bridges_city_is_valid | pass | central **727** of **876** (north 125, south 24) |
| 2 | closed_link_admits_no_new_vehicles | pass | **13** on the bridge at closure |
| 3 | vehicles_on_closed_link_may_leave | pass | 0 left after 300 ticks |
| 4 | affected_vehicles_reroute_around_closure | pass | dc **635** vs db **112**; rs (3094, 0, 0, 71, 71) |
| 5 | routes_change_only_at_valid_decision_points | pass | switches **87** |
| 6 | no_route_retries_then_removed_on_schedule | pass | tracked **654** (80 stranded), removed **417** |
| 7 | reopen_restores_access | pass | unreachable 241 → done **241**; marks **[212, 212, 282, 813]** |
| 8 | reroute_budget_respected | pass | rs (3382, 0, 0, 3000, 200) |
| 9 | hysteresis_limits_route_switching | pass | 2454 trips, **0** switches, used [1038, 754] |
| 10 | commands_take_effect_at_their_tick | pass | |
| 11 | same_seed_and_commands_give_identical_state | pass | completed 5061; switches 72 |
| 12 | intervention_does_not_change_demand | pass | |
| 13 | conservation_under_random_closure_stress | pass | completed **1050**, removed **1310**, no_route 201; retries 14014, switches 110 |
| 14 | clone_continues_identically | pass | |
| 15 | state_hash_covers_state | pass | |
| 16 | stranded_vehicle_semantics | pass | completed 12 |
| 17 | backlog_forced_decision_never_enters_closed_link | pass | tick **33**, forced **2** |
| 18 | admission_refuses_closed_first_link_under_backlog | pass | no_route **50** |
| 19 | removal_is_not_an_exit | pass | **11** removed |
| 20 | state_hash_covers_vehicle_state | pass | |
| 21 | same_seed_and_commands_give_identical_observables | pass | |
| 22 | reopen_off_epoch_is_routable_immediately | pass | completed 346 @ 1830 |
| 23 | same_tick_open_then_close_ends_closed | pass | |
| 24 | stranded_not_resumed_before_retry | pass | n = **11** |
| 25 | periodic_reconsideration_switches_when_clearly_better | pass | waiting **204**, switches 258 |
| 26 | priority_drains_exactly_at_budget | pass | 3000 − 200·(t − 9) |
| 27 | periodic_reconsideration_reaches_vehicles_on_links | pass | 20 switches, budgeted 21 |
| 28 | shortest_route_respects_closures | pass | r0 = [56, 4, 6, 50, 28, 30, 63]; r1 = [56, 4, 6, 21, 48, 36, 28, 30, 63] |
| 29 | hysteresis_requires_both_conditions | pass | 0 switches / 21 budgeted |
| 30 | retry_stats_count_attempts_outside_the_budget | pass | 11 → 22 retries, budgeted 12 |
| 31 | reopen_is_picked_up_by_staggered_periodic_reconsideration | pass | switches 20 at tick 60; trip 0 back on A at 240, trip k at 240 − k; `route_switches` 2; 20 distinct ticks |
| 32 | stranded_keeps_route_and_noroute_route_is_empty | pass | stranded keep `[zj, l1, l2]` with 0 switches; 3 late NoRoute have `[]`, then 1 switch; `switches_total` **3** |
| 33 (proposed) | retry_count_restarts_for_each_stranding | pass | retries 1 @ ct+60; 0 @ S = ct+150; k @ S+60k; removed 6 after S+600 |
| core-001 / core-002 | | 20/20, 24/24 | |

- **Runtime:**
  - full `cargo test -p sim-core --tests` 7–9 s wall, with core-003 5.0 s (32 tests) or 5.4 s (33);
  - stubs fail fast (0.1 s);
  - one mutant pass over 76 tests takes about 10–30 s.

## Mutation table (76 tests)

| Mutant | Killed by |
|---|---|
| admit_closed | 18 |
| enter_closed / no_forced / forced_no_count / forced_wait | 17 |
| close_no_waiting | 8, 17, 18, 26, 32 |
| no_budget | 8, 17, 26 |
| no_inval_close | 8, 17, 26, 31 |
| no_inval_open / cmd_after_demand | 22 |
| cmd_late | 16, 18, 19, 22, 24, 26, 30, 32 |
| cmd_reorder | 23 |
| cmd_closes_last | 10 |
| periodic_first | 26 |
| prio_drop_rest (new) | 8, 18, 26 |
| hash_degenerate | 20 |
| hash_no_cmds / hash_no_rng | 15 |
| nondet | 10, 11, 14, 15, 21, core-001 |
| nondet,hash_degenerate | 10, 20, 21, core-001 ×2 |
| hyst_ratio_only / hyst_gain_only | 29 |
| hyst_incl_current / no_hysteresis | 9, 29 |
| no_periodic_switch | 25, 27, 31 |
| periodic_waiting_only | 27, 29, 31 |
| periodic_onlink_only | 25 |
| **open_enqueue_all** | **31** (R1 resolved) |
| **no_stagger** / due_minus | **31** (R2 resolved) |
| open_unstrands | 24, 30 |
| forced_on_stranded | 24 |
| removal_completes | 6, core-002 ×2 |
| removal_exit | 19 |
| replace_current / rewrite_past | 2, 3, 4, 5, 7, 10, 12, 13, 22, 27, 31, … |
| retries_fail_only / retry_budgeted | 30 |
| retry_offbyone | 6 |
| sr_no_closed | 28 |
| strand_removes | 6, 7, 13, 16, 19, 22, 30, 32 |
| stranded_as_noroute | 6, 13, 16, 19, 32 |
| stranded_moves | 6, 16, 19, 24, 30, 32 |
| stranded_pop | 6, 19 |
| noroute_keep_route / strand_truncate / switch_count_all / switch_no_retry / noroute_counts | 32 |
| **retries_not_reset (new)** | **none, MAJOR N1**; killed by proposed 33 |
| close_to_periodic / prio_lifo / periodic_drop_rest / close_incl_current / hyst_ignore_closed (new) | none (MINOR N2) |
| noroute_blocks / noroute_requeue (new) | none (MINOR N3, inherited core-002 code) |
| final_costs / noroute_costs / forced_budget / periodic_dup_prio / periodic_nodedup / periodic_stranded / slot_only | none (MINOR M4) |
| hash_no_closed / hash_no_queues / hash_no_sv / close_desc | none (MINOR M10) |
| retry_every_tick / hyst_priority | none (equivalent) |

## Notes for Gold reviewer
- **Expected exact values** are those in the table above. Highlights:
  - **Test 1:** 727 / 876.
  - **Test 2:** 13.
  - **Test 4:** 635 / 112.
  - **Test 5:** 87.
  - **Test 6:** 654 / 80 / 417.
  - **Test 7:** 241, marks [212, 212, 282, 813].
  - **Test 8:** (3382, 0, 0, 3000, 200).
  - **Test 9:** 0 switches, [1038, 754].
  - **Test 11:** 5061 / 72.
  - **Test 13:** 1050 / 1310.
  - **Test 17:** tick 33, forced 2.
  - **Test 18:** 50.
  - **Test 19:** 11.
  - **Test 24:** 11.
  - **Test 25:** 204 / 258.
  - **Test 26:** 3000 − 200·(t − 9).
  - **Test 27:** 20 / 21.
  - **Test 28:** routes as listed.
  - **Test 29:** 0 / 21.
  - **Test 30:** 11 → 22, budgeted 12.
  - **Test 31:** returns at (t + trip_id) % 240 == 0, `route_switches` 2.
  - **Test 32:** `switches_total` 3.
  - **Test 33:** 0 → 6 removals exactly after S + 600.
- **Implementation note:** reset `no_route_retries` to 0 both when a vehicle becomes NoRoute/stranded and when a retry succeeds.
- **To get APPROVED:**
  - append `/tmp/ref003/fixes4_tail.rs` (test 33);
  - add the per-episode wording for `no_route_retries` to the contract (and the stub doc);
  - update the ward table and counts (33 tests / 77 total).
  - Optional (MINOR): a periodic-backlog variant of test 26 (N2), and the core-002 reachable-trips assertion (N3).
