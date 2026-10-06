# Review: core-001 — Red gate (round 3)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.
Inputs read: `livingcity.md` (via prior reviews and the contract), `.wdd/epics/core.md` (at `d34c1e9`),
`.wdd/wards/core/ward-001.md`, `crates/sim-core/tests/core_001_physics.rs` (17 tests),
`crates/sim-core/src/{lib,params,network,world}.rs`, `.wdd/reviews/core-001-red-{1,2}.md`, `git diff 81d9715 d34c1e9`.
`cargo test -p sim-core --test core_001_physics`: compiles; 17/17 fail on `todo!()` (expected for Red).

Method: I copied the round-2 Python reference to `/tmp/wddref3/` (outside the repo; the repo is unmodified except
for this file). I re-checked it against the current contract: step 4 credit accrual at the start of each lane's
evaluation, the fixed scan order, `rr_next` only on transfer, `tail_guaranteed` at post-move, the exact `>=` forms,
`speed_factor = 1.0`, and completion without credit. I found no deviation. Then I updated `scen.py` to the
**current** tests: T5 lane constancy and the lane-ascending check, the T10 independently built twin, the T14
schedule 0/0/5/12, the T16 every-2nd-tick feed with the premise assertion, and the new T17. I added mutants
(`lane_change2`, `completed_plus1`, `entry_s_zero`, `entry_v_zero`, `credit_late`) and a probe for `rr_next` on
completion (`probe_rr.py`). Tests 1–3 are pure builder and API checks, so I reviewed them by reading only.

## Verdict
REJECTED

## Prior findings status (round 2)

| # | Round-2 finding | Status | Evidence |
|---|---|---|---|
| 1 | BLOCKER: T16 fails on a correct impl and is non-discriminating | **Resolved** | `:725-744`: spawn every 2nd tick, premise `max_l1 < 0.5·cap`. Reference: done = **325** > 227.5, max L1 = 40/198, max L2 = 36/66. `sink_credit` fails (175, and L1 queues to 172). See finding 3 for a diagnostic caveat. |
| 2 | MAJOR: T14 does not discriminate lane choice; lane permanence only uncongested | **Resolved** | T14 spawns at 0,0,5,12 (`:635-641`). Correct gives [0,1,0,1]; `lowest_lane` gives [0,1,0,**0**]. T5 now checks lane constancy under congestion (`:245-252`): it catches `lane_by_rank` (t = 50) and a real overtaking lane-change mutant `lane_change2` (t = 70). I checked the T14 comment arithmetic: trip 2 at t = 5 enters by exact equality 7.5 ≥ 7.5 (tie → lane 0). Even with strict `>` the outcome stays [0,1,0,1], so T14 is robust. |
| 3a | MINOR: "credit accrues on empty lanes" untested | **Resolved** | New T17 (`:747-782`). `no_credit_empty`: the vehicle stops at the 10 m link's stop line (slowest 0.0; travel 160 vs 152). Correct: slowest 13.0, travel 152. |
| 3b | MINOR: "rr_next advances on transfer, not completion" untested | **Open, escalated to MAJOR** | Still NOT CAUGHT. I measured the impact as total starvation of a feeder (finding 1). |
| 4 | MINOR: misleading comments T7/T12 | **Partially resolved** | T12 comment fixed (`:555`). T7 header fixed (`:290-292`), but `:322` still says "L1 was still queued at the end", which is false for lanes = 1 (L1 13/40, moving). The ward table row 7 still says "(standing queue)" (finding 5). |
| 5 | MINOR: clone check cannot see HashMap order | **Resolved** | `:471-490` builds an independent twin (its own `RandomState`) and compares `completed_log()`. |
| 6 | MINOR: pin exact float forms | **Resolved** | `core.md:104-105` "Float comparisons". See finding 7 for one remaining unpinned expression. |
| 7a | scan order fixed at scan start | Resolved | `core.md:58`. |
| 7b | `link()` with an unknown node must not panic | Resolved | `ward-001.md:38`. |
| 7c | NaN → error in the ward | Mostly resolved | `ward-001.md:38` lists NaN, but the variant (`TooShort`) is pinned only by the test. NaN speed is listed but untested (finding 6). |
| 7d | 1-lane origin admission limit 0.4 veh/s undocumented | **Open** | Not in "Documented simplifications" (finding 6). |

## Findings

### 1. MAJOR: `rr_next` advancing on completion is undetected, and the bug starves a feeder completely
Contract `core.md:58` ("After a successful **transfer** (not a completion) … `rr_next = (i + 1) mod n`"). Tests:
none (`core_001_physics.rs:552-589` is the only round-robin test, and it has no completing lane).

