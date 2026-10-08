# timeline-002 Red review, round 1

**Verdict: REJECTED** (0 BLOCKER, 2 MAJOR, 4 MINOR)

Reviewed: `crates/sim-core/tests/timeline_002_branch.rs` at commit cc90fa2 (sha256 `bc58a0e147d231240303f4479f9ca8f4d2c5206d9f97c448a35fa15dc2fc48a6`), 14 test functions. I checked it against `.wdd/wards/timeline/ward-002.md`, `.wdd/epics/timeline.md` § T2, `livingcity.md` (§ Replay and branching, § Meaningful metrics), CLAUDE.md, and `crates/sim-core/src/{timeline,world}.rs`.

## What I ran
- **In the repo:** `cargo test -p sim-core --test timeline_002_branch --no-run`. The only errors are the missing T2 API: the unresolved `WindowMetrics` import, 18× no `Timeline::branch`, 7× no `World::window_metrics`.
- **A scratch reference implementation** (session scratchpad `red-tl002/`). Nothing in the repo was changed apart from this file.
  - `branch`: validate the window, restore the newest snapshot ≤ `at` with the head-log prefix and the commands with `tick < at`, replay, copy the snapshots with tick < `at` in order with front eviction to the new budget, then push the snapshot at `at`.
  - `window_metrics`: the cohort is `generated[partition_point(created_tick < from)..]`. Completions and removals are counted by binary-searching their trip id in the cohort. p95 uses nearest rank `ceil(0.95 n)`.
  - **All 14 frozen tests pass** in 7.5 s. All other suites stay green, and `cargo clippy --test timeline_002_branch` reports nothing.
- **Mutants** (env-switched on the scratch implementation, run against the frozen file):

  | Mutant | Frozen tests that catch it |
  |---|---|
  | `b_le`: the branch inherits commands with tick ≤ at | 1, 2, 3, 4 |
  | `b_all`: the branch inherits every command | 1, 2, 3, 4, 9 |
  | `b_budget`: the branch uses the original's budget | 6 |
  | `b_onlyat`: only the snapshot at `at` | 5, 6 |
  | `b_allsnap`: copies the snapshots after `at` too | 5, 6, 9 |
  | `b_dup`: copies tick ≤ at, then pushes `at` again | 5, 9 |
  | `w_ct`: completions by `completed_tick ≥ from` | 10, 11, 12, 13, 14 |
  | `w_norem`: ignores removals | 12 |
  | `w_floor`: p95 rank `floor(0.95 n)` | 10, 12 |
  | `w_interp`: p95 at `round(0.95 (n−1))` | 10 |
  | `w_trunc`: p95 at index `trunc(0.95 n)` | 10 |
  | **`w_spawn`**: completions by `CompletedTrip.created_tick ≥ from`, removals by `trip_id ≥ first cohort id`, early return on an empty cohort | **none** (M1) |
  | **`w_kind`**: every removal counted as `removed_unreachable` | **none** (M2) |
  | **`b_keepold`**: copies the oldest snapshots until the budget is full, then pushes `at` (gap in the window) | **none** (m1) |
- **Probes** (scratch `tests/probe_red1.rs`, `probe_red1b.rs`):
  - **Row 14 holds exactly.** At 1800 + 2400 ticks (20 sim min), `generated` is 7,205 on both sides, and `incomplete` is B 2,010 vs A 1,657. At +10 min it is 1,724 vs 1,610. `completed` is 5,195 vs 5,548. Neither side has removals.
  - **Row 12 holds.** The first unreachable removal is at tick 1101. At 3000, `removed_unreachable` is 758 / 720 / 506 for from 0 / 400 / 1000. `completed` is 0 for from 400 and 1000, so the travel-time fields are only exercised at from 0.
  - **No cohort in any frozen test has a gridlock removal.** River City with the closure to 4200, three_bridges with all bridges closed to 3000, and both sides of row 14 all have `removed_gridlock` = 0. Row 13's ring has gridlock removals, but they are explicit spawns, so its cohort is empty.
  - **Runtime.** `brute()` over 12,670 trips takes 28 ms with `trip_outcome`'s linear scans, and `window_metrics` takes 2.3 ms. Not a problem.

