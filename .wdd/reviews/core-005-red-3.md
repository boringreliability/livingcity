# Review core-005 RED 3

**Reviewer:** adversarial test reviewer (automated quality gate in place of the human approver), 2026-10-07
**Verdict:** REJECTED

Scope: `git diff 9548ca8 HEAD`:
- the ward changes: a permanently present `role="status"`, `+`/`-` stop at the ends, the wheel rate is unspecified, rows 17–20 added, `estimated_tests: 19`;
- the old G5 was removed from `review1.spec.ts`;
- the new `web/e2e/review2.spec.ts` (S1, N1, N2, G5 r2), which is identical to `/tmp/ref005/fixes2_tail.spec.ts` apart from its header comment.

The prototype (`/tmp/ref005`) was updated to the r3 spec: the `role="status"` element is now always present and its "⚠ Behind" content is conditional. All 13 repo e2e tests were copied into it.

## Prior findings status

| ID | Status | Note |
|---|---|---|
| B6 (G5 depends on the wheel rate) | **resolved** | The old G5 is gone, and G5 r2 is in the repo. The legal `W_wheel2x` passes G5 r2, N2 and W1. |
| M6 ("Behind" untested) | **resolved** | S1 kills `N_behind_missing`, `N_behind_colour_only` and `N_behind_sticky`. |
| M7 (drawn placement vs. camera) | **resolved for the static reference, but see B7** | N2 is in the repo. It passed 6/6 on the reference, and in r2 it killed `N_side_mirror_shader`, `N_double_shift_shader` and `N_yflip_render`. Those three were not re-run in r3 (see Results). |
| M8 (Play/Pause name) | **resolved** | N1 kills `N_playname_const` and `N_playname_kbd_desync`. |
| M9 (DPR backing store) | resolved in r2 (G5 r2 assertion, unchanged) | `N_dpr_backing_css` was not re-run in r3. |
| n1 (default 5× in the worker) | open (minor) | |
| n2 (lane order in the shader) | open (minor) | |
| n3 (wrap at the ends) | **spec resolved; test gap remains** (minor) | G3 never presses `+` at 60× or `-` at 1×. |
| n4 (persistent live region) | **spec resolved; test gap remains** (minor) | `N_status_transient` survives the full suite. |
| n5 (buffers, len clamp, pending, strip/panel fields) | open (minor, Gold) | |
| n6 (G4 timing coupling) | open (minor) | Still undocumented in the test. |
| n7 (ward table) | **resolved** | 6 Vitest + 13 Playwright = 19. |

## Findings

### BLOCKER

**B7 (spec defect / test defect, N2 = test 19): a legal renderer with animated water fails N2 deterministically.**
- The spec only forbids wall-time animation *while paused*. Animation while running is allowed, and CLAUDE.md asks for "nice water".
- N2 compares two paused images taken about 0.5 s of running time apart. Every pixel that changes outside the west→east roadway counts against the 95 % threshold.
- Verified with variant `/tmp/ref005/variants/renderer.water.ts`:
  - a full-screen water ripple whose phase advances only while the sim runs, so it is pixel-static while paused;
  - **12 of 13 tests pass, and N2 fails** with inside/changed = 0.045 (expected > 0.95);
  - test 8 (paused-static) still passes.
- The same failure follows for any running-only animation off the roadway: a blinking barrier glyph on the closed east→west link, or animated zone markers inside the clip.
- **Recommended fix (spec, one sentence; N2 unchanged):** "In core-005 only vehicles move on the canvas. Water, decor, closure markers and selection are static, and congestion shading stays within the road's drawn width. A later ward that animates decor must adapt test 19."
  - This fits "no polish rabbit holes" and keeps N2's design.
  - The reference renderer already complies.
- A test-only fix (masking out background animation) was considered. It weakens the kill of `N_double_shift_shader`, because vehicles pushed off the road edge land on water, which would then be masked. Not recommended.
- Related, with no failure observed: congestion encoded as **road width**, which the spec allows ("lightness/width"), could also push changed pixels outside the ±4 m band. Variant `renderer.width.ts` (road 1.4× wider while the link has queued vehicles) passed N2 6/6 because the bridge was never queued in the window. The spec sentence above closes this too.

### MAJOR

**M10 (test gap): wheel zoom about the cursor is untested; the spec requires it.**
- Both mutants survive all 13 tests:
  - `N_wheel_center`: zooms about the viewport centre;
  - `N_wheel_dpr`: the anchor is in device px, a classic DPR confusion given that r1 already had `G5_dpr_pick`.
- G5 r2 and N2 only use `linkScreenCenter`, which shares the camera, so any anchor passes.
- The user-visible consequence: on the user's DPR-2 Mac the map jumps away from the cursor on every notch.
- **Fix:** `fix W1` in `/tmp/ref005/fixes3_tail.spec.ts`.
  - At DPR 2, it puts the cursor on `north_bridge[0]`'s centre (asserted > 100 px from the viewport centre).
  - It turns the wheel one notch at a time until the view changes, so no rate is assumed.
  - It asserts that the link centre is still within 3 px of the cursor.
- Verified:
  - passes the reference 3/3;
  - passes the legal `W_wheel2x`;
  - kills `N_wheel_center` and `N_wheel_dpr`.

