# Context: Living City

## Last Updated
2026-10-07, after core-005 completed (Gold approved, gold-2): epic core awaits the human epic gate

## Current State
- Branch `worktree-epic-sim-core` (worktree `.claude/worktrees/epic-sim-core`). `main` holds only the initial commit.
- Epic `core` active, with wards core-001…005 specced (001–003 Rust, 004 WASM/worker, 005 browser integration).
- **core-001 complete**: `crates/sim-core` (`network.rs`, `world.rs`, `params.rs`). 20 tests green, clippy clean. The Red gate took 8 rounds (contract bugs found: tail time level, origin-vs-through starvation → zones). Gold was approved in round 1, with exact reference values matched and a 180k-tick fuzz with no failures.
- **core-002 complete**: `rng.rs`, `demand.rs`, `routing.rs` + World demand/costs/metrics. 44 tests green (20 + 24). The Red gate took 4 rounds (underflow, NoRoute-removal premise, untested router-uses-congestion, non-finite inputs). Gold was approved in round 1, with all exact reference values matched.
- `crates/sim-core/clippy.toml` machine-checks the Must NOT rules (no transcendental functions, HashMap/HashSet or wall clock).
- **core-003 complete**: commands/closures, budgeted + staggered rerouting with hysteresis, forced decisions, NoRoute/stranded retries with removal, `state_hash`, `cities::three_bridges`, `bridge` example. 80 tests green (20 + 24 + 36). The Red gate took 7 rounds and was auto-approved under the user's convergence rule (see `.wdd/reviews/core-003-red-7-auto.md`). Gold was approved in round 1, and the differential run against an independent reference was identical over 10 scenarios.
- **User decision (2026-10-06): convergence rule for gates.** From round 4 on, a gate whose only BLOCKER/MAJOR findings are verified-fixable test gaps is approved once the fix tests are incorporated. It escalates on a BLOCKER, a contract defect, an unverified finding or a disagreement. (Not written into CLAUDE.md: the sandbox blocks self-modification of instructions; the user may add it.)
- **core-004 complete**: `sim_core::frame` (AoS vehicle records, link stats, NetworkExport, METRIC_NAMES), `crates/sim-wasm` (thin adapter), `web/` (pnpm, Vite 8, React 19, Vitest 5): `SimClock` (honest behind, option (ii) after lowering speed), worker host (16 ms frames, transfer, exact-size pool, link-id validation, halt on panic), client, debug readout. Rust 85 + Vitest 37 green. Red took 4 rounds (2 spec BLOCKERs in round 1: an impossible decoder API, an achieved-rate tolerance). Gold took 2 rounds (F1: wasm-bindgen coerces NaN/1.7 ids onto real links → validate in the host). Browser smoke: 51 fps, frame bytes = 16 × on-network, close/reopen works, 300× achieved.
- **core-005 complete** (integration ward): `web/src/render/` (`geometry.ts`, `camera.ts` CSS px / y up / zoom about cursor, `picking.ts`, `decor.ts` river + zone pads, `renderer.ts` WebGL2: link table texture of 3 RGBA32F texels per link, link state texture, instanced vehicles straight from the AoS buffer, two road passes with a px halo for selected/hovered, closed = screen-space hatch + barrier glyphs, per-class min px vehicle shapes), `web/src/ui/` (ControlPanel, MetricsStrip, SelectionPanel, `window.__livingcity` test hook), `App.tsx`. Rust 85 + Vitest 45 + Playwright 17 green. Red took 4 rounds, Gold 2 (r1: selected road invisible and queued/moving same shape at fit zoom → fixed in px, mutation-checked).
- **Next: the human epic gate for `core`**: present the demo and wait for "godkendt" before epic `city`.

## Architecture Decisions Made
| Decision | Rationale | Ward |
|----------|-----------|------|
| WDD with adversarial subagent gates per ward; human gate per epic | user request; see CLAUDE.md | — |
| 2D v1; Rust owns network + vehicle position along links; no screen coords in Rust | user's graphics plan, keeps the door open for 3D | — |
| Per-lane queues (no lane changes), reach-based crossing, ACCEL 2 m/s² | gives exactly saturation-flow headways (4 ticks) | core-001 |
| Downstream space checked against `tail_guaranteed` (post-move lower bound) | removes time-level mismatch found in Red review r1 | core-001 |
| Round-robin `rr_next` per node (stateful), not `tick mod n` | periodic space release would starve a feeder | core-001 |
| Counter-based demand RNG (pure in seed, tick, flow), separate behavior RNG | demand identical across branches; no transcendental functions | core-002 |
| Router cache is derived data (not hashed/snapshotted, rebuilt) | brief allows dropping caches that are pure functions of state | core-002 |
| Shared test city `sim_core::cities::three_bridges` | same city in tests, WASM and browser (integration) | core-003 |
| Zone centroids: trips start/end at zones, no route passes through a zone | origin admission at a junction starves through traffic (Red r6) | core-001 |
| Visibility minima in CSS px, not metres (road 2.5/closed 9 px, halo 3/2 px, vehicles 5×1.8 vs 3.4×3.4 px) | at fit zoom (~0.48 px/m) metric sizes collapse to 1 px (Gold r1) | core-005 |

