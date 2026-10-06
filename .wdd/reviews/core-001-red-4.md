# Review: core-001 — Red gate (round 4)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.
Inputs read: `.wdd/epics/core.md` (at `3dd053c`), `.wdd/wards/core/ward-001.md`,
`crates/sim-core/tests/core_001_physics.rs` (18 tests), `crates/sim-core/src/{lib,params,network,world}.rs`,
`.wdd/reviews/core-001-red-{1,2,3}.md`, `git diff d34c1e9 3dd053c`.
`cargo test -p sim-core --test core_001_physics`: compiles; 0 passed / 18 failed on `todo!()` (expected for Red).

Method: I copied the round-3 Python reference to `/tmp/wddref4/` (outside the repo; the repo is unchanged except for
this file). I re-checked `ref.py` line by line against the current contract: credit `min(1.0, credit + 0.25)` at the
start of each lane's evaluation, scan order fixed at scan start, `rr_next` only on transfer, `tail_guaranteed` with
both its `moved` and `limit_now` clauses, exact `>=` forms, entry `v = min(v', vmax_next)` (speed_factor = 1),
`s' = max(s, min(s + v'·DT, limit))`, `v = (s' − s)/DT`, completion without credit, `completed_tick` before the
increment. I found no deviation. Then I updated `scen.py` to the current tests: T11 exact `[65, 75, 85]`, T12 with
`o3` created after `y` and `l3c` created after `l4` (link id 4, so the in-lane order at `m` is l1, l2, l3c), T16
asserting completions before the premise, T17 `assert!(cruising)` and exact 152, and the new T18. I added mutants in
`muts.py` (`entry_v_ignore_next`) and in `extra_muts.py` (15 more, applied as source patches), plus probes
(`probe_clamp.py`, `fuzz_tg.py`, `grid_tg.py`, `probe_misc.py`). Tests 1–3 are pure builder and API checks, so I
reviewed them by reading only.

## Verdict
REJECTED

## Prior findings status (round 3)

| # | Round-3 finding | Status | Evidence |
|---|---|---|---|
| 1 | MAJOR: `rr_next` on completion undetected (feeder starvation) | **Resolved** | `core_001_physics.rs:587-598`. `l3c` is now link 4, last in the in-lane order, not between the feeders as proposed. I re-measured it in this order. Correct: total **300**, share **0.500** (150/150), 350 completions on l3c. `rr_on_completion`: total **240**, share **1.000** (240/0). Both T12 assertions fail. |
| 2 | MINOR: `completed_tick + 1` passes | **Resolved** | `:558` exact `[65, 75, 85]`. The mutant is now caught by T11 (66/76/86), T17 (153) and T18 (86). |
| 3 | MINOR: T16 reports the sink mutant as a premise failure | **Resolved** | `:768` (completions) now runs before `:770` (premise). `sink_credit` fails on "completions 175 look credit-limited". |
| 4 | MINOR: T17 can pass vacuously | **Resolved** | `:807` `assert!(cruising)`, `:810` travel `== 152`. |
| 5 | MINOR: stale comments and ward text | **Partially resolved** | Ward rows 7, 11, 12, 17 and 18 are fixed. Still open: `:341` "L1 was still queued at the end", which is false for lanes = 1 (L1 13/40, moving). Ward row 2 (`ward-001.md:53`) still omits negative speed, NaN and infinite values, which `:110-140` test (finding 4). |
| 6 | MINOR: validation and documentation gaps | **Resolved** | `core.md:42` states "finite length / finite speed". `:123-140` test NaN speed and infinite speed and length. The 0.4 veh/s limit for a 1-lane origin is documented in step 5 (`core.md:63`). |
| 7 | MINOR: contract expressions open to bit divergence | **Mostly resolved** | Entry speed `× speed_factor` (`core.md:60`), `v = (s' − s)/DT` with a 1e-9 allowance, and the credit order are pinned (`core.md:105`). Still open: step 6 says `clamp(...)`, and there is no spacing tolerance (finding 3). |
| 8 | MINOR: no heterogeneous speed limits | **Resolved** | New T18 (`:815-836`). It catches `entry_v_ignore_next` (13.9 m/s on the 8 m/s link) and `move_vmax_wrong_link` (completes at tick 104). |

## Findings

### 1. MAJOR: neither guard clause of `tail_guaranteed` is tested, and dropping either one lets vehicles overlap in ordinary merges
Contract `core.md:52` (Vehicles, `tail_guaranteed`): "if the tail is already marked moved this tick, `tail.s`; else
`min(tail.s + v'_tail × DT, limit_now)`". This rule is the round-1 BLOCKER fix. All 18 tests pass with the two
mutants below. Both mutants then break the core no-overlap invariant on simple two-feeder merges:

