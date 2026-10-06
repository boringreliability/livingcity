# Review: core-003 — Red gate (round 5)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.

**Inputs read**
- `.wdd/epics/core.md` and `.wdd/wards/core/ward-003.md`
- `crates/sim-core/tests/core_003_closures.rs` (33 tests) and the stubs
- `.wdd/reviews/core-003-red-4.md`
- `git diff 70e7656 HEAD` (f46359c)

**What changed since round 4**
- Test 33 is appended. It is identical to `/tmp/ref003/fixes4_tail.rs` apart from one extra blank line.
- Contract, No route: `no_route_retries` counts the failed retries of the **current** episode. It is 0 on entering NoRoute/stranded and reset by a successful retry.
- The stub doc on `VehicleInfo::no_route_retries` is updated to match.
- The ward table and counts are updated (33 tests / 77 total).

**Method**
- **Red check** (snapshot `/tmp/stub003r4`, synced to HEAD):
  - core-001 20/20 and core-002 24/24 pass.
  - core-003 fails 0/33, and also 0/34 with the proposed test 34.
  - `cargo clippy -p sim-core --all-targets -- -D warnings` is clean (rc 0), also with test 34 appended.
- **Reference** (`/tmp/ref003`):
  - I checked it against the current contract. Since the round-4 base (`world_r4_base.rs.bak`) its `world.rs` differs only by `MUT=` toggles.
  - It resets `no_route_retries` both on entering NoRoute/stranded and on a successful retry, which matches the new wording.
  - Its tests are synced to HEAD.
  - I added 5 new toggles; the pre-edit copy is in `world_r5_pre.rs.bak`.
- **Mutants.** 75 runs (`mutlist_r5.txt`), each over all 77 tests with `--no-fail-fast`. Results are in `/tmp/ref003/mut_r5.txt`.
- **Consequence probes:**
  - `examples/probe_r5.rs`: three_bridges(17, 23) with repeated closures of all six bridge links, removals split by NoRoute vs stranded, plus off-schedule removals.
  - `examples/probe33.rs`: test-33 premises.
  - `examples/probe34.rs`: test-34 scenario.

## Verdict
REJECTED

## Prior findings status (round 4)
| # | Sev | Status |
|---|---|---|
| N1 `retries_not_reset` | MAJOR | **Resolved for stranded vehicles.** Test 33 kills it and also the new `reset_if_changed`. The contract wording and stub doc are fixed. The **NoRoute half** of the same clause is still unpinned; see R1 below. |
| N2 `close_to_periodic`, `prio_lifo`, `periodic_drop_rest`, `close_incl_current`, `hyst_ignore_closed` | MINOR | **Open, accepted.** All still survive. |
| N3 `noroute_blocks`, `noroute_requeue` (inherited core-002 admission) | MINOR | **Open, accepted.** Both still survive. |
| M10 `hash_no_closed`, `hash_no_queues`, `hash_no_sv`, `close_desc` | MINOR | **Open, accepted.** |
| M4 `final_costs`, `noroute_costs`, `forced_budget`, `periodic_dup_prio`, `periodic_nodedup`, `periodic_stranded`, `slot_only` | MINOR | **Open, accepted.** |
| `retry_every_tick`, `hyst_priority` | — | Equivalent. |

**Test-33 premises check (`probe33`).**
- At `ct + 150` the lead vehicle is at s = 1095 m of the 1500 m L1, so nobody can reach L2 in the open window `ct+120 … ct+150`. Positions come from core-001 physics, so the premise holds for every correct implementation.
- All 6 vehicles are stranded at `ct` and at `S`.
- Test 33 is valid: no BLOCKER.

## Findings

### R1. MAJOR: the per-episode retry count is pinned only for **stranded** vehicles, not for **NoRoute at the origin** (`noroute_not_reset`)
- **Where:** contract, No route: "`no_route_retries` counts the failed retries of the **current** episode: it is 0 on entering NoRoute/stranded and reset by a successful retry, so every new stranding gets the full schedule … removed at tick `T + 600` exactly." This applies to both states.
- **Mutant `noroute_not_reset`:**
  - Both resets (on entry and on success) are skipped for vehicles at the origin.
  - The stranded path is correct, so test 33 passes.
  - It **passes all 77 tests.**
