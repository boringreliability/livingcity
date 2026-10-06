# Review: core-002 — Red gate (round 4)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.

**Inputs read**
- `livingcity.md`, `.wdd/epics/core.md` and `.wdd/wards/core/ward-002.md` as of `a0bc9bc`
- `crates/sim-core/tests/core_002_demand_routing.rs` (24 tests), the stubs, `crates/sim-core/clippy.toml`
- `.wdd/reviews/core-002-red-{1,2,3}.md`
- `git diff d849e75 HEAD`: the contract now requires finite profile times; tests 23–24 added; the clippy f32 list was extended; the ward was updated to 24 tests / 44 green

The worktree is unchanged except for this file. `core_001_physics.rs` is byte-identical to `c891ba0`.

**Method**
- **Reference.** `/tmp/ref002/`, re-checked against the current contract. It already rejected non-finite profile times, so no semantic change was needed.
  - I copied the repo test file and `clippy.toml` into it.
  - New `MUT=` toggles for this round: `profile_time_nan_only`, `profile_time_pairwise_only`, `rate_inf_only`, `mult_inf_only`.
- **Red check.** I copied the repo snapshot to `/tmp/stub004`.
  - core-001: 20/20 pass.
  - core-002: 0/24 pass; all 24 panic with `not yet implemented`.
  - `cargo clippy -p sim-core --all-targets -- -D warnings` exits 0 on the stubs.
- **Probes.**
  - `/tmp/r4probe.rs`: consequences of the profiles the mutants accept.
  - `/tmp/r4_fixM.rs`: the proposed test 23 extension, verified.

## Verdict
APPROVED

## Prior findings status (round 3)

| # | Sev | Finding | Status | Evidence |
|---|---|---|---|---|
| F1 | MAJOR | non-finite rate and multiplier not tested | **Fixed** | Test 23 kills `rate_allow_inf`, `profile_allow_inf` and `profile_mult_lt0_only`, and also the new `mult_inf_only`. Test 18 kills `rate_inf_only` (NaN rate). The ∞-rate case only calls `from_scenario`, so a mutant fails fast instead of hanging. It passes with `core003_removal`. |
| F2 | MINOR | profile times not required finite | **Fixed in contract; partly tested** | `core.md` now says "**finite**, strictly increasing times … (∞ or NaN anywhere → `BadProfile`)". Test 23 checks only a NaN time inside a pair, so ±∞ times and a single NaN point remain untested (N1). |
| F3 | MINOR | flows-before-profile order untested | **Fixed** | The last line of test 23 kills `profile_first`. |
| F4 | MINOR | speed factor not checked in physics | **Fixed** | Test 24 kills `sf_not_applied` (reached 0, exceeded 44). Reference: 95/95 reached, 0 exceeded, also with `core003_removal`. |
| F5 | MINOR | f32 transcendentals unflagged | **Fixed** | A probe in `tests/` calling all 19 f32 methods plus UFCS `f32::exp2(x)` got 20/20 flagged as `disallowed method`. `f64::mul_add` and `sqrt` stay allowed, which is correct: both are correctly rounded. |
| F6 | MINOR | test 16 has no core-003 guard | **Open (latent)** | No comment or guard was added. 0 affected trips today; this is a core-003 Red item. |
| r1-12 | MINOR | `smoke` example missing | **Open (Gold item)** | `examples/` still contains only `bottleneck.rs`. Ward steps 2–3 need it. |

## Findings

### No BLOCKERs
- All 24 tests pass on the contract-exact reference, with and without `core003_removal`.
- Test 23:
  - It asserts only what the contract states.
  - Its BadRate-before-BadProfile line matches the "flows, then the profile" order.
  - `Profile { points }` with an empty vec is the "constant 1.0" case.
