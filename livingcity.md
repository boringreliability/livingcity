Build **Living City**: an interactive city traffic simulation powered by Rust compiled to WebAssembly.

The defining experience is:

**“Close a bridge. Watch the city adapt. Rewind time. Try a different decision. Compare the consequences.”**

This must become a working, visually compelling browser application, with a real simulation underneath it. Implement it, run it, test it, and inspect it in the browser. Do not stop after producing a plan or scaffold.

## Working approach

First inspect the repository and follow its existing instructions, conventions, and tooling. If it uses WDD, follow that workflow.

If this is an empty repository, create a sensible project structure. Make routine implementation decisions yourself and document significant trade-offs. Ask only when a genuinely blocking ambiguity exists.

Work in small vertical slices, keeping the application runnable. Establish one complete interaction early: spawn traffic → close a road → observe rerouting.

## Product experience

The opening screen should already contain a living city.

A river divides two parts of town, connected by three crossings. Include residential districts, workplaces, a hospital, and an alternative route with limited capacity. Design the network so closing the central bridge produces understandable consequences.

The user can:

- Pan and zoom around the city.
- Inspect roads and vehicles.
- Close and reopen individual road segments.
- Pause, resume, and change simulation speed.
- Scrub backwards through recorded simulation history.
- Branch from an earlier moment and try another intervention.
- Compare two scenarios side by side.

Provide a prominent **“Close the main bridge”** action for the first demo. The resulting queues and alternative routes must emerge from the simulation.

Use a fixed, reproducible demand pattern so the demo is reliable. Calibrate the network to make the effect visible without scripting the traffic outcome.

## Technical responsibilities

Use:

- **Rust/WASM** for authoritative simulation state, traffic movement, routing, interventions, metrics, snapshots, and replay.
- A **Web Worker** to keep simulation work off the UI thread.
- **TypeScript and React** for controls and application UI.
- A GPU-accelerated canvas renderer for the city and vehicles.

Prefer WebGL2 or WebGPU according to repository fit and implementation cost. The first version must not depend on GPU compute for simulation correctness.

Keep simulation and rendering separate. Rendering frame rate must not affect simulation results.

Avoid per-vehicle JS/WASM calls and per-frame JSON serialization. Use compact buffers and batched messages. Keep data transfers proportional to what rendering actually needs.

Start with a single simulation worker and transferable buffers. Introduce shared memory or WASM threads only if profiling demonstrates a need.

The Rust core must run in native tests and benchmarks without requiring a browser.

## Simulation model

Implement a deliberately simplified but coherent traffic model:

- A directed road graph.
- Explicit road lengths, speed limits, and storage capacity.
- Vehicles with origins, destinations, routes, and progress along road segments.
- Queueing and downstream capacity constraints.
- Explicit intersection discharge rules.
- Seeded trip generation.
- Routing based on travel cost.
- Budgeted, staggered route recalculation.
- Completed trips and measured travel times.

A queue must be able to propagate upstream when the next road is full. Vehicles must not overlap freely or pass through blocked intersections.

Document the simplifications. This is an interactive simulation experiment, not a validated transport planning tool.

Define closure semantics clearly:

- A closure prevents new vehicles from entering the affected segment.
- Vehicles already on it may leave.
- Affected vehicles recalculate routes at valid decision points.
- If no route exists, vehicles wait and retry on a bounded schedule.

Use congestion-aware routing without recalculating every vehicle every tick. Apply smoothing, hysteresis, or another explicit mechanism to prevent constant route switching.

Use a fixed simulation timestep, seeded randomness, and stable processing order. Avoid wall-clock time inside simulation logic.

## Replay and branching

Treat replay as an architectural requirement from the beginning.

Record user interventions as commands tied to simulation ticks. Use periodic snapshots and deterministic resimulation between snapshots.

Snapshots must include all state necessary for continuation, including random generator state, pending demand, routing scheduler state, and any caches that affect decisions.

Set an explicit memory budget and expose the retained replay window. Do not store a full copy of the world every frame.

When a user rewinds and makes a new intervention:

- Preserve the original scenario.
- Create an independent branch.
- Retain the same external trip demand for a fair comparison.
- Allow both scenarios to advance to the same simulation time.

