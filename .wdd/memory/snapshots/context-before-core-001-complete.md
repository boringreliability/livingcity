# Context: Living City

## Last Updated
2026-10-06, during core-001 Red (round 2 review pending)

## Current State
- Branch `worktree-epic-sim-core` (worktree `.claude/worktrees/epic-sim-core`). `main` holds only the initial commit.
- Epic `core` active, with wards core-001…005 specced (001–003 Rust, 004 WASM/worker, 005 browser integration).
- core-001: Red, 16 tests + `todo!()` API skeleton in `crates/sim-core`. Round 1 Red review REJECTED (contract time-level bug in the downstream space check; missing coverage), and the fixes are committed in `81d9715`.

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

## Active Constraints
- Model contract `.wdd/epics/core.md` is binding. Change it explicitly (and note why), never silently in code.
- No HashMap/HashSet iteration, wall clock, or exp/ln/trig in sim logic.
- Worktree sandbox: avoid long heredocs in Bash; put edit scripts in `$CLAUDE_JOB_DIR/tmp` and run them.
- The user is colorblind: never red vs. green as the only signal.

## Key Metrics
| Metric | Value | Ward |
|--------|-------|------|

## Known Limitations
- Gridlock in cycles is not resolved in epic core (planned for epic city).

## What Comes Next
- core-001 Red r2 verdict → Gold (implement the physics) → Gold review.
- Then core-002 (demand/routing/metrics), core-003 (closures/commands/determinism + three_bridges city), core-004 (WASM worker bridge), core-005 (WebGL2 + React, first closure in the browser).
