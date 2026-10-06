# Review: core-003 — Red gate (round 6)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.

**Inputs read**
- `.wdd/epics/core.md` and `.wdd/wards/core/ward-003.md`
- `crates/sim-core/tests/core_003_closures.rs` (34 tests) and the stubs
- `.wdd/reviews/core-003-red-5.md`
- `git diff f46359c HEAD` (1a84953)

**What changed since round 5**
- Test 34 `noroute_retry_count_restarts_and_ignores_unrelated_commands` is appended. It is identical to `/tmp/ref003/fixes5_tail.rs` apart from one blank line.
- Contract, No route: "(NoRoute at the origin and stranded alike)" is added to the per-episode retry clause.
- Ward: rows 32/33 are in order, row 34 is added, and the counts are 34 / 78.

**Method**
- **Red check** (worktree, HEAD 1a84953):
  - core-001 passes 20/20 and core-002 passes 24/24.
  - core-003 passes 0/34; the stubs fail in 0.09 s.
  - `cargo clippy -p sim-core --all-targets -- -D warnings` is clean.
- **Reference** (`/tmp/ref003`):
  - Tests are synced to HEAD.
  - `world.rs` changed only by new `MUT=` toggles. The pre-edit copy is `world_r6_pre.rs.bak`.
  - New toggles: `schedule_le`, `unreach_no_removed`, `waiting_incl_noroute`, `forced_no_reset`, `entry_no_retry_tick`, `retry_replace`, `close_resets_retries`, `close_restrand`, `forced_strand_panic`, `forced_skip_reset`, `forced_no_retry_tick`, `forced_fail_nostrand`, `forced_fail_enters`.
- **Mutants:**
  - 83 runs (`mutlist_r6.txt`), each over all 78 tests with `--no-fail-fast`. Results are in `/tmp/ref003/mut_r6.txt`.
  - Further forced-path toggles were run against the proposed test 35 (`/tmp/ref003/run35.sh`).
- **Probe:** a one-off example, since deleted. It ran the test-35 scenario on the reference and on the forced-failure mutants and recorded the values quoted below.

## Verdict
REJECTED

## Prior findings status (round 5)
| # | Sev | Status |
|---|---|---|
| R1 `noroute_not_reset` | MAJOR | **Resolved.** Test 34 kills it. The contract wording is now explicit. |
| R2 `open_resets_retries` | MINOR | **Resolved.** Test 34 kills it, and also the new `close_resets_retries`. |
| R3 ward table order | MINOR | **Resolved.** |
| N2 `close_to_periodic`, `prio_lifo`, `periodic_drop_rest`, `close_incl_current`, `hyst_ignore_closed` | MINOR | Open, accepted. |
| N3 `noroute_blocks`, `noroute_requeue` | MINOR | Open, accepted. |
| M10 `hash_no_closed`, `hash_no_queues`, `hash_no_sv`, `close_desc` | MINOR | Open, accepted. |
| M4 `final_costs`, `noroute_costs`, `forced_budget`, `periodic_dup_prio`, `periodic_nodedup`, `periodic_stranded`, `slot_only` | MINOR | Open, accepted. |
| `retry_every_tick`, `hyst_priority`, `reset_entry_only`, `reset_success_only` | — | Equivalent or correct alternatives; all pass, as they must. |

**Test-34 validity:** it passes on the reference, on both correct alternatives (`reset_entry_only`, `reset_success_only`) and on `retry_every_tick`. Its premises come from core-001 physics and the contract's retry schedule. No BLOCKER.

## Findings

### F1. MAJOR: a forced decision that finds **no route** is never exercised; a vehicle can drive onto a closed link and no test notices
- **Where:**
  - Contract, Forced decision (step 4): "a non-stranded lane front that reaches the stop line … whose next link is closed is rerouted on the spot … If a route is found, the normal crossing rules then apply …"
  - Contract, No route: "An on-link vehicle without a route becomes stranded … `next_retry_tick = tick + NO_ROUTE_RETRY_TICKS` … removed at tick `T + 600` exactly."
  - Contract, Closures: a closed link admits no new vehicles.
- **Evidence:** `MUT=forced_strand_panic` panics as soon as a forced reroute fails. It passes **all 78 tests**, so no test ever reaches this path. Test 17 covers only the success path, because B1/B2 stay open.
- **Surviving mutants (all pass 78/78), measured on the test-35 scenario:**

  | Mutant | What goes wrong |
  |---|---|
  | `forced_fail_enters` | After a failed forced reroute the vehicle crosses anyway. This is the natural bug when an implementation calls `try_reroute`, re-reads `route[pos+1]` and crosses without re-checking `closed`. **Two z vehicles drive onto closed A (the first at tick 33, the second by tick 40)** (`link_count(A)` = 2), and `removed_unreachable` ends at 3008 instead of 3010. |
  | `forced_fail_nostrand` | A failed forced decision leaves the vehicle unstranded. It repeats the forced Dijkstra every tick: `forced_total` is 7 instead of 1, and `stranded` is undercounted from tick 33 to 39. Its episode starts at 40 instead of 33, so it is removed at 640 instead of 633. |
  | `forced_no_retry_tick` | Entering stranded through the forced path does not schedule the retry. A stale `next_retry_tick` leaves the vehicle off-schedule: in the reference it retries at 60, 120, … and is removed at 600 instead of 633. With a zero-initialised field and `==` it would never be retried or removed. |
  | `forced_no_reset` | The count carries into a forced stranding (here 7): the vehicle is removed after 3 retries, at 213 instead of 633. |

