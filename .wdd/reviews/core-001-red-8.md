# Review: core-001 — Red gate (round 8)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.
Inputs read: `.wdd/epics/core.md` (the Zones paragraph extended in r8), `.wdd/wards/core/ward-001.md`,
`.wdd/memory/decisions/zone-centroids.md` (via r7), `crates/sim-core/tests/core_001_physics.rs` (20 tests),
`crates/sim-core/src/*.rs` (stubs), `.wdd/reviews/core-001-red-7.md`, `git diff 887ceeb 011e57a`.
`cargo test -p sim-core --test core_001_physics`: it compiles, and 0 pass / 20 fail on `todo!()`, which is expected for Red.
The worktree is unchanged except for this file.

Method: I copied the round-7 reference to `/tmp/wddref8/` (outside the repo) and updated it to match the current contract and tests:
- `ref.py`:
  - A separate `next_trip` counter, consumed only by a successful spawn ("Rejected spawns consume no trip id").
  - New mutant toggles: `trip_on_reject`, `trip_on_reject_late` (only origin/zone errors consume an id), `trip_is_slot`, `trip_at_admit` and `zone_sink_credit`.
- `scen.py`:
  - **New T3**, which mirrors the Rust test: the three errors, `spawned`/buffer = 0, `VehicleId(0)`, one step, then `trip_id == 0`.
  - **T20 rewritten to match the test exactly**:
    - Node `e` is created after `d`, and `de` after the `two_way` pair, so the link ids are `sj=0, jd=1, zj=2, jz=3, de=4`.
    - Loop routes are `[zj, jd, de]` and `[sj, jd, de]`.
    - It asserts `fz + fs ≥ 405`, share 0.4–0.6, `link_exit_count(jz) == 1`, and that the **first** `completed_log` entry with `trip_id == 2` has `completed_tick == 67`. This uses `find` semantics, as in Rust.
- `allmuts8.py`: the r7 set plus `zone_skip_discharge`, `zone_no_admit` and the 5 new mutants. 77 mutants in total. Output in `out_muts8.txt`.
- `probe_zone7.py`: re-run, unchanged results. `probe_zsink8.py`: new, a zone-destination throughput probe.

## Verdict
APPROVED

## Prior findings status (round 7)

| # | Round-7 finding | Status | Evidence |
|---|---|---|---|
| 1 | MAJOR: `zone_skip_discharge` not caught (a trip ending at a zone never completes) | **Resolved** | T20 `:1003-1006` asserts `link_exit_count(jz) == 1` and trip 2 `completed_tick == 67`. The mutant gives `jz_exits = 0` with trip 2 absent from the log, so **T20 fails**. The correct reference gives exactly 1 and 67. |
| 2 | MINOR: T20 merge not saturated, so the share check was vacuous | **Resolved** | `de` was added and the routes extended. The correct reference gives total **450** (= 0.5 veh/s × 900 s, the theoretical maximum) ≥ 405, share **0.4978** (224/226). `lowest_first` and `rr_eq_i` now also fail T20 (share 0.000 / 1.000 → total < 405 or share out of range). `zone_no_admit` fails on the saturation assert (total 360). |
| 3 | MINOR: contract precision (error precedence, destinations, dead-end origins, lane-weighted share) | **Resolved** | `core.md:44` now says "Destinations may be any node", "A dead-end node with in-links is not a valid origin (use a zone)", that the share is per connector **lane**, and gives the validation order `EmptyRoute → UnknownLink → NonContiguousRoute → OriginHasThroughTraffic → RouteThroughZone`. A residual ambiguity remains (finding 1 below). |
| 4 | MINOR: a rejected spawn consuming a trip ID is not caught | **Resolved** | The contract states "Rejected spawns consume no trip id". T3 `:191-193` checks the next valid vehicle's `trip_id == 0`. `trip_on_reject` makes T3 give **3**, so T3 fails. `trip_on_reject_late` (only origin/zone errors consume an id) moves trip 2 onto the `[sj, jz]` vehicle's slot: trip 2 completes at tick **61**, not 67, so T20 fails. Both are caught. |
| 4b | MINOR: other r7 notes (`check_invariants` has no negative test, LIFO reuse unobserved, equivalent mutants) | Unchanged | Still MINOR, see the mutation table. |

