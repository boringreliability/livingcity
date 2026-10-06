---
ward: 5
revision: null
name: "First closure in the browser"
epic: "core"
status: "planned"
dependencies: ["core-004"]
layer: "typescript"
estimated_tests: 7
created: "2026-10-06"
completed: null
---
# Ward core-005: First closure in the browser (integration ward)

## Scope
The integration ward of epic `core`. A WebGL2 renderer draws the three-bridges city (water, roads with lanes, vehicles moving and queueing) from the worker's frames, and a minimal React shell lets the user pan/zoom, pause/resume, change speed, select a road, close/reopen it, and press **"Close the main bridge"**. The complete loop: Rust → WASM → worker → renderer/UI → command → Rust, verified end to end in a real browser. Visual polish comes later (epic `polish`), but nothing here may rely on red vs. green.

## Inputs
- core-004: `SimClient`, protocol, frame decoder, `ready` payload (network export, landmarks, zones).
- Contract § Frame / boundary format; CLAUDE.md § Graphics roadmap (Rust gives link + offset; renderer maps to world).

## Outputs
- `web/src/render/camera.ts`: world (m) ↔ screen, pan, zoom about the cursor, fit to bounds.
- `web/src/render/geometry.ts`: road quads from the network export (lane width 3.5 m; two-way pairs offset to their right-hand side), link centerline table for the GPU.
- `web/src/render/renderer.ts`: WebGL2. A link table in an RGBA32F texture (start/end world xy + lateral offset), with vehicles as **instanced** quads whose position is computed in the vertex shader from (link, s, lane) and extrapolated with `s + v·Δt` (clamped to link length) between frames. Closed links get a physical barrier marker (hatched bars + "closed" glyph) drawn on the road.
- `web/src/render/picking.ts`: nearest link to a screen point within a pixel tolerance.
- `web/src/ui/`: `App`, `ControlPanel` (play/pause, speed 1×/5×/20×/60×, "Close the main bridge" toggle with `aria-pressed`), `MetricsStrip` (sim time `HH:MM:SS` labeled "sim", visibly distinct from wall clock; active, completed, mean travel time, queued with its definition in a tooltip, unreachable), `SelectionPanel` (link name/id, lanes, speed, vehicles, queued, Close/Reopen).
- Keyboard: Space = pause/resume, B = toggle main bridge, `+`/`-` = speed, Esc = clear selection. Every control is reachable by Tab.
- Test hook: `window.__livingcity.snapshot()` (always present, read-only): latest tick, metrics by name, link counts for landmarks, closed links. Used by Playwright only.

## Specification
- Vehicles are drawn with color + shape: queued vehicles (flag bit0) render shorter/wider with a distinct hue *and* brake-light dot (not red/green dependent). Speed is visible as actual motion.
- Rendering never feeds back into the sim. Frame rate is independent of tick rate (requestAnimationFrame + extrapolation).
- "Close the main bridge" closes **both directions** of the central bridge (`landmarks.central_bridge`).

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `camera round trip and zoom about cursor` (Vitest) | screen→world→screen identity; the world point under the cursor is fixed when zooming |
| 2 | `picking selects nearest link within tolerance` (Vitest) | correct link, nothing outside tolerance, tie → lower id |
| 3 | `road geometry offsets two-way pairs` (Vitest) | opposite links don't overlap; lane width scales the quad |
| 4 | `e2e: city loads and traffic moves` (Playwright) | sim time advances, active > 0, canvas not blank (pixel sample), no console errors |
| 5 | `e2e: close the main bridge and traffic reroutes` (Playwright) | button `aria-pressed=true`; after 5 sim-min the central bridge holds 0 vehicles and the closed-link set contains both directions; north+south bridge occupancy is higher than just before closure |
| 6 | `e2e: select a road, reopen, pause by keyboard` (Playwright) | clicking a road opens the panel; Reopen clears the closure; Space stops sim time and resumes it |
| 7 | `e2e: controls are keyboard reachable and labeled` (Playwright) | Tab reaches every control; each has an accessible name |

## Must NOT
- No per-vehicle draw calls, no Canvas2D vehicle drawing, no x/y coming from Rust.
- No red-vs-green-only signals. No invented metrics.
- No polish rabbit holes (buildings, typography, final palette are epic `polish`/`city`).

## Must DO
- `pnpm -C web test`, `pnpm -C web e2e`, and `cargo test --workspace` green.
- Epic integration review checklist: every message type has a consumer, every UI control changes sim state or view, no orphaned exports (`wdd api`, rust `pub` items).

## Manual Smoke Test
### Setup
```
pnpm -C web install && pnpm -C web build:wasm && pnpm -C web dev
```
### Steps
1. Open the printed URL. Verify: the river city is visible, vehicles move on all three bridges.
2. Press "Close the main bridge". Verify: the central bridge shows a barrier marker, no new cars enter, and within a few sim-minutes queues build toward the north/south crossings.
3. Press Space. Verify: the sim time stops and the vehicles stop. Press Space again to resume.
4. Click a road. Verify: the selection panel shows it. Click "Close", then "Reopen".
### Pass criteria
- [ ] Rerouting and queues are visible without any scripted behavior
- [ ] Closure marker is unmistakable without color
- [ ] e2e suite green

## Verification
Gold reviewer runs Playwright and the manual steps via the Playwright MCP browser, and takes screenshots before/after the closure.
