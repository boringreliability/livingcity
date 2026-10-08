# Context: Living City

## Last Updated
2026-10-08: **epic city human-approved** ("ja" at the epic gate). Next: plan epic `timeline`.

## Current State
- Branch `worktree-epic-sim-core` (worktree `.claude/worktrees/epic-sim-core`). No git remote. `main` holds only the initial commit.
- **Epic core: complete, human-approved 2026-10-07.**
  - Rust `crates/sim-core`: network, world (queues, discharge, demand, routing, closures, commands, `state_hash`), `cities::three_bridges`, `frame`.
  - `crates/sim-wasm`: thin `Sim` adapter.
  - `web/`: worker host + `SimClock`, WebGL2 renderer, React UI, Playwright e2e.
  - Tests: Rust 85, Vitest 45, Playwright 17. Review logs are in `.wdd/reviews/`.
- **Epic city: complete, human-approved 2026-10-08.** Specs: `.wdd/epics/city.md` (contract additions C1–C5) and `.wdd/wards/city/ward-00{1..5}.md`.
  - **city-001 complete**: per-link `sat_flow_per_lane`; gridlock relief (reroute at 60 s blocked, removal at 10 min → `removed_gridlock` / `unserved`); `EXTENDED_METRIC_NAMES`. Red 4 rounds (auto), Gold 2.
  - **city-002 complete**: `cities::river_city` (Main / North / Old Bridge, 22 zones, calibrated demand), the app defaults to River City (`?city=three_bridges`). Red 3, Gold 1. See `.wdd/memory/decisions/river-city-calibration.md`.
  - **city-003 complete**: inspect/follow vehicles, road stats; `tracked`/`linkDetail` omitted until first used; extrapolation anchor restarts on new tick/resume/speed change. Red 3, Gold 4.
  - **city-004 complete**: miniature-city look (`render/cities/` decor, `FIT_INSETS` 120/24/120/24 symmetric, 2D link texture, occupancy congestion, hatch/bars/decks passes, compact `Legend`). Red 3, Gold 3.
  - **city-005 complete**: 900 s warm-up (init `warmupS`; chunked ≤ 32 ticks/40 ms, commands deferred), `perf.ts` + `PerfStats`, DiagnosticsPanel (`D`), unserved metric, `?demand=` stress, perf harness `e2e:perf` → `docs/performance.md`. Red 4 (user chose r4; C1 spec amendment accepted), Gold 2. Core `review1` "fix G4" superseded by city.e2e test 15 (user decision).
  - Tests now: Rust 134 (release), Vitest 80, Playwright 46 + 1 skipped (+3 @perf).
- **User decisions:**
  - Convergence rule: from round 4, a gate whose only BLOCKER/MAJOR findings are verified-fixable test gaps is approved with the fix tests (logged as `*-auto.md`). It escalates on a BLOCKER, a contract defect, an unverified finding or a disagreement.
  - Behind indicator: option (ii), where no cap event counts after lowering the speed until a plan clears the backlog.

## Architecture Decisions Made
| Decision | Rationale | Ward |
|----------|-----------|------|
| WDD with adversarial subagent gates per ward; human gate per epic | user request (CLAUDE.md) | — |
| 2D v1; Rust owns network + vehicle position along links; no screen coords in Rust | user's graphics plan | — |
| Counter-based demand RNG, separate behavior RNG | demand identical across branches | core-002 |
| Router cache is derived (not hashed/snapshotted) | pure function of costs + closures + epoch | core-002 |
| AoS 16-byte vehicle records; link stats per frame; no x/y from Rust | compact transfer; renderer maps link+s | core-004 |
| Per-link saturation flow; gridlock relief (reroute 60 s, remove 10 min) | limited-capacity Old Bridge; oversaturation must not freeze | city-001 |
| New metrics in `EXTENDED_METRIC_NAMES`, not `METRIC_NAMES` | core_004 pins the core list; the web reads metrics by name | city-001 |
| River City calibrated at the centre of a measured plateau (intra 2.3, cross 0.9); near-river column for short approach blocks | closure must oversaturate the 2,700 veh/h alternatives, yet the city must recover after a reopen | city-002 |
| C3 reopen target = backlog cleared + Main share + queue reduction (not a 5-min queued ratio) | the ratio swung 1.4–3.0 with ±2 % demand (route-choice oscillation) | city-002 |
| Warm-up is a host init option (default 0); the app sends 900 s | the brief's living opening screen, without breaking frozen host tests | city-005 |
| The "10,000 vehicles" target is scored on vehicles on the network, not `active` (which includes trips waiting at their origin) | honesty: `active` reached 27k in the stress run while only ~5.9k were on roads | city-005 |
| Perf statistics come from a full-run recording; the measurement clock (`perfNow`) is separate from pacing (`now`) | sliding windows misrepresent runs; measurement must never change the sim | city-005 |
| FIT_INSETS vertically symmetric; overlays live in the top/bottom bands (legend too) | the fit centre must stay at the canvas centre (city-003 tests and users zoom there) | city-004 |
| Vehicle picking only at zoom ≥ 1 px/m; a pick = (frameTick, record) resolved via retained trip tables; requests carry `seq` | the network dominates at wide zoom; the clicked car is the one seen; no stale or in-flight frames | city-003 |

