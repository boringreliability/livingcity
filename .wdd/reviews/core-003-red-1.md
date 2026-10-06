# Review: core-003 — Red gate (round 1)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.

**Inputs read**
- `livingcity.md`, `.wdd/epics/core.md` (model contract, as of `38b5e28`), `.wdd/wards/core/ward-003.md`
- `crates/sim-core/tests/core_003_closures.rs` (16 tests), stubs `command.rs`, `cities.rs`, the `todo!()` methods in `world.rs`
- core-001/002 sources and tests; `.wdd/reviews/core-002-red-4.md` (format and the open F6 note)

The worktree is unchanged except for this file.

**Method**
- **Red check** (`/tmp/stub003`, repo snapshot): core-001 20/20 and core-002 24/24 pass; core-003 0/16, all 16 panic with `not yet implemented`; `cargo clippy -p sim-core --all-targets -- -D warnings` is clean.
- **Reference** (`/tmp/ref003`): core-003 implemented exactly per contract on top of the approved core-001/002 code:
  - commands applied in step 1, in acceptance order;
  - close → closed set + router invalidation + priority enqueue (ascending slot, remaining route, dedup);
  - router `usable = !closed`;
  - step 3 in the order (a) epoch, (b) periodic enqueue, (c) retries (outside the budget), (d) priority, then periodic, within 200;
  - hysteresis (both conditions) on periodic reroutes only;
  - forced decisions at stop lines;
  - NoRoute/stranded with retries at E+60k and removal at E+600 (not an exit, not completed);
  - admission treats a closed first link as blocked;
  - FNV-1a `state_hash` over all state;
  - `three_bridges` per the ward spec.
- **Construction order.** The ward does not fix node/link creation order, so I built `three_bridges` in two different orders: default (west nodes, east nodes, west streets, east streets, bridges, zones) and `ORDER=1` (interleaved, reversed, bridges first). Every test value is identical in both orders except test 13.
- **Mutants.** 35 `MUT=` toggles in `world.rs`. Each was run against all 60 tests (`--no-fail-fast`) and against the proposed fixes.
- **Fixes.** Replacement and extra tests are in **`/tmp/ref003/fixes_tail.rs`**, appended to the test file as `/tmp/ref003/crates/sim-core/tests/core_003_fixed.rs`. All pass on the reference in both orders (27/27, about 5 s wall time at opt-level 2) and are clippy-clean.

## Verdict
REJECTED

## Findings

### F1. BLOCKER: test 13's premise depends on the unspecified link-ID layout of `three_bridges`
- **Where:** `core_003_closures.rs:579-602`, line 601 `assert!(w.metrics().completed > 1000)`.
- **Problem:**
  - The test picks links by `LinkId(x % n_links)`. Ward-003 fixes the geometry but not the order in which nodes and links are created, so *which* links get closed depends on that order.
  - With my default (contract-conforming) order, the random set closes the Old Town out-connector at t=911 and never reopens it. It also closes the Harbor Works in-connector at t=2860 and the Tech Park in-connector at t=5296.
  - Result: completed **995** (fails), with removed 1370 and no_route 209. With `ORDER=1` the same reference completes **1155** (passes).
  - So a correct implementation can fail. The premise is also inherently fragile: about 12 of 66 links are zone connectors, and a closed connector cuts off a whole zone.
- **Fix (verified, `fix_conservation_under_random_closure_stress`):**
  - Draw only from links with no zone endpoint.
  - Replace the premise with `completed > 500`, and require `max_stranded > 0 && removed_unreachable > 0`, which proves the stress really exercised stranding and removal.
  - Measured: default order 1050 completed, max_stranded 60, removed 1310; `ORDER=1` 2139 completed, max_stranded 13, removed 202.
  - Even without connector closures, closing two streets cuts off a zone junction, which is why 1000 stays fragile.
  - Additionally (MINOR M1), pin the construction order in the ward so Gold values are reproducible.

