---
epic: "fonts"
name: "Portable typography"
status: "active"
created: "2026-10-11"
---
# Epic: Portable typography

## Goal
The app looks and lays out the same on every operating system. The brief asks for "good typography" and a finished product. The stylesheet has always named `'Inter'`, but no font was ever shipped, so each OS falls back to its own system font:
- macOS uses San Francisco and SF Mono;
- Linux typically uses DejaVu Sans and DejaVu Sans Mono, which are noticeably wider.

## Why now (found by CI)
The first GitHub Actions run (Ubuntu, run 38165529333, 2026-10-11) passed 116 e2e tests. It failed 4 frozen layout tests, all with the same overlap at 1280×800 in single view: **"Simulation metrics × Legend"**:
- `layout.spec.ts` `panels_never_overlap`;
- `gold_polish002.spec.ts` × 3.

The legend shares the bottom band with the metrics only at ≥ 1260 px (`styles.css` `@media (max-width: 1259px)`). That breakpoint was calibrated against macOS font widths in polish-002. With wider fonts the two panels overlap, so Linux users of the live demo see the same fault.

## Contract
- **F1, bundled fonts.** The UI font (Inter) and a monospace font are shipped with the app as same-origin files. They are licensed OFL-1.1 (Fontsource packages) and bundled by Vite, with no CDN, so COEP `require-corp` blocks nothing. The root font stack and `.mono` name the bundled families first. Every OS renders the same glyphs, unless the fonts fail to load.
- **F2, fit-based bottom band.** The legend sits beside the metrics only when they actually fit (measured), not by a fixed pixel breakpoint. Otherwise it sits just above the metrics, as it does today below 1260 px. This holds for any font, also a wider fallback when the font files are blocked.
- **F3, CI green on Linux.** The whole suite, frozen tests included, passes on the GitHub Actions Ubuntu runner. It still passes locally (macOS).

## Out of scope
- New visuals, font sizes or a redesign.
- Any change to the sim.
- Frozen tests are never edited.

## Wards
| Ward | Content |
|---|---|
| fonts-001 | complete |

## Completion criteria
- All suites green locally and on GitHub Actions (the CI run is linked in the Gold review).
- The live deploy shows the bundled fonts.
- Human epic gate.