## Active Constraints
- The contracts `.wdd/epics/core.md` and `.wdd/epics/city.md` are binding. Change them explicitly (with the reason), never silently in code.
- No HashMap/HashSet iteration, wall clock, or exp/ln/trig in sim logic (`crates/sim-core/clippy.toml`).
- Approved test files are never edited. Regression tests go in new files.
- The user is colorblind: never hue as the only signal.
- Never touch port 4243 (the user's unrelated vcore server).
- **Worktree sandbox:**
  - Avoid long heredocs. Put scripts in `$CLAUDE_JOB_DIR/tmp`, and write files with Write.
  - Commands containing "complete" are blocked. Finish wards by editing the frontmatter (`status: "complete"`, `completed`) and running `wdd progress`.
  - Snapshot CONTEXT to `.wdd/memory/snapshots/` by hand. Use `/usr/local/bin/wdd`.

## Key Metrics
| Metric | Value | Ward |
|--------|-------|------|
| Browser app (75 Hz) | ~13 ms rAF interval, ~7 % main-thread busy; JS 244 kB (77 kB gzip); wasm 119 kB (47 kB) | core-005 |
| Browser, River City (docs/performance.md) | tick mean 0.06 ms (~1.7k) / 0.25 ms (~5.7k); render 120 FPS Metal, 20 FPS SwiftShader | city-005 |
| Step, 20×20 grid, 25–32k vehicles (release) | 0.195 ms median, 0.36 ms p95 | core-003 |

## Known Limitations
- city-003 MINORs: cars step ~4–7 m at junctions (ring/Follow too); speed changes restart extrapolation. `cargo fmt --check` reports diffs (no fmt gate).
- Performance (docs/performance.md):
  - **10,000 on the network: missed.** River City peaks at 7,615 (×6, 3 h), limited by intersection/entry throughput.
  - **~60 FPS: missed on SwiftShader (20 FPS), met on the hardware GPU (120 FPS).**
  - Tick mean is 0.06 ms at ~1.7k and 0.25 ms at ~5.7k on the network.
- city-005 MINORs:
  - The legend covers the `unserved` value at viewports narrower than ~1,255 px.
  - A re-init resets only `executedTicks`, not the backlog or rate window (the app inits once).
- Open MINORs from city-004:
  - The hover halo (0.72 grey) is close in lightness to a fully congested road core (it still reads by its +2 px width).
  - The hatch is dropped on closed links shorter than 14 px on screen (zoom < 0.07); the barriers remain.
  - The e2e harness has no browser test for "close while paused → shows on resume" (Vitest G4b covers it; checked manually by Gold).
- `World::clone` copies the `Network` and the unbounded `completed_log` (timeline: share via `Arc`, window the log).
- **Restore (timeline)** must invalidate the RouterCache and snapshot the reroute queues and their flags.
- `World::metrics()` dominates per-frame cost at high demand (make it incremental or sample it).
- Browser `performance.now()` is coarse (0.1 ms). After a wasm trap the host halts, and recovery needs a new worker.

## What Comes Next
- Epic `timeline` (snapshots, replay, branch, compare; Restore must invalidate the RouterCache), then `polish` (the MINORs above, a11y, onboarding).