Keep demand randomness separate from behavior randomness so an intervention does not accidentally change the future trip population.

For the first version, support two scenarios only. A general branching editor is out of scope.

Side-by-side comparison should support linked cameras and display metrics for matching simulation times and measurement windows.

## Visual direction

Make this feel like a beautiful, understandable miniature city.

Use:

- A dark, restrained background.
- Clearly shaped roads and crossings.
- Subtle building footprints and district labels.
- Vehicles that visibly slow down and queue.
- Smooth pan and zoom.
- Level-of-detail choices that keep the scene readable.
- Clear selection and hover states.

At wide zoom, the network and congestion patterns should dominate. At close zoom, individual vehicles should become readable.

The user is colorblind. Do not rely on red versus green. Combine color with patterns, icons, line thickness, labels, and visible movement.

Closed roads must have an unmistakable physical marker. Congestion must be visible through vehicle behavior as well as any overlay.

Include a polished bottom timeline and a compact control panel. Keep technical performance counters in an expandable diagnostics panel.

Avoid generic dashboard clutter, gratuitous glow, and decorative charts with invented data.

## Meaningful metrics

Show real values computed by the simulation:

- Active vehicles.
- Completed trips.
- Mean travel time for completed trips.
- Current number of queued vehicles.
- Unserved or unreachable trips.

Define what “queued” means.

When comparing scenarios, also show incomplete trips so a scenario does not look better simply because its slowest vehicles have not arrived yet.

Clearly distinguish simulation time from wall-clock time.

## Scope boundaries

For this first version, do not build:

- A full city builder.
- A road drawing editor.
- Real map imports.
- Multiplayer or a backend.
- Accounts.
- Pedestrians or public transport.
- A detailed economic model.
- AI-generated decision-making.
- Complex 3D assets.

A fixed, carefully designed city is sufficient.

## Performance goals

Aim for:

- A convincing initial demo with approximately 2,000 active vehicles.
- Interactive operation at 10,000 active vehicles on the available development machine.
- Responsive controls while the simulation is busy.
- Smooth rendering near 60 FPS where hardware allows.

These are targets to measure, not claims to fabricate.

Report simulation tick time and rendering frame time separately. Include median and p95 measurements, tested vehicle counts, browser, hardware when known, and workload conditions.

Measure normal traffic, the burst of work after a bridge closure, and side-by-side scenarios.

If targets are missed, profile the bottleneck and report the achieved result honestly. Simulation speed controls must expose when the engine cannot keep up, rather than silently skipping simulation steps.

## Implementation sequence

1. Build the Rust simulation core and a small deterministic test network.
2. Connect WASM in a worker to a basic city renderer.
3. Deliver the first working road-closure interaction.
4. Add visible queue propagation and sensible rerouting.
5. Add snapshots, replay, and a timeline.
6. Add an independent scenario branch and synchronized comparison.
7. Polish the city, accessibility, and first-run demonstration.
8. Profile and optimize measured bottlenecks.

Do not spend the first half of the project building abstractions for hypothetical future features.

## Verification

Write meaningful tests for:

- Vehicle conservation: spawned vehicles are accounted for as active, completed, or explicitly removed.
- Road capacity and queue behavior.
- Closure and reopening semantics.
- Unreachable destinations.
- Deterministic outcomes for the same seed and command log.
- Snapshot restoration followed by replay matching uninterrupted execution.
- Scenario branches remaining independent.
- External demand remaining identical across branches.
- Correct metric calculations.

Use an actual browser to verify the complete workflow:

**Open app → observe traffic → close bridge → observe queues and rerouting → rewind → create alternative branch → compare at matching simulation time.**

Also check keyboard access, readable labels, and control responsiveness under load.

## Delivery

Deliver:

- A working application.
- Clear local setup and run commands.
- A concise architecture explanation.
- Documented traffic-model assumptions.
- Tests and their results.
- Measured performance and known limitations.
- A short walkthrough of the most compelling demo.

The acceptance criterion is simple:

**I can close a bridge, see the traffic consequences emerge, rewind, try another decision, and compare the outcomes — all locally in the browser, with Rust/WASM doing the actual simulation.**