---
ward: 2
revision: null
name: "Branch and window metrics in sim-core"
epic: "timeline"
status: "red"
dependencies: ["timeline-001"]
layer: "rust"
estimated_tests: 17
created: "2026-10-08"
completed: null
---
# Ward timeline-002: Branch and window metrics in sim-core

## Scope
This ward implements contract **T2** (`.wdd/epics/timeline.md`) natively in `crates/sim-core`. It covers two things:
- `Timeline::branch`, which creates an independent scenario B from a tick in the original's window, with identical external demand;
- `World::window_metrics`, which gives comparison metrics over a measurement window, including incomplete trips. These are the numbers the comparison panel will show (timeline-004).

It also clears the timeline-001 Gold MINORs that are in the same code.

## Inputs
- From timeline-001: `Timeline`, `Snapshot`, `WindowInfo`, `TimelineError`, `SNAPSHOT_INTERVAL_TICKS`, `World::snapshot`.
- `World`: `generated_trips`, `completed_log`, `trip_outcome`, `metrics`, `command_log`, `state_hash`.

## Outputs
- `Timeline::branch(&self, at_tick: u64, budget_bytes: usize) -> Result<Timeline, TimelineError>` (`OutsideWindow` as for `seek`).
- `World::window_metrics(&self, from_tick: u64) -> WindowMetrics`.
- `pub struct WindowMetrics` (`Debug + Clone + PartialEq`), re-exported from the crate root:

  | Field | Type |
  |---|---|
  | `from_tick` | `u64` |
  | `to_tick` | `u64` |
  | `generated` | `u64` |
  | `completed` | `u64` |
  | `removed_unreachable` | `u64` |
  | `removed_gridlock` | `u64` |
  | `incomplete` | `u64` |
  | `mean_travel_time_s` | `Option<f64>` |
  | `p95_travel_time_s` | `Option<f64>` |

- **Cleanup (timeline-001 Gold MINORs):**
  - remove the dead `World::log_lens` and its tautological `debug_assert`;
  - move the field classification doc next to `Snapshot` (`World::snapshot` links to it);
  - `seek` moves the command log instead of copying it;
  - the `head_logs` doc states the real invariant: `None ⇒ position == head`, and it may stay `Some` at the head right after a seek.

## Specification
- **Branching.** `branch(at, budget)` for `window_start ≤ at ≤ head_tick` builds a new timeline whose world is the original's state at `at`:
  - It is built on a scratch restore of the newest snapshot ≤ `at` plus a replay. `&self` is not modified: same hash, position, head, snapshots, logs and command log.
  - Its command log is the original's commands with `tick < at`. Commands at `at` or later belong to the original's decisions and are not inherited, because a branch is "another decision" from that moment.
  - Its logs are the original's logs as of `at`.
  - Its snapshots are copies of the original's retained snapshots with tick < `at`, plus a snapshot at `at`. Older ones are evicted to fit `budget`, exactly as in `Timeline::new` + step.
  - So `window_start(B) ≤ at`, `head(B) = position(B) = at`.
  - It shares only `Arc` data with the original.
