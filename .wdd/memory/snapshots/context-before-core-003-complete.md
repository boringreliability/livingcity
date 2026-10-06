# Context: Living City

## Last Updated
2026-10-06, after core-002 completed (Gold approved, gold-1)

## Current State
- Branch `worktree-epic-sim-core` (worktree `.claude/worktrees/epic-sim-core`). `main` holds only the initial commit.
- Epic `core` active, with wards core-001…005 specced (001–003 Rust, 004 WASM/worker, 005 browser integration).
- **core-001 complete**: `crates/sim-core` (`network.rs`, `world.rs`, `params.rs`). 20 tests green, clippy clean. The Red gate took 8 rounds (contract bugs found: tail time level, origin-vs-through starvation → zones). Gold was approved in round 1, with exact reference values matched and a 180k-tick fuzz with no failures.
- **core-002 complete**: `rng.rs`, `demand.rs`, `routing.rs` + World demand/costs/metrics. 44 tests green (20 + 24). The Red gate took 4 rounds (underflow, NoRoute-removal premise, untested router-uses-congestion, non-finite inputs). Gold was approved in round 1, with all exact reference values matched.
- `crates/sim-core/clippy.toml` machine-checks the Must NOT rules (no transcendental functions, HashMap/HashSet or wall clock).
- Next: core-003 (closures, rerouting, commands, determinism, `cities::three_bridges`). The contract's Closures section has been rewritten for it (stranded vehicles, decision points, budget/hysteresis).

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

## Active Constraints
- Model contract `.wdd/epics/core.md` is binding. Change it explicitly (and note why), never silently in code.
- No HashMap/HashSet iteration, wall clock, or exp/ln/trig in sim logic.
- Worktree sandbox: avoid long heredocs in Bash; put edit scripts in `$CLAUDE_JOB_DIR/tmp` and run them. Any Bash command containing the word "complete" is blocked (mistaken for the shell builtin): finish wards by editing the frontmatter (`status: "complete"`, `completed: date`) + `wdd progress`, and snapshot CONTEXT to `.wdd/memory/snapshots/` by hand.
- The user is colorblind: never red vs. green as the only signal.

## Key Metrics
| Metric | Value | Ward |
|--------|-------|------|
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
- RouterCache must be invalidated on every key/usable change (epoch, close/open, restore). core-003 adds the closure filter.

## What Comes Next
- core-003 Red: tests per `.wdd/wards/core/ward-003.md` (update the spec to the rewritten contract: stranded, counting) → Red gate.
- Then core-004 (WASM worker bridge), core-005 (WebGL2 + React, first closure in the browser).
