# city-004 Gold review, round 2

**Verdict: REJECTED** (1 BLOCKER, 0 MAJOR, 3 MINOR)

Reviewer: fresh adversarial Gold subagent. Implementation = HEAD 9a94255 (r1 fixes). Red snapshot = b4110a4. Diff base = ecd79cc.

## Test freeze
- `git diff b4110a4 HEAD -- web/tests/decor.test.ts web/e2e/look.spec.ts` is **empty**.
- `git diff --name-status ecd79cc HEAD`: the only test files are the two **added** files (`web/e2e/look.spec.ts`, `web/tests/decor.test.ts`). `web/src/ui/testHook.ts` gained hook functions, but it is not a test file. No earlier test under `web/tests`, `web/e2e` or `crates/*/tests` changed. No Rust file changed.

## Commands run
| Command | Result |
|---|---|
| `pnpm -C web build:wasm` | OK |
| `pnpm -C web test` | 14 files, **61/61 passed** |
| `pnpm -C web typecheck` | OK |
| `pnpm -C web build` | OK (JS 268.7 kB) |
| `cargo test --workspace` | all green (20, 24, 28, 36, 4 + 8 ignored, 5, 5) |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web e2e` (full suite) | **38 passed, 1 FAILED**: `look.spec.ts:184 labels_follow_camera_while_paused` (test 13). Expected Δx −30, received 276.09 |
| `pnpm -C web exec playwright test e2e/look.spec.ts -g labels_follow --repeat-each 15` | **14 failed, 1 passed** (the same 276.09 offset every time) |
| Manual smoke test | Playwright MCP against vite on port 5196 (stopped afterwards). Screenshots in `.playwright-mcp/city-004-gold-2-*.png` |

## r1 findings: status
| r1 finding | Status |
|---|---|
| MAJOR 1: legend covers the city | **Resolved.** The legend is [560,734,1264,784] at 1280×800 and [560,654,1264,704] at 1280×720. The city spans y 132–604 at 720 and ≤ 680 at 800. The legend is also clear of the Old Bridge approach (y 692–716 at 800). |
| MAJOR 2: river ends in view | **Resolved.** The river runs off the top and bottom of the canvas at both sizes (`01`, `03`). |
| m1: railing invisible / decks don't read at fit | **Partly resolved.** Decks now read as 12 px lighter slabs at fit. The railing is still barely visible over land; see MINOR 2. |
| m2: halo hidden under the hatch | **Resolved.** The halo on selected closed link 284 is clearly visible at fit, in colour and in grayscale (`05`, `06`). |
| m3: hatch dropped below 14 px | Accepted and documented. |
| m4: `laneOffset` export | **Resolved** (no references left). |
| m5: draw order | **Resolved.** The order is decor → decks → pads → roads (0, 3) → halo (1) → route → hatch (2) → barriers → vehicles → ring (`renderer.ts` draw). |
| m6: per-frame work | Resolved (`texSubImage2D`, array compare for barriers), **but the label gating introduced the BLOCKER below**. |
| m7: label keys | **Resolved** (`${i}:${text}`). |
| m8: shader leak | **Resolved** (`deleteShader` after link). |

## Findings

### BLOCKER
1. **District labels are never positioned after load: they pile up at the top-left corner until the user pans or zooms. Frozen test 13 is red.** The cause is `web/src/App.tsx:254–263`, introduced in 9a94255 ("labels are repositioned only when the camera moves").
   - `onReady` (`App.tsx:146–149`) sets `labelsRef.current` and fits the camera synchronously, but the `<span>`s only mount when React commits `setLabels` later.
   - The first rAF after `onReady` sees `moved = true` and records the label array and camera in `labelCam`. Every `labelEls.current[i]` is still `null` at that point, so nothing is positioned.
   - From then on `moved` stays false until the camera changes. The spans keep empty `style.left` and `style.top`, and their boxes sit at (−65…−25, −7).
   - Reproduced:
     - In the real browser at 1280×800, 3 s after load, all 22 labels had empty `style.left` and `style.top` (`city-004-gold-2-01-fit-1280x800-labels-unplaced.png`, garbled text at top-left). They appeared only after a drag (`02`).
     - At 1280×720, 2 of 3 fresh loads were unplaced (0/22, 0/22, 22/22).
     - In e2e, test 13 failed 14 of 15 runs. Its "before" boxes are the unplaced ones, so after the drag Δx is 276 instead of −30.
   - This breaks smoke step 1 ("labels with icons") and the frozen test, and it is a user-visible regression on the first frame of the demo.
   - Fix direction: only commit `labelCam` when every element was placed (or `labelEls` is complete), or invalidate `labelCam.labels` from a `useLayoutEffect` on `labels`.

### MINOR
1. **Not verified by any test: label repositioning also depends on `labelEls` identity.** Any future remount of the spans with the same `labels` array and an unchanged camera, for example a key change or StrictMode ref churn, has the same failure mode. The fix for the BLOCKER should cover "elements changed" generally, not just the first load.
2. **The railing edge is still nearly invisible over land.** `renderer.ts:29, 207`: the railing is `(0.02, 0.022, 0.025)` and 1.5 px wide.
   - The decks are 400 m long, and the river is only about 70 m of that. Over land the railing (pixel 5,6,6) sits next to the background (14,17,21), a step of about 9/255.
   - Measured at fit 1280×720, x 620, y 132/142–143. Over water (19,46,69) it is clearly visible.
   - At detail zoom 4.5 px/m the same holds (`08`, y 265 and 444).
   - The decks do read as decks (a lighter 12 px slab, wider than the road), so this is cosmetic. The spec item "with a darker railing edge" is met only over water.
3. **On the deck, the road is darker than the deck itself** (road 61–65 vs deck 69 at fit, `03`). The bridge's own road nearly vanishes into the slab at overview zoom. Vehicles, hatch and halo still read on top, so no state is lost. This is a look item only.

## Spec check (verified this round)
- **GL resources:**
  - `deckProg` is deleted in `dispose`;
  - the deck mesh is in `allMeshes()`, so it is freed on `setNetwork` and `dispose`;
  - railings and their mesh are gone (no leftover colour or mesh; grep `railing` hits only the deck shader).
- **State texture:**
  - `setNetwork` re-allocates it with `texImage2D` at the new row count before any `texSubImage2D`;
  - `setLinkState` is a no-op before `setNetwork` (`geometry` guard), so there is never a `texSubImage2D` into an unallocated or smaller texture.
- **Barriers:** the closed-set array compare resets on `setNetwork` (`barClosed = []`).
- **Labels:** canvas resize (camera width/height) and follow mode (camera cx/cy) do trigger repositioning; verified in the browser while following, where `left` changed every sample. The new-network case is the BLOCKER.
- **Hue-only signals:**
  - none found;
  - grayscale at fit shows the hatch, the barriers and the white halo on closed link 284 (`06`);
  - detail grayscale shows queued squares with dark bands, slim moving cars and lighter congested roads (`07`).
- **Render never affects the sim:** no new worker calls were added in the diff; deck, legend and labels are render-only. Rust is untouched.
- **Draw calls:** 15 per frame at most (7 decor incl. deck + 3 road + route + hatch + bars + vehicles + ring), so under 20.
- **Orphaned exports:** `DECK_MIN_PX`, `HATCH_JUNCTION_INSET_PX`, `BARRIER_AT` and similar are exported but used only inside `renderer.ts`. These are documented constants and are not flagged.

## Manual smoke test (Playwright MCP, vite on port 5196)
1. **Open, 1280×800 and 1280×720:**
   - Panels do not cover the city. Control panel [16,16,302,116]; metrics [16,648|728,545,704|784]; legend as above.
   - The river runs off-screen. Decks read as decks.
   - **Fail:** the labels were unplaced on first load (BLOCKER). After a pan they are centred on their points and clear of the top inset (`03`).
2. **Detail zoom 4.5 px/m at the Old Bridge west end (`07`, `08`):** lane dashes, building outlines, queued squares with brake bands and moving slim cars all show. **Pass.**
3. **Close while paused:** paused at tick 614, then clicked "Close the main bridge".
   - 1.5 s later `closed = []`, tick 614, and the button read "Main bridge closed — reopen (pending)" (`04`).
   - After Play, `closed = [284, 285]` at tick 629. **Pass.**
   - Then 5+ sim min at 20× (sim 00:12:52): the hatch and barriers are unmistakable, the approaches are congested and lighter, and the halo on the selected closed link shows in grayscale (`05`, `06`). **Pass.**
4. **Follow and route:**
   - Followed trip #4130 at 20×. The tracked screen centre stayed within 5 px of (640, 360) over 2.5 s.
   - The dashed route line and the ring are visible (`09`). **Pass.**

## Performance
At 1280×720 fit (0.128 px/m), running at 20× with about 2,020 active vehicles, the rAF interval was: median 13.3 ms, p95 14.1 ms, max 14.4 ms. That is vsync-bound (75 Hz) and unchanged from r1.

## Housekeeping
- No source or test file was modified. `git status` is clean apart from this file.
- The screenshots are in the git-ignored `.playwright-mcp/`.
- vite on 5196 was stopped. Port 4243 was not touched.
