# Review: core-002 — Red gate (round 1)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.

**Inputs read**
- `livingcity.md`
- `.wdd/epics/core.md` (the full contract, focusing on Demand, Routing and Metrics, plus the NoRoute rules in Closures)
- `.wdd/wards/core/ward-002.md`
- `.wdd/memory/decisions/zone-centroids.md`
- `crates/sim-core/tests/core_002_demand_routing.rs` (13 tests)
- Stubs: `crates/sim-core/src/{rng,demand,routing,world}.rs`
- The core-001 physics in `world.rs` and `network.rs`

The worktree is unchanged except for this file.

**Method.** I copied the crate to `/tmp/ref002/`, outside the repo, and implemented core-002 there exactly per the contract:
- the rng primitives and `BehaviorRng`;
- `Profile::at`, `validate` and `trips_at`, using `unit_f64(splitmix64(mix3(seed,t,i)))`;
- a reverse Dijkstra on `cost_key` ms keys with the zone rule and next hop chosen by lowest id with strict `<`;
- epoch EMA costs in step 3, demand in step 2 using pre-update costs, a NoRoute state in the buffer that admission skips, and metrics;
- core-001 physics left untouched.

Mutants are runtime toggles (`MUT=name`) in the reference. Scripts: `/tmp/ref002/runmuts.sh` and `/tmp/ref002/runfix.sh`.

**Reviewer-proposed tests.** Each fix proposed below is implemented in `/tmp/ref002/crates/sim-core/tests/core_002_fixes.rs` (6 tests). All 6 pass on the reference and kill the mutants listed.

## Verdict
REJECTED

## Findings

### 1. BLOCKER: test 13 panics on `u64` underflow for every implementation
- **Where:** `core_002_demand_routing.rs:632`
- **Problem:** `let (from, to) = (tick.saturating_sub(600), tick - 100);`. The first check happens at `tick == 50`, and `50 - 100` panics with `attempt to subtract with overflow` (the test profile keeps overflow checks on).
  - Measured on the contract-exact reference: `metrics_match_definitions` FAILED at `:632:53`. All other tests passed.
- **Fix (verified):** use `tick.saturating_sub(100)` for `to`. With that change the reference passes all 13 tests.

### 2. BLOCKER: tests 8 and 13 assert that NoRoute vehicles are never removed, which contradicts the binding contract
- **Where:** `:320`, `:322-323` and `:617`
- **Contract:** "after `NO_ROUTE_MAX_RETRIES` it is explicitly removed (`removed_unreachable += 1`)". The section is binding for all wards. Retries happen every 60 ticks, so removal happens about 600 ticks after spawn.
- **Problem:** both tests run long enough for removals to occur:
  - Test 8 runs 1200 ticks and asserts `no_route == unreachable.len()` and `m.unreachable == no_route`.
  - Test 13 runs 3000 ticks with a permanently unreachable flow and asserts `m.removed_unreachable == 0`.
- **Effect:** these are permanent regression tests. Once core-003 implements the contract, they fail. I demonstrated this with a core-003-style retry/removal toggle in the reference (`MUT=core003_removal`): test 8 fails at `:320` and test 13 fails at `:617`.
- **Fix (verified to pass both with and without removal):**
  - Test 8: replace `:320-323` with
    ```rust
    let m = w.metrics();
    assert!(no_route > 0);
    assert_eq!(no_route + m.removed_unreachable, unreachable.len() as u64);
    assert!(w.completed_log().iter().all(|c| !unreachable.contains(&c.trip_id)));
    assert_eq!(m.no_route, no_route);
    assert_eq!(m.unreachable, no_route + m.removed_unreachable);
    ```
  - Test 13: delete `assert_eq!(m.removed_unreachable, 0);`. The `unreachable` and conservation asserts already cover it.
  - With this change the NoRoute mutants are still caught: `noroute_dropped`, `noroute_blocks`, `noroute_counted_waiting` and `unreachable_no_noroute` all still fail.

### 3. MAJOR: no test checks that routing uses current (congestion) costs, or which route a demand vehicle gets
- **Problem:**
  - Test 6 only runs on a fresh `World::new`, where costs equal free flow.
  - Tests 9 and 10 only read `link_cost`.
  - Test 11 checks that routes are *valid*, not that they are *shortest*.
- **Surviving mutants:**
  - `router_ff_costs`: the router and spawn routing ignore `link_cost` and use free flow. All 13 tests pass.
    - Consequence: routing is congestion-blind. In the test-13 grid, **863 demand trips** get a different route than the correct one.
    - This would also make core-003 rerouting meaningless.
  - `cost_before_demand`: on epoch ticks, demand is routed with post-update costs, violating "pre-update costs of that tick". All 13 tests pass.
