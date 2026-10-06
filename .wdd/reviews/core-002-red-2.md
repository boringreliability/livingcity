# Review: core-002 — Red gate (round 2)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.

**Inputs read**
- `livingcity.md`
- `.wdd/epics/core.md`, as of `263d9c4`
- `.wdd/wards/core/ward-002.md`
- `crates/sim-core/tests/core_002_demand_routing.rs` (19 tests)
- The stubs
- `crates/sim-core/clippy.toml`
- `.wdd/reviews/core-002-red-1.md`
- `git diff 9bc995c 263d9c4`

The worktree is unchanged except for this file.

**Method**
- **Reference.** I updated the round-1 reference in `/tmp/ref002/` to the current contract:
  - (a) `smoothed = max(free_flow, α·obs + (1−α)·smoothed)`, with cost = smoothed;
  - (b) `DemandError::UnknownNode`, checked first per flow (origin, then dest), with flow-major validation `UnknownNode → BadOrigin → SameOriginDest → BadRate`, then `BadProfile`;
  - (c) every demand vehicle draws a speed factor in `trips_at` order, NoRoute vehicles included.
- **Mutants.** Runtime toggles (`MUT=name`). New ones added for this round: `smoothed_unclamped`, `smoothed_unclamped_raw`, `clamp_observed`, `cost_is_smoothed`, `kind_major`, `unknown_as_badorigin`, `unknown_dest_after`, `unknown_dest_unchecked`, `rate_first`, `noroute_draw_late` and `origin_zone_only`.
- **Proposed tests.** Reviewer-proposed tests are in `/tmp/ref002/fixes2_tail.rs`. They are appended to the repo test file as `tests/core_002_fixes2.rs`, and `/tmp/ref002/runfix2.sh` runs them.
- **Stubs.** The repo test file compiles against the repo stubs (`/tmp/stub002`) and fails with `todo!()`, so it is correctly Red. Clippy is clean on the stubs.

## Verdict
REJECTED

## Prior findings status (round 1)

| # | Sev | Finding | Status | Evidence |
|---|---|---|---|---|
| 1 | BLOCKER | test 13 `tick - 100` underflow | **Fixed** | `:638` uses `saturating_sub(100)`. The reference passes test 13. |
| 2 | BLOCKER | tests 8 and 13 forbid core-003 NoRoute removal | **Fixed** | Test 8 now asserts `no_route + removed_unreachable == unreachable`, `unreachable == no_route + removed`, and that unreachable trips never complete. Test 13 dropped `removed_unreachable == 0`. With `MUT=core003_removal`, all 19 pass, and removal is really exercised: test 8 gives no_route 153 / removed 150; test 13 gives no_route 9 / removed 36. NoRoute mutants are still caught (see the table). |
| 3 | MAJOR | routing under current costs is untested | **Fixed** | Test 16 kills `router_ff_costs` and `cost_before_demand`. Premise: 863 routes differ from free flow. |
| 4 | MAJOR | `free_flow_cost` and `cost_key` are their own oracles | **Fixed** | Test 14 kills `ff_no_sat_term` and `cost_key_floor`. |
| 5 | MAJOR | `created_tick` is not tied to the demand tick | **Fixed** | Test 17 kills `created_at_admit` and `created_plus1`. |
| 6 | MAJOR | `validate` is untested | **Fixed** | Test 18 kills `validate_ok`, `unknown_as_badorigin` and `unknown_dest_unchecked`. Order coverage is incomplete (new finding N3, MINOR). |
| 7 | MAJOR | the demand draw formula is not pinned | **Fixed** | Tests 14 and 15 kill `no_outer_splitmix`, `mix3_xor` and `copy_major`. `same_draw_all_flows` is now killed reliably by test 15, not by luck. |
| 8 | MINOR | behavior-draw order | **Mostly fixed** | Test 19 kills `explicit_draws`, `noroute_no_draw` and `speed_at_admit`. `noroute_draw_late` survives (N4). |
| 9 | MINOR | Must NOT is not machine-checked | **Fixed, with gaps** | `clippy.toml` flags `f64::exp`, `ln`, `HashMap`, `HashSet` and `Instant::now` (verified, see Task 4). Some transcendentals are not listed (N5). |
| 10 | MINOR | equivalent mutants | n/a | `alpha_swapped` and `mean_tt_last_window` remain equivalent. `cost_no_ff_clamp` is now equivalent too, because the clamp makes `smoothed ≥ ff`. |
| 11 | MINOR | contract precision | **Mostly fixed** | Fixed: `UnknownNode` added; the clamp addresses idle-link decay; closed links are "excluded, never keyed". Still open: the speed range (N6). |
| 12 | MINOR | `smoke` example missing | **Open (Gold item)** | `crates/sim-core/examples/` contains only `bottleneck.rs`. |

