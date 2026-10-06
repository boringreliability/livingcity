# Review: core-002 — Red gate (round 3)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.

**Inputs read**
- `livingcity.md`
- `.wdd/epics/core.md` as of `d849e75`
- `.wdd/wards/core/ward-002.md`
- `crates/sim-core/tests/core_002_demand_routing.rs` (22 tests)
- The stubs
- `crates/sim-core/clippy.toml`
- `.wdd/reviews/core-002-red-1.md` and `core-002-red-2.md`
- `git diff 263d9c4 HEAD`

The worktree is unchanged except for this file.

**Method**
- **Reference.** `/tmp/ref002/`, re-checked against the current contract. The only contract change since r2 is the speed-range wording `[0.9, 1.1]`, which has no semantic effect, so the reference needed no change. I copied the repo test file, `clippy.toml` and `rust-version = 1.93` into it.
- **New mutants.** Added for this round:
  - EMA: `idle_obs_ff`, `idle_reset_ff`
  - Speed factor: `sf_not_applied`
  - Validation: `rate_allow_inf`, `profile_allow_inf`, `profile_mult_lt0_only`, `profile_time_unchecked`, `profile_first`
  - `profile_before_first_one`

  All are runtime toggles (`MUT=`), written clippy-clean.
- **Proposed tests.** `/tmp/ref002/fixes3_tail.rs`, concatenated into `tests/core_002_fixes3.rs` and run by `/tmp/ref002/runfix3.sh`.
- **Red check.** The repo snapshot was copied to `/tmp/stub003`. All 22 core-002 tests compile and fail with `todo!()`, so the file is correctly Red. `cargo clippy --all-targets -D warnings` exits 0 on the stubs.

## Verdict
REJECTED

## Prior findings status (round 2)

| # | Sev | Finding | Status | Evidence |
|---|---|---|---|---|
| N1 | MAJOR | `no_exit_keep` (idle link keeps a stale cost) | **Fixed** | Test 20 `idle_links_decay_to_free_flow` kills `no_exit_keep`, including together with `core003_removal`. It also kills the new `idle_obs_ff` and `idle_reset_ff`. |
| N2 | MINOR | `clamp_observed` | **Fixed** | Killed by test 20. |
| N3 | MINOR | flow-major order and source-node origin | **Fixed** | Test 21 kills `kind_major`, `rate_first`, `unknown_dest_after` and `origin_zone_only`. |
| N4 | MINOR | `noroute_draw_late` | **Fixed** | Test 22 kills it, including with `core003_removal`. Test 22 also kills `behavior_from_demand_seed`, `speed_at_admit` and `speed_factor_wide`. |
| N5 | MINOR | `clippy.toml` gaps | **Fixed for f64; partly open for f32** | Every f64 method from r2 is now flagged (Task 4). The `rust-version` bump to 1.93 resolves the `manual_is_multiple_of` / `unknown_lints` MSRV concern. 19 f32 transcendentals are still unflagged (F5). |
| N6 | MINOR | speed range `[0.9, 1.1)` vs rounding | **Fixed** | `core.md` (Vehicles and Demand), the ward table and test 12 (`..=`) all agree on `[0.9, 1.1]`. |
| N7 | MINOR | test 16 vs a core-003 reroute in the spawn tick | **Open (latent)** | No comment or guard was added. Still valid today: 0 such trips for this seed. |
| N8 | MINOR | router-cache staleness | n/a | Covered by analysis in r2. |
| r1-12 | MINOR | `smoke` example missing | **Open (Gold item)** | `examples/` still contains only `bottleneck.rs`. |

## Findings

### F1. MAJOR: non-finite rates and profile multipliers are never tested; plausible validators accept them and the sim then hangs or silently produces no demand

The contract (Demand) says:
- "`veh_per_hour` is finite and ≥ 0"
- "finite multipliers ≥ 0"

Test 18 checks only negative and NaN rates, and only a negative multiplier. No test uses `±inf` or a NaN multiplier.

**Mutants that pass all 22 + 20 tests**

| Mutant | Check it uses |
|---|---|
| `rate_allow_inf` | `bad_rate = r.is_nan() \|\| r < 0.0` |
| `profile_allow_inf` | `m.is_nan() \|\| m < 0.0` |
| `profile_mult_lt0_only` | `m < 0.0` |

