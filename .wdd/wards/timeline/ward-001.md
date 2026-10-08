---
ward: 1
revision: null
name: "Snapshots and seek in sim-core"
epic: "timeline"
status: "red"
dependencies: []
layer: "rust"
estimated_tests: 14
created: "2026-10-08"
completed: null
---
# Ward timeline-001: Snapshots and seek in sim-core

## Scope
This ward implements contract **T1** (`.wdd/epics/timeline.md`) natively in `crates/sim-core`. It covers a budgeted snapshot store, restore, and seek within the retained window, so that a restore followed by replay is bit-identical to an uninterrupted run. It also covers editing the future, used later by scenario B.

There is no wasm or UI in this ward. timeline-003 wires the result into the worker.

## Inputs
- `World` (`world.rs`): `Clone`, `state_hash`, `schedule`/`command_log`, `generated_trips`, `completed_log`, `trip_outcome`, `metrics`, `reroute_stats`.
- `cities::{river_city, three_bridges, river_city_scaled}`.
- Measured basis: `.wdd/epics/timeline.md` § Measured basis.

## Outputs
- **`World`**:
  - `network: Arc<Network>` and `demand: Arc<DemandModel>`, with unchanged accessors;
  - `World::snapshot(&self) -> Snapshot`;
  - a crate-internal restore.
- **New module `sim_core::timeline`**, re-exported as `Timeline`, `Snapshot`, `TimelineError`, `WindowInfo` and `SNAPSHOT_INTERVAL_TICKS`.
  - `pub const SNAPSHOT_INTERVAL_TICKS: u64 = 120;`
  - `Snapshot`:
    - `tick() -> u64`;
    - `bytes() -> usize`: owned capacity × element size of every snapshotted field, including per-vehicle route vectors. It excludes the logs, the router, and the `Arc` data.
  - `Timeline::new(world: World, budget_bytes: usize) -> Timeline` takes a snapshot of `world` at once.
  - Read accessors:
    - `world(&self) -> &World` (the position);
    - `position_tick()`, `head_tick()`;
    - `window() -> WindowInfo { window_start, head_tick, position_tick, snapshot_bytes, budget_bytes, snapshots }`;
    - `snapshot_ticks() -> Vec<u64>` (ascending).
  - Stepping:
    - `step(&mut self)`;
    - `step_n(&mut self, n: u64)`.
  - Seeking:
    - `seek(&mut self, tick: u64) -> Result<(), TimelineError>`;
    - `last_seek_replayed_ticks() -> u64` (the ticks stepped by the last seek).
  - `schedule(&mut self, cmd: Command) -> Result<(), CommandError>`.
  - `TimelineError::OutsideWindow { tick, window_start, head_tick }`.
- **`crates/sim-core/examples/timeline_probe.rs`** prints the snapshot bytes, the snapshot count against the budget, and the seek cost (median/p95 µs, replayed ticks) for River City. It is used by the Manual Smoke Test and by timeline-005.

## Specification
- **Snapshot times.**
  - `Timeline::new` snapshots the world's current tick.
  - Afterwards, each step that *arrives* at a tick that is a multiple of 120 and not yet held takes a snapshot.
  - Replaying through a held tick takes none.
- **Head and position.**
  - `head_tick = max(head_tick, position_tick)` after every step.
  - A step at `position_tick < head_tick` is a replay: commands are unchanged, so the result is identical and nothing is invalidated.
- **Seek.** `seek(t)` for `window_start ≤ t ≤ head_tick`:
  - takes `s` = the newest snapshot with `s.tick ≤ t`;
  - restores the world state from `s`, keeps the full `command_log` (including later commands), truncates `generated` / `completed_log` / `removed_log` to `s`'s lengths, and empties the router;
  - then steps `t − s.tick` times.
  - So `last_seek_replayed_ticks() < 120` whenever `t` is inside the window.
  - Any other `t` returns `OutsideWindow`, with no change to the world, the position, the head or the snapshots.
- **Budget.** After a snapshot is added:
  - while Σ `bytes()` > `budget_bytes` and more than one snapshot is held, the oldest is evicted;
  - `window_start` is the oldest held snapshot's tick;
  - a budget smaller than one snapshot keeps exactly the newest one.
- **Editing the future.** `schedule(cmd)` with `cmd.tick ≥ position_tick`:
  - at `position_tick == head_tick` it is just `World::schedule`;
  - at `position_tick < head_tick` the timeline first drops every snapshot with tick > `position_tick` and every command with tick > `position_tick` from the log, and sets `head_tick = position_tick`; then it schedules;
  - `cmd.tick < position_tick` returns `CommandError::InPast` (unchanged).
- **Logs.**
  - `trip_outcome`, `mean_travel_time_s_between` and `metrics` after a seek equal the uninterrupted run's at that tick.
  - The logs are append-only, and restore truncates them, so stepping regenerates them deterministically.
