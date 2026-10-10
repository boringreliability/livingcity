# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

**Living City** is an interactive city traffic simulation: Rust compiled to WebAssembly runs the simulation in a Web Worker, and a TypeScript/React UI sits on top of a GPU canvas renderer (WebGL2 or WebGPU). The demo it is built around: *close a bridge → watch traffic adapt → rewind → branch → compare the two scenarios side by side.*

- `livingcity.md` is the full product brief. It is the authoritative spec for scope, simulation model, replay, visuals, metrics, performance targets, verification and deliverables, so read it before planning work.
- `.wdd/` holds the Ward-Driven Development state. Its `CONTEXT.md` is the source of truth for what has been built (as of 2026-10-10: epics `core`, `city`, `timeline` and `polish` approved: v1 complete). User-facing docs: `README.md` and `docs/` (known limitations: `docs/known-issues.md`).

### Layout
- `crates/sim-core`: the authoritative simulation in pure Rust.
- `crates/sim-wasm`: a thin wasm-bindgen `Sim` adapter. It builds into `web/src/wasm/`, which is generated, so never edit it by hand.
- `web/`: Vite + React + TS.
  - `src/sim` holds the worker host, `SimClock`, protocol and perf statistics.
  - `src/render` holds the WebGL2 renderer, camera, picking and city decor.
  - `src/ui` holds the panels.
  - Tests live in `tests/` (Vitest, Node + real wasm) and `e2e/` (Playwright on SwiftShader).

### Commands (run from the repo root)
```bash
pnpm -C web build:wasm                 # rebuild the wasm after any Rust change (the web tests use it)
pnpm -C web dev                        # dev server (Vite); the app opens on a warmed-up River City
pnpm -C web build                      # typecheck + production build
pnpm -C web typecheck
pnpm -C web test                       # Vitest (all)
pnpm -C web exec vitest run tests/diagnostics.test.ts -t "warmup"    # one file / one test
pnpm -C web e2e                        # Playwright (excludes @perf), ~19 min
pnpm -C web exec playwright test e2e/look.spec.ts -g "legend"       # one spec / one test
pnpm -C web e2e:perf                   # performance harness → web/perf-results/*.json (docs/performance.md)
cargo test --workspace                 # Rust (calibration tests are skipped in debug builds)
cargo test -p sim-core --release --test city_002_river             # one Rust test file, in release
cargo test -p sim-core --test city_005_scale scale_one_is_river_city # one Rust test
cargo clippy --workspace --all-targets -- -D warnings
```
- Run `pnpm -C web exec …` from the repo root. Running `pnpm exec` inside `web/` can trigger a `pnpm install`.
- URL parameters:
  - `?city=three_bridges` selects the core test city;
  - `?demand=<0.25–6>` selects stress demand (measurement only, shown as a badge).
- Keys:
  - Space plays or pauses;
  - B closes or opens the main bridge;
  - D toggles the diagnostics panel;
  - +/- change the speed;
  - Esc clears the selection.

## Workflow: WDD with adversarial gates (project override)

All work is organized as Wards under Epics. The project skills `/wdd`, `/ward` and `/ward-new` describe standard WDD with a human at every checkpoint. **This project overrides that:** ward-level gates are adversarial review subagents, and the human gate sits only at the end of each **epic**. This override takes precedence over the skills and over the global "wait for godkendt" rule, for ward-level gates only.

```
planned → red (write tests from the ward's Tests table)
    ⛩ Red gate: adversarial test reviewer (subagent) must return APPROVED
approved → gold (implement until tests pass)
    ⛩ Gold gate: adversarial implementation reviewer (subagent) must return APPROVED
gold → complete (`wdd complete <id>`), then update CONTEXT.md and continue to the next ward
...last ward in epic...
    ⏸ Epic gate: STOP. Present to the human and wait for "godkendt" before the next epic.
```

**Reviewer rules**
- Reviewers are fresh subagents. They get only the artifacts (ward spec, test files, diff, commands), not my reasoning or arguments. The Red reviewer and the Gold reviewer are separate agents.
- The Red reviewer tries to break the tests. It looks for missed invariants from the ward spec or `livingcity.md`, tests that pass trivially or are tautological, missing edge cases, and tests that check the implementation instead of the behavior.
- The Gold reviewer runs the tests itself. It verifies that test expectations have not changed since Red approval: test files are snapshotted at Red approval, and the reviewer checks against the diff or hash. It also performs the ward's smoke test itself (Playwright for browser steps) and looks for bugs, determinism leaks and violations of the invariants below.
- A verdict is `APPROVED` or `REJECTED` with concrete findings. I cannot overrule a REJECTED myself. I fix the problem and send it to a **new** review. After 3 rejections on the same gate, I escalate to the human.
- Every verdict is logged in `.wdd/reviews/<ward-id>-{red,gold}-<n>.md`.
- Still in force: never change test expectations to make them pass. Every ward still needs a real Manual Smoke Test section, which is executed by the Gold reviewer.

**Epic gate (human)**: present a working demo with copy-pasteable run commands, what has been built, test results, review log (including rejections and how they were resolved), deviations from the brief, and known issues.

**Stop before the epic gate only on** a genuine blocker, reviewer deadlock (3 rejections), or a spec ambiguity with large consequences for the architecture.

**Integration (nothing gets built in isolation)**
- Every ward's Inputs/Outputs name concrete modules/types from earlier wards, and the ward uses them. No parallel mini-implementations.
- From the first possible moment there is a walking skeleton (Rust core → WASM → worker → renderer). Every ward keeps it runnable and extends a cross-cutting integration test.
- The last ward in each epic is an integration ward. Its reviewer checks the wiring: no orphaned exports, no buffers/messages without consumers, no UI controls without effect.

