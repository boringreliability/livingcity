---
ward: 4
revision: null
name: "City character"
epic: "motion"
status: "red"
dependencies: ["motion-003"]
layer: "typescript"
estimated_tests: 9
created: "2026-10-11"
completed: null
---
# Ward motion-004: City character

## Scope
This ward is contract **M4** of epic `motion` and §4 of the user's task. It is a restrained visual pass on the current WebGL2 renderer and is render-side only:
- **No Rust change**, so the sim, `state_hash`, the frame layout and the protocol are untouched.
- **No 3D**, no new asset pipeline and no new UI panels.

It makes five things true:
1. **Districts are told apart without hue.** Residential, workplace (the "commercial" districts: Market, Downtown, Tech, Harbor), hospital and waterfront areas differ by **shape and pattern** first, and by luminance second:
   - building form;
   - a per-kind roof mark;
   - the zone pad's shape;
   - a quay edge along the river.
2. **Bridges and major routes read at wide zoom.** Major roads are drawn wider and brighter than local streets at every zoom where both would otherwise sit at the minimum width.
3. **Vehicles and queues read at close zoom.** Every car has a dark outline seam, so the cars in a queue can be counted one by one.
4. **Closures and the followed route are unmistakable.**
   - The followed car's marker becomes four corner brackets, a different shape from the closure ring (backlog i5).
   - The followed route gets a dark casing, so it reads on a congested (light) road, and a destination mark.
5. **Decor stays subordinate.** Every decor fill and mark is darker than the darkest road, and traffic marks keep their contrast.

The facts are in `.wdd/memory/investigation-2026-10-12.md` § Character (B).

## Inputs
- **Render side:**
  - `web/src/render/cities/{index,riverCity}.ts`: `CityDecor`, `CityLabel`, `LABEL_ICONS`, `riverCityDecor` (blocks with the nearest zone's kind, `buildingBoxes`, pads, river profile), and generic decor for other cities.
  - `web/src/render/renderer.ts`: the pass order, road width (`core = max(halfWidth, 0.5·minPx/pxPerM)`), the DECK pass, the vehicle instance shader, `setTracked` (route and ring), and the closure ring.
  - `web/src/render/geometry.ts`: link geometry.
- **Sim data already on the UI:**
  - `NetworkArrays.linkSpeed`, `linkLanes`;
  - `Landmarks` (bridge link pairs);
  - zone kinds (`residential | workplace | hospital`);
  - frame `linkQueued`;
  - the vehicle queued flag.
- **UI:** `Legend.tsx` (5 rows), the label layer CSS `.zone`, and test hooks (`testHook.ts`).

## Outputs
- **`render/cities/character.ts`** (new, pure, no GL):
  - `type DistrictKind = 'residential' | 'workplace' | 'hospital' | 'waterfront'`.
  - `DISTRICT_KINDS = ['residential', 'workplace', 'hospital', 'waterfront']`; a kind code is its index.
  - `CityDecor.buildingKinds: Uint8Array` (computed by `riverCityDecor`, empty in generic decor): one kind code per `buildingBoxes` box. Here a box's *block* is the street-grid cell (between consecutive distinct non-zone junction x and y values) that contains it, and the block's kind is the kind of the zone nearest to the block's centre (today's rule).
    - A box's kind is its block's zone kind.
    - A box in a *riverside block* is `waterfront`, unless its block's kind is hospital. The riverside blocks are the grid column directly west and the one directly east of the column that contains the river corridor (`ReadyMessage.river`). In River City that is x ∈ [−500, −200] and [200, 500], about 260 boxes (measured: buildings start ≥ 158 m from the water, beyond the bank streets, so a distance rule would find none).
    - The result is deterministic.
  - `DISTRICT_STYLE: Record<DistrictKind, { fill: [r,g,b]; outline: [r,g,b]; mark: 'ridge' | 'court' | 'cross' | 'quay' }>`. The four marks are pairwise distinct. The fill luminances differ pairwise by ≥ 0.016 (≥ 4 in 8 bit; sRGB 0–1, `lum` = 0.2126R + 0.7152G + 0.0722B).
  - `PAD_SHAPE: Record<'residential'|'workplace'|'hospital', 'disc'|'square'|'cross'>`, pairwise distinct.
  - `roadClass(network, landmarks, link) -> 'major' | 'local'`:
    - `major` when `linkSpeed ≥ 13.9 − 1e-3` m/s (arterial) or the link is a landmark bridge;
    - `local` otherwise. Zone connectors (street speed, 2 lanes) are local.
  - `ROAD_MIN_PX = { major: 4.5, local: 2.5 }`.
  - `ROAD_BASE = { major: [r,g,b], local: [r,g,b] }`: lum(major) ≥ lum(local) + 0.05. `local` keeps today's base (0.24, 0.27, 0.31).
  - `DECOR_COLORS: Record<string, [r,g,b]>`: every colour the renderer uses for decor (water, banks, park, building outline, pads, quay, bollards; deck and railing are listed but excluded from the bound below). The renderer takes every decor colour from `DECOR_COLORS` or `DISTRICT_STYLE`; no decor colour literal stays in `renderer.ts`.
  - `DECOR_MAX_LUM`: the largest lum over `DECOR_COLORS` (without deck and railing) and every `DISTRICT_STYLE` fill, outline and mark colour. It must be ≤ lum(ROAD_BASE.local) − 0.06.
  - `DISTRICT_STYLE[kind].markColor: [r,g,b]`: lum ≥ lum(fill) + 0.024 (≥ 6 in 8 bit).