## Findings

No BLOCKER. No MAJOR.

### 1. MINOR: validation precedence is specified but untested, and slightly ambiguous
- **Untested.** No test route violates two rules at once:
  - T3's non-contiguous route starts at a source node.
  - T20's `[jd]` has no zone.
  - T20's `[sj, jz, zj, jd]` is contiguous with a valid origin.

  So any permutation of the five checks passes all 20 tests. The consequence is limited to which `SpawnError` variant is returned. Physics, ids and buffers are unaffected (validation runs before mutation, which T3 and T20 enforce).
- **Ambiguous.** "`UnknownLink → NonContiguousRoute`" can be read in two ways: as whole-route phases, or per index (a single-pass loop). For `[l_ac, l_ad, LinkId(42)]` the phased reading returns `UnknownLink(42)` and the per-index reading returns `NonContiguousRoute{at:1}`.
- **Fix (optional).** Add "each rule is checked over the whole route before the next rule; first offending index". Optionally add one assertion such as `spawn_with_route(vec![l_ac, l_ad, LinkId(42)]) == Err(UnknownLink(LinkId(42)))`.

### 2. MINOR: a zone-only "sink uses credit" mutant (`zone_sink_credit`) is not caught, with negligible consequence
The mutant charges lane credit only when a vehicle completes at a **zone**. The generic `sink_credit` is still caught by T16. T20 has a single zone-bound trip, which has credit banked, so it completes at 67 either way.

`probe_zsink8.py` measures the consequence: two 2-lane saturated feeders into a 1-lane `j→z` connector (50 m / 8 m/s and 200 m / 13.9 m/s).
- Correct: 585 / 580 zone completions.
- Mutant: identical, **585 / 580**.

Inflow to a 1-lane connector is already about 0.49 veh/s, so the gate never binds. It could bind only with a free-flowing multi-lane feed straight into a zone, which T16's generic check already guards in the shared code path. The mutant is also implausible, because it needs a zone-specific completion branch that the contract does not describe. MINOR.

### 3. MINOR: documentation drift in the ward
- `ward-001.md` Outputs lists `VehicleView { id, lane, s, v }`. The stub and tests use `VehicleView { id, trip_id, lane, s, v }`, and T3, T5, T14, T15 and T20 rely on `trip_id`. Update the ward line.
- In the ward Tests table, row 20 comes before row 19 (cosmetic).

### 4. MINOR: remaining mutants not caught (unchanged class; argued in red-4 to red-7)
All are equivalent or have no measurable consequence:
- `credit_late`, `credit_reset_zero` and `sink_gated`: equivalent.
- `rr_on_blocked`, `rr_live`, `rr_first_only`, `lane_major_order` and `nodes_desc`: equivalent in the probes.
- `admit_origins_desc`: equivalent with a per-origin budget.
- `swap_discharge_admission`: equivalent by construction, since admission and discharge never write to the same link.
- `empty_as_length` and `entry_s_nocap`: not observable.
- `lane_change`: fires about once.

## Reference results (current contract, `python3 -I /tmp/wddref8/scen.py`)