- **Fix (verified as `fix_a_demand_routes_use_current_pre_update_costs`):** on the test-13 grid (600 veh/h, seed 4):
  - Before each `step`, take `pre = w.clone()`.
  - After the step, assert every newly generated trip's vehicle route `== pre.shortest_route(o, d).0`.
  - Assert that `shortest_route(16, 19)`'s cost `== Σ cost_key(w.link_cost(l)) / 1000` along its route.
  - Add a premise assert that at least one route differs from free flow. Measured: 863.
  - This kills both mutants.

### 4. MAJOR: `free_flow_cost` and `cost_key` are used as their own oracles and never pinned
- **Problem:** tests 6, 9 and 10 compute their expectations with the SUT's `free_flow_cost` and `cost_key`.
- **Surviving mutants:**
  - `ff_no_sat_term`: `free_flow = length/vmax`, dropping `+ 1/(lanes × SAT_FLOW_PER_LANE)`.
    - Consequence: the per-junction discharge cost disappears from routing, so the router prefers routes with more intersections and 1-lane links.
    - It also changes where `link_cost` is clamped.
  - `cost_key_floor`: truncates instead of rounding, which changes ms-key ties and route choice.
  - Both pass all 13 tests.
- **Fix (verified in `fix_b_primitives_pinned`):**
  - `free_flow_cost(300 m, 13.9 m/s, 3 lanes) == 300.0/13.9 + 1.0/(3.0*0.5)`
  - `cost_key(1.0006) == 1001`
  - `cost_key(0.25) == 250`

### 5. MAJOR: the vehicle's `created_tick` is never tied to the demand tick, so origin waiting can silently drop out of travel time
- **Problem:**
  - Test 13 recomputes `mean_travel_time_s` from `completed_log` and the mean age from `VehicleInfo.created_tick`. Both come from the SUT's own stored value.
  - Test 1 checks only `GeneratedTrip.created_tick`.
- **Surviving mutant:** `created_at_admit` resets `created_tick` at origin admission. This is a plausible mistake ("trip starts when it enters the road").
  - It violates "Waiting at the origin counts as travel time".
  - All 13 tests pass.
  - With large backlogs (test 8 holds about 66 waiting vehicles, about 165 s of queue at 0.4 veh/s), all origin delay vanishes from the headline metric.
  - `created_plus1` (off by one) also survives.
- **Fix (verified as `fix_c_created_tick_is_spawn_tick`):** for every `completed_log` entry and every live vehicle, assert `created_tick == generated_trips[trip_id].created_tick`. This can be added to test 13.

### 6. MAJOR: `DemandModel::validate` is completely untested
- **Problem:** no test builds an invalid model. `validate_ok` (always `Ok`) passes all 13 tests.
- **Why it matters:** `validate` is the **only** guard that demand origins are zones or source nodes. Demand routes come from the router, not from `spawn_with_route` validation.
  - Accepting a junction origin brings back the through-traffic starvation found by core-001 r6 (`zone-centroids.md`).
  - It also accepts `origin == dest`, NaN or negative rates, and non-increasing profiles.
- **Fix (verified as `fix_f_validate_rejects_bad_models`):** on `z ⇄ j ⇄ k`, assert:
  - `BadOrigin(j)` for a junction origin;
  - `SameOriginDest(1)`;
  - `BadRate(0)` for `-1.0` and for `NaN`;
  - `BadProfile` for equal times and for a negative multiplier;
  - `Ok` for a valid model.

### 7. MAJOR: the demand draw is not pinned to the contract formula, so correlated flows survive (only by luck)
- **Problem:**
  - Test 1 compares the world against the SUT's own `trips_at`.
  - Tests 2–4 are statistical.
- **Surviving mutants:**
  - `no_outer_splitmix`: uses `unit_f64(mix3(..))` and drops the outer `splitmix64`. My first reference draft made exactly this mistake, and all 13 tests passed.
  - `mix3_xor`: `splitmix64(a^b^c)`. This creates collisions: `(t, i)` and `(t^1, i^1)` give the same draw.
  - `copy_major`: the request order is copy index first, then flow. This changes trip id assignment.
- **Caught only by luck:**
  - `same_draw_all_flows`: one uniform per tick, shared by all flows (the hash hoisted out of the flow loop).
  - Consequence: every OD flow fires in the same ticks, producing synchronized city-wide pulses. The rates stay correct, so tests 3 and 4 pass.
  - Test 2 catches it only because this seed's totals differ by 7.4 % (1732 vs 1870) against a 5 % limit. The mutant doubles the variance of the difference, so this catch is roughly a coin flip.
