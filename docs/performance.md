# Living City: measured performance (wards city-005, timeline-005, polish-005 and polish-006)

Every number below comes from a run. The `@perf` harness (`pnpm -C web e2e:perf`, `web/e2e/perf.spec.ts`) writes the JSON files in `web/perf-results/`. One manual run on a hardware GPU is recorded in `web/perf-results/manual-hardware-gpu.json`, and a node + wasm throughput probe in `web/perf-results/network-throughput-probe.json`. Nothing here is estimated. Where a target is missed, the report says so and names the measured bottleneck.

## Method

- **Machine:** Mac16,7, Apple M4 Pro (`sysctl hw.model machdep.cpu.brand_string`).
- **Harness runs (2026-10-10, 02:04–02:09 UTC per the JSON timestamps; re-run in polish-006 after the polish-005 optimizations). The machine is shared: its 1-minute load average was 7.2 at the start and 16.5 at the end.**
  - Chromium 153.0.8010.12, headless (from the browser's real user agent via CDP), 1280 × 800, DPR 1.
  - Launch args `--use-angle=swiftshader --enable-unsafe-swiftshader`. The app's renderer reports *ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …), SwiftShader driver)*. This is a **software GPU**, so the harness render numbers measure software rasterisation, not a graphics card.
- **Hardware-GPU run (2026-10-08 13:03 UTC):**
  - Headed Chrome 154 (Playwright MCP browser), same viewport.
  - Renderer *ANGLE Metal Renderer: Apple M4 Pro*, 120 Hz display.
  - It uses the same recording API and reductions as the harness, but it is a manual run.
- **What is measured:**
  - **Sim tick time:** the worker measures each step batch with `performance.now()`. Every frame carries the ticks run since the previous frame and their measured ms. One recording covers the whole measurement (60 s in the harness, 30 s in the manual run). The median and p95 are weighted by ticks (nearest rank). The mean is Σ ms ÷ Σ ticks.
  - **Render frame time, measured separately from sim tick time:** the rAF-to-rAF interval and the draw CPU time (`performance.now()` around `draw`), over every frame of the recording.
  - **Vehicle counts:** sampled per frame. *On network* = vehicles on roads. *Active* also counts trips still waiting at their origin.
- **Timer resolution:** the page is not cross-origin isolated, so the worker clock steps 0.1 ms. Every tick median and p95 below lies under 10 × that step, so the harness sets `tickBelowTimerResolution`. **For tick cost, cite the mean**, which sums many coarse readings. The percentiles only bound it to "≤ one or two clock steps". The same applies to draw CPU time: the median of 0.0 ms and p95 of 0.1 ms mean "under the clock step", not zero.
- **Measurement never changes the simulation.** Ward test 4 runs two hosts, one with a wildly wrong measurement clock, and checks for identical state, frame by frame.

## Results

### Harness (headless Chromium, SwiftShader software GPU)

| Scenario | On network median / max | Active max (waiting at origin max) | Tick ms mean (median / p95) | Render interval ms median / p95 | Draw CPU ms median / p95 | Achieved / target ticks/s | File |
|---|---|---|---|---|---|---|---|
| Baseline 1× (60 s) | 1,772 / 1,800 | 1,803 (12) | **0.053** (0.0 / 0.1) | 50.0 / 50.1 | 0.0 / 0.1 | 2.00 / 2 | `baseline-1x.json` |
| Baseline 20× (60 s) | 1,655 / 1,805 | 1,807 (13) | **0.062** (0.1 / 0.2) | 50.0 / 50.1 | 0.0 / 0.1 | 40.0 / 40 | `baseline-20x.json` |
| Closure burst: first 60 s after closing the Main Bridge at 20× (≈ 20 sim min) | 1,836 / 2,013 | 2,013 (13) | **0.060** (0.1 / 0.2), largest per-frame mean 0.3 | 50.0 / 66.6 | 0.0 / 0.1 | 40.0 / 40 | `closure-burst.json` |
| Stress `?demand=5` at 5× (60 s) | 5,699 / 5,909 | 27,083 (21,174) | **0.161** (0.2 / 0.3) | 100.0 / 116.7 | 0.0 / 0.1 | 10.0 / 10 | `stress-5x.json` |

**Stress before/after polish-005 (browser):** the tick mean at `?demand=5`, 5× fell from 0.248 ms before (the 2026-10-08 run, on the code before polish-005) to 0.161 ms after (−35 %), on the same load (5,698 vs 5,699 on the network at the median, 27,042 vs 27,083 active at most). The native probe below shows a larger cut at its ×5 scale, where far more trips wait at their origins (the cost the optimization removed).

### Hardware GPU (headed Chrome, Apple M4 Pro / Metal, manual run)

| Scenario | On network median / max | Tick ms mean (median / p95) | Render interval ms median / p95 | Draw CPU ms median / p95 | Achieved / target ticks/s |
|---|---|---|---|---|---|
| Baseline 20× (30 s) | 1,654 / 1,781 | **0.088** (0.1 / 0.2) | **8.3 / 9.2** | 0.0 / 0.1 | 40.0 / 40 |
| Stress `?demand=5` at 5× (30 s) | 5,698 / 5,772 | **0.292** (0.3 / 0.5) | **8.3 / 9.3** | 0.0 / 0.1 | 10.0 / 10 |

Frame payloads: 31–36 kB at about 1,700–2,000 vehicles on the network, and 106 kB at about 5,700 (16-byte records, 2-byte next links since polish-003, plus per-link arrays). The speed controls always reached the requested rate, and no run reported *behind*.

## Targets (livingcity.md § Performance)

| Target | Result |
|---|---|
| Smooth rendering near 60 FPS where hardware allows | **Met on hardware:** with the Metal GPU the render interval is 8.3 ms median and 9.3 ms p95 (≈ 120 FPS, the display's rate), also with 5,700 vehicles. **Missed on SwiftShader:** 50 ms median (20 FPS) normally and 100 ms (10 FPS) under stress. The bottleneck is software rasterisation in the test browser: draw CPU on the main thread stays under one clock step, and the GPU work is what takes the time. |
| Interactive operation at 10,000 active vehicles | **Missed as specified.** River City never holds 10,000 vehicles **on its network**. The maximum is 5,909 at `?demand=5` in the harness. A node + wasm probe (`network-throughput-probe.json`, not a harness file) found at most 7,615, at the largest allowed scale ×6 over 3 simulated hours. At ×3–×6 the peaks are 6,066–6,856 within one hour and 6,200–7,615 within three. The bottleneck is the demo network's throughput, not the engine. Its links could store 32,952 vehicles (30,664 without the zone connectors; same file), but extra demand queues at the origins (up to 21,174 trips waiting), because the intersections and entries discharge only so fast. Counted as the sim's *active* (including those waiting), 27,083 trips were live, and the app stayed interactive: ward test 11 checks that Pause takes effect within 300 ms at ×5 demand and 20×, and polish-006 test 1 does the same for Play, a seek and entering or leaving compare (each until the first frame drawn that way). A tick at 5,700 on the network costs 0.16 ms (harness, after polish-005) to 0.29 ms (hardware run, before it) as a mean, which is about 0.6–1.2 % of the 25 ms each tick may take at 40 ticks/s. A network that can carry 10,000 vehicles at once is needed to measure that point in the browser. |
| ≥ 5,000 on the network in the stress run (ward city-005) | **Met:** 5,909 max (harness) and 5,772 (hardware run). |
| Speed controls show when the engine cannot keep up | Every scenario reached its target rate. The *behind* indicator and its honesty are covered by the core-004 and core-005 tests. |

## Timeline

Measured by `perf_timeline_recorded` (`web/e2e/perf_timeline.spec.ts`, the integration ward of epic timeline). Every number in this section comes from `web/perf-results/timeline.json`.

The run: River City at 60×, after running until A's snapshots held 44.3 MiB of the 48 MiB budget (2.6 sim h retained, snapshots every 120 ticks; nothing had been evicted yet). The harness used headless Chromium with the SwiftShader software GPU, at viewport 1280 × 800 and DPR 1, on an Apple M4 Pro (browser, hardware and launch arguments are in the JSON).

| Measurement | Result | How |
|---|---|---|
| Seek latency (in the app) | median **87.6 ms**, p95 96, max 98.6 | 24 clicks spread over the whole window, replaying 5–119 ticks from the snapshot below each target. The time runs from the pointerdown to the first animation frame that shows the target. |
| Branch (intervention in A's past → first frame of B) | **39.7 ms** (one sample) | keydown B on the timeline, timed in the page; shorter than one render interval, so it is bounded by when the next frame arrives |
| Snapshot memory | A **44.3 MiB**, B **37.0 MiB**, pair **81.4 MiB** | against a budget of 48 MiB per scenario; A is still at 44.3 after the lockstep run |
| Tick cost, single view | mean **0.053 ms** | ticks 15647–18050 of A (1644 on the network, median) |
| Tick cost, lockstep A + B | mean **0.093 ms**, ×**1.75** single view | the same A ticks, 15656–18050 |
| Render interval | single **50** ms median; lockstep **83.3** ms median | SwiftShader |

- **Seek latency is bounded by the frame rate here** (`frameBound: true`). The median is below two render intervals of 50 ms, so the number mostly measures when the next SwiftShader frame is drawn, not the replay itself. The replay's own cost is measured natively by `cargo run -p sim-core --release --example timeline_probe`.
- **Tick costs are below ten times the clock resolution** (0.1 ms in the worker, `tickBelowTimerResolution: true`). Per-tick percentiles are therefore not meaningful, and only the means are cited.
- **Lockstep.** Both runs held the requested rate. The lockstep frame interval grows because two canvases are drawn in software, not because of the sim.

## Profiling and optimization (polish-005)

All numbers in this section come from `web/perf-results/frame-cost.json`. The probe `cargo run -p sim-core --release --example frame_cost_probe` measures natively in release on River City (seed `2026/7`). It warms the city for one sim hour, then reports the mean over a run of ticks. The "before" step times were measured on the code at commit `4e5d5c1`, recorded in the JSON as `baseline`. The "before" metrics times come from `metrics_full_scan()`, which is the old implementation. The machine's load average is recorded in the JSON.

**Cause.** Every tick, the periodic-reroute and retry passes made a full scan of every slot, and `metrics()` scanned every slot as well (counts, stranded vehicles, the mean age). Under stress most slots hold trips waiting at their origin, so the cost followed the **active** trips, not the vehicles on the network.

| Scale | `step` before → after (ms) | `metrics()` before → after (ms) | active / on network |
|---|---|---|---|
| `x1` | 0.0213 → 0.0144 | 0.0091 → 0.0035 | 1761 / 1761 |
| `x3` | 0.1523 → 0.0456 | 0.1482 → 0.0072 | 41332 / 6125 |
| `x5` | 0.3306 → 0.0717 | 0.3384 → 0.0082 | 89550 / 6973 |

**The fix.**
- **Metrics:** incremental counters (no-route trips, stranded vehicles, live count and the sum of creation ticks). The queued count is still a lane scan, which is cheap.
- **Reroutes and retries:** the passes visit only the slots that are due, in the same ascending slot order. Both changes live in a derived slot index that is rebuilt on restore, like the router cache.
- **Branching:** snapshots are shared (`Arc`), so a branch no longer copies them. A branch at a full window now takes 1.319 ms instead of 15.287 ms.

**Guarantees.**
- The results are unchanged: the golden `state_hash` values recorded from the old code still hold.
- The active and on-network counts above are identical before and after.
- `metrics()` equals the full scan bit for bit (`polish_005_perf.rs`).

**Pinned by frozen tests (deviations, since superseded in `motion-001`).**
- Paused frames (`review2` G4, `review3` G4b) and the drop-on-post pool rule (`review2` G8): see "Paused work" below. The exact-size rule (`host.test.ts` F6) stays.

## Paused work

Measured by `web/scripts/paused_probe.mjs`. It loads the app (River City, 1280 × 800, SwiftShader), pauses, waits 2 s, then counts for 5 s the frames the UI receives from the worker and their typed-array bytes. Results are in `web/perf-results/paused-before.json` (before ward `motion-001`, load about 10) and `web/perf-results/paused-after.json` (after, load about 25; the counts do not depend on load).

| Paused, after a 2 s settle | Before: frames/s | Before: bytes/s | After: frames/s | After: bytes/s |
|---|---|---|---|---|
| Default demand | 50 | 1,650,041 | 0 | 0 |
| `?demand=5` | 49.8 | 5,030,074 | 0 | 0 |
| Comparing (A + B) | 100.3 | 3,295,021 | 0 | 0 |

A paused host now posts a frame only after a handled message (a command, an inspection, a seek and so on). It also posts one settling frame about 1 s after the pause, so the shown achieved speed reads 0. Camera, hover and selection work from the last frame and the UI's own animation loop, and the Diagnostics panel refreshes its render numbers from that loop.

## How to reproduce

```bash
pnpm -C web build:wasm
pnpm -C web e2e:perf          # rewrites web/perf-results/{baseline-1x,baseline-20x,closure-burst,stress-5x,timeline}.json
cargo run -p sim-core --release --example frame_cost_probe   # web/perf-results/frame-cost.json (native per-tick costs)
node web/scripts/paused_probe.mjs http://localhost:5173 web/perf-results/paused-after.json "label"   # paused frames (dev server running)
```

Each JSON holds the scenario, the run conditions (browser, renderer, viewport, DPR, headless, launch args, hardware), every statistic above, the coverage (frames, ticks and render samples recorded, wall ms), and the targets with `met`. The harness has been run once for this report, and the Gold review re-runs it and compares.
