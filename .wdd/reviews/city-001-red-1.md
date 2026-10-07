# Review city-001 RED 1

**Reviewer:** adversarial test reviewer (fresh subagent), 2026-10-07
**Verdict:** REJECTED

Scope: `.wdd/wards/city/ward-001.md`, `.wdd/epics/city.md` § C1/C2, `.wdd/epics/core.md` (in force), `crates/sim-core/tests/city_001_relief.rs` at commit 302fffb (git blob `e05b7261835ae84a9cf7c1c604981a2c746586af`), `crates/sim-core/src/*.rs`, `crates/sim-core/tests/core_00*.rs`.

## What I ran

A scratch copy of the crate lives at `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/proto/sim-core`. I did not touch the worktree's src or tests.
- I implemented C1 and C2 there as a minimal reference: `Link.sat_flow_per_lane`, `set_sat_flow` (last call wins), `InvalidSatFlow`/`UnknownLink` validation, credit `sat * DT`, routing with `lanes × sat`, and `blocked_ticks` in `discharge_lane` after the forced decision. Evaluation order: count, then removal at 1200, then a non-caching reroute at multiples of 120 with the blocked link excluded. I also added `remove_gridlock`, the metrics, the hash fields and `METRIC_NAMES`.
- Mutants are switchable with the `MUT` env var:
  - A: credit is checked before the blocked check.
  - B: the gridlock search reads and writes `RouterCache`.
  - B2: the gridlock search writes its tree into the cache.
  - C: a reroute is attempted at 1200, before the removal.
  - E: a gridlock removal records an exit time.
  - F: the gridlock search ignores closures.
- `cargo test -p sim-core --no-fail-fast` against the reference:
  - city_001: 15/16 pass. Test 11 fails (B2 below).
  - core_001/002/003: 20 + 24 + 36 pass.
  - core_004: 4/5. `metrics_array_matches_names` fails (B1 below).
- Mutants against the 16 ward tests:

  | Mutant | Result |
  |---|---|
  | A | survives |
  | B | killed by test 12 (incidentally) |
  | B2 | survives |
  | C | survives |
  | E | survives |
  | F | survives |
- Candidate extra tests are in `tests/redreview_extra.rs` (x1, x2) and `tests/redreview_x3b.rs`. All three pass on the reference.
  - x1 kills A.
  - x2 kills B2.
  - x3b kills C and F.
- Premises verified on the reference:
  - The fork's v stands blocked at A's stop line from about tick 50.
  - The stranded blockers are removed at tick 648, and v crosses at 648 (test 11 with the fix below).
  - The ring holds blocked fronts at tick 700 and is drained by removal (tests 12 and 15 pass).
  - three_bridges never triggers relief, with or without the closure (test 16 passes).
  - Test 11's P/Q alternation holds: 4 gridlock reroutes before the blockers leave.

## Findings

### BLOCKER

**B1: contract conflict. Appending to `METRIC_NAMES` necessarily breaks core test `core_004_frame::metrics_array_matches_names`.**
- C2 and the ward Outputs require `METRIC_NAMES` to gain `"removed_gridlock"` and `"unserved"`, and `metrics_to_array` to follow.
- `core_004_frame.rs:123` asserts `METRIC_NAMES == &[ ...exactly 16 names... ]`.
- `core_004_frame.rs:174` asserts `metrics_to_array(&m) == want` with a 16-element `want`.
- Any correct implementation fails this test (verified: the reference fails at line 123). The ward's Must DO also says "The 85 earlier Rust tests stay green unchanged", so the ward cannot be satisfied as written. Per the ward, this needs escalation or a contract amendment, not a Gold-time workaround.
- Fix (choose one and write it into the ward and `city.md`):
  - (a) Explicitly allow a single, named update to `metrics_array_matches_names`. Extend both expected arrays by `"removed_gridlock", "unserved"` and `m.removed_gridlock as f64, m.unserved as f64`, and record it as a deliberate contract change. The web side indexes metrics by name (`web/tests/host.test.ts:166`, `sim.test.ts:131` checks only lengths are equal), so nothing else breaks.
  - (b) Keep `METRIC_NAMES` unchanged and expose the two values through a separate API. This contradicts C2 and the Integration needs of city-005.

  (a) is the sensible choice. Either way, the "85 unchanged" claim in the ward and in the epic Completion Criteria must be corrected.

