# Review: core-001 — Red gate (round 2)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author and of the round-1 reviewer's code), 2026-10-06.
Inputs read: `livingcity.md`, `.wdd/epics/core.md` (contract at `81d9715`), `.wdd/wards/core/ward-001.md`,
`crates/sim-core/tests/core_001_physics.rs` (16 tests), `crates/sim-core/src/{lib,params,network,world}.rs`,
`.wdd/reviews/core-001-red-1.md`, `git diff c5f5c26 81d9715`.

Method: I wrote a new reference implementation of the **current** contract (spawn, step 4 discharge with
per-lane credits + round robin + `tail_guaranteed` lane choice, step 5 FIFO admission with per-first-link
blocking, step 6 movement, completion) in Python at `/tmp/wddref2/ref.py` (outside the repo; nothing in the
repo was modified). `/tmp/wddref2/scen.py` replays tests 4–16 with the exact networks, spawn schedules,
windows and assertions of the Rust file. `/tmp/wddref2/muts.py` injects the mutations. Probes:
`probe16.py` (test 16 dynamics), `probe_fix.py` (verified fixes), `probe_stand.py` / `probe_merge.py` /
`probe_len.py` (saturation-flow robustness over 200+ random link lengths). Tests 1–3 are pure builder/API
checks and were reviewed by reading only.

## Verdict
REJECTED

## Round-1 findings status

| # | Round-1 finding | Status | Evidence |
|---|---|---|---|
| 1 | BLOCKER: correct impl cannot reach saturation into a 1-lane link; tests 6/7/9/12 fail | **Resolved** | `tail_guaranteed` (core.md:52) compares the tail at post-move time. Reference: T6 L2 reaches 20/20; T7 passes 150 (lanes=1) and 300 (lanes=2); T9 blocked_ticks = 734; T12 total = 300. A standing 1-lane queue into an empty 1-lane link discharges with exactly 4-tick headways for 200/200 random lengths in [230, 600] m (`probe_stand.py`). Merges with random feeder lengths always give 300/1200 ticks (`probe_merge.py`). The smoke-test claim "≈ 30/min" is now consistent with the model. |
| 2 | MAJOR: test 8 passes for the wrong reason (L2 full only transiently) | **Resolved** | New assertion at `core_001_physics.rs:372-374` (L2 ≥ 90 % full in ≥ 90 % of ticks after first fill). Reference: frac = 1.000. Order: L2 at 203, L1 at 1362, origin at 1494. |
| 3 | MAJOR: credit mechanism not isolated | **Resolved** | Test 13 (`:569-595`). Reference: passes with slack 0 at n = 0. The cap-4 mutation fails at "tick +2: 2 crossings". It is the only test that catches cap > 1, and it does catch it. |
| 4 | MAJOR: uncovered rules (lane choice, lane permanence, admission, sink, rr_next) | **Partially resolved** | Admission (test 15) and rr_next = i (tests 7, 8, 12) are now caught. **Not resolved:** lane choice ("furthest ahead") does not discriminate (new finding 2). Lane permanence is checked only in an uncongested symmetric scenario (finding 2). The sink test fails on a correct implementation (finding 1). |
| 5 | MINOR: test 10 relies on self-reported counters | Resolved | `:453-466`: on_network = Σ link_count, log length and uniqueness, ids = 0..spawned. |
| 6 | MINOR: test 9 checks only full-link blocking | Open (acceptable) | Spacing-based blocking is covered by test 5's external overlap check and by `tail_pre_move` being caught by 6/7/8/9/12. |
| 7 | MINOR: no clone/determinism guard | Partially resolved | Clone check added (`:430-485`), but it cannot detect `HashMap` ordering (finding 5). |
| 8 | MINOR: weak assertions (test 1 max(1,…), test 2, test 11) | Mostly resolved | Test 2 adds negative speed and NaN. Test 11's upper bound is 34.25 s (measured 32.5 s). `max(1, …)` is still unreachable because MIN_LINK_LENGTH = 10 (harmless). |

## Findings

### 1. BLOCKER: test 16 fails on a correct implementation and cannot catch the mutation it exists for
`crates/sim-core/tests/core_001_physics.rs:686-710` (spawn `:697-699`, assertion `:709`).