- **`CityDecor` additions:**
  - `buildingKinds: Uint8Array`;
  - `quay: Float32Array` (triangles of a paved quay strip, 10 m wide, along both water edges between the water and the bank street, plus bollard dots every 40 m);
  - `padKinds: Uint8Array`: one kind code per zone pad (zone order), in both cities.

  The existing fields and their shapes are unchanged, so the frozen `decor.test` invariants still hold. Generic decor (three_bridges) gets pad shapes per kind and road classes, but no buildings or quay.
- **Renderer:**
  - **Buildings** are filled per kind, and their mark is drawn from zoom ≥ `LOD_DETAIL`:
    - ridge = a centre line along the long side;
    - court = an inner square outline;
    - cross = a ✚ on the roof;
    - quay = two lines parallel to the long side at 1/3 and 2/3 of the short side (warehouse sheds).
  - **Pads** are drawn as a disc, a square or a cross.
  - **Roads:** width minimum `ROAD_MIN_PX[class]`, base colour `ROAD_BASE[class]`. The congestion mix, selection/hover halos, hatch, barriers and closure ring are unchanged (closure ring: lit between radius r − 4 and r − 1).
  - **Vehicles:** a dark outline of `max(0.6 px, 0.25 m)` inside the car's existing footprint. The footprint sizes and the aspect constants pinned by `gold5.test` G2 are unchanged.
  - **Tracked car:** four L-shaped corner brackets (white, with dark edges) at radius 7–11 px around the car replace the ring. Their arms leave the cardinal directions free.
  - **Route:**
    - a dark casing of 1.5 px on each side of the dashed route;
    - the route is drawn above the congestion pass, still under the hatch;
    - a destination mark: a white square outline, 9 px, centred on the route's last point.