**B2: test 11 (`gridlock_reroute_without_space_keeps_counting`) fails against a correct implementation at tick 1.**
- In the loop, `if i.state != VehicleState::OnLink(f.l1)` treats v's initial `WaitingAtOrigin` state as "crossed".
- With `Q::Blocked`, b1 and b2 are ahead of v in Z's origin buffer, so v is still waiting at tick 1. The test then asserts that a blocker is gone and panics (`city_001_relief.rs:527`, "tick 1").
- Verified on the reference. With the fix below, the test passes: v crosses at 648 after 4 alternating reroutes, and b1 has been removed.
- Fix: replace
  ```rust
  let Some(i) = f.w.vehicle(f.v) else { break };
  if i.state != VehicleState::OnLink(f.l1) {
  ```
  with
  ```rust
  let Some(i) = f.w.vehicle(f.v) else { break };
  if i.state == VehicleState::WaitingAtOrigin {
      continue;
  }
  if i.state != VehicleState::OnLink(f.l1) {
  ```
  Optionally also assert that `i.state == VehicleState::OnLink(f.p) || i.state == VehicleState::OnLink(q1)` at the crossing.

### MAJOR

**M1: the "credit is ignored; the check is made even when credit < 1" rule is untested. Mutant A survives.**
- Mutant A checks `credit < 1` before the blocked check and resets the count. It passes all 16 tests.
- Test 7 accepts any delayed start: `None => blocked_ticks <= 1` and `Some(0) => <= 1`.
- Every blocked front in the suite has full credit, because it has waited long enough.
- Fix: add this test. It passes on the reference, and A fails it at tick 51.
  ```rust
  #[test]
  fn blocked_counts_while_credit_is_low() {
      // L1 at sat 0.125 needs 16 ticks to re-earn a credit after b1 crosses; v reaches the line inside that window
      let mut f = fork(Q::None, 0, Some(0.125));
      let (mut b1_crossed_at, mut first_at_line, mut prev) = (None, None, None::<u32>);
      for _ in 0..400 {
          let t = f.w.tick();
          let e0 = f.w.link_exit_count(f.l1);
          step_checked(&mut f.w);
          if f.w.link_exit_count(f.l1) > e0 { b1_crossed_at.get_or_insert(t); }
          let i = f.w.vehicle(f.v).unwrap();
          if i.state == VehicleState::OnLink(f.l1) && i.s >= 200.0 - 1e-9 {
              first_at_line.get_or_insert(t);
              assert!(i.blocked_ticks >= 1, "tick {t}: at the stop line with P full but count 0");
              if let Some(p) = prev { assert_eq!(i.blocked_ticks, p + 1, "tick {t}"); }
              prev = Some(i.blocked_ticks);
          }
      }
      let (c, a) = (b1_crossed_at.unwrap(), first_at_line.unwrap());
      assert!(a < c + 16, "precondition: v at the line ({a}) while credit was low (b1 crossed {c})");
  }
  ```
  A front standing at `s == length` after a step was necessarily evaluated with `reach >= length` in that step, so the assertion is exact.

**M2: evaluation order at 1200 ("remove; no reroute attempt") is untested. Mutant C survives.**
- In the only removal scenario (the ring), a gridlock search never finds a path, so "reroute at 1200, then remove" and "remove at 1200" behave the same.
- In the fork, the blockers leave at 648, long before 1200.
- Fix: add the test in `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/proto/sim-core/tests/redreview_x3b.rs` (`x3b_removal_at_1200_makes_no_reroute_attempt`). The setup:
  - P has `set_sat_flow(p, 1e-6)`, so b1 (L1,P,R) holds P for good. It is credit-limited with space, so it is never blocked or removed.
  - The alternative Q1 is closed at tick 0 and reopened when v's count reaches 1190.
  - At 1200, v must be removed, `removed_gridlock == 1` and `gridlock_reroutes == 0`.
  - A precondition asserts that no periodic reconsideration of v falls inside the window.

  It passes on the reference. Under C, v crosses onto Q1 at tick 1250 instead of being removed.

