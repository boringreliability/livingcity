# Architecture

Living City has four layers. Each layer only talks to the one next to it.

```
crates/sim-core   Rust: network, vehicles, routing, demand, commands, metrics, snapshots, timeline
      │  (native: cargo test / examples, no browser)
crates/sim-wasm   thin wasm-bindgen adapter: one `Sim` = one `Timeline`, typed-array getters
      │
web/src/sim       one Web Worker: host (scenarios A/B, SimClock pacing, compare lockstep), protocol
      │  postMessage: typed buffers (transferred), small control messages
web/src/render    WebGL2 renderer (city, roads, vehicles), camera, picking, decor
web/src/ui        React panels: controls, timeline, scenarios, comparison, selection, diagnostics
```

## Layers
- **`sim-core`** is the single source of truth. It owns the road network (nodes in world metres, directed links with length, lanes, speed limit and storage), the vehicles (link, offset along the link, lane), the queues and discharge, routing, demand, closures as tick-keyed commands, the metrics, and the timeline. It builds and tests natively; the browser is not needed for any correctness test. No clocks, no screen coordinates, no colours.
- **`sim-wasm`** is a thin layer. `Sim` wraps a `Timeline` (with a 48 MiB replay budget per scenario) and exposes `step`, commands, `seek`, `branch`, `timeline_info`, `window_metrics`, the frame buffers and `free`. It has no logic of its own beyond copying into typed arrays.
- **The worker host** (`web/src/sim/host.ts`) runs in exactly one Web Worker. It holds scenario A (the original) and, after a branch, scenario B. A `SimClock` decides how many ticks to run per iteration from the measured cost per tick and the selected speed, within an 8 ms iteration budget and a 1 s backlog cap. When the engine cannot keep up, the UI shows "behind" instead of silently skipping steps. The UI thread never steps the simulation.
- **The renderer** (`web/src/render`) converts *link + offset* into world positions, and world positions into the screen through the camera. City decor (river, blocks, labels) is render-side data and never enters the sim.
- **The UI** (`web/src/ui`, `App.tsx`) sends intents (play, speed, close link, seek, branch, compare) to the worker through `client.ts`, and draws what the frames say.

## Data flow per frame
1. The host runs a batch of ticks, then builds one frame. The frame holds the vehicle records (16 bytes each: link, metres along it, speed, and flags with the lane, queued, on-closed-link and stranded bits), each record's next link (`nextLinks`, 2 bytes), per-link counts and queue state, the metrics in a fixed name order, the closed links and the timeline status.
2. The vehicle `ArrayBuffer` is a **transferable** (not copied); the UI returns it (`returnBuffer`) to its side's pool. `nextLinks` is copied, not transferred.
3. Frames also carry trip ids (`tripIds`, 4 bytes each) and a per-side `epoch` that changes on every jump. The presenter (`render/presentation.ts`) shows a time just behind the newest frame, never ahead, interpolating each car by trip id. Held cars wait at stop lines clear of other roads; turns follow one curve from stop line to the next link's entry. The CPU computes each pose, the GPU draws it; A and B share one clock.

There are no per-vehicle JS↔wasm calls and no per-frame JSON. Vehicle and road details are fetched only on request: `inspectVehicle` names a vehicle by frame tick and record, and `inspectLink` names a link id. Frames also carry the command log and bridge exits (motion-003). In compare mode a small `comparison` message (A's and B's windowed metrics) goes out at most every 500 ms. Also sent on entering compare, seeking or pausing.

## Determinism
- **Fixed timestep:** 0.5 s per tick. The processing order is stable: vehicles, links and nodes go in index order, and no hash-map iteration feeds any decision. The sim logic never reads the wall clock (enforced by `clippy.toml`).
- **Two random streams.** *Demand* comes from a counter-based generator keyed by the demand seed, the tick and the OD flow's index (no stored state), so the trip population does not depend on anything the vehicles do. *Behaviour* randomness has its own seeded state. An intervention can therefore never change who wants to travel when, so A and B always share the same external demand.
- **Interventions are commands** keyed to a tick and recorded in a command log. A run is fully determined by the seed and the command log; `state_hash` checks this in the tests.
- **Rendering is decoupled.** The render rate only changes how often frames are drawn, never which ticks run or their results.

## Timeline: snapshots, seek, branch and compare
- **Snapshots.** Every 120 ticks (one sim minute) the timeline stores a snapshot. A snapshot holds everything that affects the future: vehicles with their routes and retry schedules, queues, discharge credit, both RNG states, pending demand, the cost estimates and the routing scheduler queues. It leaves out the append-only logs, which it records only as lengths, and the router cache, which is derived and rebuilt on restore. The network and demand model are shared (`Arc`), not copied.
- **Budget.** When the budget is reached, the oldest snapshots are evicted. The retained span is the replay window, and the timeline bar shows its memory against the budget.
- **Seek.** A seek restores the newest snapshot at or before the target and replays deterministically (at most 119 ticks). The result is bit-identical to an uninterrupted run, which the tests check by hash and logs.
- **Edits in the past.** Scheduling a command below the head cuts the future: later snapshots, commands and log entries are dropped. The UI never does this to A. An intervention in A's past creates **branch B** instead.
- **Branch.** `Timeline::branch(at)` builds B from the snapshot before `at`, with the commands before `at`, and then applies the intervention. A is left untouched. v1 has exactly two scenarios; a new branch replaces B after a confirmation.
- **Compare (lockstep).** Both scenarios are aligned to the same tick and then advanced in strict pairs: a frame of A and a frame of B always show the same sim time. The two canvases share one camera. The comparison panel shows `window_metrics` for the cohort of trips generated since the branch tick, including the **incomplete** trips, so a scenario does not look better just because its slow trips have not arrived yet.