This was a MINOR in round 2 ("low risk"). I measured it this round, and it is not low risk. Take T12's merge and add
one more in-link `L3` into the merge node `m`, carrying trips whose route **ends** at `m`. That describes every
destination node with through traffic in core-002/003. Implemented in `/tmp/wddref3/probe_rr.py`:

| | f1 (L1) | f2 (L2) | share | total |
|---|---|---|---|---|
| correct | 150 | 150 | 0.500 | 300 |
| `rr_on_completion` | 240 | **0** | **1.000** | 240 |

The result is the same for L3 with 1, 2 or 4 lanes and for L3 spawn rates of 1 per tick or 1 per 2 ticks. The
mechanism: a completion scanned after the last transfer resets `rr_next` to the lane after the completing lane, so
the scan always starts at L1 again. This is exactly the "always favor the same feeder" failure that the contract
paragraph exists to prevent. The bug is also a plausible Gold slip: one `if crossed { rr_next = i + 1 }` covering
both branches produces it. No current test catches it. All 17 pass on the mutant.

**Fix (verified):** extend T12 (or add T18) with a completing in-link whose id lies between the feeders and the
outflow:
```rust
let o3 = b.node(300.0, -300.0);           // after o2, before x
let l3c = b.link(o3, m, 13.9, 1);         // created after l2, before l3/l4  → in-lane order at m: l1, l2, l3c
// each tick:  w.spawn_with_route(vec![l3c]).unwrap();   // trips that END at m
```
Keep the existing assertions. The correct implementation gives total 300 and share 0.500. The mutant gives total
240 and share 1.000, so both assertions fail. Update the ward table row 12 and the comment.

### 2. MINOR: `completed_tick` off-by-one, and other exact-tick rules, pass under the ±2 / +2 s tolerances
`:207-213` (T4, ±2 ticks), `:539-545` (T11, [28.78, 34.25] s). Contract `core.md:59` decides
`completed_tick` = the tick during which the vehicle completes, before the increment. The mutant
`completed_plus1` gives T4 = 206 and T11 = 33.0 s, so it passes everything. The contract is now fully pinned
(exact `>=` forms, DT = 0.5, `speed_factor` = 1), so the results are exact. T4 = 205 ticks and T11 completed
ticks = [65, 75, 85] are the only correct answers. **Fix:** in T11, additionally
`assert_eq!(by_trip.iter().map(|c| c.completed_tick).collect::<Vec<_>>(), vec![65, 75, 85])`. Alternatively
narrow T4 to ±0. Keep the analytic comment as the derivation.

### 3. MINOR: T16 reports the sink mutant as a premise failure, which points Gold to the wrong cause
`:738-739` runs before `:744`. Under `sink_credit`, the slow sink spills back. L1 reaches 172/198, so the test fails
with `"L1 queued: 172"` and never reaches the "credit-limited" message. A Gold author would read this as "my feed is
wrong" rather than "my sink consumes credit". **Fix:** assert `done > 1.3·credit_limited` first. Then assert the
premise with a message such as "L1 queued: {max_l1} (sink too slow? completions must not use credit)".

### 4. MINOR: T17 can pass vacuously
`:765-781`: if `cruising` never becomes true, `slowest_after_cruise` stays `f64::MAX` and the assertion passes.
Also, nothing asserts that the vehicle was ever observed on L2. **Fix:** `assert!(cruising)`. Better still, also
assert the exact travel time (152 ticks; `no_credit_empty` gives 160) or `completed_tick == 152`.

### 5. MINOR: stale comment and ward-table text (round-2 #4 leftovers)
- `core_001_physics.rs:322`: "And L1 was still queued at the end (the window was saturated)". For lanes = 1,
  L1 ends at 13/40 and carries moving traffic. Only the origin buffer (954) is queued. Change the comment to
  "demand still exceeded capacity at the end (origin buffer non-empty)".
- `ward-001.md:58` (row 7): "(standing queue)" is false for lanes = 1. That case measures the 4-lane→1-lane
  entry limit.
- `ward-001.md:63` (row 12) needs updating if finding 1 is fixed. `ward-001.md:53` (row 2) omits negative speed and
  NaN length, which the test covers.

### 6. MINOR: validation and documentation gaps
- Speed `NaN` is required to be rejected (`ward-001.md:38`) but untested. Infinite length or speed is neither
  specified nor tested. `floor(inf / 7.5) as u32` saturates, and `lanes × lane_cap` then overflows `u32`, which
  panics in debug. Add `!is_finite()` → `TooShort` / `InvalidSpeed` to the ward, and one assertion each.
