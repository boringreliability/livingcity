# Context: Living City

## Last Updated
2026-10-10: **Epic polish complete, approved by the user ("godkendt").** All planned v1 epics (core, city, timeline, polish) are approved.

## Current State
- Remote `origin` = https://github.com/boringreliability/livingcity (public). Work on branch `public-main` (tracks `origin/main`; history rewritten to `dennis@schmock.eu`, never use the KMD mail). `worktree-epic-sim-core` is the old pre-rewrite branch (backup). Live: https://livingcity.pages.dev/.
- **Epic core: complete, approved 2026-10-07.** sim-core (network, world, routing, demand, closures, commands, `state_hash`, frame), thin `sim-wasm`, worker host + `SimClock`, WebGL2 renderer, React UI.
- **Epic city: complete, approved 2026-10-08** (`.wdd/epics/city.md`, C1–C5): per-link sat flow + gridlock relief, River City (3 bridges, 22 zones, calibrated), inspect/follow, miniature look, 900 s warm-up, diagnostics (`D`), `unserved`, `?demand=` stress, `docs/performance.md`. Core G4 superseded by city.e2e test 15 (user). Details: `.wdd/memory/snapshots/CONTEXT-2026-10-08-city-005.md`.
- **Epic timeline: complete, approved 2026-10-09** (`.wdd/epics/timeline.md`, T1–T5): snapshots every 120 ticks within 48 MiB per scenario, seek = restore + replay, branch B from A's past (A never edited), lockstep compare with linked cameras and cohort metrics incl. incomplete, acceptance e2e, docs (`README.md`, `docs/`). Details: `.wdd/memory/snapshots/CONTEXT-2026-10-09-timeline-004-final.md` and the ward files.
- **Epic polish: complete, approved 2026-10-10.** Spec `.wdd/epics/polish.md` (P1–P6); backlog a1–k11 in `.wdd/memory/polish-backlog.md`, every id accounted in `docs/known-issues.md` (§ Epic gate: deviations e2, e3, i1, i2, i3, i5 + post-switch WebGL tasks).
  - **polish-001…005 done**: keyboard/focus + axe; `.top-band` layout and refit; frame `nextLinks` + junction curves (`render/motion.ts`), closure ring; demo guide ("?" toggle); derived `SlotIndex` (incremental metrics, due-slot passes), `Arc` snapshots, per-side frame pools, fatal errors + Restart (`debugTrap`). Golden `state_hash` values pin determinism. Details in the ward files and `.wdd/memory/snapshots/CONTEXT-2026-10-10-polish-005.md`.
  - **polish-006 done**: f6, k5 pools, rustfmt gate (f3), clean Restart + halted controls (k2/k3), g1, j3. Compare switch off the GPU critical path (A's backing store = app area, spare B renderer, deferred B release; hook `compare` = drawn). Perf re-run 2026-10-10 (stress tick 0.248 → 0.161 ms).
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
| Browser, River City (docs/performance.md) | tick mean 0.05–0.06 ms (~1.7k) / 0.16 ms (~5.7k); render 120 FPS Metal, 20 FPS SwiftShader | polish-006 |
| Timeline (SwiftShader, timeline.json) | seek 87.6 ms median (frame-bound); branch 39.7 ms; A 44.3 + B 37.0 MiB; lockstep ×1.75 per tick | polish-006 |
| Controls under `?demand=5` at 20× (polish-006 test 1) | pause/play/seek ~100 ms; compare on ≤ 280, off ≤ 75 ms (medians) | polish-006 |
| Step, 20×20 grid, 25–32k vehicles (release) | 0.195 ms median, 0.36 ms p95 | core-003 |

## Known Limitations
- All known limitations and deviations, with reasons: `docs/known-issues.md` (one line per backlog id). Targets missed: 10,000 on the network (peak 7,615) and ~60 FPS on SwiftShader (met on a hardware GPU).
- e2e under heavy machine load: some older specs (e.g. `brief_acceptance_flow`, `labels_never_half_cut`) are load-sensitive; log `uptime`, re-run alone.

## What Comes Next
- **Epic `fonts` complete, approved 2026-10-12** (bundled Inter/JetBrains Mono 5.3.0, measured legend placement `ui/bottomBand.ts`; CI green on Ubuntu); re-deployed and verified live under COEP.
- **Now: epic `motion`** (`.wdd/epics/motion.md`, the user's task `.wdd/memory/task-2026-10-11-motion-paused-consequences.md`, facts `.wdd/memory/investigation-2026-10-12.md`, supersessions `.wdd/memory/supersessions.md`). motion-001 done (quiet pause: dirty-driven posts + one settling frame, 50→0 frames/s paused; LIFO pools ≤4 with world generations; S1–S3). motion-002 done (`render/presentation.ts`: presentation time P never ahead of the newest frame, shared A/B clock; interpolation by trip id (frame `tripIds` + per-side `epoch`, `Sim.trip_ids()`); junction clearances from drawn geometry (option A) → stop lines clear of other roads, compressed end zones, cubic junction curve with lane blending; CPU poses uploaded per rAF, history ≤ 128 frames; S4–S8; Red r1–r6, Gold r1 rejected (build, unbounded history) → r2 approved). motion-003 done 2026-10-13 (consequences: read-only `Timeline::exits_at`, `Sim.command_log/exits_at`; frame `interventions` + `bridgeFlow` (now/before blocks), compare `crossings` with base fixed at branch; `ui/consequences.ts`, ConsequencesPanel (single view only), timeline markers ✕/○ with A:/B: in compare, bridge labels + queue pins clear of labels (16 places); Gold r1–r3 rejected → escalated → r4 approved; decision `.wdd/memory/decisions/motion-003-consequences.md`). motion-004 done 2026-10-13 (city character, render side only: `render/cities/character.ts` (district kinds incl. riverside waterfront, `DISTRICT_STYLE` fills + roof marks ridge/court/cross/quay drawn per pixel at 2 px, pad shapes disc/square/cross, road classes major 5.5 px + lighter base, `DECOR_COLORS` below the darkest road); `CityDecor.buildingKinds/quay/quayBollardsFrom/padKinds/roadMajor`; car outline seam from 1.5 px/m, corner-bracket marker, 2.5-px route casing + end square; legend texts; fixed motion-003's side-column regression (gold_polish004); Red r1–r3 rejected → escalated → r4 approved (-auto), Gold r1 approved; decision `.wdd/memory/decisions/motion-004-city-character.md`). Next: motion-005 integration. Epic gate note: frozen motion003.spec test 9 can flake when A has no queue ≥ 3 (needs user authorization to change).
