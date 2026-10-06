# Review: core-001 — Red gate (round 5)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.
Inputs read: `.wdd/epics/core.md` (at `f6c114c`), `.wdd/wards/core/ward-001.md`,
`crates/sim-core/tests/core_001_physics.rs` (19 tests), `crates/sim-core/src/world.rs` (API docs),
`.wdd/reviews/core-001-red-4.md`, `git diff 3dd053c f6c114c`.
`cargo test -p sim-core --test core_001_physics`: compiles; 0 passed / 19 failed on `todo!()` (expected for Red).
The worktree is unchanged except for this file.

Method: I copied the round-4 Python reference to `/tmp/wddref5/` (outside the repo). I re-checked `ref.py` against
the current contract. Step 6 is already written as `s2 = max(v.s, min(v.s + vp * DT, limit))`, exactly the new
`core.md:64` form. Credit order, `rr_next` only on transfer, both `tail_guaranteed` clauses, the `>=` forms, entry
speed, and `completed_tick` before the increment are all as specified. `speed_factor = 1.0`, as `ward-001.md:44`
requires. I updated `scen.py` for this round's test changes: T15 now spawns `Z2`, and the buffer must be 2. I added
T19 as an exact transcription of `core_001_physics.rs:856-903`: node and link creation order, Euclidean lengths,
`ly` with 3 lanes at 13.9 m/s, 400 ticks with spawns for `t < 300`, then the spacing check (`gap >= 7.5 − 1e-9`
per lane over `link_vehicles`, which is ordered by lane, front first) and `check_invariants` after every step. New
scripts: `t19_search.py` (T19 grid variants against the `tail_guaranteed` mutants) and `probe_admit_global.py`.
New mutants in `extra_muts.py`: `admit_global`, `admit_count_attempts`, `tg_limit_len`, `tg_use_v`.

## Verdict
REJECTED

## Prior findings status (round 4)

| # | Round-4 finding | Status | Evidence |
|---|---|---|---|
| 1 | MAJOR: neither `tail_guaranteed` guard clause is tested | **Half resolved** | New T19 (`:856-903`). `tg_ignore_moved` is caught: it overlaps in 36 of 324 configs, first `A=200 B=100 M=30 lanes=1 pa=1 pb=1` at t=36 (lane gap 4.25 on `lm`). `tg_no_limit` is **not caught: 0 of 324 configs**, and the full suite passes. The proposed case B had a 2-lane feeder, an 8 m/s merge link and a 1-lane exit. T19 dropped all three, and the 2-lane feeder is the factor that matters. See new finding 1. |
| 2 | MINOR: admission limit per first link passes | **Resolved** | `:733-739`. Correct: `short=[0]`, `wide=[2]`, buffer 2. `admit_limit_per_link`: `wide=[2,3]`, buffer 1. T15 fails. |
| 3 | MINOR: `clamp` can panic; no spacing tolerance | **Resolved** | `core.md:64` pins `max(s, min(s + v'×DT, limit))` and forbids `f64::clamp`. `core.md:105` allows a spacing tolerance of 1e-9 m. Over all 19 scenarios, T19's 324 configs included: `limit < s` never occurs, min gap is exactly 7.5, and the largest `v − vmax` is 9.06e-14. |
| 4 | MINOR: stale comment and ward text | **Partially resolved** | Ward row 2 is fixed. `:326` has a new, correct comment, but the stale `:342` "And L1 was still queued at the end (the window was saturated)" is **still there**. It is false for lanes = 1 (L1 13/40, moving), and the assertion below it checks the origin buffer. |
| 5 | MINOR notes (equivalent or low-impact mutants) | Unchanged | `credit_late`, `sink_gated`, `entry_s_nocap`, `empty_as_length`, `rr_on_blocked` and `lane_change` are still not caught, all low impact or equivalent as argued in red-4. `check_invariants` still has no negative test. |

## Findings

### 1. MAJOR: T19 does not catch `tg_no_limit`; the ward and the commit say it covers both clauses
`ward-001.md` row 19 says "(covers both `tail_guaranteed` guard clauses)", and commit `f6c114c` says the same. That
is false. The mutant `tail_guaranteed = tail.s + v'·DT`, which drops `min(…, limit_now)` from `core.md:52`, passes
all 19 tests. It produces **0 overlaps in all 324 T19 configs**. It still overlaps in round-4 case B
(`grid_tg.py (300, 205, 30, 2, 2, 2)` → overlap at t = 67; the correct reference has none). The variant
`tg_limit_len`, which uses the link length as `limit_now` for every tail, also passes all 19 tests, for the same
reason. Consequence: the same as round 4. In ordinary two-feeder merges with a multi-lane feeder, vehicles end up
less than 7.5 m apart, which breaks the core no-overlap invariant. With a lax `check_invariants`, nothing reports
it.

