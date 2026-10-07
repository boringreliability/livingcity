# Review core-005 RED 2

**Reviewer:** adversarial test reviewer (automated quality gate in place of the human approver), 2026-10-07
**Verdict:** REJECTED

Scope: `git diff 5daeacd HEAD`, which covers:
- the updated `.wdd/wards/core/ward-005.md`;
- `web/tests/render.test.ts` (6 Vitest tests);
- `web/e2e/city.spec.ts` and `web/e2e/review1.spec.ts` (10 Playwright tests);
- the unchanged stubs and `testHook.ts`;
- `livingcity.md` and `CLAUDE.md`, checked for brief requirements.

The round-1 prototype (`/tmp/ref005`) was updated to the r2 spec:
- the Pause/Play names;
- `<select aria-label="Speed">` with the four options;
- a constant `aria-label` on the main-bridge toggle, whose visible text switches;
- the `Link N` heading and the Close link / Reopen link buttons;
- the focus guard, now including contenteditable;
- the `achieved-speed` readout and a `role="status"` "⚠ Behind" indicator;
- a 3-texel link table.

While doing this, a **y-flip bug in the round-1 prototype renderer** was found: it drew the city mirrored north/south relative to the camera, picking and `linkScreenCenter`. That prototype passed every test, 70 out of 70 runs (see M7). It is fixed in the reference now.

## Prior findings status

| ID | Status | Note |
|---|---|---|
| B1 (PNG byte threshold) | **resolved** | Test 4 now hides the overlays and checks a non-background share > 0.5 %. It passes the reference 12/12. |
| B2 (UI names not in spec) | **resolved** | The spec now states the exact names and roles. The tests use `getByRole('combobox', {name:/speed/i})`, the anchored `Close link`/`Reopen link`, `Link <id>` and a constant toggle `aria-label`. Mutant `N_toggle_label_switches` (a label that changes to "Reopen…") is now a spec violation, and test 5 kills it. |
| B3 (hand-computed accessible name) | **resolved** | Test 7 uses `ariaSnapshot()`. |
| B4 (paused byte-equality includes overlays) | **resolved** | The spec says "while paused, nothing on the canvas depends on wall time", and test 8 hides the overlays. |
| B5 (click target near the bottom edge) | **resolved** | Test 6 clicks `central_bridge[1]` near the view centre and asserts that `elementFromPoint` is the canvas. |
| M1 (shortcuts in focused controls) | **resolved** | The spec has the rule. Test 9 (G1) kills `N_guard_no_select` and `N_guard_no_button`. |
| M2 (toggle reopens) | **resolved** | Test 10 (G2) kills `N_toggle_noreopen`. Test 5 and others kill `N_toggle_one_dir`. |
| M3 (Esc, +/−) | **resolved** | Test 11 (G3). |
| M4 (closure marker in grayscale) | **resolved** | Test 12 (G4). |
| M5 (DPR 2, wheel zoom) | **partly resolved; new BLOCKER B6.** | G5 kills the DPR-picking and no-wheel mutants. But it assumes a wheel zoom rate, and the backing-store-DPR mutant survives (M9). |
| S1 (behind indicator) | **spec resolved, test missing → M6** | The spec now requires `achieved-speed` and a visible "Behind" `role="status"`. No test exercises it. |
| m1 hook fields in spec | resolved | |
| m2 texel layout | resolved | 3 texels. |
| m3 `running` from frame | resolved | |
| m4 initial state | resolved in spec | Auto-run at 20×. The 20× default is untested (see n1). |
| m5 pending while paused | resolved in spec | Still untested; Gold checks it. |
| m6 `-` key | resolved | |
| m7 U2/U6/U13/U16 | resolved | Adopted as tests 14–16. Unit mutation is 21/21 killed. |
| m8 shader lane/side | **escalated** | The round-1 prototype shows that whole-scene geometry errors pass every test (M7). |
| m9–m12 | unchanged (minor) | |

## Findings

### BLOCKER

**B6 (test 13, `fix G5`): the test depends on an unspecified wheel zoom rate. (test defect)**
- The test sends 5 × `wheel(0, −200)` at a point (40, 20) px away from the road centre, then clicks the road centre again. After zooming by a factor F the road centre lies at anchor − (40, 20)·F.
- The spec does not define the zoom step per wheel event. A legal implementation that zooms 2× per 100 px of `deltaY` (Google-Maps-like) gets clamped at `MAX_ZOOM`, so F ≈ 40/0.52 ≈ 77. The road centre then leaves the viewport (`linkScreenCenter` → null) and the test fails.
- Verified: mutant `W_wheel2x`, which only changes the zoom rate, fails test 13.
- Fix: `fix G5 (r2)` in `/tmp/ref005/fixes2_tail.spec.ts`.
  - It sends one wheel notch at a time and polls until the view changes.
  - The anchor is offset only (6, 3) px, so the road centre stays on screen for any factor up to the clamp.
  - It also asserts the DPR backing store (M9).