### F2. MAJOR: no test ever exercises the closed-link refusal in discharge or admission
- **Where:**
  - tests 2 (`:115-145`), 4 (`:177-211`), 7 (`:341-388`), 8 (`:391-435`)
  - contract: "No vehicle may enter it (discharge and origin admission refuse it)" and "Admission (step 5) treats a closed first link as blocked"
- **Problem:**
  - In every scenario the whole priority backlog is drained in step 3 of the closure tick, before steps 4 and 5. The maximum priority work in a city tick is 80; in test 8 the closed link is never anyone's *first* link, and the vehicles on the connector are the lowest slots, so they are processed first.
  - So the `closed` checks in discharge and admission are dead code for the suite.
  - **Mutant `enter_closed`** (discharge ignores `closed`, no forced decision) passes all 60 tests.
  - **Mutant `admit_closed`** (admission ignores `closed`) passes all 60 tests.
- **Consequence:**
  - In the browser city (2,000–10,000 vehicles), closing the main bridge gives a backlog far above 200 per tick. Every vehicle that reaches the bridge stop line before its priority turn would drive onto the closed bridge. That is a direct violation of the brief's first closure rule ("prevents new vehicles from entering").
  - Likewise, closing a connector would keep admitting queued vehicles onto it.
- **Fix (verified):**
  - `fix_backlog_forced_decision_never_enters_closed_link`: 3000 backlog vehicles from zone y, then 10 from z on a 150 m connector; close A at tick 25. The z vehicles' priority turn is tick 40, but the first one reaches the stop line at tick 33. Asserts `link_count(A) == 0` every tick. Kills `enter_closed`.
  - `fix_admission_refuses_closed_first_link_under_backlog`: close A then zj at tick 0, giving 2050 priority entries with the z vehicles' turn at tick 10. Asserts `link_count(zj) == 0` for 30 ticks and `no_route == 50` afterwards. Kills `admit_closed`. Note the scheduling order: closing zj *first* would put the z vehicles at the head of the queue and the test would be vacuous.

### F3. MAJOR: forced decisions are never tested
- **Where:** contract "Forced decision (step 4)". `forced_total` is 0 in every city test (tests 4, 5, 6 and 11 measured).
- **Mutant `no_forced`:** a vehicle whose next link is closed waits at the stop line until its priority pass. It passes all 60 tests.
- **Consequence:**
  - Under a large backlog, every affected vehicle that arrives early blocks its lane at the closed stop line for up to backlog/200 ticks. The queue spills back, and `forced_total` stays wrong.
  - Combined with F2, the contract's guarantee of "rerouting at valid decision points" is untested.
- **Fix (verified):** same test as F2. It asserts `forced_total >= 1` and that the first z vehicle is on B1 before its priority turn. Reference: on B1 at tick **33**, forced_total **2**, max_budgeted 200. `no_forced` fails it.

### F4. MAJOR: "removal is not an exit" is untested
- **Where:** contract "it is **not** an exit (no `link_exit_count`, no exit-time sample)". Test 6 (`:272-338`) checks only `removed_unreachable`, conservation and the completed log.
- **Mutant `removal_exit`** (a removal calls `record_exit`) passes all 60 tests.
- **Consequence:**
  - Each removed stranded vehicle adds 1 to its link's exit count, which inflates the bridge/exit metrics the UI and the `bridge` example show.
  - It also feeds an exit-time sample of ≥ 300 s into that link's EMA, so routing starts to shun the link for no physical reason.
- **Fix (verified, `fix_removal_is_not_an_exit`):**
  - Use the test-16 corridor with L2 closed permanently.
  - Assert that the exit counts of zj and L1 never change during 700 ticks, that `removed_unreachable` equals the stuck count, and that nothing is left.
  - It kills `removal_exit`.

