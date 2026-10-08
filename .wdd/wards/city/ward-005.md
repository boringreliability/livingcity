---
ward: 5
revision: null
name: "Living opening screen, diagnostics and measured performance"
epic: "city"
status: "red"
dependencies: ["city-004"]
layer: "typescript"
estimated_tests: 14
created: "2026-10-07"
completed: null
---
# Ward city-005: Living opening screen, diagnostics and measured performance (integration ward)

## Scope
The integration ward of epic `city`.
- **Living city at once.** The brief says "the opening screen should already contain a living city". The worker pre-simulates a warm-up before the first frame, so the app opens on moving traffic instead of empty roads.
- **Diagnostics.** An expandable diagnostics panel (`.wdd/epics/city.md` § C5) shows sim tick time and render frame time **separately**, with median and p95.
- **Unserved metric.** The metrics strip shows **unserved** (unreachable + gridlock removals) with defined tooltips.
- **Performance.** Measured in a real browser, for normal traffic, the closure burst and a scaled-demand stress run, and written to `docs/performance.md`.
- **Wiring.** The reviewer checks the whole epic's wiring and runs the full River City demo end to end.

## Inputs
- Everything from city-001…004. core-004 `SimClock` and `FrameMessage.perf` (reserved), core-005 `MetricsStrip`, `ControlPanel`, `testHook`.

## Outputs
- **Worker:**
  - `WARMUP_SIM_S = 900` (15 sim min) is stepped in batches before `ready`, with a "Starting the city…" progress state in the UI. The warm-up ticks are ordinary ticks (tick 0 is still the start; the timeline epic replays them).
  - `perf` per § C5.
- **Rust:**
  - `cities::river_city_scaled(demand_seed, behavior_seed, demand_scale: f64)` multiplies every flow (same network). `river_city` = scale 1.0.
  - `Sim::river_city_scaled`.
  - The URL `?demand=<scale>` (0.25–6, validated) selects it for measurement only, and the UI shows a "stress test ×N" badge when ≠ 1.
- **UI:**
  - `DiagnosticsPanel`: collapsed by default, toggled with a button and the `D` key. It shows sim tick ms (median/p95), ticks measured, encode ms, render interval ms and draw CPU ms (median/p95), vehicles on network / active, frame bytes, achieved vs requested speed.
  - `MetricsStrip` shows `unserved` (label "unserved ⓘ", tooltip: "Trips the city could not serve: no route at the origin, stranded without a route, or removed after 10 minutes in gridlock") instead of `unreachable`.
- **Docs:** `docs/performance.md`, which records:
  - method, browser + version, hardware (`sysctl` model/CPU), GPU path (hardware vs SwiftShader);
  - for each scenario: vehicles on network/active, sim tick ms median/p95, render frame interval median/p95, draw CPU median/p95, achieved speed;
  - scenarios: (a) baseline at 1× and 20×, (b) the first 60 s after closing the Main Bridge at 20×, (c) `?demand=5` at 5×;
  - every number from a run, none estimated. Targets that are missed are stated as missed, with the measured bottleneck.
- **Measurement harness:** `web/e2e/perf.spec.ts` (tagged `@perf`, excluded from the default e2e run, run with `pnpm -C web e2e:perf`). It writes JSON to `web/perf-results/*.json`, which `docs/performance.md` cites.

## Specification
- **Perf windows.** The tick time window is the last 1,000 ticks (per-tick ms = batch ms ÷ batch ticks, one sample per batch weighted by ticks). Render: the last 300 rAF intervals and draw CPU times (`performance.now()` around `draw`). Median/p95 use nearest-rank on sorted samples.
- **Warm-up.** It must not block the worker's message handling for more than 100 ms at a time (batches). A `close` command sent during warm-up is applied at the first tick after warm-up, at the earliest. Test hooks see `tick ≥ 1800` at `ready`.
- **Stress.** `?demand` is validated. Invalid values fall back to 1 with a console warning. The badge text never says "realistic".
- **Integration checklist** (the Gold reviewer checks it explicitly):
  - no orphaned exports in `web/src` and `sim-wasm`;
  - every protocol message type has a sender and a consumer;
  - every UI control has an effect;
  - every metric name in the UI exists in `METRIC_NAMES`;
  - CLAUDE.md gets the run/test/perf commands;
  - `.wdd/config.json` conventions are set.