- **Why it is plausible:**
  - NoRoute is a `VehicleState`, while stranded is a flag on an on-link vehicle.
  - The two states are entered in different code paths: spawn (step 2), and reroutes of waiting vehicles vs. on-link vehicles. Success also restores them differently (`state = WaitingAtOrigin` vs `stranded = false` plus a route splice).
  - Test 33, the only test that drives the reset, exercises only on-link vehicles. An implementer who goes green on test 33 can place the reset in the stranded branch only.
  - Every existing NoRoute removal test (6, 13, 18, 19) uses vehicles that are NoRoute only once, from spawn, where the count is 0 by construction.
- **Consequence, measured on the reference** (three_bridges(17, 23); all 6 bridge links closed, reopened, closed again, reopened; the second closure is shorter than 600 ticks):

| schedule (close c / open o, ticks) | correct: completed / removed | `noroute_not_reset`: completed / removed | trips wrongly lost |
|---|---|---|---|
| 1200c, 1680o, 1700c, 2250o | 1435 / 104 | 1430 / 109 | 5 |
| 1200c, 1700o, 1720c, 2280o | 1356 / 183 | 1341 / 198 | **15** |
| 1200c, 1740o, 1745c, 2300o | 1389 / 150 | 1383 / 156 | 6 |
| 1200c, 1600o, 1610c, 2150o | 1374 / 165 | 1372 / 167 | 2 |
| 1200c, 1440o, 1500c, 2100o | 1539 / 0 | 1538 / 1 | 1 |

  - The wrongly lost trips are NoRoute vehicles that wait at their origin and would have been served after the reopening. They vanish as `removed_unreachable` before `T + 600` instead.
  - This is the same failure class and size as round-4 N1 (12 trips in its scenario), which was rated MAJOR.
  - In this city NoRoute removals outnumber stranded removals (for example 103 vs 80), so the uncovered half is the larger one.
- **Fix (verified): proposed test 34, `noroute_retry_count_restarts_and_ignores_unrelated_commands`** in `/tmp/ref003/fixes5_tail.rs`. It is the test-33 corridor plus a spur link `j → e`, with 16 vehicles and a 10-tick warm-up:
  - **First episode:** at `ct`, 2 vehicles are stranded on zj and 14 are NoRoute. Each has failed 1 retry at `ct+60`, and all resume at `ct+120` (after the reopen at `ct+90`).
  - **Second episode:** `S = ct+150`. 8 vehicles are stranded (2 on L1, 6 on zj) and 8 are NoRoute (premise ≥ 4). All have `no_route_retries == 0`.
  - **Unrelated commands:** the spur is closed at `S+100` and reopened at `S+200`.
  - **Schedule:** every vehicle has `k` failed retries after step `S+60k` (k = 1…9). `removed_unreachable` stays 0 until step `S+600`, then goes to 16 with all vehicles gone.
- **Verification of test 34:**
  - It passes on the reference: 34/34, core-003 in 5.8 s.
  - It fails on the stubs and is clippy-clean.
  - It kills `noroute_not_reset` (line `retries == 0` at S), `open_resets_retries`, `retries_not_reset`, `reset_if_changed`, `open_unstrands` and `retry_offbyone`.
  - It accepts both correct alternatives, `reset_entry_only` and `reset_success_only`.

### R2. MINOR, closed by test 34: a reopening restarts the count (`open_resets_retries`)
- **Mutant:** `OpenLink` resets `no_route_retries` of every NoRoute/stranded vehicle, as in "a reopening gives everyone a fresh chance".
- It survives all 77 tests.
- **Consequence:** pattern B (bridges closed for good at 1200; an unrelated link closed at 1300 and opened at 1500) delays **152** removals by 240 ticks. No extra trips are lost, but unreachable vehicles and stranded lane blockers linger about 2 minutes. This contradicts "removed at `T + 600` exactly".
- **Why MINOR:** it is a deliberate design deviation rather than a slip, and no trips are lost. Test 34's spur close/open pins it anyway.

### R3. MINOR: ward table order
- In the ward-003 tests table, row 33 sits between rows 31 and 32. This is cosmetic.

### Equivalent or correct variants checked
- `reset_entry_only` (reset only on entering) and `reset_success_only` (reset only on a successful retry) are both correct implementations: an episode can only start after a successful retry or a spawn. They pass all 77 tests, and test 34, so the tests do not over-specify where the reset happens.

## Reference results (`/tmp/ref003`, contract at f46359c)
- core-001 20/20, core-002 24/24, core-003 33/33; with proposed test 34, 34/34.
- Tests 1–32 and the reference semantics are unchanged since round 4, so the round-4 key values still hold:

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

