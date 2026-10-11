---
ward: 1
revision: null
name: "Bundled fonts and a fit-based bottom band"
epic: "fonts"
status: "red"
dependencies: []
layer: "typescript"
estimated_tests: 5
created: "2026-10-11"
completed: null
---
# Ward fonts-001: Bundled fonts and a fit-based bottom band

## Scope
This ward implements contracts F1–F3 of epic `fonts` and is its integration ward. The trigger is the CI finding:
- **The failure.** On Ubuntu, "Simulation metrics × Legend" overlap at 1280×800, failing 4 frozen layout tests.
- **The cause.** The app names `'Inter'` but never ships it.
- **The breakpoint.** 1260 px was calibrated against macOS font widths.

## Inputs
- `web/src/styles.css`:
  - the root `font-family`;
  - `.mono`;
  - the `@media (max-width: 1259px) { .legend { bottom: 112px } }` rule.
- The bottom band panels:
  - the metrics strip (`ui/MetricsStrip.tsx`, region "Simulation metrics");
  - the legend (region "Legend", collapsible).
- The frozen layout tests: `layout.spec.ts` (`layoutProblems`, `coveredRoads`), `gold_polish002.spec.ts`, `look.spec.ts` (legend).
- `.github/workflows/ci.yml` (Ubuntu runner, Playwright Chromium with SwiftShader).
- `web/public/_headers` (COEP `require-corp`).

## Outputs
- **Fonts.**
  - Dependencies: `@fontsource-variable/inter` and `@fontsource/jetbrains-mono`, exact versions 5.3.0, OFL-1.1.
  - Both are imported once from the app entry.
  - The root stack becomes `'Inter Variable', 'Inter', system-ui, …`.
  - `.mono` becomes `'JetBrains Mono', ui-monospace, …`.
  - The woff2 files are emitted into `dist/assets` (same origin).
  - The fonts' licence is named in the README.
- **Fit-based legend placement.** When the expanded legend and the metrics strip would overlap horizontally, the legend sits just above the metrics (class `legend-stacked` or equivalent); otherwise it sits beside them. The placement:
  - is measured;
  - is re-checked on resize and when the fonts finish loading (`document.fonts.ready`);
  - is re-checked when the legend expands or collapses and when the metrics' width changes.
  - The `max-width: 1259px` rule is replaced by it.
- **CI.** A green GitHub Actions run of `.github/workflows/ci.yml` on the ward's final commit.

## Specification
- **Stacked placement.** "Just above" is the existing stacked position (`bottom: 112px`). Stacking happens no matter which font is in use.
- **Hysteresis.** The decision has hysteresis (a few px), so it never flips back and forth at the border.
- **No layout shift during the run.** The measurement reads the panels' boxes, not the window width.
- **Pinned and not to be broken:**
  - all frozen tests, incl. the overlap, viewport and covered-road checks at every pinned size;
  - the legend's collapse toggle;
  - axe a11y.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `fonts_are_bundled` (vitest, static + production build) | `web/package.json` lists both packages at exact versions. The app entry imports them. `styles.css` root stack starts with `'Inter Variable'`, and `.mono` starts with `'JetBrains Mono'`. After `vite build`, `dist/assets` has ≥ 1 woff2 per family, and the built CSS has `@font-face` rules for both families whose `src` URLs are all relative/same-origin (no `http`). README names the fonts and OFL. |
| 2 | `fonts_load_in_the_browser` (e2e) | After ready: `document.fonts.check` is true for `13px "Inter Variable"` and `12px "JetBrains Mono"`. The `FontFace` entries for both families include a `loaded` one. The metrics' text resolves to the bundled family: a rendered sample's width equals the same text in an explicit `"Inter Variable"` span and differs from a `monospace` reference. No request leaves the page's origin. |
| 3 | `legend_stacks_when_it_does_not_fit` (e2e) | Simulates a wide font with an injected style: `section.panel` text `letter-spacing: 0.12em`, which widens the metrics and legend panels. At 1280×800 and 1440×900 (single view): no pairwise panel overlap and nothing outside the viewport. The legend is above the metrics (legend bottom ≤ metrics top + 1). Also checked after a resize from 1600 to 1280 with the style in place. |
| 4 | `legend_beside_when_it_fits` (e2e) | Without the injected style, at 1600×900 the legend shares the bottom band (its bottom within 2 px of the metrics' bottom), with no overlap. At 1024×768 it is stacked. Collapsing the legend at a stacked size, then expanding it, gives the same placement with no overlap. |
| 5 | `fonts_blocked_still_lays_out` (e2e) | Font requests (`**/*.woff2`) aborted. The app falls back to system fonts, and at 1280×800 and 1024×768 `layoutProblems` (own copy of the frozen helper) is `[]`. |

## Must NOT
- Edit frozen tests.
- Load fonts from a third-party origin.
- Change the sim or any metric.

## Must DO
- Run every suite locally and on GitHub Actions. Log the load locally.
- Re-deploy (`wrangler pages deploy`) after Gold approval. Verify the live page loads the fonts under COEP.

## Manual Smoke Test
### Setup
`pnpm -C web install && pnpm -C web build:wasm && pnpm -C web dev`
### Steps
1. Open the app at 1280×800. The text renders in Inter, and the diagnostics' monospace numbers render in JetBrains Mono. The legend and metrics do not overlap.
2. Resize from 1600 → 1024 → 1600. The legend moves above the metrics and back beside them, without flicker at the border.
3. Block woff2 in DevTools and reload. The layout is still clean.
4. Check that the GitHub Actions run for the final commit is green.
### Pass criteria
- [ ] Same typography on macOS and Linux (CI screenshots or a Linux run).
- [ ] No overlap at any pinned size, with any font.
- [ ] CI green.