### F5. MAJOR: `state_hash` coverage is untested, so the determinism tests are vacuous against a weak hash
- **Where:** tests 11 (`:534-554`), 14 (`:606-626`) and 15 (`:630-665`).
- **Problem:**
  - Every "≠" check in test 15 (and the ones in tests 10 and 12) is satisfied by a hash of just `(tick, demand_seed, behavior-RNG state, command log)`. That is mutant `hash_degenerate`, and it passes all 60 tests.
  - With such a hash, tests 11 and 14 can no longer detect divergence. `nondet,hash_degenerate` (lane ties broken by `HashSet` iteration, a different order per world) still passes tests 11 and 14; only test 10's observable comparison and a core-001 test catch it.
  - A core-003 nondeterminism (e.g. a hash-ordered reroute queue) would not even hit those.
- **Consequence:**
  - The brief requires "deterministic outcomes for the same seed and command log", and the timeline epic will rely on `state_hash` to validate snapshot restore. Both rest on an untested hash.
- **Fix (verified):**
  - `fix_state_hash_covers_vehicle_state`: worlds that differ only in an explicit spawn's route, or only in slot assignment (same log, tick and seeds), must hash differently for 20 ticks. Kills `hash_degenerate`.
  - `fix_same_seed_and_commands_give_identical_observables`: compares metrics, reroute_stats, all `VehicleInfo`, all `link_vehicles` and costs every 300 ticks for 45 min. Kills `nondet,hash_degenerate` independently of hash quality.

### F6. MAJOR: router-cache invalidation on `OpenLink` is untested, because every city command tick is an epoch boundary
- **Where:**
  - Closure/reopen ticks are 1200, 2400, 3000, 3600, 4200 and T+480 = 1680, all multiples of `COST_EPOCH_TICKS`. Step 3(a) invalidates the cache anyway.
  - Tests 8 (close at 10) and 16 (close 80, open 170) are off-epoch. But in test 16 the next retry (200) always comes after an epoch boundary (180), because `NO_ROUTE_RETRY_TICKS == COST_EPOCH_TICKS`.
- **Mutant `no_inval_open`** passes all 60 tests. (`no_inval_close` is caught only by test 8.)
- **Consequence:** after a reopen between epochs, spawns and reroutes keep using a tree that still excludes the link for up to 30 s:
  - trips spawn as NoRoute and show up in `unreachable`;
  - the reopened bridge stays unused even though "reopen" was clicked.
- **Fix (verified, `fix_reopen_off_epoch_is_routable_immediately`):**
  - Close all bridges at T and reopen at **T+510 = 1710** (off-epoch).
  - Assert that no trip created at or after the reopen tick is ever NoRoute, and that `removed == 0`.
  - It kills `no_inval_open` and also `cmd_after_demand`.
  - Recommendation: change test 7's reopen to an off-epoch tick in the same way, and put at least one city closure off-epoch.

### F7. MAJOR: periodic reconsideration can be a no-op; nothing tests that it ever switches
- **Where:** test 9 (`:438-476`) only bounds switching from above, and with the correct reference it measures **0 switches** (hist `[2454, 0, …]`). Test 5's 87 route changes are closure-driven (priority).
- **Mutant `no_periodic_switch`** (periodic reroutes never switch) passes all 60 tests and every other proposed fix.
- **Consequence:**
  - Vehicles never react to congestion after spawning: no "congestion-aware routing … budgeted, staggered route recalculation" (brief, and the core of this ward).
  - Test 9 would even reward this.
- **Fix (verified, `fix_periodic_reconsideration_switches_when_clearly_better`):**
  - 300 vehicles spawned on the slow B route (≈116 s) while A (≈73 s) clears both hysteresis conditions.
  - After 240 ticks, every vehicle still waiting (204) has route `[zj, A]` with `route_switches == 1`.
  - It kills `no_periodic_switch`. `no_hysteresis` stays killed by test 9: only 1023/2454 vehicles have ≤ 1 switch.

