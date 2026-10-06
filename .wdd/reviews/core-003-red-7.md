# Review: core-003 — Red gate (round 7)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.

**Inputs read**
- `.wdd/epics/core.md` (binding contract) and `.wdd/wards/core/ward-003.md`
- `crates/sim-core/tests/core_003_closures.rs` (35 tests) and the stubs
- `.wdd/reviews/core-003-red-6.md`
- `git diff 1a84953 HEAD` (cbd18ba)

**What changed since round 6**
- Test 35 `forced_decision_without_route_strands_at_the_stop_line` is appended. Its body is identical to `/tmp/ref003/fixes6_tail.rs`; there is only one blank line of whitespace difference.
- The ward has row 35 and the counts 35 / 79.
- Contract, Forced decision, gains: "If none is found, the vehicle becomes stranded at that tick (retry schedule from that tick, count 0) and does not cross."

**Method**
- **Red check** (worktree, HEAD cbd18ba):
  - core-001 passes 20/20 and core-002 24/24.
  - core-003 passes **0/35**, and the stubs fail in 0.09 s.
  - `cargo clippy -p sim-core --all-targets -- -D warnings` is clean.
- **Reference** (`/tmp/ref003`):
  - The test files are synced to HEAD by byte compare.
  - The non-stub sources are identical to the worktree.
  - `world.rs` changed only by new `MUT=` toggles. The pre-edit copy is `world_r7_pre.rs.bak`.
  - New toggles: `forced_from_from`, `forced_retry_plus1`, `forced_fail_switch`, `forced_needs_credit`, `forced_fail_rr`.
- **Mutants:**
  - The set covers every mutant NOT CAUGHT in round 6, every forced or stranded-path mutant, and the 5 new ones: 45 runs (`mutlist_r7.txt`).
  - Each run covers all 79 tests with `--no-fail-fast`. Results are in `/tmp/ref003/mut_r7.txt`.
  - The proposed test 36 was run under 19 mutants (`/tmp/ref003/run36.sh`).
- Scratch copies, used for the stub/clippy check of test 36, have been deleted.

## Verdict
REJECTED

## Prior findings status (round 6)
| # | Sev | Status |
|---|---|---|
| F1 forced decision without a route is never exercised (`forced_fail_enters`, `forced_fail_nostrand`, `forced_no_retry_tick`, `forced_no_reset`, `forced_strand_panic`) | MAJOR | **Resolved.** Test 35 kills all five, and the contract sentence is added as recommended. Test 35 also kills the new `forced_retry_plus1`, plus `enter_closed`, `no_forced`, `forced_no_count`, `forced_on_stranded`, `stranded_moves`, `stranded_pop`, `strand_truncate`, `retry_offbyone`, `entry_no_retry_tick` and `removal_exit`. |
| F2 `forced_skip_reset`, `close_restrand` | MINOR | Open, accepted. `forced_skip_reset` is in fact **equivalent**: every successful reroute resets the count, so a non-stranded vehicle always has count 0 when a forced decision strands it. |
| N2 `close_to_periodic`, `periodic_drop_rest`, `close_incl_current`, `hyst_ignore_closed` | MINOR | Open, accepted. **`prio_lifo` is now killed** (by 35). |
| N3 `noroute_blocks`, `noroute_requeue` | MINOR | Open, accepted. |
| M10 `hash_no_closed`, `hash_no_queues`, `hash_no_sv` | MINOR | Open, accepted. **`close_desc` is now killed** (by 35). |
| M4 `final_costs`, `noroute_costs`, `forced_budget`, `periodic_dup_prio`, `periodic_nodedup`, `periodic_stranded`, `slot_only` | MINOR | Open, accepted. |
| `reset_entry_only`, `reset_success_only`, `retry_every_tick`, `hyst_priority` | — | Correct alternatives or equivalents; all pass 79/79, as they must. |

**Test-35 validity:**
- It passes on the reference and on all correct alternatives.
- `prio_lifo` and `close_desc` now fail it. Both violate the contract: the closure enqueues in "ascending slot order", and the queue keeps its order ("order kept"). These are legitimate kills, not a BLOCKER.
- The premise (forced at tick 33, before the priority turn at 40) uses the same derivation as test 17.
- The contract sentence matches what test 35 asserts.
- **No BLOCKER.**

## Findings

### F1. MAJOR (test gap): the **origin of a forced reroute** is never checked; a forced decision that routes from the current link's `from` node passes all 79 tests
- **Where:**
  - Contract, Forced decision: "is rerouted on the spot **from the link's `to` node**".
  - Contract, Valid decision point: "an on-link vehicle reroutes from its current link's `to` node and keeps `route[..=route_pos]` (the current link is never replaced)".
