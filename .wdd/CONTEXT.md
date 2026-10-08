# Context: Living City

## Last Updated
2026-10-08: city-004 complete (Red 3, Gold 3 → APPROVED); next city-005 (integration ward, last before the epic gate)

## Current State
- Branch `worktree-epic-sim-core` (worktree `.claude/worktrees/epic-sim-core`). No git remote. `main` holds only the initial commit.
- **Epic core: complete, human-approved 2026-10-07.**
  - Rust `crates/sim-core`: network, world (queues, discharge, demand, routing, closures, commands, `state_hash`), `cities::three_bridges`, `frame`.
  - `crates/sim-wasm`: thin `Sim` adapter.
  - `web/`: worker host + `SimClock`, WebGL2 renderer, React UI, Playwright e2e.
  - Tests: Rust 85, Vitest 45, Playwright 17. Review logs are in `.wdd/reviews/`.
- **Epic city: active.** Specs: `.wdd/epics/city.md` (contract additions C1–C5) and `.wdd/wards/city/ward-00{1..5}.md`.
  - **city-001 complete**: per-link `sat_flow_per_lane`; gridlock relief (reroute at 60 s blocked, removal at 10 min → `removed_gridlock` / `unserved`); `EXTENDED_METRIC_NAMES`. Red 4 rounds (auto), Gold 2.
  - **city-002 complete**: `cities::river_city` (Main / North / Old Bridge, 22 zones, calibrated demand), the app defaults to River City (`?city=three_bridges`). Red 3, Gold 1. See `.wdd/memory/decisions/river-city-calibration.md`.
  - **city-003 complete**: inspect/follow vehicles, road stats; `tracked`/`linkDetail` omitted until first used; extrapolation anchor restarts on new tick/resume/speed change. Red 3, Gold 4.
  - **city-004 complete**: the miniature-city look.
    - `web/src/render/cities/` (pure decor: meandering river profile ± 2000 m, banks, parks, buildings, decks, pads, labels).
    - `layout.ts` sets `FIT_INSETS` to 120/24/120/24, which must stay vertically symmetric (see the decisions table).
    - `linkTable.ts` holds the 2D link texture (1024 wide).
    - Renderer passes: occupancy congestion, inset world-anchored hatch, px barriers, px-min decks with a two-tone railing.
    - Draw order: roads → halo → route → hatch → bars → vehicles → ring.
    - Compact `Legend` in the bottom band; labels placed on mount and on camera change; no-WebGL2 alert with controls disabled.
    - Red 3 (r3 approved the amended look tests: they close while running, because of core-004 G4b), Gold 3.
  - Tests now: Rust 130, Vitest 61, Playwright 39.
- **User decisions:**
  - Convergence rule: from round 4, a gate whose only BLOCKER/MAJOR findings are verified-fixable test gaps is approved with the fix tests (logged as `*-auto.md`). It escalates on a BLOCKER, a contract defect, an unverified finding or a disagreement.
  - Behind indicator: option (ii), where no cap event counts after lowering the speed until a plan clears the backlog.

## Architecture Decisions Made
| Decision | Rationale | Ward |
|----------|-----------|------|
| WDD with adversarial subagent gates per ward; human gate per epic | user request (CLAUDE.md) | — |
| 2D v1; Rust owns network + vehicle position along links; no screen coords in Rust | user's graphics plan | — |
| Per-lane queues, reach-based crossing, ACCEL 2, `tail_guaranteed`, `rr_next` round robin | exact saturation headways; fixes from Red reviews | core-001 |
| Counter-based demand RNG, separate behavior RNG | demand identical across branches | core-002 |
| Router cache is derived (not hashed/snapshotted) | pure function of costs + closures + epoch | core-002 |
| AoS 16-byte vehicle records; link stats per frame; no x/y from Rust | compact transfer; renderer maps link+s | core-004 |
| Visibility minima in CSS px (road 2.5/closed 9, halo 3/2, vehicles 5×1.8 vs 3.4×3.4) | metric sizes collapse at fit zoom | core-005 |
| Per-link saturation flow; gridlock relief (reroute 60 s, remove 10 min) | limited-capacity Old Bridge; oversaturation must not freeze | city-001 |
| New metrics in `EXTENDED_METRIC_NAMES`, not `METRIC_NAMES` | core_004 pins the core list; the web reads metrics by name | city-001 |
| River City calibrated at the centre of a measured plateau (intra 2.3, cross 0.9); near-river column for short approach blocks | closure must oversaturate the 2,700 veh/h alternatives, yet the city must recover after a reopen | city-002 |
| C3 reopen target = backlog cleared + Main share + queue reduction (not a 5-min queued ratio) | the ratio swung 1.4–3.0 with ±2 % demand (route-choice oscillation) | city-002 |
| FIT_INSETS vertically symmetric; overlays live in the top/bottom bands (legend too) | the fit centre must stay at the canvas centre (city-003 tests and users zoom there) | city-004 |
| Decor is pure render-side data from `ReadyMessage` (no Rust changes); congestion = vehicles ÷ capacity (same formula as Rust) | sim/render boundary; links of different length compare fairly | city-004 |
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
| Per-frame cost (native, ~2.1k on network) | encode 5 µs, link stats 6 µs, `metrics()` 0.25 ms | core-004 |
| Step, 20×20 grid, 25–32k vehicles (release) | 0.195 ms median, 0.36 ms p95 | core-003 |

## Known Limitations
- city-003 MINORs: a car crossing a junction steps ~4–7 m between drawn link centrelines (the ring and Follow step too). A speed change or the behind flag restarts or rescales extrapolation (small steps). There is no host-level unit test for the `trackedSeq` echo (e2e covers it).
- River City's baseline sits low in its band (1,600–1,720 active). `RIVER_WEST_X` / `RIVER_EAST_X` are `pub` but only used in `cities.rs`. `cargo fmt --check` reports diffs (there is no fmt gate).
- city-004 MINORs for city-005:
  - The inline label ref callback re-places all 22 labels on every React render (~100 / s); memoise it per index.
  - The hover halo (0.72 grey) is close in lightness to a fully congested road core (it still reads by its +2 px width).
  - The hatch is dropped on closed links shorter than 14 px on screen (zoom < 0.07); the barriers remain.
  - The e2e harness has no browser test for "close while paused → shows on resume" (Vitest G4b covers it; checked manually by Gold).
- `World::clone` copies the `Network` and the unbounded `completed_log` (timeline: share via `Arc`, window the log).
- **Restore (timeline)** must invalidate the RouterCache and snapshot the reroute queues and their flags.
- `World::metrics()` dominates per-frame cost at high demand (make it incremental or sample it).
- Browser `performance.now()` is coarse (0.1 ms). After a wasm trap the host halts, and recovery needs a new worker.

## What Comes Next
- **city-005** (integration ward):
  - warm-up (living opening screen);
  - diagnostics panel (perf counters, `FrameMessage.perf`);
  - measured performance in `docs/performance.md`;
  - the unserved metric in the UI;
  - `?demand=` stress;
  - wiring checks (no orphan exports, buffers without consumers, or controls without effect);
  - the city-004 MINORs above.
- Then the human epic gate. After that, epic `timeline` (snapshots, replay, branch, compare), then `polish`.
