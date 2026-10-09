# polish-002 Gold review, round 3

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 5 MINOR)

Reviewer: a fresh Gold-gate subagent. I reviewed only the artifacts: the ward spec, the frozen test, the round 1 and 2 reviews, `git diff 584c830..HEAD` / `HEAD~1..HEAD`, and the running app.

## What I ran
- **Frozen test:** `shasum -a 256 web/e2e/layout.spec.ts` gives `d62394ae26aab425bfc88e2f09d417d140bbfa6619f339c8e2b9da7ec6e0cad8`, which matches. In `584c830..HEAD` the only test file touched is the non-frozen `web/e2e/gold_polish002.spec.ts`.
- **Typecheck:** `pnpm -C web typecheck` exits 0.
- **Unit tests:** `pnpm -C web test` gives **111 passed**.
- **e2e:** `pnpm -C web e2e` gives **99 passed, 1 skipped** (the existing G4 skip) in 14.8 min. That includes all 6 `layout.spec.ts` tests, all 11 `gold_polish002.spec.ts` tests, and the a11y suite.
- **Manual smoke test and probes:**
  - Dev server `vite --port 5299 --strictPort`, stopped afterwards. Port 4243 was not touched.
  - Playwright MCP, Chromium.
  - The in-page probe checks pairwise overlap among **all** visible `.panel` elements and `.side-label` elements, not just `section.panel`. It also checks off-screen panels, `scrollWidth` and cut labels.
  - Screenshots are in the scratchpad `gold-p002-r3/`.
  - No probe was copied into `web/e2e`, and `git status` is clean apart from this file.

## Round-2 findings: status
| R2 | Status |
|---|---|
| MAJOR 1: error banner overlapping, sticky and blocking controls | **Resolved.** The banner is a `.top-band` grid item (centre column, row 3 at ≥ 960; in the single column at ≤ 959). A refused compare (branch, view A, step back before the branch, Compare) gives **0 overlaps** with the broad `.panel` selector at 1280×800, 1280×720, 1024×768, 960, 959, 900 and 768. The banner spans 369–997 × 132–184 at 1280 and 16–342 × 244–314 at 768. It has a Dismiss button, and the next action (seek, view, compare, discard, intervene) clears it. |
| m2: remount and focus jump at 959/960 | **Resolved.** There is one grid in a fixed DOM order, and the `narrow` state is gone. The regression test checks that the same Cancel element keeps focus across 1024 → 900 → 1024 → 768. The tab order is now identical at 1280 and 768: Play, Speed, Diagnostics, bridge, A, B, Compare, Discard, Legend, then the timeline. |
| m3: timeline track from 960 to about 1100 | Unchanged: the track is 111 px at 960 and 175 px at 1024. See MINOR 4. |
| m4: stress readout wrapping | Not re-examined. Cosmetic. |
| m5: 0 px gap at 768 between the left stack and the legend | Unchanged: with `?demand=6`, confirm open and diagnostics open, Diagnostics ends at 612 and the legend starts at 612. Still no overlap. See MINOR 4. |
| m6: r1 m3 and r1 m7 | Unchanged. See MINOR 4. |

## Smoke-test log (the ward's Manual Smoke Test)
1. **1280×800: branch, select a road (link 5 via `linkScreenPoint`), then compare.**
   - 0 overlaps, `scrollWidth` 1280, 0 cut labels.
   - The labels at the halves' edges are hidden: Southfield, Eastgate and Eastgate Fields on both sides.
   - The frame reads "Comparing A and B" with a neutral border.
   - **PASS**
2. **Resize the compare view through 1024×768, 960, 900, 768 and back to 1280×720.**
   - 0 overlaps and no horizontal scroll at every step, and 0 cut labels.
   - The camera refits each time: `cy` −485 → −634 → −684 → −738 → −889 → −486.
   - **PASS**
3. **Zoom and pan, then resize.**
   - Covered by the frozen `resize_keeps_a_user_camera` (green).
   - A drag that starts in an empty grid cell of the top band (600,80) pans the camera: `cx` 70 → −598.
   - **PASS**
