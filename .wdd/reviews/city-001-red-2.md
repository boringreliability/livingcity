# Review city-001 RED 2

**Reviewer:** adversarial test reviewer (fresh subagent, round 2), 2026-10-07
**Verdict:** REJECTED (2 MAJOR, 0 BLOCKER)

Scope: `.wdd/wards/city/ward-001.md`, `.wdd/epics/city.md` § C1/C2, `.wdd/epics/core.md` (in force), `crates/sim-core/tests/city_001_relief.rs` at commit a09940d (19 tests), `.wdd/reviews/city-001-red-1.md`.

## What I ran

- I made a fresh copy of the round-1 reference at `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/proto2/sim-core`, holding the worktree's current `city_001_relief.rs` and the unchanged core tests. The core test files are byte-identical to the worktree (`diff -rq`).
- I reviewed the reference against C1/C2. It conforms, and every clause I checked holds:
  - evaluation order: count → removal at 1200 → reroute at multiples of 120;
  - the credit check comes after the blocked check;
  - "unchanged" when the reroute finds space but credit < 1;
  - the non-caching search;
  - the removal is not an exit and does not touch `rr_next`;
  - the hash fields.
- `cargo test -p sim-core --no-fail-fast` on the reference: core 20 + 24 + 36 + 5 = **85 pass** (`core_004` included, so B1 is resolved), city_001 **19/19 pass**.
- Mutants (env `MUT`), run against city_001 plus my candidate tests (`tests/red2_extra.rs`):

| Mutant | Meaning | city_001 (19) | + red2 candidates |
|---|---|---|---|
| A | credit checked before the blocked check | killed (17) | |
| B | gridlock search reads the cache | killed (12, 18, 19) | |
| B2 | gridlock search writes the cache | killed (18) | |
| C | reroute attempted at 1200 | killed (19) | |
| F | gridlock search ignores closures | killed (19) | |
| **E** | gridlock removal records an exit-time sample | **survives** | killed (R2-2) |
| **G3** | stranded / forced-no-route does not reset `blocked_ticks` | **survives** | killed (R2-1) |
| **COST** | gridlock search uses free-flow keys, not current costs | **survives** | killed (R2-3) |
| G2 | credit-limited-with-space does not reset | survives | survives (minor, see m2) |
| ENTRY | blocked check uses `entry_s = 0` | survives | survives (minor, see m3) |
| RR | gridlock removal updates `rr_next` like a transfer | survives | survives (minor, see m4) |
| G1 | no reset on "no reach" | survives | equivalent: a blocked front stands at `s == length`, so `reach ≥ length` always; not a finding |

- The reference plus the candidates: **107 pass** (85 + 19 + 3).
- The web side reads metrics by name (`web/tests/sim.test.ts:24,131`, `host.test.ts:166`), so switching `sim-wasm` to `EXTENDED_METRIC_NAMES` breaks no Vitest.

## Round-1 findings: status

| R1 | Status |
|---|---|
| B1 metric-name conflict | **Fixed.** C2/ward now use `EXTENDED_METRIC_NAMES`/`metrics_to_extended_array`, and `core_004` passes unchanged. Test 13 checks the prefix, the suffix and index alignment. |
| B2 test 11 start | **Fixed.** It passes on the reference: 4 alternating reroutes, then the crossing at ≈648. |
| M1 credit-low blocked check | **Fixed.** Test 17 kills A. |
| M2/M3 order at 1200, closures in search | **Fixed.** Test 19 kills C and F. |
| M4 cache untouched | **Fixed.** Test 18 kills B2 (and B). |
| m1 exit time (moved to Gold code review) | **Not acceptable as justified.** See MAJOR M2: the stated reason is false and the test is trivially constructible. |
| m3 test 7 lower bound | Covered by test 17. |

## Findings

### MAJOR

