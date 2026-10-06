---
ward: 4
revision: null
name: "WASM worker bridge"
epic: "core"
status: "red"
dependencies: ["core-003"]
layer: "typescript"
estimated_tests: 11
created: "2026-10-06"
completed: null
---
# Ward core-004: WASM worker bridge

## Scope
Carry the Rust simulation into the browser without per-vehicle calls or per-frame JSON. This ward adds compact frame encoding in `sim-core`, a thin `sim-wasm` crate (wasm-bindgen), a Vite + React + TS workspace in `web/`, and a Web Worker that owns the sim, runs a fixed-step clock and posts batched, transferable frames. There is no city rendering yet: this ward ends at "the UI thread receives correct frames and can send commands", shown on a small debug readout page.

## Inputs
- core-003: `World` (+ `metrics`, `is_closed`, `schedule`), `cities::three_bridges`, `Landmarks`, `Zone`, `VehicleInfo.stranded`.
- Contract § Frame / boundary format (updated by this ward).

## Outputs
### Rust
- `sim_core::frame`:
  - `VEHICLE_RECORD_WORDS = 4`. `write_vehicle_records(&World, out: &mut Vec<u32>) -> u32` clears `out` and appends one record per on-network vehicle, links ascending → lanes ascending → front first: `[link_id, (s as f32).to_bits(), (v as f32).to_bits(), flags]`, with flags `bit0` queued (`v < QUEUED_SPEED`), `bit1` on a closed link, `bit2` stranded, `bits 8..15` lane. It returns the record count (= `metrics().on_network`).
  - `write_link_stats(&World, counts: &mut Vec<u16>, queued: &mut Vec<u16>)`: per link (id order), vehicles and queued vehicles (saturating at `u16::MAX`).
  - `NetworkExport::new(&Network)`: `node_xy: Vec<f32>` (x0, y0, x1, y1, …), `node_is_zone: Vec<u8>`, `link_from: Vec<u32>`, `link_to: Vec<u32>`, `link_lanes: Vec<u8>`, `link_length: Vec<f32>`, `link_speed: Vec<f32>`.
  - `METRIC_NAMES` = exactly `tick, sim_time_s, trips_generated, spawned, active, on_network, waiting_at_origin, no_route, stranded, queued, completed, removed_unreachable, unreachable, mean_travel_time_s, incomplete, mean_incomplete_age_s` (the `Metrics` field order), and `metrics_to_array(&Metrics) -> Vec<f64>` in that order (`Option` → `NaN`, integers as f64).
- `crates/sim-wasm` (cdylib, `wasm-bindgen`): `#[wasm_bindgen] struct Sim` with
  - `Sim::three_bridges(demand_seed: u32, behavior_seed: u32)`, `step(n: u32)`, `tick() -> f64`;
  - `close_link(id: u32) -> bool` / `open_link(id: u32) -> bool` (scheduled at the current tick; `false` for unknown ids, which never panic);
  - `encode_frame() -> u32` (record count) + `frame_ptr() -> u32` + `frame_words() -> u32`, a zero-copy view into wasm memory that JS copies once;
  - `link_counts() -> Vec<u16>`, `link_queued() -> Vec<u16>`, `metrics() -> Vec<f64>`, `metric_names() -> Vec<String>`, `closed_links() -> Vec<u32>`, `state_hash_hex() -> String`;
  - once at init: `node_xy()`, `node_is_zone()`, `link_from()`, `link_to()`, `link_lanes()`, `link_length()`, `link_speed()`, `landmarks_json()`, `zones_json()`.
### Web (`web/`, pnpm, Vite 8, React 19, TS strict, Vitest 5)
- `src/sim/protocol.ts`: `ToWorker` = `init{demandSeed, behaviorSeed}` | `setRunning{running}` | `setSpeed{multiplier}` | `command{kind: 'close'|'open', link}` | `returnBuffer{buffer}`. `FromWorker` = `ready{network, landmarks, zones, metricNames}` | `frame{tick, simTimeS, count, vehicles: ArrayBuffer, linkCounts: Uint16Array, linkQueued: Uint16Array, closed: Uint32Array, metrics: Float64Array, clock: ClockStatus, perf: PerfStats}` | `error{message}`. Doc comments define the frame layout.
- `src/sim/frame.ts`: `decodeVehicles(buffer, count)` → typed views (`link`, `s`, `v`, `flags`, `lane`) without per-record objects.
- `src/sim/clock.ts`: pure `SimClock(now)`:
  - target ticks/s = `multiplier / DT` (1× = real time);
  - `plan()` returns how many ticks to run now: elapsed wall time is added to a backlog, capped at 1 s of target ticks, and limited by a per-iteration budget (8 ms) using a measured ms/tick estimate;
  - `report(ticks, elapsedMs)`;
  - `status()` gives `{ running, multiplier, targetTicksPerS, achievedTicksPerS (rolling 1 s), behind, executedTicks, simTimeS }`, with `behind` = backlog hit the cap, or achieved < 90 % of target over the last full second.
  - **No silent skipping:** sim time is always executed ticks × DT, never wall time.
