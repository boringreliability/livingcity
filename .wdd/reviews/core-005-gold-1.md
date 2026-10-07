# core-005 Gold review 1

Reviewer: Gold adversarial reviewer (Claude Opus 5.5), 2026-10-07 — acting as quality gate for the integration ward of epic `core`
Verdict: REJECTED

Reason: two MAJOR findings, both user-visible in the **default (fit) view**. (1) The selected road is practically invisible on the map. (2) Queued and moving vehicles have identical shapes, so the only cue left is colour. Every gate is green: tests, clippy, build, e2e ×3 and the smoke-test loop. Both fixes are small and stay inside the shaders.

## Tampering check
`git diff 11f94f7 HEAD -- web/tests web/e2e crates/sim-core/tests` → **empty**. The only other non-implementation change is `.wdd/wards/core/ward-005.md` (front-matter `status: approved → gold`, no spec text changed). OK.

## Commands + results
| Command | Result |
|---|---|
| `cargo test --workspace` | OK — 20 + 24 + 36 + 5 passed, 0 failed |
| `cargo clippy --workspace --all-targets -- -D warnings` | OK (exit 0) |
| `pnpm -C web build:wasm` | OK |
| `pnpm -C web test` | OK — 9 files, 43 tests |
| `pnpm -C web e2e` | OK — 14/14 (39 s) |
| `pnpm -C web e2e --repeat-each 2` | OK — 28/28 (1.3 min), no flakes |
| `pnpm -C web build` (tsc --noEmit + vite build) | OK |

## Smoke test (real Chrome via Playwright MCP, vite :5184, 1280×800, DPR 1)
1. **City + traffic**: the river, the grid, 5 zone labels and vehicles are visible, with an auto-run at 20× ("20.5× of 20×"). Bridge occupancy, sampled every 1.5 s, was N 0–5 / C 5–13 / S 1–3, so vehicles move on all three bridges. The only console error is the favicon 404. ✔
2. **Close the main bridge**: `aria-pressed=true`, text "Main bridge closed — reopen", `closed=[50,51]`. The central bridge held 0 vehicles from the first sample on, and north and south rose to 8–12 / 10–11 within about 1 sim-minute (from 2 / 3). Rerouting is visible without scripting. ✔
3. **Space**: sim time froze (1778.5 → 1778.5 over 2 s), the button turned "Play", and Space resumed it (+20 s sim per 1 s). ✔
4. **Click road**: a click at (376,250) selected Link 18, and "Link 18" appears exactly once. Close link → `closed` contains 18 and the button reads "Reopen link". Reopen → 18 removed. ✔ (But see MAJOR-1: the map itself barely shows which road is selected.)
5. **Grayscale check of the closure marker**: the screenshots were converted to luminance with PIL. On the central-bridge crop (88×16 px), the mean abs. luminance difference open→closed is **72.7** (the test threshold is 15). Luminance stdev went from 30 → 83.5, and the hatch alternates about 13 ↔ 247. A zoomed grayscale crop shows a crisp black/white diagonal hatch. **Unmistakable without colour ✔.** The barrier glyph bars are only ~1 px slivers at fit zoom (MINOR-3) and become clear white bars once zoomed in.

Visual quality vs. the brief (v1/core, not failed on taste): the scene is dark and flat. Vehicles are 3×2 px specks at the default zoom, and the water band and land are low-contrast in grayscale (≈38 vs 17). The overlays cover parts of the map (MINOR-4). At closer zoom the scene reads well: dashed lane separators, right-hand pairs, and bold hatch + barrier bars.

## Spec deviations
- **Vehicle shape (MAJOR-2)**: the spec says "Vehicles use colour **and** shape … queued … shorter/wider, with a dark brake band". This is not met below ~0.73 px/m, which includes the default view.
- **Selected/hovered outline (MAJOR-1)**: the outline exists, but at default zoom it is sub-pixel.
- Renderer API signatures differ from the spec: `setNetwork(geometry, decor)` (spec: `setNetwork(geometry)`), `setFrame(words, count, receivedAtMs)` (spec: `+ simSpeed`), `draw(camera, nowMs, simSecondsPerMs)` (spec: `draw(camera, nowMs)`). The semantics are equivalent: achieved speed is used, and the value is 0 while paused. MINOR.
- Conforming: geometry (right normal `(dy,−dx)/|d|`, pair shift `w/2+0.5`, lane 0 rightmost, s mapped by sim length); camera (CSS px, y-flip, zoom about cursor, clamp, fit, no easing); picking (segment distance, `w/2·zoom+tol`, ties → lower id; the 8 px tolerance ≥ the drawn min half-width of 4.5 px, so drawn min-width roads stay pickable at wide zoom); link table of 3 RGBA32F texels/link; instanced AoS upload, stride 16, `vertexAttribIPointer` for link/flags, float s/v; extrapolation only while running, clamped to link length, and dtSim ≤ 2 s; static decor; closed hatch + glyphs; min pixel widths for roads (2.5 / 9 px) and vehicles; exact UI names/roles; shortcuts ignored in controls and with Ctrl/Meta/Alt; a permanent `role=status` showing "⚠ Behind …"; auto-run 20×; buffers returned after upload; DPR backing store on resize; hook `running = frame.clock.running`.