### MINOR

- n8 (test gap): `N_achieved_is_target` (the readout shows target/target) and `N_achieved_target_only` survive. S1 only checks `/\d/`. The "Behind" status still reports the shortfall honestly, so this is minor.
  - A candidate test, "the achieved value drops below 40 after a 2.5 s stall at 60×", **failed on the reference 3/3**: the minimum shown was 54. The clock catches up within its 1 s window, so it was dropped. Gold should check the readout manually.
- n9 (test fragility): S1 uses `page.workers()[0]`. A correct implementation that starts another worker (for example a decode worker) first would stall the wrong one. Suggest choosing the worker by URL (`/worker/`).
- n3, n4: specified now, but untested. `N_speed_wrap` was not re-run, but G3 cannot reach the ends, so it survives by construction. `N_status_transient` is verified to survive.
- n1, n2, n5, n6: unchanged.

## Results

- **Vitest:**
  - repo stubs: 6 failed (`render.test.ts`, "not implemented") and 37 passed. RED confirmed.
  - reference: 46/46.
- **Playwright, reference, all 13 repo tests:** `--repeat-each 6` gave **78/78 passed** (6 full runs, 3.5 min, 0 flakes).
  - N2 on the width-congestion variant: 6/6 passed.
  - Full suite on the animated-water variant: 12/13, N2 fails (B7).
- **Playwright, repo stubs:** `--list` shows 13 tests in 3 files. One run of `fix N1` failed at `ready()` after a 30 s timeout. RED confirmed. The full red run was skipped (about 6.5 min of timeouts).
- **Fix tail** (`fixes3_tail.spec.ts`, W1): 3/3 on the reference, and passes the legal 2× wheel rate.
- **Mutation run:** the r3 mutation run was stopped after 16 of 29 mutants. The runner hung with no Playwright child process. It was killed and the prototype sources were restored from `/tmp/ref005/variants/*.orig.*`. The remaining 13 (defaults, speed wrap, the shader mutants, DPR backing, `G5_*`, extrapolation, buffer) were **not re-run in r3**; their r2 results stand, and the test files that killed them are unchanged.

**Runtime:**
- one full 13-test e2e run on the reference: about 35–38 s;
- 6 repeats: 3.5 min;
- one mutant against the full suite: about 40–70 s;
- the full red run on the stubs: about 6.5 min (13 × 30 s timeouts).

## Mutation table

| Mutant | Current 13-test suite (r3) | Fix tail | Severity if uncaught |
|---|---|---|---|
| W_wheel2x (legal) | passes G5 r2 (correct) | passes W1, N2 | — |
| L_water_anim (legal, running-only) | **fails N2 (B7)** | — | BLOCKER |
| L_congestion_width (legal) | passes N2 6/6 | — | (covered by B7 spec fix) |
| N_behind_missing | killed (S1) | | |
| N_behind_colour_only | killed (S1) | | |
| N_behind_sticky | killed (S1) | | |
| N_status_transient | **survives** | — | MINOR n4 |
| N_wheel_center | **survives** | killed (W1) | MAJOR M10 |
| N_wheel_dpr | **survives** | killed (W1) | MAJOR M10 |
| N_wheel_inverted | killed (N2) | | |
| N_achieved_target_only | **survives** | — | MINOR n8 |
| N_achieved_is_target | **survives** | — | MINOR n8 |
| N_playname_kbd_desync | killed (N1) | | |
| N_playname_const | killed (N1) | | |
| N_guard_no_select | killed (G1) | | |
| N_guard_no_button | killed (G1) | | |
| N_toggle_noreopen | killed (G2) | | |
| N_toggle_one_dir | killed (5, 7, G1, …) | | |
| N_toggle_label_switches | killed (5) | | |
| N_no_autorun, N_default_speed_5, N_speed_wrap, N_lane_order_shader, N_side_mirror_shader, N_double_shift_shader, N_yflip_render, G5_dpr_pick, G5_nowheel, N_dpr_backing_css, N_extrap_ignores_len_clamp, N_no_return_buffer | not re-run (r2 results: the shader/DPR/G5 mutants are killed by N2 / G5 r2; default_speed_5, speed_wrap, lane_order, extrap, return_buffer survive, all MINOR) | | |
| Unit U1–U21 | 21/21 killed in r2 (unchanged tests) | | |

Scripts:
- `/tmp/ref005/mut3.py` (13-test suite; `--spec=`);
- `/tmp/ref005/variants/` (the legal water and width variants, plus the originals);
- `/tmp/ref005/fixes3_tail.spec.ts` (W1).

## Notes for the Gold reviewer

- **Animation:** if the implementation animates anything other than vehicles while running, N2 will fail. Hold it to the clarified spec, or require N2 to be adapted.
- **Achieved speed:** check the readout against reality. Throttle the CPU or stall the worker and confirm that the achieved number is the measured value, not the target.
- **Wheel zoom:** at DPR 2, the point under the cursor must stay put when you zoom.
- **Screen reader:** check that the `role="status"` element exists before "Behind" appears.
- Carry-overs from r2:
  - the y-flip and hatch-side screenshot;
  - lane order on the 2-lane arterial;
  - "pending" while paused;
  - G4 timing coupling.
