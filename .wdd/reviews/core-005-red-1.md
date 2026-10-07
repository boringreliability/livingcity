# Review core-005 RED 1

**Reviewer:** adversarial test reviewer (automated quality gate in place of the human approver), 2026-10-07
**Verdict:** REJECTED

Scope: `livingcity.md`, `CLAUDE.md` (graphics roadmap, UI constraints), `.wdd/wards/core/ward-005.md`, stubs `web/src/render/{geometry,camera,picking}.ts` and `web/src/ui/testHook.ts`, `web/tests/render.test.ts` (3 Vitest), `web/e2e/city.spec.ts` (5 Playwright), `web/playwright.config.ts`, and the core-004 sim layer (`web/src/sim/*`, `crates/sim-wasm`, `crates/sim-core/src/{cities,world}.rs`) for feasibility.

RED state in the worktree:
- **Vitest:** 3 failed, 37 passed (40 tests). The 3 new tests fail with `Error: not implemented`.
- **Playwright:** 5/5 fail at `ready()` because `window.__livingcity` is missing. Each times out after about 30 s.

## Findings

### BLOCKER

**B1 (test 4): the PNG byte-size threshold is arbitrary and does not measure the canvas.**
- `png.byteLength > 20_000` is applied to a screenshot of the full-window canvas, and that screenshot also contains every HTML overlay drawn on top of the canvas.
- The reference implementation renders roads, lanes, moving vehicles and a closed-road hatch, which is a correct render. Its screenshot is 16,165 bytes (suite run) and 18,718 bytes (probe run). Both fail the test.
- With the overlays hidden, the canvas alone is 7,648 bytes. A dark, flat-background city compresses very well, and a water band adds almost nothing.
- So a correct implementation fails, while a blank canvas with rich overlays can pass. The test does not check "non-background pixels" (ward table #4).
- Fix: replace the assertion with `fix B1` in `/tmp/ref005/fixes_tail.spec.ts`. It hides the overlays and requires at least 0.5 % of canvas pixels to differ from the most common colour. It passes on the reference and kills the blank-render mutant (`B1_blank`).

**B2 (tests 5, 6, 7): tests require UI names and structure that the spec does not define.** A correct implementation of the current spec can fail any of these:
- *Speed control.* Tests 5 and 7 need a native `<select>` labelled `/speed/` with an option labelled exactly `60×`. The spec only says "speed 1×/5×/20×/60×", so a segmented button group is a valid reading.
- *Unscoped speed locator.* `page.getByLabel(/speed/i)` is not limited to a role. Any other element whose aria-label contains "speed", such as an "achieved speed" indicator (which CLAUDE.md requires, see S1), causes a strict-mode violation. Verified: mutant `B_achieved` makes test 5 fail. Use `getByRole('combobox', { name: /speed/i })`.
- *Selection-panel buttons.* They must be named exactly `Close link` / `Reopen link` (anchored regexes), but the spec says "Close/Reopen".
- *Selection-panel heading.* The panel must contain the text `Link <id>`, and only once because of `getByText` strictness. The spec says only "link id", so "Road #43" or "Link #43" fails.
- *Main-bridge button name.* Its accessible name must stay "Close the main bridge" while it is pressed. A label that switches to "Reopen the main bridge" breaks the test 5 locator after the click. The spec should state that the name is constant and the state is carried by `aria-pressed`.
- Fix: add a "UI contract" paragraph to the spec with these names and roles, or loosen the locators.

**B3 (test 7): the test computes accessible names itself, and wrongly.**
- It uses `aria-label`, then `label[for=id]`, then `textContent`.
- That misses `aria-labelledby`, a wrapping `<label>` and `title`, which are all valid accessible names. For a `<select>` the fallback returns the option texts (`1×5×20×60×`).
- Verified: mutant `B_labelledby` (speed `<select aria-labelledby=…>`) fails test 7.
- Fix: `fix B3` reads the browser-computed name with `locator(':focus').ariaSnapshot()`. It passes on `B_labelledby` and kills an unnamed select (`B3_noname`).

**B4 (test 8): byte-equal screenshots while paused are stronger than the spec.**
- The ward says "vehicle positions are stable". The test requires the whole canvas region to be byte-identical, and that region includes the HTML overlays on top of the full-window canvas.
- These are legal under the current spec and all fail the test, even though vehicles are perfectly still:
  - any live HTML: a wall clock (the spec contrasts sim time with the wall clock), or a render-fps / frame-time diagnostics readout (CLAUDE.md asks for render frame time to be measured);
  - any wall-time-driven canvas effect, such as water shimmer or an animated hatch.
- Verified: mutant `B_clock` (a wall-clock span in the strip) fails test 8.
- Fix:
  1. Spec: "While paused, nothing drawn on the canvas depends on wall time."
  2. Test: hide the overlays before the screenshots (`fix B4`). It passes on `B_clock` and still kills extrapolation while paused (`B4_extrap_paused`).

**B5 (test 6): the click target depends on layout.**
- `south_bridge[0]` is at the bottom edge of any fit view (world y = −700 = `minY`). In the reference it lands at y ≈ 760 of 800.
- `linkScreenCenter` only returns null when the point is off-screen, not when an overlay covers it. A full-width bottom bar, which fits the MetricsStrip and CLAUDE.md's "bottom timeline", takes the click, and nothing is selected.
- Verified: mutant `B_bottom_bar` (a 64 px full-width strip) fails test 6.
- Fix: click a link near the view centre, e.g. `central_bridge[1]`, and assert `document.elementFromPoint(p)` is the canvas, as `fix G5` does. Also either make `linkScreenCenter` return null when the point is occluded, or have `fit` respect the overlay insets.

### MAJOR

All eight G-mutants below **survive** the current 4 runnable e2e tests (5–8) and are **killed** by the verified fix tests in `/tmp/ref005/fixes_tail.spec.ts`.

| # | Type | Gap | Mutants (survive suite → killed by fix) |
|---|---|---|---|
| M1 | test gap + spec defect | Keyboard shortcuts while focus is in a control. Every test blurs first, so nothing checks that Space on a focused button only activates that button, or that Space/B in the focused select do nothing. The spec has no rule for this. Spec: "Global shortcuts are ignored while focus is in a form control (button/select/input)". | `G1_noguard` → fix G1 |
| M2 | test gap | "Pressing it again reopens both" is never exercised. Test 5 only closes and test 7 presses B once. | `G2_noreopen` (toggle only closes) → fix G2 |
| M3 | test gap | Esc (clear selection) and `+`/`−` (speed) are specified but untested. | `G3_noesc`, `G3_noplus` → fix G3 |
| M4 | test gap | The closed-road marker, the core of the brief, is never checked. A renderer that ignores `closed`, or only tints it slightly, passes everything. `fix G4` compares a grayscale clip of the empty, paused bridge before and after closure (mean abs ΔL > 15). The reference gives about 100. | `G4_nohatch`, `G4_tint` (tint only) → fix G4 |
| M5 | test gap | Picking/camera consistency at DPR ≠ 1 and after wheel zoom. Playwright "Desktop Chrome" has DPR 1, and the user's Mac has DPR 2. A device-pixel/CSS-pixel mix-up in picking, or wheel zoom not wired up, is invisible to the suite. `fix G5` runs with `deviceScaleFactor: 2`, zooms with the wheel and clicks again. | `G5_dpr`, `G5_nowheel` → fix G5 |
| S1 | spec defect | `livingcity.md` l.179 and CLAUDE.md both require that "speed controls must expose when the engine cannot keep up". The core-004 readout did this (`— BEHIND`, achieved/target), but core-005 replaces that readout and the ControlPanel spec drops it. Spec: the ControlPanel shows achieved vs target speed and a `behind` marker that does not rely on colour alone. Test: hook `snapshot().clock` (or `behind`, `achievedSpeed`) plus a visible text assertion. | (spec fix; not prototyped) |

### MINOR

- m1 (spec defect): the spec's hook description omits `renderFrames` and `linkScreenCenter`. The stub and the tests rely on both, so list them in the spec.
- m2 (spec defect): the "2 texels per link: endpoints; normal + width + lanes + sim length" layout holds 4 + 5 = 9 values in 8 channels. Drop `width` (it is `lanes × 3.5`) or use 3 texels.
- m3 (spec defect): define `snapshot().running` as the latest frame's `clock.running`. With an optimistic local flag, the tests 6/8 sequence (`running` false, read `simTimeS`, sleep, compare) can race with a frame already in flight (low probability).
- m4 (spec defect): the initial state is unspecified, yet every e2e test needs it: auto-run on load (`tick > 10`) and the default speed. The smoke test implies auto-run; state it.
- m5 (spec defect): close/open while paused is scheduled for the current tick but applied only on the next `step`. "Pending" therefore stays visible for the whole pause. Say so, so that nobody "fixes" it in the UI.
- m6 (spec wording): `−` is not a `KeyboardEvent.key`. Specify `-`, and `=` as an unshifted `+`.
- m7 (test gap, unit): mutants U2 (only the start point shifted, so the road is skewed), U6 (`s` mapped by drawn length instead of sim length; harmless today because three_bridges lengths are Euclidean), U13 (`fit` not clamped) and U16 (picking by distance to the infinite line) survive `render.test.ts`. U16 is caught by e2e test 6, because the south bridge is collinear with lower-id row-0 streets. Fixes: `/tmp/ref005/fixes_tail.ts` (verified: each kills its mutant and passes the reference).
- m8 (test gap): the shader's lane/side placement is never tested; only the TS `vehiclePosition` is. See the Gold notes.
- m9 (test gap): "buffers are returned" is unobservable. The host pool reuses only exact-size buffers, so a missing return costs only GC.
- m10 (test gap): MetricsStrip content (sim `HH:MM:SS` label, queued tooltip, unreachable), selection-panel fields (lanes, km/h, length, vehicles, queued), the optimistic "pending" state, zone labels and pan by drag are untested. Gold checks these manually.
- m11 (test strength): test 5 discriminates, but only because of the closure, not because of warm-up. "Before" is about 2.1 vehicles. Without the closure, "after" is about 1.9 (3/3 runs fail). With it, "after" is about 12.7 (6/6 pass, margin ×6). It is coupled to seeds (2026, 7) and the timing; keep the seed fixed in the App.
- m12 (spec): the core-004 speed list had 300×; core-005 drops it. Intended? It is fine either way, but note it.

## Reference / feasibility results

- **Reference** (`/tmp/ref005`, repo copy, `node_modules` symlinked):
  - `geometry.ts`, `camera.ts`, `picking.ts` pass all 3 unit tests, and the full Vitest suite is 43/43 including the fix tail.
  - Every numeric expectation was checked by hand:
    - ab at y = −4 and ba at y = +4.
    - Lane 0 at y = −5.75.
    - Picking thresholds 22 px at zoom 4, and 9.75 px at zoom 0.5. The ab distance of 9.5 px is deliberately inside the threshold, which kills the "first within tolerance" mutant.
    - Tie at 16/16 px.
    - `fit` zoom 0.38, so spanX = 760.
- **Prototype App** (WebGL2 instanced vehicles from the AoS buffer through a link texture, triangle roads with a hatch, per-link state texture, React controls, hook):
  - Tests 5–8 pass: tests 6/7/8 passed 24/24 over 8 repeats each, and test 5 passed 6/6. The paused screenshots were byte-identical every time.
  - Test 4 fails only on the byte threshold (B1).
  - Achieved speed under swiftshader is fine: 300 sim-s in about 5 s wall.
- **Blocker confirmations** (mutants of a correct implementation): `B_labelledby` fails test 7, `B_bottom_bar` fails test 6, `B_clock` fails test 8, and `B_achieved` fails test 5.
- **Fix tail:** 8 e2e fix tests (G1–G5, B1, B3, B4) all pass on the reference.
  - G1–G5: the 8 G-mutants survive tests 5–8 and are killed by their fix.
  - `B3` passes `B_labelledby` and kills `B3_noname`.
  - `B4` passes `B_clock` and kills `B4_extrap_paused`.
  - `B1` kills `B1_blank`.
- Scripts: `/tmp/ref005/mut.py` (e2e mutants) and `/tmp/ref005/umut.py` (unit mutants).

## Mutation table (unit tests, `render.test.ts`)

| Mutant | Result | Fix tail |
|---|---|---|
| U1 normal flipped (−dy, dx) | killed (T3, T2) | |
| U2 only start point shifted | **survives** | killed |
| U3 one-way links also shifted | killed | |
| U4 offset without median gap | killed | |
| U5 lane 0 leftmost | killed | |
| U6 s mapped by drawn length | **survives** | killed |
| U7 width = lanes × 3 | killed | |
| U8 bounds without node pass | killed | |
| U9 camera y not flipped | killed | |
| U10 zoomAt about centre | killed | |
| U11 zoomAt unclamped | killed | |
| U12 fit ignores padding | killed | |
| U13 fit unclamped | **survives** | killed |
| U14 fit uses max (overflows) | killed | |
| U15 panBy y sign | killed | |
| U16 pick by infinite-line distance | **survives** (caught by e2e test 6) | killed |
| U17 pick tolerance not zoom-scaled | killed | |
| U18 ties → higher id | killed | |
| U19 first within tolerance | killed | |
| U20 pick ignores width | killed | |
| U21 pick on unshifted node line | killed | |

17 of 21 are killed. The 4 survivors are minor, and fix tests are provided.

## Notes for the Gold reviewer

- Check vehicle side and lane in a zoomed screenshot of a two-way street:
  - eastbound vehicles are south of westbound vehicles (right-hand traffic);
  - on the 2-lane arterial, lane 0 is the outer (right-hand) lane.
- Run the grayscale check on the closure marker even if `fix G4` is adopted. That test proves "visibly different", not "unmistakable".
- Load the app at DPR 2 (MCP browser on the Mac). Click roads after zooming and after panning.
- Verify: no shortcut fires while typing or focused in the select; Space on a focused button does not also pause.
- Verify that the behind/achieved indicator exists (S1) and that "pending" clears once a frame confirms.
- Use `--repeat-each 3` on test 5 and test 8 to look for flakiness.