## Integration checklist (ward Must DO)
- **Message types**: ToWorker `init/setRunning/setSpeed/command/returnBuffer` are all sent by `client.ts`, and FromWorker `ready/frame/error` are all consumed in `App.tsx`. ✔ One gap: the `FrameMessage.perf` field (PerfStats) is built every frame by `host.ts:124-158` but **never consumed** by the UI (MINOR-8).
- **UI controls**: Play/Pause and Space → setRunning; Speed select and +/- → setSpeed; main-bridge toggle and B → close/open ×2; Close/Reopen link → command; canvas drag/wheel/click/Esc → view or selection. All effective. ✔
- **Orphaned exports**: `wdd api` prints "(no exports found)" (the tool does not index this repo), so this was checked by grep. TS: `laneOffset` is used only inside geometry.ts. `vehiclePosition`, `MIN_ZOOM/MAX_ZOOM`, `MEDIAN_GAP_M`, `FLAG_*` and `decodeVehicles` are used only by tests or by host internals (MINOR-9). Rust: every `pub fn/const/struct/enum` in sim-core is referenced outside its own file. Of the sim-wasm exports, only `state_hash_hex` is test-only (it comes from core-004).
- **Loop Rust → WASM → worker → renderer/UI → command → Rust**: verified live in the smoke test (close → frame-confirmed `closed` → hatch drawn → reroute). ✔

## Findings

### MAJOR-1 — The selection (and hover) highlight is sub-pixel at the default zoom; the selected road cannot be found on the map
`web/src/render/renderer.ts:85` (`abs(v_across) > 0.72` → white) and `:79` (hover `+0.08`).
Evidence: the sim was paused and Link 18 selected at fit zoom (≈0.48 px/m; a 1-lane road is drawn at its 2.5 px minimum). A 12-px pixel row across the road reads: unselected `…26,30,36 | 61,69,79 ×4 | 26,30,36…`, selected `…26,30,36 | 61,69,79 ×4 | 74,77,80…`. **The only change is one antialiased edge pixel.** No white outline is visible, as a 4× enlarged crop confirmed. The selection outline covers 28 % of each half-width, so it disappears whenever the road is near its min pixel width, which is most of the network at the default view. The user clicks a road, sees the panel, and cannot see which road it refers to. Hover (+0.08 lightness) is equally faint.
Fix: give selection a screen-space outline. For example, extrude the road quad by a fixed number of px (≥2 CSS px per side) when selected/hovered, and colour the outer band white or high-contrast, by pixel distance (`v_across * hw * u_pxPerM`) rather than a width fraction. Add a test: select at fit zoom, then require ≥ N px of luminance change around the link.

### MAJOR-2 — Queued and moving vehicles are the same shape at the default zoom, leaving colour as the only cue
`web/src/render/renderer.ts:115-116`: `size = max(size, vec2(3.2, 2.2)/u_pxPerM)`.
Evidence (shader math): moving 4.4×1.8 m and queued 3.6×2.3 m both clamp to **3.2×2.2 px** whenever `zoom < 3.2/4.4 ≈ 0.73 px/m` for length and `< 0.96` for width. The fit zoom here is ≈0.48 px/m (700 m link = 336 px). The brake band is 22 % of 3.2 px ≈ 0.7 px. In the default view, queued vs. moving therefore differs only by amber vs. near-white. That contradicts the spec ("colour **and** shape … shorter/wider, with a dark brake band"), and the brief has a colour-blind primary user. Stranded vehicles also lose most of their mark (≈1.9×1.1 px).
Fix: apply the minimum per class so the ratio survives. For example, queued min = (2.6, 3.0) px (short and wide, near-square) and moving min = (4.0, 2.0) px (elongated). Alternatively, scale both by the same factor `max(1, minPx / (natural · zoom))` so the aspect ratios are kept. Make the brake band at least 1 px. Add a unit/e2e check at fit zoom.

