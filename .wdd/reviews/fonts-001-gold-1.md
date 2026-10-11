# fonts-001 Gold review 1

**Verdict: APPROVED**

Reviewer: a fresh adversarial Gold-gate subagent. HEAD 56d1d7c (public-main), 2026-10-11. Implementation commit 218b3e9; 56d1d7c only touches `.wdd/wards/fonts/ward-001.md`.

## Frozen tests (sha256, verified)
- `6bf1734bbfabde464fdd5aebe5d7e4a5e0bb638480f101e2a72dc720086a1aea  web/tests/fonts001.test.ts` (matches Red r2)
- `bf85687042eb1295ab9c8303a4f29efd5575a10b3ef979dc615dd5f57f0e44ec  web/e2e/fonts.spec.ts` (matches Red r2)
- `git diff 7fbf29b..HEAD --stat`: the only changes under `web/tests`, `web/e2e` and `crates/*/tests` are the two new ward files. `git diff 5bde512..HEAD` touches no test file. No earlier frozen test changed.

## Commands and results
Load (`uptime`): 7.2–8.4 at 23:36, 24.6 at 23:40 (during the e2e subset), 9.7 at 23:43. Shared machine.

| Command | Result |
|---|---|
| `pnpm -C web typecheck` | Clean. |
| `pnpm -C web test` | 27 files, 130 tests passed. |
| `pnpm -C web exec vitest run tests/fonts001.test.ts` | 1 passed (it runs a real `vite build`). |
| `pnpm -C web build` | OK. Font assets in `dist/assets`: 336 KB on disk in total (Inter Variable: 7 subsets as woff2; JetBrains Mono 400: woff2 and woff for 4–5 subsets). At runtime only `inter-latin-wght-normal` (48 KB) and `jetbrains-mono-latin-400-normal` (21 KB) are fetched (unicode-range). JS 301.7 KB, CSS 22 KB. |
| `pnpm -C web exec playwright test e2e/fonts.spec.ts e2e/layout.spec.ts e2e/gold_polish002.spec.ts e2e/look.spec.ts e2e/a11y.spec.ts --reporter=line` (port 5190) | **38 passed (3.1 min)**, no retries. |
| `gh run view 38175241539` | Conclusion success, headSha 218b3e9. Jobs: Rust, Web, E2E (24 min) all green. Deploy skipped because the Cloudflare secrets are not set. The E2E log says "Running 126 tests … 125 passed, 1 skipped". The skipped test is the existing `review1.spec.ts:78` (G4 grayscale). It is unrelated, and it was also skipped in the earlier run. On Ubuntu, the 4 tests that failed in run 38165529333 now pass: `layout.spec.ts › panels_never_overlap` and all 3 runs of `gold_polish002.spec.ts › confirm_replace_and_wide_controls_never_overlap`. All 5 `fonts.spec.ts` tests also pass there. |

## Smoke test and probes (my own Playwright scripts in the scratchpad; Chromium with SwiftShader)
**COEP.** I served the production build `web/dist` with a tiny static server on 127.0.0.1:5291 that sets `_headers`: COOP same-origin, COEP require-corp and nosniff. Port 4243 was not touched.

1. **1280×800, production build under COEP.**
   - `crossOriginIsolated` is true.
   - Loaded faces are `Inter Variable` (latin) and `JetBrains Mono` 400 (latin). The computed font of the sim-time value and `.mono` is `"JetBrains Mono", …`.
   - There are 0 foreign requests and 0 failed requests.
   - Placement: beside, gap 26 px, no overlap.
   - The screenshot shows Inter in the panels and map labels, and JetBrains Mono in the clock and timeline labels.
2. **Resize 1600 → 1024 → 1600 in 4 px steps.**
   - Going down, the legend stacks at 1264 (gap 10 < 12). Going up, it unstacks once the gap is ≥ 24. There are exactly 2 class flips in total and no overlap at any step.
   - Jiggling ±2 px around the border for 20 resizes gave 0 flips.
   - Idling 3 s at border+4 with the sim running gave 0 flips. No oscillation loop: both panels keep their horizontal anchors, so stacking does not change the gap.
   - An extra trace showed that some recorded "late unstack" widths came from delayed rendering steps under load: resize events and ResizeObserver callbacks were deferred until a frame ran. After the deferred resize event, the class was correct. This is not an app bug.