| Test | Assertion(s) | Measured | Result |
|---|---|---|---|
| 1–2 | builder API | read-through; unchanged since r7 | OK |
| 3 | errors; spawned 0; `VehicleId(0)`; **`trip_id == 0` after one step** | errors as expected; `trip_id` **0** | PASS |
| 4 | travel within ±2 of 205.5 | **205** | PASS |
| 5 | gap ≥ 7.5 − 1e-3; s monotone; lane constant | no violation; 332 completed | PASS |
| 6 | link_count ≤ cap; L2 reaches cap | L2 max 20/20 | PASS |
| 7 | lanes=1: 135–151; lanes=2: 270–302 | **150** (buffer 954); **300** (buffer 619) | PASS |
| 8 | L2 full < L1 full ≤ origin ≥ 5; frac ≥ 0.9 | 203 < 1362 ≤ 1494; 1.000 | PASS |
| 9 | blocked_ticks > 50 | **734**; L2 max 13/13 | PASS |
| 10 | conservation, dense ids, twin identical | 1015 spawned, all completed by tick 3022 | PASS |
| 11 | completed ticks == [65,75,85] | **[65, 75, 85]** | PASS |
| 12 | total ≥ 250; share 0.4–0.6 | **300**; **0.500** (150/150) | PASS |
| 13 | crossings ≤ 1 + 0.25 n; L2 ≥ 10 | first exit at loop tick 122; min slack 0; L2 = 19 | PASS |
| 14 | lanes [0,1,0,1] | [0,1,0,1] | PASS |
| 15 | parts 1–4 | part 2 **[0] / [3] / 3**; part 3 **(2,2,1,1)**; part 4 **[1,1,1,1,1,2]** | PASS |
| 16 | done > 227.5; max L1 < 99 | **325**; **40**/198 | PASS |
| 17 | travel == 152; slowest > 5 | **152**; 13.0 | PASS |
| 18 | completed_tick == 85 | **85** | PASS |
| 19 | 648 configs, spacing, invariants | 648, **0** violations, min gap 7.5 | PASS |
| 20 | errors; spawned 3; total ≥ 405; share 0.4–0.6; jz exits == 1; trip 2 tick == 67 | `OriginHasThroughTraffic(NodeId(1))`, `RouteThroughZone{at:2}`; total **450**; share **0.4978** (fz 224 / fs 226); `jz` exits **1**; trip 2 `(created 0, completed 67)`; end state zj 6/6, sj 40/40, jd 39/40, de 12/40, buffers z 880 / s 853 | PASS |

All 20 pass on the reference. The T20 saturation assert has a margin of 45 (450 vs 405). 450 is the hard ceiling (one lane of `jd`, 0.25 credit per tick, 1800 ticks).

## Mutation table
"Caught by" lists tests that fail on the mutant and pass on the correct reference. ★ marks mutants new this round. 77 in total. Full output is in `/tmp/wddref8/out_muts8.txt`.

| Mutation | Caught by | Severity if not caught |
|---|---|---|
| ★ Rejected spawn consumes a trip id (all errors) | 3, 20 (T3 gives trip_id 3; T20 gives trip 2 at 61) | |
| ★ Only origin/zone rejections consume a trip id | 20 (trip 2 at 61) | |
| ★ trip_id = slot id (LIFO reuse) | 10 (non-dense log ids) | |
| ★ trip_id assigned at admission | 15 (wide=[1]) | |
| ★ Zone-only sink consumes credit | NOT CAUGHT | MINOR (finding 2; no measurable effect) |
| ★ Validation order permuted (by inspection) | NOT CAUGHT | MINOR (finding 1; error variant only) |
| Zones excluded from discharge (`zone_skip_discharge`) | **20** (jz exits 0), resolved | |
| Zones excluded from admission | 20 (total 360 < 405, share 0) | |
| Origin check off / zone check off / on `.to` / incl. origin / incl. last `.to` / zones not exempt / error reports `.to` | 20 (each) | |
| Only zones may be origins | 3–20 | |
| No spacing check on entry | 5, 6, 7, 8, 9, 10, 12, 13, 15, 19, 20 | |
| Tail pre-move (both steps) / discharge only / admission only | 6–9, 12, 15, 16, 20 / 6–9, 12, 16, 20 / 15, 20 | |
| `tail_guaranteed`: limit = length / no limit / ignores moved / uses `tail.v` | 19, 20 / 19, 20 / 19 / 7, 8, 9, 12, 15, 20 | |
| Movement uses the leader's pre-move position | 6, 7, 8, 9, 12, 16, 20 | |
| Front not limited at stop line | 5, 6, 7, 8, 9, 10, 12, 13, 19, 20 | |
| `v = v'` | 8, 9 | |
| Credit cap 4.0 / cap before add | 13 / 9, 13 | |
| No credit / only non-empty lanes / per link | 6, 7, 8, 9, 13 / 17 / 6, 7, 8, 9, 16 | |
| Credit added after decision / reset to 0 on transfer | NOT CAUGHT / NOT CAUGHT | MINOR (equivalent) |
| Lane capacity off by one | 5, 6, 7, 8, 9, 10, 12, 13, 19, 20 | |
| Lowest-id first / tick mod n / `rr_next = i` / RR on completion | 7, 8, 12, **20** / 9, 12 / 7, 8, 12, **20** / 12 | |
| RR advanced when blocked / read live / first transfer only / lane-major / nodes descending | NOT CAUGHT | MINOR (equivalent in probes) |
| Steps 4 and 5 swapped | NOT CAUGHT | MINOR (equivalent by construction) |
| Moved front eligible again | 17 | |
| Transferred / admitted not marked moved | 11, 17, 18, 20 / 11, 15, 17, 18, 20 | |
| Transferred/admitted move again in step 6 | 11, 15, 17, 18, 20 | |
| Sink consumes credit (generic) / sink gated on credit | 16 / NOT CAUGHT | — / MINOR (equivalent) |
| Unlimited admission / per first link / global / attempts count / skipped count | 15 (each) | |
| Origins admitted descending | NOT CAUGHT | MINOR (equivalent) |
| LIFO admission / global HOL blocking | 14, 15, 20 / 15 | |
| Lane: lowest feasible / tie → highest / rank mod lanes | 14 / 14 / 5, 14 | |
| Empty lane valued as link length | NOT CAUGHT | MINOR |
| Rebalance lane change / overtaking lane change | NOT CAUGHT / 5 | MINOR / — |
| Ignoring downstream capacity / no car following | 5, 6, 7, 8, 9, 10, 12, 13, 19, 20 (both) | |
| Completion without reaching end / `completed_tick + 1` | 4, 11, 15, 17, 18, 20 / 11, 17, 18, 20 | |
| No acceleration limit / admitted at vmax | 4, 11, 15, 17, 18, 20 (both) | |
| Entry speed ignores next limit / wrong link vmax | 18 / 18, 20 | |
| Strict `>` crossing / feasibility | 7, 8, 9, 12, 20 / 7, 8, 9, 12, 15, 20 | |
| Transfer at s = 0 / at v = 0 | 7, 8, 9, 12, 17, 18, 20 / 6, 7, 8, 9, 11, 12, 16, 17, 18, 20 | |
| `entry_s` not capped | NOT CAUGHT | MINOR (not observable) |

