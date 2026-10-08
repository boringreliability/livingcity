---
epic: "timeline"
name: "Replay, branching and comparison"
status: "active"
created: "2026-10-06"
---
# Epic: Replay, branching and comparison

## Goal
This epic delivers the second half of the brief's acceptance criterion: *close a bridge, see the consequences, **rewind, try another decision, and compare the outcomes***. It adds:
- periodic snapshots with deterministic resimulation, so recorded history can be scrubbed backwards;
- an explicit, visible memory budget;
- exactly two scenarios: the original (A), preserved, and one branch (B) taken from an earlier tick with identical external demand;
- a side-by-side comparison at matching sim time, with linked cameras and window metrics that include incomplete trips.

Out of scope (brief): more than two scenarios, a general branching editor, persistence across reloads, and editing commands other than closing or opening roads.

## Wards
| Ward | Name | Status |
|------|------|--------|
| timeline-001 | Snapshots and seek in sim-core (budgeted snapshot store, restore ≡ uninterrupted) | complete |
| timeline-002 | Branch and window metrics in sim-core (independent scenario B, identical demand, incomplete trips) | complete |
| timeline-003 | Timeline in the worker and UI (seek / scrub, replay window and memory budget shown, branch on a past intervention) | complete |
| timeline-004 | Two scenarios side by side (lockstep A/B, split view, linked cameras, comparison metrics) | planned |
| timeline-005 | The full brief workflow in the browser, measured (integration ward) | planned |

## Measured basis (2026-10-08)
Measured natively in release on River City at seed 2026/7, with a scratch probe that leaves the repo untouched. All numbers are measured.

**Cost of cloning and stepping**

| | at tick 1800 | at tick 7200 |
|---|---|---|
| `World::clone` (median) | 46–50 µs | 51–57 µs |
| one step (mean) | 0.021 ms | 0.021–0.023 ms |
| bytes allocated by one clone | 685 KB | 1,608 KB |
| logs' share of those bytes (`generated` + `completed_log`) | 39 % | 73 % |
| `state_hash` | 0.55 ms | 1.50 ms |

- A clone costs about 2.5 ticks. Logs grow by about 1.2 MB per sim hour.
- State per tick is about 0.35 MB and stays flat.
- `Network` + `DemandModel` are 36.5 KB, immutable and shareable.
- `state_hash` costs O(history), so it is unsuitable for every tick in production.

**Determinism**
- Two clones at tick 1800 and the uninterrupted run hash equal at every tick for 1,200 ticks. They also stay equal with the same close command.
- Branches with and without a closure generate identical demand, down to the trip ids.
- A clone at tick 1830 with an emptied `RouterCache` equals the uninterrupted run at every tick, so the cache is truly derived.

## Contract additions (binding; core and city contracts stay in force)

### T1. Snapshots, restore and seek (sim-core; timeline-001)
- **Shared data.** `World` holds `Network` and `DemandModel` behind `Arc`. Accessors and behaviour stay the same, and cloning a world no longer copies them.
- **A `Snapshot`** is everything in `World` that affects the future, without the append-only logs (`generated`, `completed_log`, `removed_log`) and without the command log. It keeps:
  - the logs' lengths at that tick;
  - its `tick`;
  - its byte size, from `Snapshot::bytes()`: the sum of owned capacities × element sizes. This is accounting, not an estimate of allocator overhead.
  The `RouterCache` is **not** stored. Restore starts it empty.
- **`Timeline`** owns one `World` (the *position*) plus a snapshot store:
  - Snapshots are taken at tick 0 and at every multiple of `SNAPSHOT_INTERVAL_TICKS = 120` (1 sim minute) that the timeline steps through.
  - A step never takes a second snapshot of a tick it already holds.
  - `head_tick` is the furthest tick simulated with the current command log. `position_tick` ≤ `head_tick`.
- **Authoritative data.** The timeline owns the authoritative command log and the logs as of `head_tick`.
- **`seek(tick)`** for `window_start ≤ tick ≤ head_tick`:
  - restores the newest snapshot ≤ `tick`. The state is cloned from the snapshot, the timeline's current command log is installed, the logs become the head logs' prefix at the snapshot's lengths, and the router is emptied;
  - then steps to `tick`;
  - the result equals the uninterrupted run at that tick (equal `state_hash`, equal logs);
  - seeking outside the window is an error, and nothing changes.
- **`step()` at `position_tick < head_tick`** replays (the same commands, so the same outcome). It never forks history by itself.
- **The memory budget** is `budget_bytes`, set by the caller. The host default is 48 MiB per scenario, 96 MiB for two.
  - When the snapshots' total `bytes()` exceeds the budget, the oldest snapshots are evicted. Tick 0's snapshot is evicted like any other.
  - `window_start` is the tick of the oldest retained snapshot. The window is reported with the total bytes and the budget.
  - No full world is ever stored per frame or per tick.
- **Editing the future.** `schedule(command)` at `position_tick < head_tick`:
  - first validates the command (`InPast`, `UnknownLink`); an invalid command changes nothing;
  - then truncates every snapshot after `position_tick`, the head logs at `position_tick`, and the command log's commands for ticks > `position_tick`, and sets `head_tick = position_tick`;
  - then schedules the command.
  - Later steps take snapshots again as usual.
  This is how scenario B is edited. Scenario A is never edited in the past (T3).
