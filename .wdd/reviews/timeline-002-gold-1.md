# timeline-002 Gold review, round 1

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 2 MINOR)

Reviewer: a fresh adversarial Gold subagent.
- Implementation: HEAD f7df3b1.
- Red snapshot: e1d7314 (Red r4, auto-approved under the convergence rule).

## Test freeze
- `git diff e1d7314 HEAD -- crates/sim-core/tests` is empty.
- `git diff --stat e1d7314 HEAD` changes only `examples/timeline_probe.rs` and `src/{lib,timeline,world}.rs`. No test file and no web file changed.

## Commands run
| Command | Result |
|---|---|
| `cargo test --workspace` | **165 passed**, 0 failed, 8 ignored (calibration, debug build). `timeline_002_branch` 19/19 |
| `cargo test -p sim-core --release` | **173 passed**, 0 failed. `timeline_002_branch` 19/19 (7.8 s) |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web build:wasm` | OK; tree clean afterwards |
| `pnpm -C web test` | 17 files, **80/80 passed** |
| `pnpm -C web e2e` | **46 passed, 1 skipped** (the human-approved G4 skip), 3.4 min |

## Manual smoke test
- `cargo test -p sim-core --test timeline_002_branch`: 19/19 pass.
- `cargo run -p sim-core --release --example timeline_probe`:
  ```
  River City 2026/7, 3 sim h stepped in 0.47 s (with snapshots)
  snapshots: 142 held, 47.79 MiB of 48 MiB budget, 353 KB each on average
  window: ticks 4680..=21600 (2.35 sim h retained)
  seek: median 1.79 ms, p95 2.73 ms, max 3.15 ms; replayed ticks median 70, max 119 (n = 200)
  branch: median 4.23 ms, p95 8.39 ms, max 9.40 ms (n = 50)
  window 7200..9600 (20 sim min after the branch):
    A (open):   generated 7391, completed 5650, incomplete 1741, removed 0, mean 268 s, p95 460 s
    B (closed): generated 7391, completed 5352, incomplete 2039, removed 0, mean 279 s, p95 588 s
  ```
- Against the bounds:
  - median branch 4.23 ms, ≤ 10 ms;
  - A/B are plausible: identical cohort (7,391), and B (main bridge closed) has fewer completions, more incomplete trips, and a higher mean and p95.
  - The T1 numbers are unchanged from timeline-001 Gold.

## Code review against T2
- **`branch` takes `&self` only** (`timeline.rs:224`). It reads `snapshots`, `head_logs` and `world` and writes nothing. `OutsideWindow` is returned before any work (`:226-228`), with the same bounds as `seek`.
- **Commands**: `command_log().iter().filter(|c| c.tick < at)` (`:235`). It filters the authoritative log, which already reflects edits (truncated on an edit below the head) and keeps commands above the position after a seek, in acceptance order.
- **Logs as of `at`**: the prefix at the snapshot's lengths comes from `head_logs` when it is `Some`, otherwise from the position world (`:231-234`, via the new `World::logs_prefix`, `world.rs:678`). It then replays `snap.tick()..at` on a scratch `World::restored`.
  - With the `head_logs` invariant (`None ⇒ position == head`), both sources hold a prefix of the head logs that covers `snap.lens`.
  - A mutant that always takes the position world's logs panics in the fuzz (below).
- **Snapshots**: clones of the retained snapshots with `tick < at`, oldest first, through the shared `add_snapshot` eviction (`:249-251, 266-273`), then `push_snapshot` at `at`.
  - When `at` is a snapshot tick there is no duplicate, because the clone filter is strict.
  - `head = position = at`, `head_logs = None` and `last_seek_replayed = 0`.
  - B's later snapshots are taken by `step` at multiples of 120 (`tick > newest`).
- **No hidden sharing.** `World` derives `Clone`. Its only `Arc` fields are `network` and `demand`, which are immutable, and there is no `Rc`, `RefCell` or `Cell` anywhere in `World`. `Snapshot::clone` deep-copies the state. The router is reset by `restored`.
- **`window_metrics`** (`world.rs:693-732`):
  - The cohort is `generated[partition_point(created_tick < from)..]`. Membership is a `binary_search_by_key` on `trip_id` over the cohort.
  - **Ordering assumptions hold.** `generated` is pushed only in `spawn_demand` (`world.rs:907`), with `trip_id = next_trip_id` (a monotone counter shared with spawns) and `created_tick = self.tick` (monotone). Explicit spawns (`spawn_with_route`, `:870`) advance `next_trip_id` without logging, so they only leave gaps; both keys still ascend.
  - Restores reinstall prefixes, and replay appends, so the order also survives seek and branch.
  - The fuzz asserts strict trip-id ascent and non-decreasing `created_tick` after every operation.
  - Spawns are never members, because membership is searched only in the demand cohort.
  - The partition is `generated − completed − unreachable − gridlock`, and the fuzz cross-checks it against `Live` outcomes.
  - p95 is nearest rank, `ceil(0.95·n)` clamped to ≥ 1. With `from > tick` the slice is empty, so counts are 0 and both means are `None`.
  - Cost is O((C + R) log G + C log C). Measured on River City at 3 sim h (65,081 generated): 1.7 ms for `from = 0` and 0.4 ms for `from = 21000` (see m2).
- **Cleanup items:**
  - `log_lens` and its tautological `debug_assert` are gone. `grep log_lens` finds nothing.
  - The field classification is now on `Snapshot` (`timeline.rs:46-55`), and `World::snapshot` links to it (`world.rs:582-584`).
  - `seek` moves the command log out with `take_commands` (`timeline.rs:194`, `world.rs:687`).
  - The `head_logs` doc states the invariant and the "may stay `Some` at the head after a seek" case (`timeline.rs:104-106`).
- **Determinism.** There is no clock and no hash container in the new code. `Instant` appears only in the probe example, under the existing justified `allow`.
- **API.** `WindowMetrics` has the 9 specified fields, derives `Clone, Debug, PartialEq`, and is re-exported (`lib.rs:25`). `branch` and `window_metrics` have the specified signatures. There are no orphan helpers: `logs_prefix` is used by `branch` and `take_commands` by `seek`.

## Fuzz (scratch, outside the repo)
**Setup.** The fuzzer is at `scratchpad/gold-tl002/src/main.rs`, a standalone crate that depends on the worktree's `sim-core`.
- It runs on three_bridges (2026/7). Each seed starts with timeline A on a random budget: unlimited, 2–9 snapshots, 4 snapshots, or below one snapshot. It holds up to 4 live timelines (A, branches, and branches of branches).
- Each operation applies to a random timeline:
  - `step_n` of 1–600 ticks, capped at tick 3600;
  - `seek` to the head, `window_start`, or a random point in the window;
  - `schedule` of a random close or open at the position or in the future, at the head or below it (an edit);
  - closing (or reopening) all six bridge links at the position, which forces unreachable removals;
  - an out-of-window `branch`, asserting the exact error and that the parent is unchanged;
  - `branch(at, random budget)` with `at` at the head, `window_start`, the position, a multiple of 120, or a random point in the window. When 4 timelines exist, the new branch replaces a random one.

**Checks.**
- After each branch:
  - the parent's full fingerprint is unchanged: hash, logs, metrics, every `trip_outcome`, window, snapshot ticks and command log;
  - B's snapshot ticks are a suffix of (parent's < `at`) ++ [`at`], equal to all of them when unlimited, and maximal under the budget;
  - B's bytes are ≤ budget (or there is exactly one snapshot), and they equal Σ fresh snapshot bytes;
  - `head = position = at`.
- After every operation, for **every** live timeline:
  - the command log equals an independent model (parent's < `at`, then the T1 edit rules), and the head equals the model's;
  - the position world equals a **fresh reference World** built from that model and stepped to the position: hash, full generated and completed logs, metrics, reroute stats, and `trip_outcome` for every id;
  - `window_metrics(from)` equals a spec-derived brute force (cohort × `trip_outcome`) for 5 `from` values per timeline (0, random, near the position, the position, the position + 1), and the partition holds;
  - the generated log ascends.
- For every pair of timelines, `generated_trips` agree on the ticks both have simulated.
- Separately, on a raw `World`, random explicit spawns (≈ 1 per 15 ticks, random zone pairs) are interleaved with demand and random closures for 2,400 ticks. `window_metrics` is checked against brute force every 300 ticks at 4 `from` values.

**Results.**
- **Seeds 1–300 (release), 150 ops each:**
  - 44,989 operations;
  - 173,300 timeline-vs-reference checks;
  - 10,530 branches, 9,658 of them of a branch;
  - 866,500 `window_metrics` checks (with removals present);
  - 254,096 demand-pair checks;
  - 9,600 spawn-mix checks.

  All equal, with a max tick of 3,588.
- **Seeds 301–310 (debug build, `debug_assert`s live), 100 ops each:** 3,759 timeline checks, 245 branches, 18,795 `window_metrics` checks and 320 spawn-mix checks, all equal.

**Teeth check** on a scratch copy of the crate (`scratchpad/gold-tl002/mut/`, driven by `mutate.py`, seeds 1–20). Every mutant was caught:

| Mutant | Caught by |
|---|---|
| M1 commands `<= at` | command-log model |
| M2 ignore `head_logs` (always the position world's logs) | panic in `logs_prefix` |
| M3 copy the snapshot at `at` too | snapshot-suffix check |
| M4 cohort `created_tick <= from` | brute force |
| M5 p95 with `floor` | brute force |
| M6 replay one tick short | snapshot/bytes check |

## Findings
### BLOCKER
None.

### MAJOR
None.

### MINOR
**m1. `branch` clones every retained snapshot < `at` before evicting** (`timeline.rs:249-251`).
- The cost is O(bytes of A's window before `at`), and it is *higher* when B's budget is smaller than A's, because the clones are allocated and then dropped.
- Measured on River City at 3 sim h (`scratchpad/gold-tl002/src/bin/cost.rs`, median of 9):

  | A budget | Branch tick | B budget | Median |
  |---|---|---|---|
  | 48 MiB | head | 48 MiB | 6.1 ms |
  | 48 MiB | head | 4 MiB | 10.1 ms |
  | 96 MiB | head | 96 MiB | 7.8 ms |
  | 96 MiB | head | 4 MiB | 13.4 ms |

- The ward bound (median across the window, probe budgets) is met. A UI that splits the budget between the two scenarios would branch slower than one that gives each the full budget.
- Suggestion: walk the retained snapshots newest-first, sum their bytes plus the `at` snapshot's, and clone only the suffix that fits. Alternatively, store snapshots as `Arc<Snapshot>`: they are immutable, and T2 allows `Arc` sharing.

**m2. `window_metrics` costs ≈ 1.7 ms at 3 sim h for `from = 0`** (River City, 65 k trips; measured with the same scratch binary).
- This is within the spec ("linear, per frame at most").
- timeline-004 should throttle it, for example to a few Hz or on sim-time change, rather than call it every render frame for both scenarios.
- Informational, no change needed in this ward.

## Checked without a finding
- The freeze.
- `&self` untouched, with all 50 probe branches plus 10,530 fuzz branches compared field by field.
- Commands `< at` only. Logs as of `at` from both `head_logs` sources.
- No duplicate snapshot at a snapshot tick.
- A budget below one snapshot keeps only `at`.
- The `OutsideWindow` bounds, with no mutation.
- Branch of a branch, and seeks in B before `at`.
- Identical demand across all live timelines.
- The ordering assumptions of the binary searches, including explicit spawns interleaved with demand.
- Exact byte accounting in B.
- No `Rc`/`RefCell`/clock/hash container.
- The cleanup items.
- The wasm build and the web suites.
