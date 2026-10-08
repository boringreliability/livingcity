# timeline-002 Red review, round 2

**Verdict: REJECTED** (0 BLOCKER, 1 MAJOR, 3 MINOR)

Reviewed: `crates/sim-core/tests/timeline_002_branch.rs` at commit 1d41a8a (sha256 `2214fe14d602dd40aa50f7f01dec5d96c5f66cf53d5075274f211ad48681d1fc`), 16 test functions. I checked it against `.wdd/wards/timeline/ward-002.md`, `.wdd/epics/timeline.md` § T2, `livingcity.md`, CLAUDE.md, `crates/sim-core/src/{timeline,world}.rs`, and the r1 verdict `timeline-002-red-1.md`.

## What I ran
- **In the repo:** `cargo test -p sim-core --test timeline_002_branch --no-run`. The only errors come from the missing T2 API: 1× unresolved `WindowMetrics`, 18× no `Timeline::branch`, 10× no `window_metrics`.
- **Scratch reference implementation** (session scratchpad `red2-tl002/`, copied from r1's `red-tl002/`):
  - I re-read it before using it. `branch` restores the newest snapshot ≤ `at` with a head-log prefix and the commands with `tick < at`, replays, copies the snapshots with tick < `at` with front eviction, then pushes `at`. `window_metrics` is the cohort `generated[partition_point..]` with binary-search membership and nearest-rank p95.
  - **All 16 frozen tests pass in 7.0 s.** All other sim-core suites stay green, and clippy reports nothing on the test file.
- **Mutants:** all 15 from r1, plus 4 new ones, run against the frozen file.

  | Mutant | Frozen tests that catch it |
  |---|---|
  | `b_le`, `b_all`, `b_budget`, `b_onlyat`, `b_allsnap`, `b_dup` | caught as in r1 (1–4, 6, 5/6/9) |
  | `b_keepold` (r1 m1) | 6 ✔ (newly caught) |
  | **new** `b_deep`: the branch deep-clones the network and demand (r1 m2) | 1 ✔ |
  | `w_ct`, `w_norem`, `w_floor`, `w_interp`, `w_trunc` | caught |
  | `w_spawn` (r1 M1) | 15 ✔ (newly caught) |
  | `w_kind` (r1 M2) | 16 ✔ (newly caught) |
  | **new** `w_live`: `incomplete` counts the live vehicles with `created_tick ≥ from`, spawns included | 15 |
  | **new** `w_strict`: the cohort uses `created_tick > from` | 10, 11, 12, 15 |
  | **new `w_spawn_rem`**: removals counted by `trip_id ≥ first cohort id`, completions correct | **none** (M1) |
- **Re-probed rows 15 and 16** (scratch `tests/probe_red2.rs`). Both hold exactly.
  - **Row 15:** 661 spawned and 641 generated. The cohort results (generated, completed, removed_unreachable, removed_gridlock, incomplete) are:
    - from 0: (641, 475, 0, 0, 166)
    - from 600: (433, 267, 0, 0, 166)
    - from 1000: (285, 119, 0, 0, 166)
    - No removals happen in this world.
  - **Row 16:** at 4000, from 0 gives (2687, 10, 0, 15, 2662). From 500 and 2000, the cohorts have **no** completions or removals: (2357, 0, 0, 0, 2357) and (1322, 0, 0, 0, 1322).

## r1 findings: resolution
- **M1 (spawns mixed with demand): partly resolved.** Test 15 kills `w_spawn`, but only on the completions side. No world has an explicit spawn that gets *removed* alongside a demand cohort, so the removal half of the same Must-NOT is still open. See M1 below.
- **M2 (gridlock never non-zero): resolved.** Test 16 has 15 demand gridlock removals and kills `w_kind`.
- **m1 (eviction order): resolved.** `ends_with` at `:204` kills `b_keepold`.
- **m2 (`Arc` sharing): resolved.** `ptr::eq` at `:91-92` kills `b_deep`.
- **m3 (cost wording): resolved.** It now reads "linear in the logs plus a sort".
- **m4 (cleanup items):** still untested by design. The Gold reviewer must confirm them in code, as r1 said.

## BLOCKER
None.

## MAJOR
1. **Removed explicit spawns among demand are never tested, so the removal half of "Count explicit spawns as demand" is unguarded** (`timeline_002_branch.rs:463-481`, row 15; and rows 12, 13 and 16).
   - The `w_spawn_rem` mutant gets completions right but counts a removal as a cohort member when `trip_id ≥ first cohort trip id`. It passes all 16 tests:
     - Row 15 has no removals.
     - Rows 12 and 16 have no spawns.
     - Row 13 has an empty cohort.
   - `RemovalLog` holds only `(trip_id, kind)` with no created tick, so this id-range shortcut is the natural fast path for removals. Spawned ids interleave with demand ids, which makes it wrong.
   - **Fix:** add this test. It is verified on the reference implementation (0.02 s). It kills `w_spawn_rem` (from 0 gives `removed_unreachable` 768 vs the true 758, and `incomplete` 241 vs 251), and it also kills `w_spawn`.
     ```rust
     /// Explicit spawns interleaved with demand that end up removed are not cohort removals.
     #[test]
     fn window_metrics_exclude_removed_spawns() {
         let c = three_bridges(2026, 7);
         let lm = c.landmarks;
         let cmds: Vec<Command> = [lm.north_bridge, lm.central_bridge, lm.south_bridge]
             .into_iter()
             .flatten()
             .map(|l| close(l, 500))
             .collect();
         let mut w = world(&c.scenario, &cmds);
         let zones: Vec<_> = c.zones.iter().map(|z| z.node).collect();
         for t in 0..3000u64 {
             if (300..500).contains(&t) && t % 20 == 0 {
                 let (r, _) = w.shortest_route(zones[0], zones[zones.len() - 1]).unwrap();
                 w.spawn_with_route(r).unwrap();
             }
             w.step();
         }
         let m = brute(&w, 0);
         assert!(w.counts().removed > m.removed_unreachable + m.removed_gridlock, "precondition: removed explicit spawns");
         for from in [0u64, 400, 1000] {
             assert_metrics_eq(&w.window_metrics(from), &brute(&w, from), &format!("removed spawns, from {from}"));
         }
     }
     ```
     - **Probed:** 1,123 spawned, 1,113 generated. All 10 spawns are removed as unreachable. The demand cohorts are unchanged from row 12: 758 / 720 / 506 removed for from 0 / 400 / 1000.
     - Add it as row 17 and set `estimated_tests: 17`.

## MINOR
1. **Row 16's precondition reads the implementation under test** (`:503-504`): `w.window_metrics(0)` decides whether the scenario has gridlock removals.
   - It is not unsound, because the brute comparison follows. But a wrong implementation then fails with a misleading "precondition" message.
   - **Fix:** use `brute(&w, 0)` in the precondition.
2. **Row 16's from 500 and 2000 are trivial cohorts.** Every trip is incomplete, with no completions or removals (probed), so only from 0 discriminates anything.
   - **Fix:** either drop them, or document that they only check `generated` and `incomplete`. They are harmless.
3. **A branch budget smaller than one snapshot is untested.** "Exactly as `Timeline::new` + step" implies that only `at` is kept, with `snapshot_bytes > budget` allowed.
   - **Fix (optional):** in test 6, add `assert_eq!(a.branch(1500, 0).unwrap().snapshot_ticks(), vec![1500]);`.

## Checked and OK
- **Rows 15 and 16 premises:** re-probed exactly (above). Row 14's numbers were probed in r1 and are unchanged by this diff.
- **The `ptr::eq` checks are sound.** `network()` and `demand()` deref `Arc<Network>` and `Arc<DemandModel>`, so shared `Arc`s give equal pointers, and a deep clone fails.
- **Branch logs, including the removal log, are covered through `state_hash`.** It hashes `removed_log`, `completed_log` and `generated`, so test 1's `observe` catches any log not truncated at `at`.
- **The precondition in test 15 is valid.** `counts().spawned` includes demand spawns: 661 = 641 + 20.
- **Ward and tests are in sync.** `estimated_tests: 16` matches 16 functions, rows 15 and 16 match their tests, and the imports (`DemandModel`, `OdFlow`) exist.
- **No flakiness:** no timing assertions and no HashMap. Runtime is 7.0 s in the default profile.