**M3: the gridlock search ignoring closures goes undetected. Mutant F survives.**
- C2 says the search uses "current costs and closures". In every ward scenario, closures are irrelevant to the search: in test 7 there is no path either way, in tests 10 and 11 the alternatives are open, and in the ring there is no path.
- Mutant F builds the tree without the closure filter and passes all 16 tests. It then drives v onto a closed link: in x3b, F moves v onto the closed Q1 at tick 170.
- Fix: the x3b test above also covers this. It asserts `gridlock_reroutes == 0` while Q1 is closed, and that v never leaves L1.

**M4: "neither cached nor written to the cache" (a ward Must NOT) is only incidentally covered. Mutant B2 survives.**
- Mutant B reads a stale cached tree. Test 12 catches it only by accident.
- Mutant B2 does a fresh search but stores its tree, with P excluded, in `RouterCache`. All 16 tests pass.
- The pollution is observable through the public API: a demand trip routed in the next tick gets the P-excluded route.
- Fix: add `x2_gridlock_search_does_not_touch_router_cache` from `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/proto/sim-core/tests/redreview_extra.rs`:
  - A probe run finds the relief tick r.
  - It then builds the same fork via `World::from_scenario` with one Z→D flow (7200 veh/h) and a triangular `Profile` that is 1.0 only at tick r+1. Profile 0 elsewhere generates no trips and consumes no RNG, so the worlds are identical up to r.
  - The test asserts that the generated trip's route is `[L1, P, R]`, the true shortest route, equal to `shortest_route`.

  It passes on the reference, and B2 yields `[L1, Q1, Q2, R]`.

### MINOR

**m1: "records no exit time" for gridlock removal is untested. Mutant E survives.** Test 12 checks only `link_exit_count`. An exit-time sample from the removed vehicle changes the next epoch's link cost.
- Detecting it is awkward: in the ring, real exits in the same epoch have similar dwell times, and my simple precondition (an epoch with a removal and no exits) did not occur.
- Suggested test: add a reference model of the epoch update to the ring run. Track entry ticks per vehicle from state transitions, collect the exit-time samples of real exits only, and assert `link_cost` after each epoch equals `max(ff, 0.5·max(mean_exit, queue_term) + 0.5·prev)` (or `queue_term` when there are no samples).
- Alternatively, the Gold reviewer checks `remove_gridlock` in code.

**m2: the C2 clause "if the rerouted next link has space but credit < 1, the count stays unchanged in this evaluation, then resets next evaluation" is untested.** Tests 10 and 11 always have full credit at relief time.
- Low impact. To test it: in the x3b-style setup, give L1 a low sat and make the alternative free at a 120 multiple shortly after a crossing from L1. Or document that this is left to Gold code review.

**m3: test 7's lower bound is weak.** `prev > 3 * GRIDLOCK_REROUTE_TICKS` is fine, but the start condition (`<= 1`) allows a delayed start. M1's test fixes this. Alternatively, assert in test 7 that v's first observation at `s >= length - 1e-9` has `blocked_ticks >= 1`.

**m4: the ring deadlock tick (346) is stated in the spec and in comments but is not asserted.** Tests 12 and 15 only rely on there being blocked fronts at 700 and a removal. That is acceptable, but the comment should say "≈" or the claim should be dropped.

## Not findings (checked)

- Test 1, the default sat bit-identity, together with the unchanged core_001 to core_003 (80 tests green on the reference), covers "credit increment bit-identical to 0.25".
- Tests 3 and 4 cover the error ordering as specified: InvalidLanes before InvalidSatFlow on the same link, and earlier link before later link in both directions. UnknownLink is reported last, with the lowest id.
- Tests 5 and 6 pass on the reference and distinguish sat 0.25 from 0.5. Test 6's `ff` with sat 0.25 is 24 s, against 22 s at the default.
- Test 10's hysteresis guard is real. The Q route costs more than the P route, so a reroute that applied hysteresis would not switch.
- Test 14's budget check is real.
- Test 16 runs a busy city: more than 1,000 completed, max blocked below 120.
- No HashMap or wall clock is used in the tests.

## Required for re-review

1. Resolve B1 in the ward and contract. Recommended: allow the named core_004 update, and amend "85 unchanged".
2. Fix B2 (test 11).
3. Add tests for M1, M2/M3 (one test covers both) and M4. Ready-to-adapt code is in the scratch files named above and passes on the reference implementation.