- Verified:
  - passes the reference 9/9;
  - passes `W_wheel2x`;
  - kills `G5_dpr_pick`, `G5_nowheel` and `N_dpr_backing_css`.

### MAJOR

**M6 (test gap): the "Behind" status and achieved speed are untested.** The brief requires them (livingcity.md l.179; CLAUDE.md "speed controls must show when the engine can't keep up"), and the spec now requires them. All three mutants survive the full suite:
- `N_behind_missing`;
- `N_behind_colour_only` (a red dot and no text, which violates the colour-blind rule);
- `N_behind_sticky` (never clears).

Fix: `fix S1`.
- It selects 60×.
- It stalls the sim worker for 2.5 s with `page.workers()[0].evaluate(busy-wait)`, which is a real "engine can't keep up" event (the clock's backlog cap).
- A rAF watcher records whether a visible `[role=status]` with the text "Behind" appears.
- It then asserts that the status clears.
- It passes the reference 9/9 and kills all 3 mutants.

**M7 (test gap): nothing checks that what is drawn matches the camera, picking and `linkScreenCenter`; vehicles can be drawn on the wrong carriageway.**
- The **round-1 prototype renderer was y-mirrored**: the shader negated y on top of the NDC convention. The closed hatch for link `ew` appeared on the `we` roadway, and vehicles drove on the left.
- It passed all 10 current e2e tests in 70/70 runs. The reasons:
  - the central bridge is symmetric about y = 0;
  - G4's clip straddles both directions;
  - picking and the hook share the camera, not the shader.
- Further plausible shader mistakes also survive the suite:
  - `N_side_mirror_shader`: vehicles on the opposite roadway;
  - `N_double_shift_shader`: the pair shift is applied again in the shader, so vehicles drive off the road edge;
  - `N_yflip_render`: the round-1 bug.
- The tested TS `vehiclePosition` is not the code that places vehicles. The vertex shader is.
- Fix: `fix N2`.
  - It closes `central_bridge[1]` (east→west) through the panel, zooms with the wheel until the two centre lines are ≥ 40 px apart, and waits for a paused moment with west→east traffic only.
  - It takes two paused canvas pictures with movement in between.
  - It requires that ≥ 95 % of the changed pixels lie within west→east's own roadway (centre line ± 4 m).
  - The check does not depend on colour.
- It passes the reference 7/7 (after a robustness fix) and kills all 3 mutants.

**M8 (test gap): the Play/Pause accessible name is never checked against the state.**
- The spec fixes the names: "Pause" while running and "Play" while paused. Test 7 only matches `/pause|play/`.
- Both mutants survive:
  - `N_playname_const`: the button is always "Pause";
  - `N_playname_kbd_desync`: the label comes from local UI state that the Space shortcut does not update, which is a likely bug.
- In either case the button shows the wrong action after the user presses Space.
- Fix: `fix N1`. It also asserts the 20× default in the select. It kills both mutants and passes 9/9.

**M9 (test gap): the canvas backing store does not have to follow `devicePixelRatio`.**
- The spec requires it, and the user's Mac runs at DPR 2. A backing store at CSS size renders every frame blurry.
- `N_dpr_backing_css` survives the suite because G5 only checks picking.
- Fix: one assertion (`canvas.width / clientWidth ≈ 2`) added to `fix G5 (r2)`. It kills the mutant.

### MINOR

- n1 (test gap): `N_default_speed_5` survives everything, including fix N1. In that mutant the worker runs at 5× while the select shows 20×. A check of `achieved-speed` against the selected speed would catch it.
- n2 (test gap): `N_lane_order_shader` (lane 0 drawn on the left within its own roadway) survives. It shifts vehicles by ≤ 3.5 m, only on 2-lane links, and stays inside the roadway. Gold should look at it in a zoomed screenshot.
- n3 (spec defect): `+`/`-` at the ends of the speed list is unspecified. `N_speed_wrap` (cycle around) survives. Say "clamped".
- n4 (spec): the spec does not say whether the `role="status"` container persists. A live region inserted together with its text is often not announced. Suggest an always-present `role="status"` container whose text changes.
- n5 (test gap, carried over from m9/m10): these survive and are left to Gold:
  - `N_no_return_buffer`;
  - `N_extrap_ignores_len_clamp` (overshoot past the link end between frames);
  - the "pending" state, MetricsStrip content and SelectionPanel fields.
- n6 (test fragility): G4 needs the central bridge to be **empty at paused moments**. It relies on vehicles from the zones (x = ±1150) needing about 75 sim-s to reach the bridge. Before it switches to 1×, `ready()` returns after up to about 1 s of polling at 20×, which leaves a margin of about 50 sim-s. It passed 12/12, but it is coupled to the seed, the city and the startup poll timing. Document this in the test.
- n7 (ward table): row 13 must describe the r2 G5. Add rows for S1, N1 and N2, and update `estimated_tests`.

## Results

**Vitest:**
- Reference: 46/46 (the repo's 43 plus the round-1 tail).
- Repo stubs: 6 failed (`render.test.ts`, "not implemented") and 37 passed. RED confirmed.

**Playwright, r2 prototype, current 10 tests:**

| Run | Renderer | Tests | Result |
|---|---|---|---|
| 1 | y-flipped | 10 | 10/10 |
| `--repeat-each 6` | y-flipped | 60 | 60/60 |
| `--repeat-each 5` | corrected, plus the fix tail | 50 | 50/50 |

- So far the 10 repo tests have run **120 times with 0 failures**, and no flakiness was observed.
- The fix tail flaked once (N2 1/5, vehicles left the bridge between the poll and the pause). After the robustness change it passed 24/24 (4 tests × 6).

**Playwright on the repo stubs:** 10/10 fail at `ready()` (30 s timeout each). RED confirmed.

**Runtime:**
- One full e2e suite on the prototype: **about 30 s** (29.3 s; test 5 takes about 13 s).
- 5 repeats with the 4 fix tests: 3.3 min.
- The red suite on the stubs: about 5 min (10 × 30 s timeouts).

## Mutation table

E2e mutants run against the current suite (tests 4–13) and against the fix tail. Unit mutants run against `render.test.ts`.

| Mutant | Current suite | Fix tail | Severity if uncaught |
|---|---|---|---|
| W_wheel2x (legal: 2× per 100 deltaY) | **fails G5 (B6)** | passes G5 r2 | — |
| N_behind_missing | survives | killed (S1) | MAJOR M6 |
| N_behind_colour_only | survives | killed (S1) | MAJOR M6 |
| N_behind_sticky | survives | killed (S1) | MAJOR M6 |
| N_playname_const | survives | killed (N1) | MAJOR M8 |
| N_playname_kbd_desync | survives | killed (N1) | MAJOR M8 |
| N_guard_no_select (shortcuts fire in the select) | killed (G1) | | |
| N_guard_no_button | killed (G1) | | |
| N_toggle_noreopen | killed (G2) | | |
| N_toggle_one_dir | killed (5, 7, G1, G2, G4) | | |
| N_toggle_label_switches | killed (5) | | |
| N_no_autorun | killed (4–) | | |
| N_default_speed_5 | survives | survives | MINOR n1 |
| N_speed_wrap | survives | — | MINOR n3 |
| N_lane_order_shader | survives | survives | MINOR n2 |
| N_side_mirror_shader | survives | killed (N2) | MAJOR M7 |
| N_double_shift_shader | survives | killed (N2) | MAJOR M7 |
| N_yflip_render (round-1 prototype) | survives (70/70) | killed (N2) | MAJOR M7 |
| N_dpr_backing_css | survives | killed (G5 r2) | MAJOR M9 |
| G5_dpr_pick, G5_nowheel | killed (G5) | killed (G5 r2) | |
| N_extrap_ignores_len_clamp | survives | — | MINOR n5 |
| N_no_return_buffer | survives | — | MINOR n5 |
| Unit U1–U21 | **21/21 killed** | | |

Scripts:
- `/tmp/ref005/mut2.py` (e2e; `--spec=` selects the spec file);
- `/tmp/ref005/umut.py` (unit).

Fix tests: `/tmp/ref005/fixes2_tail.spec.ts` (S1, N1, N2, G5 r2). There are no unit-level MAJOR findings, so there is no `fixes2_tail.ts`.

## Notes for the Gold reviewer

- The **y-flip lesson.** Take one zoomed screenshot of a two-way 1-lane street, for example the north bridge. Check that west→east vehicles are south of east→west vehicles, and that the hatch for a link closed via the panel sits on the road that was clicked.
- Check lane order on the 2-lane arterial (n2): lane 0 is the outer, right-hand lane.
- Check at DPR 2 (MCP browser): the canvas is sharp, and clicking after zoom/pan selects the road under the cursor.
- Check "Behind": in DevTools, pause the worker (or use the S1 trick). The status must show text and an icon, it must clear afterwards, and the achieved speed must be readable.
- Check that "pending" on the toggle clears once a frame confirms, including while paused, where it stays until resume (core-004 semantics).
- Watch the G4 timing coupling (n6) if the city, the demand or the startup changes.