## Tests
Vitest in `web/tests/diagnostics.test.ts`, Playwright in `web/e2e/city.e2e.spec.ts` and `web/e2e/perf.spec.ts`, Rust in `crates/sim-core/tests/city_005_scale.rs`.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `scaled_demand_multiplies_flows` (rust) | every flow rate is × scale; scale 1 ≡ `river_city` (equal `state_hash` after 10 min); invalid scales (≤ 0, NaN, > 6) are rejected by the constructor's validation |
| 2 | `percentiles_nearest_rank` (vitest) | median/p95 of known samples, including tie and single-sample cases |
| 3 | `tick_window_weights_batches` (vitest, host) | per-tick samples from batches of different sizes give the documented weighted window. The window keeps the last 1,000 ticks |
| 4 | `perf_never_changes_the_sim` (vitest, host) | two hosts, one with perf measurement stubbed out: identical `state_hash` after N frames |
| 5 | `warmup_before_ready` (vitest, host) | `ready` arrives with tick ≥ 1800. Handling never blocks for > 100 ms per batch (with a fake clock). A close sent during warm-up takes effect after it |
| 6 | `opening_screen_is_alive` (e2e) | within 5 s of load, sim time ≥ 15:00 is shown, ≥ 300 vehicles are on the network, and the canvas changes between two screenshots 1 s apart |
| 7 | `diagnostics_panel_toggle` (e2e) | collapsed by default. `D` and the button toggle it. When open, it shows sim tick median/p95 and render interval median/p95 as numbers, with the update visible within 2 s |
| 8 | `unserved_metric_shown_and_defined` (e2e) | the strip shows "unserved". Its tooltip contains the definition. The value equals `metrics.unserved` from the test hook |
| 9 | `stress_badge_for_scaled_demand` (e2e) | `?demand=3` shows "stress test ×3". `?demand=abc` shows no badge and runs at scale 1 |
| 10 | `full_demo_on_river_city` (e2e) | open → traffic moves → "Close the main bridge" → within 10 sim min at 20×, queued ≥ 2 × its pre-closure value, and an Old or North Bridge approach shows spillback: an approach link ≥ 80 % full while a link feeding it is ≥ 20 % full (hook link counts ÷ `linkCapacity`). Following a car on the Old Bridge works: it is tracked, and Follow keeps it within 40 px of the canvas centre. Reopening brings queued to ≤ 0.6 × its value at the reopen within 10 sim min |
| 11 | `controls_responsive_under_load` (e2e) | at `?demand=5` and 20×, Pause takes effect within 300 ms wall time of the keypress (frames stop advancing), and the panel buttons respond |
| 12 | `perf_baseline_recorded` (@perf) | writes `baseline-1x.json` and `baseline-20x.json` with all § C5 fields and vehicle counts |
| 13 | `perf_closure_burst_recorded` (@perf) | writes `closure-burst.json` covering the first 60 s after closing, including max tick ms |
| 14 | `perf_stress_recorded` (@perf) | writes `stress-5x.json` at `?demand=5` with on-network ≥ 5,000 or the measured maximum stated |
| 15 | `fix G4 (superseded in city-005): closing the main bridge changes its grayscale appearance` (e2e) | replaces core `review1.spec.ts` "fix G4", which is now `test.skip` (user decision 2026-10-08: the warm-up leaves vehicles on the bridge at load). It keeps the same clip, steps and threshold (mean absolute grayscale difference > 15) but draws without vehicles (`setDebug({ hideVehicles: true })`) instead of relying on an empty bridge |

## Red-phase contract details
These pin the names the tests use.

**Rust** (`sim_core::cities`)
- `DEMAND_SCALE_MAX: f64 = 6.0`.
- `river_city_scaled(demand_seed, behavior_seed, demand_scale) -> Result<City, InvalidDemandScale>`:
  - accepts `0 < scale ≤ 6`;
  - multiplies each `OdFlow::veh_per_hour` (same flows, same order, same network, same zones and landmarks);
  - `river_city(d, b)` is the same as `river_city_scaled(d, b, 1.0).unwrap()`.
- `InvalidDemandScale(pub f64)`.

**sim-wasm**
- `Sim::river_city_scaled(demand_seed, behavior_seed, demand_scale) -> Result<Sim, JsError>`.

**`web/src/sim/perf.ts`**
- `percentile(values, p)`:
  - nearest rank on a sorted copy: rank = max(1, ceil(p × n)), and returns `sorted[rank − 1]`;
  - returns 0 for an empty input;
  - does not mutate its input.
- `TICK_WINDOW = 1000` and `class TickWindow`:
  - `add(batchMs, ticks)` records one sample with per-tick value `batchMs / ticks` and weight `ticks`;
  - samples with ticks ≤ 0 or a non-finite `batchMs` are ignored;
  - only the newest 1,000 ticks are kept: older samples are dropped, and the oldest one still inside the window is truncated to fill exactly 1,000.
  - `stats()` returns `{ median, p95, max, ticks }`:
    - median and p95 are the weighted nearest rank: the smallest value whose cumulative weight reaches ceil(p × W) in ascending order;
    - `max` is the largest value still in the window;
    - every value is 0 when the window is empty.
- `RENDER_WINDOW = 300` and `class SampleWindow(capacity)`:
  - `add(v)` ignores non-finite values;
  - `stats()` returns `{ median, p95, count }` over the last `capacity` values.

**Protocol and host**
- `init` gains `warmupS?: number` (default 0) and `demandScale?: number` (default 1).
- `HostDeps.createSim(demandSeed, behaviorSeed, city, demandScale)`.
- `HostDeps.perfNow?: () => number` is the measurement clock, defaulting to `now`. Only perf statistics use it. The `SimClock` keeps using `now`, so measurement cannot change what is simulated.
- With `warmupS > 0`:
  - the host steps `round(warmupS / DT)` ticks in `iterate()` batches, and no batch exceeds `WARMUP_BATCH_MAX_MS = 100` of `now` time;
  - `handle('init')` itself does not step;
  - nothing is posted until the warm-up ends, then `ready` (with `tick`) and normal frames follow;
  - warm-up ticks are added to `executedTicks` but not to the achieved-rate window or the backlog;
  - `command` messages received during the warm-up are queued and handed to the sim when it ends, so they apply at tick ≥ warm-up + 1;
  - a new `init` restarts everything.