### F8. MINOR (M1): `three_bridges` creation order is not specified
- **Where:** ward-003 "Three-bridges city".
- **Problem:** IDs drive tie-breaking, the test-13 link draw (F1) and every "exact value" a Gold reviewer would check.
- **Fix:** specify the node order (e.g. west junctions column-major, east junctions, zones W→E and S→N) and the link order (west streets, east streets, bridges S→N, connectors), as `two_way` pairs.

### F9. MINOR: same-tick ordering is only tested in one direction
- **Where:** `:509-529`.
- **Problem:** Mutant `cmd_reorder` ("apply all closes, then all opens") passes, because the test's only pair is close-then-open. `cmd_closes_last` is caught.
- **Fix (verified):** `fix_same_tick_open_then_close_ends_closed`.

### F10. MINOR: test 16 does not check "not before the retry", and the contract is ambiguous about forced decisions for stranded fronts
- **Where:** `:714-718`; contract "Forced decision … a lane front that reaches the stop line … whose next link is closed is rerouted".
- **Problem:**
  - A stranded front literally matches that sentence.
  - Mutant `forced_on_stranded` (stranded fronts retried every tick through the forced path) and mutant `open_unstrands` (OpenLink makes retries due immediately, despite "Nothing is forced") both pass. Each costs a Dijkstra per stranded front per tick, and the resume schedule is wrong.
- **Fix:**
  - Contract: "Stranded vehicles take no forced decisions; they only retry on schedule."
  - Test, verified: `fix_stranded_not_resumed_before_retry` asserts that vehicles are still stranded after step close+119 and that `forced_total` is unchanged.

### F11. MINOR: test 8 cannot see the priority-before-periodic order
- **Where:** `:416-432`.
- **Problem:**
  - `budget_ticks >= 15` is met by periodic spending alone: after the drain, ticks 25–39 each spend about 12.
  - Mutant `periodic_first` passes. Its consequence is only a slower drain, since forced decisions still protect correctness once F3 is tested.
- **Fix (verified):** `fix_priority_drains_exactly_at_budget` asserts `uses_a == 3000 − 200·(t−9)` exactly for t = 10…24. Reference: 2800, 2600, …, 0. It kills `periodic_first`.

### F12. MINOR: partial hysteresis is not tested
- **Problem:**
  - `hyst_ratio_only` gives 37 switches in test 9 and passes.
  - `hyst_gain_only` passes and is identical to the reference here.
- **Fix:** a small unit-style test with known costs:
  - a switch with ratio < 0.85 but a gain under 20 s must not happen;
  - a switch with a gain ≥ 20 s but a ratio ≥ 0.85 must not happen.

### F13. MINOR: contract ambiguities to resolve
- **Queue entry identity under slot reuse.** "Entries whose vehicle is gone" can hit a *new* vehicle in a reused LIFO slot. Specify entries as `(slot, trip_id)`; the reference does this.
- **"Unless already queued" in the periodic due rule.** Specify whether this means the periodic FIFO only or either queue. It changes budget accounting and the hash.
- **Counters.** Specify whether a NoRoute→route recovery counts in `route_switches`/`switches_total`, and whether `retries_total` counts attempts or failures.
- **`shortest_route`.** Specify whether the public method respects closures. The reference does.
- **The `stranded` route.** The vehicle keeps its old route. Test 5 relies on this, but the contract should say it.

### F14. MINOR: ward text does not match test 7
- Ward test 7 says "reopening at T+300 s". The test reopens at T+480 ticks (240 s), and its comment says 240 s.

### F15. MINOR: some hash checks are mislabelled and some coverage is not testable black-box
- **Where:** `:650-659`.
- **Problem:**
  - The "closed state of an unused link" check differs in the command log too, so `hash_no_closed` passes. The closed set and pending commands are functions of (log, tick), so this cannot be isolated black-box.
  - `hash_no_queues` and `hash_no_sv` also survive for the same reason.
- **Fix:** relabel the check. The timeline epic should cover these with restore-then-compare tests.

