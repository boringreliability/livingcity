# Review: core-001 — Red gate (round 1)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.
Inputs read: `livingcity.md` (Simulation model, Verification), `.wdd/epics/core.md` (model contract),
`.wdd/wards/core/ward-001.md`, `crates/sim-core/tests/core_001_physics.rs`, `crates/sim-core/src/{lib,params,network,world}.rs`.
`cargo test -p sim-core --no-run`: compiles.

Method: besides doing the arithmetic by hand, I wrote a throwaway reference implementation of contract
steps 4–6 (discharge with per-lane credits + round robin, origin admission, movement) in Python
(`/tmp/wddref/ref.py`, outside the repo; nothing in the repo was modified) and ran every scenario from
the test file through it, then injected the mutations listed below. The hand calculation for test 4
matches the reference exactly (205 ticks vs. analytic 205.5), which gives some confidence that the
reference is faithful.

## Verdict
REJECTED

## Findings

### 1. BLOCKER: a correct implementation of the contract cannot reach saturation flow into a 1-lane link. Tests 6, 7, 9 and 12 fail on it
`crates/sim-core/tests/core_001_physics.rs:304-305` (test 7), `:508` (test 12), `:384` (test 9), `:268` (test 6); root cause in `.wdd/epics/core.md` step 4 (line 57-61).

The contract says "with ACCEL = 2 m/s² a standing lane queue discharges with exactly 4-tick (2 s) headways, i.e. at saturation flow". That holds only for the **upstream** side. On the downstream side, the lane-choice rule requires `last.s ≥ entry_s + JAM_SPACING`. A vehicle crossing from a standing front has `v' = 1`, `reach = len + 0.5` and enters at `entry_s = 0.5` with `v = 1`, marked moved. Its later positions are 1.5, 3.0, 5.0, 7.5 and 10.5. The next standing front needs `tail ≥ 8.0`, which first holds at the discharge of tick t+6. **The headway into a 1-lane link fed from a standing queue is therefore 6 ticks, which gives 0.333 veh/s = 1200 veh/h, not 1800.** No credit setting changes this, because the limit is kinematic.

Results from the faithful reference:

| Test | Assertion | Reference result | Outcome |
|---|---|---|---|
| 7, lanes=1 | 135 ≤ passed ≤ 151 | passed = **100** (L1 never queues, max 9/40 vehicles; L0 is the jammed link) | FAIL |
| 7, lanes=2 | 270 ≤ passed ≤ 302 | passed = **232** | FAIL |
| 12 | total ≥ 250 | total = **200** (l3→l4 is 1-lane→1-lane), share = 0.50 | FAIL |
| 9 | blocked_ticks > 50 | L2 (cap 13) never exceeds **4** vehicles, blocked_ticks = **0** | FAIL |
| 6 | bottleneck reaches capacity | L2 max **5/20** | FAIL |
| 8 | spillback order | passes, but L2 is ≥ 95 % full only transiently (t=203). At equilibrium L2 holds 4/20 and the binding constraint is the L1→L2 *entry*, not L2's discharge | passes for the wrong reason (see #2) |

The comment at test 7 line 276 ("fed faster than L1 can discharge, so L1 holds a standing queue") is false under the contract. So is the smoke-test claim "≈ 30 per minute for the 1-lane bottleneck" (`ward-001.md`, Manual Smoke Test): the contract gives about 20 per minute.

Changing the initial credit (0 vs. 1) or the credit accrual rule does not change any of these numbers.

**Fix.** The author has to decide this at contract level (Must DO: "if an ambiguity is found, update the contract"), and then re-derive the thresholds. Options:
- (a) Accept the 1200 veh/h single-lane effective capacity, document it as a simplification, and rewrite tests 6/7/9/12 to the real numbers (e.g. 1-lane → 1-lane ≈ 1/6 veh/tick).
- (b) Change the entry rule so it does not throttle below `SAT_FLOW` (e.g. compare the tail against `JAM_SPACING` only, with no `entry_s` term, and let the entering vehicle keep `v'`). Then verify again that 4-tick headways are reachable. Note that from standstill the tail is only at 5.0 m after 3 movement ticks, so (b) still needs a further change to the rule.
- (c) Keep the contract and redesign the scenarios so that the measured link discharges into **multi-lane** downstream links and is itself fed by moving traffic. That fix is fragile and hides the real capacity of every 1-lane→1-lane connection in the city.

Whichever option is chosen, each scenario's expected numbers need a worked derivation in the test comment.

