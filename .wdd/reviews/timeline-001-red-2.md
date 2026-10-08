# timeline-001 Red review, round 2

**Verdict: REJECTED** (0 BLOCKER, 1 MAJOR, 5 MINOR)

Reviewed: `crates/sim-core/tests/timeline_001_snapshots.rs` at commit eebc162 (sha256 `e043a886ba14a8e9bb549c529b165267cd205faf1dafccfecb7f9f1af1d87a8c`), 17 test functions. I checked it against `.wdd/wards/timeline/ward-001.md`, `.wdd/epics/timeline.md` § T1 and § Measured basis, `livingcity.md`, CLAUDE.md, `crates/sim-core/src/world.rs`, and the r1 verdict. The r1 fixes are `git diff HEAD~1 HEAD`.

## What I ran
- **A scratch reference implementation** of T1 in a copy of `sim-core`, in the session scratchpad `red2-tl001/sim-core`. Nothing in the repo was changed apart from this file.
  - `Arc<Network>` / `Arc<DemandModel>`.
  - `Snapshot` = a world clone without the logs, without the command log, and with an empty router. `bytes()` = capacity × `size_of` over the snapshotted fields, including the route vectors and excluding the command log.
  - `Timeline` keeps the authoritative head logs and restores their prefix. `schedule` validates `InPast` and `UnknownLink` before it cuts.
  - **All 17 frozen tests pass** in the default test profile (opt-level 2, debug assertions on). They take 5.8 s, or 8.6 s wall time including the build. All earlier suites stay green with the `Arc` change. `cargo clippy --test timeline_001_snapshots` reports nothing.
- **Mutants**, each a feature flag on the scratch implementation, run against the frozen file:

  | Mutant | Frozen tests that catch it |
  |---|---|
  | `stale_router`: restore keeps the current router | 1, 11, 16 |
  | `drop_queues`: restore empties the reroute queues and the `in_priority` / `in_periodic` flags | 15 |
  | `snap_cmdlog`: restore uses a command log stored in the snapshot | 12, 12-off-grid |
  | `no_snap_after_edit`: no snapshots are taken after an edit | 12 |
  | `truncate_after_check`: cut before any validation | 12 |
  | `unknown_after_cut`: `InPast` checked, then cut, then `UnknownLink` (the r1 scratch order) | 12 |
  | `cut_ge`: an edit drops commands with tick **≥** position (pending commands at the position tick are lost) | **none** (M1) |
  | `evict_ge`: evicts one snapshot more than the budget requires | **none** (m2) |
  | `replay_from_oldest`: a seek replays from the oldest snapshot and reports `t − newest` | **none** (m3, known from r1 m2) |
  | `bytes_cmdlog`: `bytes()` also counts the command log | none. This is accounting only and is acceptable. |
- Probes, in the scratch `tests/probe_r2.rs`:
  - **Test 10's window:** `[2160, 2280, 2400]` with budget 151,624 B. Seeks to 2160 and 2197 match the reference.
  - **Test 15's precondition is real.** `max_budgeted_in_a_tick` is 10 up to tick 1919 and 200 at 1920. The queues are `(31, 6)` at the 1920 snapshot, and `switches_total` goes from 200 to 231 in step 1920.
  - **Test 9's eviction:** the correct implementation holds 4 snapshots from tick 2400 on, at 352–354 KB each with one = 344,954 B. `evict_ge` holds 3.
  - **`p_cut_keeps_pending_at_position`** (M1) passes the correct implementation and fails `cut_ge`.

