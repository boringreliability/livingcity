---
ward: 4
revision: null
name: "The miniature city look"
epic: "city"
status: "planned"
dependencies: ["city-003"]
layer: "typescript"
estimated_tests: 16
created: "2026-10-07"
completed: null
---
# Ward city-004: The miniature city look

## Scope
Make River City look like a finished small simulation product (CLAUDE.md § Graphics roadmap, the brief's § Visual direction):
- a meandering river with banks;
- bridges that read as bridges;
- subtle building footprints per district;
- district labels with kind icons;
- level of detail, so the network and congestion dominate at wide zoom and individual vehicles at close zoom;
- a small legend that explains the symbols without colour.

It also fixes the renderer MINORs that were left open in core-005. All visual data is render-side and deterministic. Rust is untouched.

## Inputs
- core-005 renderer (`renderer.ts`, `geometry.ts`, `camera.ts`, `decor.ts`), `App.tsx` and overlays.
- city-002: `ReadyMessage.{city, river}`, River City zones and landmarks. city-003: route highlight and tracked ring (kept working).
- Open MINORs (`.wdd/CONTEXT.md` Known Limitations; `.wdd/reviews/core-005-gold-{1,2}.md`).

## Outputs
- **City decor module** `web/src/render/cities/riverCity.ts`, which exports `riverCityDecor(network, landmarks, zones, river) -> CityDecor`, a pure function:
  - `water`: triangles of a meandering river polygon that stays inside the sim corridor;
  - `banks`: thin lighter strips;
  - `parks`;
  - `buildings`: footprint triangles per district kind;
  - `bridgeDecks`: per bridge, wider deck quads with a railing outline;
  - `labels`: `{ text, kind, x, y, minZoom }`;
  - a generic fallback for unknown cities (the corridor river from city-002).
- **Renderer:**
  - draws water → banks → parks → buildings → bridge decks → roads → route/halo → glyphs → vehicles;
  - congestion LOD: below `LOD_OVERVIEW_PX_PER_M`, congested roads gain up to +3 px width and lightness;
  - lane markings and vehicle detail above `LOD_DETAIL_PX_PER_M`;
  - closed-road fixes (below).
- **Camera:** `fitInsets(bounds, insets: { top, right, bottom, left })`, a new function that leaves `fit` unchanged. The app fits River City inside the area not covered by the panels.
- **UI:**
  - district labels as DOM overlay, updated every rAF (not only on frames), with a kind icon (home, briefcase, ✚) and text;
  - a collapsible legend: closed road (hatch + barrier), queued car (square + brake band), moving car (slim), congestion (wider, lighter road), selected or followed (ring/halo);
  - a no-WebGL2 fallback message that names the problem and disables the controls.
- **MINOR fixes:**
  - The closed hatch is drawn in its own pass after all roads, clipped to the closed link's own quad, so it no longer overpaints cross roads at junctions. It is anchored to world space (it moves with the map, period constant in px).
  - Barrier glyphs are sized in px (≥ 3 px thick).
  - The halo of a selected road never covers the hatch of the opposite closed direction (the hatch pass runs after the halo).
  - B ignores key repeat.
  - Remove the `v_core` dead varying and the orphan `laneOffset` export.
  - The link table becomes a 2D texture (width 1024, rows as needed) so large networks never exceed `MAX_TEXTURE_SIZE`.
  - `FrameMessage.perf` stays reserved for city-005.

## Specification
- **Determinism and stability.** Decor is a pure function of the network export plus a fixed render seed (no `Math.random`). The same city gives the same triangles on every load.
- **Geometry rules** (tested):
  - The river polygon lies within `[river.west, river.east]` everywhere, with a minimum width of 60 m.
  - No building or park overlaps the river, a road quad (half width + 4 m clearance) or another building.
  - Buildings stay inside the city bounds.
  - Every bridge deck spans the water at its crossing.
  - Labels never overlap each other at fit zoom.
- **Look** (checked in screenshots by the Gold reviewer):
  - dark background; water clearly distinguishable from land by lightness;
  - buildings subtle: low contrast to the land, outlines only at detail zoom;
  - roads clearly brighter than buildings; no glow;
  - typography: Inter/system UI, labels at 12–13 px, letter-spaced, with a text shadow for legibility over water.
- **Colourblind rules.** Every state on the map has a non-hue cue: closed = hatch + barriers + width; congestion = width + lightness; queued = shape; selection = halo/ring. Grayscale screenshots must keep each distinguishable.
- **Performance.** Decor uses static buffers built once. Draw-call count stays < 20 per frame. Frame time stays within the core-005 envelope (measured in city-005).

## Tests
Vitest in `web/tests/decor.test.ts` and `web/tests/render_fixes.test.ts`. Playwright in `web/e2e/look.spec.ts`.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `decor_is_deterministic` | two calls with the same export give identical arrays. The source contains no `Math.random` |
| 2 | `river_stays_in_corridor` | every water vertex x ∈ [west, east]. The width is ≥ 60 m at 100 sampled y |
| 3 | `every_bridge_spans_water` | each landmark bridge segment intersects the water polygon. No non-bridge road segment does |
| 4 | `buildings_avoid_roads_water_and_each_other` | no building triangle intersects a road quad (half width + 4 m), the water, or another building's footprint. All are inside the bounds |
| 5 | `district_labels_cover_all_zones` | one label per zone with the zone's name and kind icon. At fit zoom no two label boxes overlap (using the test's measured text widths) |
| 6 | `fit_insets_keeps_bounds_clear_of_panels` | `fitInsets` places the bounds fully inside the uncovered rectangle, centred there. `fit` is unchanged (its earlier tests still pass) |
| 7 | `link_texture_is_2d` | 5,000 links map to texel `(i mod 1024, floor(i / 1024))` for each of the 3 rows. The shader-side index math matches the TS helper |
| 8 | `b_key_repeat_ignored` (e2e) | a dispatched `keydown` for B with `repeat: true` does not toggle the bridge |
| 9 | `hatch_does_not_overpaint_cross_roads` (e2e, pixels) | with the Main Bridge closed, a pixel sample on a cross road at the bridge's end junction keeps the normal road luminance (no hatch stripes) |
| 10 | `hatch_moves_with_the_map` (e2e, pixels) | after panning by 37 px, the hatch pattern in a clip that moved with the map is identical (± 2 per pixel) to before |
| 11 | `barriers_visible_at_fit_zoom` (e2e, pixels) | barrier glyph pixels are ≥ 3 px thick at fit zoom (white run length across the bar) |
| 12 | `selected_halo_keeps_opposite_hatch` (e2e, pixels) | with one direction closed and the other selected, the hatch pixel count in the clip is ≥ 90 % of the unselected count |
| 13 | `labels_follow_camera_while_paused` (e2e) | while paused, after a drag, every district label moves by the drag delta (± 1 px) within one rAF |
| 14 | `congestion_reads_in_grayscale` (e2e, pixels) | after closing the Main Bridge (20×, 6 sim min), a congested Old Bridge approach is wider and lighter in a grayscale clip than the same road before the closure |
| 15 | `legend_explains_symbols` (e2e) | the legend is reachable by keyboard and lists closed road, queued car, moving car, congestion and selection with drawn samples. Collapsing it keeps it collapsed after a reload (try/catch around localStorage) |
| 16 | `no_webgl2_fallback` (e2e) | with `getContext('webgl2')` stubbed to null, a readable message is shown and the controls are disabled (not silent) |