The premise "free-flowing 3-lane traffic into a 1-lane final link" is false under the contract. The demand is 1 veh/tick. Origin admission into 3 lanes from rest is 3 lanes × 1 per 5 ticks = 0.6 veh/tick, and the L1→L2 entry into a single lane is limited to 0.25 veh/tick (the same kinematics that give saturation flow). L1 therefore fills completely (198/198 from about tick 550). The origin buffer grows to 421, and for the whole window L2 receives one vehicle every 4 ticks (`probe16.py`: headway histogram {4: 226, 2: 2, 5: 2}). Completions are capped by L2's **inflow**, not by any sink rule.

Reference result: `done = 175`, needed `> 227.5`, so the test **FAILS**. 175 is exactly the "credit-limited" number the test is meant to rule out. The `sink_credit` mutation also gives 175, so the test is useless as a discriminator even if its threshold were lowered.

**Fix (verified in `probe_fix.py`):** spawn every second tick (`if t < 800 && t % 2 == 0`), and keep the 300..1000 window and the `> 1.3 × 175` assertion. Results: correct implementation 325 (ratio 1.86), max L1 = 40/198, max L2 = 36/66. `sink_credit` mutation: 175 (ratio 1.00), L2 fills to 66/66. Also assert the premise, for example `link_count(l1) < capacity(l1) / 2` every tick, so that a later regression to a queued feeder fails loudly instead of silently testing something else. Add the derivation to the comment: admission 0.5 veh/tick < 0.6 and < 1-lane moving-entry rate, so L2 receives about 0.5 veh/tick and a sink limited to 0.25/tick would visibly queue.

### 2. MAJOR: test 14 does not test the lane-choice rule it names, and lane permanence is checked only where no lane change can plausibly happen
`core_001_physics.rs:599-628` (spawn `:608-610`, assertion `:627`); contract `core.md:51`.

All four vehicles are spawned at tick 0, so they enter in pairs with identical trajectories. When trip 2 enters, both lane tails are at exactly the same position. "Furthest-ahead tail" and "lowest feasible lane" then give the same answer (tie goes to the lowest), and the expected `[0, 1, 0, 1]` is produced by both. Reference: the mutation `lowest_lane` (pick the lowest feasible lane) passes all 16 tests (T16 aside).

Lane permanence is asserted only in this 4-vehicle uncongested scenario, where nothing would ever change lanes. A plausible bug that derives `lane` from rank order (`lane = rank mod lanes`) passes test 14, because the pairs stay symmetric. It is NOT CAUGHT by any test. Adding the same lane-constancy check to test 5's congested 3-lane run catches it immediately (50,513 lane flips in the reference, 0 for the correct implementation).

**Fix (verified):** spawn trips 0 and 1 at tick 0, trip 2 at tick 5 and trip 3 at tick **12**. Use 12, not 10: at tick 10 lane 0 is feasible only by exact equality, 7.5 ≥ 7.5. Expected `[0, 1, 0, 1]`; `lowest_lane` gives `[0, 1, 0, 0]`. Also add a `(trip_id, link) → lane` constancy check to test 5 (and optionally test 8).

### 3. MINOR: two explicitly decided contract rules have no test
- "Credit accrues **every tick, including empty lanes**" (`core.md:58`): the mutation `no_credit_empty` passes all tests. Suggested test: a lone vehicle at 13.9 m/s crossing a 10 m 1-lane link between two long links. Under the contract it crosses the short link in the next tick (banked credit 1.0). Under the mutation it waits 3 ticks at the stop line and has to re-accelerate. Assert travel time within ±1 tick of the analytic value, as in test 4.
- "rr_next advances on a **transfer** (not a completion)": the mutation `rr_on_completion` passes all tests. It needs a node where one in-lane completes and another transfers. Low risk now, but core-002's city has such nodes.

