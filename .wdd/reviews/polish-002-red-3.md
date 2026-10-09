# polish-002 Red review #3

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 3 MINOR)

Reviewed file: `web/e2e/layout.spec.ts` at HEAD `f0e42a0`,
sha256 `d62394ae26aab425bfc88e2f09d417d140bbfa6619f339c8e2b9da7ec6e0cad8` (403 lines).
Ward spec: `.wdd/wards/polish/ward-002.md` at the same HEAD (Tests row 5 now names the `display: none` rule).

## What I ran
- `pnpm -C web exec playwright test e2e/layout.spec.ts`, twice (57.1 s; the second run used `--reporter=line`). Both runs gave 5 failed and 1 passed, each failure for its intended reason:
  1. `panels_never_overlap` fails at `1280×800 branch + road selected` with `Simulation controls × Scenarios`. The single, road-selected and diagnostics states at 1280×800 pass, including the legend toggle and the opacity checks.
  2. `compare_panels_cover_no_road` fails at `1280×800 compare, road selected on A` with 14 B links under "Selected road". The no-selection case passes.
  3. `resize_refits_an_untouched_view` fails at `single 1024×768: zoom = fresh fit` (relative error 0.0606 > 1e-3).
  4. `resize_keeps_a_user_camera` passes (guard).
  5. `labels_never_half_cut` fails at `single 768×800` with `labels cut at the edge`: "⌂ Eastgate" and "⌂ Eastgate Fields". The new `total === all` assertion passes against the current code, so it does not trip early.
  6. `compare_frame_and_supported_widths` fails at `not.toHaveClass(/viewing-b/)` while comparing (`panel scenarios viewing-b`).
- Probe `scratchpad/red-p002-r3/zz_probe_r3.spec.ts` was copied into `web/e2e/` temporarily and then deleted. `git status` is clean apart from this file. For every size from 768×800 to 1280×720, in single view and in compare, the probe measured:
  - how far each label overshoots the edge of its layer;
  - the panel and side-label rects in compare.

## Round-2 findings: status
1. **MAJOR 1 (labels hidden with `display: none` skipped the checks): resolved.**
   - `:351` asserts `expect(l.total).toBe(l.all)`, so every `.zone` must stay laid out with a non-zero box. Every label is therefore subject to the two-way check: visible ⇒ inside, hidden ⇒ would be cut.
   - Hiding with `hidden={…}`, `display: none` or a zero box now fails, and so does any rule that hides labels that fit. The spec row was updated to match.
2. **MINOR 2 (an `opacity: 0` panel counted as visible): resolved.** `:96` asserts that each named region has computed opacity > 0.
3. **MINOR 3 (Follow not covered): still open.** It remains a MINOR, see 2 below.
4. **MINOR 4: for the record only.** No change was needed.

## Round-1 fixes re-checked (still in place)
- `expectPanels`: the named regions are visible and opaque, and every visible panel or side label lies inside the viewport (`:92-113`).
- Fresh-fit camera equality in test 3. Single view is checked against a fresh load at size S; compare is checked against leaving and re-entering compare. A road is selected before the resizes (`:255`, `:264`).
- Test 5 checks labels two ways, and also after resizes without a reload and after a pan in compare.
- Test 6 checks B's pattern on `.scenario-label`, and verifies it before compare and after leaving it.
- `settled()` waits until panel sizes are stable.
- `coveredRoads` requires both halves to be sampled (`:163-164`).

## Feasibility (a correct implementation can pass)
- **Label layers.** In compare the two layers really are the halves (`styles.css:519-527`: `right: 50%` / `left: 50%`, `overflow: hidden`). Test 5's per-layer check therefore measures exactly the half that the spec talks about.
- **Labels near an edge (probe).** In the fitted states no label lies within 1 px of its layer edge. The closest overshoots are:
  - +1.14 px (St. Mary's Hospital, compare 900×800);
  - +1.48 px (Hillside, compare 1024×768);
  - −1.44 px (Hillside, compare 1280×800).
  - Test 5's 0.5 px tolerance therefore cannot make a strict implementation fail in the fitted states. The after-pan state is discussed in MINOR 1.
  - Labels cut today: 2 of 22 in single 768/900; 3 to 5 of 22 per half in compare.
- **Compare at 768×800 (test 1).**
  - The side labels sit at x 12–92 and 680–756. The comparison panel spans 192–576, so they are already clear of it.
  - The only overlap is controls × scenarios, as in the baseline, and stacking resolves it.
- **Frozen specs.** As in round 2, I found no conflict with:
  - `compare.spec` test 11 (`COMPARE_FIT_INSETS`);
  - the legend hidden in compare;
  - `look.spec` (legend expanded at 1280×800);
  - the `gold_timeline004` side-label corners;
  - the city-003/004 `FIT_INSETS` tests.

## Findings

### 1. MINOR: test 5's 0.5 px tolerance is an unstated contract
`web/e2e/layout.spec.ts:333`.
- The test treats a label as "inside" when it overshoots its layer by ≤ 0.5 px. An implementation that hides on *any* overshoot (a strict `<`/`>` comparison) would hide a label that overshoots by 0 < d ≤ 0.5 px. The test then reports that label as `hiddenButFits`.
- The probe shows no label in that band in the fitted states. After the pan, the positions depend on the implementation, so a strict implementation could fail there on an unlucky label. The failure would be deterministic, not flaky.
- **Fix (at Gold, no test change):** the implementation hides a label when its rect exceeds the layer by more than 0.5 px, the same criterion the test uses. Optionally state the tolerance in the ward's Definitions.

### 2. MINOR: Follow as "touching" the camera is still untested
Carried over from round 2.
- The Definitions count Follow centring as a camera move, but no test resizes while following.
- Add regression coverage in a new file at Gold, or list it under Known issues.
- The vehicle panel and the confirm-replace panel are also outside test 1's state matrix. List them under Known issues if they are left out.

### 3. MINOR: `settled()` returns silently if sizes never stabilise
`:79-89`.
- After 20 × 250 ms the helper returns without failing. A panel that keeps resizing (for example, one that animates forever) would still be measured. This is harmless for overlap detection, because any overlap at the moment of measurement still fails the test.
- No change needed.

## Summary
Round 2's MAJOR is resolved: labels can no longer escape the two-way check through `display: none` or a zero box. I re-probed and found nothing new that a correct implementation would fail, and no remaining P2 requirement that a wrong implementation could pass unnoticed. The three MINORs can be handled at Gold or in Known issues. **APPROVED**: snapshot `web/e2e/layout.spec.ts` at sha256 `d62394ae26aab425bfc88e2f09d417d140bbfa6619f339c8e2b9da7ec6e0cad8` for the Gold gate.