## The sim/render boundary
The simulation owns *where a vehicle is along the road* (link id, metres from the link start, lane). It does not know where that is on screen. The renderer turns link + offset into a position using the link geometry, which comes from the network's node coordinates in metres. This keeps a later 3D or tilted view (v3) on top of the same simulation without changing the core.

## Deviations

### From the brief
- **10,000 active vehicles.** River City peaks at about 7,600 vehicles on the network in the stress run. This is limited by intersection and entry throughput, not by tick cost; see `docs/performance.md`.
- **~60 FPS.** Met on a hardware GPU. On the SwiftShader software renderer used by the headless tests, rendering runs at about 20 FPS. Sim results are unaffected, since rendering is decoupled.
- **WebGPU.** Only WebGL2 is implemented; the brief allows either.

### From the timeline contract (T3, ward timeline-003)
- **Protocol.** `seek {tick}` and `command` apply to the *viewed* scenario instead of carrying a `scenario` field. `viewScenario` and `branch.then` are new; `then` applies the triggering intervention to B atomically.
- **Seek runs synchronously.** It replays at most 119 ticks (a few milliseconds in wasm), so the bounded batches that T3 asks for, for long resimulation, are unnecessary.
- **Memory.** Each scenario has its own 48 MiB budget, so up to 96 MiB in steady state. When B is replaced, the host frees the old B first and only then builds the new one, so the peak stays at A plus one B. The bar shows the viewed scenario's memory and says "per scenario".
- **`Sim.window_metrics`** is added to the wasm adapter in timeline-003; its consumer is the comparison panel.

### From the timeline contract (T4, ward timeline-004)
- **Two canvases (two WebGL contexts) instead of one context with two viewports.** This reuses `CityRenderer` unchanged per side, at the cost of double (small) GPU buffers. Since polish-006 a spare B context is made ahead of time while a branch exists, and a left B context is released right after the first single-view draw (both are synchronous GPU waits; see "From epic polish").
- **Interventions are disabled while comparing.** T4 does not say which side a control would act on; comparing is for observing, and changes are made in the single view.
- **Vehicle inspection is off while comparing, and so is the A/B view switch.** Road inspection works per side.
- **Seeks below the branch tick are refused while comparing.** The slider spans the shared window.

### Completion criteria (epic timeline)
- **Tests:** all earlier tests stay green and unchanged, except the supersessions the user approved.
- **Determinism:** restore + replay ≡ an uninterrupted run (hash and logs, River City and three_bridges, with commands and gridlock relief). Branch independence and identical demand are tested natively (`timeline_001_snapshots`, `timeline_002_branch`).
- **In the browser:** the full flow (close, consequences, rewind, branch, compare) runs in `web/e2e/acceptance.spec.ts`. The memory window is shown in the timeline bar. The comparison shows matching sim time and incomplete trips.
- **Performance:** seek, branch, snapshot memory and the lockstep cost are measured in `web/perf-results/timeline.json` and reported in `docs/performance.md` § Timeline.

### From epic polish
- **e2: paused frames.** Resolved in epic motion (motion-001): a paused host posts a frame only after a handled message, plus one settling frame; G4/G4b were superseded (`.wdd/memory/supersessions.md`).
- **e3: frame pools.** Resolved in epic motion (motion-001): each side keeps a LIFO pool of up to 4 exact-size buffers, tagged with a world generation so a replaced world's buffers are never reused; G8 was superseded.
- **i1: a car stopped at the end of the junction curve.** Resolved in epic motion (motion-002): cars are interpolated between frames by trip id; it replaced polish-003's extrapolation (capped at 1.5 × the expected sim advance); polish-003 tests 3–6 and motion.spec 7 were superseded (S4–S8).
- **i2: held cars stacked in junctions.** Resolved in epic motion (motion-002): junction clearances from the drawn geometry put each stop line clear of every other road (option A, chosen by the user).
- **i3: the hover halo stays.** Hover keeps its light-grey halo and adds a dashed centre stroke; the frozen gold5 G1 pins the halo.
- **i5: the closure sign is a ring.** A closed road shows a white ring with the hatch inside, not a 6 × 6 px white core; the frozen look.spec midpoint-hatch test pins it.
- **Compare switch off the GPU critical path (polish-006).** WebGL context creation, release and drawing-buffer resizes wait for the GPU process (0.3–0.9 s each on SwiftShader under `?demand=5`). So A's drawing buffer is sized for the whole app area and is not resized by the switch (A is drawn 2× wide-sampled while comparing), B's renderer is prepared ahead of time, and a left B context is released after the first single-view draw. Those tasks still occupy the main thread afterwards; see `docs/known-issues.md`.
