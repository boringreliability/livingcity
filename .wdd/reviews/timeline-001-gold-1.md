# timeline-001 Gold review, round 1

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 4 MINOR)

Reviewer: a fresh adversarial Gold subagent.
- Implementation: HEAD 401c117.
- Red snapshot: 4b72080 (Red r3 approved).

## Test freeze
- `git diff 4b72080 HEAD -- crates/sim-core/tests/timeline_001_snapshots.rs` is empty.
- `git diff --stat 4b72080 HEAD` changes only `examples/timeline_probe.rs`, `src/{lib,timeline,world}.rs` and the new `tests/gold_timeline001.rs`, which holds the regressions for the Red r3 MINORs. No earlier test file and no web file changed.

## Commands run
| Command | Result |
|---|---|
| `cargo test --workspace` | **146 passed**, 0 failed, 8 ignored (calibration, debug build) |
| `cargo test -p sim-core --release` | **154 passed**, 0 failed. `timeline_001_snapshots` 18/18 (6.0 s), `gold_timeline001` 2/2 |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web build:wasm` | OK; tree clean afterwards |
| `pnpm -C web test` | 17 files, **80/80 passed** |
| `pnpm -C web e2e` | **46 passed, 1 skipped** (the human-approved G4 skip), 3.4 min, port 5190 |

## Manual smoke test
- `cargo test -p sim-core --release --test timeline_001_snapshots`: 18/18 pass.
- `cargo run -p sim-core --release --example timeline_probe`:
  ```
  River City 2026/7, 3 sim h stepped in 0.46 s (with snapshots)
  snapshots: 142 held, 47.79 MiB of 48 MiB budget, 353 KB each on average
  window: ticks 4680..=21600 (2.35 sim h retained)
  seek: median 1.72 ms, p95 2.61 ms, max 3.15 ms; replayed ticks median 70, max 119 (n = 200)
  ```
- Against the bounds:
  - snapshot size 353 KB, inside 0.3–0.5 MB;
  - window 2.35 sim h, ≥ 1.5 h;
  - median seek 1.72 ms, ≤ 5 ms;
  - replayed ticks max 119, < 120.
- These are consistent with the measured basis (≈ 0.35 MB, ≈ 2.6 ms).

## Code review against T1
- **Seek restores the newest snapshot ≤ t** (`timeline.rs:176`): `partition_point(|s| s.tick() <= tick) - 1`. The store is ascending (pushes go to the back only at `tick > newest`, evictions come from the front, edits truncate from the back). `tick ≥ window_start = front` guarantees index ≥ 0.
  - The world is rebuilt with `World::restored` (`world.rs:662`) from the snapshot state, the timeline's whole command log, and the head-logs prefix at the snapshot's lengths. The router is `RouterCache::default()`.
  - It replays `tick − s.tick` steps.
  - `OutsideWindow` returns before any mutation (`timeline.rs:173-175`).
- **Field classification.** The doc at `world.rs:570-579` lists all 33 `World` fields:
  - 26 snapshotted;
  - 2 shared;
  - 3 logs;
  - the command log (timeline-owned);
  - the router (derived).

  `snapshot()` builds the state with a full struct literal and no `..`, so the compiler forces any new field to be classified.
- **Router cache is pure.** `RouterCache` (`routing.rs:100-113`) is a `BTreeMap<NodeId, Tree>` built from `cost_keys` and `closed`. It is invalidated on every epoch (`world.rs:879`) and every close/open (`world.rs:892, 904`). So emptying it on restore cannot change decisions.
- **`state_bytes`** (`world.rs:621-648`):
  - `size_of::<World>()` covers every inline field: `BehaviorRng` is a `u64`, and `RerouteStats` is `Copy`.
  - Every heap field of the snapshotted set is counted: slots, per-vehicle routes, free, lanes (all three levels), credit (both levels), rr_next, origin_buffers (both levels), exit_count, free_flow, smoothed, cost_keys, exit_time_sum, exit_time_n, closed, and both reroute queues.
  - `Vehicle` has no other heap field.
  - Logs, command log, router and `Arc` data are excluded.
  - It is computed once per snapshot (`timeline.rs:54`), not per step or per `window()` call.
- **`head_logs` lifecycle.** Invariant: `None ⇒ position == head`.
  - It is set to `None` only in `new`, on a step that reaches the head (`timeline.rs:153-157`), and on an edit below the head, which sets `head = position` (`timeline.rs:203-204`).
  - `seek` takes the logs only when the value is `None`, which means the world is at the head.
  - Replays below the head regenerate the logs deterministically, so they equal the head prefix when the head is reached again.
  - Edge case: after `seek(head)` with head on a snapshot tick, `Some` persists with position == head. Its content is still the head logs, it clears on the next step, and it is correct (see m4).
  - I tried to build a failing sequence: seek back, step, seek forward, edit, seek, also with eviction. The fuzz below found none.
- **Eviction and edits.** `snapshot_bytes` is adjusted on every push, every front eviction and every edit truncation (`timeline.rs:200, 216, 220`). It is verified to equal Σ fresh `snapshot().bytes()` at every held tick after every operation (fuzz below).
- **Determinism.**
  - No clock and no hash container in `timeline.rs` or the new `world.rs` code.
  - `#![allow(clippy::disallowed_methods, clippy::disallowed_types)]` sits only in `examples/timeline_probe.rs:4`, justified by its comment. `Instant` times the timeline from outside.