- **Legend:** still exactly 5 rows (frozen look #15). The texts become:
  - "Closed road (hatch, barriers, ring)";
  - "Selected / followed (halo, corner brackets, dashed route)".

  The rows' SVG samples are updated to match.
- **Hooks:**
  - `districtSamples(near?: [x,y]) → [{ kind, page:[x,y], box: [x0,y0,x1,y1] (page), mark }]`: per kind, the building of that kind nearest to `near` (default: the canvas centre) whose page box lies fully on the canvas and not under an overlay, with `page` a point inside it ≥ 3 px from its edges and ≥ 3 px from its mark. A kind is missing if no such building exists.
  - `closureSigns() → [{ link, page:[x,y], radiusPx }]`: the closure rings drawn now (outer radius).
  - `roadClasses() → { major: number[]; local: number[] }`: link ids.
  - `trackedMarker() → { page:[x,y], radiusPx } | null`.
  - `routeEnd() → { page:[x,y] } | null`.

## Specification
- All new decor data is computed once per city (like `riverCityDecor`), never per frame. The renderer gains no per-frame JS work beyond today's, except drawing the extra static geometry. The cost is **measured**: render-frame time before and after, in interleaved @perf runs, recorded in `docs/performance.md`.
- No colour is the only carrier of meaning:
  - kinds carry a mark and a pad shape;
  - classes carry width;
  - the tracked car carries a shape;
  - the route carries dashes, casing and an end mark.
- No visual element is added on top of traffic other than the route casing and the destination mark. Building marks are drawn in the decor pass, below roads.
- **Frozen visual tests stay untouched and green.** There is no user authorization to supersede them in this ward:
  - look #9–15;
  - gold5 G1/G2;
  - motion.spec #9/#10 and the curved-car test;
  - motion002 `gpu_draws_where_presentation_says`;
  - inspect #12;
  - city.e2e G4 fix;
  - city.spec #1/#8;
  - review2 N2;
  - decor.test #1–5;
  - layout, guide, compare, fonts, motion003(+gold).

  The tracked-car brackets must still satisfy inspect #12: ≥ 4 pixels with lum ≥ 235 more than 4 px off the road axis on each side, ≥ 12 in total.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `building_kinds_cover_the_city` (vitest, pure, River City decor from wasm) | `decor.buildingKinds.length === buildingBoxes.length`; every code < 4. With blocks recomputed independently in the test (grid cells from the network's distinct non-zone junction coordinates; a block's kind is the kind of the zone nearest to the cell centre; the riverside columns are the ones next to the column containing the river corridor): every box in a riverside column whose block is not hospital is `waterfront`; no other box is `waterfront`; every non-waterfront box has its block's kind. Counts: residential, workplace and waterfront ≥ 20 each, hospital ≥ 4. Two calls give identical arrays. `padKinds` equals the zones' kind codes. `quay` is non-empty, and every quay vertex lies within 15 m of a water edge (the profile's x0/x1 at that y) and outside the water. Generic decor (three_bridges) has `buildingKinds.length === 0`, an empty `quay`, and `padKinds` per zone. |
| 2 | `district_styles_differ_without_hue` (vitest, pure) | The marks in `DISTRICT_STYLE` are pairwise distinct. The fill luminances differ pairwise by ≥ 0.016. Each mark colour's lum is ≥ its fill's + 0.024. `PAD_SHAPE` is pairwise distinct. |
| 3 | `decor_is_darker_than_roads` (vitest, pure + source) | `DECOR_COLORS` has at least water, bank, park, outline, pad, quay and bollard. Every colour in it except deck and railing, and every `DISTRICT_STYLE` fill, outline and markColor, has lum ≤ lum(`ROAD_BASE.local`) − 0.06; `DECOR_MAX_LUM` equals their maximum. lum(`ROAD_BASE.major`) ≥ lum(`ROAD_BASE.local`) + 0.05; `ROAD_BASE.local` is (0.24, 0.27, 0.31). `renderer.ts` imports `DECOR_COLORS` and `DISTRICT_STYLE`. |
| 4 | `road_classes` (vitest, pure, both cities from wasm) | In River City and three_bridges:<br>• every landmark bridge link is `major`;<br>• every link with speed ≥ 13.9 is `major`;<br>• every zone connector (a link touching a zone node) is `local`;<br>• the Old Bridge (8.3 m/s) is `major` (a landmark);<br>• `major` and `local` are both non-empty and cover all links exactly once;<br>• `ROAD_MIN_PX.major ≥ 1.5 × ROAD_MIN_PX.local`. |
| 5 | `wide_zoom_shows_major_routes` (e2e, River City at fit zoom, paused, no congestion: the first frame after warm-up at ?demand=0.25) | For 3 major and 3 local links (from the `roadClasses()` hook; straight links ≥ 60 px on screen, cross-sections at t = 0.5 at least 25 px from any other road):<br>• the road width (pixels with lum > ground + 25 along the perpendicular, ground = median lum of a 9×9 off-road patch) of every major link is ≥ 4 px and ≥ 1.5 × that of every local link;<br>• the brightest-half mean lum of the major cross-sections is ≥ that of the local ones + 8;<br>• each of the three bridges' W→E links measures ≥ 4 px wide at t = 0.5 (bridges are major).<br>Links are chosen with occupancy < 0.1 (no congestion widening) and vehicles hidden (`setDebug`). |
| 6 | `districts_read_and_stay_subordinate` (e2e, River City, zoom 1 and 3 px/m, paused) For each kind: at fit zoom take `districtSamples()`'s building of that kind, wheel-zoom at it to 1 and then 3 px/m, and take `districtSamples(that point)` again (labels hidden by a test style). At both zooms all four kinds are sampled; the 3×3 mean lum of the four samples differs pairwise by ≥ 3 (8-bit). Every sample's lum is ≤ the median lum of a local road's centreline sample − 15. A 200×200 crop's pixels outside roads (from the geometry) have a 99th-percentile lum < the median road lum. At zoom 3, each sampled building's mark is present: the lum profile across the building (through the sample, along its short axis for ridge, through its centre for court/cross) has ≥ 1 local maximum ≥ 6 above the fill. |
| 7 | `queued_cars_countable_at_close_zoom` (e2e, River City, Main Bridge closed, 20× for ≥ 600 ticks, then paused; labels hidden; wheel-zoom ≥ 5 px/m at the end of the first queue pin's link) | The lane line is the link's drawn centreline (`linkScreenPoint`) over its last 60 m, moved sideways by the median perpendicular offset of the lane-0 cars on it (`vehicleDraw(i).page`, as presented). A luminance profile is sampled every 0.2 m along it (≥ 1 px at zoom 5). The number of separate bright runs (lum ≥ 150, each started after a sample with lum ≤ 90) equals the number of lane-0 cars on that link whose page position projects into the stretch, ±1, and that number is ≥ 4. |
| 8 | `followed_car_and_route_are_unmistakable` (e2e, River City, zoom 2, paused, a car followed via the inspect flow) | Vehicles hidden (`setDebug`; the marker and route stay). The car is on an axis-aligned link. **Marker.** Brackets are screen-aligned. With `trackedMarker()` = {c, r}, the 3×3 samples at c + 0.71·r·(±1, ±1) (the four diagonals) each have max lum ≥ 235. At the two cardinal points across the car's (axis-aligned) heading, c ± r·n, the 3×3 max lum is < 200 (brackets, not a ring). With the Main Bridge closed, for a `closureSigns()` ring {c, r}: the 3×3 max lum at c ± r'·n (r' = r − 2, n perpendicular to the bridge) is ≥ 220 at both points: the ring is lit where the brackets are dark, so the two signs differ in shape. **Route.** On a route link with occupancy ≥ 0.5 (congested, light; found from the frame, at ?demand=3), a 24×24 clip on the route gains ≥ 6 pixels with lum ≥ 235 and ≥ 6 pixels with lum ≤ 50 when the car is followed, compared with not followed. A 15×15 clip at `routeEnd()` gains ≥ 12 pixels with lum ≥ 235. |
| 9 | `character_layout_legend_and_three_bridges` (e2e) | **Legend.** Exactly 5 rows; the texts include "ring" in the closed row and "corner brackets" and "dashed route" in the selected row; ≥ 5 SVGs.<br>**Layout.** At 1280×800, 1280×720, 900×800 and 768×800: no `section.panel` overlaps another and none is outside the viewport.<br>**Accessibility.** axe reports no serious or critical violations.<br>**three_bridges.** `?city=three_bridges` at fit zoom: `roadClasses()` has ≥ 1 major and ≥ 1 local link, and test 5's width rule holds for one major and one local link. |

## Must NOT
- Change Rust, the protocol, the frame layout, `state_hash` or determinism.
- Change or supersede any frozen test. If one conflicts, change the design instead.
- Use hue as the only signal; add glow, gradients or clutter; draw decor above roads.
- Add a legend row or a panel, or change label text or label placement.
- Do per-frame decor computation.

## Must DO
- Cover both cities.
- Measure the render cost (before and after, interleaved @perf) and record it in `docs/performance.md`.
- Update the docs:
  - `docs/demo.md` (what the districts, classes, brackets and route look like);
  - `docs/known-issues.md`: i5 resolved; anything left open.
- Run the full frozen visual set listed in Specification.

## Manual Smoke Test
### Setup
`pnpm -C web build:wasm && pnpm -C web dev`, then open the app at 1280×800.
### Steps
1. **At fit zoom:** the arterials and the three bridges stand out from local streets by width and brightness, and the river and districts sit visibly behind the roads.
2. **Zoom to about 1–3 px/m in turn** over Westbrook (residential), Downtown (workplace), St. Mary's (hospital) and the river edge (waterfront). Each district is recognizable by its building form and roof mark (ridge, court, cross, quay) **in a grayscale screenshot** (`page.screenshot` → convert to grayscale).
3. **Close the Main Bridge at 20×, then zoom ≥ 5 px/m on a queue:** the queued cars can be counted one by one.
4. **Follow a car:** corner brackets mark it, and the dashed, cased route reads even across a congested road and ends in a square mark. The closure ring on the Main Bridge looks different from the brackets.
5. **Open the legend:** it explains the ring, the brackets and the dashed route.
6. **`?city=three_bridges`:** major and local roads differ, and the pads differ by shape.
### Pass criteria
- [ ] Each of the user's five §4 points is visible, including in grayscale.
- [ ] Every frozen visual test is unchanged and green; all suites green.
- [ ] The render cost is measured and documented.

## Verification
The Red gate approves tests 1–9. Then all suites are green, the frozen visual set is green, the perf before/after is recorded, and the Gold reviewer performs the smoke test, including the grayscale check.