4. **Compare at 1024:** Hillside, Southfield, Eastgate and Eastgate Fields are hidden near the edges, and none is cut. **PASS**

**Pass criteria**
- No overlaps or horizontal scroll at the supported widths: **PASS**.
- Refit only when untouched: **PASS**.
- In compare, no covered roads and no cut labels: **PASS**. The roads are covered by the frozen test 2; the labels I checked by probe.

### Regression probes
- **Empty grid cells:** `elementFromPoint` at (200,300), (600,60), (900,120), (600,200) and (200,180) at 1280 returns `CANVAS.city`. The band uses `pointer-events: none` and its panels use `auto`. OK.
- **No WebGL2** (with `getContext('webgl2')` stubbed to return null):
  - The alert shows "WebGL2 is not available…" with no Dismiss button, and the controls are disabled.
  - At 1280 the alert sits in the centre column (492–874 × 132–170). At 768 it sits below the controls (16–342 × 124–178).
  - "Starting the city…" is not shown. No overlap. OK.
- **The tallest left column at 768** (`?demand=6`, the full "Behind" text injected, Scenarios + Confirm + Diagnostics, or Scenarios + error + Diagnostics): 0 overlaps.
  - Confirm and the error cannot be open together, because Compare/View/Seek drop the confirmation through `forgetPosition`.
- **Error clearing:** see MINOR 2.
- **Label hiding and refit:** OK (smoke test steps 1, 2 and 4).

## Findings

### 1. MINOR: the new error-banner regression test does not measure the banner
`web/e2e/gold_polish002.spec.ts:49` selects only `section.panel, .side-label`, but the banner is a `div.panel.error` (`App.tsx:1005`). So the assertion `'with the error banner'` at line 131 passes regardless of where the banner sits. My probe with the broad `.panel` selector confirms there are 0 overlaps, so the implementation is correct and only the regression test is weak.
- **Fix:** include `.panel.error` (or `[role=alert].panel`) in `overlaps()`.

### 2. MINOR: fatal errors are now dismissible and cleared by the next action
`App.tsx:549, 568, 902, 909, 916` call `setError(null)` on every seek, view, compare, discard and intervene, and `App.tsx:1008` offers Dismiss for every error that is not a missing-WebGL2 error.
- That also hides `simulation halted: …` (`host.ts:626`), `worker error: …` (`client.ts:43`) and `init failed: …` (`host.ts:168`).
- After a halt, clicking "A: original" or Dismiss leaves a frozen city with no explanation. A later seek then reports the misleading "seek before the city is ready" (`host.ts:347`).
- None of these errors is reachable in normal use (they need a wasm panic or a worker crash), so this is MINOR.
- **Fix:** keep a separate `fatal` state for halted, worker and init errors. Do not clear it on user actions and do not offer Dismiss for it, as with `noGl`.

### 3. MINOR (nit): `.error { max-width: 420px }` has no effect
`styles.css:404` is overridden by `.top-band > .panel { max-width: 100% }`, which has higher specificity. The banner is 628 px wide at 1280.
- **Fix:** use `.top-band > .error { max-width: 420px }` if 420 px was intended.

### 4. MINOR (carried over, list under Known issues)
- r2 m3: the timeline track is 111 px at 960 and 175 px at 1024.
- r2 m5: 0 px gap between Diagnostics and the legend at 768 with `?demand=6`, confirm open and diagnostics open.
- r1 m3: the road panel at 1280×720 in compare.
- r1 m7: the unused `compare-view` class.

### 5. MINOR (nit): mis-indented `setError(null);`
At `App.tsx:902, 909, 916` the `setError(null);` lines are indented one level less than the statements around them. Run the formatter.

## What is good
- One `.top-band` grid in a fixed DOM order fixes the error overlap, the remount and focus loss, and the width-dependent tab order in one mechanism.
- The grid stacks any panel height, so new banners cannot collide.
- Clearing a stale refusal on the next action is the right behaviour for host refusals.
- All frozen tests and the a11y suite are green.
