# Living City

## Identity
- **Name:** livingcity
- **One-liner:** Interactive 2D city traffic simulation, with Rust/WASM in a Web Worker. Close a bridge, watch the city adapt, rewind, try something else, compare.
- **License:** MIT
- **Spec:** `livingcity.md` (authoritative product brief)

## Architecture Overview

```
┌──────────── UI thread (TS/React) ────────────┐      ┌──────── Sim worker ────────┐
│ React controls · timeline · metrics panel    │ cmds │ sim-wasm (wasm-bindgen)    │
│ WebGL2 renderer: roads, water, vehicles      │ ───▶ │   └─ sim-core (pure Rust)  │
│   link+offset → world → screen (shader)      │ ◀─── │ fixed-step loop, budgets   │
└──────────────────────────────────────────────┘frames└────────────────────────────┘
                                         (transferable typed buffers)
```

- `crates/sim-core`: authoritative sim (graph, vehicles, queues, discharge, routing, demand, closures, metrics, commands, snapshots). Pure Rust, no wasm/browser deps, tested natively.
- `crates/sim-wasm`: thin wasm-bindgen API: batched ticks, command input, compact frame buffers.
- `web/`: Vite + React + TS. `web/src/worker` (sim loop), `web/src/render` (WebGL2), `web/src/ui`.

## Principles
- Rust is the source of truth. The renderer only visualizes.
- Determinism: fixed timestep, seeded RNG, stable order, no wall-clock in the sim. Demand is a pure function of (seed, tick), separate from behavior randomness.
- Replay is architecture: commands keyed to ticks, and the whole World is clonable/serializable from day 1.
- Data across the worker boundary: batched, typed buffers, proportional to what is drawn.
- Accessibility: never red vs. green as the only signal (the user is colorblind).
- Measure, don't claim.

## Technology Stack
- Rust (stable, edition 2021): simulation core + WASM (wasm-bindgen, wasm-pack)
- TypeScript (strict) + React 19 + Vite 8: UI
- WebGL2 (hand-written, instanced): renderer
- Vitest (TS unit), Playwright (e2e in a real browser), cargo test (Rust)

## Non-Goals (v1)
City builder/road editor, real maps, backend/multiplayer/accounts, pedestrians/public transport, economic model, AI decisions, 3D/complex assets, GPU compute for sim correctness, more than two scenarios.