- **No full copy per tick.** After `n` ticks from 0, at most `⌊n/120⌋ + 1` snapshots exist, fewer when the budget evicts.

## Tests
File: `crates/sim-core/tests/timeline_001_snapshots.rs` (native; run the long tests in release). Reference runs are an uninterrupted `World` with the same scenario and the same commands, hashed at every tick.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `seek_equals_uninterrupted_river_city` | River City (2026/7) with commands at ticks 1800 (close the main bridge) and 2700 (reopen it). After running to tick 3600, `seek(t)` for t in {0, 1, 119, 120, 121, 1799, 1800, 1801, 1830, 2699, 2700, 3000, 3599, 3600}, in random order, gives `state_hash`, `generated_trips()`, `completed_log()`, `metrics()` and `reroute_stats()` equal to the reference at t |
| 2 | `replay_after_seek_continues_identically` | after `seek(1830)`, stepping to 4800 (past the old head) gives hashes equal to the reference at every tick |
| 3 | `seek_mid_epoch_and_mid_reroute` | seek targets right after the closure (1801…1840), where the reroute queues are busy. The hash and `reroute_stats` equal the reference; the router really is rebuilt, not copied |
| 4 | `gridlock_state_survives_restore` | the city-001 ring deadlock (copied construction): seek to tick 700 (fronts blocked) and to a tick after the first gridlock removal. Hash, per-vehicle `blocked_ticks` and `removed_gridlock` equal the reference at every tick to 4,000 |
| 5 | `three_bridges_with_future_commands` | three_bridges with closes and opens scheduled for future ticks *before* running. Seeking into the middle keeps the later commands, and the replay applies them at their ticks (hash equal to the reference) |
| 6 | `snapshot_cadence` | after 3,600 ticks with an unlimited budget: `snapshot_ticks()` = 0, 120, …, 3600 (31). Seeking back and replaying to the head adds no duplicates |
| 7 | `seek_cost_bounded` | for every target inside the window, `last_seek_replayed_ticks()` = t − (the newest snapshot ≤ t) < 120 |
| 8 | `snapshot_bytes_exclude_logs` | River City at 1800 and at 7200: 150 KB ≤ `bytes()` ≤ 1.5 MB, and bytes(7200) < 1.5 × bytes(1800), although the logs grow about 4× (measured basis: state ≈ 0.35 MB) |
| 9 | `budget_evicts_oldest` | budget = 5 × bytes of one River City snapshot: Σ bytes ≤ budget after every step. `window_start` increases monotonically and is the oldest held tick. `window()` reports consistent numbers. A budget below one snapshot keeps exactly one |
| 10 | `seek_outside_window_is_refused` | `seek(head+1)` and `seek(window_start−1)` (after eviction) return `OutsideWindow` with the correct fields. The hash, position, head and snapshots are unchanged |
| 11 | `seek_forward_within_window` | after `seek(600)`, `seek(3000)` and then `seek(head)`, each equals the reference. Position and head are reported correctly |
| 12 | `schedule_in_past_edits_future` | at position 1200 with head 3600, scheduling a close at 1200 sets head to 1200 and drops snapshots > 1200 and commands > 1200. Stepping to 2400 equals a fresh reference built with the commands ≤ 1200 plus the new close |
| 13 | `shared_data_not_copied` | a clone of a world and a snapshot share `Network` and `DemandModel` (pointer equality via the accessors). `Snapshot::bytes()` excludes them |
| 14 | `schedule_at_head_is_plain` | at `position == head`, `schedule` behaves like `World::schedule` (`InPast` for earlier ticks). The head and the snapshots are untouched |

## Must NOT
- Store the router, the logs or the `Arc` data in snapshots, or copy the world every tick.
- Change any existing behaviour or test: all earlier suites stay green, unchanged. `state_hash` keeps its meaning.
- Use the wall clock or a HashMap in sim logic (clippy.toml).

## Must DO
- Restore + replay is bit-identical to the uninterrupted run, both for `state_hash` and for the logs.
- Document the snapshotted fields next to `Snapshot`, so any future field added to `World` must be classified.

## Manual Smoke Test
### Setup
```
cargo test -p sim-core --release --test timeline_001_snapshots
cargo run -p sim-core --release --example timeline_probe
```
### Steps
1. Run the tests. Verify: all pass.
2. Run the probe. Verify:
   - snapshot bytes are about 0.3–0.5 MB;
   - with a 48 MiB budget the window covers ≥ 1.5 sim hours;
   - the median seek cost (≤ 119 replayed ticks plus a restore) is in milliseconds.
### Pass criteria
- [ ] All suites green, clippy clean
- [ ] The probe numbers are plausible against § Measured basis

## Verification
The Gold reviewer re-runs the tests and the probe, and checks the snapshot field classification against every `World` field.