Cause: in T19 both feeders have 1 lane. I varied single factors over the same 324-config grid
(`t19_search.py`):

| T19 variant | correct overlaps | `tg_no_limit` | `tg_ignore_moved` |
|---|---|---|---|
| as committed (la 1 lane, lm 13.9, ly 3 lanes) | 0 | **0/324** | 36/324 |
| ly 1 lane | 0 | 0/324 | 45/324 |
| lm 8.0 m/s | 0 | 0/324 | 36/324 |
| ly 1 lane + lm 8.0 | 0 | 0/324 | 45/324 |
| **la 2 lanes** | 0 | **54/324** | **57/324** |
| la 2 lanes + ly 1 lane | 0 | 18/324 | 54/324 |
| la 2 lanes + lm 8.0 | 0 | 33/324 | 36/324 |

**Fix (verified):** give the feeder `la` two lanes. Either change `let la = b.link(oa, m, 13.9, 1);` to
`…, 13.9, 2);` (324 configs remain), or, preferably, add an outer loop `for &lanes_a in &[1u8, 2u8]` and use
`b.link(oa, m, 13.9, lanes_a)` (648 configs; update `assert_eq!(configs, 648)` and ward row 19). The second form
keeps every config that fails today, so `tg_ignore_moved` stays caught in 93 of 648. With la = 2 lanes, the first
failing configs in loop order are:
- `tg_no_limit`: `A=100 B=100 M=30 lanes=2 pa=1 pb=1`, overlap at t=43
- `tg_ignore_moved`: `A=100 B=100 M=30 lanes=2 pa=3 pb=1`, t=203
- `tg_limit_len`: same as `tg_no_limit`, t=43

The correct reference has 0 overlaps and 0 invariant violations in all configs of every variant.

### 2. MAJOR: an admission budget shared by all origins is not caught and starves higher-id origins
Contract `core.md:63`: "admit up to `ORIGIN_ADMIT_PER_TICK` **per origin** per tick". Mutant `admit_global`: the
`admitted` counter is declared before the origin loop instead of inside it (a one-line hoisting slip). It passes all
19 tests. T15 has only one origin. T10, T12 and T19 have several origins, but each has a single 1-lane first link,
so at most one vehicle is admissible per origin per tick, and the shared limit of 2 never binds in them. The
consequence is total starvation. With 15 one-lane origins under saturated demand for 600 ticks
(`probe_admit_global.py`), the correct reference admits 120 vehicles at every origin. The mutant admits 120 at
origins 0–9 and **0 at origins 10–14**. For the whole network, admission is capped at 4 veh/s. The core-005 city
has many origins, so high-id districts would never send a single vehicle, which looks like a demand bug far from
its cause.

**Fix (verified):** add a T15 part 3. Use two origins, each with its own 4-lane, 500 m link, spawn 3 vehicles for
each, and run one tick. Assert `link_count(w1) == 2`, `link_count(w2) == 2`, and `origin_buffer_len == 1` at both
origins. Correct: `(2, 2, 1, 1)`. `admit_global`: `(2, 0, 1, 3)`. Update ward row 15 to say "per origin
(independent budgets), not per link and not global".

### 3. MINOR: the stale T7 comment is still there
`core_001_physics.rs:342`: replace "And L1 was still queued at the end (the window was saturated)" with "And demand
still exceeded capacity at the end (origin buffer non-empty)". Round 5 added a correct comment at `:326`, but the
wrong one remains.

### 4. MINOR: other mutants not caught (low impact or equivalent)
- `admit_count_attempts` (a blocked vehicle uses up the budget) is caught by T15 (`wide=[]`). OK.
- `tg_use_v` (`tail.v` instead of `v'`) is caught by T7, T8, T9 and T12. OK.
- The mutants in red-4 finding 5 remain uncaught: `credit_late` and `sink_gated` (equivalent in core-001),
  `entry_s_nocap` (cannot be observed below 20 m/s), `empty_as_length`, `rr_on_blocked`, and `lane_change` (fires
  about once in all scenarios; the two other lane-change variants are caught). `check_invariants` still has no
  negative test, and the LIFO free list is untested beyond `VehicleId(0)`.