| Mutant (plausible Gold slip) | 18 tests | Random merge fuzz (`fuzz_tg.py`, 150 seeds) | Deterministic grid (`grid_tg.py`, 96 configs) |
|---|---|---|---|
| `tg_ignore_moved`: project a tail that entered **this tick** forward again (forgets the `moved` flag) | all pass | overlap in 1 seed | overlap in **24/96** configs |
| `tg_no_limit`: `tail.s + v'·DT` without `min(…, limit_now)` (assumes the tail is never blocked) | all pass | overlap in 4 seeds | overlap in **6/96** configs |

The correct reference has zero overlaps in all 96 grid configs. These merges are what the city consists of: two
feeders, one of them free-flowing, into a short link. The current tests cannot see the bug because their merges
(T10, T12) feed **stopped** fronts, which enter at `entry_s = 0.5` with v = 1. There, `v'·DT` is too small for either
clause to matter. With 13.9 m/s, `v'·DT = 6.95 < 7.5`, so the bug appears only when moving vehicles from two in-lanes
arrive within a few ticks of each other. Gold would not see it until a core-005 city run trips `check_invariants`
(hard to diagnose there). If Gold's `check_invariants` is lax, the overlaps would go unnoticed entirely.

**Fix (verified):** add T19 `tail_guaranteed_prevents_overlap_at_moving_merges`. Run two deterministic configs, and
check every tick with an independent T5-style gap check (`s_leader − s_follower ≥ 7.5 − 1e-3` per lane via
`link_vehicles`, not only `check_invariants`):
```rust
// oa=(0,0), ob=(0,100), m=(1000,0), x=(1000+lm_len,0), y=(2500,0)
// la = link_with_length(oa, m, fa_len, 13.9, 2); lb = link_with_length(ob, m, fb_len, 13.9, 1)
// lm = link(m, x, 8.0, lm_lanes);                ly = link(x, y, 13.9, 1)
// for t in 0..1200 { if t < 900 { if t % pa == 0 { spawn [la,lm,ly] } if t % pb == 0 { spawn [lb,lm,ly] } } step + gap check }
// case A (fa, fb, lm_len, lm_lanes, pa, pb) = (200.0, 100.0, 30.0, 1, 1, 2)  → catches tg_ignore_moved (overlap at t=36)
// case B                                     = (300.0, 205.0, 30.0, 2, 2, 2)  → catches tg_no_limit     (overlap at t=67)
```
Neither case catches both mutants (I searched the grid: the intersection is empty), so keep both. Add a row to the
ward table, and set `estimated_tests: 19`.

### 2. MINOR: an admission limit counted per first link instead of per origin passes
Contract `core.md:63` ("up to `ORIGIN_ADMIT_PER_TICK` per origin per tick"). `admit_limit_per_link` passes all 18
tests. No test has an origin with more than 2 admissible vehicles spread over two first links in one tick. It
matters for multi-link origins on ≥ 3-lane links in the city. **Fix:** in T15 part 2 (`:729-736`), spawn a fourth
vehicle `Z2` for `wide`. Correct: `short = [0]`, `wide = [2]`, buffer 2. The mutant gives `wide = [2, 3]`, buffer 1.

### 3. MINOR: step 6 `clamp` form can panic in Rust, and spacing has no tolerance
`core.md:64`: `s' = clamp(s + v'×DT, s, limit)`. Rust `f64::clamp(min, max)` **panics if min > max**. That can happen
by one ulp. A vehicle that enters by exact equality (`tail_guaranteed == entry_s + 7.5`) gets
`limit = fl(fl(entry_s + 7.5) − 7.5)` next tick, which can be below `entry_s`. Example:
`fl(fl(0.1 + 7.5) − 7.5) = 0.09999999999999964 < 0.1`. The same rounding can make a gap 7.5 − 1 ulp, which fails a
strict `check_invariants` spacing check. My probe saw no such case in the 18 scenarios (min gap exactly 7.5, never
limit < s), so the risk is in the city, not the tests. **Fix:** pin `s' = max(s, min(s + v' * DT, limit))` in
"Float comparisons", and state that invariant checks allow gaps ≥ `JAM_SPACING − 1e-9`, as already done for speed.

### 4. MINOR: stale comment and ward text (round-3 #5 leftovers)
- `core_001_physics.rs:341`: change "And L1 was still queued at the end (the window was saturated)" to "And demand
  still exceeded capacity at the end (origin buffer non-empty)".
- `ward-001.md:53` (row 2): add "negative/NaN/infinite speed, NaN/infinite length".

