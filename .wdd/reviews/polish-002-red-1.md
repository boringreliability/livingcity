# polish-002 Red review #1

**Verdict: REJECTED**

Reviewed file: `web/e2e/layout.spec.ts` at HEAD `50f9545`,
sha256 `04a6ba56a1ce76048c1d785946700ad2212e2563065311c404387871c0ec8a31`.

## What I ran
- `pnpm -C web exec playwright test e2e/layout.spec.ts` gave 5 failed and 1 passed (51 s). The results match the stated red state:
  1. fails at `1280×800 branch + road selected`;
  2. fails at `1280×800 compare, road selected on A` with 14 covered points (the "no selection" case already passes);
  3. fails at `single 900×700` with 12 A midpoints outside;
  4. passes;
  5. fails at `single 768×800` with Eastgate and Eastgate Fields cut;
  6. fails because `viewing-b` is still present while comparing.
- Probe `scratchpad/red-p002/probe1.spec.ts`, copied temporarily into `web/e2e/` and then deleted, measured road sample extents, panel rects and the camera in single and compare views at 1280×800 and 1024×768, with and without a road selected on B.
- Probe `scratchpad/red-p002/probe2.spec.ts`, also run temporarily and deleted, measured panel rects and label inside/cut counts at 768×800, 900×800 and 1280×720 in the states single, diagnostics, branch with a road selected, compare, and compare with a road selected.

## Feasibility (achievable with the pinned insets)
- **Test 2 at 1024×768 (compare).**
  - Road samples span x 16–496 and 528–1008, and y 183–475.
  - The road panel is 240×190 in compare. The free bottom-left area is x 16–307 × y 475–695, or the mirror area on the right, so a 240×190 panel fits.
- **Test 2 at 1280×800.**
  - Roads span y 160–530.
  - The free area is x ≈ 100–435 × y 534–754, which fits the panel. The test is achievable.
- **Test 3, the ≥ 60 % span after a real fit.** World extent ≈ 6138 × 3733 m. The fitted spans are:
  - single 1024×768: 85 % width / 69 % height;
  - single 900×700: 84 % width;
  - compare 1024: 94 % width;
  - compare 900×700: 93 % width.
- **Test 1 at 768×800.**
  - The top band needs stacking: controls 326 + scenarios 314 + road panel 240 > 736 px.
  - About 680 px of height is free above the metrics strip, so stacking works. The legend may collapse.
- **Test 5.** 17–22 of the 22 labels fit fully in every measured configuration, so the minimum of ≥ 5 visible labels at 1280 is safe.
- **Frozen specs.** I found no conflict with the frozen specs (`COMPARE_FIT_INSETS`, side-label corners, `look.spec` legend at 1280×800).

## Findings

### 1. MAJOR: tests 1 and 2 pass when panels are hidden or pushed off-screen
`layout.spec.ts:79-99`, `:102-125`, `:168-193`, `:196-211`.
- Both helpers drop invisible panels and only check pairwise overlap and *horizontal* scroll. An implementation could pass tests 1 and 2 in three ways:
  - `display: none` on "Selected road" or "Scenarios" in compare and at narrow widths;
  - moving a panel to `left: -999px` (no scrollWidth growth);
  - stacking it below the fold. The page has `overflow: hidden` (`styles.css:18`), so vertical overflow is invisible and is never checked.
- This contradicts the Must NOT "Hide panels' controls at supported widths: everything stays reachable".
- **Fix:**
  - In every state, assert that the panels the state must show are visible: Simulation controls, Replay timeline, Selected road after `selectRoad`, Diagnostics, Scenarios once branched, Comparison in compare.
  - Assert that every visible panel or side label rect lies inside `[0, innerWidth] × [0, innerHeight]`.
  - Below 1100 px, assert that the legend toggle (`button.legend-toggle`) is visible and in the viewport.
  - Add the same visibility and viewport assertion for "Selected road" after each `selectRoad` in test 2.

### 2. MAJOR: test 3's "refit" check cannot tell refit from no refit when the window grows in compare, and only barely in single view
`layout.spec.ts:128-160`, `:218-232`.
- The 60 % span check passes whenever the camera *wasn't* refitted after growing.
- **Compare.** The camera fitted at 900×700 has zoom ≈ 0.0681 (width-limited, 418 px per 450 px half). Kept at 1280×800, it spans 418/640 = **65 %**, so the last compare step passes without any refit.
- **Single view.**
  - The 900×700 fit has zoom ≈ 0.1232. Kept at 1280×800, it spans 59.1 % width / 57.5 % height, so the check fails by only 0.9 pp.
  - The 1024 step passes unrefitted: span 90 %, all midpoints inside.
  - Only the 900×700 *shrink* step really discriminates.
