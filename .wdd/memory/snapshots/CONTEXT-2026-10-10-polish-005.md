# Context: Living City

## Last Updated
2026-10-10: **Epic polish active:** polish-001…005 done; next polish-006 (integration ward, then the human epic gate).

## Current State
- Branch `worktree-epic-sim-core` (worktree `.claude/worktrees/epic-sim-core`). No git remote. `main` holds only the initial commit.
- **Epic core: complete, approved 2026-10-07.** sim-core (network, world, routing, demand, closures, commands, `state_hash`, frame), thin `sim-wasm`, worker host + `SimClock`, WebGL2 renderer, React UI.
- **Epic city: complete, approved 2026-10-08** (`.wdd/epics/city.md`, C1–C5): per-link sat flow + gridlock relief, River City (3 bridges, 22 zones, calibrated), inspect/follow, miniature look, 900 s warm-up, diagnostics (`D`), `unserved`, `?demand=` stress, `docs/performance.md`. Core G4 superseded by city.e2e test 15 (user). Details: `.wdd/memory/snapshots/CONTEXT-2026-10-08-city-005.md`.
- **Epic timeline: complete, approved 2026-10-09** (`.wdd/epics/timeline.md`, T1–T5): snapshots every 120 ticks within 48 MiB per scenario, seek = restore + replay, branch B from A's past (A never edited), lockstep compare with linked cameras and cohort metrics incl. incomplete, acceptance e2e, docs (`README.md`, `docs/`). Details: `.wdd/memory/snapshots/CONTEXT-2026-10-09-timeline-004-final.md` and the ward files.
- **Epic polish: active.** Spec `.wdd/epics/polish.md` (P1–P6, measured per-frame basis); backlog ids a1–g5 in `.wdd/memory/polish-backlog.md`.
  - **polish-001/002 done**: keyboard/focus/labels + axe (`e2e/a11y.spec.ts`); `.top-band` grid layout, refit on resize, no overlaps at ≥ 768 px (`e2e/layout.spec.ts`).
  - **polish-003 done**: frame `nextLinks` (u16/record), `render/motion.ts` junction curve mirrored in `VEH_VS`, `ExtrapolationClock`, dashed hover, closure ring sign. **Epic gate items:** i1 (stop at curve end, then ~7 m jump at 1×), i2 (held cars stack in junctions), i3/i5 deviations.
  - **polish-004 done**: demo guide (`ui/DemoGuide.tsx`, `ui/guideProgress.ts`; steps from frames by sim ticks), "?" (Guide) toggle. Load spikes (other processes) cause spurious e2e timeouts: log `uptime`, re-run alone.
  - **polish-005 done** (Red r3, Gold r1): derived `SlotIndex` in `World` (incremental metric counters; periodic/retry passes visit only due slots, ascending), `Arc` snapshots shared by branches, per-side frame pools (`returnBuffer.scenario`), `SimClock.reset()` on init, fatal errors + "Restart simulation" (`debugTrap` hook). ×5: step 0.331 → 0.076 ms, metrics 0.354 → 0.009 ms, branch 15.3 → 1.3 ms (`frame_cost_probe`, `web/perf-results/frame-cost.json`). Golden `state_hash` values pin determinism. Pinned deviations e2/e3. **polish-006 must re-run `e2e:perf` (k1).**
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