### 5. MINOR (notes): undetected but equivalent or low-impact mutants
- `credit_late`: credit is identical after tick 3. In both versions the credit at decision time is
  `min(1, post-decision credit of the previous tick + 0.25)`. A vehicle admitted at rest cannot reach a ≥ 10 m stop
  line before tick 4. So this mutant is **equivalent** in core-001. The contract pins the order anyway.
  `sink_gated` (completion needs credit ≥ 1 but does not consume it) is likewise equivalent after the first ticks.
- `entry_s_nocap` and "crossed vehicle eligible again" cannot be observed while `vmax·DT < MIN_LINK_LENGTH`
  (vmax < 20 m/s). If the city epic adds links ≥ 72 km/h, add a test with a 10 m link after a fast link.
- `empty_as_length` (an empty lane ties with a tail at the stop line, and the tie goes to the lower index) and
  `rr_next` advanced when the front waits for credit: not caught, low impact.
- `check_invariants` is never tested negatively. Only T5 independently checks spacing, and finding 1 adds a second
  check. The Gold reviewer must read `check_invariants` itself.

## Reference results (current contract, `python3 /tmp/wddref4/scen.py`)

| Test | Assertion(s) | Measured | Result |
|---|---|---|---|
| 1–3 | builder/spawn API | read-through; consistent with contract `core.md:42` and `NetworkError` variants | OK |
| 4 | travel within ±2 of 205.5 | **205** | PASS |
| 5 | gap ≥ 7.5 − 1e-3; s monotone; lane constant; lanes ascending | no violation; 332 completed | PASS |
| 6 | link_count ≤ cap; L2 reaches cap | L2 max 20/20 | PASS |
| 7 | lanes=1: 135 ≤ p ≤ 151; lanes=2: 270 ≤ p ≤ 302; buffer > 0 | **150** (L1 13/40, buffer 954); **300** (L1 77/80, buffer 619) | PASS |
| 8 | L2 full < L1 full ≤ origin ≥ 5; front stopped; frac ≥ 0.9 | 203 < 1362 ≤ 1494; true; 1.000 | PASS |
| 9 | blocked_ticks > 50; no crossing while full; waiting front | 734; 0 violations; true | PASS |
| 10 | conservation; all complete once; twin and clone identical | 1015 spawned, last completion tick 3022; identical | PASS |
| 11 | completed ticks == [65,75,85]; 28.78 ≤ travel ≤ 34.25 s; exits 3 | **[65, 75, 85]**; 32.5 s × 3 | PASS |
| 12 | total ≥ 250; share 0.4–0.6 (l3c in-lane last) | **300**; **0.500** (150/150); l3c completions 350 | PASS |
| 13 | crossings ≤ 1 + 0.25 n; > 400 samples; L2 ≥ 10 | first exit at loop tick 122; min slack 0 at n = 0; L2 = 19 | PASS |
| 14 | lanes [0,1,0,1]; no lane change | [0,1,0,1] (L2 also [0,1,0,1]) | PASS |
| 15 | 2 admitted FIFO at rest; ≤ 2/tick; per-link blocking | as expected; all 10 admitted within 60 ticks | PASS |
| 16 | done > 227.5, then premise max L1 < 99 | done **325**; max L1 **40**/198 (max L2 36/66) | PASS |
| 17 | completed; cruising; travel == 152; slowest > 5 | travel **152**; slowest 13.0; on L2 one tick (tick 79: s 4.2, v 13.9) | PASS |
| 18 | v on L2 ≤ 8 + 1e-9; completed_tick == 85 | **85**; max v on L2 8.0 | PASS |

All 18 pass on the reference. Across all scenarios: min in-lane gap exactly 7.5, never `limit < s` in movement, max
`v − vmax` = 9.1e-14 (`probe_clamp.py`).

## Mutation analysis
"Caught by" lists tests that fail on the mutant and pass on the correct reference (`muts.py`, `extra_muts.py`,
`probe_misc.py`).