- Round-2 7d is still open. A 1-lane link fed directly by an origin admits at most 1 vehicle per 5 ticks
  (0.4 veh/s < 0.5 sat flow), so `ORIGIN_ADMIT_PER_TICK = 2` never binds for it. Put this in "Documented
  simplifications". core-002 demand calibration will be wrong otherwise.

### 7. MINOR: contract expressions still open to bit-level divergence (determinism-hostile)
- Entry speed `v = min(v', vmax_next)` (`core.md:60`) ignores `speed_factor`, while movement caps at
  `vmax × speed_factor` (`:64`). Under speed factors (core-002), a 0.9 vehicle enters faster than its own cap,
  and implementations will differ on which form to use. Pin it as `min(v', vmax_next × speed_factor)` or state
  the exception.
- Step 6 `v = (s' − s)/DT` is not listed under "Float comparisons", but it is normative. It yields
  `13.900000000000006` on an unclamped cruise in the reference, which is > vmax. A Gold shortcut `v = v'` when
  unclamped is algebraically equal but differs in bits. That matters for `state_hash` (core-003) and native
  vs. WASM. Add to "Float comparisons": `s' = max(s, min(s + v' * DT, limit))`, `v = (s' - s) / DT`,
  `entry_s = min(reach - length, length_next)`, `tail_guaranteed = min(tail.s + v' * DT, limit_now)`, credit
  `min(1.0, credit + 0.25)`. Also tell Gold that `check_invariants` must allow `v ≤ vmax + ε` (or clamp), since
  `v` can exceed vmax by an ulp.
- The order of credit accrual relative to the crossing decision (`credit_late` mutant) is NOT CAUGHT. It shifts
  only the very first possible discharge by one tick, and steady-state headways are identical. Low impact, but it
  changes bits and trip logs. The ward text (`ward-001.md:40`, "at the start of each lane's discharge evaluation")
  is clear, so Gold should follow it.

### 8. MINOR (coverage note): no test has heterogeneous speed limits along a route
All multi-link tests use 13.9 m/s everywhere. A bug that uses the wrong link's vmax (e.g. the upstream link's vmax
after a transfer, or not capping `v` at `vmax_next` on entry) is invisible. Cheap guard: a T11 variant with
L2 at 8.0 m/s. Reference: a lone vehicle completes at tick **85** (vs 65 at 13.9) with max v on L2 = 8.0.

## Reference results (current contract, `/tmp/wddref3/ref.py`, `python3 /tmp/wddref3/scen.py`)

| Test | Assertion(s) | Measured | Result |
|---|---|---|---|
| 1–3 | builder/spawn API | read-through; consistent with ward spec and `NetworkError` variants | OK |
| 4 | travel within ±2 of 205.5 ticks | **205** | PASS |
| 5 | gap ≥ 7.5 − 1e-3; s monotone; lane constant; lanes ascending | no violation in 1500 ticks; 332 completed | PASS |
| 6 | link_count ≤ cap; L2 reaches cap | L2 max 20/20 | PASS |
| 7 | lanes=1: 135 ≤ p ≤ 151; lanes=2: 270 ≤ p ≤ 302; buffer > 0 | **150** (L1 13/40, buffer 954); **300** (L1 77/80, buffer 619) | PASS |
| 8 | L2 full < L1 full ≤ origin ≥ 5; front stopped; L2 ≥ 90 % in ≥ 90 % ticks | 203 < 1362 ≤ 1494; true; 1.000 | PASS |
| 9 | blocked_ticks > 50; no crossing while full; waiting front | 734; 0 violations; true | PASS |
| 10 | conservation every tick; all complete once; twin and clone identical | 1015 spawned, last completion tick 3022; twin identical | PASS |
| 11 | 28.78 s ≤ travel ≤ 34.25 s; created [0,10,20]; exits 3 | 32.5 s × 3; completed ticks **[65, 75, 85]** | PASS |
| 12 | total ≥ 250; share 0.4–0.6 | **300**; **0.500** (150/150) | PASS |
| 13 | crossings ≤ 1 + 0.25 n; > 400 samples; L2 ≥ 10 at end | first exit tick 122; min slack 0 at n = 0; L2 = 19 | PASS |
| 14 | lanes [0,1,0,1]; no lane change | [0,1,0,1] (L2 also [0,1,0,1]) | PASS |
| 15 | 2 admitted, FIFO, at rest; ≤ 2/tick; per-link blocking | as expected; all 10 admitted within 60 ticks | PASS |
| 16 | premise max L1 < 99; done (300..1000) > 227.5 | max L1 **40**/198; done **325** (max L2 36/66) | PASS |
| 17 | completed = 1; slowest after cruise > 5 m/s | completed; slowest **13.0** (acceleration sample); travel **152** ticks; on L2 for 1 tick (s 4.2, v 13.9) | PASS |

