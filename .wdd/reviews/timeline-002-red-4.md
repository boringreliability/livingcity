# timeline-002 Red review, round 4

**Verdict: APPROVED-WITH-FIXES** (convergence rule; 0 BLOCKER, 1 MAJOR (verified-fixable test gap), 1 MINOR)

Reviewed: `crates/sim-core/tests/timeline_002_branch.rs` at commit d302bab (sha256 `0d5ed7568666192a2ead8c52a2947c00d9ec940d0ea92650fa27a1db12eb7336`), 18 test functions. I checked it against `.wdd/wards/timeline/ward-002.md`, `.wdd/epics/timeline.md` § T2, `livingcity.md`, CLAUDE.md, `crates/sim-core/src/{timeline,world}.rs` and the r1–r3 verdicts.

## What I ran
- **In the repo:** `cargo test -p sim-core --test timeline_002_branch --no-run`. The only errors come from the missing T2 API: 1× unresolved `WindowMetrics`, 20× no `Timeline::branch`, 10× no `window_metrics`.
- **Scratch reference implementation** (session scratchpad `red4-tl002/`, copied from r3's `red3-tl002/`):
  - I diffed it against the repo. Only `timeline.rs`, `world.rs` and `lib.rs` differ, and only by `Timeline::branch`, `WindowMetrics`, `World::window_metrics`, the env-switched mutants and the `pub(crate)` helpers.
  - I re-read `branch` and `window_metrics` and they match the ward spec.
  - **All 18 frozen tests pass in 7.6 s.**
- **Mutants:** all 25 from r1–r3, plus 4 new ones (`b_remfull`, `b_remempty`, `b_logsworld`, `b_ltidx`), run against the frozen file.

  | Mutant | Frozen tests that catch it |
  |---|---|
  | `b_le` | 1, 2, 3, 4 |
  | `b_all` | 1, 2, 3, 4, 9 |
  | `b_budget` | 6 |
  | `b_onlyat` | 5, 6, 18 |
  | `b_allsnap` | 5, 6, 9, 18 |
  | `b_dup` | 5, 9, 18 |
  | `b_keepold` | 6 |
  | `b_deep` | 1 |
  | `b_winpos` | 1, 5 |
  | `b_fast` | 3, 4 |
  | `b_cmdkeep` | 1, 2, 3, 4, 9 |
  | `b_idxdiv` (r3 M1) | **18 ✔** (newly caught) |
  | **new** `b_logsworld`: always slices the position world's logs, ignoring the held-aside head logs | 1 |
  | **new** `b_ltidx`: restore index from `partition_point(tick < at)` (underflows at a snapshot tick that is the window start) | 1, 9, 18 |
  | **new `b_remfull`**: B inherits the original's **whole** removal log instead of its prefix as of `at` | **none** (M1) |
  | **new `b_remempty`**: B's removal log is empty | **none** (M1) |
  | `w_ct` | 10–17 |
  | `w_norem` | 12, 16, 17 |
  | `w_floor` | 10, 12, 15, 16, 17 |
  | `w_interp` | 10, 15 |
  | `w_trunc` | 10 |
  | `w_spawn` | 15, 17 |
  | `w_kind` | 16 |
  | `w_live` | 15 |
  | `w_strict` | 10, 11, 12, 15, 17 |
  | `w_spawn_rem` | 17 |
  | `w_tts_all` | 13, 15 |
  | `w_nosort` | 10, 12, 15, 17 |
- **Re-probed premises** (scratch `tests/probe_red4.rs`):
  - **Row 18:** the window was evicted (`start > 0`), and all three `at` values pass on the reference.
  - **The removal count of the original in every branch test is 0.** These are the `counts()` at the scenario's head:

    | Test | `removed` |
    |---|---|
    | t1, River City at 3600 | 0 |
    | t4, River City at 5400 | 0 |
    | t2, three_bridges at 3000 | 0 |
    | t5 at 2400 | 0 |
    | t8 at 2400 | 0 |
    | t9 at 1500 | 0 |
    | t18 at 2400 | 0 |

## r1–r3 findings: resolution
- **r3 M1 (no branch from an evicted window): resolved.**
  - Test 18 (`:541-563`) is the r3 fix verbatim, and the ward has row 18 with `estimated_tests: 18`.
  - It kills `b_idxdiv`, `b_onlyat`, `b_allsnap`, `b_dup` and `b_ltidx`.
- **r3 m1 (row 6 text): resolved.** Ward row 6 now mentions oldest-first eviction and the budget-below-one-snapshot case.
- **r2 M1 and m1–m3, and r1 M1/M2: still resolved.** Tests 15–17 and the brute-force precondition are unchanged, and all their mutants are still killed.
- **r1 m4** (the cleanup items) is still untested by design. The Gold reviewer must confirm it in code.

## BLOCKER
None.

## MAJOR
1. **No branch test ever has a removal in the original, so "its logs are the original's logs as of `at`" is unverified for the removal log** (`timeline_002_branch.rs:78-94` row 1, `:146-157` row 4, `:261-284` row 9, `:541-563` row 18; ward Specification "Its logs are the original's logs as of `at`"; epic T2 "its logs are copies truncated at `at`").
   - **Verified** (probe above): every original that any branch test branches from has `counts().removed == 0` at its head.
   - **What goes untested:**
     - truncating the removal log at `at`;
     - restoring a snapshot whose removal-log length is above 0 in a branch;
     - B's `trip_outcome` and `window_metrics` once it has removals.
   - **The `b_remfull` and `b_remempty` mutants survive all 18 tests.** Both are plausible slips:
     - `b_remfull` copies the whole removal log, so B reports future removals (as `RemovedUnreachable`) that B never made. That corrupts exactly the window metrics the comparison panel shows.
     - `b_remempty` builds B with an empty removal log.
   - **This matters for the demo:** a closure in the demo produces unreachable or gridlock removals, and comparing scenarios is the reason branches exist.
   - **Fix:** add this as test 19 and set `estimated_tests: 19`.
     - **Verified** on the reference (scratch `tests/red4_fix.rs`): it passes in 0.01 s, the full file of 19 tests passes in 7.6 s, and clippy is clean.
     - It kills `b_remfull`, `b_remempty` and `b_logsworld`.
     - It covers both log paths: with A at its head (head logs `None`), and after `seek(1200)` with a branch at 2400 > position (head logs `Some`).
     - Its precondition (removals both before and after `at`) holds for both cases.

     ```rust
     // ─── 19 (Red r4 MAJOR 1) ─────────────────────────────────────────────────
     /// Branching an original that has removals before and after `at`: B's removal log is A's as of `at`.
     #[test]
     fn branch_truncates_the_removal_log() {
         let c = three_bridges(2026, 7);
         let lm = c.landmarks;
         let cmds: Vec<Command> = [lm.north_bridge, lm.central_bridge, lm.south_bridge]
             .into_iter()
             .flatten()
             .map(|l| close(l, 500))
             .collect();
         let mut a = Timeline::new(world(&c.scenario, &cmds), UNLIMITED);
         a.step_n(3000);
         let head_removed = a.world().counts().removed;
         for (seek_to, at) in [(None, 1500u64), (Some(1200u64), 2400)] {
             if let Some(t) = seek_to {
                 a.seek(t).unwrap(); // the head logs are now held aside: branch must truncate those too
             }
             let mut r = stepped(&c.scenario, &cmds, at);
             let removed_at = r.counts().removed;
             assert!(removed_at > 0 && removed_at < head_removed, "precondition: removals before and after {at} ({removed_at} of {head_removed})");
             let mut b = a.branch(at, UNLIMITED).unwrap();
             assert_eq!(observe(b.world()), observe(&r), "branch({at})");
             assert_eq!(b.world().counts().removed, removed_at);
             assert_metrics_eq(&b.world().window_metrics(0), &brute(&r, 0), &format!("branch({at}) window"));
             b.step_n(300);
             for _ in 0..300 {
                 r.step();
             }
             assert_eq!(observe(b.world()), observe(&r), "branch({at}) + 300");
         }
     }
     ```

## MINOR
1. **The ward needs row 19 and `estimated_tests: 19` together with the M1 fix** (`ward-002.md` Tests table and front matter).
   - **Text:** `| 19 | branch_truncates_the_removal_log | three_bridges with all bridges closed at 500, run to 3000 (removals before and after each at). branch(1500) at the head and branch(2400) after seek(1200): B equals the reference (hash, logs, metrics), its removal count is the reference's, its window metrics equal brute force, and 300 ticks later it still equals the reference |`

## Checked and OK
- **`observe` omits the removal log, but this is not a gap:** `state_hash` hashes it (`world.rs:743-744`). The M1 gap exists only because no scenario has any removals.
- **Branch invariants are well covered:**
  - the original is unchanged, also with its position behind the head;
  - commands are inherited only for `tick < at`;
  - demand is identical across scenarios;
  - each side evolves independently;
  - history before `at` matches the original;
  - eviction is oldest-first;
  - an evicted window and branch of a branch both work;
  - `Arc` sharing holds.
- **Window metrics:** every field is discriminated by surviving-mutant analysis, as in r3.
- **Ward vs tests:** rows 1–18 match the 18 functions, and the API matches the Outputs.
- **No flakiness:** there are no timing assertions and no HashMap. Runtime is 7.6 s for 18 tests, or 7.6 s with test 19 added.