**Plausibility**
- Test 18's NaN case steers implementers toward a check aimed at NaN.
- Clippy's default `neg_cmp_op_on_partial_ord` lint rejects the idiomatic `!(r >= 0.0)` under `-D warnings`. Implementers are therefore pushed to the `is_nan() || < 0.0` form, which is exactly the form that misses `inf`. I hit this myself while writing the mutant.

**Measured consequences** (probe `/tmp/r3probe/probe_r3.rs`)
- **`rate_allow_inf`**: `World::from_scenario` with `veh_per_hour = inf` returns `Ok`.
  - In the first `step`, `expected = inf` and `floor(inf) as usize == usize::MAX` (verified). `trips_at` then tries to emit 1.8·10¹⁹ requests.
  - The result is an unbounded allocation: a hang or OOM abort natively, a trap in WASM. It is not a typed `BadRate(0)`.
  - I did not run the step, to avoid exhausting memory on the host.
- **`profile_allow_inf`**: a `(0, inf)` multiplier gives the same failure.
- **`profile_mult_lt0_only`**: the profile `[(0, 1), (600, NaN)]` is accepted.
  - Interpolation gives NaN over the whole profile, and `u < NaN` is false, so every tick generates 0 trips.
  - Measured: **0 trips in 20 min at 1800 veh/h**. The reference rejects the profile with `BadProfile`.
  - This is silent loss of all demand.

**Fix (verified as `fix_k_validate_rejects_non_finite_rates_and_profiles`)**
Add to test 18:
```rust
assert_eq!(err(mk(vec![(z, k, f64::INFINITY)], vec![])), Some(DemandError::BadRate(0)));
assert_eq!(err(mk(vec![(z, k, 10.0)], vec![(0.0, f64::INFINITY)])), Some(DemandError::BadProfile));
assert_eq!(err(mk(vec![(z, k, 10.0)], vec![(0.0, 1.0), (600.0, f64::NAN)])), Some(DemandError::BadProfile));
assert_eq!(err(mk(vec![(z, k, -1.0)], vec![(0.0, -1.0)])), Some(DemandError::BadRate(0))); // flows before profile (F3)
// only after the contract fix in F2:
assert_eq!(err(mk(vec![(z, k, 10.0)], vec![(0.0, 1.0), (f64::NAN, 1.0)])), Some(DemandError::BadProfile));
```
- It passes on the reference, also with `core003_removal`.
- It kills `rate_allow_inf`, `profile_allow_inf`, `profile_mult_lt0_only`, `profile_time_unchecked` and `profile_first`.

### F2. MINOR (contract precision): profile times are not required to be finite
- The contract says "strictly increasing times", but it does not say finite.
- A literal implementation with `w[1].0 <= w[0].0` accepts `[(0, 1), (NaN, 1)]`, because NaN comparisons are false. A single-point `[(NaN, m)]` has no pair to compare at all.
- Measured: the mutant `profile_time_unchecked` accepts this profile. Here it still produced 587 trips because the multiplier is constant, but with differing multipliers interpolation yields NaN and therefore zero demand.
- The reference already rejects non-finite times.
- **Fix:** change the contract to "finite, strictly increasing times", then add the NaN-time line from F1.

### F3. MINOR: "flows, then profile" order is untested
- `profile_first` (profile validated before flows) passes all 22 tests, because no test combines a bad flow with a bad profile.
- The only consequence is which error is reported.
- **Fix:** the last line of fix K.

### F4. MINOR: nothing checks that the drawn speed factor is applied in physics
- **Mutant `sf_not_applied`:** physics uses 1.0, while `VehicleInfo.speed_factor` reports the drawn value. It passes all 22 + 20 tests.
- **Measured on the corridor, 600 veh/h, 4000 ticks:**
  - Peak `v / (vmax × sf)` = 1.111 (vehicles exceed their own top speed).
  - Mean travel time 90.02 s vs 91.28 s on the reference.
  - Behavioral heterogeneity silently disappears.
- **Why MINOR:** the core-001 physics already reads `Vehicle.speed_factor`, the same field `VehicleInfo` reports. The mutant needs a deliberately separate store, so its plausibility is low.
- **Fix (verified as `fix_l_speed_factor_caps_free_flow_speed`):**
  - Use `corridor(300.0, 5, 9)` for 2400 ticks.
  - Track each trip's peak `v` on the main link.
  - Assert that 0 trips peak above `vmax × sf + 1e-9`, and that more than 20 trips peak within 1e-9 of `vmax × sf`.
  - Use a tolerance, not `==`: `v = (s' − s) / DT` differs from `v'` by a few ulp.
  - Reference: 95 of 95 trips reach it, 0 exceed it. It passes with `core003_removal` and kills `sf_not_applied`.

