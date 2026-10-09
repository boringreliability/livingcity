# polish-002 Red review #2

**Verdict: REJECTED** (1 MAJOR)

Reviewed file: `web/e2e/layout.spec.ts` at HEAD `9f74d4c`,
sha256 `094e3b3fe673b470316592a5d43227cb6d1be13ce362e8df3a1e5f9ce33e6a57`.

## What I ran
- `pnpm -C web exec playwright test e2e/layout.spec.ts` gave 5 failed and 1 passed (58.5 s). Each failure is for its intended reason:
  1. `panels_never_overlap` fails at `1280×800 branch + road selected` (overlap). The single, road-selected and diagnostics states at 1280×800 pass.
  2. `compare_panels_cover_no_road` fails at `1280×800 compare, road selected on A` with 14 covered points. The no-selection case passes.
  3. `resize_refits_an_untouched_view` fails at `single 1024×768: zoom = fresh fit` (relative error 0.0606 > 1e-3).
  4. `resize_keeps_a_user_camera` passes (guard).
  5. `labels_never_half_cut` fails at `single 768×800` with 4 labels cut at the edge.
  6. `compare_frame_and_supported_widths` fails at `not.toHaveClass(/viewing-b/)` while comparing. B's pattern on `.scenario-label` was confirmed beforehand, so the check has teeth.
- Probe `scratchpad/red-p002-r2/zz_probe_r2.spec.ts` was copied into `web/e2e/` temporarily and then deleted. `git status` is clean apart from this file. It ran three checks:
  - **p1:** panel rects at 768×800, 900×800 and 900×700 with diagnostics open and in compare, plus a trial click on "Compare side by side" while comparing.
  - **p2:** a simulated wrong implementation that sets `display: none` on every label within 250/150 px of its layer edge, measured with test 5's check logic.
  - **p3:** two fresh loads at 900×700, comparing the camera.

## Round-1 findings: status
1. **Resolved.** Panels hidden or pushed off-screen are now caught:
   - `expectPanels` checks that each state's named regions are visible and that every visible panel lies inside the viewport;
   - the legend toggle is checked (`:91-109`, `:186-211`).
2. **Resolved.** Test 3 now compares against a fresh fit (1 m / 0.1 %).
   - Single view uses a fresh load at size S. p3 shows this is deterministic: two loads at 900×700 gave an identical `{cx:70, cy:70, zoom:0.122994…}`.
   - Compare uses leaving and re-entering compare. The `fitInsets(COMPARE_FIT_INSETS)` layout effect reads the same canvas rect, so it is a valid fresh fit.
   - The failure measured now (6 % zoom error) shows the check has teeth.
3. **Resolved.** A road is selected before the resizes in single view and in compare (`:251`, `:260`). A Follow scenario is still not tested; see MINOR 3.
4. **Partly resolved.** The check now runs both ways (`hiddenButFits`), but a `display: none` loophole reopens bulk hiding; see MAJOR 1.
5. **Resolved.** The frame check now reads `.scenario-label`, and B's pattern is asserted again both before compare and after leaving it.
6. **Resolved.** `settled()` waits until the panel sizes are stable.
7. **Resolved.** Labels are now checked after resizes without a reload (both single and compare) and after a pan in compare.
8. **Resolved.** Both halves must be sampled (`samples < n*5`).
9. **Resolved / accepted.** b6 is moved to the integration ward. The states missing from the matrix are discussed in MINOR 3.

## Feasibility (correct implementation can pass)
- **Test 1 at 768×800.**
  - Measured sizes: controls 286×100, scenarios 314×112, comparison 384×175 (bottom centre), road panel about 240×190–262, diagnostics 326×202.
  - The metrics strip is 519 wide and the expanded legend is 704 wide. Side by side they need 1223 px against 736 available, so below 1100 the legend must collapse. The spec allows this.
  - Controls + scenarios + road panel do not fit side by side, but stacking them (road panel top-right, scenarios under the controls) fits in 800 px.
