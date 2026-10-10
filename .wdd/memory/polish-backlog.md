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

## (g) Found in polish wards
- **g1:** Esc on confirm-replace moves focus to the slider even when focus was not in the panel; guard it with `inPanel('section.confirm')` (`App.tsx:624-626`). From polish-001-gold-1 m1.
- **g2:** opening Speed with the pointer without changing it leaves focus on the select, so Space opens it (`ControlPanel.tsx:40-52`). From polish-001-gold-1 m2.
- **g3:** toggling compare clears `mainPending`, so B's queued closure cue disappears until B ticks (`App.tsx:518-521`). From polish-001-gold-1 m3.
- **g4:** the scenario panel keeps its dashed `viewing-b` frame while the heading says "Comparing A and B" (`ScenarioPanel.tsx:17`). From polish-001-gold-1 m4.
- **g5:** `.sr-only` is minimal (no nowrap, margin, border or padding); the frozen h1 test needs area ≤ 1 px² (`styles.css:583`). From polish-001-gold-1 m5.
- **g6:** `gold_polish002.spec.ts:49` selects `section.panel` only, so the error banner (`div.panel.error`) is never measured. The layout itself is correct (Gold r3 probe). From polish-002-gold-3 #1.
- **g7:** fatal errors ("simulation halted", worker error, init failed) are cleared by the next action and can be dismissed, which can leave a frozen city with no explanation. Fix with a separate fatal state, neither dismissible nor cleared. **Goes with f2 in polish-005.** From polish-002-gold-3 #2.
- **g8:** `.error { max-width: 420px }` has no effect inside `.top-band`, so the banner is 628 px wide at 1280 (`styles.css:404`). From polish-002-gold-3 #3.
- **g9:** the timeline track is short between 960 and ~1100 px (111–175 px). From polish-002-gold-2 m3.
- **g10:** the speed readout wraps onto 3 lines with the `?demand=6` badge; at 768 there is a 0 px gap between Diagnostics and the legend in the worst case. From polish-002-gold-2 m4/m5.
- **g11:** in compare at 1280×720 the road panel covers A's bottom-left roads (outside the pinned sizes); in compare at ≤ 900 the scenario panel covers the top of A; the `compare-view` class is unused. From polish-002-gold-1 m3/m4/m7.
- **i1 (epic gate: deviation from P3):** a moving car stops at the end of the junction curve until the next tick, then jumps ahead. At 1× a followed car stood 467 ms, then moved 7.1 m (≈ 16 px at 2.24 px/m). It is pinned by the frozen polish-003 test 4 (extrapolation never passes the link end). Not a regression: the old code had the stop plus the 4.6 m lateral jump. Follow-up idea: interpolate between frames, keyed by trip id. From polish-003-gold-1 F1.
- **i2 (epic gate: readability regression at queues):** cars held at a stop line are drawn at the next link's start, inside the junction, so cars from several approaches stack (`?demand=3` with the bridge closed: 60 overlapping pairs; default demand with the bridge closed: 6). It is pinned by the frozen polish-003 tests 3(a)/4/7. From polish-003-gold-1 F2 and red-3 m3.
- **i3 (epic gate: deviation):** the hover keeps its light-grey halo and adds the dashed centre stroke. The frozen gold5 G1 pins the halo. Spec smoke step 4 still says "a ring". From polish-003-gold-1 F3.
- **i4:** at a steady 20×, cars step back 0.15–0.74 m about every 100 ms (pre-existing; the new cap is tighter). Fix: take the rate from the measured interval between frames. From polish-003-gold-1 F4.
- **i5 (epic gate: deviation):** the closure sign is a white ring with the hatch inside, not a 6 × 6 px white core. The frozen look.spec hatch-at-midpoint test pins this. The sign resembles the legend's selected/followed ring icon, and the closed-road legend entry doesn't show it. From polish-003-gold-1 F5.
- **i6:** `docs/architecture.md:26` says the cap is "1.5 × the frame interval" (it is 1.5 × the expected sim advance). `nextLinks` is copied, not transferred (`host.ts`); adding its buffer to the transfer list would save a copy. Frame bytes went from 16 to 18 B per vehicle (+12.5 %; 30 654 B at 1 703 vehicles). From polish-003-gold-1 F6.
- **j1:** with `?demand=6` the first control row overflows the 326 px panel (badge and bridge button stick out ~36 px). The panel's bottom then sits at 128 px and covers links 292/293 at 1024. This was already the case before polish-004; the "?" icon makes the overflow ~36 px worse. Fix: put the badge on its own line, or let the row wrap within the band. From polish-004-gold-2 #1.
- **j2:** README:44, demo.md:5 and the × tooltip say "Guide", but the button shows "?". Write "the **?** (Guide) button". From polish-004-gold-2 #2.
- **j3:** while the guide is shown, the "?" button has no visible focus ring: the pressed-state outline overrides `:focus-visible` (`styles.css:778`). The Diagnostics and Scenarios buttons share this pattern. From polish-004-gold-2 #3.
- **j4:** the disabled "?" (while comparing) explains itself only in its `title`. From polish-004-gold-2 #4.
- **j5:** step 2 can tick from forward seeks while paused (`guideProgress.ts:31-34`). Fix: count ticks only while running. From polish-004-gold-1/2.
- **j6:** `layout.spec.ts` `labels_never_half_cut` is intermittent under heavy machine load (it failed 3/3 alone at load ~30 in gold-1; it passed in 4 later full runs). From polish-004-gold-1/2.

## (k) From polish-005 (resolved here: e1, e4, f1, f2, g7; e3 partly = per-side pools; e2 pinned by G4/G4b)
- **k1 (polish-006):** the browser perf harness (`pnpm -C web e2e:perf`) was not re-run in polish-005, so `docs/performance.md`'s browser baseline still shows the pre-optimization numbers. polish-006 re-runs it and cites before/after. From polish-005-gold-1 m1.
- **k2:** Restart does not give a clean UI state. The guide keeps progress from the dead world, the selected road carries over, and tracked vehicle, follow, pending seek, the held A/B pair, comparison and confirm are not reset (`App.tsx:130-136`). From polish-005-gold-1 m2.
- **k3:** the fatal banner clears on the Restart click, not when the new worker is ready. The halted state is unclear: the message reads "simulation halted: unreachable", and the controls still show Pause and stay enabled. From polish-005-gold-1 m3/m4.
- **k4:** snapshot bytes are 112 B larger per snapshot, because the index field sits inside `World`. The `Snapshot` field-classification comment in `timeline.rs` doesn't list `index`. From polish-005-gold-1 m5.
- **k5:** B's frame pool is never cleared after compare ends, and `init` clears neither pool. Bounded to a few buffers. From polish-005-gold-1 m6.
- **k6:** test 7b (returnBuffer side) only counts arguments; all App calls do pass the right side. From polish-005-red-3 m1.
