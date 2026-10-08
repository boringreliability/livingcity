# city-004 Gold review, round 1

**Verdict: REJECTED** (0 BLOCKER, 2 MAJOR, 8 MINOR)

Reviewer: fresh adversarial Gold subagent. Implementation = HEAD b4110a4. Red snapshot = b4110a4 (test amendment approved in `city-004-red-3.md`; earlier approval 56179c5). Diff base = ecd79cc.

## Test freeze
- `git diff b4110a4 HEAD -- web/tests/decor.test.ts web/e2e/look.spec.ts` is **empty**.
- `git diff ecd79cc HEAD --stat`: the only test files touched are the two **added** files, `web/e2e/look.spec.ts` and `web/tests/decor.test.ts`. No earlier test under `web/tests`, `web/e2e` or `crates/*/tests` changed. No Rust file changed.
- FIT_INSETS 140/96 → 120/120: no frozen test pins the old values.
  - Test 6 (`decor.test.ts:221`) uses its own literal `{140, 24, 96, 24}` to test `fitInsets` generically.
  - Test 5 uses `FIT_INSETS` symbolically.

## Commands run
| Command | Result |
|---|---|
| `cargo test --workspace` | all green (city_001 28, city_002 4 + 8 ignored, the pre-existing release-only tests, city_003 5, core_001 20, core_002 24, core_003 36, core_004 5) |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web build:wasm` | OK |
| `pnpm -C web test` | 14 files, **61/61 passed** |
| `pnpm -C web typecheck` | OK |
| `pnpm -C web build` | OK (JS 266 kB, wasm 146 kB) |
| `pnpm -C web e2e` (full suite) | **39/39 passed** (4.7 min) |
| Manual smoke test | Playwright MCP against vite on port 5197 (stopped afterwards). Screenshots in `.playwright-mcp/city-004-gold-1-*.png` |

## Red-reviewer items
- **(a) G4b in the browser: verified.** At tick 203: paused, then clicked "Close the main bridge".
  - 1.5 s later `closed = []`, tick 203. The button read "Main bridge closed — reopen (pending)", with `aria-pressed="true"`.
  - The screenshot shows no hatch or barriers (`04-paused-close-pending.png`).
  - After Space: `closed = [284, 285]` at tick 204, the first resumed tick. Hatch and barriers were drawn (`05-closed-5min-fit.png`).
- **(b) FIT_INSETS: not satisfied.** The city and labels clear the control panel and metrics strip, but the legend covers the city. See MAJOR 1. Measured values:

  | Viewport | Control panel | Metrics strip | Legend | City (link points) |
  |---|---|---|---|---|
  | 1280×800 | [16,16,302,116] | [16,728,545,784] | [968,611,1264,784] | [180,120,1100,680] |
  | 1280×720 | [16,16,302,116] | [16,648,545,704] | [968,531,1264,704] | [246,120,1034,600] |

  - No district label box intersects any panel at either size.
  - Labels are centred on their points (`translate(-50%,-50%)`), and the top row sits at y 113–128.
  - While "(pending)" wraps, the control panel grows to 131 px. It still clears the city's top road (y ≈ 140) horizontally and vertically.

## Findings

### MAJOR
1. **The expanded legend covers the fitted city (smoke step 1, "panels not covering the city", fails).** `web/src/styles.css` `.legend` (right 16, bottom 16, width 270) versus `web/src/render/layout.ts:14` `FIT_INSETS` right 24 / bottom 120.
   - The legend is expanded by default and is 296×173 px.
   - Reproduced with `linkScreenPoint` sampling at the default fit:
     - 1280×800: links 148–151, 260, 261, 272 and 273 lie under the legend.
     - 1280×720: links 150, 151, 272 and 273.
   - The south-east block (east boundary road and the Docks block) is hidden (`01-fit.png`, `12-fit-1280x720.png`).
   - Constraint for the fix: an asymmetric inset moves the fit centre, which the city-003 tests depend on. Options are a narrower or relocated legend, or a fit that reserves the legend's corner.
2. **The river visibly starts and ends inside the default view.** `web/src/render/cities/riverCity.ts:34` (`PROFILE_MARGIN_M = 500`) and lines 121–122.
   - The water and banks are cut off square at y ≈ 45 and ≈ 755 on 1280×800, and ≈ 55 and ≈ 665 on 1280×720. On both, the ends sit in the open background above and below the city (`01-fit.png`, `12-fit-1280x720.png`).
   - core-005's straight river used a 2000 m margin and filled the view.
   - This fails the § Visual direction / pass criterion ("nice water", "looks like a finished miniature city"). It reads as a prototype artifact in the very first frame.
   - Test 2 only requires coverage of at least ±500 m (`decor.test.ts:88–89`), so a larger margin is allowed (test 2 checks that the water fills the profile within 5 %).

### MINOR
1. **The bridge railing is invisible, and decks don't read at fit zoom.**
   - The railing colour `[0.03,0.035,0.04]` (`renderer.ts:36`) is drawn as 1 px `GL_LINES` (`renderer.ts:751`). It is darker than the background `0.055`, but the deck edge is effectively deck-against-ground.
   - In the zoom 1.0 and 5.3 screenshots, no "darker railing edge" is discernible (`02-main-bridge-z1.png`, `11-…-colour.png`).
   - At fit zoom (0.13–0.15 px/m) the 32 m deck is only about 4–5 px, so the three bridges read as plain roads (`01-fit.png`).
   - At zoom ≥ 1 the decks clearly read as wider-than-road decks.
2. **The halo of a selected closed road is hidden under its own hatch below about 2.6 px/m.** `renderer.ts:99–103`, pass order `[0, 3, 1, 2]` at line 769.
   - The halo half-width (`max(hw, 1.25 px) + 3 px`) is smaller than the hatch half-width (min 4.5 px).
   - Reproduced at 1280×720 fit: closed Main Bridge, then selected link 284 by clicking it, vehicles hidden.
   - Only 48 pixels changed, all in the 6 px junction gaps (`13c`/`13d` crops).
   - The side panel still shows the selection, but on the map the "selection = halo" cue nearly disappears for closed roads.
   - Suggested fix: grow the halo by the hatch width on closed links, or draw the halo after the hatch outside the hatch's width.
3. **The hatch is dropped entirely on closed links shorter than 14 px.** `renderer.ts:92`.
   - The shortest River City link is 198 m, so below zoom ≈ 0.07 (MIN_ZOOM is 0.05) a closed road shows only barriers.
   - Barriers remain, so this is not hue-only. It is still a weaker cue than specified ("closed = hatch + barriers + width").
4. **Cleanup item not done:** `laneOffset` is still exported (`web/src/render/geometry.ts:85`). The spec says to remove the orphan export and keep the math inside `vehiclePosition`. No other user exists (grep). `v_core` is removed as required.
5. **Draw order deviates from the spec.**
   - Spec: "… roads → route/halo → closed hatch + barriers → vehicles".
   - Implementation: the route is drawn after the hatch and barriers (`renderer.ts:784`).
   - Harmless (arguably better for a tracked car still on a closing link), but undocumented.
6. **Per-frame work.**
   - `setLinkState` runs on every sim frame and re-specifies the state texture with `texImage2D` (`renderer.ts:674`); `texSubImage2D` would avoid that.
   - It also builds `Array.from(closed).join(',')` (`renderer.ts:596`).
   - The label loop writes 2 style strings × 22 labels on every rAF even when the camera is unchanged (`App.tsx` rAF loop).
   - Measured cost is negligible (see Performance), so this is a hygiene item.
7. `key={l.text}` on the labels (`App.tsx`, labels map) collides if two zones share a name. Prefer the index or the zone node.
8. Pre-existing: `compile()` never calls `deleteShader`, so every StrictMode remount or dispose leaks 2 shader objects per program (`renderer.ts:304–319`).

## Spec check (implemented and verified)
- **Decor:**
  - pure (no `Math.random` in `web/src/render`);
  - generic fallback in `cities/index.ts`;
  - `LABEL_ICONS` exported;
  - buildings are grid-placed with exact segment-box clearance.
- **Link table:** 1024-wide 2D table. `linkTexel` matches the GLSL `LINK_TEXEL_GLSL` (`row*u_linkRows + i/1024`). The state texture uses `(i%1024, i/1024)` in a 1024×rows texture, which is correct above 1024 links.
- **Congestion:**
  - driven by occupancy (`linkCounts`/capacity; `linkCapacity` matches Rust `lanes × max(1, floor(len/7.5))`);
  - full effect at 50 % occupancy;
  - +3 px width only below 0.5 px/m;
  - congested links drawn in pass 3 above the others.
- **Hatch:**
  - its own pass after roads and halo, inset 6 px at each end;
  - world-anchored with a constant px period (test 10 green);
  - barriers at 12 % and 88 % with a near-white core and dark edge.
- **UI:**
  - labels positioned in the rAF loop (code-checked, per Red m3);
  - legend with `aria-expanded`, five SVG samples, localStorage wrapped in try/catch;
  - no-WebGL2 alert with every sim control disabled (keyboard handlers are no-ops without a client);
  - the B key ignores repeat.
- **Hook:** `setDebug`, `linkCapacity` and `approachLinks` are present and used by the tests.
- **Layering:**
  - Rust is untouched;
  - no screen coordinates or colours in Rust;
  - rendering never feeds back (`hideVehicles` only skips a draw).
- **Draw calls:** at most 17 per frame (8 decor + 4 road passes + bars + route + vehicles + ring), so under 20.

## Manual smoke test (Playwright MCP, vite on port 5197)
1. **Open (`01-fit.png`, `12-fit-1280x720.png`):**
   - River with banks and a gentle meander.
   - Buildings per district, subtle and low-contrast. Parks.
   - Labels with icons, 12 px, letter-spaced, with a shadow.
   - **Fail:** the legend covers the south-east corner (MAJOR 1) and the river ends in view (MAJOR 2).
   - Bridges: decks are visible only at zoom ≥ 1 (`02-main-bridge-z1.png`).
2. **Zoom into a junction (3.38 px/m, `03-detail-junction.png`):** dashed lane markings, building outlines and readable cars all show. **Pass.**
   - Brake bands are visible on the queued Old Bridge cars (`10`/`11`, 5.3 px/m).
3. **Close the Main Bridge, then 5 sim min at 20×** (closure at tick 204, then sim 08:50):
   - Hatch and barriers are unmistakable at fit zoom, with no hatch on the cross roads (`05`, `06`).
   - Congested approaches are lighter and slightly wider (`06-closed-novehicles.png`).
   - Grayscale, via `filter: grayscale(1)` on the document:
     - the closed hatch is distinct;
     - water is lighter than land;
     - queued squares with a dark rear band, slim moving cars, the lighter congested road and the white selection halo stay distinguishable (`07-closed-fit-grayscale.png`, `10-oldbridge-queue-selected-grayscale.png`).
   - The Old Bridge (link 288) reached 36/53 = 68 % occupancy. **Pass**, except MINOR 2 (selecting a closed road at overview zoom).

## Performance
- Draw calls: at most 17 per frame, counted from the code.
- rAF interval at 1280×720 fit, running at 20×, 1673 active vehicles: median 13.3 ms, p95 14.0 ms, max 14.3 ms. This is vsync-bound on a 75 Hz display, with no dropped frames.
- Not compared numerically with core-005. A frame-time measurement is due in city-005.

## Housekeeping
- No source or test file was modified. `git status` is clean apart from this review file.
- The screenshots are in the git-ignored `.playwright-mcp/`.
- The vite server on 5197 was stopped. Ports 4243 and 5273 were not touched.
