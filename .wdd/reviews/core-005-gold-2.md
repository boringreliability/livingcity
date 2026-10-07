# core-005 Gold review 2

Reviewer: Gold adversarial reviewer (fresh subagent, Claude Opus 5.5), 2026-10-07. Reviewed fix commit `75c197d` (diff vs `9749039`).
Verdict: **APPROVED**

Reason: both round-1 MAJORs are fixed. I verified the fixes in rendered pixels at fit zoom, at DPR 1 and DPR 2, and in grayscale. Every gate is green. No BLOCKER or MAJOR regression was found. The new findings below are MINOR and do not block.

## Tampering check
`git diff --stat 11f94f7 HEAD -- web/tests web/e2e crates/sim-core/tests` shows **only two new files**: `web/e2e/gold5.spec.ts` (+98) and `web/tests/gold5.test.ts` (+23). No approved Red test was modified. OK.

## Commands + results
| Command | Result |
|---|---|
| `cargo test --workspace` | OK: 20 + 24 + 36 + 5 passed, 0 failed |
| `cargo clippy --all-targets -- -D warnings` (crates/sim-core) | exit 0 |
| `pnpm -C web test` | OK: 10 files, 45 tests |
| `pnpm -C web build` (tsc --noEmit + vite build) | OK |
| `pnpm -C web e2e` | OK: 17/17 (51.5 s), including the 3 new gold5 tests |
| Throwaway probes `web/e2e/zz_gold2_probe.spec.ts` (3 variants, deleted afterwards; `git status` clean) | screenshots in `.playwright-mcp/g2-*.png` (gitignored) |

## MAJOR-1 (r1): selected road invisible at fit zoom: **FIXED**
The north bridge link 52 was selected while paused at fit zoom, with the pointer moved away. I read a pixel column across the road (luminance):
- DPR 1 before: `41 | 77 68 68 97 68 77 | 41`. After: `41 | 95 255 255 255 68 68 255 255 255 95 | 41`. That is a **3 px white halo on each side**, and white (≥ 245) pixels in the 120×60 crop rose from 0 to 566.
- DPR 2 (device px): a halo 6 device px wide (= 3 CSS px) on each side, with white pixels rising from 0 to 2072.
- Hover (south bridge): a halo of luminance **184** (2 px; 4 device px at DPR 2), with 0 white pixels. Hover and selection therefore differ by lightness, not hue. ✔
- **Closed + selected** (central bridge 50): the black/yellow hatch is intact inside, with a white halo outside. Column: `… 223 255 255 191 | 13 13 13 13 13 | 191 191 191 255 255 255 …`. ✔ Glyphs and vehicles are still drawn on top of the halo (draw order `renderer.ts:451-475`).
- In the full-frame screenshot (`g2-d1-full-sel.png`) the selected bridge can be found at a glance.

## MAJOR-2 (r1): queued vs moving the same shape: **FIXED**
I closed the main bridge and both south-bridge links, ran 25 s at 60× (23 queued, 325 active), paused, and ran connected-component analysis on the screenshot (UI panels masked):
- DPR 1: moving vehicles are **4–5 × 1–2 px** (elongated; the most common components are (4,1), (4,2) and (5,2)). Queued vehicles are **3 × 3 px** (8 of 17; the rest are merged queue neighbours such as (6,3)).
- DPR 2: moving vehicles are **9–10 × 3–4 device px**; queued vehicles are **6 × 6**.
- Brake band: **1 px** along the length at DPR 1 and **2 device px** at DPR 2 (`v_band = max(0.22, 1.25/(size.x·pxPerM))`, `renderer.ts:137`). Measured as ≥ 1 rendered px. ✔
- Grayscale 8× crops (`g2-d1-veh-gray-big.png`, `g2-d2-veh-gray-big.png`): moving vehicles read as long, thin white dashes (L ≈ 228). A queue reads as a "picket" of square mid-grey blocks (L ≈ 176), each separated by its dark brake band (L ≈ 30), and wider than the road. The two can be told apart without colour. ✔