- **Performance.**
  - A step adds an `is_multiple_of` and an O(state) snapshot every 120 ticks.
  - There are no log copies per step.
  - Seek copies the log prefix and the command log (see m3).
- **API.**
  - `World.network: Arc<Network>`, `demand: Arc<DemandModel>`, `World::demand()` and `World::snapshot()`.
  - Restore is `pub(crate)`.
  - `sim_core::timeline` is re-exported (`lib.rs:22`): `Snapshot`, `Timeline`, `TimelineError`, `WindowInfo`, `SNAPSHOT_INTERVAL_TICKS = 120`.
  - `WindowInfo` has the specified fields and derives `Debug + Clone + PartialEq` (+ `Eq`).
  - `TimelineError::OutsideWindow{tick, window_start, head_tick}` derives `Debug + Clone + PartialEq` (+ `Copy, Eq`).
  - All the specified methods are present with the specified signatures.
- **Wasm.** The `Arc` change builds; the web unit and e2e suites stay green.

## Mutation-style probes (scratch, outside the repo)
**Fuzzer setup.** The fuzzer lives at `scratchpad/gold-tl001/src/main.rs`, a standalone crate that depends on the worktree's `sim-core`.
- It runs on three_bridges (2026/7) with three budget types, rotated per seed: unlimited, ≈ 6 snapshots, and < 1 snapshot.
- Each seed applies 60 random operations:
  - `step_n` of 1–400 ticks, capped at 4,000;
  - seeks to the head, `window_start`, near the head, or random points inside the window;
  - out-of-window seeks, asserting the exact error and no change;
  - `schedule` of random close/open on any link, at the position, the near future, the far future, or in the past (asserting `InPast` and no change). These fall both at and below the head.

**Checks after every operation.**
- The timeline's command log equals an independent model (drop > position on an edit below the head, then append). The head equals the model.
- The window invariants hold.
- `snapshot_bytes` equals Σ fresh bytes.
- The position world's `state_hash`, full `generated_trips`, full `completed_log`, `metrics`, `reroute_stats`, `trip_outcome` for every trip id, and `mean_travel_time_s_between(0, t)` all equal a **fresh reference World** built from the effective command log and stepped to the position.

**Results.**
- 600 seeds in release: 36,000 checks, all equal.
- 15 seeds in a debug build, with `debug_assert`s live: 900 checks, all equal.

**Teeth check** on a scratch copy of the crate (`scratchpad/mut/`). Each mutant was caught:

| Mutant | Effect |
|---|---|
| (a) remove `head_logs = None` on catch-up | panics in `Logs::prefix` (stale head logs) |
| (b) `drop_commands_after` with `<` | command log diverges |
| (c) keep snapshots up to position + 120 on an edit | stale snapshot detected |

## Findings
### BLOCKER
None.

### MAJOR
None.

### MINOR
**m1. `World::log_lens` is used only in a tautological `debug_assert`.**
- `timeline.rs:215` asserts `s.lens == self.world.log_lens()`, where `s` was just built by `self.world.snapshot()`.
- `snapshot()` computes the lens with the identical expression (`world.rs:616`), so the assert can never fail.
- In release `log_lens` (`world.rs:672`) has no caller.
- Suggestion: have `snapshot()` call `log_lens()` and drop the assert, or assert something non-trivial, such as `head_logs.is_none()` at a push.
- Found by reading the code and grepping the callers.

**m2. The field classification lives on `World::snapshot` (`world.rs:570-579`), not "next to `Snapshot`" as Must DO says.**
- `Snapshot` (`timeline.rs:43-44`) has only a one-line summary.
- The struct literal in `snapshot()` enforces the classification at compile time, so the intent is met.
- A pointer from the `Snapshot` doc to `World::snapshot` would satisfy the letter of the rule.

**m3. Seek cost grows with history.**
- Every seek copies the head-log prefix (`Logs::prefix`, `timeline.rs:34-40, 181`) and the whole command log (`timeline.rs:182`, `to_vec`).
- This is O(trips so far) per seek, not per step. At 3 sim h River City the measured median is 1.72 ms, well under budget.
- Scrubbing late in long or scaled runs will grow linearly.
- timeline-005 should measure seek at the end of the longest supported run.
- The command-log copy could be a move (`take`), since the old world is discarded.

**m4. The `head_logs` doc comment (`timeline.rs:93-94`) is slightly imprecise.**
- It says "while the position is behind the head". After `seek(head)` with the head on a snapshot tick (replay 0), `head_logs` stays `Some` at position == head.
- This is harmless: the content is still the head logs, it clears on the next step, and the fuzz covers it.
- Suggest documenting the actual invariant (`None ⇒ position == head`).

## Checked without a finding
- The freeze.
- Seek picks the newest snapshot ≤ t (code + fuzz `replayed < 120`).
- No snapshot at a tick already held during a replay.
- Budget below one snapshot keeps exactly one.
- Edits keep commands at the position.
- `InPast`/`UnknownLink` leave everything unchanged (validation runs before any truncation, `timeline.rs:195`).
- Snapshots never become empty: the position is ≥ `window_start`, so an edit never drops the front.
- Restored worlds share the `Arc`s.
- No HashMap or clock in sim code.
- No orphan pub items.
- The wasm build and the web suites.
