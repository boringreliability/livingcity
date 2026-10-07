---
ward: 5
revision: null
name: "Living opening screen, diagnostics and measured performance"
epic: "city"
status: "planned"
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
| 10 | `full_demo_on_river_city` (e2e) | open → traffic moves → "Close the main bridge" → within 10 sim min at 20×, queued ≥ 2 × its pre-closure value. The Old or North Bridge approach shows spillback (≥ 2 consecutive links ≥ 80 % full via the hook's link counts). Following a car crossing the Old Bridge works. Reopening brings queued down |
| 11 | `controls_responsive_under_load` (e2e) | at `?demand=5` and 20×, Pause takes effect within 300 ms wall time of the keypress (frames stop advancing), and the panel buttons respond |
| 12 | `perf_baseline_recorded` (@perf) | writes `baseline-1x.json` and `baseline-20x.json` with all § C5 fields and vehicle counts |
| 13 | `perf_closure_burst_recorded` (@perf) | writes `closure-burst.json` covering the first 60 s after closing, including max tick ms |
| 14 | `perf_stress_recorded` (@perf) | writes `stress-5x.json` at `?demand=5` with on-network ≥ 5,000 or the measured maximum stated |

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