## Must NOT
- Visual data in Rust, `Math.random` in decor, gratuitous glow, charts with invented data.
- Hue as the only signal for any state.
- Edit approved earlier tests. `fit` keeps its signature and behaviour.

## Must DO
- Every earlier e2e test stays green unchanged, and the route highlight and ring from city-003 keep working.
- Take screenshots at fit zoom and at detail zoom (≥ 3 px/m), in colour and grayscale, and save them in `.playwright-mcp/` for the epic gate.

## Manual Smoke Test
### Setup
```
pnpm -C web build:wasm && pnpm -C web dev
```
### Steps
1. Open the app.
   Verify: a meandering river with banks; three bridges as decks with railings; buildings per district; labels with icons; panels not covering the city.
2. Zoom into a junction.
   Verify: lane markings appear; vehicles are readable with brake bands; buildings show outlines.
3. Close the main bridge, wait 5 sim min at 20×.
   Verify:
   - hatch + barriers clearly visible, with no hatch on cross roads;
   - the congested approaches are wider and lighter;
   - the grayscale screenshot keeps every state distinguishable.
### Pass criteria
- [ ] All suites green, clippy clean, build OK
- [ ] Screenshots (colour + grayscale, fit + detail) look like a finished miniature city, judged by the Gold reviewer against § Visual direction

## Verification
The Gold reviewer inspects screenshots (colour and grayscale) at both zoom levels, runs all suites, and checks draw calls/frame time are not worse than core-005 by more than 25 %.