- **Fix (verified in `fix_b_trips_at_matches_formula` and `fix_b_primitives_pinned`):**
  - Recompute `trips_at` for 3000 ticks from the public primitives: `e = vph/3600*DT*profile.at(t*DT)`, `n = floor(e) + (unit_f64(splitmix64(mix3(seed,t,i))) < e - floor(e))`, in flow-major order.
  - Use at least two flows with ≥ 1 trip per tick (I used 7200 and 9000 veh/h, otherwise `copy_major` survives).
  - Add golden vectors:
    - `splitmix64(0) == 0xE220A8397B1DCDAF`
    - `mix3(1,2,3) == 0xd0734750fde362b3`
    - `unit_f64(u64::MAX) == 1 - 2^-53`
    - `unit_f64(1<<11) == 2^-53`
    - `BehaviorRng::new(0)` gives `splitmix64(0)` then `splitmix64(0x9E3779B97F4A7C15)`
  - This kills all four mutants.

### 8. MINOR: the order of behavior-RNG draws is unverified
- **Surviving mutants (all pass the 13 tests):**
  - `explicit_draws`: explicit spawns consume a draw, which the contract says they must not.
  - `noroute_no_draw`: NoRoute demand vehicles do not draw, although the contract says each demand vehicle draws.
  - `speed_at_admit`: the factor is drawn at admission, so it depends on world state.
- **Fix (verified as `fix_g_speed_factor_draw_order`):**
  - Use a corridor with explicit spawns every 7 ticks plus an unreachable flow.
  - Assert that the k-th generated trip's `speed_factor == 0.9 + 0.2 * BehaviorRng::new(seed)` k-th `next_f64()`.
  - This kills all three.

### 9. MINOR: the Must NOT rules are not machine-checked
- **Rules:** no transcendental functions, no `HashMap`/`HashSet`, no wall clock. No test or lint enforces them.
- **Fix:** add a `clippy.toml` with `disallowed-methods` (`f64::{exp,ln,log2,log10,powf,sin,cos,tan,atan2,hypot,cbrt,exp_m1,ln_1p}` …) and `disallowed-types` (`std::collections::{HashMap,HashSet}`, `std::time::{Instant,SystemTime}`). The ward already requires clippy to be clean.
- `network.rs:133` uses `sqrt`. That is IEEE correctly rounded, so it is deterministic in WASM too, and should be allowed explicitly.

### 10. MINOR: equivalent and weak mutants
- `alpha_swapped` is equivalent while `COST_EMA_ALPHA = 0.5`.
- `mean_tt_last_window` (a 3600 s rolling mean) is equivalent within test 13's 3000 ticks. A 300 s window (`mean_tt_rolling`) **is** caught.

### 11. MINOR: contract precision
- An unknown `dest` has no `DemandError` variant, and the router would index out of bounds. Add `BadDest(usize)`, or document `BadOrigin` reuse.
- The speed-factor range is "[0.9, 1.1]" in Vehicles and "[0.9, 1.1)" in Demand and test 12. The half-open form is correct up to a ~1e-16 rounding edge.
- With no exits and no queue, `observed = length/vmax < free_flow`, so `smoothed` for idle links decays below free flow. `link_cost` hides this through the `max`, but costs then rise more slowly at congestion onset. Document this, or floor `observed` at free flow.
- For core-003, closed links must be *excluded*, not keyed. `cost_key(inf)` saturates to `u64::MAX`, and `d + key` would overflow.

### 12. MINOR: the `smoke` example (a ward output) does not exist yet
Not tested. The Gold reviewer will run it.

## Reference results (contract-exact reference, test 13 with the fix from finding 1)

| # | Test | Result | Key measured values |
|---|---|---|---|
| 1 | demand_is_pure_function_of_seed_and_tick | pass | total = 532 trips / 2000 ticks |
| 2 | demand_differs_across_seeds | pass | totals 1825 vs 1842 (0.9 %) |
| 3 | demand_mean_rate_matches_model | pass | low = 2350 (−2.1 %, limit 5 %); high = 9026 (+0.3 %) |
| 4 | profile_interpolates_in_sim_seconds | pass | h1 = 3568 (−0.9 %); h2 = 7200 (exact by construction: e = 1.0) |
| 5 | demand_ignores_world_state | pass | clogged waiting = 5347; calm generated = 633 |
| 6 | router_matches_brute_force_and_avoids_zones | pass | 90 pairs; via-zone 20143 ms < g0→g8 80853 ms |
| 7 | router_ties_broken_by_lowest_link_id | pass | — |
| 8 | unreachable_destination_yields_no_route_state | pass | no_route = 303, completed = 221, waiting = 66 |
| 9 | congestion_raises_link_cost | pass | L1 = 123.50 s vs ff 22.249 s; side = ff = 23.5827 s |
| 10 | epoch_cost_update_is_exact | pass | epochs with exits = 59, with queue = 59 |
| 11 | demand_vehicles_follow_valid_routes_and_complete | pass | generated 602, completed 547 |
| 12 | behavior_rng_is_separate_from_demand | pass | 328 factors, 328/328 differ across seeds |
| 13 | metrics_match_definitions | **FAIL as written** (`:632` underflow); pass with the fix | saw = (true, true, true); final completed 2699, no_route 45 |

