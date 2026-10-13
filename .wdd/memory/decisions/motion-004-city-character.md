# motion-004: city character (2026-10-13)

- **Render side only.** No Rust, protocol or frame change. Everything is static geometry built once per city, plus a few shader instructions. Draw CPU is unchanged; under SwiftShader at stress the render interval's p95 is one step higher (`docs/performance.md` § City character).
- **Kinds by shape first.** Each district kind has its own roof mark (ridge, court, cross, quay) and zone pad shape (disc, square, cross). Lightness comes second: fills are ≥ 0.03 apart and marks are ≥ 0.035 above their fill. Hue is never the only signal, and every decor colour stays ≥ 0.06 below the darkest road. Waterfront means the grid columns next to the river, because a distance rule found no buildings.
- **Marks at a fixed screen width.** One building program draws the fill and, from 1 px/m, the mark per pixel (half width `MARK_LINE_PX / 2 / zoom`), so zooming never rebuilds geometry. `character.ts` holds the mark geometry for both the shader and the hook.
- **Road classes travel with the decor** (`CityDecor.roadMajor`), so the A and B renderers both get them. Majors (arterials and the landmark bridges) are drawn ≥ 5.5 px and lighter than local streets.
- **Traffic marks.**
  - Cars get a dark outline seam from 1.5 px/m, so queues can be counted.
  - The followed car gets corner brackets, which no longer look like the closure ring (i5).
  - The route gets a 2.5-px dark casing and a square at its end.
- **Regression found and fixed:** motion-003's no-wrap crossing headers grew the `.side` grid and pushed the guide out of its column. `gold_polish004` had been red since `c4f4cc5`; motion-003's Gold rounds ran the frozen visual set, not the full suite. Lesson: run the full e2e suite once per ward.
- Gates: Red r1–r3 rejected, escalated to the user, then r4 approved under the convergence rule (one verified test fix, B4-1). Gold r1 approved (0 BLOCKER, 0 MAJOR, 6 minor in `docs/known-issues.md`).
