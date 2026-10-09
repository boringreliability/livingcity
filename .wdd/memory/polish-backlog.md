# Polish backlog (collected 2026-10-09 from all review logs; ids are used by epic `polish`)

Items marked *pinned* are constrained by a frozen test.

## (a) Accessibility and keyboard
- **a1:** Esc does not close "Replace the branch?" (`ScenarioPanel.tsx:43-58`, `App.tsx:606,618`). From timeline-005-gold-2 m4.
- **a2:** after a pointer pick in the Speed `<select>`, Space and B are ignored, because `isInteractive` covers SELECT and the blur covers buttons only (`App.tsx:79-81,628-637`). From timeline-005-gold-2 m5.
- **a3:** the `unserved` tooltip and comment leave out unreachable removals (`MetricsStrip.tsx:13-15`, `world.rs:543`). From timeline-005-gold-2 m3.
- **a4:** the diagnostics tick percentiles show 0.100 with no visible sub-resolution flag; only the tooltip says so. *Pinned:* the value format is fixed by city-005's Red contract (`DiagnosticsPanel.tsx:33-35`). From city-005-gold-1 m5.
- **a5:** at 375 px the metrics bar is wider than the viewport (`styles.css:185`). Unverified. From city-003-gold-2.

## (b) Compare and timeline UI
- **b1:** no refit on resize: 1280→1024 in compare crops each half (`App.tsx:439`, refit only at `:413`). From timeline-004-gold-1 m3.
- **b2:** the road panel covers B's top-right road row at 1280×800 (`layout.ts:17`). *Pinned:* `COMPARE_FIT_INSETS` is fixed by `compare.spec.ts` test 11, so move the panel. From timeline-004-gold-1 m4.
- **b3:** district labels are clipped at the halves' edges ("Eastga|te"; `overflow: hidden`). *Pinned* (the insets). From timeline-004-gold-2/3.
- **b4:** while comparing, the main-bridge button shows A's state (`App.tsx:176`). From timeline-005-gold-2 m2.
- **b5:** "Viewing B: branch" is shown while comparing (`ScenarioPanel.tsx:18`). Only the text may change; the viewed scenario is pinned. From timeline-004-gold-3 m1.
- **b6:** the comparison panel is wider than its table. Cosmetic. From timeline-004-gold-1.
- **b7:** the scenario panel and road panel may overlap near 900 px (`styles.css:592`). Unverified. From timeline-003-gold-2 m1.

## (c) Renderer
- **c1:** cars step 4.6 m (median) to 7.4 m at junctions, including the tracked car, its ring and Follow (`renderer.ts:703-715`). From city-003-gold-2..4.
- **c2:** a speed change resets the extrapolation anchor, so cars can step back (`renderer.ts:623`). From city-003-gold-4 m-1.
- **c3:** a worker stall extrapolates at the full multiplier, up to the 2 s cap (`renderer.ts:704`). From city-003-gold-3/4.
- **c4:** the hover halo (0.72) is close in lightness to a congested road (≈ 0.58) (`renderer.ts:138,146`). From city-004-gold-3 #2.
- **c5:** the closed-road hatch is dropped below zoom ≈ 0.07; the barriers remain (`renderer.ts:94`). From city-004-gold-1 m3.
- **c6:** the bridge railing is low-contrast over land. Recheck; probably fixed. From city-004-gold-2 m2.

## (d) First run and demo
- **d1:** in the demo, running B past A can take more than 60 s at 20×; suggest 60× (`docs/demo.md:41`). From timeline-005-gold-2 m1.
- **d2:** there is no in-app first-run guidance; the warm-up UI is untested. The polish epic was deferred in city and timeline.
- **d3:** stale doc text "A plus two Bs" in `docs/architecture.md` § Deviations Memory and `ward-003.md:130`. The host now frees the old B first.

## (e) Performance (measured basis in `.wdd/epics/polish.md`)
- **e1:** `World::metrics()` costs more than a tick under stress (`world.rs:509-545`, `lib.rs:291`, `host.ts:522`).
- **e2:** the full frame pipeline runs every 16 ms while paused (`host.ts:611-619`). From core-005-gold-1 #7.
- **e3:** the frame pool barely reuses buffers; B allocates every frame in compare (`host.ts:505-506,553`). From timeline-004-gold-1 m6.
- **e4:** `Timeline::branch` clones all retained snapshots, then evicts (`timeline.rs:249-251`); 6–13 ms. From timeline-002-gold-1 m1.
- **e5:** a seek copies the head-log prefix, O(trips); 1.72 ms at 3 sim h. From timeline-001-gold-1 m3.
- **e6:** `apply_commands` filters the whole command log every tick; per-slot scans. Measured as negligible.
- **e7:** `vehicle_by_trip` / `trip_outcome` do linear scans (`world.rs:469-493`).
- **e8:** batches are unbounded once ms/tick is measured as 0 (`clock.ts:80-85`).
- **e9:** `performance.now()` resolves only to 0.1 ms.
- **e10:** missed targets, documented: 10k vehicles on the network (peak 7,615) and ~60 FPS on SwiftShader.

## (f) Robustness and other
- **f1:** re-init resets only `executedTicks` (`clock.ts:98-108`).
- **f2:** no recovery after a wasm trap, and no `onmessageerror` handler (`host.ts:622-626,228`, `client.ts`).
- **f3:** `cargo fmt --check` gives 504 hunks, most of them in frozen tests. *Pinned:* a fmt gate must exclude frozen test files.
- **f4:** no e2e test for close-while-paused.
- **f5:** no host unit test that `trackedSeq` is echoed back.
- **f6:** while a B replace is being built, `viewed` stays 1 (`host.ts:400-406`).
- **f7:** small items:
  - `EXTENDED_METRIC_NAMES` repeats the core list as a literal;
  - `core.md` has a stale credit rule;
  - `RIVER_*_X` are needlessly `pub`;
  - River City's baseline is ~1.7k while the docs say ~2k;
  - `gold5.test.ts` is weak;
  - the frame's `tracked`/`linkDetail` typing.