## Reference results (current contract, `python3 /tmp/wddref5/scen.py`)

| Test | Assertion(s) | Measured | Result |
|---|---|---|---|
| 1–3 | builder/spawn API | read-through; unchanged since red-4; consistent with `core.md:42` | OK |
| 4 | travel within ±2 of 205.5 | **205** | PASS |
| 5 | gap ≥ 7.5 − 1e-3; s monotone; lane constant | no violation; 332 completed | PASS |
| 6 | link_count ≤ cap; L2 reaches cap | L2 max 20/20 | PASS |
| 7 | lanes=1: 135–151; lanes=2: 270–302; buffer > 0 | **150** (L1 13/40, buffer 954); **300** (L1 77/80, buffer 619) | PASS |
| 8 | L2 full < L1 full ≤ origin ≥ 5; front stopped; frac ≥ 0.9 | 203 < 1362 ≤ 1494; true; 1.000 | PASS |
| 9 | blocked_ticks > 50; no crossing while full; waiting front | 734; L2 max 13/13; true | PASS |
| 10 | conservation; all complete once; twin/clone identical | 1015 spawned, all completed by tick 3022 | PASS |
| 11 | completed ticks == [65,75,85]; 28.78–34.25 s | **[65, 75, 85]**; 32.5 s × 3 | PASS |
| 12 | total ≥ 250; share 0.4–0.6 | **300**; **0.500** (150/150); l3c completions 350 | PASS |
| 13 | crossings ≤ 1 + 0.25 n; samples; L2 ≥ 10 | first exit at loop tick 122; min slack 0; L2 = 19 | PASS |
| 14 | lanes [0,1,0,1]; no lane change | [0,1,0,1] on both links | PASS |
| 15 | 2 admitted FIFO at rest; ≤ 2/tick; per-link blocking; Z2 waits | as expected; short=[0], wide=[2], buffer **2**; all 10 admitted within 60 ticks | PASS |
| 16 | done > 227.5, then max L1 < 99 | done **325**; max L1 **40**/198 (max L2 36/66) | PASS |
| 17 | completed; cruising; travel == 152; slowest > 5 | travel **152**; slowest 13.0 | PASS |
| 18 | v on L2 ≤ 8 + 1e-9; completed_tick == 85 | **85**; max v on L2 8.0 | PASS |
| 19 | 324 configs; spacing ≥ 7.5 − 1e-9; invariants every tick | 324 configs, 0 violations; min gap exactly **7.5**; 30105 completions in total | PASS |

All 19 pass on the reference. No BLOCKER: I found no test that a correct implementation of the current contract
would fail.

## Mutation analysis
"Caught by" lists tests that fail on the mutant and pass on the correct reference (`muts.py`, `extra_muts.py`,
`probe_misc.py`, `t19_search.py`, `probe_admit_global.py`).