- An implementation that refits only when the city no longer fits ("clamp in") would pass the compare half.
- **Fix:** after each resize to size S, compare `snapshot().camera` with the camera of a fresh fit at S, within 1e-6 zoom and 1 m. Either:
  - reload at S and read the camera (single view, or after entering compare);
  - or compute the expected fit from `g.bounds` and the pinned `FIT_INSETS` / `COMPARE_FIT_INSETS` imported from `src/render/layout`.
- A weaker alternative: require span ≥ 0.97 of the inset rectangle on the limiting axis rather than 0.6 of the canvas.

### 3. MAJOR: the "untouched" definition is only half tested
`layout.spec.ts:214-279`.
- The spec says explicitly: "Selecting a road or a vehicle (without Follow) does not count as touching the camera". No test clicks before resizing in test 3. The naive implementation marks the camera as touched on every `pointerdown` (a click is a pointerdown without movement), and it passes every test while breaking this rule.
- Follow (spec: counts as touching) is not covered either.
- **Fix:**
  - In test 3, before the single-view resizes, select a road with `selectRoad(page, 'A')` and keep it selected. The view must still refit.
  - Optionally, in test 4, start Follow on a vehicle and check that a resize does not snap to the fitted camera.
- Note: the spec's "keyboard pan or zoom" does not exist in the app (`App.tsx` has no camera keys), so no test is needed for it. Reword the spec or ignore it.

### 4. MAJOR: test 5's visible-label minimums are too weak for "hidden only where they would be cut"
`layout.spec.ts:284-320`.
- The minimums are 1 at single 768×800, 5 at compare 1280×800 and 1 at compare 1024×768.
- Measured: 20 of 22, about 19 of 22 and about 17 of 22 labels fit entirely. An implementation that hides 21 of 22 labels at 768 and 1024 passes, and so does one that hides 14 at 1280. That contradicts the Output ("a label that does not fit … is hidden") and the table ("not all of them").
- **Fix:** the spec requires `visibility: hidden`, which keeps the layout rect. So assert both directions for every `.zone`:
  - visible ⇒ fully inside its layer;
  - hidden ⇒ its rect is *not* fully inside its layer (it would have been cut).
- This makes the minimum counts redundant. Keep ≥ 5 at 1280 as a sanity floor.

### 5. MAJOR: test 6's "no dashed frame" assertion targets an element that is never dashed
`layout.spec.ts:331`.
- The test reads `getComputedStyle(section.scenarios).borderTopStyle`. The panel's own border is always `1px solid` (`.panel`, `styles.css:41`). B's dashed frame and stripes are on the child `.scenario-label` (`styles.css:479-482`), so this assertion is tautological.
- If an implementation drops the class but adds, for example, `.comparing .scenario-label { border-style: dashed }`, it still passes.
- **Fix:** while comparing, assert that `.scenarios .scenario-label` (and the panel) have a computed `borderTopStyle` other than `dashed` and `backgroundImage === 'none'`. After leaving compare while viewing B, assert that the label is dashed again, so the check is not vacuous.

### 6. MINOR: the road panel grows asynchronously, so the overlap check can be read too early
`layout.spec.ts:72-75`, `:177-178`, `:185-186`.
- In single view, the road panel is 190 px at selection and grows to 262 px when `linkDetail` arrives (probe2: 262 at 768/900/1280 after 300 ms).
- `selectRoad` waits only 200 ms, so an overlap caused by the grown panel can be missed, and the result can vary between runs.
- **Fix:** poll until the "Selected road" rect height is stable across two reads, or wait for the detail rows, before `check(...)`.

### 7. MINOR: labels are only checked after a fresh load
`layout.spec.ts:308-320`.
- Every case uses `setViewportSize` followed by `ready()`, which reloads the page. An implementation that decides visibility only at mount, and not on camera or resize changes, passes.
- **Fix:** add one step that resizes compare 1280→1024 *without reload* and runs `cut(...)` again, and optionally one after a drag pan.

### 8. MINOR: an empty road sample passes vacuously
`layout.spec.ts:102-125`.
- If `linkScreenPoint` or `linkScreenPointB` returns `null`, for example because of a hook regression in compare, `coveredRoads` returns `[]` and the check passes.
- **Fix:** also return the number of sampled points per side and assert that it is above 0 on both sides in compare.

### 9. MINOR: scope and spec gaps
- `.wdd/wards/polish/ward-002.md` lists backlog b6 (the comparison panel is wider than its table), but no Output or test covers it. Either drop b6 from the ward or add an Output for it.
- The state matrix has no vehicle panel or Follow state, which can stack with the road panel in `.side`. It also has no "Confirm replacing the branch" panel. These are acceptable as spec scope, but mention them under Known issues if they are left out.

## Summary
The tests are achievable and do not conflict with the frozen specs. Five gaps let a wrong implementation pass:
1. Panels can be hidden or placed off-screen.
2. Refit is not verified when the window grows in compare.
3. A click to select counting as a camera move is not caught.
4. Labels can be hidden in bulk.
5. The compare frame check reads the wrong element.

Fix findings 1–5, preferably also 6–8, and submit to a new Red review.
