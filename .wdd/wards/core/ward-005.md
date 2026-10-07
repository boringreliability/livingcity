---
ward: 5
revision: null
name: "First closure in the browser"
epic: "core"
status: "gold"
dependencies: ["core-004"]
layer: "typescript"
estimated_tests: 20
created: "2026-10-06"
completed: null
---
# Ward core-005: First closure in the browser (integration ward)

## Scope
This is the integration ward of epic `core`. A WebGL2 renderer draws the three-bridges city from the worker's frames: water, roads with lanes, and vehicles that move and queue. A React shell lets the user pan/zoom, pause/resume, change speed, select a road, close/reopen it, and press **"Close the main bridge"**. The full loop is Rust → WASM → worker → renderer/UI → command → Rust, verified end to end in a real browser (Playwright). Visual polish comes later (epics `city`, `polish`), but nothing may rely on red vs. green, and the core-004 debug readout is replaced.

## Inputs
- core-004: `createSimClient`, protocol (`ReadyMessage.network`, `landmarks`, `zones`, `metricNames`), AoS `decodeVehicles` (`words`/`floats`), the frame flags, `clock` status.
- Contract § Frame / boundary format; CLAUDE.md § Graphics roadmap (Rust gives link + offset + lane; the renderer maps them to world space).

## Outputs
- `web/src/render/geometry.ts`: `LANE_WIDTH_M = 3.5`, `MEDIAN_GAP_M = 1.0`, `buildRoadGeometry(network: NetworkArrays) -> RoadGeometry { links: LinkGeom[]; bounds }` with `LinkGeom { id, x0, y0, x1, y1, nx, ny, width, lanes, length }`:
  - (x0, y0)→(x1, y1) is the link's **drawn centerline** in world meters;
  - (nx, ny) is the unit **right-hand normal** of the travel direction in world coordinates (y up): `(dy, −dx)/|d|`;
  - `width = lanes × LANE_WIDTH_M`;
  - a link whose reverse link exists is shifted to its right by `width/2 + MEDIAN_GAP_M/2`; a one-way link is centered on the node line.
  - Vehicles are placed at `centerline(s / length_sim) + n · ((lanes − 1)/2 − lane) · LANE_WIDTH_M`, so **lane 0 is the rightmost** lane.
- `web/src/render/camera.ts`: `Camera` with world center `(cx, cy)`, `zoom` (CSS px per meter), viewport `(width, height)` in CSS px. Screen y points down, world y up. `worldToScreen`, `screenToWorld`, `panBy(dxPx, dyPx)`, `zoomAt(sx, sy, factor)` (the world point under (sx, sy) stays fixed; zoom clamped to `[MIN_ZOOM, MAX_ZOOM]`), `fit(bounds, paddingPx)`.
- `web/src/render/picking.ts`: `pickLink(links, camera, sx, sy, tolerancePx = 8) -> number | null`: the link whose drawn segment is nearest to the screen point, among those within `width/2 · zoom + tolerancePx` pixels; ties → lower id.
- `web/src/render/renderer.ts`: WebGL2 `CityRenderer(canvas)` with `setNetwork(geometry)`, `setFrame(words, count, receivedAtMs, simSpeed)`, `setLinkState(closed, selected, hovered, linkQueued)`, `draw(camera, nowMs)`.
  - **Link table** in an RGBA32F texture (3 texels per link: (x0, y0, x1, y1); (nx, ny, width, lanes); (sim length, 0, 0, 0)).
  - **Vehicles** are instanced quads whose position is computed in the vertex shader from the uploaded AoS words (link and flags as integer attributes, s and v as float attributes from the same buffer, stride 16). The position is extrapolated with `s + v · Δt_sim` (clamped to the link length) between frames, where `Δt_sim = wall Δt × achieved sim speed`, and 0 while paused.
  - **Roads** are triangles. A per-link state texture drives closed (hatched barrier pattern + barrier glyph quads at both ends), selected/hovered (outline) and congestion (lightness/width, never hue alone).
  - **Water and decor** (river band, zone markers) come from `web/src/render/decor.ts`: render-side data for three_bridges.
