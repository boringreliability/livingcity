---
ward: 4
revision: null
name: "WASM worker bridge"
epic: "core"
status: "planned"
dependencies: ["core-003"]
layer: "typescript"
estimated_tests: 10
created: "2026-10-06"
completed: null
---
# Ward core-004: WASM worker bridge

## Scope
Carry the Rust simulation into the browser without leaking per-vehicle calls or JSON: a thin `sim-wasm` crate (wasm-bindgen), compact frame encoding in `sim-core`, a Vite + React + TS workspace in `web/`, and a dedicated Web Worker that owns the sim, runs a fixed-step clock and posts batched transferable frames. No rendering yet. This ward ends at "the UI thread receives correct frames and can send commands".

## Inputs
- core-003: `World`, `Command`, `cities::three_bridges`, `Metrics`, `VehicleInfo.on_closed_link`, `state_hash`.
- Contract § Frame / boundary format.

## Outputs
- `sim_core::frame`: `VEHICLE_RECORD_WORDS = 4`, `write_vehicle_records(&World, &mut Vec<u32>) -> u32` (link, s f32 bits, v f32 bits, flags: bit0 queued, bit1 on closed link, bit2 NoRoute, bits 8..15 lane), `write_link_stats(&World, counts: &mut Vec<u16>, queued: &mut Vec<u16>)`, `NetworkExport::from(&Network)` (node x/y f32, link from/to u32, lanes u8, length f32, speed f32), `METRIC_NAMES: &[&str]` + `metrics_to_array(&Metrics) -> Vec<f64>`.
- `crates/sim-wasm` (cdylib): `#[wasm_bindgen] Sim::new_three_bridges(demand_seed, behavior_seed)`, `step(n)`, `tick()`, `close_link(id)`, `open_link(id)` (scheduled at the current tick), `encode_frame() -> u32` + `frame_ptr()`/`frame_words()`, `link_counts() -> Uint16Array`, `link_queued() -> Uint16Array`, `metrics() -> Float64Array`, `network_*()` typed arrays (called once), `landmarks_json()` / `zones_json()` (init only), `metric_names()`.
- `web/` (pnpm, Vite 8, React 19, TS strict, Vitest 5, Playwright 1.63):
  - `web/src/sim/protocol.ts`: discriminated unions `ToWorker` (`init`, `setRunning`, `setSpeed`, `command`, `returnBuffer`) and `FromWorker` (`ready{network, landmarks, zones, metricNames}`, `frame{tick, simTimeS, count, vehicles: ArrayBuffer, linkCounts, linkQueued, metrics: Float64Array, perf, clock}`, `error`).
  - `web/src/sim/clock.ts`: pure `SimClock` (injected `now()`): target ticks/s = speed × (1/DT); per iteration it returns ticks to run within a wall budget. It tracks backlog and `achievedTicksPerS`, and sets `behind = true` when the backlog exceeds 1 s of sim. **It never skips ticks**: sim time = executed ticks × DT; backlog is capped (the sim runs slower than requested and says so).
  - `web/src/sim/worker.ts` + testable `createSimHost(wasm, post)` (the message handler logic without `self`), `web/src/sim/client.ts` (UI-side wrapper with typed events), `web/src/sim/frame.ts` (decoder views over the transferred buffer).
  - `web/scripts/build-wasm.sh` (`wasm-pack build crates/sim-wasm --target web --out-dir ../../web/src/wasm`), `pnpm build:wasm`, `pnpm test`, `pnpm dev`.
- Perf counters per frame: sim ms/tick median & p95 over a rolling window, ticks per batch, frames posted/s.

## Specification
- One worker, one `Sim`. Loop: `setTimeout(0)`/`MessageChannel` iteration → `clock.plan(now)` → `sim.step(n)` (measured with `performance.now()` *in the worker*, never inside Rust) → at most one frame per 16 ms → `postMessage(frame, [vehicles])`. Vehicle buffers come from a pool and the UI returns them (`returnBuffer`). Without a free buffer the worker allocates a new one (no blocking).
- Frame bytes = `count × 16` + link stats (`2 × links × 2` bytes) + metrics. **No JSON per frame.** Only `ready` contains JSON-derived data (landmarks/zones).
- Commands are applied at the current tick before the next `step`, and the worker acknowledges them in the next frame's `tick`.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `frame_records_encode_link_s_v_flags` (Rust) | record layout, f32 round trip, queued/closed/NoRoute flags, lane bits, count == on_network |
| 2 | `network_export_matches_network` (Rust) | array lengths and values equal the `Network` |
| 3 | `metrics_array_matches_names` (Rust) | `METRIC_NAMES.len() == metrics_to_array().len()` and values match `Metrics` fields |
| 4 | `wasm sim runs in node` (Vitest) | the real wasm loads in Node (initSync with file bytes), runs 10 min of three_bridges, active > 0, frame count == on_network metric |
| 5 | `frame decoder reads records` (Vitest) | decoder returns link/s/v/flags/lane from a synthetic buffer |
| 6 | `clock runs at target rate` (Vitest) | with a fake clock and a fast step, executed ticks ≈ target × elapsed (± 1 batch) |
| 7 | `clock reports falling behind without skipping` (Vitest) | slow step: `behind` true, achieved < target, sim time == executed ticks × DT exactly |
| 8 | `pause and speed change` (Vitest) | paused → 0 ticks; speed change takes effect next iteration |
| 9 | `host applies close command through wasm` (Vitest) | `createSimHost` with real wasm: close the central bridge → the next frames show bit1 for vehicles on it and its link count never increases |
| 10 | `frame size is proportional` (Vitest) | `vehicles.byteLength == count × 16`, and the link stats length == number of links |

## Must NOT
- No per-vehicle JS↔WASM calls, no per-frame JSON, no `SharedArrayBuffer`/threads (not yet justified by profiling).
- No wall clock inside Rust. Speed/time control lives in the worker clock.
- No rendering code in this ward.

## Must DO
- `cargo test --workspace` and `pnpm -C web test` green. `pnpm -C web build` succeeds.
- Document the frame format in `web/src/sim/protocol.ts` (doc comments) consistent with the contract.

## Manual Smoke Test
### Setup
```
pnpm -C web install
pnpm -C web build:wasm
```
### Steps
1. Run: `cargo test --workspace && pnpm -C web test`
   Expected: all green.
2. Run: `pnpm -C web dev` and open the printed URL with `?debug`.
   Verify: the page shows a debug readout updating ~every frame: tick, sim time, active, frame bytes, sim ms/tick (median/p95), achieved vs target speed.
3. Click the debug "Close central bridge" button.
   Verify: the readout shows the closed flag count rising then falling to 0 as vehicles leave the bridge.
### Pass criteria
- [ ] Tests green
- [ ] Debug page updates live; frame bytes ≈ 16 × active-on-network
- [ ] Close command visible in frames

## Verification
Gold reviewer runs both test suites and the dev page (Playwright allowed).