### 2. MAJOR: test 8 does not test what its row claims (bottleneck at capacity drives spillback)
`core_001_physics.rs:313-352`. Under the contract the 1-lane L2 is full only during the start-up transient, while traffic still arrives moving. After that, L2 drains to about 4/20 and the queue sits on L1 because of the entry kinematics from finding #1. The order assertion `a < b ≤ c` happens to hold, but the scenario is not "L2 saturated → L1 fills". Small parameter changes flip it: with spawn every 2 ticks instead of 3, L2 never fills (that is the test 6/9 result).

**Fix.** After resolving #1, rebuild the scenario so the bottleneck is a link whose discharge is the binding constraint. Also assert that L2 **stays** ≥ 95 % full (for example in ≥ 80 % of the ticks after `t_l2_full`) while L1 fills. That turns spillback into a sustained property, not a one-tick event.

### 3. MAJOR: the discharge-credit mechanism is not isolated by any test. Credits and kinematics are indistinguishable in the chosen scenarios
`core_001_physics.rs:272-309`. Even if #1 is fixed, a standing queue yields 4-tick headways from kinematics alone, so the credit accumulator (0.25/tick, cap 1.0) is never the binding constraint in a standing-queue test. Mutation "credit cap 4.0 instead of 1.0" is caught by no valid test (reference: test 8 still passes; test 6's failure is from #1). Only a mechanism that makes the queue disappear entirely is caught today.

**Fix.** Add a test where a **moving** platoon (vehicles at vmax with about 7.5 m spacing, created by a long 4-lane feeder or by letting a blocked queue release) reaches an idle node whose lane has been empty for a long time. Assert that at most `1 + 0.25·n` vehicles cross in n ticks, and that the second crossing happens 4 ticks after the first, not 1–2 ticks after. This pins both the credit rate and the 1.0 cap.

### 4. MAJOR: contract rules in this ward's scope that no test covers
The ward says it implements "exactly the contract's sections **Network**, **Vehicles**, **Tick order** steps 4–7". These rules have zero coverage:
- **Lane choice on entry** (furthest-ahead tail, empty is best, ties go to the lowest index). The "always lowest free lane" mutation is not caught by any valid test; in the reference, test 8 catches it only incidentally via the origin-buffer timing.
- **Lane permanence** ("a vehicle keeps its lane until it leaves the link"). A lane-changing mutation is not caught. Test 5 tracks `(id, trip_id) → (link, s)` but not lane.
- **Origin admission**: `ORIGIN_ADMIT_PER_TICK = 2` (mutation "unlimited admission" is NOT CAUGHT), entry at v = 0 (caught only indirectly by test 4), FIFO order of the buffer (NOT CAUGHT).
- **Sink completion uses no credit and is unlimited** (mutation "completion consumes credit" is NOT CAUGHT: tests 4 and 11 send at most one vehicle per 10 ticks to the sink).
- **rr_next semantics** beyond "roughly fair": for example "advance rr_next every tick" or "rr_next = idx instead of idx+1" are untested once #1 is fixed. Test 12 only distinguishes fair from strongly unfair (reference: lowest-first and `tick mod n` give share 1.0, so those are caught once the total threshold is fixed).

**Fix.** Extend test 5 to assert that a vehicle's `lane` is constant while it is on the same link. Add a small deterministic lane-choice test (3-lane link, place vehicles, check the chosen `VehicleView.lane`). Add an admission test: 10 vehicles spawned at once on a 4-lane link means exactly 2 on the network after tick 1, all with `v == 0`, admitted in trip-id order. Add a sink test: a standing queue on the final link completes at kinematic headway, not limited to 0.25/tick.

### 5. MINOR: test 10 relies only on self-reported counters
`core_001_physics.rs:423-433`. `counts()`, `link_count()` and `check_invariants()` all come from the implementation under test. A bug that drops a vehicle and increments `completed` passes test 10.

**Fix.** Also assert `completed_log().len() as u64 == counts().completed`, that trip IDs in the log are unique, and that their union with on-network/buffered trip IDs equals `0..spawned`. Also assert `link_count(l) == link_vehicles(l).len()` here (today only test 6 does).

