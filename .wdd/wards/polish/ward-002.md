---
ward: 2
revision: null
name: "Layout that fits: resize refit, split-view panels and narrow widths"
epic: "polish"
status: "red"
dependencies: ["polish-001"]
layer: "typescript"
estimated_tests: 6
created: "2026-10-09"
completed: null
---
# Ward polish-002: Layout that fits

## Scope
This ward implements contract **P2** of epic `polish`. Goals:
- The city stays in view when the window changes size.
- Panels never sit on top of each other, at any supported width (1280, 1024, 900 and 768 px).
- While comparing, no panel covers a road.
- District labels are never half-cut at the edge of a split-view half.

Backlog ids (`.wdd/memory/polish-backlog.md`): b1, b2, b3, b7, a5 (narrow widths), g4. b6 (comparison panel width) is cosmetic and left to the integration ward's accounting.

## Inputs
**Code**
- `web/src/App.tsx`:
  - the resize effect (ResizeObserver, `camera.setViewport`);
  - the compare-enter effect (`camera.fitInsets(g.bounds, comparingNow ? COMPARE_FIT_INSETS : FIT_INSETS)`);
  - the DOM label layers `.labels` and `.labels.labels-b` (`placeLabel`);
  - the side labels.
- `web/src/render/camera.ts`: `Camera.fitInsets` and `setViewport`.
- `web/src/render/layout.ts`: `FIT_INSETS`, `COMPARE_FIT_INSETS`.
- `web/src/styles.css`: panel positions, the `@media (max-width: 1199px)` rule, and `.app.comparing …`.
- Test hook: `snapshot().camera`, `linkScreenPoint`, `linkScreenPointB`, `snapshot().linkCounts.length`.

**Baseline probe** (2026-10-09, headless Chromium at 1280/1024/900/768 × 800). These states had overlapping panels:

| Width | Overlapping panels |
|---|---|
| 1280 (branch) | "Simulation controls" × "Scenarios" |
| ≤ 1024 | "Simulation metrics" × "Legend", in every state |
| 900 and 768 (branch + selection) | "Selected road" × "Scenarios" |
| 768 (branch, compare) | "Simulation controls" × "Scenarios" |

No width had horizontal scroll.

## Outputs
- **Refit on resize.**
  - The camera remembers whether the user has moved it since the last fit (pan, wheel zoom, Follow, or a programmatic move by a user action). A fresh view and compare entry count as fitted.
  - When the canvas size changes:
    - **untouched since the last fit:** the camera refits to the current insets (single or compare);
    - **moved by the user:** the camera keeps its world centre and zoom (no jump).
- **Panel layout without overlaps.** Panels and side labels never overlap one another at 1280×800, 1280×720, 1024×768, 900×800 and 768×800. This holds in every state: single, road selected, diagnostics open, branch with a road selected, compare, and compare with a road selected. There is no horizontal scroll.
  - Fix this with CSS: placement, stacking, wrapping and compacting at narrow widths.
  - The legend may collapse by default below 1100 px, but its toggle stays reachable.
- **Compare covers no road.** In compare at 1280×800 and 1024×768, no panel and no side label covers a drawn road of either half, including the road panel after selecting a road on either side.
  - This is done by placing panels, not by changing `COMPARE_FIT_INSETS` (pinned).
- **No half-cut labels.** A district label that does not fit entirely inside its half (or the viewport in single view) is hidden (`visibility: hidden`). It is never drawn clipped.
- **Compare frame.** While comparing, the scenario panel shows a neutral frame, not B's dashed `viewing-b` frame (g4).
- **README** states the supported window widths: at least 768 px. Narrower widths are out of scope for v1.

## Specification
**Pinned by frozen tests (do not change)**
- `COMPARE_FIT_INSETS` and its use: `compare.spec.ts` test 11.
- `FIT_INSETS` symmetry and the fitted city centre: the city-003/004 tests.
- The side labels sit in the outer bottom corners: `gold_timeline004.spec.ts`.
- The scenario panel covers no control at 1024×768: `compare.spec.ts` `layout_and_focus_fixes`.
- The legend is visible and expanded at the default size: `look.spec.ts` `legend_explains_symbols`, at the default 1280×800 viewport.