### F5. MINOR: f32 transcendentals are still not machine-checked
- Verified unflagged under `-D warnings`: `f32::exp2`, `log`, `log2`, `log10`, `exp_m1`, `ln_1p`, `cbrt`, `asin`, `acos`, `atan`, `atan2`, `hypot`, `sin_cos`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`.
- f32 appears only in the export frame, so the risk is low.
- **Fix:** mirror the f64 list for f32.

### F6. MINOR (carried over from N7): test 16 has no core-003 guard
Add a comment, or skip trips that are periodic-reroute-due in their spawn tick, once `REROUTE_PERIOD_TICKS` is wired in.

### No BLOCKERs
- Tests 20–22 pass on the contract-exact reference, with and without `core003_removal`.
- Test 20's exact final assertion `link_cost == free_flow_cost` holds for a correct implementation: when idle, `queue_term < ff`, so the clamp returns `ff` exactly.
- Test 22 cannot index a missing trip under core-003: NoRoute removal happens ≥ 300 s after spawn, while `seen` records each trip at the end of its spawn tick.
- Test 12's `..=` matches the contract.

## Reference results (`/tmp/ref002`, current contract)

| Suite | Plain | `MUT=core003_removal` |
|---|---|---|
| core-002 (22) | **22/22 pass** | **22/22 pass** |
| core-001 (20) | **20/20 pass** | **20/20 pass** |
| Proposed fixes K and L (`core_002_fixes3`, 24 tests) | 24/24 pass | 24/24 pass |
| Repo stubs (`/tmp/stub003`) | 0/22 (`todo!`); Red as required | — |

**Clippy:** the reference src plus the repo tests are clean under `-D warnings` (rc = 0).

## Mutation table (22 tests as written; core-001 had 0 failures for every mutant)

| Mutant | Caught by (core-002) |
|---|---|
| stateful_demand | 1, 5, 12, 15 |
| demand_tick_plus1 | 1 |
| demand_reads_world | 5 |
| demand_seed_mix_behavior | 1, 12 |
| behavior_from_demand_seed | 12, 19, 22 |
| speed_factor_wide | 12, 19, 22 |
| profile_at_tick | 4, 15 |
| profile_step / profile_last_zero | 4 |
| profile_before_first_one (new) | 4 |
| rate_no_dt | 3, 4, 15, 20 |
| round_instead / floor_only | 15–16 tests each |
| bernoulli_only | 3, 15 |
| no_outer_splitmix / copy_major | 15 |
| mix3_xor | 14 |
| same_draw_all_flows | 2, 15 |
| forward_dijkstra (also with `forward_rev`) / highest_id_tie | 7 |
| relax_through_zones / nexthop_no_zone_skip | 6 |
| f64_dijkstra / float_cost_report | 6, 16 |
| router_ff_costs / cost_before_demand | 16 |
| ff_no_sat_term | 14, 20 |
| cost_key_floor | 14 |
| smoothed_init_zero / smoothed_unclamped | 10, 20 |
| smoothed_unclamped_raw | 9, 10, 20 |
| queue_all / queue_no_lanes / observed_mean_only | 10, 20 |
| acc_no_reset / exit_plus1 / no_exit_on_completion / epoch_late | 10, 20 |
| epoch_at_zero | 10 |
| **no_exit_keep** (r2 MAJOR) | **20** (also with `core003_removal`) |
| **clamp_observed** | **20** |
| idle_obs_ff / idle_reset_ff (new) | 20 |
| validate_ok / unknown_as_badorigin / unknown_dest_unchecked | 18, 21 |
| **kind_major / rate_first / unknown_dest_after / origin_zone_only** | **21** |
| created_at_admit / created_plus1 | 17 |
| explicit_draws | 19 |
| speed_at_admit | 19, 22 |
| noroute_no_draw | 19, 22 (also with `core003_removal`) |
| **noroute_draw_late** | **22** (also with `core003_removal`) |
| noroute_dropped / noroute_counted_waiting / unreachable_no_noroute | 8, 13 |
| noroute_blocks | 8 |
| queued_le / queued_incl_waiting / age_on_network_only | 13 |
| mean_tt_rolling / window_inclusive / window_by_created | 13 |
| **rate_allow_inf** (new) | **NOT CAUGHT — MAJOR (F1)**; killed by fix K |
| **profile_allow_inf** (new) | **NOT CAUGHT — MAJOR (F1)**; killed by fix K |
| **profile_mult_lt0_only** (new) | **NOT CAUGHT — MAJOR (F1)**; killed by fix K |
| profile_time_unchecked (new) | NOT CAUGHT — MINOR (F2; needs a contract fix); killed by fix K |
| profile_first (new) | NOT CAUGHT — MINOR (F3); killed by fix K |
| sf_not_applied (new) | NOT CAUGHT — MINOR (F4); killed by fix L |
| forward_rev (alone) | inert: it only acts inside `forward_dijkstra` |
| cost_is_smoothed | equivalent under the clamp |
| alpha_swapped | equivalent at α = 0.5 |
| mean_tt_last_window | equivalent within 3000 ticks |
| core003_removal (contract-mandated) | passes all 22 (correct) |

## Task 4: clippy (in `/tmp/ref002`, with the repo `clippy.toml`)

**Flagged as `disallowed method`:**
- **f64:** `exp_m1`, `ln_1p`, `cbrt`, `asin`, `tanh`, `acos`, `atan`, `sin_cos`, `sinh`, `cosh`, `asinh`, `acosh`, `atanh`.
- **f32:** `exp`, `ln`, `powf`, `powi`, `sin`, `cos`, `tan`.
- **UFCS calls**, for example `f64::exp_m1(x)` and `f32::exp(..)`.
- All of these were tested from a file under `tests/`, so the rules cover the test targets too.

**Not flagged (F5):**
- f32: `exp2`, `log`, `log2`, `log10`, `exp_m1`, `ln_1p`, `cbrt`, `asin`, `acos`, `atan`, `atan2`, `hypot`, `sin_cos`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`.

