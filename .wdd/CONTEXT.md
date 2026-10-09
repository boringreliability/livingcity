# Context: Living City

## Last Updated
2026-10-09: epic timeline approved by the user. **Epic polish active:** polish-001…003 done; next polish-004 (first-run demonstration).

## Current State
- Branch `worktree-epic-sim-core` (worktree `.claude/worktrees/epic-sim-core`). No git remote. `main` holds only the initial commit.
- **Epic core: complete, approved 2026-10-07.** sim-core (network, world, routing, demand, closures, commands, `state_hash`, frame), thin `sim-wasm`, worker host + `SimClock`, WebGL2 renderer, React UI.
- **Epic city: complete, approved 2026-10-08** (`.wdd/epics/city.md`, C1–C5): per-link sat flow + gridlock relief, River City (3 bridges, 22 zones, calibrated), inspect/follow, miniature look, 900 s warm-up, diagnostics (`D`), `unserved`, `?demand=` stress, `docs/performance.md`. Core G4 superseded by city.e2e test 15 (user). Details: `.wdd/memory/snapshots/CONTEXT-2026-10-08-city-005.md`.
- **Epic timeline: complete, approved 2026-10-09** (`.wdd/epics/timeline.md`, T1–T5): snapshots every 120 ticks within 48 MiB per scenario, seek = restore + replay, branch B from A's past (A never edited), lockstep compare with linked cameras and cohort metrics incl. incomplete, acceptance e2e, docs (`README.md`, `docs/`). Details: `.wdd/memory/snapshots/CONTEXT-2026-10-09-timeline-004-final.md` and the ward files.
- **Epic polish: active.** Spec `.wdd/epics/polish.md` (P1–P6, measured per-frame basis); backlog ids a1–g5 in `.wdd/memory/polish-backlog.md`.
  - **polish-001 done**: Esc innermost-first (confirm → vehicle → road; focus to the slider only if the closing panel held it), Speed pointer pick blurs, "Comparing A and B", neutral bridge button while comparing, sr-only h1, axe audit (`e2e/a11y.spec.ts`). Tests: Vitest 111, e2e 82 + 1 skipped.
  - **polish-002 done** (Red r3, Gold r3): `.top-band` CSS grid (controls/scenarios/confirm/error/diagnostics; 2 columns ≥ 960 px, 1 below, fixed DOM order), refit on resize unless the user moved the camera (`cameraTouched`), legend above the metrics below 1260 px, road panel bottom-left while comparing ≥ 1000 px, cut labels hidden (batched), timeline on two rows below 960 px, error banner dismissible. Supported widths ≥ 768 px (README). Tests: e2e 99 + 1 skipped. Open minors g6–g11 (g7 = fatal errors can be cleared → with f2 in polish-005).
  - **polish-003 done** (Red r3, Gold r1): frame `nextLinks` (u16 per record; `write_next_links`, stranded → none), `render/motion.ts` placement mirrored in `VEH_VS` (Bézier through junctions in a link's last 6 m; extrapolation never past the link end), `ExtrapolationClock` (re-bases on rate change, forgets the rate at each anchor, cap 1.5 × tick advance; rate ≤ requested multiplier), dashed hover stroke (+ frozen grey halo), closure ring sign at every zoom, hooks `vehicleDraw`/`trackedDraw`/`drawAt`. Frame 16 → 18 B/vehicle. **For the epic gate:** i1 (car stops at the curve end then jumps ~7 m at 1×), i2 (held cars stack in junctions at queues), i3/i5 deviations (hover halo kept; ring instead of 6×6 core). Tests: Rust 174, Vitest 116, e2e 103 + 1 skipped.
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
| Timeline (SwiftShader, timeline.json) | seek 86.9 ms median (frame-bound); branch 38.3 ms; A 44.3 + B 37.0 MiB; lockstep ×1.84 per tick | timeline-005 |
| Step, 20×20 grid, 25–32k vehicles (release) | 0.195 ms median, 0.36 ms p95 | core-003 |

## Known Limitations
- city-003 MINORs: cars step ~4–7 m at junctions (ring/Follow too); speed changes restart extrapolation. `cargo fmt --check` reports diffs (no fmt gate).
- Performance (docs/performance.md):
  - **10,000 on the network: missed.** River City peaks at 7,615 (×6, 3 h), limited by intersection/entry throughput.
  - **~60 FPS: missed on SwiftShader (20 FPS), met on the hardware GPU (120 FPS).**
  - Tick mean is 0.06 ms at ~1.7k and 0.25 ms at ~5.7k on the network.
- Polish backlog (city MINORs):
  - the legend covers `unserved` below ~1,255 px;
  - re-init resets only `executedTicks`;
  - the hover halo is close in lightness to congestion;
  - the hatch is dropped below zoom 0.07;
  - no e2e test for close-while-paused.
- `World::metrics()` dominates per-frame cost at high demand (make it incremental or sample it).
- Browser `performance.now()` is coarse (0.1 ms). After a wasm trap the host halts, and recovery needs a new worker.

## What Comes Next
- Plan epic `polish` (spec + wards), then build it with the same gates.
- Then epic `polish`: the MINORs above (city + timeline), a11y, onboarding.
