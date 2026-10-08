# city-004 Gold review, round 3

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 2 MINOR)

Reviewer: fresh adversarial Gold subagent. Implementation = HEAD 0101eac (r1 fixes 9a94255 + r2 fixes 0101eac). Red snapshot = b4110a4. Diff base = ecd79cc.

## Test freeze
- `git diff b4110a4 HEAD -- web/tests/decor.test.ts web/e2e/look.spec.ts` is **empty**.
- `git diff --stat ecd79cc HEAD -- . ':!.wdd/reviews'`: the only test files touched are the two **added** files (`web/e2e/look.spec.ts`, `web/tests/decor.test.ts`). No earlier test under `web/tests`, `web/e2e` or `crates/*/tests` changed. No Rust file changed.

## Commands run
| Command | Result |
|---|---|
| `pnpm -C web build:wasm` | OK |
| `pnpm -C web test` | 14 files, **61/61 passed** |
| `pnpm -C web typecheck` | OK |
| `pnpm -C web build` | OK (JS 269.0 kB, wasm 145.8 kB) |
| `cargo test --workspace` | all green (28, 4 + 8 ignored, 5, 20, 24, 36, 5) |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web e2e` (full suite) | **39/39 passed** (5.1 min) |
| `pnpm -C web exec playwright test e2e/look.spec.ts --repeat-each 10` | **90/90 passed** (test 13 `labels_follow_camera_while_paused` 10/10) |
| `pnpm -C web exec playwright test e2e/inspect.spec.ts --repeat-each 10` | **70/70 passed** |
| `pnpm -C web exec playwright test e2e/gold_city003.spec.ts --repeat-each 10` | **30/30 passed** |
| Manual smoke test | Playwright MCP against vite on port 5195 (stopped afterwards). Screenshots in `.playwright-mcp/city-004-gold-3-*.png` |

Note: part of the manual smoke ran while the look.spec repeat run was going; it stayed 90/90 anyway.

## Earlier findings: status
| Finding | Status |
|---|---|
| r1 MAJOR 1: legend covers the city | **Resolved.** Legend [560,734,1264,784] at 1280×800 and [560,654,1264,704] at 1280×720, inside the bottom inset band. The city's link extent stays above it (`01`, `07`). |
| r1 MAJOR 2: river ends in view | **Resolved.** The river runs off the top and bottom of the canvas at both sizes (`01`, `02`/`07`). |
| r1 m1 / r2 m2: railing invisible | **Resolved.** A two-tone railing (dark outer line, mid-grey inner line) is visible over both water and land at 1.2 px/m and 3.9 px/m (`04`, `05`). At fit the deck is a 12 px slab with edges (`03`). |
| r1 m2: halo hidden under hatch | **Resolved.** The selected closed link 284 shows a white halo frame around the hatch at fit, in grayscale (`08`, `08b`). |
| r1 m3: hatch dropped below 14 px | Accepted and documented. |
| r1 m4–m8 | **Resolved**: no `laneOffset` export, draw order per spec, `texSubImage2D`, unique keys, `deleteShader`. |
| r2 BLOCKER: labels unplaced after load | **Resolved.** 5 fresh loads at 1280×800 and 5 at 1280×720 gave 22/22 placed every time. No label-label overlap and no label-panel intersection; the top label row starts at y 113. Test 13 passed 10/10 in the repeat run and in the full suite. |
| r2 m1: remounted elements | **Resolved by design.** Each element carries its own generation in a `WeakMap`, and the ref callback places on mount. Resize also keeps labels world-anchored: the label-to-Main-Bridge offset in metres stayed exactly the same (0 m drift) for 1280×800 → 1000×640 → 1280×800 while paused. Labels also track the camera in follow mode (`style.left` changed on every sample). |
| r2 m3: deck road darker than deck | **Resolved.** The deck (0.17–0.21) now lies between the background and the road (0.24–0.31). The road and its lane dashes read clearly on the deck (`04`, `05`). |

## Findings

### MINOR
1. **Labels are rewritten on every React commit, not "only when the camera moves"** (contradicts the r1 refinement note in the ward). The cause is `web/src/App.tsx:505–508`, an inline ref callback.
   - The callback gets a new identity on each render, so React calls ref(null) and then ref(el) on every commit, and `placeLabel` runs for all 22 labels.
   - App re-renders on every sim frame (`setFrame`, App.tsx:206).
   - Reproduced: with the camera unchanged and the sim running at 20× for 2 s, I instrumented `style.left` on each label element and counted **2,222 writes** (22 labels × about 101 commits), over 150 rAFs and 79 ticks.
   - It is functionally harmless (always the current camera, about 44 small writes per commit) and cheap. To match the stated intent, memoise the ref callback per index, or place only when the element is new (`labelPlaced` lacks it).
2. **The hover halo on a congested road is closer in lightness than on a plain road.** In the road shader, hover is 0.72 grey (`renderer.ts:146`) and a fully congested core is ≈ 0.58 luminance (`renderer.ts:138`).
   - The halo still extends 2 px beyond the road edge, so the cue is width, not only lightness.
   - It was not a failure in any screenshot: the selected (white) halo on congested and closed roads read fine in grayscale.
   - Cosmetic; note it for city-005 polish.

No BLOCKER or MAJOR found.

## Spec check (verified this round)
- **GL resources:**
  - `dispose` frees every mesh, including decks and bars, plus the route, ring, vehicle buffers, both textures and all 7 programs;
  - shaders are deleted after linking;
  - `setNetwork` frees old meshes and re-allocates the state texture at the new row count before any `texSubImage2D`;
  - the bar mesh is rebuilt only when the closed set changes (array compare).
- **Draw order (`renderer.ts:814–902`):** water → banks → parks → buildings (→ outlines ≥ 2 px/m) → decks → pads → roads (pass 0, congested pass 3) → halo (pass 1) → route → hatch (pass 2) → barriers → vehicles → ring. This matches the spec plus the documented r1 refinement.
- **Draw calls:** at most 15 per frame (< 20).
- **Hue-only signals:** none.
  - closed = hatch + barriers + 9 px minimum width;
  - congestion = width (+3 px below 0.5 px/m) + lightness;
  - queued = square + dark brake band;
  - selection = white halo / ring.
  - Grayscale screenshots at fit and detail keep every state distinguishable (`08`, `10`, `13`).
- **Render never affects the sim:** no new worker messages in the diff; `hideVehicles` only skips a draw; decor, labels and legend are render-side. Rust is untouched; no screen coordinates or colours in Rust.
- **Decor:** pure, no `Math.random` (`hash01` is a deterministic sin-hash); `PROFILE_MARGIN_M = 2000`; generic fallback in `cities/index.ts`.
- **Orphaned exports:** the remaining unused-outside exports are documented renderer constants (as in r2), so not flagged.
- **Per-frame allocations:** `draw` allocates small temporaries (the `scale` tuple, the `fill` closure, the `[0,3,1]` literal), and `setLinkState` uses `forEach`. Negligible, and not new hot-path regressions.
- **Close while paused applies only on resume:** paused at tick 42 and clicked "Close the main bridge".
  - 1.5 s later `closed = []`, tick 42, and the button read "Main bridge closed — reopen (pending)" with `aria-pressed="true"` (`06`).
  - After Play, `closed = [284, 285]` at tick 43.

## Manual smoke test (Playwright MCP, vite on port 5195)
1. **Open, 1280×800 (`01`) and 1280×720:**
   - meandering river with banks, running off-screen;
   - three bridge decks with railings;
   - subtle buildings and parks per district;
   - 22 labels with icons, letter-spaced, with a shadow, centred on their points;
   - panels clear of the city. **Pass.**
2. **Detail zoom:**
   - Main Bridge at 3.9 px/m: deck with two-tone railings over water and land, the road and its lane dashes visible on the deck, readable cars (`05`).
   - Junction at 3.9 px/m: dashed lane markings, faint building outlines (`12`).
   - Old Bridge west approach at 3.4 px/m: queued squares with brake bands next to slim moving cars, colour and grayscale (`09`, `10`). **Pass.**
3. **Close the Main Bridge, then about 14 sim min at 20×:**
   - hatch and barriers unmistakable, with no hatch on cross roads (`07`);
   - congested approaches lighter and wider;
   - Old Bridge link 288 at 53/53 occupancy;
   - grayscale keeps the closed road, its halo when selected, congestion and queued cars distinguishable (`08`, `08b`, `10`). **Pass.**
4. **Follow and route:**
   - selected trip #4678 and followed it at 20×;
   - the tracked screen centre stayed within 6 px of (640, 360) over 2.4 s;
   - the dashed route and the ring are visible (`11`). **Pass.**

## Housekeeping
- No source or test file was modified. Only this verdict file was written.
- Screenshots are in the git-ignored `.playwright-mcp/`.
- vite on 5195 was stopped (port verified free). Port 4243 was not touched.
