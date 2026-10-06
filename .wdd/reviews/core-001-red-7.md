# Review: core-001 — Red gate (round 7)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.
Inputs read: `livingcity.md` (via the prior reviews' citations), `.wdd/epics/core.md` (including the new "Zones (centroids)" rule and the reworded step 5),
`.wdd/wards/core/ward-001.md`, `.wdd/memory/decisions/zone-centroids.md`,
`crates/sim-core/tests/core_001_physics.rs` (20 tests), `crates/sim-core/src/*.rs` (stubs), `.wdd/reviews/core-001-red-6.md`,
`git diff 1f77026 887ceeb`.
`cargo test -p sim-core --test core_001_physics`: it compiles, and 0 pass / 20 fail on `todo!()`, which is expected for Red.
The worktree is unchanged except for this file.

Method: I copied the round-6 Python reference to `/tmp/wddref7/` (outside the repo) and extended it to match the current contract:
- `ref.py`:
  - `Net.zone()` and `Net.is_zone()`.
  - Spawn validation in this order: `EmptyRoute` → `UnknownLink` → `NonContiguousRoute` → `OriginHasThroughTraffic(route[0].from)` if the origin is neither a zone nor free of in-links → `RouteThroughZone { at: i }` for the first `i ≥ 1` with `route[i].from` a zone.
  - Toggles for zone mutants.
  - The discharge and admission code did not change: the contract changed only in wording for steps 4 and 5.
- `scen.py`:
  - T15 part 2 now uses X, Y, Y2, Z, Z2.
  - T15 part 4 is new (1-lane origin, 3 vehicles, counts after 5 and 6 steps).
  - T20 is new (validation, then a 2400-tick merge with the window starting at tick 600).

New scripts:
- `allmuts7.py`: all 72 mutants, run in parallel against all 20 scenarios. Output in `out_muts7.txt`.
- `probe_zone7.py`: a saturated version of T20, the r6 starvation scenario rebuilt with a zone, multiple connectors, and light through traffic.

## Verdict
REJECTED

## Prior findings status (round 6)

| # | Round-6 finding | Status | Evidence |
|---|---|---|---|
| 1 | MAJOR: `admit_tail_pre_move` not caught | **Resolved** | T15 part 4 (`:765-781`). Correct: `link_count` per step = [1, 1, 1, 1, 1, **2**]. The mutant gives [1, 1, 1, 1, 1, **1**], so T15 fails. `strict_feasible` is now caught by T15 too. Contract step 5 now says `tail_guaranteed ≥ 7.5`, not "7.5 m of room", which removes the misleading wording. |
| 2 | MAJOR (contract): origin admission at a junction starves through traffic | **Resolved structurally** | The zone rule (`core.md:44`), spawn validation (`ward-001.md:41`) and T20 together make it impossible, in this ward's API, for admission and discharge to target the same link. Origin out-links are reachable only from zones (no through routes) or from source nodes (no in-links). Probe (`probe_zone7.py r6_fixed`, the same geometry as r6 with the origin moved to a zone connector): through traffic **454** vs zone **466** exits (was **0** vs 720 in r6). With light through traffic (every 10 or 20 ticks) against a saturated zone: 355/360 and 178/180 served. The T20 fairness *assertion* itself is vacuous (finding 2 below), but the property holds and T12 guards the merge mechanism. |
| 3 | MINOR: `admit_count_skipped` not caught | **Resolved** | T15 part 2 with Y2. Correct: short=[0], wide=[3], buffer 3. The mutant gives wide=[], so T15 fails. |
| 3b | MINOR: steps 4/5 swap unobservable | **Moot** | Now equivalent by construction: admission and discharge never write to the same link (see above), and admitted vehicles are marked moved. |
| 4 | MINOR: notes (`check_invariants` has no negative test, LIFO reuse) | Unchanged | Still MINOR. |

## Findings

### 1. MAJOR: a trip that ends at a zone is never shown to complete (zone-as-destination untested)
The contract (`core.md:44`) says zones are nodes "where trips may start/end", and ward row 20 claims "ending in a zone is valid".
T20 checks only that `spawn_with_route(vec![sj, jz])` returns `Ok`. Nothing asserts that this vehicle (trip 2) ever completes.
No other test contains a zone.

Mutant `zone_skip_discharge`: step 4 skips nodes with `is_zone(n)`. It is a plausible, zone-specific shortcut ("no route passes
through a zone, so zones need no discharge"), and it can also come from a design that keeps zones outside the node list
iterated in step 4. **All 20 tests pass.** In the reference, trip 2 sits at `jz`'s stop line forever:
- Correct: `link_exit_count(jz)` = **1**, trip 2 completed at tick **67**.
- Mutant: `link_exit_count(jz)` = 0, `link_count(jz)` = 1.

Conservation still holds (the vehicle stays active), so `check_invariants` is silent.

Consequence: every trip whose destination is a zone stays on the network. In the city (`zone-centroids.md`: "districts/
workplaces/hospital as zones"), that means *every* trip. Connectors fill to capacity, spill back into junctions, and the
network gridlocks, while the completion count stays at 0. This is a completion/spillback correctness failure in step 4, which
belongs to this ward. It is the zone concept's main purpose, it has no coverage at all, and the fix is one line.

**Fix (verified):** after T20's loop, add `assert_eq!(w.link_exit_count(jz), 1)`. Optionally also assert that trip 2 is in
`completed_log()` with `completed_tick == 67` (the reference value, the same with or without the fix for finding 2).

### 2. MINOR: T20's "zone vs through 40–60 %" does not exercise round-robin, because the merge is not saturated
T20 says "with both saturated", but `jd` ends in the sink `d`, where completions need no credit. The merge at `j` therefore has
capacity 2 × 0.5 veh/s. Both feeders are limited by **origin admission** (0.4 veh/s each, 1 lane):
- fz = fs = **360** in 900 s, total 720 = 0.8 veh/s.
- `jd` is 17/40, `sj` 10/40, `zj` 3/6.

The share is 0.5 by symmetry of admission, whatever the merge does:

| Mutant | T20 as written | T20 + 1-lane `de` downstream (merge saturated) |
|---|---|---|
| correct | 0.500 (360/360) | 0.4978 (224/226, total 450) |
| `lowest_first` | **0.500 (passes)** | **0.000** (0/360) |
| `rr_eq_i` | **0.500 (passes)** | **1.000** (360/0) |
| `rr_on_completion` | 0.500 | 0.4978 |
| `admit_tail_pre_move` | 0.500 (300/300) | — |

This is MINOR rather than MAJOR because every merge-fairness mutant is still caught by T12 (`lowest_first` 7, 8, 12; `rr_eq_i`
7, 8, 12; `rr_tick_mod` 9, 12; `rr_on_completion` 12). No zone-specific merge mistake is plausible, since connectors are ordinary
links. The test and the ward row still claim something they do not verify.

**Fix (verified):**
1. Add `let e = b.node(900.0, 0.0); let de = b.link(d, e, 13.9, 1);`.
2. Use routes `[zj, jd, de]` and `[sj, jd, de]` in the loop.
3. Assert `fz + fs >= 405.0` (0.9 × 0.5 veh/s × 900 s) instead of `> 0`.

Correct: total **450**, share **0.4978** (224 vs 226). `lowest_first` 0.000 and `rr_eq_i` 1.000 then fail T20 as well.

### 3. MINOR: contract precision for the new validation
- **Error precedence** is unspecified when a route violates several rules (for example non-contiguous and through a zone).
  The tests never combine violations, so this is not a blocker. Recommend writing down the order used by the reference
  (`Empty → UnknownLink → NonContiguous → OriginHasThroughTraffic → RouteThroughZone`, first offending index).
- **Destinations** are not restricted: a route may end at a non-zone node (T4–T20 all do). The contract implies this but never
  says it. An implementer who reads "zones mark where trips start/end" as exclusive would break 17 tests. Add one sentence:
  "destinations are unrestricted in core-001; core-002 demand uses zones".
- The rule rejects a non-zone *dead-end* node with in-links as an origin even when it has no real through traffic. That is
  safe and conservative, but worth a note (mark it as a zone).
- A **multi-lane connector** gets a lane-weighted share of a merge, because round-robin works over in-*lanes*. Probe: a 3-lane
  zone connector vs a 1-lane through link gives zone **671** vs through **222**. This follows the contract and is not
  starvation, but the city epic should know that connector lane counts set the zone's priority. Consider documenting it under
  "Documented simplifications".

### 4. MINOR: remaining mutants not caught (unchanged class, all equivalent or without measurable consequence)
These were argued in red-4 through red-6:
- `credit_late`, `credit_reset_zero` and `sink_gated`: equivalent.
- `rr_on_blocked`, `rr_live`, `rr_first_only`, `lane_major_order` and `nodes_desc`: equivalent in the probes.
- `admit_origins_desc`: equivalent with a per-origin budget.
- `swap_discharge_admission`: now equivalent by construction.
- `empty_as_length` and `entry_s_nocap`: not observable.
- `lane_change`: fires about once.

New and also MINOR: rejected spawns that consume a trip ID are not caught. T3 and T20 check `spawned` only, not the
`trip_id` of the next valid spawn. Trip IDs would become non-dense. The consequence lands in core-002 (reroute stagger),
not in this ward.

### 5. Starvation probe summary (task 3): does the zone rule remove the class in ward-001's scope?
Yes. In this ward's API, `spawn_with_route` is the only way to create a route, and validation guarantees two things:
- (a) An origin node is either free of in-links or a zone that no route passes through.
- (b) Discharge therefore never transfers onto an out-link of an origin.

Admission and discharge never compete for the same lane, which removes the entry_s 0-vs-0.5 asymmetry. Remaining competition
happens inside discharge, where both fronts use the same `entry_s` rule. Probes (correct reference):

| Configuration | Result |
|---|---|
| r6 geometry, origin moved to a zone connector (z every 2/3/5 ticks, through every 4) | through **454** / zone **466** in every case (was 0 / 720) |
| Light through (every 10 / 20 ticks) vs a saturated zone at a saturated merge | 355/360 and 178/180 served, `sj` count 5 and 2 |
| Zone with two connectors (1-lane to j1, 3-lane to j2), saturated through at both | j1: 444 / 448; j2: 222 / 671 (lane-weighted, finding 3); zone FIFO buffer grows, no connector starved |
| Saturated T20 with connector speed 5 or 13.9 and length 15 or 200 m | share 0.4978–0.5022 |
| Source node without in-links sharing a downstream link | that is T12 (0.500) and the r6 geometry above |

No overlap or invariant violation occurred in any probe (`check_invariants` every tick). Outside this ward's scope, the
guarantee depends on core-002/003 enforcing the same rule for demand OD pairs and for reroutes ("never relaxes through
zones"). The contract states this, and those wards' reviewers must test it.

## Reference results (current contract, `python3 -I /tmp/wddref7/scen.py`)

| Test | Assertion(s) | Measured | Result |
|---|---|---|---|
| 1–3 | builder/spawn API | read-through; unchanged; no test spawns at a non-zone node that has in-links (checked T3–T20) | OK |
| 4 | travel within ±2 of 205.5 | **205** | PASS |
| 5 | gap ≥ 7.5 − 1e-3; s monotone; lane constant | no violation; 332 completed | PASS |
| 6 | link_count ≤ cap; L2 reaches cap | L2 max 20/20 | PASS |
| 7 | lanes=1: 135–151; lanes=2: 270–302; buffer > 0 | **150** (L1 13/40, buffer 954); **300** (L1 77/80, buffer 619) | PASS |
| 8 | L2 full < L1 full ≤ origin ≥ 5; front stopped; frac ≥ 0.9 | 203 < 1362 ≤ 1494; true; 1.000 | PASS |
| 9 | blocked_ticks > 50; no crossing while full; waiting front | 734; L2 max 13/13; true | PASS |
| 10 | conservation; all complete; twin identical | 1015 spawned, all completed by tick 3022 | PASS |
| 11 | completed ticks == [65,75,85] | **[65, 75, 85]**; 32.5 s × 3 | PASS |
| 12 | total ≥ 250; share 0.4–0.6 | **300**; **0.500** (150/150) | PASS |
| 13 | crossings ≤ 1 + 0.25 n; L2 ≥ 10 | first exit at loop tick 122; min slack 0; L2 = 19 | PASS |
| 14 | lanes [0,1,0,1] | [0,1,0,1] | PASS |
| 15 | part 1 FIFO/rate/at rest; part 2 short=[0], wide=[3], buffer 3; part 3 (2,2,1,1); part 4 count 1 after 5 steps, 2 after 6 | as expected; part 2 **[0] / [3] / 3**; part 3 **(2,2,1,1)**; part 4 **[1,1,1,1,1,2]** | PASS |
| 16 | done > 227.5; max L1 < 99 | **325**; **40**/198 | PASS |
| 17 | travel == 152; slowest > 5 | **152**; 13.0 | PASS |
| 18 | completed_tick == 85 | **85** | PASS |
| 19 | 648 configs, spacing, invariants | 648, **0** violations, min gap 7.5 | PASS |
| 20 | is_zone; `OriginHasThroughTraffic(j)`; `RouteThroughZone{at:2}`; 3 ok spawns; share 0.4–0.6 | `OriginHasThroughTraffic(NodeId(1))`, `RouteThroughZone{at:2}`, spawned 3; share **0.5000** (360/360, total 720; jd 17/40, zj 3/6, sj 10/40; buffers z 721, s 722) | PASS |

All 20 pass on the reference. **No BLOCKER.**

## Mutation table
"Caught by" lists tests that fail on the mutant and pass on the correct reference. ★ marks mutants new this round. 72 mutants in total.

| Mutation | Caught by | Severity if not caught |
|---|---|---|
| ★ Origin check off (`OriginHasThroughTraffic` never raised) | 20 | |
| ★ Zone check off (`RouteThroughZone` never raised) | 20 | |
| ★ Zone check on `route[i].to` (off by one, at = 1) | 20 | |
| ★ Zone check includes origin (i ≥ 0) | 20 | |
| ★ Zone check includes final destination | 20 | |
| ★ Zones not exempt from the origin rule | 20 | |
| ★ Only zones may be origins (sources rejected) | 4–20 | |
| ★ Error reports `route[0].to` instead of the origin | 20 | |
| ★ Zones excluded from admission | 20 (share 0.0) | |
| ★ **Zones excluded from discharge (no completion at a zone)** | **NOT CAUGHT** | **MAJOR** (finding 1) |
| No spacing check on entry | 5, 6, 7, 8, 9, 10, 12, 13, 15, 19, 20 | |
| Tail pre-move (both steps) | 6, 7, 8, 9, 12, 15, 16 | |
| Tail pre-move, discharge only | 6, 7, 8, 9, 12, 16 | |
| Tail pre-move, admission only | **15 (part 4)**, resolved | |
| `tail_guaranteed` ignores `moved` / `limit_now` / limit = length | 19 / 19 / 19 | |
| `tail_guaranteed` uses `tail.v` | 7, 8, 9, 12, 15 | |
| Movement uses the leader's pre-move position | 6, 7, 8, 9, 12, 16 | |
| Front not limited at stop line | 5, 6, 7, 8, 9, 10, 12, 13, 19 | |
| `v = v'` | 8, 9 | |
| Credit cap 4.0 / cap before add | 13 / 9, 13 | |
| No credit / only non-empty lanes / per link | 6, 7, 8, 9, 13 / 17 / 6, 7, 8, 9, 16 | |
| Credit added after decision | NOT CAUGHT | MINOR (equivalent) |
| Credit reset to 0 on transfer | NOT CAUGHT | MINOR (exactly equivalent) |
| Lane capacity off by one | 5, 6, 7, 8, 9, 10, 12, 13, 19 | |
| Lowest-id first / tick mod n / `rr_next = i` / RR on completion | 7, 8, 12 / 9, 12 / 7, 8, 12 / 12 | (T20 alone does not catch these; finding 2) |
| RR advanced when waiting for credit / read live / first transfer only / lane-major | NOT CAUGHT | MINOR (equivalent in probes) |
| Nodes discharged descending | NOT CAUGHT | MINOR |
| Steps 4 and 5 swapped | NOT CAUGHT | MINOR (equivalent by construction now) |
| Front already moved crosses again | 17 | |
| Transferred / admitted not marked moved | 11, 17, 18 / 11, 15, 17, 18 | |
| Transferred/admitted also move in step 6 | 11, 15, 17, 18 | |
| Sink consumes credit | 16 | |
| Sink gated on credit | NOT CAUGHT | MINOR (equivalent) |
| Unlimited admission / per first link / global / attempts count | 15 / 15 / 15 / 15 | |
| Skipped vehicles use budget | **15 (part 2)**, resolved | |
| Origins admitted descending | NOT CAUGHT | MINOR (equivalent) |
| LIFO admission / global HOL blocking | 14, 15 / 15 | |
| Lane lowest feasible / tie → highest / rank mod lanes | 14 / 14 / 5, 14 | |
| Empty lane valued as link length | NOT CAUGHT | MINOR |
| Overtaking lane change / rebalance lane change | 5 / NOT CAUGHT | — / MINOR (fires about once) |
| Ignoring downstream capacity / no car following | 5, 6, 7, 8, 9, 10, 12, 13, 19 (both) | |
| Completion without reaching the end | 4, 11, 15, 17, 18 | |
| `completed_tick + 1` | 11, 17, 18 | |
| No acceleration limit / admitted at vmax | 4, 11, 15, 17, 18 (both) | |
| Entry speed ignores next limit / wrong link vmax | 18 / 18 | |
| Strict `>` crossing / feasibility | 7, 8, 9, 12 / 7, 8, 9, 12, 15 | |
| Transfer at s = 0 / at v = 0 | 7, 8, 9, 12, 17, 18 / 6, 7, 8, 9, 11, 12, 16, 17, 18, 20 | |
| `entry_s` not capped | NOT CAUGHT | MINOR |
| ★ Rejected spawn consumes a trip ID | NOT CAUGHT (by inspection: no test checks trip_id after an error) | MINOR |

## Notes for Gold reviewer
- A correct implementation produces exactly:
  - T4: travel **205**.
  - T5: 332 completed.
  - T6: L2 max 20/20.
  - T7: **150** / **300**.
  - T8: **203 / 1362 / 1494**.
  - T9: **734**.
  - T10: **1015** spawned.
  - T11: **65/75/85**.
  - T12: **300**, 150/150.
  - T13: first L2 exit at loop tick **122**.
  - T14: [0,1,0,1].
  - T15: part 2 short=[0], wide=[3], buffer 3; part 3 (2,2,1,1); part 4 link_count after steps 1..6 = **[1,1,1,1,1,2]**.
  - T16: **325**, max L1 40.
  - T17: **152**.
  - T18: **85**.
  - T19: 648 configs, 0 violations.
  - T20: errors `OriginHasThroughTraffic(NodeId(1))` and `RouteThroughZone{at:2}`; share **0.5000** (360/360, total 720).
- If finding 1 is fixed: `link_exit_count(jz) == 1`, trip 2 completed at tick **67**.
- If finding 2 is fixed (`de` downstream): total **450**, share **0.4978** (224 zone / 226 through).
- Check in the Gold code:
  - Step 4 iterates **all** nodes, zones included.
  - Validation uses `is_zone(o) || in_links(o).is_empty()`, and `route[i].from` for `i ≥ 1`.
  - Validation runs before any trip ID, slot or buffer mutation.
  - Admission reuses the lane-choice/`tail_guaranteed` function with `entry_s = 0`.
- Reproduce with:
  - `python3 -I /tmp/wddref7/scen.py`
  - `python3 -I /tmp/wddref7/allmuts7.py`
  - `python3 -I /tmp/wddref7/probe_zone7.py`