| Mutation | Caught by | Notes |
|---|---|---|
| No spacing check on entry | 5, 6, 7, 8, 9, 10, 12, 13, 15 | overlap |
| Tail compared at pre-move position | 6, 7, 8, 9, 12, 16 | T7 lanes=1 → 100 |
| `tail_guaranteed` ignores `moved` flag | **NOT CAUGHT** | finding 1 (grid 24/96 overlap) |
| `tail_guaranteed` ignores `limit_now` | **NOT CAUGHT** | finding 1 (grid 6/96 overlap) |
| Credit cap > 1 (4.0) | 13 | |
| No credit | 6, 7, 8, 9, 13 | T7 lanes=2 → 480 |
| Credit only on non-empty lanes | 17 | travel 160, slowest 0.0 |
| Credit added after decision | NOT CAUGHT | equivalent mutant in core-001 (finding 5) |
| Credit per link instead of per lane | 6, 7, 8, 9, 16 | T7 lanes=2 → 143 |
| Lowest-id-first (no RR) | 7, 8, 12 | T12 share 1.000 |
| RR start = tick mod n | 9, 12 | T12 share 0.660 |
| `rr_next = i` | 7, 8, 12 | T12 share 0.000 |
| `rr_next` advanced on completion | **12** | total 240, share 1.000 |
| `rr_next` advanced when blocked by space | 7, 8, 12 | |
| `rr_next` advanced when waiting for credit | NOT CAUGHT | low impact (finding 5) |
| Sink consumes credit | 16 | done 175 |
| Sink gated on credit (not consumed) | NOT CAUGHT | equivalent after the first ticks |
| Unlimited origin admission | 15 | 4 admitted in the first tick |
| Admission limit per first link | **NOT CAUGHT** | finding 2 |
| LIFO admission | 14, 15 | |
| Global head-of-line blocking at origin | 15 | |
| Lane = lowest feasible | 14 | [0,1,0,0] |
| Lane tie → highest index | 14 | [1,0,1,0] |
| Empty lane valued as link length | NOT CAUGHT | low impact |
| Lane changes on link (rank-derived) | 5, 14 | |
| Lane changes on link (overtaking into gap) | 5 | t = 70 |
| Lane changes on link (rebalance to lane 0) | NOT CAUGHT | fires about once in all scenarios; covered by the two variants above |
| Ignoring downstream capacity | 5, 6, 7, 8, 9, 10, 12, 13 | |
| Completion without reaching end | 4, 11, 17, 18 | |
| `completed_tick + 1` | 11, 17, 18 | [66,76,86]; 153; 86 |
| No acceleration limit | 4, 11, 17, 18 | T11 [58,68,78] |
| Admitted at vmax | 4, 11, 15, 17, 18 | |
| Transferred/admitted vehicles also move in step 6 | 11, 15, 17, 18 | T11 [63,73,83] |
| Entry speed ignoring next link's limit | 18 | 13.9 m/s on the 8 m/s link |
| Movement uses the wrong link's vmax | 18 | completes at tick 104 |
| Strict `>` for crossing | 7, 8, 9, 12 | |
| Strict `>` for lane feasibility | 7, 8, 9, 12 | |
| Transfer at s = 0 / v = 0 | 7, 8, 9, 12, 17, 18 / 6, 7, 8, 9, 11, 12, 16, 17, 18 | |
| `entry_s` not capped at next length | NOT CAUGHT | cannot be observed at vmax < 20 m/s |
| No car following | 5, 6, 7, 8, 9, 10, 12, 13 | |

## Notes for Gold reviewer
- A correct implementation of the current contract produces exactly: T4 travel **205** ticks · T5 332 completed ·
  T6 L2 max 20/20 · T7 **150** (lanes=1, L1 13/40, buffer 954) / **300** (lanes=2, L1 77/80, buffer 619) ·
  T8 L2 full at tick **203**, L1 at **1362**, origin ≥ 5 at **1494**, frac 1.000 · T9 blocked_ticks **734** ·
  T10 spawned **1015**, last completion tick 3022 · T11 completed ticks **65/75/85** (32.5 s each) ·
  T12 total **300**, f1/f2 **150/150**, share **0.500** · T13 first L2 exit at loop tick **122**, final L2 count 19 ·
  T14 [0,1,0,1] on both links · T15 all 10 admitted within 60 ticks · T16 done **325**, max L1 **40**, max L2 36 ·
  T17 travel **152** ticks, slowest after cruise 13.0 · T18 completed tick **85**, max v on L2 8.0.
  If Gold's numbers differ, suspect the implementation first (credit order, `rr_next`, `>=` forms,
  `tail_guaranteed` clauses, entry speed, `completed_tick`), not the thresholds.
- Read `tail_guaranteed` in the Gold diff line by line against `core.md:52`, both the `moved` short-circuit and the
  `min(…, limit_now)`. Until T19 exists, no test protects either clause (finding 1).
- Watch for `f64::clamp` in movement (panics on `min > max` by an ulp; finding 3), a strict `gap >= 7.5` in
  `check_invariants`, `check_invariants` that is weaker than T5 (it is never negatively tested), and `link()` that
  indexes `nodes[to]` eagerly (T2 requires no panic).
- The LIFO free list (`core.md:48`) is still untested beyond `VehicleId(0)`. core-003 `state_hash` relies on it.
- Reproduce: `python3 /tmp/wddref4/scen.py` · `python3 /tmp/wddref4/muts.py` · `python3 /tmp/wddref4/extra_muts.py` ·
  `python3 /tmp/wddref4/grid_tg.py` · `python3 /tmp/wddref4/probe_misc.py`.