## Active Constraints
- Model contract `.wdd/epics/core.md` is binding. Change it explicitly (and note why), never silently in code.
- No HashMap/HashSet iteration, wall clock, or exp/ln/trig in sim logic.
- Worktree sandbox: avoid long heredocs in Bash; put edit scripts in `$CLAUDE_JOB_DIR/tmp` and run them. Any Bash command containing the word "complete" is blocked (mistaken for the shell builtin): finish wards by editing the frontmatter (`status: "complete"`, `completed: date`) + `wdd progress`, and snapshot CONTEXT to `.wdd/memory/snapshots/` by hand.
- The user is colorblind: never red vs. green as the only signal.

## Key Metrics
| Metric | Value | Ward |
|--------|-------|------|
| Browser app (75 Hz display) | ~13 ms rAF interval, ~7 % main-thread busy; JS 244 kB (77 kB gzip) | core-005 |
| wasm bundle | 119 kB (47 kB gzip) | core-004 |
| Per-frame cost (native, ~2.1k on network) | encode 5 µs, link stats 6 µs, `metrics()` 0.25 ms (dominant; 1–3 ms at saturation) | core-004 |
| Browser debug page | 51 frames/s; 300× achieved with three_bridges | core-004 |
| Step, 20×20 grid, ~25–32k vehicles (release) | 0.195 ms median, 0.36 ms p95; closure burst of 40 links 8.7 ms | core-003 |
| three_bridges: central closure → central 0/min within 1 min; N+S ~6 → ~40/min; mean tt 242 → 264 s | bridge example | core-003 |
| Step incl. demand+routing, 20×20 grid, ~10.2k active (release) | 0.108 ms median, 0.245 ms p95, 0.32 ms epoch ticks | core-002 |
| Step, 10×10 grid, ~2.9k active | 0.029 ms median, 0.051 ms p95 | core-002 |
| Sim tick, 10k vehicles, 30×30 grid (release, M4 Pro) | 0.174 ms mean, 0.30 ms max | core-001 |
| Sim tick, 30k vehicles, 50×50 grid | 0.568 ms mean | core-001 |
| 1-lane saturation discharge | exactly 0.5 veh/s (30/min) | core-001 |

## Known Limitations
- Gridlock in cycles is not resolved in epic core (planned for epic city).
- Public `World`/`Network` accessors panic on unknown ids. Bounds-check at the WASM boundary (core-004).
- `World::clone` copies the `Network` and the unbounded `completed_log`, a snapshot cost to address in epic timeline (share the network via `Arc`, window the log).
- Admission reads `route[0]`. core-002/003 must keep this valid with rerouting at origins.
- `check_invariants` does not yet check credit/rr ranges, slot uniqueness or route_pos.
- Dense all-pairs grid demand gridlocks (10×10 at 120 vph per pair). Tune the demo city (epic city) and consider gridlock relief.
- `World::shortest_route` builds a fresh tree per call (test/UI use only; internal routing uses the cache).
- RouterCache is invalidated on epoch, close and open. **Restore (epic timeline) must invalidate it too and must snapshot the reroute queues + their per-vehicle flags**, or `state_hash` diverges. The command log is the replay log.
- Test city demand (1980 veh/h west→east vs. 3600 veh/h alternative capacity) makes closure queues mild. Epic city must calibrate demand so a closure visibly saturates the alternatives.
- Explicit `spawn_with_route` routes that pass through their own destination get stranded (router returns None for from == dest). Demand routes never do this.
- `apply_commands` scans the whole log each tick, and periodic enqueue/retries scan all slots (measured negligible).
- `World::metrics()` dominates per-frame cost at high demand: make it incremental or sample it at ~10 Hz (epic polish/perf).
- Browser `performance.now()` is coarse (0.1 ms), so the ms/tick readout shows ~0 for cheap ticks. For the perf epic, aggregate over time or enable cross-origin isolation.
- After a wasm trap the host halts; reloading requires a new worker (full module reload), not just a new `Sim`.
- three_bridges at natural demand peaks around 225 vehicles, so the 2k/10k targets need the epic-city network and demand.
- Renderer MINORs open (see `.wdd/reviews/core-005-gold-{1,2}.md`): fit ignores the overlay panels; the hatch overpaints cross roads at junctions and swims while panning; barrier glyphs in metres are ~1 px slivers at fit zoom; a selected/hovered road's halo covers the closure hatch of its opposite direction when only one direction is closed; B key repeat toggles the bridge; zone labels move only on frames; link texture width = link count (texture size limit); `laneOffset` export and `FrameMessage.perf` unused; no-WebGL2 path leaves controls silent; `v_core` dead varying; vehicle-shape test checks constants, not pixels.

## What Comes Next
- **Epic gate (human)** for `core`: demo + run commands + review log. Wait for "godkendt".
- Then epic `city`: the final river city (calibrated so a closure visibly saturates the alternatives), gridlock relief, renderer MINORs above, polish of the 2D look.
