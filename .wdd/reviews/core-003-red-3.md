# Review: core-003 — Red gate (round 3)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.

**Inputs read**
- `.wdd/epics/core.md` and `.wdd/wards/core/ward-003.md` at `d126899`
- `crates/sim-core/tests/core_003_closures.rs` (30 tests), the unchanged stubs
- `.wdd/reviews/core-003-red-{1,2}.md`, and `git diff 2153196 HEAD`

The worktree is unchanged except for this file.

**What changed since round 2**
- Tests 27–30 are appended verbatim from the round-2 fixes.
- Test 17 now pins `t == 33`.
- The ward table is reordered and the counts updated (30 / 74).
- The contract adds three clarifications:
  - a stranded vehicle keeps its old route;
  - a NoRoute vehicle at its origin has an empty route;
  - a switch is counted only when the route vector changes.

**Method**
- **Red check** (snapshot `/tmp/stub003r3`):
  - core-001 20/20 and core-002 24/24 pass.
  - core-003 fails 0/30: 28 tests panic in `todo!()`, while tests 25 and 27 fail on their own assertions.
  - `cargo clippy -p sim-core --all-targets -- -D warnings` is clean, also with the proposed tests 31–32 appended (0/32 pass on the stubs).
- **Reference** (`/tmp/ref003`), updated for the clarifications:
  - Waiting → NoRoute now clears the route (`route = []`, `route_pos = 0`).
  - A stranded vehicle keeps its route; this was already so.
  - A switch is counted iff `new_route != old_route`; this was already so. A successful NoRoute retry therefore always counts (`[]` → route), while a stranded vehicle resuming its unchanged route counts 0.
  - The full suite of 74 tests passes. The probe values are identical to round 2 (listed below), so the clarifications change no asserted value.
- **Mutants.** 61 `MUT=` toggles: the 54 from earlier rounds plus 7 new ones, `noroute_keep_route`, `strand_truncate`, `no_stagger`, `due_minus`, `hyst_incl_current` and `open_enqueue_all`, plus the combination `nondet,hash_degenerate`.
  - Each was run over all 74 tests with `--no-fail-fast`.
  - Survivors were run against the proposed tests 31–32 in an isolated copy, `/tmp/ref003_b`.
- **Fixes.** `/tmp/ref003/fixes3_tail.rs` holds tests 31–32.
  - They pass on the reference: 32/32 when appended, `core_003_fixed3.rs`, about 5.7 s.
  - They are clippy-clean.
  - They kill every new survivor except the `hash_*`/budget-only group.
  - Note: `fixes3_tail.rs` was written by a concurrent reviewer instance working in `/tmp/ref003`. I independently checked it line by line against the contract and verified it on an isolated copy, `/tmp/ref003_b`.

## Verdict
REJECTED

## Prior findings status (round 2)

| # | Sev | Status |
|---|---|---|
| N1 periodic reconsideration of on-link vehicles | MAJOR | **Resolved.** Test 27 kills `periodic_waiting_only` and `no_periodic_switch`. |
| N2 `shortest_route` ignores closures | MAJOR | **Resolved.** Test 28 kills `sr_no_closed`. |
| M1 partial hysteresis | MINOR | **Resolved.** Test 29 kills `hyst_ratio_only`, `hyst_gain_only` and the new `hyst_incl_current`. |
| M2 retry stats and budget | MINOR | **Resolved.** Test 30 kills `retries_fail_only` and `retry_budgeted`. |
| M3 switch counting on same-route retry | MINOR | **Contract resolved** ("only when the route vector actually changes"). Still **untested**: `switch_count_all` and `switch_no_retry` survive. Test 32 covers it. |
| M4 budget-accounting variants | MINOR | **Open, accepted.** `final_costs`, `noroute_costs`, `forced_budget`, `periodic_dup_prio`, `periodic_nodedup`, `periodic_stranded` and `slot_only` still survive. They affect only budget, stats or hash. |
| M5 `forced_wait` | MINOR | **Resolved.** Test 17's `t == 33` kills it. 33 is fully determined by the core-001/002/003 contract and is independently reproduced. |
| M6 stranded route not stated | MINOR | **Contract resolved.** Still **untested**: `strand_truncate` and `noroute_keep_route` survive. Test 32 covers it. |
| M7 ward cosmetics | MINOR | **Resolved.** The table is in order and `id = 3r + c` is stated. |