All 17 pass on the reference of the current contract.

## Mutation analysis
"Caught by" lists tests that fail on the mutant and pass on the correct reference (`python3 /tmp/wddref3/muts.py`).

| Mutation | Caught by | Notes |
|---|---|---|
| No spacing check on entry | 5, 6, 7, 8, 9, 10, 12, 13, 15 | overlap invariant |
| Tail compared at pre-move position | 6, 7, 8, 9, 12, 16 | T7 lanes=1 → 100; T8 frac 0.007 |
| Credit cap > 1 (4.0) | 13 | "tick +2: 2 crossings" |
| No credit | 6, 7, 8, 9, 13 | T7 lanes=2 → 480 |
| Credit only on non-empty lanes | 17 | slowest 0.0 m/s, travel 160 |
| Lowest-id lane first (no RR) | 7, 8, 12 | T12 share 1.000 |
| RR start = tick mod n | 9, 12 | T12 share 0.170 |
| `rr_next = i` | 7, 8, 12 | T12 share 0.000 |
| `rr_next` advanced on completion | **NOT CAUGHT** | finding 1; with the proposed T12 extension: share 1.000, total 240 |
| Sink completion consumes credit | 16 | fails on the premise line first (finding 3); done = 175 |
| Unlimited origin admission | 15 | 4 admitted in the first tick |
| LIFO admission | 14, 15 | |
| Global head-of-line blocking at origin | 15 | |
| Lane = lowest feasible | 14 | [0,1,0,0] |
| Lane changes on a link (rank-derived lane) | 5, 14 | |
| Lane changes on a link (overtaking into a free gap) | 5 | t = 70 |
| Ignoring downstream capacity/spacing | 5, 6, 7, 8, 9, 10, 12, 13 | |
| Completion without reaching the end | 4, 11 | T4 travel 1 |
| No acceleration limit | 4 | 200 vs 205.5 |
| Admitted at vmax | 4, 15 | |
| No car following | 5, 6, 7, 8, 9, 10, 12, 13 | |
| Transfer places vehicle at s = 0 | 7, 8, 9, 12 | |
| Transfer resets v = 0 | 6, 7, 8, 9, 11, 12, 16, 17 | |
| `completed_tick` + 1 | **NOT CAUGHT** | finding 2 (T4 206, T11 33.0 s) |
| Credit accrued after the crossing decision | **NOT CAUGHT** | finding 7 (low impact) |
| HashMap iteration order | 10 (by analysis) | independently built twin has its own `RandomState` |

## Notes for Gold reviewer
- A correct implementation of the current contract produces these values **exactly** (the contract pins every
  threshold, so no tolerance is needed to explain deviations):
  T4 travel **205** ticks · T7 **150** (lanes=1) / **300** (lanes=2), origin buffer 954 / 619 at the end ·
  T8 L2 full at tick **203**, L1 at **1362**, origin ≥ 5 at **1494**, frac 1.000 · T9 blocked_ticks **734** ·
  T10 spawned **1015**, last completion tick 3022 · T11 **32.5 s** for each trip, completed ticks **65/75/85** ·
  T12 total **300**, share **0.500** (150/150) · T13 first L2 exit at tick **122**, final L2 count 19 ·
  T14 [0,1,0,1] on both links · T16 done **325**, max L1 **40**, max L2 36 · T17 travel **152** ticks.
  If Gold reports different numbers, suspect the implementation (credit order, `rr_next`, the `>=` forms,
  `completed_tick`) before the thresholds.
- Watch for these in the Gold diff: `rr_next` updated in a branch shared by completion and transfer (finding 1,
  untested unless fixed); credit accrued after the decision; any epsilon in `reach >= length` or in the tail test;
  `v = v'` shortcut in movement; `check_invariants` rejecting `v` that exceeds vmax by an ulp
  (`13.900000000000006` occurs); `link()` indexing `nodes[to]` eagerly (T2 requires no panic); `<=` instead of
  `<` for `MIN_LINK_LENGTH` (T15/T17 use exactly 10.0 m links and would panic in `build().unwrap()`).
- The LIFO free list (`core.md:48`) is untested beyond `VehicleId(0)`. It is deterministic either way, but
  core-003 `state_hash` comparisons assume it.
- Reproduce: `python3 /tmp/wddref3/scen.py` · `python3 /tmp/wddref3/muts.py` · `python3 /tmp/wddref3/probe_rr.py`.
