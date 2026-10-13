# motion-004 Red gate, round 2: REJECTED

## Verdict: REJECTED (4 BLOCKER, 1 MAJOR, 6 minor)

Reviewer: a fresh adversarial test-review subagent. Reviewed the Red commit b4a01cd and the fix commit 7a6637c.

Test hashes (sha256) as reviewed:
- `web/tests/motion004.test.ts`: fb3566a5be71e7a9e0b28027ff71231d85aaf75fedeeb253942717286943854d
- `web/e2e/motion004.spec.ts`: 8da2b66622e064ae4baa0a12d878315e7acd416f7fc3bb6a9249783d5cb49cb5

Load average: 13.60 / 14.89 / 13.75 at the start, 18.16 / 22.29 / 21.11 at the end. Other sessions shared the machine.

## Commands and results
- `pnpm -C web exec vitest run tests/motion004.test.ts` gave **4 failed / 4**, each for the right reason:
  - test 1: `buildingKinds.length` was 0, not 2140;
  - test 2: the marks Set had size 1;
  - test 3: `DECOR_COLORS.water` was undefined;
  - test 4: `ROAD_MIN_PX.major` was 2.5, below 5.5.
- `cd web && node_modules/.bin/playwright test -c zz-alt-port2.config.ts e2e/motion004.spec.ts --reporter=line` gave **5 failed / 5**:
  - 5 failed at "every link in exactly one class";
  - 6 failed at "residential shown at fit zoom";
  - **7 failed at "queued cars measured on a light road" (0 < 4)**. This is the measurement precondition, not the seam (see B-N4);
  - 8 failed at "the Main Bridge closure ring";
  - 9 failed at the legend "ring".
- **Emulation probes.** I made a copy of `web/` in the scratchpad, with `node_modules` symlinked, and ran its own Vite on port 5288, which I stopped afterwards. No repo file was changed apart from this verdict. In the copy I implemented the ward's spec as written:
  - **character values:**
    - fills 0.08 / 0.112 / 0.144 / 0.176, each mark +0.028;
    - `ROAD_BASE.major` (0.31, 0.335, 0.37);
    - `ROAD_MIN_PX` 5.5 / 2.5;
  - **`buildingKinds`** by the spec rule; test 1 passes up to `padKinds`, which I did not emulate;
  - **renderer:**
    - per-class road width and base colour, and the `u_pass == 1` halo gate;
    - per-kind building fills, with marks from zoom ≥ 1 (lines 1.2 m wide);
    - a car outline of max(0.6 px, 0.25 m) from 1.5 px/m;
    - corner brackets with corners at (±7, ±7) px;
    - a route with a 2.5-px casing;
    - a 9-px end square, 2-px line;
  - **the five hooks** and **the spec's legend texts**.

  I then ran `e2e/motion004.spec.ts`, diagnostic variants of it (`zzdiag`, `zzv`, `zzleg`), and the frozen set (look, gold5, inspect, motion, layout, review2, motion003, motion003_gold) against that copy. I ran the frozen set twice: once with the spec's new legend text and once with today's.

## Round-1 findings

| R1 | Resolved? | Evidence |
|---|---|---|
| B1 test 7 passed via brake bands | **Yes (logic); flaky selection is a new issue, B-N4** | On the current build, the cross-lane profile counted 14/17/6 cars and 0 seams in 3 runs (e.g. `134,134,134,176…176,134,134,134`), so it fails for the right reason. With the emulated outline, a seam reads 10 on both sides of the body: `…73,73,10,176…176,10,10,73…`. |
| B2 test 6 infeasible (all kinds per visit) | **Partly**: one kind per visit is fixed, but test 6 is still infeasible (B-N2, B-N3) | — |
| B3 test 8 had no qualifying car | **No** (B-N1) | — |
| M1 casing / end mark / hooks not discriminating | Yes | The 2 dark px on both sides fail against today's 1-px edge. The end probes sit off the route axis. `routeEnd` is checked against `linkScreenPoint(last, 1)` and `trackedMarker` against `trackedScreenCenter`. With bounded pans, the emulation passes casing 16/16 and the end mark. |
| M2 test 5 zero margin / light artefact | Yes | Emulation: majors 7 px against locals 3 px (needs ≥ 4.5); light 84.4 against 68.0 (needs +8). Test 5 passes. |
| M3 wide-zoom cars | Yes | 7(a) is an intended guard; it passes on the stubs and on the emulation. |
| M4 fill spacing | Yes | Spacing 0.03 and marks from zoom 1, threshold 6. The emulation measured fills 20/29/37 and marks were found at zoom 1 and 3. |
| m1 hooks trusted | Partly | `roadClasses` is still not compared with the pure `roadClass` (arterials). `districtSamples` kind and mark are not checked against `buildingKinds`. |
| m2 decor literal regex | Yes | — |
| m3 pad shapes drawn | Yes | Ratios check out: square 1.0, 24-gon 0.776, cross 0.556. |
| m4 `edgeAt` | Yes | — |
| m5 spec text (ring r−3…r−1, radiusPx) | Yes | — |
| m6 three_bridges margin | Yes | Test 9 passes on the emulation. |
| m7 compare untested | No (still optional) | — |
| m8 railing exclusion | Yes (justified in the spec) | — |