## BLOCKER
None.

## MAJOR
1. **Explicit spawns mixed with demand are never tested, so the natural fast implementation survives** (`timeline_002_branch.rs:393-437`, row 13).
   - Must NOT: "Count explicit spawns as demand." Row 13 uses a world with **no demand at all**, so `generated` = 0. The obvious efficient implementation passes it whenever it returns early on an empty cohort:
     - completions filtered by `CompletedTrip.created_tick ≥ from`;
     - removals filtered by `trip_id ≥ first cohort trip id`.
   - That implementation is wrong as soon as a demand world also has explicit spawns, because spawned ids interleave with demand ids. The `w_spawn` mutant passes all 14 tests. On a mixed three_bridges world it reports `completed` 485 vs the true 475, and `incomplete` 156 vs 166.
   - Every demand test (10, 11, 12, 14) uses a pure-demand city, so nothing else catches it.
   - **Fix:** add the test below. It is verified to pass on the reference implementation in 0.03 s, and it kills `w_spawn`.
     ```rust
     /// Demand plus explicit spawns interleaved after `from`: spawns are never in the cohort.
     #[test]
     fn window_metrics_exclude_spawns_mixed_with_demand() {
         let c = three_bridges(2026, 7);
         let mut w = World::from_scenario(c.scenario.clone()).unwrap();
         let zones: Vec<_> = c.zones.iter().map(|z| z.node).collect();
         for t in 0..1800u64 {
             if t >= 600 && t % 60 == 0 {
                 let (r, _) = w.shortest_route(zones[0], zones[zones.len() - 1]).unwrap();
                 w.spawn_with_route(r).unwrap();
             }
             w.step();
         }
         assert!(w.counts().spawned > w.generated_trips().len() as u64, "precondition: explicit spawns exist");
         for from in [0u64, 600, 1000] {
             assert_metrics_eq(&w.window_metrics(from), &brute(&w, from), &format!("mixed, from {from}"));
         }
     }
     ```
     (Probed: 661 spawned, 641 generated. From 0 the result is (641, 475, 0, 0, 166).)
2. **`removed_gridlock` is never non-zero in any cohort, so the field is effectively untested** (rows 10–14, `:285-391`).
   - The `w_kind` mutant counts every removal as unreachable, or equally swaps the two kinds. It passes all 14 tests, because every tested demand cohort has `removed_gridlock` = 0 (see the probes). The ring in row 13 has gridlock removals, but only for explicit spawns.
   - The comparison panel shows this field, and the partition `generated = completed + removed_unreachable + removed_gridlock + incomplete` cannot detect a misclassification.
   - **Fix:** add a demand-driven gridlock. It is verified on the reference implementation (0.03 s). It produces 15 gridlock removals, and it kills `w_kind`.
     ```rust
     /// Demand-driven ring: every flow goes three quarters round a one-way ring, so it deadlocks.
     #[test]
     fn window_metrics_count_gridlock_removals() {
         let mut b = NetworkBuilder::new();
         let side = 75.0;
         let n = [b.node(0.0, 0.0), b.node(side, 0.0), b.node(side, side), b.node(0.0, side)];
         for i in 0..4 {
             b.link(n[i], n[(i + 1) % 4], 10.0, 1);
         }
         let zpos = [(-150.0, 0.0), (side + 150.0, 0.0), (side + 150.0, side), (-150.0, side)];
         let z: Vec<_> = (0..4).map(|i| b.zone(zpos[i].0, zpos[i].1)).collect();
         for i in 0..4 {
             b.link(z[i], n[i], 10.0, 1);
             b.link(n[i], z[i], 10.0, 1);
         }
         let network = b.build().unwrap();
         let flows = (0..4).map(|i| OdFlow { origin: z[i], dest: z[(i + 3) % 4], veh_per_hour: 1200.0 }).collect();
         let s = Scenario { network, demand: DemandModel { flows, profile: Default::default() }, demand_seed: 1, behavior_seed: 2 };
         let w = stepped(&s, &[], 4000);
         let m = w.window_metrics(0);
         assert!(m.removed_gridlock > 0 && m.removed_unreachable == 0, "precondition: demand gridlock removals {m:?}");
         for from in [0u64, 500, 2000] {
             assert_metrics_eq(&w.window_metrics(from), &brute(&w, from), &format!("gridlock, from {from}"));
         }
     }
     ```
     (Probed: at 4000, from 0 gives (2687, 10, 0, 15, 2662). The imports need `DemandModel, OdFlow`.)