- **Severity:** MAJOR. Each mutant is a plausible slip in core-003's own forced-decision code, with measured user-visible effects:
  - vehicles on a closed link;
  - wrong `stranded` / `forced_total` / `removed_unreachable`;
  - wrong removal ticks.
- **Fix:** append `/tmp/ref003/fixes6_tail.rs` (test 35, `forced_decision_without_route_strands_at_the_stop_line`).
  - Verified on the reference: it passes, and the full suite on the reference is 20 / 24 / 35 green.
  - Clippy is clean on the test targets.
  - It passes on all correct alternatives: `reset_entry_only`, `reset_success_only`, `retry_every_tick`, `hyst_priority`. It also passes on `forced_wait`, which never reaches the success branch here.
  - It kills `forced_fail_enters`, `forced_fail_nostrand`, `forced_no_retry_tick`, `forced_no_reset`, `forced_strand_panic`, `enter_closed`, `no_forced`, `forced_no_count`, `forced_on_stranded`, `stranded_moves`, `stranded_pop`, `strand_truncate`, `retry_offbyone`, `entry_no_retry_tick` and `removal_exit`.
  - The scenario is test 17's network and backlog with B1 closed as well at tick 25, so no route leads from j to d. The z front reaches the stop line at **tick 33**, before its priority turn (40), which is the same derivation as test 17's tick 33.
- **Recommended contract clarification (optional, no behavior change):** in Forced decision, add "If none is found, the vehicle becomes stranded at that tick (`T` = this tick) and does not cross; it is not forced again while stranded."

### F2. MINOR: `forced_skip_reset` and `close_restrand` survive (also with test 35)
- **`forced_skip_reset`:** only the forced path skips the per-episode reset. It matters only when a vehicle has a non-zero count from an earlier episode, has resumed, and is then forced-stranded; this is a second-order combination.
- **`close_restrand`:** closing a link that lies on a stranded vehicle's *kept* route restarts its schedule. The only effect is a later removal. It is implausible unless the priority pass processes stranded vehicles, and that case is `stranded_pop`, which is killed.
- Both are accepted as MINOR.