## Findings

### N1. MAJOR: the "no exits ⇒ observed = queue_term" branch is no longer covered by any test, so a stale-cost mutant survives
- **What changed.** In round 1, `no_exit_keep` was caught by test 10 only *incidentally*: unclamped idle links decayed below free flow.
- **What survives now.** With contract change (a), the mutant `no_exit_keep` passes all 19 tests and all 20 core-001 tests. When a link has no exits in an epoch, it keeps `smoothed` instead of using `observed = queue_term`. This is a very plausible EMA mistake ("no samples, keep the estimate").
- **Why no test catches it.**
  - Test 10's links always have exits.
  - The side link in tests 9 and 10 is idle but sits at free flow, where both rules give the same value.
  - No test has a link that has *no exits while its cost is above free flow*.
- **Measured consequence.** Bottleneck scenario, demand cut off at 900 s, network empty from tick 2546:
  - **Reference:** costs return exactly to free flow by tick 3600: `[7.861, 22.249, 12.791, 36.638, 23.583]`.
  - **`no_exit_keep`:** costs stay at `[69.284, 239.460, 14.525, 38.993, 23.583]` **forever**. L1 is 10.8× free flow on an empty road.
- **Why it matters for routing.**
  - The router avoids expensive links, and an avoided link gets no exits. So once a link is congested, it is shunned permanently. That is congestion-memory lock-in.
  - It also ignores `queue_term` on a fully blocked link with zero exits, which is the core-003 closure and gridlock case.
- **Fix (verified as `fix_h_idle_links_decay_to_free_flow`).**
  - Run the test-10 oracle on `bottleneck_scenario(2400.0)` with `profile = [(0,1),(900,1),(900.5,0)]` for 4800 ticks.
  - At every epoch, assert `|link_cost − oracle| ≤ 1e-9`.
  - Premise counters: `idle_above_ff` = epochs with `acc_n == 0 && smoothed > ff`, measured 20; `low_obs_above_ff`, measured 20. Both must be > 0.
  - At the end, `link_cost(l) == ff[l]` exactly for every link.
  - It passes on the reference, also with `core003_removal`.
  - It kills `no_exit_keep`, `clamp_observed` and `smoothed_unclamped`.
  - The simplest way to apply it: in test 10, add the profile cutoff and extend the run to 4800 ticks.

### N2. MINOR: `clamp_observed` survives (clamping `observed` before the EMA instead of the result)
- **Effect:** after congestion, recovery is slightly slower. At t = 2400 s, L0 is 8.821 vs 8.164; at t = 3000 s, L1 is 23.098 vs 22.434. It converges within a few epochs.
- **Fix:** killed by fix H.

### N3. MINOR: test 18 does not check the "flow-major" order the ward table claims
These mutants survive the 19 tests:
- `kind_major`: each rule is checked over all flows before the next rule;
- `rate_first`: `BadRate` is checked before `BadOrigin`;
- `unknown_dest_after`: an unknown dest is checked after `BadOrigin`;
- `origin_zone_only`: a valid **source-node** origin is rejected as `BadOrigin`. No test builds demand from a non-zone source.

The consequence is only which error is reported, or a loud rejection of a valid model, so this is MINOR.

**Fix (verified as `fix_i_validate_order_is_flow_major`; kills all four):** add a source node `src → j` and assert:
- `(src,k)` → `Ok`
- `(99,k)` → `UnknownNode(99)`
- `(99,98)` → `UnknownNode(99)`
- `(j,99)` → `UnknownNode(99)`
- `(j,k,NaN)` → `BadOrigin(j)`
- `(z,z,−1)` → `SameOriginDest(0)`
- `[(z,k,−1),(j,k)]` → `BadRate(0)`
- `[(z,k),(z,99)]` → `UnknownNode(99)`

### N4. MINOR: test 19 cannot see where NoRoute draws fall within a tick
- **Problem:** the unreachable flow is flow 1, after the routed flow 0. So `noroute_draw_late` passes test 19. That mutant draws for routed vehicles first and for NoRoute vehicles in a second pass.
- **Fix (verified as `fix_j`):**
  - Make the unreachable flow index 0.
  - Use 1800 veh/h for both flows so they co-occur in some ticks.
  - This kills `noroute_draw_late` and `noroute_no_draw`.

### N5. MINOR: gaps in `clippy.toml`
These calls compile clean under `-D warnings` (verified in `/tmp/ref002`):
- `f64::exp_m1`, `ln_1p`, `cbrt`, `asin`, `tanh`;
- by inspection: `acos`, `atan`, `sinh`, `cosh`, `asinh`, `acosh`, `atanh`, `sin_cos`;
- every `f32::*` transcendental.

**Fix:** add them.