**Baseline:** clean, rc = 0. The stray files were moved to `/tmp/r3probe/` afterwards.

## Notes for the Gold reviewer (exact expected values, contract-exact reference)

**Golden RNG values**
- `splitmix64(0) = 0xe220a8397b1dcdaf`
- `mix3(1,2,3) = 0xd0734750fde362b3`
- `mix3(7,0,0) = 0x9c01479161bc5d78`
- `unit_f64(u64::MAX) = 1 − 2⁻⁵³`
- The demand draw uses the **outer** `splitmix64`.

**Tests 1–4**
- Test 1: total = 532 trips over 2000 ticks.
- Test 2: 1825 vs 1842.
- Test 3: low = 2350 (−2.1 %), high = 9026.
- Test 4: h1 = 3568, h2 = 7200.

**Test 8**

| no_route | removed | completed | waiting |
|---|---|---|---|
| 303 | 0 | 221 | 66 |
| 153 (with `core003_removal`) | 150 | — | — |

**Test 9:** L1 at tick 1200 = 123.502 (free flow 22.249). The side link is 23.5827 = free flow.

**Test 10**
- Final costs at tick 3600: `[77.6667, 239.5000, 14.6550, 37.8202, 23.5827]`
- Free flow: `[7.8609, 22.2494, 12.7914, 36.6379, 23.5827]`
- `cost_epoch` = 59.

**Test 13 at tick 3000**

| Run | generated | completed | active | no_route | removed | queued | mean_tt |
|---|---|---|---|---|---|---|---|
| Reference | 2964 | 2703 | 261 | 45 | 0 | 8 | 111.906 s |
| With `core003_removal` | — | — | 225 | 9 | 36 | — | — (unreachable 45) |

**Test 16:** `differs_from_ff` = 863.

**Test 19:** 183 demand trips.

**Test 20** (code identical to r2 fix H)
- Premise counters: `idle_above_ff` = 20, `low_obs_above_ff` = 20.
- Last completion at tick 2546.
- Costs at tick 2400: `[8.164, 239.341, 14.700, 38.288, 23.583]`.
- From tick 3600 on, costs equal free flow exactly.

**Tests 21 and 22:** pass on the reference. Test 22 kills `noroute_draw_late` and `noroute_no_draw`.

**Proposed fix L:** 95 of 95 main-link trips peak within 1e-9 of `vmax × sf`, and 0 exceed it.

**Other checks**
- The `smoke` example must exist and be conserving and byte-identical across runs (ward steps 2 and 3).
- The src must use no f32 transcendentals (F5) until `clippy.toml` mirrors them.
- Use `is_multiple_of` (or a local allow) for `tick % COST_EPOCH_TICKS == 0` in src.
