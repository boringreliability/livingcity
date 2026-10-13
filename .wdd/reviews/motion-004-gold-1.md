# motion-004 Gold review 1

**Verdict: APPROVED (0 BLOCKER, 0 MAJOR, 6 minor)**

Reviewer: fresh adversarial Gold reviewer (subagent), 2026-10-13. Commit reviewed: `85665ab` (diff `20bf500..85665ab`).
Machine load during the runs: 1-min load 5.7 → 20 (shared machine).

## Frozen tests unchanged since Red approval
- `shasum -a 256 web/tests/motion004.test.ts` = `a36e515c…c4f7` ✔ (matches the Red snapshot)
- `shasum -a 256 web/e2e/motion004.spec.ts` = `84bbd08b…6655` ✔
- `git diff 20bf500 85665ab -- web/tests web/e2e` → empty ✔
- No change under `crates/`, `web/src/sim`, `web/src/wasm` (Rust, protocol and frame layout untouched) ✔

## Commands run and results
| Command | Result |
|---|---|
| `pnpm -C web typecheck` | clean |
| `pnpm -C web exec vitest run` | 32 files; **160 passed, 7 skipped** (matches the orchestrator's report) |
| `playwright test` motion004 + frozen set (look, gold5, motion, motion002, inspect, city, city.e2e, review2, layout, guide, compare, fonts, motion003, motion003_gold, gold_polish004): 90 tests | 88 passed, 1 skipped (the pre-existing `test.skip` in motion.spec:90), **1 failed**: motion003 `compare_shows_crossings_since_branch` ("queue pins on A" = 0) at load avg ~20 |
| re-run of `motion003 -g compare_shows_crossings_since_branch --repeat-each=3` | **3/3 passed**. This is a load flake: the assertion concerns sim-side DOM queue pins in compare mode, and none of the files this ward touched is on that path |
| `motion004.spec.ts --repeat-each=3 -g "districts\|followed"` (tests 6 and 8) | **6/6 passed** |

Logs: `scratchpad/gold1/{unit.log,frozen.log,smoke-run*.log}`. I did not run the full e2e suite (~31 min). The frozen set plus motion004 ran in full.

## Manual Smoke Test (performed with Playwright, throwaway spec `web/e2e/zz_gold1_smoke.spec.ts`, deleted afterwards)
Screenshots are in `/private/tmp/claude-502/-Users-Z6DEC-kmddev-livingcity--claude-worktrees-epic-sim-core/e54ac286-31c4-4bad-9122-a1c59df1c97d/scratchpad/gold1/`. Each `X.png` has a luminance-only `X-gray.png` next to it.

1. **Fit zoom** (`s1-fit-gray.png`, zoom 0.150). Arterials and the bridges are wider and lighter than local streets. The river, districts and pads sit visibly behind the roads, and the waterfront columns read as a slightly lighter band beside the river. ✔
2. **Districts in grayscale** at zoom 1.06 and 3.09 (`s2-<kind>-z1-gray.png`, `s2-<kind>-z3-gray.png`):
   - residential: ridge lines ✔
   - workplace: inner court rectangles (very clear) ✔
   - hospital: crosses (very clear) ✔
   - waterfront: two shed lines (recognizable, but the faintest of the four; see m5) ✔
   - The pads are visible as a disc (Old Town), a square (Market Square) and a cross (St. Mary's).
   - Decor never competes with roads.
3. **Queue at zoom 5.28** after closing the Main Bridge for 600 ticks at 20× (`s3-queue-z5-gray.png`). Each queued square has a dark seam, so the 9 cars on link 58 can be counted one by one. Moving cars keep a bright core inside their outline. ✔
4. **Follow** (`?demand=3`, closure, `f1-brackets-z2.5-gray.png`, `f2-route-z0.5.png`, `f2b-route-fit.png`, `f4-route-end-z2.5-gray.png`, `f5-ring-z2.5-gray.png`):
   - Four corner brackets mark the car.
   - The dashed route has a dark casing.
   - The route ends in a square aligned with the last (diagonal) connector.
   - The closure ring (`f5`, `s4-closure-ring-gray.png`) is a round ring and clearly a different shape from the brackets. ✔
   - My route crossed no link with occupancy ≥ 0.2, so I did not see the casing on a congested link myself. Test 8 measures exactly that and passed 4/4 runs.
5. **Legend** (`s5-legend.png`): 5 rows, 702 × 50 px at x = 562. "Closed road (hatch, ring)" with a ring sample, and "Selected / followed (halo, brackets)" with a bracket sample. ✔ for the ring and brackets. **The dashed route is not explained** (m1).
6. **`?city=three_bridges`** (`s6-three-bridges-fit-nolabels-gray.png`): the major E–W corridor is wider than the local streets (14 major / 52 local links). The pads are a disc (west), a square (east) and a cross (south-east). ✔

**Pass criteria.**
- The five §4 points are visible, including in grayscale.
- The frozen set is green: the one failure re-ran green 3/3.
- The render cost is measured and documented.

## Code review
- **Determinism:** no Rust or protocol change. There is no `Math.random` or clock in the decor: the kinds come from the stable `hash01` and the nearest zone, and the riverside columns are computed from the grid. Test 1 checks that two calls give identical arrays.
- **Per-frame work:** all decor (building kinds, the quay and bollards, pad shapes, `roadMajor`) is built in `riverCityDecor` / `genericDecor` / `setNetwork`. Marks are evaluated per pixel in `BUILDING_FS`, with no geometry rebuild. There is one small per-frame allocation (m3).
- **GL resources:** the `quay`, `bollards`, per-kind `outlines` and `buildings` meshes are all in `allMeshes()`, so `setNetwork` and `dispose` both delete them. `buildingProg` is deleted in `dispose`. ✔
- **Compare mode:** `makeBRenderer(g, d)` passes the same `CityDecor` (including `roadMajor`, `buildingKinds`, `quay`), so B gets the new look. ✔
- **Hooks vs picture:**
  - `trackedMarker.radiusPx = 7√2` is the bracket corner vertex.
  - `routeEnd` = `routeEndWorld()` = the end of the last link's drawn centreline, which is where the square is drawn.
  - `closureSigns` uses `GLYPH_OUTER_PX` at the link midpoint.
  - `roadClasses` reads the same `decor.roadMajor` the shader uses.
  - `districtSamples().mark` comes from `DISTRICT_STYLE`. The shader does not read that field (m2).
- **Layering:** decor (water, banks, quay, bollards, parks, buildings with marks, outlines, decks, pads) is drawn before the road passes. The route is drawn after the congestion and halo passes and before the hatch. Only the brackets and the end square sit above the traffic. ✔
- **Hue-only signals:** none. Kinds differ by mark and pad shape, classes by width, and the tracked car and route by shape and dashes.
- **Halo-grey leak fix:** `u_pass == 1 &&` gate in `ROAD_FS`. ✔
- **Regression fix in `styles.css`:** `.side { grid-template-columns: minmax(0, 1fr) }` and 4-px cell padding. gold_polish004, motion003 and motion003_gold are green.
- **Perf:** `docs/performance.md` § City character matches `web/perf-results/motion004-before-after.json`. The file holds 16 interleaved runs (before/after × 2 rounds × 4 scenarios), with draw CPU 0.3/0.4 and 0.7/0.8 ms unchanged. The stress render-interval p95 is 116.8 → 133.3 ms in both rounds, and the doc reports this honestly as one 16.7-ms step under SwiftShader with higher load on the after runs. ✔
- **Docs:** `demo.md` describes the districts, road classes, outline, brackets, cased route and end square. `known-issues.md` and `architecture.md` mark i5 as resolved. ✔ (but see m6)

## Findings

### m1 (minor): the legend does not explain the dashed route or its end square
- **Evidence:** the smoke step 5 says the legend "explains the ring, the brackets and the dashed route". The rows (`Legend.tsx`) mention only the halo and brackets, and the "Selected / followed" SVG shows a halo line plus brackets with no dashes. The legend is 702 px wide against the frozen 703.5-px cap, so there is no room for more text.
- **Why not MAJOR:** the Outputs only pin the two new texts, and `demo.md` explains the route.
- **Fix:** draw the sample line in that row as a white dashed core with a dark casing (as the route is drawn), without changing the text width. Otherwise, list it as a deviation at the epic gate.

### m2 (minor): the mark shape in the shader is hard-wired to the kind index
- **Evidence:** `BUILDING_FS onMark` uses k==0 for ridge, 1 for court, 2 for cross and anything else for quay. `markRects()` (used by the `districtSamples` hook) and the hook's `mark` both read `DISTRICT_STYLE[kind].mark`. If someone changes `DISTRICT_STYLE`, the picture and the hook diverge silently.
- **Fix:** generate the shader branch per kind from `DISTRICT_STYLE[DISTRICT_KINDS[k]].mark`, or add a unit assertion that pins the ordering.

### m3 (minor): a small per-frame allocation
- **Evidence:** `draw()` rebuilds the two uniform arrays every frame with `DISTRICT_KINDS.flatMap(...)`. The spec says "no per-frame JS work beyond today's". The cost is negligible (draw CPU is unchanged), but it is avoidable.
- **Fix:** precompute two `Float32Array`s once, in the constructor or at module level.

### m4 (minor): dead decor
- `DECOR_COLORS.outline` is no longer used by the renderer: building outlines take `DISTRICT_STYLE[kind].outline`. It remains only because test 3 requires the key.
- In River City the bank strip (`BANK_M` = 6 m) is fully overdrawn by the quay strip (`QUAY_M` = 10 m, drawn after it). The bank draw is wasted there; it is still visible in three_bridges.
- **Fix:** document `outline` as the generic building outline, or use it. Skip the bank draw when a quay exists, or narrow the quay to start at the bank's outer edge.

### m5 (minor, observational): the waterfront shed lines are the faintest mark
- **Evidence:** the waterfront mark is only about 9 levels (8-bit) above its fill, and its luminance is 0.2055 against a 0.2065 cap. The lines are recognizable in grayscale at zoom 1 and 3 (`s2-waterfront-z3-gray.png`), but faint.
- The `DECOR_MAX_LUM` bound leaves no headroom to lighten them. A darker waterfront fill (keeping the ≥ 0.03 fill spacing) would increase the mark contrast. No change is required.

### m6 (minor): `docs/known-issues.md` records nothing left open from motion-004
- **Evidence:** the Must DO asks for "i5 resolved; anything left open". Open items include:
  - the stress p95 is one 16.7-ms step higher under SwiftShader (documented only in `performance.md`);
  - m1, the legend has no route sample;
  - at fit zoom with heavy demand, the dashed route is hard to tell from streams of white cars (`f2b-route-fit.png`; this was so before the ward too).
- **Fix:** add a short "motion-004 (open notes)" entry.

## Cleanup
- The throwaway spec is deleted, and `git status` is clean apart from this file.
- No server is left on port 5190, and port 4243 was never touched.