## Regression checks
- **Pass-1 clip trick** (`renderer.ts:60-63`): every vertex of a non-highlighted link is sent to (2,2,2,1), so z > w and the whole triangle is clipped. All vertices of a quad share a link, so no stray triangles appear. Pixel checks found no artefacts anywhere in the full frames. ✔
- **Lane separators with the rescaled `v_across`**: in pass 0 `hw == core`, so the value is unchanged. In pass 1 the core still spans `v_across ∈ [-1, 1]`, so `lanePos` is identical. ✔
- **StrictMode dispose → remount**: e2e runs the vite dev server with `<StrictMode>`, and all 17 tests pass with a working second mount. `gl.getError()` was 0 and `isContextLost()` false after load and after DPR changes. The cleanup order (sim effect disposes A → remount creates B → the resize effect resizes B) is correct. ✔
- **DPR listener** (`App.tsx:139-154`): CDP `setDeviceMetricsOverride` changes `devicePixelRatio` but does **not** update `resolution` media queries in headless Chromium (measured: `matchMedia('(resolution: 3dppx)').matches == false` while `devicePixelRatio == 3`). Because of that, I checked the handler path itself. I captured the app's listeners via an init script, then changed the DPR and fired them. Results: 1→2 gives a canvas of **2560×1600**, 2→1 gives 1280×800, and 1→1.5 gives 1920×1200. After each change exactly one listener is live, re-armed on the new DPR. The listener left over from the StrictMode first mount is removed. ✔
- **Uniform caching**: all locations are fetched once per program. The glyph pass reuses the solid program and the cached `u_color`. The only remaining `getUniformLocation` call is in the `uniforms()` helper. ✔
- **Space repeat**: `e.repeat` is ignored (new e2e M6 passes). ✔

## Findings

### MINOR (new)
1. **The halo of a selected or hovered open link hides the closure hatch of its closed partner direction.** At fit zoom the opposite-direction pair overlaps, and pass 1 paints the 3 px halo over it. Evidence: I closed only link 52 (north bridge, one direction) and selected its open partner 53. Hatch-yellow pixels in a 120×60 crop fell from **280 to 46** at DPR 1 and from **1118 to 371** at DPR 2 (`g2-d1-ow-sel-big.png`). Only a thin striped sliver remains. Moving vehicles on the partner sit as L 228 on a halo of L 255, which is low contrast. This happens only while the user selects or hovers that road, and both-direction closures such as the main-bridge demo are unaffected, so the finding is not blocking. Fix: draw the halo underneath (a halo-only pass *before* pass 0, so other roads, and above all closed ones, stay on top), or redraw closed links after pass 1.
2. **The G2 regression test checks only exported constants** (`web/tests/gold5.test.ts:7-18`). If the shader stopped using `QUEUED_MIN_PX`/`MOVING_MIN_PX` (`renderer.ts:136`) or `v_band`, nothing would fail. G1 has a real pixel e2e test; G2 has none. Fix: add an e2e at fit zoom that checks the aspect of queued vs moving components (as above), or assert on the generated `VEH_VS` source.
3. **`B` auto-repeat is not guarded** (`App.tsx:193`). Holding B toggles the main bridge on every repeat. Round-1 MINOR-6 asked for this for "Space/B"; only Space was fixed. Fix: `if (e.repeat) return;` for B too.
4. **The `v_core` varying is written but never read** (`renderer.ts:55,71,82`). This is dead code; remove it.

### Round-1 MINOR status
| r1 | Status |
|---|---|
| 1 DPR change not tracked | **Fixed** (handler path verified, see above) |
| 2 GPU leaks / no dispose | **Fixed** (`deleteMesh` deletes VAO + buffer, `setNetwork` frees old meshes, `dispose()` called from effect cleanup) |
| 3 world-sized barrier glyphs | Remains |
| 4 overlays hide the map (fit ignores panels) | Remains |
| 5 hatch over junctions | Remains (epic `city`) |
| 6 Space auto-repeat | Fixed for Space; B remains (new MINOR-3) |
| 7 full frame pipeline while paused | Remains |
| 8 `FrameMessage.perf` unconsumed | Remains |
| 9 export hygiene (`laneOffset`, `vehiclePosition` duplicate) | Remains |
| 10 no-WebGL2 path: controls silently dead, `renderFrames` counting | Remains (code unchanged) |
| 11 texture width = link count | Remains |
| 12 per-frame `getUniformLocation` / exact-size buffer pool | Uniforms **fixed**; buffer pool remains |
| 13 screen-anchored hatch swims while panning | Remains |

None of the remaining items block. Carry them into the epic-gate known-issues list and epic `city`/polish.