### F16. MINOR: equivalent or unobservable mutants
- `close_desc` (descending enqueue): only the order inside one budget slice changes.
- `hyst_priority`: remaining contains a closed link, so the cost is ∞ and the reroute switches anyway.
- `retry_every_tick` as written (`>=`): `next_retry_tick` is always re-set on failure, so it behaves like the reference.

## Reference results

Reference `/tmp/ref003`. Default order unless stated; `ORDER=1` values were identical except test 13.

| # | Test | Default | ORDER=1 | Key values |
|---|---|---|---|---|
| 1 | three_bridges_city_is_valid | pass | pass | central 727 of 876 west→east crossings, share **0.830** (north 125, south 24) |
| 2 | closed_link_admits_no_new_vehicles | pass | pass | 13 vehicles on the bridge at closure |
| 3 | vehicles_on_closed_link_may_leave | pass | pass | bridge empty after **34** ticks (limit 300) |
| 4 | affected_vehicles_reroute_around_closure | pass | pass | north+south exits: closed **635** vs baseline **112**; forced_total 0; unreachable 0 |
| 5 | routes_change_only_at_valid_decision_points | pass | pass | switches_seen **87** (> 50) |
| 6 | no_route_retries_then_removed_on_schedule | pass | pass | tracked 654 (stranded 80), removed_seen **417**, retries_total 5277 |
| 7 | reopen_restores_access | pass | pass | unreachable trips 241, completed **241/241**, removed 0; marks [212, 212, 282, 813] → 531 after reopen |
| 8 | reroute_budget_respected | pass | pass | uses_a 3000 → 2800 … 0 at tick 24 (exactly 200/tick); max_budgeted 200 |
| 9 | hysteresis_limits_route_switching | pass | pass | 2454 trips, **0 switches**, at_most_one 2454/2454, used [1038, 754] |
| 10 | commands_take_effect_at_their_tick | pass | pass | |
| 11 | same_seed_and_commands_give_identical_state | pass | pass | completed 5061 in 2 h, switches_total 72 |
| 12 | intervention_does_not_change_demand | pass | pass | |
| 13 | conservation_under_random_closure_stress | **FAIL (995)** | pass (1155) | removed 1370 / 1199 (F1) |
| 14 | clone_continues_identically | pass | pass | |
| 15 | state_hash_covers_state | pass | pass | |
| 16 | stranded_vehicle_semantics | pass | pass | |
| core-001 / core-002 | | 20/20, 24/24 | 20/20, 24/24 | |

- **Runtime** (opt-level 2): the core-003 suite takes about 5 s wall time in parallel; the 27-test fixed suite also about 5 s. Test 11 (2 h with a full-state FNV each tick) is the longest test and is acceptable.
- **Premises and thresholds:**
  - Test 1's > 0.5: 0.83 has a comfortable margin.
  - Test 7's 95 %: 100 % measured.
  - Test 8's ≥ 15 ticks: met, but trivially (F11).
  - Test 9's limits: met with 0 switches; teeth only against no hysteresis (1023/2454), see F7.
  - Test 5's > 50: 87, a moderate margin.

## Mutation table

Results against the 60 original tests (ORDER=1, so test 13 is not baseline noise) and against the fixes.