## Findings

### R1. MAJOR: "Nothing is forced" on `OpenLink` is untested
- **Where:** contract, `OpenLink(l)`: "Nothing is forced. Vehicles pick it up through periodic reconsideration".
- **Mutant `open_enqueue_all`:** on reopen, every live non-final vehicle is pushed onto the priority queue, which means a best-route reroute with no hysteresis. It passes all 74 tests.
- **Why it is plausible:** "a road opened, so affected vehicles should reconsider" mirrors the close path exactly.
- **Consequence, measured on the reference:**
  - The reopening triggers a synchronized wave of switches that bypasses hysteresis.
  - Test 11 (close at 10 min, reopen at 30 min, 2 h): `switches_total` 72 → **130** and `max_budgeted_in_a_tick` 71 → 176.
  - Test 5: switches 87 → **170**.
  - Test 7: central-bridge exits in the first 5 min after reopening 70 → **134**. Traffic visibly snaps back at once instead of returning gradually.
  - This is exactly the "constant route switching" the brief says to prevent ("Apply smoothing, hysteresis, or another explicit mechanism"), and a direct contract violation in user-visible traffic.
- **Fix (verified): test 31, `reopen_is_picked_up_by_staggered_periodic_reconsideration`.** The OpenLink tick must spend no budget and add no switch.

### R2. MAJOR: staggering of periodic reconsideration is untested
- **Where:**
  - brief: "Budgeted, **staggered** route recalculation";
  - ward scope: "budgeted and staggered route reconsideration";
  - contract due rule: `(t + trip_id) % REROUTE_PERIOD_TICKS == 0`.
- **Mutant `no_stagger`:** every eligible vehicle is due at `t % 240 == 0`. It passes all 74 tests: tests 25, 27 and 29 only check that a switch happens within 240 ticks, not when.
- **Consequence, measured:**
  - Every 2 min the whole fleet reconsiders together. `max_budgeted_in_a_tick` rises from 71 to **200** (the cap) in tests 4, 5 and 11, and from 3 to **200** in test 9.
  - That gives periodic compute spikes, which become frame-time spikes once this runs in the browser each tick, and the budget saturates, delaying priority reroutes behind a periodic wave.
  - Switching becomes synchronized (herd waves): test 5 switches 87 → 95, test 11 72 → 78, and central-bridge return after reopening shifts (test 7 marks 282/813 → 289/820).
  - This is an explicitly required mechanism of this ward, absent with every test green.
- **Fix (verified): test 31.** Each vehicle returns to A exactly at its own due tick `(t + trip_id) % 240 == 0`, at 20 distinct ticks. It kills `no_stagger`, and also `due_minus`, a phase-only variant that is MINOR on its own.

### M8. MINOR: the new clarifications are not pinned
- **Surviving mutants:**
  - `noroute_keep_route`: NoRoute keeps its old route (the round-2 reference behavior);
  - `strand_truncate`: a stranded vehicle drops its remaining route;
  - `switch_count_all`: an unchanged route counts as a switch;
  - `switch_no_retry`: a successful retry is never counted.
- **Why MINOR:** they only affect `VehicleInfo.route` for stuck vehicles and the switch stats; nothing user-visible in core today. A compound bug ("truncate, then completion check before the stranded check") would be user-visible, but test 16 already catches it, via the L1 exit count and completed == 12.
- **Fix (verified): test 32, `stranded_keeps_route_and_noroute_route_is_empty`.** It kills all four.

### M9. MINOR: test-27 comment
- The comment says the due ticks are "240 − trip_id". Trip 0 is due at tick 0, while still waiting, where the best route is already A; its switch happens there.
- The assertions are correct either way (each vehicle has 1 switch and budgeted is 21). Comment only.

### M10. MINOR (carried over): unobservable `hash_*` mutants
- `hash_no_closed`, `hash_no_queues`, `hash_no_sv` and `close_desc` survive, and `retry_every_tick` and `hyst_priority` are equivalent.
- Unchanged from round 2 (F15 and F16).

## Reference results (`/tmp/ref003`, contract at `d126899`)