3. **Narrow widths (<960 px).**
   - At 959, 900 and 768, the legend is always stacked (legend bottom 662, metrics top 665), with no overlap.
   - With `letter-spacing: 0.12em` on `section.panel` at 1280, 959, 900 and 768, the legend is stacked with no overlap.
4. **Collapse and expand at 1100.**
   - Stacked → collapse: the collapsed legend fits, so it moves beside (gap 463).
   - Expand: the legend ends up stacked with no overlap. See m1 for the frame in between.
5. **Compare mode and remount.**
   - Pause, step back, close the bridge (branch B), then Compare. The legend is absent from the DOM during compare.
   - I resized to 1100 during compare, then exited compare: the legend is immediately stacked (the layout effect re-measures on remount).
   - At 1600 it is beside. With 0.35em injected it stacks, and once the style is removed it is beside again. So the ResizeObserver is attached to the **new** elements after the remount, and no stale references remain.
6. **Fonts blocked** (both `.woff2` and `.woff` aborted, which is stricter than test 5).
   - No bundled face loads, and the system fallback renders.
   - 1280: beside, gap 25, no overlap. 1600: beside. 1024 and 900: stacked, no overlap.
   - The screenshot looks clean.
7. **Colourblind constraint.** The legend symbols and text are unchanged (pattern, thickness and shape). No colour was introduced.

## Code review
- `App.tsx:519-542`:
  - `useLayoutEffect` keyed on `comparingNow`, which is the only condition that mounts or unmounts `MetricsStrip` and `Legend` (`App.tsx:1302-1303`). No other remount path exists, so the element references cannot go stale.
  - The `live` flag guards the `fonts.ready` promise after cleanup.
  - The cleanup disconnects the ResizeObserver and removes the `resize` listener, which makes it StrictMode-safe.
  - The `resize` listener is needed: the legend is right-anchored, and its position changes without a size change. The ResizeObserver alone would miss that.
  - No per-frame work: `setLegendStacked` with an unchanged value bails out, and the ResizeObserver fires only on real size changes.
- `bottomBand.ts`: the 12/24 px hysteresis is correct, and `nextStacked` is used (no orphan).
- `styles.css`:
  - The 1259 px media rule is gone, and nothing references 1259/1260 in `web/src`, `web/e2e`, `docs` or the README.
  - The narrow override (`.legend` 76 / `.legend.stacked` 138) keeps the old <960 position for the stacked state. It also gives a sensible beside position if the legend ever fits there.
- `README.md` credits: Inter (Rasmus Andersson) and JetBrains Mono (JetBrains), OFL 1.1, via Fontsource, no CDN. This is accurate.
- `package.json`: both packages are pinned at exactly 5.3.0, and the lockfile has the integrity hashes.

## MAJOR
None.

## MINOR
- **m1. One frame of overlap when expanding a collapsed legend near or below the border** (`App.tsx:526-529`).
  - Scenario: at 1100×800 the legend is stacked. Collapse it, and it moves beside, because a collapsed legend fits. Expand it, and for one animation frame the expanded legend sits beside the metrics and overlaps them. Then the ResizeObserver → `setState` (default priority, committed after paint) moves it up.
  - Measured: 1 of 30 rAF samples overlapped.
  - Cosmetic flicker only. Possible fixes: `flushSync` in `check`, or keep the stacked state while the legend is collapsed.
- **m2. The `fonts.ready` re-check has no failure handling**, but `document.fonts.ready` never rejects in practice, so it is harmless.
- **m3. The ward's Manual Smoke step 1 says "the diagnostics' monospace numbers render in JetBrains Mono".** The Diagnostics panel does not use `.mono`: it renders Inter with tabular figures. JetBrains Mono is used for the sim-time clock, the timeline labels and the comparison sim time. The wording in the spec is inaccurate. The implementation matches the Outputs (`.mono` stack).
- **m4. Ship size.** Every Fontsource subset is emitted: 336 KB in `dist/assets`, including JetBrains Mono `.woff` duplicates. Only about 69 KB is fetched at runtime. Optional: import only the latin (and latin-ext) subsets.
- **m5. The 1280×800 margin is thin with Inter.** The gap is 26 px against an unstack threshold of 24 px, so coming from a narrower window, 1280 unstacks only by a 2 px margin. Behaviour is correct and clean in both states. Noted for future metric-strip changes.
- **m6. Not verifiable here:** the Must-DO "re-deploy and verify the live page under COEP" happens after Gold. CI's deploy step was skipped because no Cloudflare secrets are set. My COEP check used a local server with identical headers.