**M1: the reset rule "stranded / forced decision without route → `blocked_ticks = 0`" is untested. Test 9's stranded half is vacuous.**
- C2 lists "stranded, forced decision without route" among the reset cases. Test 9 claims "stranded vehicles always have `blocked_ticks == 0`". However, its stranded vehicles (b1, b2) strand via their forced decision at B and are **never blocked before**, so their count is 0 regardless of whether the reset exists. Mutant G3 (both resets removed) passes all 19 tests.
- Consequence: a vehicle blocked for k ticks that strands because its next link closes keeps k. After a reopen and a successful retry, its next blocked episode continues from k+1, which leads to an early reroute and a **premature gridlock removal** (k = 1100 → removed 100 ticks later). Closing a link in front of a queue is exactly the demo action.
- Fix: add this test. It passes on the reference, and G3 fails it at line 50 (count 200 kept while stranded).
  ```rust
  /// Fork without Q: v blocked behind stranded b1 on P. At count 200, P closes: v strands, so
  /// its count drops to 0. P reopens; v's retry succeeds and, P still full, the count restarts at 1.
  #[test]
  fn stranding_resets_a_blocked_count() {
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
      w.step();
      let b1 = w.spawn_with_route(vec![l1, p, cx]).unwrap();
      let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
      while w.vehicle(v).unwrap().blocked_ticks < 200 {
          w.step();
          assert!(w.tick() < 2000);
      }
      let tc = w.tick();
      w.schedule(close(p, tc)).unwrap();
      w.schedule(Command { tick: tc + 30, kind: CommandKind::OpenLink(p) }).unwrap();
      let (mut stranded_seen, mut resumed) = (false, false);
      for _ in 0..200 {
          let t = w.tick();
          w.step();
          assert!(w.vehicle(b1).is_some(), "precondition: b1 still holds P at {t}");
          let i = w.vehicle(v).unwrap();
          assert_eq!(i.state, VehicleState::OnLink(l1));
          if i.stranded {
              stranded_seen = true;
              assert_eq!(i.blocked_ticks, 0, "tick {t}: stranded but count kept");
          } else if stranded_seen {
              assert_eq!(i.blocked_ticks, 1, "tick {t}: count resumed from a stale value");
              resumed = true;
              break;
          }
      }
      assert!(stranded_seen && resumed, "preconditions: v stranded, then resumed");
  }
  ```
  (Use `step_checked` instead of `w.step()` in the ward file.)

**M2: "a gridlock removal records no exit time" is untested, and the ward's reason for moving it to Gold code review is false.**
- The ward says an epoch-level test "was not constructible: the freed space makes the link discharge in the same epoch". That holds only when followers stand behind the removed front.
- Test 19's own construction (two vehicles, b1 credit-starved on P, v alone on L1) leaves **L1 empty** after v's removal. The next epoch therefore has no real exits on L1.
- Under mutant E, L1 then gets a ≈600 s sample: its cost jumps from 22 to ≈311 s instead of staying at 22. In River City this would blacklist an approach for minutes after every gridlock removal. That is a routing distortion in exactly the closure scenario, and it is caught only if a Gold reviewer happens to read the right line.
- Fix: add this test (or append its tail to test 19) and delete the "not constructible" sentence from the ward. It passes on the reference (exact float equality), and E fails it at line 102.
  ```rust
  #[test]
  fn gridlock_removal_records_no_exit_time() {
      let mut b = NetworkBuilder::new();
      let z = b.zone(-200.0, 0.0);
      let a = b.node(0.0, 0.0);
      let bb = b.node(10.0, 0.0);
      let d = b.node(210.0, 0.0);
      let l1 = b.link(z, a, 10.0, 1);
      let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
      let r = b.link(bb, d, 10.0, 1);
      b.set_sat_flow(p, 1e-6);
      let mut w = World::new(b.build().unwrap());
      w.step();
      let b1 = w.spawn_with_route(vec![l1, p, r]).unwrap();
      let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
      let mut removed_at = None;
      for _ in 0..3000 {
          let t = w.tick();
          w.step();
          if w.vehicle(v).is_none() {
              removed_at = Some(t);
              break;
          }
      }
      let rm = removed_at.expect("v removed");
      assert_eq!(w.metrics().removed_gridlock, 1);
      assert!(w.vehicle(b1).is_some());
      assert_ne!(rm % COST_EPOCH_TICKS, 0, "precondition: removal not on an epoch tick");
      while w.tick() % COST_EPOCH_TICKS != 0 {
          w.step();
      }
      assert!(w.link_vehicles(l1).is_empty());
      let prev = w.link_cost(l1);
      w.step(); // epoch boundary
      // no exit-time sample: observed = queue_term = 200/10 + 0 queued
      let ff = 200.0 / 10.0 + 1.0 / 0.5;
      let expected = f64::max(ff, 0.5 * (200.0 / 10.0) + 0.5 * prev);
      assert_eq!(w.link_cost(l1), expected, "a gridlock removal produced an exit-time sample");
  }
  ```

### MINOR