**Definitions**
- *"Untouched since the last fit"*: no pointer drag, no wheel zoom, and no Follow centring since the last `fitInsets`. The app has no keyboard pan. Selecting a road or a vehicle (without Follow) does not count as touching the camera.
- *"Covers a road"*: a sampled point on a link, at t ∈ {0.05, 0.15, …, 0.95}, on its own canvas lies inside the bounding box of a visible panel or side label.
- *"Panels"*: every visible `section.panel` and `.side-label`.
- *"Visible label"*: computed `visibility` is not `hidden`, `display` is not `none`, `opacity` is above 0, and the rect has a non-zero area.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `panels_never_overlap` (e2e) | The five viewports × six states listed under Outputs have no pairwise overlap among visible panels and side labels, and `scrollWidth ≤ innerWidth`. Each state's expected regions are visible (single: controls, timeline, metrics, legend; plus "Selected road", "Diagnostics", "Scenarios", "Comparison" and both side labels where they apply). Every visible panel lies inside the viewport. The legend toggle is visible. Panels are measured after their size has settled. |
| 2 | `compare_panels_cover_no_road` (e2e) | At 1280×800 and 1024×768 in compare, test three cases: no selection, a road selected on A, and a road selected on B (picked on B's canvas). In each case no sampled point of any link on A's canvas (`linkScreenPoint`) or B's canvas (`linkScreenPointB`) lies inside a visible panel or side label. Both halves must actually be sampled. |
| 3 | `resize_refits_an_untouched_view` (e2e) | Single view and compare, never moved by the user, with a road selected (a selection is not a camera move). Resize 1280×800 → 1024×768 → 900×700 → 1280×800. After each step, the camera equals a fresh fit at that size (centre within 1 m, zoom within 0.1 %). Single view is compared against a fresh page load at that size, and compare against leaving and re-entering compare. |
| 4 | `resize_keeps_a_user_camera` (e2e) | After a wheel zoom and a drag pan in single view, resize 1280×800 → 1024×768. `snapshot().camera` keeps `cx` and `cy` within 1 m and `zoom` within 1e-6. The same holds in compare after a pan there. |
| 5 | `labels_never_half_cut` (e2e) | In single view at 768×800, after resizing to 1280×800, in compare at 1280×800, after resizing compare to 1024×768, and after a pan in compare. Every visible label in `.labels` (A) and `.labels-b` (B) lies entirely inside its layer's rectangle, and every hidden label (`visibility: hidden` keeps its box) would have been cut: a label that fits is never hidden. No label is removed from layout (`display: none` or a zero box). |
| 6 | `compare_frame_and_supported_widths` (e2e + static) | B's pattern lives on the heading (`.scenario-label`: dashed border and striped background). Viewing B, it is shown. While comparing, the panel has no `viewing-b` class and the heading is neither dashed nor striped. After leaving compare it shows B's pattern again. README states a minimum supported width of 768 px. |

## Must NOT
- Change `COMPARE_FIT_INSETS` or `FIT_INSETS`, or edit frozen tests.
- Refit a camera the user has moved.
- Hide panels' controls at supported widths: everything stays reachable.

## Must DO
- Add regression coverage only in new files.
- Keep the a11y suite (polish-001) green: focus rings and the tab tour at the new layouts.
- Update CONTEXT after the ward.

## Manual Smoke Test
### Setup
`pnpm -C web build:wasm && pnpm -C web dev` (any port except 4243).
### Steps
1. At 1280×800, branch, select a road and compare. Nothing overlaps, no road is hidden, and no label is cut.
2. Drag the window narrower, to 1024, then 900, then 768. The panels rearrange without overlapping, and the city refits.
3. Zoom and pan, then resize. The view stays where you put it.
4. Compare at 1024: labels at the halves' edges are hidden, never cut.
### Pass criteria
- [ ] No overlaps or horizontal scroll at the supported widths.
- [ ] Refit only when untouched.
- [ ] In compare, no covered roads and no cut labels.