### 4. MINOR: comments that describe a different mechanism from the one the test exercises
- `:288-289` (test 7): "fed faster than L1 can discharge, so L1 holds a standing queue". For `lanes = 1` this is false. L1 ends at 13/40 and carries moving traffic. The 150 exits are set by the 4-lane→1-lane **entry** limit at node a, not by L1's discharge credit (`no_credit` still passes the lanes=1 half; it is caught only by lanes=2, where L1 = 77/80). The proxy `origin_buffer_len(o) > 0` at `:320` does not show that L1 was queued. Either correct the comment or assert `link_count(l1) ≥ 0.8·cap` for lanes = 2 only.
- `:531` (test 12): "congested 1-lane link". L3 holds 6/13 and is not congested; the feeders are. This doesn't affect the result (share 0.500, total 300), but the comment misleads Gold.

### 5. MINOR: the clone check in test 10 cannot detect HashMap iteration order
`:430-485`. `HashMap::clone` copies its `RandomState`, so a clone iterates in the same order as the original and the comparison passes even with `HashMap` iteration in the tick. Add a second world built independently (`World::new` on a second `NetworkBuilder` run) and compare its `completed_log()` with the first one's. Two `RandomState`s differ within one process, so this does catch order dependence. core-003 owns determinism, but this ward's Must-NOT forbids `HashMap`, and this is the cheapest guard.

### 6. MINOR: discrete outcomes hinge on exact float equalities; the contract should fix the expression
The 4-tick saturation headway depends on `reach ≥ length` holding with equality (follower: `(len − 7.5) + 0.5 + 1 + 1.5 + 2 + 2.5 == len`) and on `tail_guaranteed ≥ entry_s + 7.5` holding with equality (7.5 ≥ 0 + 7.5, 10.5 ≥ 3 + 7.5). The reference shows this is robust in IEEE f64 for random lengths. But an algebraically equivalent rewrite in Gold (`tail_g − entry_s ≥ JAM_SPACING`, or `length − s ≤ v'·DT`) can flip outcomes in non-half-integer cases and silently change capacity (5-tick headway = −20 %). Pin the exact comparison forms in core.md (and forbid an epsilon there), so native and WASM, and future refactors, agree.

### 7. MINOR: remaining contract ambiguities (none of them affects these tests)
- Step 4: the scan "starts at `rr_next` and wraps once". Say explicitly that updating `rr_next` mid-scan does not re-start or shift the current scan (the reference assumes a fixed scan).
- `link()` with an unknown node must not panic. Test 2 (`:83-88`) requires `build()` to return `UnknownNode`, so Euclidean length has to be computed lazily or guarded. Mention this in the ward spec so Gold does not index `nodes[99]`.
- NaN length → `TooShort` (`:117-122`) is decided only by the test. Write it into the ward validation list.
- A 1-lane link fed directly by an origin admits at most 1 vehicle per 5 ticks (0.4 veh/s) from rest. `ORIGIN_ADMIT_PER_TICK = 2` is never binding for 1-lane links. That is fine, but core-002 demand calibration should know (document it under simplifications).

## Reference-implementation results (current contract, `/tmp/wddref2/ref.py`)

| Test | Assertion(s) | Measured | Result |
|---|---|---|---|
| 1–3 | builder/spawn API | reviewed by reading; expectations consistent with ward spec | OK |
| 4 | travel within ±2 of 205.5 ticks | 205 | PASS |
| 5 | gap ≥ 7.5 − 1e-3, s monotone | no violation over 1500 ticks; 332 completed | PASS |
| 6 | link_count ≤ cap; L2 reaches cap | L2 max 20/20 | PASS |
| 7 | lanes=1: 135 ≤ p ≤ 151; lanes=2: 270 ≤ p ≤ 302 | 150 (L1 13/40, buffer 954); 300 (L1 77/80, buffer 619) | PASS |
| 8 | L2 full < L1 full ≤ origin ≥ 5; front stopped; L2 ≥ 90 % in ≥ 90 % ticks | 203 < 1362 ≤ 1494; true; 1.000 | PASS |
| 9 | blocked_ticks > 50; no crossing while full; waiting front seen | 734; 0 violations; true | PASS |
| 10 | conservation every tick; all complete once; clone identical | 1015 spawned, all completed by tick 3022 | PASS |
| 11 | 28.78 s ≤ travel ≤ 34.25 s; created [0,10,20] | 32.5 s × 3 | PASS |
| 12 | total ≥ 250; share 0.4–0.6 | 300; 0.500 (150/150) | PASS |
| 13 | crossings ≤ 1 + 0.25 n; > 400 samples; L2 ≥ 10 at end | first exit at tick 122; min slack 0 (n = 0); L2 = 19 | PASS |
| 14 | lanes [0,1,0,1]; no lane change | [0,1,0,1]; L2 also [0,1,0,1] | PASS (but non-discriminating, finding 2) |
| 15 | 2 admitted, FIFO, at rest; ≤ 2/tick; per-link blocking | as expected; all 10 admitted by tick 60 | PASS |
| 16 | completions over ticks 300..1000 > 227.5 | **175** (L1 198/198, buffer 421) | **FAIL** (finding 1) |

