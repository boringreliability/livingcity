---
ward: 4
revision: null
name: "The miniature city look"
epic: "city"
status: "approved"
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
- **City decor** (pure, deterministic, render side only)
  - `web/src/render/cities/riverCity.ts` exports `riverCityDecor(network: NetworkArrays, geometry: RoadGeometry, landmarks: Landmarks, zones: ZoneInfo[], river: [number, number]) -> CityDecor`.
  - `web/src/render/cities/index.ts` exports `cityDecor(ready: ReadyMessage, geometry: RoadGeometry) -> CityDecor`. It picks River City by `ready.city` and otherwise uses a generic fallback: the straight corridor river and zone pads, with no buildings.
  - `CityDecor` fields:
    - `water`, `banks`, `parks`, `buildings`, `bridgeDecks`, `pads`: `Float32Array` triangles (x, y per vertex, world m);
    - `riverProfile: { y, x0, x1 }[]`: the river's west and east edge, sampled at most every 50 m over the city's y range ± 500 m;
    - `buildingBoxes: [x0, y0, x1, y1][]`: each building footprint as an axis-aligned box (the `buildings` triangles are exactly these boxes);
    - `labels: { text, kind, icon, x, y }[]`: one per zone, at the zone's position, with `icon = LABEL_ICONS[kind]`.
  - `LABEL_ICONS = { residential: '⌂', workplace: '◫', hospital: '✚' }`, exported.
- **Layout and camera**
  - `web/src/render/layout.ts` exports `FIT_INSETS` (CSS px): the fitted city starts below the control panel and above the metrics strip. *Gold refinement:* the values are `{ top: 120, right: 24, bottom: 120, left: 24 }`, not the planned 140 / 96. Vertical symmetry keeps the city's centre at the canvas centre; the asymmetric version moved it 22 px down, and the frozen city-003 tests, which zoom in at the canvas centre onto the busy Main Bridge, then found too few vehicles.
  - `Camera.fitInsets(bounds, insets)` is new; `fit` is unchanged. The app uses `fitInsets(bounds, FIT_INSETS)`.
- **Link table**
  - `web/src/render/linkTable.ts` exports `LINK_TEX_WIDTH = 1024` and `linkTexel(i, row, n) -> [x, y] = [i % 1024, row × ceil(n / 1024) + floor(i / 1024)]`.
  - The texture is 1024 × 3·ceil(n/1024) texels, so it never exceeds `MAX_TEXTURE_SIZE` for any realistic n. The vertex shader uses the same mapping.
- **Renderer**
  - **Draw order:** water → banks → parks → buildings → bridge decks → pads → roads → route/halo → closed hatch + barriers → vehicles → ring.
  - **Congestion level of detail:** while zoom < `LOD_OVERVIEW_PX_PER_M` (0.5), a road's drawn width grows by up to +3 CSS px with its **occupancy** (vehicles ÷ capacity), and its lightness rises. It is not driven by the queued share: that drops to about 0 for a few ticks whenever the front car leaves, even on a full link, which would make congestion blink (Red r1 M1). Congested links are drawn after uncongested ones, so an overlapping reverse direction cannot hide the cue. Above `LOD_DETAIL_PX_PER_M` (2), lane markings and building outlines show.
  - **Closed roads:** the hatch is drawn in its own pass, after roads and halos, and only on the closed link's quad shortened by ≥ 6 CSS px at each end, so junctions keep showing the cross roads. The hatch is anchored to world space: it moves with the map, and its period is constant in px.
  - **Barriers:** bars across each closed link at 12 % and 88 % of its length, with a near-white core ≥ 4 CSS px thick and ≥ (road width + 6 px) long, near-white with a dark edge, sized in screen px.
  - A selected or hovered road's halo never covers the hatch of the opposite closed direction, because the hatch pass is drawn later.
- **UI**
  - **District labels:** a DOM overlay positioned on every rAF (they follow the camera even while paused or before the next frame). Each shows its icon and text, and its box is **centred on its point**.
  - **Legend:** a region labelled "Legend" with a toggle button (`aria-expanded`), expanded by default. It lists closed road, queued car, moving car, congestion and selection, each with a drawn sample (an inline SVG). The collapsed state persists in localStorage, guarded by try/catch.
  - **No WebGL2:** a `role="alert"` message that says WebGL2 is unavailable, and every control is disabled (not silent).
  - **B key:** ignores key repeat.