Separately, the test file's `#![allow(clippy::manual_is_multiple_of)]` names a lint that is newer than `rust-version = 1.87`. On an MSRV toolchain, `unknown_lints` combined with `-D warnings` would fail. It is fine on the installed 1.93.

### N6. MINOR: the speed-factor range is still inconsistent and, strictly, wrong
- `core.md:49` (Vehicles) says `[0.9, 1.1]`, while Demand and test 12 say `[0.9, 1.1)`.
- In f64, `0.9 + 0.2 × u` rounds to exactly `1.1` for `u = 1 − k·2⁻⁵³`, k = 1..3. The probability is about 3·10⁻¹⁶ per draw.
- So the half-open claim is false at the edge. Test 12 is safe with its fixed seeds.
- **Fix:** state `[0.9, 1.1]`, with the closed upper bound reachable by rounding, and make test 12 use `..=`.

### N7. MINOR (forward compatibility, latent): test 16 versus a core-003 reroute in the spawn tick
- **The case:** a trip generated on an epoch tick with `(tick + trip_id) % 240 == 0` is periodic-reroute-due in step 3 of the *same* tick, under post-update costs. If it switches route (hysteresis 0.85 / 20 s), test 16's "route == pre-step route" fails for a correct core-003.
- **Measured for this seed:** 0 such trips (`due = 0`), so the test is valid today.
- **Fix:** add a one-line comment, or skip such trips once `REROUTE_PERIOD_TICKS` exists.

### N8. MINOR: router-cache staleness was not run as a mutant (the reference has no cache)
By analysis:
- A never-invalidated per-destination cache that both spawn and `shortest_route` use would freeze free-flow trees. Test 16's premise (`differs_from_ff > 0`) then fails.
- A cache used only by spawn would fail test 16's equality.

Covered.

## Reference results (current contract, `/tmp/ref002`)

| # | Test | Result | Key values |
|---|---|---|---|
| 1 | demand_is_pure_function_of_seed_and_tick | pass | total = 532 / 2000 ticks |
| 2 | demand_differs_across_seeds | pass | 1825 vs 1842 |
| 3 | demand_mean_rate_matches_model | pass | low = 2350 (−2.1 %), high = 9026 |
| 4 | profile_interpolates_in_sim_seconds | pass | h1 = 3568, h2 = 7200 (exact) |
| 5 | demand_ignores_world_state | pass | — |
| 6 | router_matches_brute_force_and_avoids_zones | pass | 90 pairs |
| 7 | router_ties_broken_by_lowest_link_id | pass | — |
| 8 | unreachable_destination_yields_no_route_state | pass | no_route = 303, removed = 0, completed = 221, waiting = 66 (with core003_removal: 153 / 150 / 221 / 66) |
| 9 | congestion_raises_link_cost | pass | L1 at tick 1200 = 123.502 (ff 22.249); side = 23.5827 = ff |
| 10 | epoch_cost_update_is_exact | pass | final (tick 3600) `[77.6667, 239.5000, 14.6550, 37.8202, 23.5827]`, epoch 59 |
| 11 | demand_vehicles_follow_valid_routes_and_complete | pass | — |
| 12 | behavior_rng_is_separate_from_demand | pass | — |
| 13 | metrics_match_definitions | pass | see the next table |
| 14 | rng_primitives_and_cost_helpers_are_pinned | pass | — |
| 15 | trips_at_matches_contract_formula | pass | — |
| 16 | demand_routes_use_current_pre_update_costs | pass | differs_from_ff = 863 |
| 17 | created_tick_is_demand_tick | pass | — |
| 18 | validate_rejects_bad_models | pass | — |
| 19 | speed_factor_draw_order | pass | n = 183 demand trips |

**Test 13 at tick 3000**

| Run | generated | completed | active | no_route | removed | queued | mean_tt | unreachable |
|---|---|---|---|---|---|---|---|---|
| Reference | 2964 | 2703 | 261 | 45 | 0 | 8 | 111.906 s | — |
| With `core003_removal` | — | — | 225 | 9 | 36 | — | — | 45 |

Round 1 had completed 2699 and mean_tt 113.196, before the clamp.

**Totals**
- core-002: 19/19 pass.
- core-001: 20/20 pass.
- With `MUT=core003_removal`: core-002 19/19 pass.
- Reviewer fixes H, I and J: pass on the reference, with and without `core003_removal`.

## Mutation table (19 tests as written)

