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
  - `DISTRICT_STYLE: Record<DistrictKind, { fill: [r,g,b]; outline: [r,g,b]; mark: 'ridge' | 'court' | 'cross' | 'quay' }>`. The four marks are pairwise distinct. The fill luminances differ pairwise by ≥ 0.03 (≥ 7 in 8 bit, Red r1 M4; sRGB 0–1, `lum` = 0.2126R + 0.7152G + 0.0722B).
  - `PAD_SHAPE: Record<'residential'|'workplace'|'hospital', 'disc'|'square'|'cross'>`, pairwise distinct.
  - `roadClass(network, landmarks, link) -> 'major' | 'local'`:
    - `major` when `linkSpeed ≥ 13.9 − 1e-3` m/s (arterial) or the link is a landmark bridge;
    - `local` otherwise. Zone connectors (street speed, 2 lanes) are local.
  - `ROAD_MIN_PX = { major: 5.5, local: 2.5 }` (at fit zoom the two directions of a road overlap into one band; 5.5 leaves ≥ 1 px of headroom over 1.5 × a local band, Red r1 M2).
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
  - **Buildings** are filled per kind, and their mark is drawn from zoom ≥ 1 px/m (Red r1 M4; outlines keep `LOD_DETAIL`):
    - ridge = a centre line along the long side;
    - court = an inner square outline;
    - cross = a ✚ on the roof;
    - quay = two lines parallel to the long side at 1/3 and 2/3 of the short side (warehouse sheds).
  - **Pads** are drawn as a disc (24-gon, radius 45 m), a square (90 m side) or a cross (90 m, arms 30 m wide), from `PAD_SHAPE` and `padKinds`, in both cities.
  - **Roads:** width minimum `ROAD_MIN_PX[class]`, base colour `ROAD_BASE[class]`. In-scope fix (Red r1 M2): the halo grey in `ROAD_FS` (`abs(v_across) > 1.0`) applies only in the halo pass (`u_pass == 1`); today it leaks a 1-px grey edge into the base and congestion passes. The congestion mix, selection/hover halos, hatch, barriers and closure ring are unchanged (closure ring: lit between radius r − 3 and r − 1, r = `closureSigns().radiusPx`).
  - **Vehicles:** from zoom ≥ 1.5 px/m, a dark outline of `max(0.6 px, 0.25 m)` inside the car's existing footprint; below that zoom no outline, so cars keep their bright core at wide zoom (Red r1 M3). The footprint sizes and the aspect constants pinned by `gold5.test` G2 are unchanged.
  - **Tracked car:** four L-shaped corner brackets (white, with dark edges) at radius 7–11 px around the car replace the ring. Their arms leave the cardinal directions free.
  - **Route:**
    - a dark casing of 2.5 px on each side of the dashed route's 3-px core (lum ≤ 50; today's edge is 1 px);
    - the route is drawn above the congestion pass, still under the hatch;
    - a destination mark: a white square outline, 9 px side, line ≥ 2 px, centred on the route's last point (`linkScreenPoint(last, 1)`).