| # | Test | Result | Key values |
|---|---|---|---|
| 1 | three_bridges_city_is_valid | pass | central **727** of **876** (north 125, south 24) |
| 2 | closed_link_admits_no_new_vehicles | pass | **13** on the bridge at closure |
| 3 | vehicles_on_closed_link_may_leave | pass | 0 left after 300 ticks |
| 4 | affected_vehicles_reroute_around_closure | pass | dc **635** vs db **112**; tick 4200: completed 1293, active 203; rs (3094, 0, 0, 71, max 71) |
| 5 | routes_change_only_at_valid_decision_points | pass | switches_seen **87** (= switches_total); budgeted 3437 |
| 6 | no_route_retries_then_removed_on_schedule | pass | tracked **654** (80 stranded); removed_seen **417**; retries 5277; switches 0 |
| 7 | reopen_restores_access | pass | unreachable 241, done **241**; completed 1711; marks **[212, 212, 282, 813]** |
| 8 | reroute_budget_respected | pass | budget_ticks 30; rs (3382, 0, 0, 3000, 200) |
| 9 | hysteresis_limits_route_switching | pass | 2454 trips, **0** switches, used [1038, 754]; budgeted 10303, max 3 |
| 10 | commands_take_effect_at_their_tick | pass | |
| 11 | same_seed_and_commands_give_identical_state | pass | completed 5061, active 174; rs (10272, 0, 0, 72, 71) |
| 12 | intervention_does_not_change_demand | pass | |
| 13 | conservation_under_random_closure_stress | pass | completed **1050**, max_stranded **60**, removed **1310**, no_route 201; retries 14014, switches 110 |
| 14 | clone_continues_identically | pass | |
| 15 | state_hash_covers_state | pass | |
| 16 | stranded_vehicle_semantics | pass | completed 12; retries 22, switches 0 |
| 17 | backlog_forced_decision_never_enters_closed_link | pass | first z on B1 at tick **33**; forced **2**; rs (3692, 2, 0, 3010, 200) |
| 18 | admission_refuses_closed_first_link_under_backlog | pass | no_route **50**; waiting 1994; on_network 6 |
| 19 | removal_is_not_an_exit | pass | stuck **11** → removed 11; completed 1 |
| 20 | state_hash_covers_vehicle_state | pass | |
| 21 | same_seed_and_commands_give_identical_observables | pass | |
| 22 | reopen_off_epoch_is_routable_immediately | pass | removed 0; completed 346 @1830 |
| 23 | same_tick_open_then_close_ends_closed | pass | |
| 24 | stranded_not_resumed_before_retry | pass | n = **11**; forced 0; retries 11 |
| 25 | periodic_reconsideration_switches_when_clearly_better | pass | waiting **204**; switches 258; budgeted 282, max 2 |
| 26 | priority_drains_exactly_at_budget | pass | 3000 → 2800 … → 0 at t = 24 |
| 27 | periodic_reconsideration_reaches_vehicles_on_links | pass | all 20 `[l0, pj, a, q]`, 1 switch; rs (21, 0, 0, 20, 1) |
| 28 | shortest_route_respects_closures | pass | r0 = [56, 4, 6, **50**, 28, 30, 63]; r1 = [56, 4, 6, 21, **48**, 36, 28, 30, 63]; None with 48/50/52 closed |
| 29 | hysteresis_requires_both_conditions | pass | both cases: switches 0, budgeted 21 |
| 30 | retry_stats_count_attempts_outside_the_budget | pass | n = **11** (all stranded); retries 11 → 22; budgeted 12 → 12 |
| core-001 / core-002 | | 20/20, 24/24 | |
| 31–32 (proposed) | | 2/2 | |

- **Runtime:**
  - full `cargo test -p sim-core --tests` about 10 s wall, with core-003 at 4.9–5.0 s;
  - with 31–32 appended, 5.7 s;
  - the stub snapshot fails fast (0.1 s).

## Mutation table (74 tests; "fix" = proposed tests 31–32)