| Mutant | Caught by |
|---|---|
| stateful_demand | 1, 5, 12, 15 |
| demand_tick_plus1 | 1 |
| demand_reads_world | 5 |
| demand_seed_mix_behavior | 1, 12 |
| behavior_from_demand_seed | 12, 19 |
| speed_factor_wide | 12, 19 |
| profile_at_tick | 4, 15 |
| profile_step / profile_last_zero | 4 |
| rate_no_dt | 3, 4, 15 |
| round_instead / floor_only | 14–15 tests each |
| bernoulli_only | 3, 15 |
| no_outer_splitmix / copy_major | 15 |
| mix3_xor | 14 |
| same_draw_all_flows | 2, 15 |
| forward_dijkstra / highest_id_tie | 7 |
| relax_through_zones / nexthop_no_zone_skip | 6 |
| f64_dijkstra / float_cost_report | 6, 16 |
| router_ff_costs / cost_before_demand | 16 |
| ff_no_sat_term / cost_key_floor | 14 |
| smoothed_init_zero | 10 |
| queue_all / queue_no_lanes / observed_mean_only | 10 |
| acc_no_reset / exit_plus1 / no_exit_on_completion | 10 |
| epoch_late / epoch_at_zero | 10 |
| validate_ok / unknown_as_badorigin / unknown_dest_unchecked | 18 |
| created_at_admit / created_plus1 | 17 |
| explicit_draws / noroute_no_draw / speed_at_admit | 19 |
| noroute_dropped / noroute_counted_waiting / unreachable_no_noroute | 8, 13 |
| noroute_blocks | 8 |
| queued_le / queued_incl_waiting / age_on_network_only | 13 |
| mean_tt_rolling / window_inclusive / window_by_created | 13 |
| smoothed_unclamped (old contract) | 10 |
| smoothed_unclamped_raw | 9, 10 |
| **no_exit_keep** | **NOT CAUGHT — MAJOR (N1)**; killed by fix H |
| **clamp_observed** | **NOT CAUGHT — MINOR (N2)**; killed by fix H |
| **kind_major / rate_first / unknown_dest_after / origin_zone_only** | **NOT CAUGHT — MINOR (N3)**; killed by fix I |
| **noroute_draw_late** | **NOT CAUGHT — MINOR (N4)**; killed by fix J |
| cost_no_ff_clamp / cost_is_smoothed | equivalent under the clamp |
| alpha_swapped | equivalent at α = 0.5 |
| mean_tt_last_window | equivalent within 3000 ticks |
| core003_removal (contract-mandated) | passes all 19 tests (correct) |

## Task 4: clippy
- **Stray code is flagged.** I appended stray code to `/tmp/ref002/src/routing.rs` and ran `cargo clippy -p sim-core --all-targets -- -D warnings`. It errors on:
  - `f64::exp`, `f64::ln`, `f64::powi`;
  - `std::time::Instant::now`;
  - `std::collections::HashMap`, including a `use … as M` alias;
  - `HashSet`.
- **Not flagged:** `exp_m1`, `ln_1p`, `cbrt`, `asin`, `tanh` (N5).
- **Clean baseline.** The reference src plus the repo tests are clippy-clean. One exception: a literal `tick % COST_EPOCH_TICKS == 0` in src triggers `manual_is_multiple_of`. The Gold implementation should use `is_multiple_of` or allow the lint locally.
- **Test-file allows are acceptable.** The file-level `needless_range_loop`, `manual_is_multiple_of` and `type_complexity` allows are style-only and confined to the test crate. The `disallowed-*` rules still apply to the tests.

## Notes for the Gold reviewer (exact expected values, contract-exact reference)

**Golden RNG values**
- `splitmix64(0) = 0xe220a8397b1dcdaf`
- `mix3(1,2,3) = 0xd0734750fde362b3`
- `mix3(7,0,0) = 0x9c01479161bc5d78`
- `unit_f64(u64::MAX) = 1 − 2⁻⁵³`
- The demand draw uses the **outer** `splitmix64`.

**Test 10: final costs at tick 3600** (links 0..4, `cost_epoch` 59)
- Costs: `[77.6667, 239.5000, 14.6550, 37.8202, 23.5827]`
- Free flow: `[7.8609, 22.2494, 12.7914, 36.6379, 23.5827]`

**Test 9:** L1 at tick 1200 = 123.502.

**Test 13 grid at tick 3000**

| generated | completed | active | no_route | queued | mean_tt |
|---|---|---|---|---|---|
| 2964 | 2703 | 261 | 45 | 8 | 111.906 s |

**Test 8**

| no_route | completed | waiting |
|---|---|---|
| 303 | 221 | 66 |

**Test 16:** 863 routes differ from free flow. **Test 19:** 183 demand trips.

**Fix H (bottleneck with cutoff at 900 s)**
- Last completion at tick 2546.
- Costs are exactly free flow from tick 3600 on.
- Costs at tick 2400: `[8.164, 239.341, 14.700, 38.288, 23.583]`.

**Other checks**
- Check that the `smoke` example exists and that its output is conserving and byte-identical across runs (ward steps 2 and 3).
- Check that src uses no unlisted transcendentals (N5) until `clippy.toml` is extended.