- **Legend:** still exactly 5 rows (frozen look #15). The texts become:
  - "Closed road (hatch, barriers, ring)";
  - "Selected / followed (halo, corner brackets, dashed route)".

  The rows' SVG samples are updated to match.
- **Hooks:**
  - `districtSamples(near?: [x,y]) → [{ kind, page:[x,y], box: [x0,y0,x1,y1] (page), mark }]`: per kind, the building of that kind nearest to `near` (default: the canvas centre) whose page box lies fully on the canvas and not under an overlay, with `page` a point inside it ≥ 3 px from its edges and ≥ 3 px from its mark. A kind is missing if no such building exists.
  - `closureSigns() → [{ link, page:[x,y], radiusPx }]`: the closure rings drawn now (outer radius).
  - `roadClasses() → { major: number[]; local: number[] }`: link ids.
  - `trackedMarker() → { page:[x,y], radiusPx } | null`: page = the car's drawn centre (`trackedScreenCenter`); radiusPx = the distance from it to each bracket's corner vertex.
  - `routeEnd() → { page:[x,y] } | null`: the route's last point, `linkScreenPoint(route[last], 1)`.

## Specification
- All new decor data is computed once per city (like `riverCityDecor`), never per frame. The renderer gains no per-frame JS work beyond today's, except drawing the extra static geometry. The cost is **measured**: render-frame time before and after, in interleaved @perf runs, recorded in `docs/performance.md`.
- No colour is the only carrier of meaning:
  - kinds carry a mark and a pad shape;
  - classes carry width;
  - the tracked car carries a shape;
  - the route carries dashes, casing and an end mark.
- No visual element is added on top of traffic other than the route casing and the destination mark.
- Bridge decks and railings are bridge structure (point 2: bridges recognizable), not decor; they are outside `DECOR_MAX_LUM` and outside test 6's decor crop (within 20 m · zoom + 8 px of a bridge axis), Red r1 m8. Building marks are drawn in the decor pass, below roads.
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
| 1 | `building_kinds_cover_the_city` (vitest, pure, River City decor from wasm) | `decor.buildingKinds.length === buildingBoxes.length`; every code < 4. With blocks recomputed independently in the test (grid cells from the network's distinct non-zone junction coordinates; a block's kind is the kind of the zone nearest to the cell centre; the riverside columns are the ones next to the column containing the river corridor): every box in a riverside column whose block is not hospital is `waterfront`; no other box is `waterfront`; every non-waterfront box has its block's kind. Counts: residential, workplace and waterfront ≥ 20 each, hospital ≥ 4. Two calls give identical arrays. `padKinds` equals the zones' kind codes. `quay` is non-empty, and every quay vertex lies within 15 m of a water edge (the profile's x0/x1 at that y) and outside the water. Generic decor (three_bridges) has `buildingKinds.length === 0`, an empty `quay`, and `padKinds` per zone. **Pad shapes are drawn** (Red r1 m3), in both cities: per zone, the pad triangles within 60 m of its node have area ÷ bounding-box area ≥ 0.95 (square), 0.74–0.82 (disc) or ≤ 0.7 (cross), matching `PAD_SHAPE[kind]`. |
| 2 | `district_styles_differ_without_hue` (vitest, pure) | The marks in `DISTRICT_STYLE` are pairwise distinct. The fill luminances differ pairwise by ≥ 0.03. Each mark colour's lum is ≥ its fill's + 0.024. `PAD_SHAPE` is pairwise distinct. |
| 3 | `decor_is_darker_than_roads` (vitest, pure + source) | `DECOR_COLORS` has at least water, bank, park, outline, pad, quay and bollard. Every colour in it except deck and railing, and every `DISTRICT_STYLE` fill, outline and markColor, has lum ≤ lum(`ROAD_BASE.local`) − 0.06; `DECOR_MAX_LUM` equals their maximum. lum(`ROAD_BASE.major`) ≥ lum(`ROAD_BASE.local`) + 0.05; `ROAD_BASE.local` is (0.24, 0.27, 0.31). `renderer.ts` imports `DECOR_COLORS` and `DISTRICT_STYLE` and has no decor colour literal (no `water|bank|park|building|pad|outline|deck|railing|quay…: [0.…` left; Red r1 m2). |
| 4 | `road_classes` (vitest, pure, both cities from wasm) | In River City and three_bridges:<br>• every landmark bridge link is `major`;<br>• every link with speed ≥ 13.9 is `major`;<br>• every zone connector (a link touching a zone node) is `local`;<br>• the Old Bridge (8.3 m/s) is `major` (a landmark);<br>• `major` and `local` are both non-empty and cover all links exactly once;<br>• `ROAD_MIN_PX.major ≥ 2.2 × ROAD_MIN_PX.local`. |
| 5 | `wide_zoom_shows_major_routes` (e2e, River City at fit zoom, `?demand=0.25`, paused, vehicles and labels hidden) | `roadClasses()` partitions all links, with every landmark link major (Red r1 m1). For 3 major (non-bridge) and 3 local links that are straight, axis-aligned, ≥ 60 px long, **empty together with their reverse twin** (`linkCounts` 0: no congestion tint, Red r1 M2), with their middle ≥ 25 px from every other road and on the canvas, a 31-px line across t = 0.5 gives width = pixels with lum > ground + 25 (ground = median of the 6 outer samples) and light = the median of the 3 middle pixels of that run:<br>• every major width ≥ 4 px and ≥ 1.5 × the widest local width;<br>• mean major light ≥ mean local light + 8;<br>• each bridge's W→E link ≥ 4 px wide. |
| 6 | `districts_read_and_stay_subordinate` (e2e, River City, paused, vehicles and labels hidden) | For each kind (Red r1 B2: one kind per visit): take `districtSamples(FREE)`'s building of that kind at fit zoom (FREE = (512, 400), free canvas at 1280×800); wheel-zoom at it to ≥ 1 and then ≥ 3 px/m and each time drag it to FREE. At each zoom:<br>• its 3×3 mean lum is ≤ the median lum of a local road's middle on screen − 15;<br>• its roof mark is present (a local maximum ≥ fill + 6 strictly inside the building, on the row or column through its centre);<br>• at zoom 1: in a 300 × 300 crop centred on FREE, which must hold > 20 road-centre pixels and > 10 000 decor pixels, the 99th percentile of pixels off roads (half width + 3 px) and off bridges (20 m · zoom + 8 px) is < the median road-centre pixel.<br>Across the four visits, the kinds' fills differ pairwise by ≥ 6 (8-bit) at zoom 1 and at zoom 3 (Red r1 M4). |
| 7 | `queued_cars_countable_and_cars_readable_at_fit_zoom` (e2e, River City) | **(a) Fit zoom** (Red r1 M3), paused: of ≥ 10 moving (not queued) cars on the canvas, ≥ 80 % have a 3×3 max lum ≥ 180 at their drawn centre (`vehicleDraw().page`).<br>**(b) Close zoom** (Red r1 B1): Main Bridge closed, 20× for ≥ 600 ticks, paused; wheel-zoom ≥ 5 px/m at the first queue pin's link (30 m before its end) and drag that point to FREE. For each queued car on that link on the canvas, a 25-px profile **across** the lane through its drawn centre: the bright body (lum ≥ 150) around the centre. A car is counted only where the 2 pixels outside its body on both sides are light road (> 100) in the same profile **with vehicles hidden** (congested; there the brake band cannot make a seam). ≥ 4 cars counted, and ≥ 80 % have a pixel ≤ 90 within those 2 px **on both sides** with the cars shown. |
| 8 | `followed_car_and_route_are_unmistakable` (e2e, River City, `?demand=3`, Main Bridge closed, 20× for ≥ 300 ticks, paused, labels hidden; each check drags its subject to FREE, Red r1 B3) | **Closure ring** (zoom ≥ 2): `closureSigns()` has the Main Bridge's ring within 2 px of the link's middle; the 3×3 max lum at c ± (r − 2)·n (n across the bridge) is ≥ 220.<br>**Follow:** of up to 40 clickable cars, the first on an axis-aligned link whose remaining route has a link with occupancy ≥ 0.5 and length ≥ 40 m (vehicles hidden after the click).<br>**Marker:** `trackedMarker()` is within 1.5 px of `trackedScreenCenter()` (Red r1 M1); the 3×3 max at c + 0.71·r·(±1, ±1) is ≥ 235 at all four; at c ± r across the heading it is < 200 (brackets, not a ring).<br>**Route casing:** on the congested link, at t = 0.2…0.8 in steps of 0.02, for each dash (a ≥ 235 core near the centreline) a 25-px profile across it: ≥ 4 dashes measured and ≥ 75 % have the 2 pixels outside the core ≤ 50 on both sides (today's edge is 1 px).<br>**End mark:** `routeEnd()` is within 1 px of `linkScreenPoint(last, 1)`; at ±4.5 px across the last link and 4.5 px beyond the end, the 3×3 max is ≥ 235 while followed and < 200 after Escape. |
| 9 | `character_layout_legend_and_three_bridges` (e2e) | **Legend.** Exactly 5 rows; the texts include "ring" in the closed row and "corner brackets" and "dashed route" in the selected row; ≥ 5 SVGs.<br>**Layout.** At 1280×800, 1280×720, 900×800 and 768×800: no `section.panel` overlaps another and none is outside the viewport.<br>**Accessibility.** axe reports no serious or critical violations.<br>**three_bridges.** `?city=three_bridges` at fit zoom: `roadClasses()` partitions all links with the landmarks major, has ≥ 1 major and ≥ 1 local link, and test 5's width rule holds for one major and one local link (empty, as in test 5). |

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
