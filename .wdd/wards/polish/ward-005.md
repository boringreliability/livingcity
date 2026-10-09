---
ward: 5
revision: null
name: "Profile and optimize the measured per-frame bottlenecks"
epic: "polish"
status: "planned"
dependencies: ["polish-004"]
layer: "fullstack"
estimated_tests: 10
created: "2026-10-10"
completed: null
---
# Ward polish-005: Profile and optimize the measured bottlenecks

## Scope
This ward covers contract **P5** of epic `polish`, the brief's step 8: *"Profile and optimize measured bottlenecks."* Every change is measured before and after. The simulation's results must not change: golden `state_hash` values, recorded from the code before this ward, must still hold.

The robustness items f1, f2 and g7 are in scope too: restart after a wasm trap, clock reset on re-init, and fatal errors that cannot be dismissed.

## Inputs (measured, 2026-10-09/10, Apple M4 Pro, native release)
**Per-tick and per-frame costs on River City** (`.wdd/epics/polish.md` § Measured basis):

| Scale | Active / on network | `step` mean | `metrics()` mean |
|---|---|---|---|
| ×1 | ~1.8k active | 0.021 ms | 0.009 ms |
| ×5 | ~27k active, ~7k on the network | 0.302 ms | **0.348 ms** |

**Cause of the superlinear `step`** (profiled by reading the code; confirmed with numbers below):
- `enqueue_periodic` and `run_retries` scan **every slot every tick**. `counts()` (used by `metrics()`) scans all origin buffers and all slots, and `metrics()` also scans all lanes and allocates a `Vec` of ages.
- With ~21k trips waiting at their origin at ×5, the cost follows `active`, not the vehicles on the network. From ×1 to ×5, `active` grows ~15× and `step` grows ×15.

**Host costs**
- While paused, the host encodes and posts a frame every 16 ms (`host.ts` iterate) (e2).
- The frame pool keeps only exact-size buffers and clears itself on every post, so after the warm-up nearly every frame allocates. While comparing, B always allocates (e3).

**`Timeline::branch`** deep-clones every retained snapshot below `at`, then evicts: 6.1 ms at 48 MiB, 10–13 ms with a smaller B budget (e4).

**Robustness**
- After a wasm trap the host halts and there is no recovery path (f2).
- Re-init resets only `executedTicks` of the clock (f1).
- Fatal errors can be dismissed or cleared by the next action, which hides why the city froze (g7).