- **Test 3 at 900×700 in compare.** "Compare side by side" can be clicked: p1 trial click OK, scenarios at y16–128, comparison at y490–650. The leave/re-enter path is therefore reachable.
- **Test 5 timing.** Labels are placed in the rAF loop, and the 400 ms wait covers several frames even on SwiftShader. A correct implementation hides labels in that same loop with the same `getBoundingClientRect` criterion, and the 0.5 px tolerance absorbs rounding. Nothing races.
- **Frozen specs.** I found no conflicts with:
  - `compare.spec` test 11 (insets pinned);
  - `compare.spec:124` (legend hidden in compare, which test 1 respects);
  - `look.spec` legend expanded at 1280×800;
  - the `gold_timeline004` side-label geometry at 1280/1100/1024;
  - `city.spec:198` (canvas width at 900×700 only).

## Findings

### 1. MAJOR: test 5 skips labels hidden with `display: none`, so needless bulk hiding passes again
`web/e2e/layout.spec.ts:331`, `:343`.
- `zones` drops every `.zone` with `display: none` or zero width before the `cut` / `hiddenButFits` checks. The only guard left is `total > 10` per layer, out of 22 labels.
- **Measured (p2, 1280×800 single).** Setting `display: none` on 10 labels, all of which fit, gave `{"all":22,"total":12,"cut":0,"hiddenButFits":0}`, and test 5's check passes.
- **Why this matters.** The natural React implementation is `hidden={!fits}`, which is the HTML `hidden` attribute, i.e. `display: none`. Combined with a wrong fit rule, it passes:
  - a safety margin;
  - the viewport instead of the half;
  - a stale rect;
  - any rule that hides up to 11 of 22 labels.
- This is exactly what round-1 finding 4 was about. The spec requires `visibility: hidden` (Outputs; table: "visibility: hidden keeps its box"), and the test does not enforce that.
- **Fix.** In `check`:
  - assert that no `.zone` in a layer has computed `display: none` or a zero-area rect, e.g. `expect(l.total).toBe(l.all)` with `all = layer.querySelectorAll('.zone').length`;
  - optionally also assert that `all` is the same for A and B in compare.
  - Then every label is subject to the two-way check.

### 2. MINOR: `opacity: 0` panels slip past test 1's in-viewport and overlap checks
`:93`, `:98`, `:117`.
- Playwright's `toBeVisible()` treats `opacity: 0` as visible, but `vis()` filters such panels out of `layoutProblems` and `expectPanels`. A panel faded to `opacity: 0` therefore passes the "visible" check and is ignored by the overlap and viewport checks.
- This is contrived, but cheap to close: for the named regions, also assert computed `opacity > 0`, or drop the opacity term from `vis()`.

### 3. MINOR: Follow is still not covered as "touching"
- The spec's Definitions say Follow counts as touching the camera, and the Must NOT says never refit a camera the user moved. No test resizes while following.
- An implementation that ignores Follow would, on resize, apply the fitted zoom while Follow keeps re-centring on the vehicle, so the view jumps. A Follow step in a *new* regression file at Gold is fine, or a line under Known issues.
- The vehicle panel and the confirm-replace panel are also not in test 1's state matrix. Note them under Known issues if they are left out.

### 4. MINOR: compare refit in test 3 tests "selection is not a move" only on its first step
`:260-269`.
- Re-entering compare clears the selection (`App.tsx` compare layout effect), so the 900×700 and 1280×800 compare steps run with no selection.
- This is acceptable because the first step covers it, and the single-view loop covers all three sizes. No change is needed; it is noted for the record.

## Summary
Round 1's findings 1–3 and 5–8 are resolved, and every check I could probe is achievable and deterministic. One gap remains:
- **MAJOR 1:** test 5 ignores `display: none` labels, so an implementation can hide up to half the labels that fit and still pass.

The fix is one assertion: every `.zone` is counted (no `display: none`). Fix it, and preferably also MINOR 2, then submit to a new Red review.