### MINOR
1. **DPR change without a CSS resize is not tracked**: `web/src/App.tsx:124-136` relies on ResizeObserver of the CSS box only. Evidence: with CDP `deviceScaleFactor` 1→2 at the same 1280×800, the canvas stayed 1280×800 (expected 2560×1600) and `u_dpr` stayed stale. This happens in practice when a window moves between a Retina and an external monitor: the canvas turns blurry and the hatch scale is off until the next resize. Fix: a `matchMedia('(resolution: Xdppx)')` listener, or `ResizeObserver` with `devicePixelContentBoxSize`.
2. **GPU resource leaks**: `renderer.ts:314` deletes the glyph VAO but not its buffer (one leaked buffer per change of the closed set). `solidMesh` and `setNetwork` never delete old meshes or buffers, and there is no `dispose()`. Under StrictMode (`main.tsx`) the first effect's `CityRenderer` is never released; the second one compiles three more programs on the same context. Dev-only, and only one worker survives (verified via CDP targets: exactly 1 worker). Fix: delete buffers, add `dispose()` and call it from the effect cleanup.
3. **Barrier glyphs are world-sized** (`renderer.ts:339-340`, `ht = 1.2 m`): at fit zoom they are ~1 px slivers, while the closed road is held at a 9 px min. The hatch carries the signal, so this is minor. Fix: min px thickness and length as for roads.
4. **Overlays hide the map**: `FIT_PADDING_PX = 64` (`App.tsx:17`) ignores the panels. The control panel covers the NW corner of the grid and the north road start, the metrics strip covers the SW corner, and the selection panel covers the Tech Park label/zone. Fix: fit into the free rectangle, or move the panels.
5. **The hatch extends over junctions**: closed links run node-to-node, so the hatch paints over the open N–S cross roads at both bridge-head junctions (visible zoomed in) and reads as if the cross road were closed too. This is for epic `city` (junction geometry).
6. **Space auto-repeat**: `App.tsx:171` does not ignore `e.repeat`, so holding Space flips pause on every repeat. Fix: `if (e.repeat) return` for Space/B.
7. **Paused still costs a full frame pipeline**: the worker posts frames at 60 Hz while paused (`host.ts:203`). The UI copies and uploads the vehicle buffer, rebuilds the state texture and re-renders React 60×/s. Measured 4.3 % script time while paused vs 4.3–4.7 % running. Harmless now, but wasteful. Note: ZoneLabels follow pan/zoom *only* because frames keep arriving (`App.tsx:278`, re-laid out per React render). After a worker halt (no more frames), labels detach from the map when panning.
8. **`FrameMessage.perf` is never consumed** (integration checklist: data on the wire without a consumer). Either show it (a dev overlay) or drop it.
9. **Export hygiene**: `laneOffset` has no consumer outside geometry.ts. `vehiclePosition` (test-only) duplicates the GLSL placement in `renderer.ts:105-113`; a drift between the two is only caught by e2e N2.
10. **No WebGL2**: verified with `getContext('webgl2')` → null. The `role=alert` "WebGL2 is not available" appears with no page errors, but the sim is never started, the controls render and silently do nothing, and `renderFrames` keeps counting draws that never happen (175 after 2.5 s).
11. **Texture width = link count** (`renderer.ts:283,322`): fine for three_bridges, but it fails beyond `MAX_TEXTURE_SIZE` (≥ 2048 guaranteed) for epic `city`. Wrap into 2D rows.
12. `gl.getUniformLocation` is called every frame (cache it); the buffer pool reuses buffers only on an exact byte-size match (core-004), so reuse is rare.
13. The hatch is anchored to screen pixels (`gl_FragCoord`), so it "swims" relative to the road while panning. It complies with "no wall-time animation", but it is a polish item.

## Performance (Chrome, 75 Hz display, 220–240 active vehicles)
- rAF intervals over 300 frames: **20×: median 13.3 ms, p95 14.2, max 14.4; 60×: median 13.3, p95 14.1, max 14.4.** 0 long tasks. The achieved speed equals the target (20.0× / 60.0×) and "Behind" never appeared.
- Main thread (CDP TaskDuration over 5 s): 6.5 % at 20×, 7.3 % at 60×, 5.4 % paused. Script 4.3–4.7 %, layouts 41–51/s (React re-renders per frame message, ≈60/s), no style-recalc storms. That is roughly 1 ms of main-thread time per frame message, which is acceptable.
- JS heap after forced GC: 8.19 → 8.27 → 8.32 MB over 20 s, so no leak.

## Notes for epics city / polish
- Vehicle and road legibility at the overview zoom (MAJOR-2 is the core fix; polish should go further: bigger glyphs, a density/heat view at low zoom).
- Junction geometry: links overlap at nodes, the hatch overruns cross roads, and vehicles jump laterally between the offset pair geometries.
- Water vs. land contrast in grayscale is weak (≈38 vs 17 luminance). Consider texture or an edge line.
- Layout-aware camera fit; panels that don't hide zones.
- Texture-size wrapping for large networks; renderer `dispose()`; context-loss handling (none today).
- Surface `perf` and achieved/target in a dev overlay; consider throttling frames while paused.