| Mutant | Consequence | Killed by (original) | Killed by fix |
|---|---|---|---|
| `enter_closed` (discharge ignores closure, no forced) | vehicles drive onto the closed bridge under backlog | **none** | F2 |
| `admit_closed` | queued vehicles admitted onto a closed connector | **none** | F2 |
| `no_forced` | lane blocked at closed stop line until priority pass | **none** | F3 |
| `close_no_waiting` | waiting vehicles keep routes over the closure | 8 | |
| `replace_current` / `rewrite_past` | current link / past route rewritten | 2, 3, 4, 5, 7, 10, 12, 13 | |
| `no_budget` | per-tick work unbounded | 8 | |
| `periodic_first` | priority drain slowed | **none** | F11 |
| `no_hysteresis` | flapping | 9 | |
| `hyst_ratio_only` / `hyst_gain_only` | weaker hysteresis | none | (F12, not written) |
| `hyst_priority` | equivalent | none | n/a |
| `no_periodic_switch` | no congestion response en route | **none** | F7 |
| `retry_offbyone` (removal after 11) | wrong removal schedule | 6 | |
| `removal_completes` | removal logged as completion | 6, core-002 ×2 | |
| `removal_exit` | inflated exits, bogus EMA sample | **none** | F4 |
| `stranded_as_noroute` | stranded miscounted | 6, 16 | |
| `strand_removes` (stranded removed at once) | vehicles teleported away | 6, 7, 16 | |
| `stranded_moves` (stranded keep driving) | stranded vehicles keep driving | 6, 16 | |
| `no_inval_close` | routes over closed link until epoch | 8 | |
| `no_inval_open` | reopened link unusable until epoch | **none** | F6 |
| `cmd_late` (applied after movement) | vehicles enter in closure tick | 16 | |
| `cmd_after_demand` | spawns in closure tick use old network | none | F6 (incidental) |
| `cmd_reorder` (closes then opens) | same-tick conflicts misresolved | none | F9 |
| `cmd_closes_last` | same-tick conflicts misresolved | 10 | |
| `open_unstrands` | resume ignores retry schedule | none | F10 |
| `forced_on_stranded` | per-tick Dijkstra for stranded fronts | none | F10 |
| `close_desc` | unobservable | none | n/a |
| `hash_no_cmds` | pending/log unhashed | 15 | |
| `hash_no_rng` | behavior RNG unhashed | 15 | |
| `hash_no_closed` / `hash_no_queues` / `hash_no_sv` | not black-box isolable (F15) | none | none |
| `hash_degenerate` | hash = tick + seeds + rng + log | **none** | F5 |
| `nondet` (HashSet lane ties) | nondeterminism | 10, 11, 14, 15, core-001 | |
| `nondet,hash_degenerate` | nondeterminism hidden by weak hash | 10, core-001 only (11 and 14 pass) | F5 |

## Notes for Gold reviewer

These are exact reference values, `three_bridges(17, 23)`, built in either order. They are identical in both orders except test 13.
- **Test 1 (30 min baseline):** central_bridge[0] exits **727**; all west→east exits **876**; north 125, south 24.
- **Test 2:** 13 trips on the central bridge at closure.
- **Test 3:** the bridge is empty 34 ticks after closure.
- **Test 4:**
  - alternative exits in [T+600, T+3000): closed **635**, baseline **112**;
  - at tick 4200: completed 1293, active 203;
  - reroute stats `budgeted 3094, forced 0, switches 71, max_budgeted 71`.
- **Test 5:** 87 route changes; stats `budgeted 3437, switches 87`.
- **Test 6:** 654 tracked (80 stranded, 574 NoRoute); 417 removed by tick T+1600; `retries_total 5277`, `budgeted 794`.
- **Test 7a:** 241 unreachable trips, all completed; at tick 5280 completed 1711, active 190.
- **Test 7b:** central exits at the marks: 212, 212, 282, 813.
- **Test 8:** `uses_a` 3000 before closure, then 2800, 2600, … 0 (tick 24); budgeted_total 3382 at tick 39; forced 0.
- **Test 9:**
  - 2454 trips, 0 switches;
  - out-link exits [1038, 754];
  - completed 1761, waiting 577;
  - `budgeted 10303`, `max_budgeted_in_a_tick 3`.
- **Test 11:** at 2 h: generated 5235, completed 5061, active 174; `budgeted 10272, switches 72, max 71`.
- **Test 13:**
  - original (layout-dependent): 995 (default order) / 1155 (`ORDER=1`);
  - fixed version: 1050 / 2139.
- **Fix tests:**
  - F3: first z vehicle on B1 at tick 33; forced_total 2.
  - F7: 204 still waiting, all on `[zj, A]`; switches_total 258.
- **Red state:** all 16 tests currently panic with `todo!()`; core-001/002 stay green; clippy is clean.