Every mutant that is not caught is MINOR: equivalent, not observable, or limited to the error variant. No mutant with a correctness or user-visible consequence in this ward's scope survives.

## Notes for Gold reviewer
A correct implementation produces exactly:
- T3: the next valid vehicle has `VehicleId(0)` and, after one step, `trip_id` **0**.
- T4: travel **205** ticks.
- T5: 332 completed.
- T6: L2 max 20/20.
- T7: **150** / **300**.
- T8: **203 / 1362 / 1494**.
- T9: **734** blocked ticks.
- T10: **1015** spawned, all completed by tick 3022.
- T11: completed ticks **65 / 75 / 85**.
- T12: total **300**, 150/150.
- T13: first L2 exit at loop tick **122**.
- T14: lanes [0,1,0,1].
- T15:
  - part 2: short=[0], wide=[3], buffer 3;
  - part 3: (2,2,1,1);
  - part 4: link_count after steps 1..6 = **[1,1,1,1,1,2]**.
- T16: **325** completed, max L1 40.
- T17: travel **152**.
- T18: completed at tick **85**.
- T19: 648 configs, 0 violations.
- T20:
  - errors `OriginHasThroughTraffic(NodeId(1))` and `RouteThroughZone{at:2}`;
  - window total **450** (≥ 405), share **0.4978** (zone 224 / through 226);
  - `link_exit_count(jz)` = **1**;
  - trip 2 created 0, completed at tick **67**.

Check in the Gold code:
- Step 4 iterates **all** nodes, zones included. Completion uses no credit at any node, zones included.
- Validation runs fully before any trip-id, slot, counter or buffer mutation, in the documented order.
- Trip ids come from a dedicated counter, not the slot index (LIFO reuse).
- Validation uses `is_zone(o) || in_links(o).is_empty()`, and `route[i].from` for `i ≥ 1`.
- Admission reuses the lane-choice/`tail_guaranteed` function with `entry_s = 0`.

Reproduce with:
- `python3 -I /tmp/wddref8/scen.py`
- `python3 -I /tmp/wddref8/allmuts8.py`
- `python3 -I /tmp/wddref8/probe_zone7.py`
- `python3 -I /tmp/wddref8/probe_zsink8.py`