- **Evidence:** `MUT=forced_from_from` passes **79/79**. It is the forced-path twin of `retry_replace` (killed by 7, 13, 22) and `replace_current` (killed by 11 tests): only `Why::Forced` reroutes from `link(current).from` with replace semantics.
- **Why it survives:** the only scenarios with a forced decision (tests 17 and 35) use `backlog_net`. There the current link is `zj`, whose `from` is a **zone with a single out-link**, so a route from `z` and a route from `j` give the same vector. Test 35 never finds a route at all. The origin of the forced reroute is therefore untested.
- **Measured consequence** (proposed test 36 scenario: `x` is a junction with a direct `x→d`, and A = `j→d` is closed while the vehicle is on `x→j`):
  - The router from `x` returns `[x→d]`.
  - The new route becomes `[o→x, x→d]` with `route_pos = 1`, while the vehicle is physically on `x→j`. The route vector is topologically invalid.
  - The reference **panics** (route index out of bounds, `world.rs:1270`) in the forced decision at tick 60.
  - A variant that keeps `route[..=route_pos]` would instead teleport the vehicle from `j` onto `x→d`, a link that does not leave `j`.
  - With the correct implementation, the vehicle is forced at tick 60, crosses onto B1 in the same evaluation, and completes via B2.
- **Severity:** MAJOR.
  - This is a plausible slip inside core-003's own forced-decision code, for example reusing a "reroute current position" helper or `link.from`.
  - It has user-visible consequences: a crash, or a vehicle on a non-adjacent link.
  - No test catches it.
- **Fix:** append `/tmp/ref003/fixes7_tail.rs` (test 36, `forced_decision_reroutes_from_the_stop_line_node`).
  - **Verified:**
    - It passes on the reference: full suite 20 / 24 / 36 green.
    - It fails on the stubs (`not yet implemented`; 0/36).
    - `cargo clippy -p sim-core --all-targets -D warnings` on the stubs plus test 36 is clean.
  - **Kills:** `forced_from_from`, `replace_current`, `rewrite_past`, `forced_wait`, `no_forced`, `enter_closed`, `forced_no_count`, `prio_lifo`, `close_desc`.
  - **Passes (as it must) on:** `reset_entry_only`, `reset_success_only`, `retry_every_tick`, `hyst_priority`. It also passes on the MINOR mutants `retry_replace` (not on this path), `forced_fail_switch`, `forced_needs_credit`, `forced_fail_rr` and `forced_budget`.
  - **Scenario:**
    - 3000 backlog vehicles `[yj, A]` (slots 0..2999), then one vehicle `[o→x, x→j, A]` (slot 3000).
    - A closes at `ct` = (first tick the vehicle is on `x→j`) + 13 = **47**, so its priority turn is 62.
    - It reaches the stop line at `j` at tick **60**. The premise asserts that `shortest_route(x, d) = [x→d]` and `shortest_route(j, d) = [B1, B2]` after the closure.

### F2. MINOR (test gap): `forced_fail_switch` survives
- A failed forced decision counts a route switch (`switches_total` and `route_switches` +1) although the route vector is unchanged.
- This is bookkeeping only, so it is MINOR.
- **Optional one-line kill, verified:** add `assert_eq!(i.route_switches, 0, "a failed forced decision is not a switch");` inside test 35's loop, after the `route` assert. It passes on the reference and fails on `forced_fail_switch`.

### F3. MINOR: `forced_needs_credit` and `forced_fail_rr` survive
- **`forced_needs_credit`:** the forced decision is taken only once the lane has credit ≥ 1. The vehicle cannot cross before that tick anyway, so the success path is equivalent. The failure path strands it at most a few ticks later, and it waits at the stop line either way. The effect is timing within the 4-tick headway; MINOR.
- **`forced_fail_rr`:** a failed forced decision advances the junction round-robin pointer. This only reorders competing lanes at one node for one tick; MINOR.

## Reference results (`/tmp/ref003`, contract at cbd18ba)
- core-001 20/20, core-002 24/24, core-003 35/35; with the proposed test 36, 36/36.
- Tests 1–35 have the same key values as round 6:

| # | Key values |
|---|---|
| 1 | central 727 / 876 |
| 2 | 13 |
| 4 | dc 635 / db 112; rs (3094, 0, 0, 71, 71) |
| 5 | 87 switches |
| 6 | tracked 654, 80 stranded, removed 417 |
| 7 | 241; marks [212, 212, 282, 813] |
| 8 | rs (3382, 0, 0, 3000, 200) |
| 9 | 0 switches; [1038, 754] |
| 11 | 5061 / 72 |
| 13 | completed 1050, removed 1310, no_route 201 |
| 17 | z0 on B1 at tick 33, forced 2 |
| 18 | no_route 50 |
| 19 | 11 removed |
| 22 | 346 @ 1830 |
| 24 | n = 11 |
| 25 | 204 / 258 |
| 26 | 3000 − 200·(t − 9) |
| 27 | 20 / 21 |
| 28 | r0 = [56, 4, 6, 50, 28, 30, 63]; r1 = [56, 4, 6, 21, 48, 36, 28, 30, 63] |
| 29 | 0 / 21 |
| 30 | 11 → 22, budgeted 12 |
| 31 | returns at (t + trip_id) % 240 == 0; `route_switches` 2 |
| 32 | `switches_total` 3 |
| 33 | `no_route_retries` 1 at ct+60, 0 at ct+120 and S, k at S+60k; 6 removals exactly after step S+600 |
| 34 | at ct: 2 stranded / 14 NoRoute; at S: 8 / 8, count 0, k at S+60k; 16 removals exactly after S+600 |
| 35 | `forced_total` 0 through 32, then 1 from tick **33** on; z0 stranded `OnLink(zj)`, route `[zj, A]`, `no_route_retries = (t−33)/60`, `route_switches` 0; A, B1 and B2 empty; removed exactly after step **633**; `link_exit_count(zj)` unchanged |

