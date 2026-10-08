# timeline-002 Red review, round 3

**Verdict: REJECTED** (0 BLOCKER, 1 MAJOR, 1 MINOR)

Reviewed: `crates/sim-core/tests/timeline_002_branch.rs` at commit 1f2ef0b (sha256 `5c5b11df104b8bfba4b15bf0f8ad3f825f3edd947d4518a6e361dbb2bdf8dc71`), 17 test functions. I checked it against `.wdd/wards/timeline/ward-002.md`, `.wdd/epics/timeline.md` § T2, `livingcity.md`, CLAUDE.md, `crates/sim-core/src/{timeline,world}.rs`, and the r1 and r2 verdicts.

## What I ran
- **In the repo:** `cargo test -p sim-core --test timeline_002_branch --no-run`. The only errors come from the missing T2 API: 1× unresolved `WindowMetrics`, 19× no `Timeline::branch`, 10× no `window_metrics`.
- **Scratch reference implementation** (session scratchpad `red3-tl002/`, copied from r2's `red2-tl002/`):
  - I re-read it before using it. Apart from the env-switched mutants, its only differences from the repo are `Timeline::branch`, `WindowMetrics`, `World::window_metrics` and two `pub(crate)` helpers. It matches the ward spec:
    - `branch` restores the newest snapshot ≤ `at` (via `partition_point`), using the head-log prefix and the commands with `tick < at`, and replays to `at`.
    - It then copies the snapshots with tick < `at`, evicting from the front, and pushes `at`.
    - `window_metrics` takes the cohort as `generated[partition_point(created < from)..]`, tests id membership by binary search, and uses nearest-rank p95.
  - **All 17 frozen tests pass in 6.8 s**, and clippy reports nothing for the test file.
- **Mutants:** all 19 from r1 and r2, plus 6 new ones, run against the frozen file.

  | Mutant | Frozen tests that catch it |
  |---|---|
  | `b_le` | 1, 2, 3, 4 |
  | `b_all` | 1, 2, 3, 4, 9 |
  | `b_budget` | 6 |
  | `b_onlyat` | 5, 6 |
  | `b_allsnap` | 5, 6, 9 |
  | `b_dup` | 5, 9 |
  | `b_keepold` | 6 |
  | `b_deep` | 1 |
  | `w_ct` | 10–17 |
  | `w_norem` | 12, 16, 17 |
  | `w_floor` | 10, 12, 15, 16, 17 |
  | `w_interp` | 10, 15 |
  | `w_trunc` | 10 |
  | `w_spawn` | 15, 17 |
  | `w_kind` | 16 |
  | `w_live` | 15 |
  | `w_strict` | 10, 11, 12, 15, 17 |
  | `w_spawn_rem` (r2 M1) | **17 ✔** (newly caught) |
  | **new** `b_winpos`: refuses `at > position` instead of `at > head` | 1, 5 |
  | **new** `b_fast`: when `at == position`, clones the live world unfiltered | 3, 4 |
  | **new** `b_cmdkeep`: inherits the full command log after the replay | 1, 2, 3, 4, 9 |
  | **new** `w_tts_all`: correct counts, but travel times include completed explicit spawns | 13, 15 |
  | **new** `w_nosort`: p95 taken from unsorted travel times | 10, 12, 15, 17 |
  | **new `b_idxdiv`**: snapshot index = `at / SNAPSHOT_INTERVAL_TICKS`, which assumes nothing was evicted | **none** (M1) |
- **Re-probed premises** (scratch `tests/probe_red3.rs`). All hold exactly.
  - **Row 14:** `generated` is 7,205 on both sides. `incomplete` is B 2,010 vs A 1,657 (`completed` 5,195 vs 5,548). At +10 min it is 1,724 vs 1,610.
  - **Row 17:** 1,123 spawned and 1,113 generated. The 10 spawns (ids 113 … 181, interleaved with demand) all end as `RemovedUnreachable`.
    - The demand cohorts give `removed_unreachable` 758 / 720 / 506 for from 0 / 400 / 1000.
    - The first cohort ids are 0, 148 and 366, so the id-range shortcut over-counts at both from 0 and from 400.
  - Row 15 (661 / 641) and row 16 (15 gridlock removals) were probed in r2 with an unchanged scenario. The r2 diff only switches row 16's precondition to `brute`.

## r2 findings: resolution
- **M1 (removed spawns among demand): resolved.** Test 17 (`:513-537`) kills `w_spawn_rem` and also `w_spawn`. Its precondition `counts().removed > brute removals` is sound, because `counts().removed` includes the removed spawns (768 = 758 + 10).
- **m1 (precondition read the implementation under test): resolved.** `:504` now uses `brute(&w, 0)`.
- **m2 (row 16's trivial cohorts): resolved.** A comment at `:506` documents them.
- **m3 (budget below one snapshot): resolved.** `:205` asserts `branch(1500, 0)` gives `[1500]`, which matches `push_snapshot`'s `len() > 1` guard.
- **r1 m4** (the cleanup items) is still untested by design. The Gold reviewer must confirm it in code.

## BLOCKER
None.

## MAJOR
1. **No branch is ever taken from an original whose window has evicted snapshots, so the production configuration is untested** (`timeline_002_branch.rs:261-284`, row 9; `:208-228`, row 7).
   - **Every positive `branch` call runs on an original with `UNLIMITED` budget.** In that setup `window_start` = 0 and the snapshots sit exactly at 0, 120, 240 and so on.
   - **Row 9's "branching at `window_start`" is therefore only the degenerate `branch(0)`.** The only budgeted original, in test 7, is used solely for refusals.
   - **The real app always runs with a finite replay budget** (livingcity.md: "explicit memory budget"). After a few minutes of sim, every branch the demo makes comes from an evicted window.
   - **The `b_idxdiv` mutant survives all 17 tests.** It locates the restore snapshot as `snapshots[at / 120]`, a natural shortcut. Once eviction has happened it picks a snapshot later than `at`, and then it panics on underflow or restores the wrong state.
   - **The frozen tests also never check, with an evicted original, that:**
     - B's copied snapshots are the original's retained ticks below `at`;
     - `window_start(B)` equals the original's `window_start`.
   - **Fix:** add this test as row 18 and set `estimated_tests: 18`.
     - Verified on the reference implementation: it passes in 0.02 s. The window is `[2160, 2280, 2400]`, so `at` ∈ {2160, 2210, 2393}.
     - It kills `b_idxdiv`, which panics at the first `at`.

     ```rust
     /// Branching inside a budgeted, already-evicted window (the production configuration).
     #[test]
     fn branch_inside_an_evicted_window() {
         let c = three_bridges(2026, 7);
         let lm = c.landmarks;
         let cmds = [close(lm.central_bridge[0], 1500)];
         let mut sizer = World::from_scenario(c.scenario.clone()).unwrap();
         for _ in 0..600 {
             sizer.step();
         }
         let mut a = Timeline::new(world(&c.scenario, &cmds), 4 * sizer.snapshot().bytes());
         a.step_n(2400);
         let start = a.window().window_start;
         assert!(start > 0, "precondition: eviction happened");
         for at in [start, start + 50, 2400 - 7] {
             let b = a.branch(at, UNLIMITED).unwrap();
             let inherited: Vec<Command> = cmds.iter().copied().filter(|c| c.tick < at).collect();
             assert_eq!(observe(b.world()), observe(&stepped(&c.scenario, &inherited, at)), "branch({at}) of an evicted window");
             let mut want: Vec<u64> = a.snapshot_ticks().into_iter().filter(|&t| t < at).collect();
             want.push(at);
             assert_eq!(b.snapshot_ticks(), want);
             assert_eq!(b.window().window_start, start);
         }
     }
     ```

## MINOR
1. **Row 6 in the ward no longer describes test 6** (`ward-002.md` row 6 vs `timeline_002_branch.rs:204-205`).
   - The test now also asserts the oldest-first eviction (`ends_with`) and the budget-0 case (`[1500]`). The row mentions neither.
   - **Fix:** extend row 6 with: "the budget evicts the oldest copies (no gap); a budget below one snapshot keeps only `at`".

## Checked and OK
- **`brute` is consistent with the spec.**
  - Its travel time, `trip_outcome`'s `(completed − created) × DT`, is exactly the ward's definition.
  - The cohort selection (`generated_trips()` filtered by `created_tick ≥ from`) is independent of the implementation.
- **The branch invariants are well covered.** No surviving mutant other than M1:
  - the original is unchanged, including with its position behind the head;
  - commands are inherited only for `tick < at`, with no pending command at `at`;
  - demand is identical across the scenarios;
  - each side evolves independently, checked per tick;
  - history before `at` matches the original;
  - eviction order and the `Arc` sharing hold;
  - a branch of a branch behaves correctly.
- **The window metrics are discriminated on every field:** the cohort boundary, the removal kinds, completed and removed spawns among demand, the p95 rank variants, the travel-time source, and sorting.
- **Ward and tests are in sync except m1.** `estimated_tests: 17` matches 17 functions, and the API used matches the Outputs.
- **No flakiness:** there are no timing assertions and no HashMap. Runtime is 6.8 s in the default test profile (`opt-level = 2`).