## MINOR
1. **Branch eviction order is unchecked** (`:190-202`, row 6).
   - Spec: "Older ones are evicted to fit `budget`, exactly as in `Timeline::new` + step." The `b_keepold` mutant copies the oldest snapshots until the budget is full, then pushes `at`. It gives `[120, 240, 360, 1500]` instead of `[1320, 1440, 1500]` and passes all 14 tests.
   - The resulting window has a gap. `window_start` overstates the history, and a seek to 1400 replays 1,040 ticks.
   - **Fix** (verified): in test 6, add `assert!(full.snapshot_ticks().ends_with(&small.snapshot_ticks()), "evicts the oldest");`.
2. **"Shares only `Arc` data" is unchecked** (row 1 and the spec). A branch that deep-clones the network or demand passes.
   - **Fix** (verified): in test 1 or 9, add `assert!(std::ptr::eq(a.world().demand(), b.world().demand()) && std::ptr::eq(a.world().network(), b.world().network()));`.
3. **The cost statement in the ward is not achievable as written** (`ward-002.md` § Specification, "The cost is O(log size)").
   - A nearest-rank p95 and a mean over the completed cohort cannot be computed in O(log n) without an order-statistic structure. The reference implementation is O(n + k log k), and takes 2.3 ms on 12.7k trips.
   - **Fix:** reword it to "linear in the logs (plus sorting the cohort's completed travel times); not for per-tick hot paths". Otherwise the Gold reviewer has a spec line that no reasonable implementation meets.
4. **The ward's cleanup outputs have no tests.** These are: `log_lens` removed, the doc moved, `seek` moving instead of copying the command log, and the `head_logs` doc. They are refactors or docs, so this is acceptable. **The Gold reviewer must confirm them in code**, and must confirm that `gold_timeline001.rs` and `timeline_001_snapshots.rs` stay green and unchanged.

## Checked and OK
- **`brute()` relying on `trip_outcome`** (`:285-318`) is acceptable.
  - `trip_outcome` is an existing, separately tested C4 API (`city_003_inspect.rs`). It derives everything from `slots`, `completed_log` and `removed_log` by linear search.
  - The cohort definition in `brute` (`generated_trips()` filtered by `created_tick ≥ from`) is independent of how an implementation selects the cohort.
  - An implementation that itself calls `trip_outcome` per cohort trip is correct by construction, only slower.
  - What `brute` cannot catch is a bug inside `trip_outcome` itself. That is out of scope here, and covered by the core tests.
  - What the frozen data cannot catch is M1/M2: the brute force is right, but the inputs never contain spawns among demand, or gridlocked demand.
- **The p95 nearest rank is discriminated.** Floor, trunc and interpolation variants all die on test 10. The travel-time ties did not mask them.
- **Branch invariants.**
  - The original is untouched (fingerprint, tests 1 and 7). Test 1 runs with the position behind the head (2222), and branches at both sides of the position, including the head logs.
  - `tick < at` is checked (tests 2 and 3; `b_le` dies on four tests).
  - Demand is identical across branches (test 4, all fields of `GeneratedTrip`).
  - Independent evolution is checked per tick against references (tests 3 and 8).
  - History before `at` is checked (test 5).
  - A branch of a branch combines inherited and own commands (test 9).
- **Numeric premises re-probed:** rows 12 and 14 hold exactly (see the probes).
- **Ward and tests are in sync.** `estimated_tests: 14` matches 14 functions, and every row matches its test. Outputs match the API used: `branch(at, budget)`, `window_metrics`, the `WindowMetrics` fields, and the crate-root re-export.
- **No flakiness:** no timing assertions and no HashMap. Runtime is 7.5 s in the default profile.
