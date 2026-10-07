# Review city-001 RED 3

**Reviewer:** adversarial test reviewer (fresh subagent, round 3), 2026-10-07
**Verdict:** REJECTED (2 MAJOR, 0 BLOCKER)

Scope: `.wdd/wards/city/ward-001.md`, `.wdd/epics/city.md` § C1/C2, `.wdd/epics/core.md` (in force), `crates/sim-core/tests/city_001_relief.rs` at commit 9a760ce (22 tests), and `.wdd/reviews/city-001-red-{1,2}.md`.

## What I ran

- I made a fresh copy of the reference at `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/proto3/sim-core` (from proto2) and copied in the worktree's test files byte-for-byte. Its `tests/` matched the worktree exactly, apart from removing proto2's `red2_extra.rs`.
- I reviewed the reference against C1/C2 myself (diff in `proto3/ref.diff`). It conforms on every point I checked:
  - the blocked check comes after the reach check, the completion, the stranded case and the forced decision, and it uses the crossing's `entry_s`;
  - the order is count → removal at 1200 → relief at multiples of 120;
  - after a relief that finds space with credit < 1, the count is left unchanged;
  - "credit-limited with space" resets the count;
  - the search is a fresh `Tree::build` on `cost_keys` with closures and the blocked link excluded, and it is not cached;
  - the removal is not an exit, does not touch `rr_next`, and frees the slot;
  - `removed_unreachable` and `unreachable` exclude gridlock removals, and `unserved` = `unreachable + removed_gridlock`;
  - the hash covers `blocked_ticks`, `removed_gridlock` and `gridlock_reroutes`.
- `cargo test -p sim-core --no-fail-fast` on the reference: core 20 + 24 + 36 + 5 = **85 pass**, city_001 **22/22 pass**.
- `cargo clippy -p sim-core --all-targets -- -D warnings` **fails on the test file** (see M2).
- Mutants: I extended proto2's `MUT` switches with G3a, G3b, FD, U, PR and NR (patch script `tmp/r3_mutants.py`). I ran them against city_001 plus my candidate tests in `proto3/sim-core/tests/r3_extra.rs`:

| Mutant | Meaning | city_001 (22) | + r3 candidates |
|---|---|---|---|
| A | credit checked before the blocked check | killed (17) | |
| B / B2 | search reads / writes RouterCache | killed (12, 18, 19 / 18) | |
| C | reroute attempted at 1200 | killed (19) | |
| E | removal records an exit-time sample | killed (21) | |
| F | search ignores closures | killed (19) | |
| G3, G3b | no reset when stranded (both / stranded branch) | killed (20) | |
| COST | search uses free-flow keys | killed (22) | |
| **NR** | a front that does *not* reach the line counts as blocked when its next link is full | **survives** | killed (R3-4) |
| PR | a budgeted (priority/periodic) reroute resets the count | survives | killed (R3-2) |
| FD | forced decision into a full link resets instead of counting | survives | killed (R3-3) |
| U | relief finds space but credit < 1 → count reset (contract: unchanged) | survives | killed (R3-1) |
| G2 | credit-limited with space does not reset | survives | killed (R3-1) |
| G3a | forced-decision-without-route does not reset (stranded branch still does) | survives | survives (one-tick stale value, see m4) |
| ENTRY | blocked check uses `entry_s = 0` | survives | survives (m3) |
| RR | removal updates `rr_next` | survives | survives (m3) |
| G1 | no reset on "no reach" | survives | equivalent (a counted front stands at `s == length`) |

- Reference + candidates: 85 + 22 + 4 = **111 pass**, and clippy is clean after the M2 fix.

## Earlier findings: status