**Golden hashes** from the code at commit `4e5d5c1` (this ward's tests pin them):
- River City at ×1 and ×5, through a `Timeline`: step 3000 ticks, seek 2000, close the main bridge at 2000, step 2000, branch at 3000 (1 GiB budget).

  | Scale | Timeline | Branch |
  |---|---|---|
  | ×1 | `0x9cecb987d7f6b878` | `0x236e8fa588763c38` |
  | ×5 | `0x7a5c02da65edf9cd` | `0x95424bbf906870d9` |

- three_bridges(17, 23), all bridges closed at 1190 and reopened at 3000, at ticks 1200, 2400 and 3600:
  - 1200: `0xe972d745444936ec`
  - 2400: `0x7c827e8fede308ff`
  - 3600: `0xa7f1442ffcdac256`

## Outputs
**sim-core**
- **Incremental counters for `metrics()`.**
  - Keep running counts of on-network vehicles, buffered and no-route trips, stranded and queued vehicles, and the sum of live vehicles' creation ticks (for the mean incomplete age).
  - Update them where the state changes.
  - They are snapshotted, or rebuilt on restore and branch, so a seek or branch gives the same values.
  - `metrics()` then costs O(1) plus the queued count. That count may stay a lane scan if it is cheaper than tracking speed crossings; measure it.
  - The previous full-scan implementation stays available as `World::metrics_full_scan()` (doc-hidden), the reference that the tests compare against.
- **Schedules instead of full scans.**
  - `enqueue_periodic` visits only the slots whose `(tick + trip_id) % REROUTE_PERIOD_TICKS == 0`.
  - `run_retries` visits only the slots whose retry is due this tick.
  - Both visit them in **ascending slot order**, so the results are identical.
  - Both schedules are derived data, rebuilt on restore and branch like the router cache, and are not hashed.
- **Shared snapshots.** Snapshots are stored as `Arc<Snapshot>`. `Timeline::branch` shares the snapshots below `at` instead of deep-cloning them, and copies only what it keeps.
  - Memory accounting stays per timeline: each counts the bytes it holds, shared or not.
  - `Timeline::shared_snapshots(&other) -> usize` reports how many snapshots two timelines share.

**sim-wasm**
- `Sim::debug_trap()` panics on purpose, so the trap path can be tested.

**Host and client**
- **Paused frames.** While paused and idle, the host does not post frames every iteration.
  - It posts one frame after every handled message (seek, command, inspect, view, compare, speed, branch, and so on) and at most **2 heartbeat frames per second** otherwise.
  - The UI keeps rendering (hover, pan and zoom do not need new frames).
- **Frame pool.** A buffer that is large enough is reused, using a `vehicles` view of length `count × 16`. The pool is not cleared on post, and A and B have separate pools.
  - In steady state, with buffers returned, there is no new `ArrayBuffer` per frame, in single view or while comparing.
- **Restart after a trap.**
  - A trap (any exception from a wasm call) posts a **fatal** error and halts.
  - The UI shows a non-dismissible banner, "The simulation stopped: …", with a **"Restart simulation"** button. It creates a new worker and re-initializes (same city, seeds and warm-up), and the banner disappears when the new worker is ready.
  - Fatal errors are never cleared by other actions (g7). Non-fatal refusals keep their polish-002 behaviour.
  - The client handles `messageerror` like a worker error.
- **Clock.** `init` resets the whole clock: backlog, credit, the ms-per-tick estimate and the achieved-rate window (f1).

**Docs.** `docs/performance.md` gets a "Profiling and optimization (polish-005)" section with before and after numbers, the cause, and the method. All numbers come from a committed native probe (`cargo run -p sim-core --release --example frame_cost_probe`) and the existing browser harness.

## Specification
- **Determinism is non-negotiable.** The golden hashes above must hold after this ward. They also pin the order of periodic and retry processing.
- **Timing thresholds** are checked only in release builds (`cfg(debug_assertions)` skips them, like the calibration tests). They compare **in the same process**: the new `metrics()` against `metrics_full_scan()` on the same world. Absolute times are not machine-portable.
- **Pinned (frozen) and not to be broken:**
  - `core_004` frame tests: record layout, `link_stats`, and the metric arrays;
  - `timeline_001/002` tests: snapshot bytes accounting, budget eviction, branch independence;
  - host tests that expect a frame after each message.
- **Heartbeat:** "at most 2 frames/s while paused and idle". A frozen test may wait up to 1 s for a paused frame, so 2/s still serves it.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `golden_hashes_hold` (Rust, release) | The River City timeline and branch hashes at ×1 and ×5, and the three_bridges hashes at 1200/2400/3600, equal the golden values listed above. |
| 2 | `incremental_metrics_equal_full_scan` (Rust) | Through River City ×3 (closures, a reopen, seeks back and forth, a branch) and three_bridges with all bridges closed (stranded vehicles, unreachable removals), `metrics()` equals `metrics_full_scan()` field by field, bit for bit (`f64::to_bits` for floats), at least every 60 ticks and right after every seek, restore and branch. |
| 3 | `metrics_is_cheap` (Rust, release only) | On River City ×5 after 1 sim h, over 500 calls each, `metrics()` mean ≤ 0.25 × `metrics_full_scan()` mean in the same process. |
| 4 | `schedules_visit_only_due_slots` (Rust) | One tick on River City ×5 after 1 sim h, with every slot's `in_periodic`/retry state preserved: the periodic step visits ≤ 1.2 × (live slots / 240) + 10 slots, and the retry step visits only due slots. Counted with doc-hidden `World::last_step_visits()` (periodic, retries). The golden hashes (test 1) prove the order is unchanged. |
| 5 | `branch_shares_snapshots` (Rust) | After `branch(at)` on a 3 sim h River City timeline, `shared_snapshots` equals the number of A's retained snapshots below `at`, or B's kept count if B's budget is smaller. B's `snapshot_bytes` ≤ B's budget. A and B remain independent: stepping B does not change A's hash, and a seek in A does not change B's. |
| 6 | `paused_host_posts_rarely` (vitest, real wasm host, fake clock) | Paused and idle for 5 s of fake time (iterate every 16 ms): at most 11 frames, against ~312 today. After a `seek`, a `command`, an `inspectLink`, a `viewScenario` and a `setSpeed`, each is followed by a frame within one iteration. Running: a frame at least every 2 iterations (unchanged). |
| 7 | `frame_buffers_are_reused` (vitest, real wasm host) | Running for 200 iterations with every posted `vehicles` buffer returned: after a 20-iteration warm-up, the posted buffers come from ≤ 3 distinct `ArrayBuffer` objects. The same holds in compare (A and B posts, ≤ 3 each). A frame's `count × 16` ≤ its buffer's length, and the `vehicles` view length equals `count × 16`. |
| 8 | `trap_offers_restart` (e2e) | Trigger `debugTrap` through the test hook (`__livingcity.debugTrap()`). An alert "The simulation stopped" with a "Restart simulation" button appears. It has no Dismiss. Other actions (seek, compare) do not clear it. "Restart simulation" brings a living city back: the tick advances past the warm-up and the alert is gone. No page error is thrown. |
| 9 | `reinit_resets_the_clock` (vitest) | A `SimClock` with backlog, credit, an ms-per-tick estimate and a full achieved window, after `reset()` (called by `init`), behaves exactly like a new `SimClock`: the same `plan()` and `status()` sequence for the same input. |
| 10 | `performance_doc_cites_the_probe` (vitest, static + probe output) | `docs/performance.md` has a "Profiling and optimization" section. It names the cause (full slot scans, active vs on-network). Every number in it appears in `web/perf-results/frame-cost.json`, which `frame_cost_probe` writes. That JSON has before/after `metrics` and `step` means at ×1, ×3 and ×5. The "before" values are taken with `metrics_full_scan()`, plus the step means measured at commit `4e5d5c1` and recorded in the JSON as `baseline`. |

## Must NOT
- Change any sim result. The golden hashes and all frozen determinism tests must hold.
- Measure in debug builds, or claim numbers that no probe or JSON produced.
- Edit frozen tests.

## Must DO
- Commit the probe (`crates/sim-core/examples/frame_cost_probe.rs`) and its JSON.
- Re-run `pnpm -C web e2e:perf` and update the baseline numbers in `docs/performance.md` if they change, with the run conditions.
- Update CONTEXT and the backlog accounting (e1–e4, f1, f2, g7).

## Manual Smoke Test
### Setup
`pnpm -C web build:wasm && pnpm -C web dev` (any port except 4243).
### Steps
1. With `?demand=5`, open diagnostics. The tick ms and frame cost are lower than before (compare with `docs/performance.md`).
2. Pause and watch the browser's CPU: it is near idle. Hover and pan still respond.
3. Compare A and B for a minute: memory in the browser's task manager is steady.
4. In the console, run `window.__livingcity.debugTrap()`. The banner appears; "Restart simulation" brings the city back.
### Pass criteria
- [ ] The measured numbers improved and are documented.
- [ ] Paused is near idle.
- [ ] Restart works.
- [ ] All suites are green and the golden hashes hold.