- **Hook (test-only additions)**
  - `setDebug({ hideVehicles: boolean })` skips drawing vehicles, so road pixels can be measured.
  - `linkCapacity(link) -> number` returns `lanes × max(1, floor(length / 7.5))`, the simulation's storage capacity.
  - `approachLinks(link) -> number[]` returns the links that end at `link`'s start node, excluding the reverse of `link` and zone connectors, ascending.
- **Notes from Red r2 for Gold:**
  - Congestion reaches its full width and lightness effect by 50 % occupancy and is clamped above that, so a road 55 % full is clearly marked.
  - `riverProfile` covers the whole drawn water.
  - The legend toggle has an accessible name ("Legend": `city.spec` requires named buttons).
  - The Gold reviewer checks in screenshots that labels are centred on their points and stay clear of the top inset.
- **Notes from Red r1 for Gold:**
  - Don't animate the water, because a paused canvas must stay static (`city.spec`).
  - Keep the legend clear of the Old Bridge approach at fit zoom (around x 554–599, y 692–716 on 1280 × 800).
- **Cleanup:** remove the dead `v_core` varying and the orphan `laneOffset` export (keep the lane math inside `vehiclePosition`). `FrameMessage.perf` stays reserved for city-005.

## Specification
- **Determinism.** Decor is a pure function of its inputs plus a fixed render seed. There is no `Math.random`.
- **Geometry rules (tested):**
  - every water vertex lies within `[river.west, river.east]`, and the river is ≥ 60 m wide at every profile sample;
  - every landmark bridge crosses the river profile at its y, and no other road segment enters the corridor;
  - buildings keep ≥ (road half width + 4 m) from every road segment, stay outside the corridor, do not overlap each other, and lie inside the city bounds;
  - labels do not overlap at fit zoom on a 1280 × 800 canvas. The estimated box is 7.5 px per character + 18 px wide and 18 px tall, centred on the label.
- **Look (Gold reviewer, screenshots):**
  - dark background; water clearly distinguishable from land by lightness;
  - buildings subtle: low contrast to the land, outlines only at detail zoom;
  - bridges read as decks: wider than the road, with a darker railing edge;
  - roads clearly brighter than buildings; no glow;
  - labels at 12–13 px, letter-spaced, with a text shadow.
- **Colourblind rules.** Every map state has a non-hue cue: closed = hatch + barriers + width; congestion = width + lightness; queued = shape; selection = halo or ring. Grayscale screenshots must keep each state distinguishable.
- **Performance.** Decor uses static buffers built once. Fewer than 20 draw calls per frame. Frame time stays within the core-005 envelope (measured in city-005).