### 6. MINOR: test 9 checks only one form of blocking
`core_001_physics.rs:368-378`. It checks "no exit while `link_count == cap`". It does not check "no exit while the downstream lane has count < cap but no entry room (tail < entry_s + 7.5)", which is the more common block (see #1). The reference mutation "no entry spacing check" **passes** test 9 and is caught only by test 5's overlap check.

**Fix.** After #1, also assert that every vehicle placed on L2 during a tick satisfies the spacing to the previous tail (or rely on test 5 explicitly and say so in the test comment).

### 7. MINOR: determinism and Clone not exercised
The ward requires `World: Clone + Debug` and forbids `HashMap` iteration. No test clones a World or runs two identical worlds. core-003 owns full determinism testing, but a 5-line guard here is cheap: clone mid-run, step both N ticks, compare `link_vehicles` of all links bit-for-bit.

### 8. MINOR: weak or non-exercised assertions
- Test 1 (`:61`): `lane_capacity` "max(1, …)" is never exercised, because `MIN_LINK_LENGTH = 10` makes `floor(len/7.5) ≥ 1` always. Either drop the clause from the row or document that it is unreachable.
- Test 2: negative speed, NaN or ∞ length, and `link_with_length` with an unknown node are not tested. Error priority when several errors apply is unspecified.
- Test 11 (`:465-466`): the bounds `≥ 28.8 s` and `< 60 s` are loose (the reference gives exactly 32.5 s). A ±2-tick analytic bound like test 4 would be stronger.

## Mutation analysis
"Valid" means caught by a test that a correct implementation passes. Tests 6, 7, 9 and 12 currently fail on the reference (finding #1), so they cannot count as catching anything until they are fixed. The table shows both. Each row was run against the Python reference except those marked (hand).

| Mutation | Caught by valid test | Caught by currently-broken test |
|---|---|---|
| No acceleration (admit/accelerate instantly to vmax) (hand) | 4 (travel 200 vs 205.5) | — |
| Completion when entering the final link / not reaching the end (hand) | 4, 11 | — |
| Unlimited discharge (no credits) | 8 (L2 never fills) | 7, 9, 12 |
| Credit 0.5/tick (2× saturation flow) | 8 | 7, 9 |
| Credit cap 4.0 instead of 1.0 | **NOT CAUGHT** | (6, 7 fail for unrelated reasons) |
| Discharge ignores downstream space/capacity | 6 (capacity), 8, check_invariants | 9 |
| No spacing check at link entry | 5 (overlap) | 7, 12 (not 9) |
| No car-following (followers overlap) | 5 | — |
| Always lowest in-lane first (no round robin) | 8 (incidental) | 12 (share 1.0) |
| Round robin start = tick mod n | 8 (incidental) | 12 (share 1.0) |
| rr_next advanced every tick / set to idx | **NOT CAUGHT** (not run; no test pins it) | 12 at best |
| Lane choice = lowest free lane | 8 (incidental: origin before L1 full) | — |
| Lane change while on a link | **NOT CAUGHT** | — |
| Admission unlimited per tick | **NOT CAUGHT** | — |
| Admission not FIFO | **NOT CAUGHT** | — |
| Sink completion consumes credit | **NOT CAUGHT** | — |
| Vehicle dropped but counted as completed | 8/9 only if it happens at a blocked node; otherwise **NOT CAUGHT** (finding #5) | — |
| HashMap iteration order | **NOT CAUGHT** (finding #7) | — |

## Notes for Gold reviewer
- The headline problem is a **contract inconsistency**, not just bad thresholds. The step-4 claim "standing queue discharges at saturation flow" ignores the downstream entry spacing, which caps 1-lane→1-lane at 1200 veh/h. That affects every later ward: routing `free_flow` uses `1/(lanes × SAT_FLOW)`, which understates delay by 50 % for single-lane chains, and the bridge capacity in the city demo depends on it. The contract has to be amended before tests are re-derived. Check that the amendment is recorded in `.wdd/epics/core.md`.
- Once the thresholds are re-derived, Green must not "fix" them by loosening (Must NOT: don't weaken thresholds). Each revised threshold needs a derivation comment.
- The test-4 arithmetic is correct: admission at tick 0, 10 acceleration ticks to 27.5 m, then 5 m/tick; completion during the step with tick = 205, against an analytic 205.5.
- Ambiguities the tests silently resolve, or leave open:
  1. Initial lane credit and whether credit accrues on empty lanes (tests insensitive; reference checked with 0 and 1).
  2. `completed_tick` = tick during the step vs. after `tick += 1` (tolerated by the ±2 / loose bounds).
  3. Origin admission: head-of-line blocking vs. skipping vehicles whose first link has no room ("walk the buffer … admit up to 2 whose…" reads as skip, which is not FIFO).
  4. Several transfers per node per tick are allowed (scan wraps once). Test 7 lanes=2 assumes this.
  5. `entry_s = reach − length` means a front that was blocked while moving needs *more* downstream room than a stopped one. This quirk interacts with #1.
  6. Test 9 depends on node A being discharged before node B within a tick (ascending IDs). That is correct per the contract, and the test comment says so.
- The reference model and scenario scripts are in `/tmp/wddref/` (`ref.py`, `scen.py`, `probe.py`, `probe2.py`) if you want to reproduce the numbers.
