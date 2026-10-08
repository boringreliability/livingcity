# Living City: measured performance (epic city, ward city-005)

Every number below comes from a run. The `@perf` harness (`pnpm -C web e2e:perf`, `web/e2e/perf.spec.ts`) writes the JSON files in `web/perf-results/`. One manual run on a hardware GPU is recorded in `web/perf-results/manual-hardware-gpu.json`, and a node + wasm throughput probe in `web/perf-results/network-throughput-probe.json`. Nothing here is estimated. Where a target is missed, the report says so and names the measured bottleneck.

## Method

- **Machine:** Mac16,7, Apple M4 Pro (`sysctl hw.model machdep.cpu.brand_string`).
- **Harness runs (2026-10-08, 12:57–13:01 UTC per the JSON timestamps):**
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
| Baseline 1× (60 s) | 1,772 / 1,800 | 1,803 (12) | **0.063** (0.1 / 0.2) | 50.0 / 50.1 | 0.0 / 0.1 | 2.00 / 2 | `baseline-1x.json` |
| Baseline 20× (60 s) | 1,655 / 1,805 | 1,807 (13) | **0.058** (0.1 / 0.1) | 50.0 / 50.1 | 0.0 / 0.1 | 40.0 / 40 | `baseline-20x.json` |
| Closure burst: first 60 s after closing the Main Bridge at 20× (≈ 20 sim min) | 1,841 / 2,044 | 2,044 (13) | **0.063** (0.1 / 0.1), largest per-frame mean 0.7 | 50.0 / 83.3 | 0.0 / 0.1 | 40.0 / 40 | `closure-burst.json` |
| Stress `?demand=5` at 5× (60 s) | 5,698 / 5,899 | 27,042 (21,143) | **0.248** (0.2 / 0.3) | 100.0 / 116.7 | 0.0 / 0.1 | 10.0 / 10 | `stress-5x.json` |

### Hardware GPU (headed Chrome, Apple M4 Pro / Metal, manual run)

| Scenario | On network median / max | Tick ms mean (median / p95) | Render interval ms median / p95 | Draw CPU ms median / p95 | Achieved / target ticks/s |
|---|---|---|---|---|---|
| Baseline 20× (30 s) | 1,654 / 1,781 | **0.088** (0.1 / 0.2) | **8.3 / 9.2** | 0.0 / 0.1 | 40.0 / 40 |
| Stress `?demand=5` at 5× (30 s) | 5,698 / 5,772 | **0.292** (0.3 / 0.5) | **8.3 / 9.3** | 0.0 / 0.1 | 10.0 / 10 |

Frame payloads: 27–33 kB at about 1,700–2,000 vehicles on the network, and 92–94 kB at about 5,700 (16-byte records plus per-link arrays). The speed controls always reached the requested rate, and no run reported *behind*.

## Targets (livingcity.md § Performance)

| Target | Result |
|---|---|
| Smooth rendering near 60 FPS where hardware allows | **Met on hardware:** with the Metal GPU the render interval is 8.3 ms median and 9.3 ms p95 (≈ 120 FPS, the display's rate), also with 5,700 vehicles. **Missed on SwiftShader:** 50 ms median (20 FPS) normally and 100 ms (10 FPS) under stress. The bottleneck is software rasterisation in the test browser: draw CPU on the main thread stays under one clock step, and the GPU work is what takes the time. |
| Interactive operation at 10,000 active vehicles | **Missed as specified.** River City never holds 10,000 vehicles **on its network**. The maximum is 5,899 at `?demand=5` in the harness. A node + wasm probe (`network-throughput-probe.json`, not a harness file) found at most 7,615, at the largest allowed scale ×6 over 3 simulated hours. At ×3–×6 the peaks are 6,066–6,856 within one hour and 6,200–7,615 within three. The bottleneck is the demo network's throughput, not the engine. Its links could store 32,952 vehicles (30,664 without the zone connectors; same file), but extra demand queues at the origins (up to 21,143 trips waiting), because the intersections and entries discharge only so fast. Counted as the sim's *active* (including those waiting), 27,042 trips were live, and the app stayed interactive: ward test 11 checks that Pause takes effect within 300 ms at ×5 demand and 20×. A tick at 5,700 on the network costs 0.25–0.29 ms (mean), which is about 1.0–1.2 % of the 25 ms each tick may take at 40 ticks/s. A network that can carry 10,000 vehicles at once is needed to measure that point in the browser. |
| ≥ 5,000 on the network in the stress run (ward city-005) | **Met:** 5,899 max (harness) and 5,772 (hardware run). |
| Speed controls show when the engine cannot keep up | Every scenario reached its target rate. The *behind* indicator and its honesty are covered by the core-004 and core-005 tests. |

## How to reproduce

```bash
pnpm -C web build:wasm
pnpm -C web e2e:perf          # rewrites web/perf-results/{baseline-1x,baseline-20x,closure-burst,stress-5x}.json
```

Each JSON holds the scenario, the run conditions (browser, renderer, viewport, DPR, headless, launch args, hardware), every statistic above, the coverage (frames, ticks and render samples recorded, wall ms), and the targets with `met`. The harness has been run once for this report, and the Gold review re-runs it and compares.