## New findings

### B-N1 BLOCKER: test 8 is still infeasible (B3 not resolved)
**1. The candidate rule finds no car.** I ran test 8's own flow on the emulation: `?demand=3`, Main Bridge closed, more than 300 ticks, zoom 2.17 at the bridge.
- 24 links have occupancy ≥ 0.5 (all ≥ 40 m).
- Of the 20 clickable candidates, every one is on an axis-aligned link, but the remaining routes have **max occupancy 0.09–0.41**. None reaches 0.5.
- So the test throws "a followed car … with a congested link ahead".

**2. The drags cannot reach off-canvas subjects.** With the threshold lowered to 0.3, the congested link (136) had its middle at page **(84, −258)**, which is off the page. `dragTo(point(...), FREE)` presses the mouse off the canvas, so nothing moves ("after" = the same point), and the casing check measures 0 dashes. `dragTo(end.page, FREE)` has the same flaw.

**Proof that the checks themselves are feasible.** With bounded pans and the threshold at 0.3, the whole of test 8 passes on the emulation:
- the ring;
- the brackets;
- the casing 16/16;
- the end mark on a diagonal last link (0.707, −0.707).

The bounded pans were repeated map drags from FREE, clamped to ±300/±200 px, until the subject sits at FREE.

**Fix:**
- Replace each `dragTo(subject, FREE)` with a bounded pan loop like this one (or motion002's `panTo`).
- Choose the candidate so that a qualifying link exists. For example:
  - take the first candidate whose remaining route has the **most** occupied link, requiring ≥ 0.3;
  - or search the candidates while the sim runs at 20× until one has a route link ≥ 0.5;
  - or loosen the threshold to "occupancy ≥ 0.3 and the hidden-vehicle road lum at the dash ≥ 100" (the light road is the point of the check).

### B-N2 BLOCKER: test 6's first step needs a `districtSamples` result the hook contract cannot give at fit zoom
- Fit zoom at 1280×800 is **0.1497 px/m**.
- Residential boxes are at most 46 × 0.8 = 36.8 m wide and 39 m deep, so at most **5.5 × 5.9 px** on screen. No point inside them is ≥ 3 px from all edges, so `districtSamples` must omit residential at fit zoom.
- The other kinds' boxes are ≤ 10 px. The centred mark (court square at 0.3–0.7, ridge or cross at the centre) leaves no point ≥ 3 px from both the edges and the mark.
- My spec-faithful hook returned `[]` at fit zoom. Test 6 fails at "residential shown at fit zoom" for a correct implementation.

**Fix:** let the test pick each kind's start building from data instead of the hook. One option is to apply the 3-px rules only at zoom ≥ 1 and return the box centre below that. Another is for the test to take the world box nearest the screen centre from `decor.buildingKinds` (exposed or recomputed) and wheel at its centre.

### B-N3 BLOCKER: test 6's "a local road on screen" fails for the hospital at zoom 3
I used a hook relaxed as in B-N2.
- Residential and workplace passed every check at zoom 1 and 3: fill, mark peak, and crop (99th percentile 40 against road median 91.6 / 68.0).
- The hospital passed at zoom 1. At zoom 3 it failed "a local road on screen at zoom 3": around the east-edge hospital building, no local link's **midpoint** lies on the 427 × 267 m view.
- Waterfront was never reached.

**Fix:** find the comparison road by its on-canvas *points*, not its midpoint. For example, sample t = 0.05…0.95 on local links and use the first on-canvas point ≥ 4 px inside the canvas. Alternatively, compare with the nearest local road point to the building.

### B-N4 BLOCKER: test 7(b)'s queue choice is fragile, and fails outright once the spec's legend text is implemented
- **The anchor is not checked against overlays.** `wheelZoom` anchors at `point(pins[0].link, 1 − 30/len)` without checking that the point is on the canvas.
  - In 4 of 6 observed runs, `pins[0]` is **link 288** (52–53 queued), with its anchor at page **(655, 680)**.
  - With the spec's legend texts, the Legend panel grows from [561, 700, 1264, 750] to **[405, 638, 1264, 688]**, measured with real fonts. `elementFromPoint(655, 680)` is then `SECTION.panel legend`, so the wheel never reaches the canvas and `wheelZoom` times out (seen in the emulated run).
- **Picking another pin does not help.** Taking the first pin whose anchor is on the canvas gave link 306: diagonal, 2 lanes, 4 cars. Its hidden road is lum 93, below the 100 cut-off, so `measured` = 0.
- The official stub run also ended with `measured` = 0. Which queue the test sees depends on wall-clock timing at 20× (pins differed: 131/288/54 in my runs).

**Fix:** choose the link, not `pins[0]`. Use any link with `linkQueued ≥ 8`, axis-aligned, 1 lane, occupancy ≥ 0.5 (light road). Pan its point to FREE with a bounded pan *before* wheeling at FREE, and iterate links until ≥ 4 cars are measured. Keep `measured ≥ 4` as a hard requirement.

### MAJOR M-N1: the spec's legend text, implemented as it reads, breaks 4 frozen tests
I ran the same emulated renderer twice with the frozen set; only the legend text differed.
- With today's legend text: **42 passed, 1 failed**. The one failure is layout `compare_frame_and_supported_widths`, an artefact of my copy (README path); it passed after I copied the README.
- With the spec's texts ("…barriers, ring", "…halo, corner brackets, dashed route"): **4 failed, 39 passed**:
  - gold5 `fix G1: a hovered road…` (0 < 60: the Old Bridge centre is now under the Legend);
  - inspect `road_panel_real_stats` (no clickable Old Bridge point);
  - look `labels_follow_camera_while_paused` (the drag landed on the panel: 0 ≠ −30);
  - look `congestion_reads_in_grayscale` (`onCanvas` false).

The spec forbids changing frozen tests and requires the new texts, but it says nothing about the Legend's footprint. An implementer following it literally lands here.

**Fix:**
- Add to the spec: "the Legend's box at 1280×800 (expanded) is no larger, and no higher, than today's [561, 700, 1264, 750]", for example by wrapping or shortening the sample column, or by putting the shape words in the SVG titles.
- Add that bound to test 9.

Otherwise the new rendering is compatible with the frozen set: look #9–15, gold5, inspect #12 (brackets), motion #9/#10 (ring), layout, review2 N2 and motion003(+gold) all passed with the emulation.

### minor
- **mi1. Test 2 has no float tolerance.** Fills exactly 0.03 apart (0.115 / 0.145) give 0.029999…, which fails. Test 3 uses `+ 1e-9`; do the same in test 2, for the spacing and for the mark +0.024.
- **mi2. Mark headroom.** With fills spaced 0.03, the brightest fill's mark can be at most `DECOR_MAX` − fill. A spec-minimum mark (+0.024 ≈ 6.1 levels) drawn as 1-px `GL_LINES` blends below fill + 6 under MSAA, which test 6 then rejects. The spec should state a mark stroke of ≥ 1.5 px at zoom 1 (or ≥ 1 m), or mark contrast ≥ +0.035, and push the fills down to fit.
- **mi3. m1 is still open.** Compare `roadClasses()` with the pure `roadClass` in the page (both tests 5 and 9). Return the box index from `districtSamples` and check `kind` and `mark` against `buildingKinds` / `DISTRICT_STYLE`.
- **mi4. The end-mark orientation is unspecified.** The last route link can be diagonal (observed (0.707, −0.707)). With an axis-aligned square, the ±4.5-px probes land inside the square and pass only through the 3×3 max. State "aligned to the last link" in the spec, or move the probes onto the square's axes.
- **mi5. "Decor below roads" and "marks in the decor pass" are untested** beyond luminance. A cheap check: at zoom 3, a building box crossed by nothing and a road pixel next to it are unchanged when buildings are hidden. Optional.
- **mi6. Compare mode (m7) is still unexercised.** Optional.

## Summary of what must change before Red can pass
1. Test 8: bounded pans instead of single drags from off-canvas points, and a candidate rule that finds a car (B-N1).
2. Test 6: a start sample that exists at fit zoom (B-N2), and a local-road probe that does not need a link midpoint on screen (B-N3).
3. Test 7(b): link selection independent of `pins[0]`, with an anchor on the canvas before wheeling (B-N4).
4. Spec + test 9: bound the Legend's footprint so the new texts keep the frozen tests green (M-N1).