### F3. MINOR: new mutants killed (for the record)
- `schedule_le` (rejects commands for the current tick)
- `unreach_no_removed`
- `waiting_incl_noroute`
- `entry_no_retry_tick`
- `retry_replace` (a retry reroutes from the current link's `from`)
- `close_resets_retries`

All of these are killed by the current 78 tests.

## Reference results (`/tmp/ref003`, contract at 1a84953)
- core-001 20/20, core-002 24/24, core-003 34/34; with the proposed test 35, 35/35.
- Tests 1–33 have the same key values as in rounds 4/5:

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
| 17 | tick 33, forced 2 |
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

- **Test 34:**
  - At `ct`: 2 stranded, 14 NoRoute.
  - At `S`: all 16 are stranded or NoRoute (8 / 8) with count 0, and k at `S+60k`.
  - 16 removals, exactly after step `S+600`.
- **Test 35 (proposed):**
  - `forced_total` is 0 through tick 32 and becomes 1 at tick **33**, then stays exactly 1.
  - From 33, z0 is `stranded`, `OnLink(zj)`, route `[zj, A]`, and `no_route_retries = (t − 33) / 60`.
  - A, B1 and B2 carry 0 vehicles throughout.
  - z0 is removed exactly after step **633**, and `link_exit_count(zj)` is unchanged.
  - For context: `stranded` is 8 at 33 and 16 from 40; `no_route` is 2994; `removed_unreachable` reaches 3010 at 640.
- **Runtime:**
  - full `cargo test -p sim-core --tests` takes 6–11 s wall, with core-003 5.0–5.6 s; test 35 adds about 0.05 s;
  - stubs fail in 0.09 s;
  - one mutant pass over 78 tests takes about 15–25 s, so the 83-mutant table takes about 25 min.

## Mutation table (78 tests; test numbers as in the ward)

| Mutant | Killed by |
|---|---|
| admit_closed | 18 |
| enter_closed / no_forced / forced_no_count / forced_wait | 17 (+35 except forced_wait) |
| close_no_waiting | 8, 17, 18, 26, 32, 34 |
| no_budget / prio_drop_rest | 8, 17, 26 / 8, 18, 26 |
| no_inval_close | 8, 17, 26, 31, 33, 34 |
| no_inval_open / cmd_after_demand | 22 |
| cmd_late | 16, 18, 19, 22, 24, 26, 30, 32, 33, 34 |
| cmd_reorder | 23 |
| cmd_closes_last | 10 |
| periodic_first | 26 |
| hash_degenerate | 20 |
| hash_no_cmds / hash_no_rng | 15 |
| nondet; nondet,hash_degenerate | 10, 11, 14, 15, 21, core-001 ×2 / 10, 20, 21, core-001 ×2 |
| hyst_ratio_only / hyst_gain_only | 29 |
| hyst_incl_current / no_hysteresis | 9, 29 |
| no_periodic_switch | 25, 27, 31 |
| periodic_waiting_only | 27, 29, 31 |
| periodic_onlink_only | 25 |
| open_enqueue_all / no_stagger / due_minus | 31 |
| open_unstrands | 24, 30, 34 |
| forced_on_stranded | 24 (+35) |
| removal_completes | 6, core-002 ×2 |
| removal_exit | 19 (+35) |
| replace_current / rewrite_past | 2, 3, 4, 5, 7, 10, 12, 13, 22, 27, 31 |
| retries_fail_only / retry_budgeted | 30 |
| retry_offbyone | 6, 33, 34 (+35) |
| sr_no_closed | 28 |
| strand_removes | 6, 13, 16, 19, 22, 7, 30, 32, 33, 34 |
| stranded_as_noroute | 6, 13, 16, 19, 32, 33, 34 |
| stranded_moves | 6, 16, 19, 24, 30, 32, 33, 34 (+35) |
| stranded_pop | 6, 19, 33, 34 (+35) |
| noroute_keep_route / strand_truncate / switch_count_all / switch_no_retry / noroute_counts | 32 (strand_truncate +35) |
| retries_not_reset / reset_if_changed | 33, 34 |
| noroute_not_reset (r5 R1) | **34** |
| open_resets_retries (r5 R2) | **34** |
| **new** schedule_le | 15, 16, 18, 19, 24, 28, 30, 32, 33, 34 |
| **new** unreach_no_removed | 6, 13, core-002 ×2 |
| **new** waiting_incl_noroute | 6, 7, 13, 18, 22, 32, 34, core-002 ×2 |
| **new** entry_no_retry_tick | 6, 7, 16, 19, 24, 30, 32, 33, 34 (+35) |
| **new** retry_replace | 7, 13, 22 |
| **new** close_resets_retries | 34 |
| **new forced_fail_enters** | **none; MAJOR F1**; killed by proposed 35 |
| **new forced_fail_nostrand** | **none; MAJOR F1**; killed by proposed 35 |
| **new forced_no_retry_tick** | **none; MAJOR F1**; killed by proposed 35 |
| **new forced_no_reset** | **none; MAJOR F1**; killed by proposed 35 |
| new forced_strand_panic (path probe) | none, so the path is unexercised; killed by proposed 35 |
| new forced_skip_reset / close_restrand | none (MINOR F2), also with 35 |
| reset_entry_only / reset_success_only | none, **correct alternatives** (must pass) |
| close_to_periodic / prio_lifo / periodic_drop_rest / close_incl_current / hyst_ignore_closed | none (MINOR N2) |
| noroute_blocks / noroute_requeue | none (MINOR N3) |
| final_costs / noroute_costs / forced_budget / periodic_dup_prio / periodic_nodedup / periodic_stranded / slot_only | none (MINOR M4) |
| hash_no_closed / hash_no_queues / hash_no_sv / close_desc | none (MINOR M10) |
| retry_every_tick / hyst_priority | none (equivalent) |

## Notes for Gold reviewer
- **To get APPROVED:**
  - append `/tmp/ref003/fixes6_tail.rs` (test 35) verbatim. It uses `backlog_net`, `close`, `step_checked`, `VehicleState`, `NO_ROUTE_RETRY_TICKS` and `NO_ROUTE_MAX_RETRIES`, all already in the file;
  - add ward row 35: `forced_decision_without_route_strands_at_the_stop_line` — "a forced decision that finds no route strands the front at once (forced once, never crosses into a closed link), keeps its route, retries from that tick and is removed exactly 600 ticks later; not an exit";
  - update the counts (35 tests / 79 total).
  - Optional: the contract sentence under F1.
- **Implementation note:**
  - On a failed forced reroute, mark the vehicle stranded through the same code path as the priority/periodic failure: reset the count and set `next_retry_tick = tick + 60`.
  - Return without crossing, and re-check `closed` before any crossing.
- **Expected exact values:**
  - Tests 1–34: as in the reference table above.
  - Test 35:
    - forced at tick 33, and `forced_total` stays 1;
    - z0 retries `(t−33)/60`;
    - z0 is removed exactly after step 633;
    - A, B1 and B2 stay empty;
    - `link_exit_count(zj)` is unchanged.