- **Runtime:**
  - full `cargo test -p sim-core --tests`: 6–9 s wall, with core-003 4.95 s; test 36 adds about 0.01 s;
  - stubs fail in 0.09–0.10 s;
  - one mutant pass over 79 tests takes about 15–20 s, so the 45-mutant sweep took about 13 min.

## Mutation table (79 tests; round-7 runs, test numbers as in the ward)

| Mutant | Killed by |
|---|---|
| forced_fail_enters / forced_fail_nostrand / forced_no_retry_tick / forced_no_reset / forced_strand_panic (r6 F1) | **35** |
| **new** forced_retry_plus1 | 35 |
| enter_closed / no_forced / forced_no_count | 17, 35 |
| forced_wait | 17 |
| forced_on_stranded | 24, 35 |
| stranded_moves | 6, 16, 19, 24, 30, 32, 33, 34, 35 |
| stranded_pop | 6, 19, 33, 34, 35 |
| strand_truncate | 32, 35 |
| retry_offbyone | 6, 33, 34, 35 |
| entry_no_retry_tick | 6, 7, 16, 19, 24, 30, 32, 33, 34, 35 |
| removal_exit | 19, 35 |
| prio_lifo (was MINOR N2) | **35** |
| close_desc (was MINOR M10) | **35** |
| **new forced_from_from** | **none; MAJOR F1**; killed by proposed 36 |
| **new** forced_fail_switch | none (MINOR F2); killed by the optional line in 35 |
| **new** forced_needs_credit / forced_fail_rr | none (MINOR F3) |
| forced_skip_reset | none (equivalent) |
| close_restrand | none (MINOR, r6 F2) |
| close_to_periodic / periodic_drop_rest / close_incl_current / hyst_ignore_closed | none (MINOR N2) |
| noroute_blocks / noroute_requeue | none (MINOR N3) |
| final_costs / noroute_costs / forced_budget / periodic_dup_prio / periodic_nodedup / periodic_stranded / slot_only | none (MINOR M4) |
| hash_no_closed / hash_no_queues / hash_no_sv | none (MINOR M10) |
| reset_entry_only / reset_success_only / retry_every_tick / hyst_priority | none (**correct alternatives / equivalents**; must pass) |

All other round-6 mutants were killed in round 6 and remain killed: none of the test files changed except by appending.

**Test 36 under mutants:**
- **Killed:** `forced_from_from` (panic), `replace_current`, `rewrite_past`, `forced_wait` (crosses at 61 instead of 60), `no_forced` and `forced_no_count` (forced_at None), `enter_closed`, `prio_lifo` and `close_desc` (forced_at 48).
- **Passes:** reference, `reset_entry_only`, `reset_success_only`, `retry_every_tick`, `hyst_priority`, `retry_replace`, `forced_fail_switch`, `forced_needs_credit`, `forced_fail_rr`, `forced_budget`.

## Notes for Gold reviewer
- **To get APPROVED:**
  - append `/tmp/ref003/fixes7_tail.rs` (test 36) verbatim. It uses `NetworkBuilder`, `World`, `VehicleState`, `close`, `step_checked`, `World::shortest_route`, `completed_log` and `link_exit_count`, all already used or exported;
  - add ward row 36: `forced_decision_reroutes_from_the_stop_line_node` — "a forced decision reroutes from the current link's `to` node (never from a node already passed), keeps the driven links, crosses onto the new next link in the same evaluation and completes the trip";
  - update the counts to 36 tests / 80 total.
  - Optional (MINOR F2): add `assert_eq!(i.route_switches, 0, …)` in test 35's loop.
- **Implementation note:**
  - The forced decision must use exactly the valid-decision-point rule: from `link(current).to`, with new route = `route[..=route_pos] ++ path`.
  - On failure, strand through the same path as the priority/periodic failure: count 0, `next_retry_tick = tick + 60`, no crossing, no switch.
- **Expected exact values:**
  - Tests 1–35: as in the reference table above.
  - Test 36:
    - `ct` = **47**;
    - `shortest_route(x, d)` = `[x→d]` and `shortest_route(j, d)` = `[B1, B2]` at tick 48;
    - `forced_total` becomes 1 at tick **60**;
    - the vehicle is on B1 after step **60**;
    - after step 61: `state = OnLink(B1)`, `route = [o→x, x→j, B1, B2]`, `route_pos = 2`, `route_switches = 1`, `forced_total = 1`;
    - `x→d` stays empty throughout (0 exits), and the trip completes with B2 exits ≥ 1.