- **Determinism.** Restore + replay must be bit-identical to the uninterrupted run, including the RNG state, the reroute queues and flags, gridlock `blocked_ticks`, the EMA accumulators, `rr_next`, credits and origin buffers.

### T2. Branches and window metrics (sim-core; timeline-002)
- **Branching.** `Timeline::branch(&self, at_tick) -> Timeline`, for `window_start ≤ at_tick ≤ head_tick`, creates an independent timeline:
  - its own world is at `at_tick`, equal to the original at that tick;
  - it takes only the commands for ticks < `at_tick`;
  - its snapshot store holds the one snapshot at `at_tick`, plus copies of any retained snapshots before it, within its own budget;
  - its logs are copies truncated at `at_tick`;
  - it shares only `Arc` data with the original;
  - the original is unchanged (its hash, head and logs).
- **Demand.** For every tick both timelines run, the generated trips (flow, origin, destination, tick, trip id) are identical, as long as neither spawns trips outside the demand model.
- **Window metrics.** `World::window_metrics(from_tick)` covers [from, now]:
  - `generated`, `completed`, `removed_unreachable`, `removed_gridlock`;
  - `incomplete` = generated in the window and neither completed nor removed by now (in transit or waiting);
  - `mean_travel_time_s` and `p95_travel_time_s` of the trips completed in the window that were *also* generated in it.
  Comparisons use these numbers, and `incomplete` is what stops a scenario looking better just because its slowest vehicles have not arrived yet.

### T3. Worker and timeline UI (timeline-003)
- **Protocol additions:**
  - `seek {scenario, tick}` and `branch {fromTick}`;
  - `discardBranch`;
  - `command` gets an optional `scenario` (default A).
- **Frame fields:** frames carry `scenario: 0 | 1` and `timeline { windowStartTick, headTick, positionTick, branchTick | null, snapshotBytes, budgetBytes }` (numbers only; `branchTick` is −1 when there is none, keeping the numeric payload rule).
- **Seeking:**
  - A seek pauses the scenario.
  - Long resimulation (outside the window it is refused) runs in bounded batches (≤ 40 ms, like the warm-up).
  - Frames show the seek target once it is reached.
  - After a seek, inspection, extrapolation and the clock reset (`resetExecuted`, `resync`, and the trip tables).
- **Interventions:**
  - A close or open on **A** at `position_tick < head_tick` does **not** edit A. It creates scenario B from `position_tick` with that command; if B already exists, the user first confirms "Replace the branch".
  - On **B**, it edits B's future (T1).
  - At the head, a close or open is an ordinary command.
- **Timeline UI.** A bottom timeline shows:
  - the retained window (shaded, with its sim-time bounds), the head, the playhead and the branch point;
  - the memory used and the budget (`snapshotBytes / budgetBytes`).
  It is keyboard operable: ←/→ step 1 sim min, Home jumps to the window start, End to the head. Sim time is labelled as sim time.

### T4. Two scenarios side by side (timeline-004)
- **Lockstep.**
  - The worker advances A and B in lockstep, so both are always at the same `position_tick` while comparing.
  - The clock budget covers both.
  - Frames for A and B are posted with the same tick.
  - "Behind" refers to the pair.
- **Split view.**
  - One canvas or WebGL context, two viewports (scissored), each labelled **A: original** / **B: branch**. The scenario is identified by its label text and a pattern frame, never by hue.
  - Cameras are linked: pan and zoom apply to both.
  - Picking and inspection know which side was clicked.
- **Comparison panel** at the shared tick:
  - window metrics from `branchTick` for A and B, side by side, with the differences;
  - `incomplete` is always shown.
- **Exiting.** Discarding B returns to the single view of A.

### T5. Integration and measurement (timeline-005)
- **The brief's browser flow, end to end:** open → traffic → close the bridge → queues and rerouting → rewind → branch with another decision → compare at matching sim time.
- **Measurements:**
  - the cost of seek and resimulation;
  - the snapshot cost;
  - lockstep tick and render cost;
  - memory against the budget.
  These are added to `docs/performance.md`.
- **Docs:**
  - a concise architecture explanation;
  - the traffic-model assumptions;
  - the demo walkthrough (brief § Delivery).

## Integration Points
- It builds on `World: Clone`, the counter-based demand (core-002), the command log (core-003), `state_hash`, and the host's chunked warm-up (city-005).
- The renderer gains a viewport and scenario parameter. The decor and geometry are shared.
- `polish` gets the a11y audit and onboarding, plus the remaining MINORs (CONTEXT).

## Completion Criteria
- **Tests:** all earlier tests stay green, unchanged (except approved supersessions).
- **Determinism:** restore + replay ≡ uninterrupted (hash and logs, River City and three_bridges, with commands and gridlock); branch independence and identical demand are tested natively.
- **In the browser:** the full flow works, the memory window is visible, and the comparison shows matching sim time with incomplete trips.
- **Performance:** the costs are measured and reported, and the human epic gate approves.
