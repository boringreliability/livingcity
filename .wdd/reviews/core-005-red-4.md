# Review core-005 RED 4

**Reviewer:** adversarial test reviewer (automated quality gate in place of the human approver), 2026-10-07
**Verdict:** APPROVED

Scope: `git diff 1c711ae HEAD`:
- the spec sentence "In core-005 only vehicles move on the canvas …";
- `web/e2e/review3.spec.ts` (W1), identical in substance to `/tmp/ref005/fixes3_tail.spec.ts`;
- S1 now selects the worker by URL;
- `estimated_tests: 20` (6 Vitest + 14 Playwright; the table rows add up).

The prototype (`/tmp/ref005`) already complied with the new sentence (static water, closure hatch and selection). `review2.spec.ts` and `review3.spec.ts` were copied into it, so it now runs all 14 repo e2e tests.

## Prior findings status

| ID | Status | Note |
|---|---|---|
| B7 (animation off the roadway fails N2) | **resolved (spec)** | Animation off the roadway is now out of scope, so the running-only water and the marching closure hatch are non-compliant, and N2 correctly rejects both. Legal congestion lightness passes the full suite 42/42. |
| M10 (wheel zoom about the cursor) | **resolved** | W1 is in the repo. It kills `N_wheel_center` and `N_wheel_dpr`, and the legal `W_wheel2x` passes. |
| M7 / M9 (shader placement, DPR backing) | **resolved, re-verified** | The shader, DPR and G5 mutants not re-run in r3 were re-run against the 14-test suite. All are killed (table below). |
| n8 (achieved = target survives) | open (minor) | Unchanged. Gold should check it manually. |
| n9 (S1 picks `workers()[0]`) | **partially resolved** (minor) | `/worker/i` is weaker than it looks. Vite dev rewrites every module-worker URL to `…?worker_file&type=module` (`WORKER_FILE_ID = "worker_file"` in vite's dist), so any second worker also matches, and `find` returns the first one. Suggest `/\/sim\/worker\.ts/`, the core-004 file used by `createSimClient`. |
| n1, n2, n3, n4, n5, n6 | open (minor) | Unchanged. `N_lane_order_shader` and `N_extrap_ignores_len_clamp` were re-run and still survive (n2, n5). |

## Findings

### BLOCKER
None.

### MAJOR
None.

### MINOR
- **n10 (test gap): the spec forbids animated closure glyphs, but no test enforces it.**
  - The barrier glyphs at the bridge ends lie 100 m from the bridge midpoint, so they fall outside N2's clip of ±80 m.
  - A running-only blinking glyph would therefore pass every test, and test 8 only checks the paused canvas.
  - A running-only *hatch* animation on the closed link is caught: `V_glyph_blink_running_only` (a marching hatch) was killed by N2.
  - The consequence is cosmetic only.
- **n11 (spec wording): "must update the N2/B4 tests".** "B4" is an internal review ID. Name the tests in the ward's own numbering instead (19 and 8).
- **n12 (spec clarity): eased or inertial zoom and pan are excluded only implicitly.**
  - The exclusion follows from "while paused nothing depends on wall time" and "one notch must change the view".
  - A tweened camera would make N2's clip, and W1's and G5's position reads, race the tween.
  - Suggest one explicit sentence: "Camera changes are applied immediately (no easing) in core-005."

## Results
- **Vitest, repo stubs:** 6 failed (`render.test.ts`) and 37 passed. RED confirmed.
- **Playwright, repo stubs:**
  - `--list` shows 14 tests in 4 files.
  - `review3.spec.ts` (W1) fails at `ready()`. RED confirmed.
- **Playwright, prototype, all 14 repo tests:** `--repeat-each 3` gave **42/42 passed** (1.8 min, 0 flakes).
- **Legal variant `V_congestion_lightness`** (`renderer.light.ts` + `App.cw.tsx`): full suite with `--repeat-each 3`, 42/42 passed.

## Mutation table
Runner: `/tmp/ref005/mut4.py`. It runs the full 14-test suite with `-x`, applies a 420 s per-mutant timeout, and restores the sources afterwards. No timeouts or hangs occurred, and the prototype sources were verified identical to `variants/*.orig.*` afterwards.

| Mutant / variant | Result (14 tests) | Killing test | Severity if uncaught |
|---|---|---|---|
| W_wheel2x (legal) | passes (correct) | — | — |
| N_wheel_center | KILLED | W1 | |
| N_wheel_dpr | KILLED | W1 | |
| V_water_anim_running_only (now non-compliant) | KILLED | N2 | |
| V_glyph_blink_running_only (marching hatch, non-compliant) | KILLED | N2 | |
| V_congestion_lightness (legal) | passes ×3 (correct) | — | — |
| V_congestion_width (now non-compliant) | survives | — | MINOR (bridge not queued in the window; cosmetic) |
| N_side_mirror_shader | KILLED | N2 | |
| N_double_shift_shader | KILLED | N2 | |
| N_yflip_render | KILLED | N2 | |
| N_dpr_backing_css | KILLED | G5 r2 | |
| G5_dpr_pick | KILLED | G5 r2 | |
| G5_nowheel | KILLED | N2 | |
| N_lane_order_shader | survives | — | MINOR n2 |
| N_extrap_ignores_len_clamp | survives | — | MINOR n5 |
| others (S1/N1/G1–G3 mutants) | r3 results stand; those tests are unchanged apart from the S1 worker selector | | |

## Notes for the Gold reviewer
- **Achieved speed:** compare the readout with reality (n8). A readout that shows the target value would pass every test.
- **Lane order:** check it on the 2-lane arterial (n2), and check that extrapolation is clamped at the link end (n5).
- **Static scene:** while running, check that the barrier glyphs and the water do not animate (n10).
- **Speed and status:** `+` at 60× and `-` at 1× must not wrap around (n3). The `role="status"` element must exist before "Behind" appears (n4).
- **Carry-overs:** the y-flip and hatch-side screenshot, "pending" while paused, and G4 timing coupling.