## Mutation analysis
"Caught" lists tests that fail on the mutant and pass on the correct reference. T16 is excluded because it fails on the correct reference.

| Mutation | Caught by | Notes |
|---|---|---|
| No spacing check on entry | 5, 6, 7, 8, 9, 10, 12, 13, 14, 15 | test 5's external overlap check is the decisive one |
| Tail compared at pre-move position (round-1 rule) | 6, 7, 8, 9, 12 | e.g. T7 lanes=1 → 100, T8 frac 0.007 |
| Credit cap 4.0 instead of 1.0 | 13 | only T13; adequate |
| No credit at all | 6, 7, 8, 9, 13 | T7 lanes=2 → 480 |
| Credit only on non-empty lanes | **NOT CAUGHT** | finding 3 |
| Lowest-id lane first (no round robin) | 7, 8, 12 | T12 share 1.000 |
| Round robin start = tick mod n | 9, 12 | T12 share 0.170 |
| rr_next = i instead of i + 1 | 7, 8, 12 | T12 share 0.000 |
| rr_next also advanced on completion | **NOT CAUGHT** | finding 3 |
| Sink completion consumes credit | **NOT CAUGHT** | T16 broken; with the proposed fix: caught (175 vs 325) |
| Unlimited origin admission | 15 | |
| Non-FIFO (LIFO) admission | 14, 15 | |
| Global head-of-line blocking at origin | 15 | |
| Lane choice = lowest feasible lane | **NOT CAUGHT** | finding 2; proposed T14 fix catches it |
| Lane changes on a link (lane derived from rank) | **NOT CAUGHT** | finding 2; constancy check in T5 catches it |
| Lane change into a free gap in an adjacent lane | **NOT CAUGHT** | the mutant almost never fires (lane choice keeps lanes balanced); constancy check in T5/T8 is the guard |
| Discharge ignores downstream capacity/spacing | 5, 6, 7, 8, 9, 10, 12, 13 | |
| Completion without reaching the end | 4, 11 | |
| No acceleration limit | 4 | travel 200 vs 205.5 |
| Admitted at vmax instead of v = 0 | 4, 15 | |
| No car following | 5, 6, 7, 8, 9, 10, 12, 13 | |
| HashMap iteration order | **NOT CAUGHT** | finding 5 (by analysis; clone shares RandomState) |

## Notes for Gold reviewer
- The round-1 contract inconsistency is genuinely fixed. `tail_guaranteed` gives exact 4-tick headways for standing 1-lane queues into empty 1-lane links, for every length I tried. 1-lane chains and merges carry 0.25 veh/tick. Once tests 14 and 16 are fixed, Green should match these numbers **exactly** (T7: 150 / 300, T12: 300 with share 0.5, T4: 205, T11: 32.5 s). If Gold reports other values, suspect the implementation, not the thresholds.
- Watch for these rewrites in Gold: (a) any epsilon in `reach ≥ length` or in the tail comparison (finding 6); (b) credit accrual placed after the crossing check, or skipped on empty lanes (untested, finding 3); (c) `rr_next` updated on completions (untested); (d) `link()` panicking on an unknown node.
- Test 7 lanes=1 measures the 4-lane→1-lane entry limit, not L1's discharge credit. The credit is pinned by T7 lanes=2 and T13.
- A plain 1-lane origin link admits only 0.4 veh/s. That will matter for core-002 demand on 1-lane origin links.
- Reproduce with: `python3 /tmp/wddref2/scen.py` (all scenarios), `python3 /tmp/wddref2/muts.py` (mutation table), `python3 /tmp/wddref2/probe_fix.py` (verified fixes for tests 14 and 16).