## Tests
Vitest tests are in `web/tests/decor.test.ts` (1–7), against the real River City network from wasm. Playwright tests are in `web/e2e/look.spec.ts` (8–16).

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `decor_is_deterministic` | two calls with the same inputs give identical arrays and labels. The decor module sources contain no `Math.random` |
| 2 | `river_stays_in_corridor` | every water vertex x ∈ [west, east]. `riverProfile` samples are ≤ 50 m apart, cover the city's y range ± 500 m, and are each ≥ 60 m wide and inside the corridor. The drawn water lies inside the profile (± 2 m) and fills it (area within 5 %), and the centre line swings ≥ 20 m (Red r1 M2) |
| 3 | `every_bridge_spans_water` | each landmark bridge segment spans the profile at its y (from x < x0 to x > x1). No non-bridge road segment has a point inside the corridor |
| 4 | `buildings_avoid_roads_water_and_each_other` | there are buildings (≥ 200, each ≥ 6 m a side). Each box keeps ≥ (half width + 4 m) from every road segment (sampled every 5 m), lies outside the corridor and inside the bounds, and overlaps no other box. `buildings` has 6 vertices per box |
| 5 | `district_labels_cover_all_zones` | one label per zone with the zone's name, kind and `LABEL_ICONS[kind]`. After `fitInsets(bounds, FIT_INSETS)` on 1280 × 800, no two estimated label boxes overlap, and every box lies inside the canvas |
| 6 | `fit_insets_keeps_bounds_clear_of_panels` | `fitInsets` puts the bounds inside the inset rectangle, touching it on one axis and centred there. With zero insets it equals `fit(bounds, 0)` |
| 7 | `link_texture_is_2d` | `linkTexel` maps 5,000 links × 3 rows to distinct texels within 1024 × 15. n = 300 stays within 1024 × 3 |
| 8 | `b_key_repeat_ignored` (e2e) | a dispatched `keydown` for `b` with `repeat: true` does not toggle the main bridge: it stays open, the button has `aria-pressed="false"`, and nothing is pending |
| 9 | `hatch_leaves_junctions_clear` (e2e, pixels) | with the Main Bridge closed, paused and with vehicles hidden, a 5 × 5 clip at the east end junction has no hatch-yellow pixels, while a clip at the bridge's middle does. The black stripes match the ground, so only yellow is checked |
| 10 | `hatch_moves_with_the_map` (e2e, pixels) | after a 37 px drag, the clip that moved with the map is identical (± 2 per pixel) to the clip before |
| 11 | `barriers_visible_at_fit_zoom` (e2e, pixels) | at 12 % along each closed Main Bridge link, a run of near-white pixels ≥ 3 px long crosses the bar along the road direction |
| 12 | `selected_halo_keeps_opposite_hatch` (e2e, pixels) | with only the east→west Main Bridge closed and the west→east one selected, the yellow hatch pixel count in the clip is ≥ 90 % of the count before selecting |
| 13 | `labels_follow_camera_while_paused` (e2e) | while paused, after a drag, every district label moves by the drag delta (± 1 px) by the next animation frame. (Red r1 m3: frames also arrive while paused, so this does not separate rAF-driven positioning from frame-driven positioning. The Gold reviewer checks the code) |
| 14 | `congestion_reads_in_grayscale` (e2e, pixels) | with vehicles hidden at fit zoom, the Old Bridge's west approach is ≥ 1 px wider and ≥ 10 lighter (mean luminance of the road core) once it is ≥ 60 % full after closing the Main Bridge (still ≥ 55 % in the measured paused frame), compared with before the closure. The clip is verified to be on the canvas |
| 15 | `legend_explains_symbols` (e2e) | the legend is keyboard reachable and lists the five symbols, each with a drawn SVG sample (containing a shape). Collapsing it keeps it collapsed after a reload |
| 16 | `no_webgl2_fallback` (e2e) | with `getContext('webgl2')` stubbed to null, an alert names WebGL2, and Play and "Close the main bridge" are disabled |

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

## Gold refinements (after Gold r1, REJECTED)
- **Legend (MAJOR 1):** a compact horizontal layout (toggle button + a 3 × 2 grid with short labels, about 56 px high) inside the bottom inset band, to the right of the metrics strip. It no longer covers the city at 1280 × 800 or 1280 × 720. Its contract is unchanged: region "Legend", `aria-expanded`, expanded by default, five drawn samples, collapsed state persisted.
- **River (MAJOR 2):** the profile margin is 2000 m (the test requires ≥ 500 m), so the river never visibly starts or ends in a fitted view.
- **Bridge decks:** their own pass, with a minimum on-screen width of `DECK_MIN_PX = 12` and a 1.5 px dark railing on both long edges (this replaces the 1 px GL_LINES railings, which could not be seen). `DECK_HALF_M` is 20.
- **Draw order now follows the spec:** roads → halo → route → closed hatch → barriers → vehicles → ring. A closed road's halo starts from the hatch's 9 px minimum width, so a selected closed road shows its halo at every zoom.
- **Cleanup:**
  - `laneOffset` is no longer exported;
  - the state texture is allocated once and then updated with `texSubImage2D`;
  - the barrier key is an array compare, not a per-frame string;
  - labels are repositioned only when the camera moves;
  - label keys are unique;
  - shader objects are deleted after linking.
- **Accepted, not changed:** the hatch is dropped on closed links shorter than 14 px on screen (about zoom < 0.07, far below fit zoom); the barriers still mark them.