- `web/src/ui/`:
  - `App` with a full-window canvas;
  - `ControlPanel`, with exact names:
    - a play/pause `<button>` whose accessible name is "Pause" while running and "Play" while paused;
    - a native `<select>` with `aria-label="Speed"` and options labelled exactly `1×`, `5×`, `20×`, `60×`;
    - a `<button aria-label="Close the main bridge" aria-pressed>` toggle. The accessible name is constant; the visible text may change ("Close the main bridge" / "Main bridge closed — reopen"), and "pending" is shown until a frame confirms. Pressing it again reopens both directions;
    - a **speed status** with achieved vs. target speed (`data-testid="achieved-speed"`) and a permanently present `role="status"` element that shows the visible text **"Behind"** (plus an icon, never colour alone) whenever `clock.behind` is true and no "Behind" text otherwise. The brief requires honest reporting when the engine can't keep up;
  - on load the app auto-runs at 20×;
  - `MetricsStrip`: sim time `HH:MM:SS` labelled "sim", visibly distinct from wall clock; active; completed; mean travel time; queued, with the definition in its tooltip; unreachable;
  - `SelectionPanel`: a heading with the text `Link <id>` (exactly once on the page), lanes, speed (km/h), length, vehicles, queued, closed state, and one button named exactly `Close link` or `Reopen link`;
  - zone labels as an HTML overlay.
- Keyboard: Space = pause/resume, B = toggle main bridge, `+`/`-` = next/previous speed option (stopping at the ends, no wrap-around), Esc = clear selection. **Global shortcuts are ignored while focus is in an interactive control** (button, select, input, textarea, contenteditable), so a focused button keeps its native Space activation. Every control is reachable with Tab and has an accessible name (browser-computed).
- Test hook (`web/src/ui/testHook.ts` types): `window.__livingcity = { snapshot(), linkScreenCenter(link) }`. `snapshot()` returns `{ tick, simTimeS, running, metrics, closed, linkCounts, landmarks, selectedLink, renderFrames }` from the **latest frame** (`running = frame.clock.running`) plus UI state. `renderFrames` counts rAF draws. `linkScreenCenter` gives the page CSS-px position of a link's drawn midpoint (null when off-screen). It is read-only and used by Playwright.
- Playwright: `web/playwright.config.ts` (chromium, webServer = vite dev on a fixed port), `web/e2e/*.spec.ts`, `pnpm -C web e2e`.

