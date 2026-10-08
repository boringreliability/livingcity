# timeline-001 Red review, round 3

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 2 MINOR)

Reviewed: `crates/sim-core/tests/timeline_001_snapshots.rs` at commit f54986b (sha256 `cbc3931f8160fe79c908f99e1ba6813fcec2268e8726d43f4426643cf0332567`), 18 test functions. I checked it against `.wdd/wards/timeline/ward-001.md`, `.wdd/epics/timeline.md` § T1 and § Measured basis, `livingcity.md`, CLAUDE.md, `crates/sim-core/src/world.rs` (fields, `state_hash`), and the r1 and r2 verdicts. The r2 fixes are `git diff HEAD~1 HEAD`.

## What I ran
- **In the repo:** `cargo test -p sim-core --test timeline_001_snapshots --no-run`. The only errors are the missing API: the unresolved `Timeline` / `TimelineError` / `SNAPSHOT_INTERVAL_TICKS` imports, 7× no `World::snapshot` and 3× no `World::demand`.
- **A scratch reference implementation**, in the session scratchpad `red3-tl001/sim-core`. Nothing in the repo was changed apart from this file.
  - It is a copy of the r2 implementation, which I reviewed:
    - restore clones the snapshot world, installs the timeline's current command log, takes the head-log prefixes and leaves the router empty;
    - `schedule` validates before it cuts;
    - the cut keeps commands with tick ≤ p, drops snapshots with tick > p, truncates the head logs and sets head = p.
  - I added `World::demand() -> &DemandModel`.
  - **All 18 frozen tests pass** in the default test profile in 5.8 s, or 8.9 s wall time including the build.
  - All earlier suites stay green.
  - `cargo clippy --test timeline_001_snapshots` reports nothing.
- **Mutants**, each a feature flag on the scratch implementation, run against the frozen file:

  | Mutant | Frozen tests that catch it |
  |---|---|
  | `stale_router` | 1, 11, 16 |
  | `snap_cmdlog` | 12, 12b |
  | `no_snap_after_edit` | 12 |
  | `truncate_after_check` | 12 |
  | `drop_queues` | 15 |
  | `unknown_after_cut` | 12 |
  | `cut_ge`: an edit drops the commands at the position tick (r2 M1) | **17** |
  | `evict_ge`: one snapshot too many is evicted (r2 m2) | **9** |
  | `replay_from_oldest` | none. This was accepted in r2 and is now delegated to the Gold reviewer in ward § Verification, with a numeric seek bound in the smoke test. |
  | `bytes_cmdlog` | none. Accounting only, accepted in r2. |
  | `window_bytes_zero`: `window().snapshot_bytes` reports 0 (new) | **none** (m1) |
- **Probes** (scratch `tests/probe_r3.rs`):
  - **Test 3's new precondition is genuine.** Without a closure, `switches_total` is 0 at both 1800 and 1840. With the closure at 1800 it is 0 → 200 (tick 1801) → 225 (tick 1840).
  - **Test 9 has margin.** The correct implementation holds 4 snapshots at 7200 (1,411,196 B against a budget of 1,724,770 B, with one = 344,954 B). After tick 2400, `snapshot_bytes / (snapshots × one)` is ≥ 1.0008.
  - `Timeline::new(w).window().snapshot_bytes == w.snapshot().bytes()` (55,734 B for River City at tick 0).
- **`state_hash` coverage.** I checked it against every `World` and `Vehicle` field. Every field is hashed except:
  - `reroute_stats`, which `observe` compares;
  - `router`, which `stale_router` catches;
  - `free_flow`, which is derived from the network;
  - `network` / `demand`, which are the `Arc` data.

  So a snapshot that forgets a field fails at the first seek compare.

