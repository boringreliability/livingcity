# Context: Living City

## Last Updated
2026-10-07: the user approved epic core at the epic gate; epic city is planned (city-001…005 specced)

## Current State
- Branch `worktree-epic-sim-core` (worktree `.claude/worktrees/epic-sim-core`). No git remote. `main` holds only the initial commit.
- **Epic core: complete, human-approved 2026-10-07.**
  - Rust `crates/sim-core`: network, world (queues, discharge, demand, routing, closures, commands, `state_hash`), `cities::three_bridges`, `frame`.
  - `crates/sim-wasm`: thin `Sim` adapter.
  - `web/`: worker host + `SimClock`, WebGL2 renderer, React UI, Playwright e2e.
  - Tests: Rust 85, Vitest 45, Playwright 17. Review logs are in `.wdd/reviews/`.
- **Epic city: planned.** Specs: `.wdd/epics/city.md` (contract additions C1–C5) and `.wdd/wards/city/ward-00{1..5}.md`. Next: city-001 Red.
- **User decisions:**
  - Convergence rule: from round 4, a gate whose only BLOCKER/MAJOR findings are verified-fixable test gaps is approved with the fix tests (logged as `*-auto.md`). It escalates on a BLOCKER, a contract defect, an unverified finding or a disagreement. The sandbox blocked writing this into CLAUDE.md.
  - Behind indicator: option (ii), where no cap event counts after lowering the speed until a plan clears the backlog.

## Architecture Decisions Made
| Decision | Rationale | Ward |
|----------|-----------|------|
| WDD with adversarial subagent gates per ward; human gate per epic | user request (CLAUDE.md) | — |
| 2D v1; Rust owns network + vehicle position along links; no screen coords in Rust | user's graphics plan | — |
| Per-lane queues, reach-based crossing, ACCEL 2, `tail_guaranteed`, `rr_next` round robin | exact saturation headways; fixes from Red reviews | core-001 |
| Zone centroids; no route through a zone | junction origins starve through traffic | core-001 |
| Counter-based demand RNG, separate behavior RNG | demand identical across branches | core-002 |
| Router cache is derived (not hashed/snapshotted) | pure function of costs + closures + epoch | core-002 |
| AoS 16-byte vehicle records; link stats per frame; no x/y from Rust | compact transfer; renderer maps link+s | core-004 |
| Visibility minima in CSS px (road 2.5/closed 9, halo 3/2, vehicles 5×1.8 vs 3.4×3.4) | metric sizes collapse at fit zoom | core-005 |
| Per-link saturation flow; gridlock relief (reroute 60 s, remove 10 min) | limited-capacity Old Bridge; oversaturation must not freeze | city (plan) |

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
| Per-frame cost (native, ~2.1k on network) | encode 5 µs, link stats 6 µs, `metrics()` 0.25 ms | core-004 |
| Step, 20×20 grid, 25–32k vehicles (release) | 0.195 ms median, 0.36 ms p95 | core-003 |
| three_bridges central closure | N+S exits ~6 → ~40/min; mean tt 242 → 264 s | core-003 |

## Known Limitations
- Gridlock in cycles is unresolved until city-001. three_bridges demand is mild (it peaks around 225 vehicles).
- `World::clone` copies the `Network` and the unbounded `completed_log` (timeline: share via `Arc`, window the log).
- **Restore (timeline)** must invalidate the RouterCache and snapshot the reroute queues and their flags.
- `World::metrics()` dominates per-frame cost at high demand (make it incremental or sample it).
- Browser `performance.now()` is coarse (0.1 ms). After a wasm trap the host halts, and recovery needs a new worker.
- Renderer MINORs open, scheduled in city-004:
  - fit ignores the overlay panels;
  - the hatch overpaints junctions and swims while panning;
  - barrier glyphs are ~1 px slivers;
  - a selected road's halo covers the opposite direction's hatch;
  - B repeats;
  - labels follow the camera only on frames;
  - link texture width = link count;
  - orphan `laneOffset`, dead `v_core`;
  - no-WebGL2 path is silent.

## What Comes Next
- **city-001** (Rust): per-link sat flow + gridlock relief. 16 tests in `crates/sim-core/tests/city_001_relief.rs`.
- **city-002**: River City + calibration tests; the app switches to River City.
- **city-003**: inspect/follow vehicles, road stats.
- **city-004**: miniature-city look + MINOR fixes.
- **city-005**: warm-up, diagnostics, measured performance, integration.
- Then the human epic gate. After that, epic `timeline` (snapshots, replay, branch, compare), then `polish`.