| Finding | Status |
|---|---|
| r1 B1 (metric names) | **Fixed.** `EXTENDED_METRIC_NAMES`/`metrics_to_extended_array` are used, `core_004` passes unchanged, and test 13 checks the prefix, the suffix and index alignment. |
| r1 B2 (test 11 start) | **Fixed.** It passes on the reference. |
| r1 M1 | **Fixed.** Test 17 kills A. |
| r1 M2/M3 | **Fixed.** Test 19 kills C and F. |
| r1 M4 | **Fixed.** Test 18 kills B and B2. |
| r2 M1 | **Fixed.** Test 20 kills G3 (and G3b). |
| r2 M2 | **Fixed.** Test 21 kills E, and the "not constructible" sentence is gone from the ward. |
| r2 m1 | **Fixed.** Test 22 kills COST. |
| r2 m4 | **Fixed.** C2 has the `rr_next` clause. |
| r2 m5 | **Fixed.** Test 19 asserts `shortest_route(a, d) == [q1, q2, r]`. |
| r2 m2/m3 | **Not addressed.** The ward neither tests them nor names them as Gold code-review items (see m3). |

## Findings

### MAJOR

**M1: the "reach ≥ length" condition of a blocked front is unpinned. Mutant NR passes all 22 tests.**
- C2: a lane front is blocked only in "an evaluation [that] reaches the stop line (`reach ≥ length`)". "No reach" is explicitly a reset case.
- NR increments `blocked_ticks` for any non-stranded front whose next link has no lane, including while the front is still driving toward the line. This implementation mistake is plausible: "front + next full" computed without the reach test.
- It survives because every ward construction makes v a front only a few ticks before it reaches the line: it queues behind b1, and test 17's `>= 1` has no upper bound.
- Effect: the 60 s and 10 min clocks start at the moment a vehicle *becomes front*, not when it reaches the line. A vehicle alone on a 300 m approach into a full bridge link would accumulate about 43 ticks before arriving. Relief would then fire after about 39 s at the line instead of 60 s, and the removal would come early in the same way.
- This is exactly the River City closure situation: long arterials feeding full Old/North Bridge approaches.
- Fix: add this test. It passes on the reference, NR fails it at the "counted … before reaching the line" assertion, and it uses only the public API.
  ```rust
  /// "Blocked" requires the evaluation to reach the stop line. v drives the 200 m L1 alone toward
  /// P, which b1 already holds for good: during the approach v is a lane front with a full next
  /// link but does not reach the line, so its count stays 0; it is 1 in its first evaluation there.
  #[test]
  fn approaching_front_is_not_blocked() {
      let mut b = NetworkBuilder::new();
      let z = b.zone(-200.0, 0.0);
      let a = b.node(0.0, 0.0);
      let bb = b.node(10.0, 0.0);
      let d = b.node(210.0, 0.0);
      let x = b.node(10.0, -200.0);
      let l1 = b.link(z, a, 10.0, 1);
      let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
      let r = b.link(bb, d, 10.0, 1);
      let cx = b.link(bb, x, 10.0, 1);
      let mut w = World::new(b.build().unwrap());
      w.schedule(close(cx, 0)).unwrap();
      step_checked(&mut w);
      let b1 = w.spawn_with_route(vec![l1, p, cx]).unwrap();
      while !w.vehicle(b1).unwrap().stranded {
          step_checked(&mut w);
          assert!(w.tick() < 200);
      }
      assert_eq!(w.link_count(p), w.network().capacity(p), "precondition: P full");
      let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
      let mut approach_ticks = 0;
      for _ in 0..200 {
          let t = w.tick();
          step_checked(&mut w);
          assert!(w.vehicle(b1).is_some());
          let i = w.vehicle(v).unwrap();
          if i.state != VehicleState::OnLink(l1) {
              continue;
          }
          if i.s < 200.0 - 1e-9 {
              assert_eq!(i.blocked_ticks, 0, "tick {t}: counted at s = {} before reaching the line", i.s);
              approach_ticks += 1;
          } else {
              assert!(approach_ticks >= 20, "precondition: a long approach ({approach_ticks} ticks)");
              assert_eq!(i.blocked_ticks, 1, "tick {t}: first evaluation at the line");
              return;
          }
      }
      panic!("v never reached the line");
  }
  ```

**M2: the test file is not clippy-clean, so the ward's pass criterion cannot be met without editing tests after Red approval.**
- `cargo clippy -p sim-core --all-targets -- -D warnings` on the reference fails with `error: redundant guard --> tests/city_001_relief.rs:396:32` (`Some(p) if p == 0 =>`).
- The ward's pass criterion is "clippy clean (`cargo clippy --all-targets -- -D warnings`)". Tests are snapshotted at Red approval, so Gold could not fix this without a test-file change, which the Gold reviewer must reject.
- Fix (verified: clippy is then clean for all targets, and 22/22 still pass): line 396 → `Some(0) => assert!(i.blocked_ticks <= 1),`.