## r1 findings: status
| r1 | Status | Evidence |
|---|---|---|
| B1 test 10 `seek(1500)` outside the window | **Resolved** | `:326-335` seeks `start` and `start + 37`, both compared with `r` by `observe`. Passes the reference. |
| B2 no restored reroute backlog | **Resolved** | Test 15 (`:487-515`). The precondition holds genuinely (see above), and `drop_queues` fails it. |
| M1 test 12 never seeks after the edit | **Resolved** | `:376-406` adds validation-before-cut, snapshot resumption and post-edit seeks; `:409-431` adds the off-grid variant. All three r1 mutants and `unknown_after_cut` are caught. |
| M2 spec gaps | **Resolved** | T1 and the ward now state that the command log is not in the snapshot, that the head logs are authoritative and installed on restore, and that validation comes first. |
| M3 no NoRoute or stranded vehicle in a snapshot | **Resolved** | Test 16 (`:518-554`), with the precondition asserted at every snapshot from 600 to 1080. |
| m1 release gating | **Resolved** | No `cfg_attr(..., ignore)` remains, and the default profile takes 5.8 s. |
| m2 test 7 is self-reported | **Not resolved, still MINOR** | See m3 below. |
| m3 test 3 wording | **Resolved** | Ward row 3 no longer claims the router is observably rebuilt, and a stale router is caught by tests 1, 11 and 16. A new problem with test 3's precondition is m4 below. |
| m4 test 13 tautology | **Partly resolved** | The demand-variation bytes check (`:444-456`) is in. The ward row still claims pointer equality for `DemandModel` (m1 below). |
| m5 test 9 over-eviction | **Partly resolved** | `>= 3` and the position check are in, but the bound is too loose (m2 below). |
| m6 test 2 past the old head | **Resolved** | `:104-108` |
| m7 API types in Outputs | **Resolved** | `WindowInfo`, `TimelineError` and `Snapshot::bytes` are pinned. |

## BLOCKER
None.

## MAJOR
### M1. An edit that drops the pending commands *at* the position tick passes every test (`timeline_001_snapshots.rs:366-431`)
- **What the spec says.** T1 and the ward Specification say the edit drops "every command with tick > `position_tick`". Commands at tick p are still pending at position p: `World::step` applies `c.tick == self.tick` (`world.rs:752`), and test 1 relies on this with `seek(1800)`.
- **What the mutant does.** `cut_ge` uses `retain(|c| c.tick < p)`. It is a one-character boundary bug, and a likely one: T2 in the same epic defines a branch with "the commands for ticks < `at_tick`".
- **Why no test catches it.** In both test 12 variants, the old log has no command at the edit tick: 600/2000 against an edit at 1200, and 600/1280 against an edit at 1250. So `cut_ge` passes all 17 tests.
- **Consequence.** In scenario B, a user pauses at tick p and closes X there. Later they seek back to p and close Y. With `cut_ge`, X silently disappears from B.
- **Fix** (verified: passes the reference implementation, fails `cut_ge`). Either add a command at the edit tick to test 12 before `step_n(3600)`, or add this test:
  ```rust
  #[test]
  fn schedule_in_past_keeps_commands_at_the_position() {
      let c = three_bridges(2026, 7);
      let (main, north, south) = (c.landmarks.central_bridge, c.landmarks.north_bridge, c.landmarks.south_bridge);
      let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
      tl.schedule(close(main[0], 600)).unwrap();
      tl.schedule(close(south[0], 1200)).unwrap(); // pending exactly at the edit position: kept
      tl.schedule(open(main[0], 2000)).unwrap();   // after it: dropped
      tl.step_n(3600);
      tl.seek(1200).unwrap();
      tl.schedule(close(north[0], 1200)).unwrap();
      assert_eq!(tl.world().command_log().len(), 3, "the command at the position tick is kept");
      let r = reference(world(&c.scenario, &[close(main[0], 600), close(south[0], 1200), close(north[0], 1200)]), 2400);
      for t in 1201..=2400u64 {
          tl.step();
          assert_eq!(tl.world().state_hash(), r[t as usize].hash, "tick {t}");
      }
  }
  ```
  Also add a ward row for it, or extend row 12.