- `ReadyMessage.tick: number`.
- `PerfStats` keeps `tickMsMedian`, `tickMsP95`, `lastBatchTicks` and `framesPerS`, and adds:
  - `tickMsMax`;
  - `ticksMeasured` (from `TickWindow`);
  - `encodeMs`, the measured wall ms of the last frame's encode and copy.
- `WARMUP_SIM_S = 900` lives in `protocol.ts`. `createSimClient(demandSeed, behaviorSeed, city?, opts?: { warmupS?, demandScale? })`, and the app passes `WARMUP_SIM_S` and the parsed scale.
- `parseDemandScale(value: string | null): { scale: number; invalid: boolean }`:
  - null or empty gives `{ 1, false }`;
  - a finite number in [0.25, 6] gives `{ value, false }`;
  - anything else gives `{ 1, true }`, and the app then calls `console.warn`.

**UI**
- While the worker warms up, the app shows "Starting the city…" (`role="status"`). The control panel stays usable: a speed chosen before ready is honoured.
- The diagnostics toggle is a button named "Diagnostics" (`aria-expanded`) in the control panel. `D` toggles it the same way `B` works: repeats are ignored, and so are keys while a form control has focus.
- When open, a region labelled "Diagnostics" shows these rows (`data-testid`):
  - `diag-tick` "median / p95 ms" (sim tick);
  - `diag-ticks-measured`;
  - `diag-encode`;
  - `diag-render` "median / p95 ms" (rAF interval);
  - `diag-draw` "median / p95 ms" (draw CPU);
  - `diag-vehicles` "on network / active";
  - `diag-bytes`;
  - `diag-speed` "achieved× of requested×".
- The stress badge is a text "stress test ×N" next to the speed control.
- The test hook adds:
  - `snapshot().demandScale`;
  - `diagnostics()`, returning `{ perf: PerfStats | null, render: { intervalMedianMs, intervalP95Ms, drawMedianMs, drawP95Ms, samples }, frameBytes, onNetwork, active, achievedTicksPerS, targetTicksPerS }`;
  - `frameVehicle(record)`, returning `{ link, s, queued } | null` for the latest frame.

**Perf harness**
- `@perf` tests are excluded from `pnpm -C web e2e` (`grepInvert` unless `PERF=1`), and `pnpm -C web e2e:perf` runs them.
- Each JSON holds: scenario, url, multiplier, durationS, timestamp, browser + version, GPU renderer string, hardware (`sysctl` model/CPU), on-network and active (median and max over samples), tick median/p95/max ms, ticks measured, render interval median/p95, draw median/p95, achieved and target ticks/s.
- The closure burst covers the first 60 wall seconds after closing at 20× (20 sim minutes).

**Calibration (test 10)**
These values were measured with node + wasm on River City, seeds 2026/7, 17/23 and 1/2. The warm-up runs to tick 1800, then the Main Bridge is closed.
- Queued reaches 2 × its pre-closure value after 4.4, 0.2 and 4.6 sim min.
- The busiest Old or North Bridge approach peaks at 95–100 % full, while the link feeding it reaches 30–49 % at the same moment. "2 consecutive links ≥ 80 %" never happened, so it was replaced.
- After a reopen, queued falls below 0.6 × its value at the reopen within 1–2 sim min.

## Must NOT
- Fabricated or estimated numbers in `docs/performance.md`. Every value comes from the JSON files.
- Measurement that alters the simulation, or skips ticks silently.
- Edit approved earlier tests.

## Must DO
- All earlier suites stay green unchanged (Rust, Vitest, Playwright). The `@perf` specs are excluded from `pnpm -C web e2e`.
- Update CLAUDE.md (project commands), CONTEXT.md and the epic table.

## Manual Smoke Test
### Setup
```
pnpm -C web build:wasm && pnpm -C web dev
```
### Steps
1. Open the app.
   Verify: traffic is already flowing at sim time ≈ 15:00. The diagnostics panel is collapsed.
2. Press D.
   Verify: sim tick and render frame median/p95 are shown separately, with plausible magnitudes.
3. Run the whole demo: close the main bridge, watch spillback build on the Old Bridge approach, follow a car across the Old Bridge, then reopen.
4. Run: `pnpm -C web e2e:perf`.
   Verify: the JSON files are written. `docs/performance.md` matches them.
### Pass criteria
- [ ] All suites green, clippy clean, build OK
- [ ] The integration checklist holds
- [ ] The performance report is complete and honest (targets met or missed stated with numbers)

## Verification
The Gold reviewer runs the full demo with Playwright MCP, re-runs the perf harness once and compares it with the report (within run-to-run noise), and audits the integration checklist.