## r2 findings: status
| r2 | Status | Evidence |
|---|---|---|
| M1 an edit drops the commands at the position | **Resolved** | Test 17 (`:567-585`) and the ward Specification (`ward-001.md:78`). `cut_ge` fails it at the `command_log().len() == 3` assertion. |
| m1 `DemandModel` sharing unverified | **Resolved** | `World::demand()` is in Outputs (`ward-001.md:27`). `ptr::eq` covers both a clone and a restored world (`:465-467`). |
| m2 test 9 one snapshot too loose | **Resolved** | `>= 4` (`:314`). `evict_ge` is caught, and the correct implementation has a margin of ≥ 1.0008 × one per snapshot against the 1.25 limit. |
| m3 seek cost self-reported | **Resolved (by delegation)** | Ward § Verification makes the Gold reviewer confirm in code that seek restores the newest snapshot ≤ t. The smoke test has a numeric bound: median ≤ 5 ms. |
| m4 test 3 precondition tautological | **Resolved** | It now uses `switches_total` (`:117-125`), which measures 0 → 0 without a closure (probe). |
| m5 ward out of sync with the file | **Resolved** | `estimated_tests: 18` matches the 18 functions. Row 12b exists, and the rows are ordered. |

All r1 findings stay resolved. The r1 mutants are still caught; see the table above.

## BLOCKER
None.

## MAJOR
None.

## MINOR
1. **`WindowInfo.snapshot_bytes` is only bounded above** (`timeline_001_snapshots.rs:305`).
   - The UI shows this value as "memory used against the budget" (`timeline.md:72, :102, :114`). An implementation that reports 0, or only the newest snapshot's bytes, passes all 18 tests (the `window_bytes_zero` mutant).
   - **Suggested fix**, verified to hold on the reference implementation:
     - in test 9 after the loop, `assert!(tl.window().snapshot_bytes >= tl.window().snapshots * one * 9 / 10)`;
     - and/or `assert_eq!(Timeline::new(w.clone(), UNLIMITED).window().snapshot_bytes, w.snapshot().bytes())`.
   - The file is frozen at this approval, so the **Gold reviewer must confirm in code that `snapshot_bytes` = Σ `bytes()` of the held snapshots**, and check that the probe's printed bytes agree.
2. **No seek is attempted right after an edit, beyond the new head** (test 12, `:389-395`).
   - For example, `seek(1500)` immediately after the edit at 1200, before stepping, should return `OutsideWindow { head_tick: 1200 }`.
   - A correct implementation gets this for free, because the head is one variable, so I did not count it as a defect.
   - Optional for Gold: check that `seek` bounds use `head_tick` after a cut.

## Checked and OK
- **`observe()` / `state_hash` are comprehensive** (see above). `metrics` / `reroute_stats` compare exact `Debug` strings.
- **Test 17 is not trivial.**
  - The kept `close(south[0], 1200)` both counts toward `command_log().len()` and changes the trajectory.
  - The reference is built with exactly the three commands, and the hash is compared at every tick from 1201 to 2400.
- **Test 12's validation-before-cut assertions are independent.** `UnknownLink` is sent at tick 1200 = position, so `InPast` cannot mask it.
- **No conditional assertions** that can skip a check:
  - test 4's `if k > t` only skips the step at k = t;
  - test 15's `min(2200 − t)` is ≥ 120 for every target.
- **The fixed numeric premises hold on the reference implementation:**
  - test 8's 150 KB–1.5 MB bounds and 1.5× ratio;
  - test 9's tiny budget → `[960]`;
  - test 10's post-eviction window;
  - test 15's 1920 backlog;
  - test 16's NoRoute/stranded state at snapshots 600–1080;
  - test 6's cadence, including the tick-50 start.
- **The ward, the epic and the tests are consistent.**
  - T1 (`timeline.md:74-76`) and the ward agree on validation first, the cut at > p, and the logs and snapshots being dropped.
  - The Outputs match every API the tests use: `Timeline`, `TimelineError`, `WindowInfo`, `SNAPSHOT_INTERVAL_TICKS`, `World::snapshot`, `World::demand`, `Snapshot::{tick, bytes}`.
- **No flakiness:** no timing assertions and no HashMap.
- **Runtime:** about 6 s in the default profile.