**Memory (forget nothing)**
- Before each ward: `wdd session` + `wdd api` (and check the Rust crate's public API) to see what already exists.
- After each ward: `wdd complete`, update `CONTEXT.md` (Current State, decisions, What Comes Next), and record significant decisions in `.wdd/memory/decisions/` + Saga.
- `CONTEXT.md` is the source of truth for "what has been built". Read it before every ward, also after context compaction.
- Ward IDs: `<epic-slug>-NNN`, files at `.wdd/wards/<epic-slug>/ward-NNN.md`. Epics at `.wdd/epics/<slug>.md`.
- `PROGRESS.md` is generated, so do not hand-edit it. `CONTEXT.md` is max 200 lines, updated after each ward.

Common commands: `wdd session` (start here), `wdd status`, `wdd validate`, `wdd epic create "Name" --slug <slug>`, `wdd ward create "Name" --epic <slug> --tests <N>`, `wdd ward status <id> <status>`, `wdd complete <id>`, `wdd api` (check existing exports before writing new utilities), `wdd configure --write` (needed because this is a Rust + TS project, not a plain `src/` TS project).

## Architecture invariants (from the brief)

These cut across Rust core, worker and UI. Violating them breaks replay, branching or performance:

**Layering**
- The Rust core is the single source of truth for sim state, movement, routing, interventions, metrics, snapshots and replay. It must build and test **natively** (`cargo test` / benches) without a browser; WASM bindings are a thin layer on top.
- One simulation Web Worker. The UI thread never runs simulation logic.
- Simulation and rendering are decoupled: render FPS must not affect sim results.
- No per-vehicle JS↔WASM calls and no per-frame JSON. Use compact typed buffers, batched messages and transferables. Send only what rendering needs. Add SharedArrayBuffer/WASM threads only if profiling demands it.
- No GPU compute for simulation correctness.

**Determinism**
- Fixed timestep, seeded RNG, stable processing order, no wall-clock time in sim logic.
- **Demand RNG is separate from behavior RNG**, so an intervention must never change the future trip population.
- User interventions are commands keyed to sim ticks (a command log).
- Snapshots are periodic, with deterministic resimulation in between. A snapshot must capture *everything* that affects future decisions: both RNG states, pending demand, routing scheduler state, decision-affecting caches.
- The replay window has an explicit memory budget that the UI exposes. Never copy the full world every frame.

**Branching**: v1 has exactly two scenarios. A branch from an earlier tick preserves the original, shares identical external demand, and both can advance to the same sim time. Comparison uses linked cameras and metrics at matching sim times/windows.

**Traffic model** (deliberately simplified; document simplifications)
- Directed road graph with explicit length, speed limit and storage capacity. Queues propagate upstream when the downstream link is full. There are explicit intersection discharge rules and no free overlap.
- Cost-based, congestion-aware routing with **budgeted, staggered** recalculation and smoothing/hysteresis against route flapping.
- Closure semantics: no new entries; vehicles already on the segment may leave; affected vehicles reroute at valid decision points; if no route exists they wait and retry on a bounded schedule.
- Vehicle conservation: every spawned vehicle is active, completed or explicitly removed.

**City and demo**: a fixed, hand-designed network. A river splits the town with three crossings, plus residential areas, workplaces, a hospital and a limited-capacity alternative route. The demand pattern is fixed and reproducible. Calibrate the network so the effects are visible, but never script outcomes. A prominent "Close the main bridge" action is part of the demo.

## Graphics roadmap and the sim/render boundary

v1 is **2D**, and it should look like a finished little simulation product, not a prototype: good typography, nice water, clear bridges, and cars you can follow. Later versions: v2 character (vehicle types, distinct neighborhoods, visual explanation of consequences), v3 height (3D buildings, bridges, light/shadow, tilted camera on top of the *same* simulation), later still an experiment sandbox (drawing roads, signals, public transport). Build none of v2+ now. Just keep the door open:

- **The simulation owns the road network and vehicles' positions *along* roads** (link id + offset in meters + lane). The network's nodes have world coordinates in meters (simulation data, since link lengths derive from them).
- **No screen coordinates, cameras, colors or drawing code in Rust.** The renderer (TS/GPU) converts link + offset into world/screen positions, for example in the vertex shader from a link-geometry table.
- Purely visual city data (river, building footprints, district labels, decor) lives on the render side, not in the sim core.

## UI / visual constraints

- **The user is colorblind.** Never rely on red vs. green. Combine color with patterns, icons, line thickness, labels and movement. Closed roads need an unmistakable physical marker, and congestion must be visible through vehicle behavior, not only overlays.
- Dark, restrained style. Level of detail: the network and congestion dominate when zoomed out, individual vehicles become readable when zoomed in. No gratuitous glow, dashboard clutter or charts with invented data.
- Bottom timeline, compact control panel, and an expandable diagnostics panel for perf counters.
- Metrics must be real sim values: active vehicles, completed trips, mean travel time, queued vehicles (define "queued"), unserved/unreachable trips, plus incomplete trips in comparisons. Sim time must be visually distinct from wall-clock time.
- Speed controls must show when the engine can't keep up instead of silently skipping steps.

## Out of scope (v1)

No city builder or road editor, map imports, backend/multiplayer/accounts, pedestrians/public transport, economic model, AI decision-making or complex 3D assets.

## Verification expectations

Required test areas are listed in `livingcity.md` § Verification: conservation, capacity/queues, closure/reopen, unreachable destinations, seed+command-log determinism, snapshot-restore ≡ uninterrupted run, branch independence, identical demand across branches, and metric correctness. The end-to-end flow must be checked in a real browser (Playwright MCP is available). Performance numbers (sim tick time and render frame time reported separately, with median and p95, vehicle counts and conditions) must be measured, never estimated.