### MINOR

**m1: the "count unchanged / reset" clauses around credit < 1 are untested (mutants U and G2).** This is r2 m2, still open. Impact is bounded, but the test below is cheap and kills both mutants:
- `relief_with_space_but_low_credit`: L1 at sat 0.005; v is blocked behind stranded b1 while L1 re-earns credit.
- At count 120 the relief switches v to Q with space but no credit. The test asserts that v stays on L1 with count 120, then has count 0 on every tick while it waits, then crosses onto Q1.

Recommended. The code is in `tmp/proto3/sim-core/tests/r3_extra.rs` (R3-1) and passes on the reference.

**m2: count continuity across budgeted reroutes and forced decisions is untested (mutants PR and FD).**
- C2 lists the reset cases exhaustively, and a route change by a priority/periodic reroute is not one of them. Likewise, a forced decision whose new next link is full is a blocked evaluation and counts.
- The natural "reset in `assign_route`" mistake is already killed by test 11, because the relief itself calls it. A reset placed only in the budgeted paths survives. On a closure, it would restart the clocks of all blocked fronts whose downstream route included the closed link.
- Recommended: R3-2 `priority_reroute_keeps_blocked_count` (close R at count 200 → v is rerouted around R → count 201) and R3-3 `forced_decision_into_full_link_counts`. Both are in `r3_extra.rs` and pass on the reference.

**m3: ENTRY and RR remain untestable at reasonable cost, and the ward does not hand them to Gold.**
- r2 asked for either tests or an explicit Gold code-review list. The ward's Tests section names only `state_hash` coverage.
- Add one sentence there, for example: "Gold code review also checks: the blocked check reuses the crossing's `entry_s`/`choose_lane` result; a gridlock removal does not update `rr_next`; credit < 1 handling per C2."

**m4: G3a survives.** If the forced-decision-without-route path does not reset the count, a newly stranded front shows a stale count for exactly one tick, and the stranded branch then resets it. The effect is negligible, and the hash difference is deterministic. Optionally, extend test 9 or 20 with a forced-decision stranding of a counted front. Otherwise leave it to Gold code review.

**m5: tests 20–22 use `w.step()` instead of `step_checked`.** r2 asked for `step_checked` in test 20. The C2 conservation and metric identities are therefore not asserted along those runs. Swap the helper (all three still pass on the reference).

## Not findings (checked)

- C1 tests 1–6 are exact and order-sensitive:
  - per-link validation order and the "earlier link first" rules;
  - the lowest unknown id;
  - unknown-link precedence after link errors;
  - headways of 8 and 16;
  - `lanes × sat` in `free_flow` and `queue_term`.

  Two-pass validation orders and "UnknownLink first" are both caught.
- The premises hold on the reference:
  - the ring is full at tick 400;
  - b1 is removed at T+600, and v crosses in the same tick;
  - P/Q alternation in test 11;
  - S is cheaper than Q by current costs at the relief (test 22);
  - L1 is empty before the epoch in test 21;
  - the Q route is shortest at removal in test 19.
- Test 16 (three_bridges, with and without the closure) stays far below 120. Relief cannot leak into the core reference values.
- G1 is equivalent, as in r2.

## Required for re-review

1. Add M1 (`approaching_front_is_not_blocked`) to `city_001_relief.rs` and to the ward's Tests table.
2. Apply the M2 one-line clippy fix.
3. Recommended: R3-1..R3-3 (m1, m2), the Gold code-review sentence (m3), and `step_checked` in tests 20–22 (m5).

Candidate code: `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/proto3/sim-core/tests/r3_extra.rs` (4 tests, all pass on the reference). Mutants are switchable with `MUT=NR|PR|FD|U|G2|G3a|G3b|…` in `proto3/sim-core/src/world.rs`. Runner scripts: `tmp/r3_all.sh` and `tmp/r3_one.sh`.