- **Branch behaviour.** A branch is an ordinary `Timeline`: stepping, seeking (also to before `at`, where its history equals the original's) and editing work as in T1, and never affect the original.
- **Demand.** For every tick both timelines have simulated, `generated_trips()` are identical: same trip id, flow index, origin, destination and created tick. Demand is a pure function of (seed, tick), and trip ids advance only with demand when nothing spawns explicitly.
- **Window metrics.** The window covers the **cohort** of demand-generated trips with `created_tick ≥ from_tick`, up to now (`to_tick` = `tick()`):
  - `generated` = the cohort's size.
  - `completed`, `removed_unreachable` and `removed_gridlock` = cohort trips with that outcome by now.
  - `incomplete` = the cohort trips that are still live (waiting at the origin, on the network, NoRoute or stranded). So `incomplete = generated − completed − removed_unreachable − removed_gridlock`.
  - `mean_travel_time_s` / `p95_travel_time_s` are over the completed cohort trips (travel time = (completed − created) × DT; p95 by nearest rank), and `None` when there are none.
  - With `from_tick > tick()` the cohort is empty: all counts are 0 and the means are `None`.
  - Explicit spawns are not demand and never part of a cohort.
  - The cost is linear in the logs plus a sort (for p95), so it must not be called per tick in hot paths. The UI asks for it per frame at most.
- **Comparing.** Both scenarios at the same tick, with the same `from_tick` (the branch tick), cover identical cohorts (identical demand), so their window metrics compare like for like. `incomplete` makes a scenario whose trips have not arrived visible as such.

## Tests
File: `crates/sim-core/tests/timeline_002_branch.rs`. It runs in the default test profile.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `branch_equals_original_at_tick` | River City, run to 3600 with the main bridge closed at 1800. `branch(at)` for at ∈ {0, 120, 1799, 1800, 1801, 2500, 3600} gives a world whose hash, logs and metrics equal a fresh reference at `at` that has the commands < `at`. The original's hash, position, head, snapshots, logs and command log are unchanged |
| 2 | `branch_takes_commands_before_the_tick` | with commands at 1800 (close) and 2400 (open) in A, `branch(1800)` has no command and `branch(2000)` has only the close (`tick < at`). A command pending exactly at `at` is not inherited |
| 3 | `branches_are_independent` | after `branch(1800)`, B closes the Old Bridge at 1800 and A runs on with its own commands. To 4200, A equals its uninterrupted reference at every tick, and B equals a reference with A's commands < 1800 plus B's own |
| 4 | `identical_demand_across_branches` | A with the main bridge closed, B with it open (branch at 1800), both run to 5400: `generated_trips()` are equal (all fields), while `completed_log()` differs |
| 5 | `branch_snapshots_and_history` | B's snapshot ticks are the original's retained ticks < `at` plus `at` (also for an `at` that is not a multiple of 120). Seeks in B to ticks before `at` equal A's history. B's own snapshots continue at the multiples of 120 |
| 6 | `branch_budget` | B with a budget of 3 snapshots holds ≤ budget bytes and keeps `at`'s snapshot as the newest. B with an unlimited budget keeps all copies |
| 7 | `branch_outside_window_is_refused` | `branch(head+1)` and `branch(window_start−1)` return `OutsideWindow`, and the original is unchanged |
| 8 | `branch_edits_never_touch_the_original` | B seeks back, edits its future (T1) and steps. A's hash at every tick, head, snapshots and command log are unchanged |
| 9 | `branch_of_a_branch_and_at_head` | branching at the head, at `window_start`, at a snapshot tick (no duplicate snapshot), and branching a branch all equal their references |
| 10 | `window_metrics_match_brute_force` | River City with a closure; for `from` ∈ {0, 1800, 3000, now}, every field equals an independent computation from `generated_trips()` × `trip_outcome()` (travel times sorted, p95 nearest rank) |
| 11 | `window_metrics_partition` | for many (`from`, tick) pairs: `generated = completed + removed_unreachable + removed_gridlock + incomplete`. `generated` equals the number of generated trips with `created_tick ≥ from`. With `from > tick` every count is 0 and the means are `None` |
| 12 | `window_metrics_count_removals` | three_bridges with all six bridge links closed **for good** at tick 500, run to 3000 (probed: the first unreachable removal is at 1101). `removed_unreachable` > 0 and equals brute force for `from` ∈ {0, 400, 1000} |
| 13 | `window_metrics_exclude_explicit_spawns` | explicit `spawn_with_route` vehicles (the city-001 ring) are in no cohort: `generated` = 0, although they complete or are removed |
| 14 | `same_window_compares_like_for_like` | A (open) and B (main bridge closed at the branch tick 1800), both at 1800 + 20 sim min, `from` = 1800: equal `generated` (probed 7,205), each side satisfies the partition, and B has more `incomplete` than A (probed 2,010 vs 1,657; at 10 min 1,724 vs 1,610) |
| 15 | `window_metrics_exclude_spawns_mixed_with_demand` | three_bridges with explicit spawns every 60 ticks from 600, interleaved with demand. Equal to brute force for from ∈ {0, 600, 1000}; spawns are never in a cohort (probed: 661 spawned, 641 generated) |
| 16 | `window_metrics_count_gridlock_removals` | a demand-driven one-way ring (4 zones, flows going three quarters round at 1,200 veh/h) deadlocks. The cohort has gridlock removals (probed: 15 at 4000) and no unreachable ones. Equal to brute force for from ∈ {0, 500, 2000} |
| 17 | `window_metrics_exclude_removed_spawns` | three_bridges with all bridges closed for good at 500 and explicit spawns every 20 ticks in [300, 500), run to 3000. Removed spawns are in no cohort: equal to brute force for from ∈ {0, 400, 1000} (probed: 1,123 spawned, 1,113 generated, the 10 spawns all removed as unreachable) |

## Must NOT
- Modify the original in `branch` (it takes `&self`).
- Share mutable state between timelines.
- Count explicit spawns as demand.
- Change existing behaviour or tests: all suites stay green and unchanged.

## Must DO
- Branch ≡ reference (bit-identical), identical demand, and independent evolution.
- Window metrics that equal brute force exactly.

## Manual Smoke Test
### Setup
```
cargo test -p sim-core --test timeline_002_branch
cargo run -p sim-core --release --example timeline_probe
```
### Steps
1. Verify the tests pass.
2. Verify the probe additionally prints the branch cost (median ms for `branch(at)` across the window, ≤ 10 ms) and the window metrics for A versus B with the main bridge closed in B at the same tick.
### Pass criteria
- [ ] All suites green, clippy clean
- [ ] The probe shows a branch cost ≤ 10 ms and plausible A/B window metrics

## Verification
The Gold reviewer re-runs the tests and the probe, confirms in code that `branch` leaves `&self` untouched and copies only what T2 says, and fuzzes random branch, step, seek and edit sequences against reference worlds. The reviewer also confirms the timeline-001 cleanup items in code: `log_lens` is removed, the classification doc sits at `Snapshot`, `seek` moves the command log, and the `head_logs` doc states the invariant.