- **Test 33:**
  - The lead vehicle is at s = 52 m on L1 at `ct` and s = 1095 m at `ct+150`.
  - `no_route_retries` is 1 at `ct+60`, 0 at `ct+120` and `S`, and k at `S+60k`.
  - `removed_unreachable` goes 0 → 6 exactly after step `S+600`.
- **Test 34 (proposed):** as described under R1.
- **Runtime:**
  - full `cargo test -p sim-core --tests` takes 7–10 s wall, with core-003 5.6 s (33 tests) or 5.8 s (34);
  - stubs fail in 0.09 s;
  - one mutant pass over 77 tests takes about 15–25 s, so the full table of 75 runs takes about 25 min.

## Mutation table (77 tests; test numbers as in the ward)

| Mutant | Killed by |
|---|---|
| admit_closed | 18 |
| enter_closed / no_forced / forced_no_count / forced_wait | 17 |
| close_no_waiting | 8, 17, 18, 26, 32 |
| no_budget / prio_drop_rest | 8, 18, 26 (and 17) |
| no_inval_close | 8, 17, 26, 31, 33 |
| no_inval_open / cmd_after_demand | 22 |
| cmd_late | 16, 18, 19, 22, 24, 26, 30, 32, 33 |
| cmd_reorder | 23 |
| cmd_closes_last | 10 |
| periodic_first | 26 |
| hash_degenerate | 20 |
| hash_no_cmds / hash_no_rng | 15 |
| nondet | 10, 11, 14, 15, 21, core-001 ×2 |
| nondet,hash_degenerate | 10, 20, 21, core-001 ×2 |
| hyst_ratio_only / hyst_gain_only | 29 |
| hyst_incl_current / no_hysteresis | 9, 29 |
| no_periodic_switch | 25, 27, 31 |
| periodic_waiting_only | 27, 29, 31 |
| periodic_onlink_only | 25 |
| open_enqueue_all / no_stagger / due_minus | 31 |
| open_unstrands | 24, 30 (+34) |
| forced_on_stranded | 24 |
| removal_completes | 6, core-002 ×2 |
| removal_exit | 19 |
| replace_current / rewrite_past | 2, 3, 4, 5, 7, 10, 12, 13, 22, 27, 31 |
| retries_fail_only / retry_budgeted | 30 |
| retry_offbyone | 6, 33 (+34) |
| sr_no_closed | 28 |
| strand_removes | 6, 7, 13, 16, 19, 22, 30, 32, 33 |
| stranded_as_noroute | 6, 13, 16, 19, 32 |
| stranded_moves | 6, 16, 19, 24, 30, 32, 33 |
| stranded_pop | 6, 19, 33 |
| noroute_keep_route / strand_truncate / switch_count_all / switch_no_retry / noroute_counts | 32 |
| **retries_not_reset** | **33** (N1 resolved), +34 |
| **reset_if_changed (new)**: success resets only if the route changed; no reset on entry | **33**, +34 |
| **noroute_not_reset (new)** | **none; MAJOR R1**; killed by proposed 34 |
| **open_resets_retries (new)** | **none; MINOR R2**; killed by proposed 34 |
| reset_entry_only / reset_success_only (new) | none, **correct alternatives** (must pass) |
| close_to_periodic / prio_lifo / periodic_drop_rest / close_incl_current / hyst_ignore_closed | none (MINOR N2) |
| noroute_blocks / noroute_requeue | none (MINOR N3) |
| final_costs / noroute_costs / forced_budget / periodic_dup_prio / periodic_nodedup / periodic_stranded / slot_only | none (MINOR M4) |
| hash_no_closed / hash_no_queues / hash_no_sv / close_desc | none (MINOR M10) |
| retry_every_tick / hyst_priority | none (equivalent) |

## Notes for Gold reviewer
- **To get APPROVED:**
  - append `/tmp/ref003/fixes5_tail.rs` (test 34) verbatim;
  - update the ward table and counts (34 tests / 78 total);
  - optionally reorder the table rows (R3).
  - No contract change is needed: the wording already covers NoRoute. Optionally add "(both NoRoute at the origin and stranded)" to make it explicit.
- **Implementation note:** reset `no_route_retries` in one place shared by both states (on entering NoRoute/stranded and/or on a successful retry). Do **not** touch the counters on `OpenLink`.
- **Expected exact values:**
  - Tests 1–32: as in the reference table above (same as round 4).
  - Test 33: 6 removals exactly after `S+600`.
  - Test 34: at `ct`, 2 stranded and 14 NoRoute. At `S`, 8 stranded (2 on L1, 6 on zj) and 8 NoRoute, all with count 0. k at `S+60k`. 16 removals exactly after `S+600`.