## Specification
- Vehicles use colour **and** shape. Moving vehicles are light, elongated quads. Queued vehicles (flag bit0) are amber, shorter/wider, with a dark brake band. Stranded vehicles (bit2) carry a hollow/outlined mark. Motion itself is visible through extrapolation.
- Closed links get a black/yellow diagonal hatch over the full road width plus barrier glyphs, recognisable in grayscale.
- Rendering never feeds back into the sim. The frame rate is independent of the tick rate (requestAnimationFrame + extrapolation). Buffers are returned to the worker after upload. **In core-005 only vehicles move on the canvas**: water, decor, closure markers and selection are static (no wall-time animation), and congestion shading stays within the road's drawn width. Later epics may animate water, but must update tests 8 and 19 accordingly. The camera has **no easing or inertia** in core-005: pan and zoom apply immediately. **While paused, nothing on the canvas depends on wall time** (no animation and no extrapolation), so the paused canvas is pixel-static. The canvas backing store follows `devicePixelRatio`, and picking/camera work in CSS px. The mouse wheel zooms about the cursor; its rate is unspecified (one notch must change the view).
- Commands issued while paused take effect on the next executed tick (core-004 semantics). The UI shows them as pending until a frame confirms them.
- "Close the main bridge" closes **both directions** of `landmarks.central_bridge`. Pressing it again reopens both.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `camera round trip and zoom about cursor` (Vitest) | screen→world→screen identity at several zooms/centers; the world point under the cursor stays fixed when zooming; the zoom clamp; `fit` contains the bounds |
| 2 | `picking selects nearest link within tolerance` (Vitest) | correct link of two parallel opposite links; nothing outside the tolerance; tie → lower id; tolerance scales with zoom |
| 3 | `road geometry offsets two-way pairs` (Vitest) | opposite links are separated by ≥ (w1 + w2)/2 and never overlap; one-way links are centered; width = lanes × 3.5; the right normal convention holds; lane 0 is the rightmost |
| 4 | `e2e: city loads and traffic moves` (Playwright) | WebGL2; the canvas with overlays hidden has > 0.5 % non-background pixels; sim time advances (auto-run); active > 0; no console errors (favicon 404 aside) |
| 5 | `e2e: close the main bridge and traffic reroutes` (Playwright) | the button gets `aria-pressed=true`; both central links are in `closed`; after 5 sim-minutes the central bridge holds 0 vehicles and the mean north+south bridge occupancy exceeds the pre-closure mean |
| 6 | `e2e: select a road, reopen, pause by keyboard` (Playwright) | clicking the centre of the central bridge (on the canvas) selects it and the panel shows `Link <id>`; Close link / Reopen link toggles `closed`; Space stops sim time, Space resumes |
| 7 | `e2e: controls are keyboard reachable and labeled` (Playwright) | Tab reaches every button/select; each has an accessible name; B toggles the main bridge |
| 8 | `e2e: rendering is decoupled from simulation` (Playwright) | while paused, rAF keeps drawing and the canvas (overlays hidden) is pixel-static; it changes when resumed; the canvas resizes with the window without sim effects |
| 9 | `fix G1: global shortcuts are ignored while a control has focus` (Playwright) | Space on a focused button activates it without pausing; Space/B in the select do nothing global |
| 10 | `fix G2: pressing the main-bridge toggle again reopens both directions` (Playwright) | the toggle reopens both links; aria-pressed follows |
| 11 | `fix G3: Esc clears the selection and +/- change the speed` (Playwright) | Esc clears; + and - step through the speed options |
| 12 | `fix G4: closing the main bridge changes its grayscale appearance` (Playwright) | the empty, paused bridge looks clearly different in grayscale once closed (mean abs. luminance diff > 15) |
| 13 | (replaced by 20) | — |
| 17 | `fix S1: a stalled engine shows a visible, non-colour "Behind" status that clears again` (Playwright) | the worker is stalled 2.5 s → visible status text "Behind" appears and clears; achieved speed is shown |
| 18 | `fix N1: the app starts running at 20×, and the play/pause name follows the state` (Playwright) | default 20×; Pause/Play naming follows the confirmed state, also via Space |
| 19 | `fix N2: vehicles are drawn inside their own right-hand roadway` (Playwright) | ≥ 95 % of changed pixels between two paused images lie within the west→east roadway (shader placement matches camera/picking) |
| 20 | `fix G5 (r2): clicking a road selects it at DPR 2, also after zooming with the wheel` (Playwright) | backing store × DPR; picking after wheel zoom (no rate assumption) |
| 21 | `fix W1: the mouse wheel zooms about the cursor` (Playwright, DPR 2) | the road centre under the cursor stays within 3 px after wheel zoom (CSS-px anchor, not viewport centre) |
| 14–16 | `fix U16 …`, `fix U2/U6 …`, `fix U13 …` (Vitest) | segment (not infinite-line) picking; both endpoints shifted and s mapped by sim length; fit clamps zoom |

## Must NOT
- No per-vehicle draw calls, no Canvas2D vehicle drawing, no x/y from Rust.
- No red-vs-green-only signals. No invented metrics.
- No polish rabbit holes (buildings, final typography, final palette: epics `city`/`polish`).

## Must DO
- `pnpm -C web test`, `pnpm -C web e2e`, `pnpm -C web build`, `cargo test --workspace` and clippy green.
- Epic integration checklist: every message type has a consumer, every UI control changes sim state or the view, no orphaned exports (`wdd api`, Rust `pub` items).

## Manual Smoke Test
### Setup
```
pnpm -C web install && pnpm -C web build:wasm && pnpm -C web dev
```
### Steps
1. Open the printed URL. Verify: the river city is visible and vehicles move on all three bridges.
2. Press "Close the main bridge". Verify: the central bridge shows the barrier marker, no new cars enter, and within a few sim-minutes traffic shifts to the north/south crossings.
3. Press Space. Verify: sim time and vehicles stop; Space resumes.
4. Click a road. Verify: the selection panel shows it. Click "Close", then "Reopen".
### Pass criteria
- [ ] Rerouting is visible without any scripted behavior
- [ ] The closure marker is unmistakable without colour (grayscale screenshot)
- [ ] The e2e suite is green

## Verification
The Gold reviewer runs Playwright plus the manual steps via the Playwright MCP browser and takes screenshots before and after the closure, including a grayscale check.