core-001: 20/20 pass with the reference.

## Mutation table (13 tests as written + the finding 1 fix)

| Mutant | Caught by |
|---|---|
| stateful_demand (hidden counter) | 1, 2, 5, 12 |
| demand_tick_plus1 | 1 |
| demand_reads_world (backlog > 500 suppresses demand) | 5 |
| demand_seed_mix_behavior | 1, 12 |
| behavior_from_demand_seed | 12 |
| speed_factor_wide (0.8 + 0.4u) | 12 |
| profile_at_tick (t = tick, not tick × DT) | 4 |
| profile_step / profile_last_zero | 4 |
| rate_no_dt | 3, 4 |
| round_instead / floor_only | 1, 2, 3, 5, 8, 9, 10, 11, 12, 13 (floor_only also 4) |
| bernoulli_only | 3 |
| **no_outer_splitmix** | **survives** (killed by fix_b formula) |
| **mix3_xor** | **survives** (killed by fix_b golden) |
| **copy_major** | **survives** (killed by fix_b with 2 flows ≥ 1 per tick) |
| same_draw_all_flows | 2 (by luck: 7.4 % vs 5 %); killed reliably by fix_b |
| forward_dijkstra (pred = first relaxation) | 7 |
| highest_id_tie | 7 |
| relax_through_zones / nexthop_no_zone_skip | 6 |
| f64_dijkstra (no ms keys) / float_cost_report | 6 |
| **router_ff_costs** | **survives** (killed by fix_a) |
| **cost_before_demand** | **survives** (killed by fix_a) |
| **ff_no_sat_term** / **cost_key_floor** | **survives** (killed by fix_b) |
| smoothed_init_zero / smoothed_clamped | 10 |
| cost_no_ff_clamp | 9, 10 |
| alpha_swapped | survives (equivalent at α = 0.5) |
| queue_all / queue_no_lanes / observed_mean_only | 10 |
| no_exit_keep / acc_no_reset / exit_plus1 / no_exit_on_completion | 10 |
| epoch_late (update after movement) / epoch_at_zero | 10 |
| **validate_ok** | **survives** (killed by fix_f) |
| **created_at_admit** / **created_plus1** | **survives** (killed by fix_c) |
| **explicit_draws** / **noroute_no_draw** / **speed_at_admit** | **survives** (killed by fix_g) |
| noroute_dropped | 8, 13 |
| noroute_blocks (NoRoute blocks admission) | 8 |
| noroute_counted_waiting | 8, 13 |
| unreachable_no_noroute | 8, 13 |
| queued_le / queued_incl_waiting / age_on_network_only | 13 |
| mean_tt_rolling (300 s) | 13 |
| mean_tt_last_window (3600 s) | survives (equivalent within 3000 ticks) |
| window_inclusive / window_by_created | 13 |
| core003_removal (contract-mandated NoRoute removal) | **falsely fails 8 and 13** (finding 2) |

## Notes for the Gold reviewer
- Golden values:
  - `splitmix64(0) = 0xe220a8397b1dcdaf`
  - `mix3(1,2,3) = 0xd0734750fde362b3`
  - `mix3(7,0,0) = 0x9c01479161bc5d78`
  - `unit_f64(u64::MAX) = 1 − 2⁻⁵³`
- The demand draw is `unit_f64(splitmix64(mix3(seed, t, i)))`. Note the **outer** `splitmix64`, which is easy to miss and is caught only after fix 7.
- Expected values from the contract-exact reference: see the results table. Test 4 hour 2 is exactly 7200, because the expected count per tick is exactly 1.0.
- Test 10 final costs at tick 3600, links 0..4: `[77.6667, 239.5000, 14.6550, 37.8202, 23.5827]`, against free flow `[7.8609, 22.2494, 12.7914, 36.6379, 23.5827]`.
- The test-13 grid run ends at tick 3000 with:
  - generated 2964, completed 2699, active 265, no_route 45, queued 8;
  - mean_tt 113.196 s, mean incomplete age 184.475 s.
- The Must NOT checks are not covered by tests (finding 9). Grep or lint until a clippy config exists.