## MINOR
1. **Ward row 13 still promises `DemandModel` pointer equality "via the accessors"** (`ward-001.md` row 13; test `:434-457`).
   - `World` has no `demand()` accessor and the Outputs add none, so `Arc<DemandModel>` itself is unverified. An implementation that keeps `demand: DemandModel` by value, and leaves it out of `bytes()`, passes.
   - **Fix:** reword the row to "Network pointer equality; demand excluded from `bytes()`", or add `World::demand() -> &DemandModel` to Outputs and assert `ptr::eq`.
2. **Test 9's over-eviction bound is one snapshot too loose** (`:307`).
   - The correct implementation holds 4 snapshots from tick 2400 to 7200: 4 × ~353 KB = 1.41 MB, against a budget of 1.72 MB. The `evict_ge` mutant holds 3 and passes.
   - **Fix:** assert `tl.window().snapshots >= 4`. That is robust as long as snapshots stay ≤ 1.25 × `one`, and they measure 1.02–1.03 ×.
   - Optionally, also assert `snapshots >= 4` at every step after 2400.
3. **The seek cost is still only self-reported** (`:249-260`; r1 m2).
   - `replay_from_oldest` produces correct state and reports `t − newest`, so it passes. This is unobservable without timing.
   - The ward's Verification does not ask the Gold reviewer to check it, and the smoke test's "in milliseconds" is ambiguous: 75 ms is also milliseconds.
   - **Fix:** in ward § Verification / Manual Smoke Test, make the Gold reviewer confirm in code that `seek` restores the newest snapshot ≤ t. Give the probe a numeric pass bound, for example median seek ≤ 5 ms at the 48 MiB window, where the measured basis gives ≤ 119 × 0.021 ms + a ~50 µs clone ≈ 2.6 ms.
4. **Test 3's precondition is tautological** (`:118`).
   - `budgeted_total` grows every tick even without a closure: 10,307 → 10,333 over ticks 1915–1919, before the 1919 closure in the probe. So `r[1840].reroute != r[1800].reroute` holds regardless.
   - **Fix:** check a quantity that only the closure moves, for example `switches_total` growing between 1800 and 1840 in a separate reference `World`, or drop the "precondition" label.
5. **The ward is out of sync with the file.**
   - `estimated_tests: 16`, but there are 17 functions: the off-grid variant is a separate `#[test]`.
   - The Tests table lists 15 and 16 before 14.
   - **Fix:** list the off-grid variant as its own row (or as 12b), set the count, and order the rows.

## Checked and OK
- **`observe()` is strong.** `state_hash` covers the logs, the command log, both RNG states, the queues, the EMA accumulators, credits, `rr_next` and the origin buffers. `metrics` / `reroute_stats` compare exact `Debug` strings.
- **Test 12's validation-before-cut check is independent for each error.** `UnknownLink` is sent at tick 1200 = position, so it cannot be masked by `InPast`. `before` includes the hash, head, snapshots and command log.
- **The off-grid variant would catch a stale log.** It drops `open@1280`, so `seek(1299)` / `seek(1300)` would catch a stale log even if test 12 did not.
- **Test 16's preconditions hold** at all five snapshots from 600 to 1080, with `retries_total > 0`. A stale router is caught there too.
- **Test 13's bigger demand is valid** (`from_scenario` accepts it), and its bytes equality holds on the reference implementation.
- **The other fixed points hold on the reference implementation:**
  - test 8's 150 KB–1.5 MB bounds and the 1.5× ratio;
  - test 9's tiny budget → `[960]`;
  - test 6's cadence, including the tick-50 start.
- **No conditional assertions** that can skip a check:
  - test 4's `if k > t` only skips the step at k = t;
  - test 15's `min(2200 − t)` stays in bounds.
- **No flakiness and no timing assertions.** The runtime is fine for the default `cargo test`.
- **The API used by the tests matches the ward Outputs** (`Timeline`, `TimelineError`, `WindowInfo`, `SNAPSHOT_INTERVAL_TICKS`, `World::snapshot`, `Snapshot::{tick, bytes}`).