- Test 24:
  - Its 1e-9 tolerance matches the contract's "Float comparisons" allowance, since `v = (s' − s)/DT` can exceed `vmax × sf` by a few ulp.
  - All corridor links share `vmax`, so discharge entry (`min(v', vmax_next × sf)`) cannot lift a vehicle above its own cap.

### No MAJORs
Every mutant within core-002's responsibility that changes observable behavior is killed. The survivors are the two MINOR mutants in N1 and four that are equivalent or inert.

### N1. MINOR: ±∞ profile times and a single NaN point are not tested
- The contract says "∞ or NaN anywhere → `BadProfile`". Test 23 only covers `[(0, 1), (NaN, 1)]`.
- **Two mutants pass all 24 + 20 tests:**
  - `profile_time_nan_only` checks `t.is_nan()` per point instead of `!t.is_finite()`.
  - `profile_time_pairwise_only` uses no per-point time check, only a NaN-aware strictly-increasing pair check. That is the natural shape once clippy's `neg_cmp_op_on_partial_ord` forbids `!(t1 > t0)`, and the NaN-time line in test 23 is satisfied by the pair check alone.
- **Measured** (`/tmp/r4probe.rs`, 1800 veh/h, first 600 s; the reference gives `BadProfile` for each of these):

  | Profile | Both mutants |
  |---|---|
  | `[(-inf, 1), (600, 2)]` | Ok, **0 trips** (`(t+∞)/(600+∞)` = NaN, so all demand is silently lost until t = 600 s) |
  | `[(0, 1), (inf, 2)]` | Ok, 296 trips (constant 1; the ramp is never reached) |
  | `[(inf, 2)]` | Ok, 608 trips (constant 2) |
  | `[(NaN, 2)]` | `pairwise_only`: Ok, 608 trips (constant 2 in this `at()`; another `at()` shape may yield NaN and zero demand) |

- **Why MINOR, not MAJOR (unlike r3 F1):**
  - The only harmful case needs a −∞ time or a lone NaN time, both far less plausible inputs than a NaN multiplier: JSON cannot encode them, and a −∞ needs `-x/0` in time generation.
  - A +∞ time behaves like the mathematical limit.
  - The consequence is wrong error reporting on absurd input, not a plausible user-visible defect.
- **Fix (verified, `/tmp/r4_fixM.rs`).** Add to test 23 before the "flows before profile" line:
  ```rust
  assert_eq!(err(mk(vec![(z, k, 10.0)], vec![(f64::NEG_INFINITY, 1.0), (600.0, 2.0)])), Some(DemandError::BadProfile));
  assert_eq!(err(mk(vec![(z, k, 10.0)], vec![(0.0, 1.0), (f64::INFINITY, 2.0)])), Some(DemandError::BadProfile));
  assert_eq!(err(mk(vec![(z, k, 10.0)], vec![(f64::NAN, 1.0)])), Some(DemandError::BadProfile));
  ```
  It passes on the reference, plain and with `core003_removal`, and kills `profile_time_nan_only`, `profile_time_pairwise_only` and `profile_time_unchecked`.
- The ward row 23 text should then read "∞/NaN times".

### N2. MINOR (doc)
- The ward Tests table lists row 13 after 24, a pre-existing quirk.
- Row 24 says "exactly vmax × sf", while the test uses a 1e-9 tolerance (correctly). Wording only.

### Carried, latent
- F6: test 16 core-003 guard.
- r1-12: `smoke` example, for Gold.

## Reference results (`/tmp/ref002`, current contract)

| Suite | Plain | `MUT=core003_removal` |
|---|---|---|
| core-002 (24) | **24/24 pass** | **24/24 pass** |
| core-001 (20) | **20/20 pass** | **20/20 pass** |
| Proposed test 23 extension (N1) | pass | pass |
| Repo stubs (`/tmp/stub004`) | core-002 0/24 (`todo!`), core-001 20/20: Red as required | — |

**Clippy (`-D warnings`)**
- Reference src + repo tests + repo `clippy.toml`: rc = 0.
- Stubs: rc = 0.

## Mutation table (24 tests as written; every mutant had 0 core-001 failures)

| Mutant | Caught by (core-002 test #) |
|---|---|
| stateful_demand | 1, 12, 5, 15 |
| demand_tick_plus1 | 1 |
| demand_reads_world | 5 |
| demand_seed_mix_behavior | 1, 12 |
| behavior_from_demand_seed | 12, 19, 22 |
| speed_factor_wide | 12, 19, 22 |
| profile_at_tick | 4, 15 |
| profile_step / profile_last_zero / profile_before_first_one | 4 |
| rate_no_dt | 3, 4, 15, 20 |
| round_instead | 16 tests (incl. 24) |
| floor_only | 17 tests (incl. 24) |
| bernoulli_only | 3, 15 |
| no_outer_splitmix / copy_major | 15 |
| same_draw_all_flows | 2, 15 |
| mix3_xor / cost_key_floor | 14 |
| forward_dijkstra / highest_id_tie | 7 |
| relax_through_zones / nexthop_no_zone_skip | 6 |
| f64_dijkstra / float_cost_report | 6, 16 |
| router_ff_costs / cost_before_demand | 16 |
| ff_no_sat_term | 14, 20 |
| smoothed_init_zero / smoothed_unclamped | 10, 20 |
| smoothed_unclamped_raw | 9, 10, 20 |
| queue_all / queue_no_lanes / observed_mean_only | 10, 20 |
| acc_no_reset / exit_plus1 / no_exit_on_completion / epoch_late | 10, 20 |
| epoch_at_zero | 10 |
| no_exit_keep / clamp_observed / idle_obs_ff / idle_reset_ff | 20 |
| validate_ok | 18, 21, 23 |
| unknown_as_badorigin / unknown_dest_unchecked | 18, 21 |
| kind_major / rate_first / unknown_dest_after / origin_zone_only | 21 |
| **rate_allow_inf** (r3 MAJOR) | **23** |
| **profile_allow_inf** (r3 MAJOR) | **23** |
| **profile_mult_lt0_only** (r3 MAJOR) | **23** |
| profile_time_unchecked (r3 F2) | 23 |
| profile_first (r3 F3) | 23 |
| mult_inf_only (new) | 23 |
| rate_inf_only (new) | 18 |
| **sf_not_applied** (r3 F4) | **24** |
| created_at_admit / created_plus1 | 17 |
| explicit_draws | 19 |
| speed_at_admit | 19, 22 |
| noroute_no_draw | 19, 22 |
| noroute_draw_late | 22 |
| noroute_dropped / noroute_counted_waiting / unreachable_no_noroute | 8, 13 |
| noroute_blocks | 8 |
| queued_le / queued_incl_waiting / age_on_network_only | 13 |
| mean_tt_rolling / window_inclusive / window_by_created | 13 |
| profile_time_nan_only (new) | **NOT CAUGHT — MINOR (N1)**; killed by the N1 fix |
| profile_time_pairwise_only (new) | **NOT CAUGHT — MINOR (N1)**; killed by the N1 fix |
| cost_no_ff_clamp | equivalent: `smoothed` is already clamped to ≥ free flow |
| cost_is_smoothed | equivalent under the clamp |
| alpha_swapped | equivalent at α = 0.5 |
| mean_tt_last_window | equivalent within 3000 ticks |
| forward_rev (alone) | inert: it only acts inside `forward_dijkstra` |
| core003_removal (contract-mandated) | passes all 24 (correct) |

## Notes for the Gold reviewer (exact expected values, contract-exact reference)

**Earlier values (r3 notes, unchanged and re-verified by the suite passing)**
- Golden RNG:
  - `splitmix64(0) = 0xe220a8397b1dcdaf`
  - `mix3(1,2,3) = 0xd0734750fde362b3`
  - `mix3(7,0,0) = 0x9c01479161bc5d78`
  - `unit_f64(u64::MAX) = 1 − 2⁻⁵³`
  - The demand draw uses the **outer** `splitmix64`.
- Tests 1–4: test 1 total = 532; test 2: 1825 vs 1842; test 3: low 2350, high 9026; test 4: h1 = 3568, h2 = 7200.
- Test 8: no_route 303 / removed 0 / completed 221 / waiting 66. With `core003_removal`: no_route 153 / removed 150.
- Test 9: L1 at tick 1200 = 123.502 (free flow 22.249); side link 23.5827 = free flow.
- Test 10:
  - Final costs `[77.6667, 239.5000, 14.6550, 37.8202, 23.5827]`
  - Free flow `[7.8609, 22.2494, 12.7914, 36.6379, 23.5827]`
  - `cost_epoch` = 59
- Test 13 at tick 3000:
  - generated 2964, completed 2703, active 261, no_route 45, removed 0, queued 8, mean_tt 111.906 s.
  - With `core003_removal`: active 225, no_route 9, removed 36.
- Test 16: `differs_from_ff` = 863.
- Test 19: 183 demand trips.
- Test 20: last completion at tick 2546; costs at tick 2400 `[8.164, 239.341, 14.700, 38.288, 23.583]`; exactly free flow from tick 3600.

**New this round**
- **Test 23:** every non-finite input is rejected with the exact variant asserted:
  - ∞ rate → `BadRate(0)`
  - −1 rate together with a −1 multiplier → `BadRate(0)`
  - ∞ or NaN multiplier, NaN time → `BadProfile`
  - The reference also rejects ±∞ times and a single `[(NaN, m)]` point (N1).
- **Test 24** (`corridor(300, 5, 9)`, 2400 ticks): 95 main-link trips, 95 peak within 1e-9 of `vmax × sf`, 0 exceed it. Same with `core003_removal`.

**Implementation checks for Gold**
- The profile time check must be per point `!t.is_finite()`, not only `is_nan()` or only the pairwise ordering check (N1).
- The `smoke` example must exist, conserve vehicles and be byte-identical across runs (ward steps 2–3).
- Use `is_multiple_of` (or a local allow) for the epoch test in src.