- `src/sim/host.ts`: `createSimHost(sim, post, now)` — the worker logic without `self` (handles `ToWorker`, runs `tick()` iterations, posts at most one frame per 16 ms, pools vehicle buffers returned by the UI). `src/sim/worker.ts` wires it to `self`. `src/sim/client.ts` is the typed UI-side wrapper.
- `src/App.tsx`: a debug readout (tick, sim time, active, frame bytes, sim ms/tick median and p95, achieved vs. target speed, behind flag) and buttons "Close central bridge" / "Reopen" and a speed selector. It is replaced by the real UI in core-005.
- Scripts: `build:wasm` (`wasm-pack build ../crates/sim-wasm --target web --out-dir ../../web/src/wasm`), `dev`, `build`, `test` (vitest run).

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `frame_records_encode_link_s_v_flags` (Rust) | record order and layout, f32 round trip, queued/closed/stranded flags, lane bits, count == `on_network` |
| 2 | `link_stats_match_world` (Rust) | per-link counts/queued equal `link_vehicles`-derived values |
| 3 | `network_export_matches_network` (Rust) | lengths and values equal the `Network`, zones flagged |
| 4 | `metrics_array_matches_names` (Rust) | `METRIC_NAMES.len() == metrics_to_array().len()`, values field by field, None → NaN |
| 5 | `wasm sim runs in node` (Vitest) | real wasm via `initSync` with file bytes: 10 min of three_bridges, active > 0, `encode_frame()` == on_network metric, decoded links valid, `state_hash_hex` deterministic across two instances |
| 6 | `frame decoder reads records` (Vitest) | synthetic buffer → exact link/s/v/flags/lane |
| 7 | `clock runs at target rate` (Vitest) | fake time, cheap ticks: executed ticks ≈ target × elapsed (± 1 batch) at 1×, 10×, 60× |
| 8 | `clock reports falling behind without skipping` (Vitest) | expensive ticks: `behind` true, achieved < target, `simTimeS == executedTicks × DT` exactly, backlog never above the 1 s cap |
| 9 | `pause and speed change` (Vitest) | paused → 0 ticks planned; a speed change takes effect on the next plan; resuming does not catch up the paused time |
| 10 | `host applies close command through wasm` (Vitest) | `createSimHost` with real wasm: closing the central bridge → frames show bit1 for vehicles on it, its link count never increases, `closed` lists both links |
| 11 | `frame payload is proportional` (Vitest) | `vehicles.byteLength == count × 16`; link stats length == number of links; no JSON in frame messages (structured-clone-safe typed arrays only) |

## Must NOT
- No per-vehicle JS↔WASM calls, no per-frame JSON, no `SharedArrayBuffer`/threads.
- No wall clock inside Rust. Time/speed lives only in the worker clock.
- No city rendering in this ward.

## Must DO
- `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `pnpm -C web test` and `pnpm -C web build` green.
- `sim-core` stays free of wasm/browser deps. `sim-wasm` is a thin adapter (no sim logic).

## Manual Smoke Test
### Setup
```
pnpm -C web install
pnpm -C web build:wasm
```
### Steps
1. Run: `cargo test --workspace && pnpm -C web test`
   Expected: all green.
2. Run: `pnpm -C web dev`, then open the printed URL.
   Verify: the readout updates continuously: tick and sim time rise, active > 0, frame bytes ≈ 16 × on-network, and sim ms/tick median/p95 and achieved/target speed are shown.
3. Click "Close central bridge".
   Verify: the closed-flag count first rises, then falls to 0 as vehicles leave the bridge. "Reopen" restores it.
4. Select 60× speed.
   Verify: achieved speed follows the target, or the readout shows "behind" honestly.
### Pass criteria
- [ ] All tests green
- [ ] Live debug readout and working close/reopen
- [ ] Speed control reports achieved vs. target

## Verification
The Gold reviewer runs all suites and drives the dev page with the Playwright MCP browser.