| Mutant | Killed by (current suite) | Fix |
|---|---|---|
| admit_closed | 18 | |
| enter_closed / no_forced / forced_no_count / forced_wait | 17 | |
| close_no_waiting | 8, 17, 18, 26 | 32 |
| no_budget / no_inval_close | 8, 17, 26 | |
| periodic_first | 26 | |
| cmd_after_demand / no_inval_open | 22 | |
| cmd_late | 16, 18, 19, 22, 24, 26, 30 | |
| cmd_reorder | 23 | |
| cmd_closes_last | 10 | |
| hash_degenerate | 20 | |
| hash_no_cmds / hash_no_rng | 15 | |
| nondet | 10, 11, 14, 15, 21, core-001 | |
| nondet,hash_degenerate | 10, 20, 21, core-001 ×2 | |
| hyst_ratio_only / hyst_gain_only | 29 | |
| hyst_incl_current (new) | 9, 29 | |
| no_hysteresis | 9, 29 | |
| no_periodic_switch | 25, 27 | |
| periodic_waiting_only | 27, 29 | |
| periodic_onlink_only | 25 | |
| open_unstrands | 24, 30 | |
| forced_on_stranded | 24 | |
| removal_completes | 6, core-002 ×2 | |
| removal_exit | 19 | |
| replace_current / rewrite_past | 2, 3, 4, 5, 7, 10, 12, 13, 22, 27 | |
| retries_fail_only / retry_budgeted | 30 | |
| retry_offbyone | 6 | |
| sr_no_closed | 28 | |
| strand_removes | 6, 7, 13, 16, 19, 22, 30 | |
| stranded_as_noroute | 6, 13, 16, 19 | |
| stranded_moves | 6, 16, 19, 24, 30 | |
| stranded_pop | 6, 19 | |
| **open_enqueue_all (new)** | **none, MAJOR R1** | 31 |
| **no_stagger (new)** | **none, MAJOR R2** | 31 |
| due_minus (new) | none (MINOR, phase only) | 31 |
| noroute_keep_route (new) | none (MINOR M8) | 32 |
| strand_truncate (new) | none (MINOR M8) | 32 |
| switch_count_all / switch_no_retry | none (MINOR M8) | 32 |
| final_costs / noroute_costs / forced_budget / periodic_dup_prio / periodic_nodedup / periodic_stranded / slot_only | none (MINOR M4, budget/stats/hash only) | |
| hash_no_closed / hash_no_queues / hash_no_sv / close_desc | none (MINOR M10, not black-box isolable) | |
| retry_every_tick / hyst_priority | none (equivalent) | |

## Notes for Gold reviewer
- **Expected exact values** are those in the table above. Highlights:
  - **Test 1:** 727 / 876.
  - **Test 2:** 13.
  - **Test 4:** 635 / 112.
  - **Test 5:** 87.
  - **Test 6:** 654 / 80 / 417.
  - **Test 7:** 241 / 241, marks [212, 212, 282, 813].
  - **Test 8:** (3382, 0, 0, 3000, 200).
  - **Test 9:** 0 switches, [1038, 754].
  - **Test 11:** completed 5061, switches 72.
  - **Test 13:** 1050 / 60 / 1310.
  - **Test 17:** tick 33, forced 2.
  - **Test 18:** 50.
  - **Test 19:** 11.
  - **Test 24:** 11.
  - **Test 25:** 204 / 258.
  - **Test 26:** 3000 − 200·(t − 9).
  - **Test 27:** 20 switches, budgeted 21.
  - **Test 28:** routes as listed.
  - **Test 29:** 0 / 21.
  - **Test 30:** 11 → 22, budgeted 12.
- **Proposed tests:**
  - **Test 31:** all 20 vehicles are admitted by tick 50 and priority-rerouted onto B at tick 50 (switches_total 20 at tick 60, no budget spent at the OpenLink tick). Each returns to A exactly at its due tick (trip 0 at 240, trip k at 240 − k), with `route_switches == 2`, at 20 distinct ticks.
  - **Test 32:** 11 stranded keep `[zj, l1, l2]`; 3 late spawns are NoRoute with `[]`. After ct + 120 the stranded have 0 switches, the late spawns have 1 switch with route `[zj, l1, l2]`, and `switches_total == 3`.
- **NoRoute-to-route counting:** a NoRoute retry that succeeds always counts as a switch (`[]` → route), including for demand trips spawned NoRoute. This follows from the two clarifications together. An implementation that keeps the pre-NoRoute route and compares against it will fail test 32.
- **To get APPROVED:**
  - append `/tmp/ref003/fixes3_tail.rs` (tests 31–32);
  - update the ward table and counts (32 tests / 76 total);
  - optionally fix the test-27 comment (M9).