| Mutation | Caught by | Severity if not caught |
|---|---|---|
| No spacing check on entry | 5, 6, 7, 8, 9, 10, 12, 13, 15, 19 | |
| Tail compared at pre-move position | 6, 7, 8, 9, 12, 16 | |
| `tail_guaranteed` ignores `moved` flag | **19** (36/324; first A=200 B=100 M=30 lanes=1 pa=1 pb=1, t=36) | |
| `tail_guaranteed` ignores `limit_now` | **NOT CAUGHT** (0/324) | **MAJOR** (finding 1) |
| `tail_guaranteed` limit = link length for all tails | **NOT CAUGHT** | MAJOR (same root as finding 1) |
| `tail_guaranteed` uses `tail.v` instead of `v'` | 7, 8, 9, 12 | |
| Credit cap 4.0 | 13 | |
| No credit | 6, 7, 8, 9, 13 | |
| Credit only on non-empty lanes | 17 | |
| Credit added after decision | NOT CAUGHT | MINOR (equivalent in core-001) |
| Credit per link | 6, 7, 8, 9, 16 | |
| Lowest-id first (no RR) | 7, 8, 12 | |
| RR start = tick mod n | 9, 12 | |
| `rr_next = i` | 7, 8, 12 | |
| `rr_next` advanced on completion | 12 | |
| `rr_next` advanced when blocked by space | 7, 8, 12 | |
| `rr_next` advanced when waiting for credit | NOT CAUGHT | MINOR |
| Sink consumes credit | 16 | |
| Sink gated on credit (not consumed) | NOT CAUGHT | MINOR (equivalent) |
| Unlimited origin admission | 15 | |
| Admission limit per first link | **15** (`wide=[2,3]`) | |
| Admission limit **global across origins** | **NOT CAUGHT** | **MAJOR** (finding 2) |
| Blocked vehicle uses up admission budget | 15 | |
| LIFO admission | 14, 15 | |
| Global head-of-line blocking | 15 | |
| Lane = lowest feasible | 14 | |
| Lane tie → highest index | 14 | |
| Empty lane valued as link length | NOT CAUGHT | MINOR |
| Lane = rank mod lanes (lane changes) | 5, 14 | |
| Lane change into gap (overtaking) | 5 | |
| Lane change rebalance to lane 0 | NOT CAUGHT | MINOR (fires about once) |
| Ignoring downstream capacity | 5, 6, 7, 8, 9, 10, 12, 13, 19 | |
| Completion without reaching end | 4, 11, 17, 18 | |
| `completed_tick + 1` | 11, 17, 18 | |
| No acceleration limit | 4, 11, 17, 18 | |
| Admitted at vmax | 4, 11, 15, 17, 18 | |
| Transferred/admitted vehicles also move in step 6 | 11, 15, 17, 18 | |
| Entry speed ignores next link limit | 18 | |
| Movement uses wrong link's vmax | 18 | |
| Strict `>` crossing / strict `>` feasibility | 7, 8, 9, 12 / 7, 8, 9, 12 | |
| Transfer at s = 0 / at v = 0 | 7, 8, 9, 12, 17, 18 / 6, 7, 8, 9, 11, 12, 16, 17, 18 | |
| `entry_s` not capped at next length | NOT CAUGHT | MINOR (cannot be observed below 20 m/s) |
| No car following | 5, 6, 7, 8, 9, 10, 12, 13, 19 | |

## Notes for Gold reviewer
- A correct implementation of the current contract produces exactly: T4 travel **205** ticks · T5 332 completed ·
  T6 L2 max 20/20 · T7 **150** (lanes=1, L1 13/40, buffer 954) / **300** (lanes=2, L1 77/80, buffer 619) ·
  T8 L2 full at tick **203**, L1 at **1362**, origin ≥ 5 at **1494**, frac 1.000 · T9 blocked_ticks **734** ·
  T10 spawned **1015**, all completed by tick 3022 · T11 completed ticks **65/75/85** · T12 total **300**, f1/f2
  **150/150**, share **0.500** · T13 first L2 exit at loop tick **122**, final L2 count 19 · T14 [0,1,0,1] ·
  T15 part 2: short=[0], wide=[2], buffer **2** · T16 done **325**, max L1 **40** · T17 travel **152** ·
  T18 completed tick **85** · T19 324 configs without violation, min gap exactly 7.5.
- If finding 1 is fixed as proposed (la with 2 lanes), the correct reference still has 0 violations, and the first
  failing configs are `tg_no_limit` A=100 B=100 M=30 lanes=2 pa=1 pb=1 (t=43) and `tg_ignore_moved` A=100 B=100
  M=30 lanes=2 pa=3 pb=1 (t=203). If finding 2 is fixed, the expected values are `(2, 2, 1, 1)`.
- Until both fixes land, read the Gold `tail_guaranteed` line by line against `core.md:52`, especially
  `min(…, limit_now)` with `limit_now = leader.s − JAM_SPACING` for non-front tails. Also check that the admission
  counter is reset **inside** the per-origin loop.
- Watch for `f64::clamp` in movement (`core.md:64` forbids it), a `check_invariants` weaker than the T19 spacing
  check (it is never tested negatively), and `link()` indexing nodes eagerly (T2 requires no panic).
- Reproduce: `python3 /tmp/wddref5/scen.py` · `python3 /tmp/wddref5/muts.py` · `python3 /tmp/wddref5/extra_muts.py`
  · `python3 /tmp/wddref5/t19_search.py` · `python3 /tmp/wddref5/probe_admit_global.py` ·
  `python3 /tmp/wddref5/probe_clamp.py`.