**m1: "the search uses current costs" is untested. Mutant COST survives.** Every ward scenario has at most one alternative, so the cost input never decides the search. River City has several, so I recommend adding this test. It passes on the reference and kills COST: free flow prefers Q, current costs prefer S (Q2 cost 19.5 vs S2 13 at relief tick 170).
```rust
#[test]
fn gridlock_search_uses_current_costs() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-200.0, 0.0);
    let a = b.node(0.0, 0.0);
    let bb = b.node(10.0, 0.0);
    let d = b.node(210.0, 0.0);
    let x = b.node(10.0, -200.0);
    let e = b.node(5.0, 9.0);
    let f = b.node(5.0, -9.0);
    let ze = b.zone(5.0, 300.0);
    let l1 = b.link(z, a, 10.0, 1);
    let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
    let r = b.link(bb, d, 10.0, 1);
    let cx = b.link(bb, x, 10.0, 1);
    let q1 = b.link_with_length(a, e, 10.0, 10.0, 1);
    let q2 = b.link_with_length(e, bb, 100.0, 10.0, 1); // ff 12
    let s1 = b.link_with_length(a, f, 10.0, 10.0, 1);
    let s2 = b.link_with_length(f, bb, 110.0, 10.0, 1); // ff 13
    let ce = b.link_with_length(ze, e, 50.0, 10.0, 1);
    let mut w = World::new(b.build().unwrap());
    w.schedule(close(cx, 0)).unwrap();
    w.step();
    let b1 = w.spawn_with_route(vec![l1, p, cx]).unwrap();
    let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
    for _ in 0..6 {
        w.spawn_with_route(vec![ce, q2, cx]).unwrap(); // strand on Q2 → Q2 queued
    }
    for _ in 0..400 {
        let t = w.tick();
        let g0 = w.reroute_stats().gridlock_reroutes;
        w.step();
        if w.reroute_stats().gridlock_reroutes > g0 {
            let cq = w.link_cost(q1) + w.link_cost(q2);
            let cs = w.link_cost(s1) + w.link_cost(s2);
            assert!(cs < cq, "precondition at {t}: S {cs} vs Q {cq}");
            assert_eq!(w.vehicle(v).unwrap().route, vec![l1, s1, s2, r], "tick {t}");
            assert!(w.vehicle(b1).is_some());
            return;
        }
    }
    panic!("no gridlock reroute");
}
```

**m2: two counter clauses about credit < 1 with space remain untested** (mutant G2; round-1 m2):
- the reset on "credit-limited with space available";
- "count unchanged" when a gridlock reroute finds space but credit < 1.

The impact is bounded: a blocked front's lane reaches full credit within `1/(sat·DT)` ticks and keeps it, so any error is at most ≈16 ticks of count at sat 0.125. Either add a test or leave it to Gold code review, and say so explicitly in the ward.

**m3: the blocked check's `entry_s` is not pinned** (mutant ENTRY: `choose_lane(next, 0)`). Telling the two apart requires a downstream tail within [7.5, entry_s + 7.5) m after the tick, a sub-metre window. Low impact. Gold should check in code that the blocked check reuses the crossing's `choice`/`entry_s`, as the ward Specification says.

**m4: C2 is silent on `rr_next` at a gridlock removal.** The core rule updates it only "after a successful transfer (not a completion)". A removal is neither, but implementers may disagree, and no test can tell (mutant RR survives). Add one clause to C2: "A gridlock removal does not update `rr_next`."

**m5: test 19's last precondition is vacuous.** `assert!(w.shortest_route(a, d).is_some(), "precondition: the Q route exists at removal")` is always true via P. Replace it with the following, verified passing on the reference (P's cost ≈ 1e6 s at sat 1e-6):
```rust
assert_eq!(w.shortest_route(a, d).unwrap().0, vec![q1, _q2, r], "precondition: the Q route exists at removal");
```

## Not findings (checked)

- Tests 1–6 (C1): ordering of errors, last-call-wins, lowest unknown id, headways of 8 and 16 ticks, and cost formulas with `lanes × sat` are all exact and pass. Overrides are kept if ignored (test 5 kills that), and `SAT_FLOW_PER_LANE` in `queue_term` is caught by test 6.
- Tests 10/11/14 distinguish hysteresis, budget, prefix keeping, P/Q alternation and "count not reset without space". A reroute on every tick ≥ 120 would fail test 11 (`blocked_ticks == reroutes × 120`).
- Tests 12/13: a removal counted as unreachable, as completed or as an exit count is caught. The C2 identities are checked every tick.
- Test 16: three_bridges, with and without the closure, never comes near 120.
- Hash coverage stays with Gold (it cannot be constructed via the public API). That is acceptable.

## Required for re-review

1. Add M1 (`stranding_resets_a_blocked_count`) and M2 (`gridlock_removal_records_no_exit_time`), and remove the "not constructible" sentence from the ward's Tests section.
2. Recommended: m1 test, m4 contract clause, m5 precondition. For m2/m3, either add tests or name them explicitly as Gold code-review items in the ward.
3. Candidate code: `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/proto2/sim-core/tests/red2_extra.rs` (passes on the reference; mutants switchable with `MUT=G3|E|COST|G2|ENTRY|RR|...` in `proto2/sim-core/src/world.rs`).
