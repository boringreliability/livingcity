# motion-004 Red gate, round 1 — REJECTED

Reviewer: fresh adversarial test-review subagent. Red commit b4a01cd.
Artifacts reviewed:
- `.wdd/wards/motion/ward-004.md`, `.wdd/epics/motion.md` (M4), task memo §4, investigation § Character (B), `CLAUDE.md`.
- Stubs: `web/src/render/cities/character.ts`, decor fields, hooks in `testHook.ts` / `App.tsx`; current `renderer.ts`.
- Frozen tests read: look #9–15, gold5 (spec + test), inspect #12, motion #9/#10, motion002 gpu test, review2 N2, city.e2e opening/G4.
- Test hashes (sha256):
  - `web/tests/motion004.test.ts` 0136455c…ac4f
  - `web/e2e/motion004.spec.ts` 6dd72a00…4f7164

## Verdict: REJECTED (3 BLOCKER, 4 MAJOR, 8 minor)

## Commands and results
Load average at start: 13.52 12.03 14.78; at the end: 8.15 11.31 12.88.

- `pnpm -C web exec vitest run tests/motion004.test.ts` → 4 failed out of 4, each for the right reason:
  - 1: `buildingKinds.length` 0 ≠ 2140;
  - 2: the marks Set has size 1, not 4;
  - 3: `DECOR_COLORS.water` is undefined;
  - 4: `ROAD_MIN_PX.major` 2.5 < 3.75.
- `cd web && node_modules/.bin/playwright test -c zz-alt-port2.config.ts e2e/motion004.spec.ts --reporter=line` → **4 failed, 1 passed** (1.6 min):
  - 5 fails at "three measurable major links" (the `roadClasses` stub is empty);
  - 6 fails at "residential shown at fit zoom" (the `districtSamples` stub);
  - **7 PASSED on the stubs**;
  - 8 fails at "the Main Bridge closure ring" (the `closureSigns` stub);
  - 9 fails because the legend text lacks "ring".
- Probes. These are my own Node + Playwright scripts in the scratchpad, run against a dev server on port 5288 (stopped afterwards); no repo file was changed.
  - They compute the spec's road classes and block kinds in the page from the real wasm and the real `cityDecor`, with exactly the test's selection logic.
  - For some measurements they intercept `renderer.ts` and set the road minimum to 4.5 px for every road.
  - The results are cited in the findings below.

## Findings

### B1 BLOCKER: test 7 (`queued_cars_countable_at_close_zoom`) passes on the unchanged renderer
It passed in the Red run, so it does not specify the new behaviour (the dark outline seam).

Why it passes today:
- Every queued car already has a dark brake band at its rear: `VEH_FS` colour (0.22, 0.10, 0.02), lum ≈ 31, and at zoom 5 the band is 0.22 × 3.6 m ≈ 4 px long.
- The body is lum ≈ 176.
- The profile along the lane therefore already alternates ≤ 90 → ≥ 150 once per queued car, so `runs` equals the car count.

**Fix:** measure the seam where the brake band cannot produce it. For example:
- a profile *across* each car through its middle on a congested road (lum ≈ 133, which is > 90): require a sample ≤ 90 within 1.5 px outside the bright body on both sides;
- and/or count runs along a lane of *moving* (non-queued) cars that bunch at the queue's tail.

Keep the requirement that the count must be ≥ 4. The test must fail on b4a01cd.

### B2 BLOCKER: test 6 is infeasible; "all kinds sampled at zoom 1/3" cannot hold
The test zooms at one kind's building and then requires `districtSamples(near)` to return all four kinds, each fully on the canvas. The hospital is about 2.3 km east of the residential and workplace samples. My probe used the spec's kind rule and the test's start points (the building of each kind nearest the canvas centre), then wheel-zoomed exactly as the test does and listed the kinds that have a box fully on the canvas:

| zoom on | at ~1.06 px/m | at ~3.09 px/m |
|---|---|---|
| residential (−592, 78) | residential, waterfront | residential, waterfront |
| workplace (−652, 638) | workplace, residential, waterfront | residential, workplace |
| hospital (1628, −720) | workplace, hospital | workplace, hospital |
| waterfront (376, −727) | waterfront, workplace | waterfront, workplace |

No step sees four kinds, so only a hook that breaks its own contract ("fully on the canvas") could pass.

**Fix:**
- Require only the zoomed-at kind at each zoom.
- Collect the four fills per zoom across the four visits, which the code already does via `at[kind]`.
- Then compare them pairwise.

Related: at zoom 3 the 200×200 crop (about 67 m) holds no road pixels in any of the four cases (`roads: 0`), so the 99th-percentile "subordinate" check is silently skipped there. Either assert `roadLums.length > 20` (and pick a crop that contains a road), or say in the spec that it only runs at zoom 1.

### B3 BLOCKER: test 8 cannot find a qualifying car, so it would throw for a correct implementation
I replayed the test's flow on the current build: `?demand=3`, 20×, Main Bridge closed, more than 300 ticks, paused, labels hidden, zoom 2.17 at the bridge, and the same candidate list (23 cars). I used `trackedScreenCenter` and `linkScreenPoint(lastRouteLink, 1)` in place of the stub hooks.

Result: `{"notd":0,"axis":0,"cong":23,"end":23,"ok":0}`. For none of the 23 followed cars was a remaining route link with occupancy ≥ 0.5 on the canvas, and for none was the route's end on the canvas. The loop ends in `throw new Error('no followed car …')`.

**Fix:** decouple the three checks:
- the marker on any followed car on an axis-aligned link;
- then drag the map, which keeps the tracking, to a route link with occupancy ≥ 0.5, choosing a candidate whose route has one anywhere (for example by searching for the trip while running, or by allowing occupancy ≥ 0.5 on any route link and panning to it);
- then drag to `routeEnd()`.

Bound the pans and keep the zoom at ≥ 2 for the marker.

### M1 MAJOR: test 8's route casing and end mark are not discriminating, and `routeEnd`/`trackedMarker` are not checked against the picture
- **Casing.** The current route already has a 1-px dark edge (`ROUTE_FS`, 0.05 → lum ≈ 13) on both sides of every dash. A 24×24 clip on a dashed route gains far more than 6 pixels ≤ 50 today, so the "casing dark" assertion passes without the 1.5-px casing. **Fix:** measure the casing's width. Across the route at a dash on a congested road, require ≥ 2 consecutive pixels ≤ 50 on each side of the white core, which today's 1 px fails.
- **End mark.** A 15×15 clip at the route's last point already contains the last ≈ 7 px of the dashed route, up to ≈ 21 pixels ≥ 235 depending on the dash phase. It can therefore gain ≥ 12 with no end mark at all. A lying `routeEnd()` could also point at any dash. **Fix:**
  - assert `routeEnd().page` is within 1 px of `linkScreenPoint(route[last], 1)`;
  - test the square's shape off the route axis, for example lit pixels at ±4.5 px perpendicular to the last link's direction where the 3-px route core cannot be, and lit pixels beyond the end point along the direction.
- **Marker.** Assert `trackedMarker().page` is within 1.5 px of `trackedScreenCenter()`.

### M2 MAJOR: test 5 width ratio has zero margin, and its "light" metric is dominated by an existing renderer artefact
- **Width.** At fit zoom (0.150 px/m) the cross-section measures the *union of the two twin links*, which overlap almost fully, not one road.
  - Measured today: majors 4 px and locals 4 px.
  - With every road forced to a 4.5-px minimum, the majors (links 10–15) measure exactly 6 px.
  - The test needs `major ≥ 1.5 × widest local` = 1.5 × 4 = 6, so the margin is zero: one sub-pixel shift of the camera fit and the test fails.
- **Light.** Today the locals selected (links 20–25, 1 lane, all empty) measure `light` 82.6–83.2, while the majors measure 69–70. The cause is a continuous 1-px line of lum 97 along one edge of the local road (patch dump: rows 59/68/68/**97**/17). It comes from the base road pass itself: it disappears when pass 0 is disabled.
  - I believe it comes from `ROAD_FS`'s `if (abs(v_across) > 1.0) base = … vec3(0.72)`, which is not gated on `u_pass == 1`. Interpolation lets edge fragments slightly exceed 1, so pass 0/3 edges pick up halo grey.
  - With the spec's `lum(major) ≥ lum(local) + 0.05` (+12.75), majors land at ≈ 82 against a required ≥ 90.6, so the test fails with the spec's own numbers.

**Fix:**
- Measure `light` robustly: the median of the road pixels, or the pixel nearest the centreline.
- Compare twin pairs against the pairs' nominal widths, or raise `ROAD_MIN_PX.major` (e.g. 5.5) so the measured ratio has ≥ 1 px of headroom.
- Add the `u_pass == 1` gate on the halo colour to the spec as an in-scope renderer fix.
- Also require `linkCounts[l] === 0` instead of occupancy < 0.1: the congestion tint already starts at occupancy 0.025 and adds up to ≈ +13 lum at 0.1, so it confounds the brightness comparison.

### M3 MAJOR: the vehicle outline as specified makes cars unreadable at wide zoom, and nothing tests that
The outline is `max(0.6 px, 0.25 m)` *inside* the footprint at every zoom. At fit zoom (0.15 px/m) a moving car is 1.8 px wide (`MOVING_MIN_PX`), which leaves a 0.6-px bright core after MSAA. Moving cars then turn into dark specks on dark roads. That contradicts user point 3 and the brief's "congestion must be visible through vehicle behaviour".

No frozen test catches this:
- gold5 G2 checks only the constants;
- `opening_screen_is_alive` uses a mean diff > 0.05;
- the motion002, review2 N2 and inspect tests all run at zoom ≥ 1.5.

**Fix:**
- In the spec, apply the outline only from a zoom where the body keeps ≥ 2 px of bright core (e.g. ≥ 1.5 px/m), or keep the core at ≥ 1.2 px.
- Add a test: at fit zoom on an uncongested road, the moving cars' 3×3 max lum is ≥ 180 (vehicles shown vs hidden), for ≥ 10 cars.

### M4 MAJOR: point 1 is only weakly carried at medium zoom (luminance step of ≈ 4/255)
Marks are drawn only from `LOD_DETAIL` (2 px/m). Below that, the kinds differ by fill luminance alone, at ≥ 0.016 (≈ 4/255), and test 6 accepts a measured difference of ≥ 3. A difference of 3–4 levels on lum 25–50 is not perceptible. At zoom 1, which test 6 itself uses, the districts are therefore not "told apart without hue" in any practical sense. Pad shapes are not tested at all (see m3).

**Fix:**
- Raise the fill spacing to ≥ 0.03 (≈ 8/255). That is feasible: the fills could be 0.09/0.12/0.15/0.18, with marks ≤ 0.205 = lum(local) − 0.06.
- Raise test 6's threshold to ≥ 6.
- Alternatively, draw the marks from zoom ≥ 1 and assert them at zoom 1 too.

### minor
- **m1. Hooks are trusted where a check is cheap.**
  - `roadClasses()` is never compared with the pure `roadClass` (test 5/9 could import the module in the page, as my probe did, and compare).
  - `districtSamples().kind` and `mark` are not checked against `decor.buildingKinds` (return the box index and compare).
- **m2. Test 3 does not enforce the spec's "no decor colour literal stays in `renderer.ts`".** Importing the names and leaving `COLORS = { water: …}` passes. Assert that `renderer.ts` has no `water:|bank:|park:|building:|pad:` colour literals, or no `COLORS` object containing them.
- **m3. `PAD_SHAPE` being distinct is tested, but not that pads are *drawn* with those shapes.** Cheap pure check in test 1: per pad (zone order), the triangle count, extent and fill ratio match disc/square/cross (a cross's area ÷ bbox < 0.7; a disc's ≈ π/4).
- **m4. Test 1 `edgeAt`.** For a quay vertex beyond the last profile point, `findIndex` returns −1, so `i = 1` and it extrapolates from the *first* segment. Use the last segment when y > the profile's end.
- **m5. Spec text.**
  - The closure ring is lit between r − 3 and r − 1 in the code (inner 4, outer 8, dark < 5 and > 7), not r − 4 and r − 1.
  - Define `trackedMarker.radiusPx` as the distance from the centre to the bracket corner vertex (the test samples at 0.71·r on the diagonals). An implementer who reports the square's half side would fail.
- **m6. Test 9's three_bridges width rule** sits near its boundary. Today, majors measure 7–8 px and locals 5–6. With majors at 4.5 px minimum they measure 9, against locals of up to 6 (needing 9). Same remedy as M2.
- **m7. Compare mode (two maps) is not exercised.** One cheap assertion would do: in compare, B's canvas also shows brackets for a followed car, or `closureSigns` exists for B. Edge cases are also untested: selection or hover over a *major* road (G1 still holds by my arithmetic: the halo is ±3 px beyond any core, and a major base of lum ≈ 80 is outside the 170–200 hover band), and a closed major road (hatch minimum 9 px > 4.5). Optional.
- **m8. Bridge railings are brighter than the roads** (inner railing lum ≈ 112 against local road ≈ 68), which goes against point 5. They are excluded from `DECOR_MAX_LUM` and from test 6's crop only within 25 px of a bridge axis. At zoom 3 the deck's half width is 60 px (`DECK_HALF_M` 20), so any test-6 crop near a bridge would fail. None did in my probes. Either justify the exclusion in the spec or cap the railing at the road's lum.

## Frozen-test conflict check (no conflict found, by arithmetic and code reading)
- **gold5 G1 select** (north bridge, now major): the white halo of 3 px each side gives ≫ 120 new pixels ≥ 245.
- **G1 hover:** a major base lum ≈ 80 stays out of the 170–200 band.
- **look #14:** the Old Bridge approach is a street link, so it is local. With a brighter base the congestion delta shrinks to ≈ 55 lum, which is still ≥ 10.
- **inspect #12:** brackets at radius 7–11 lie > 4 px off the axis on both sides.
- **motion #10:** the ring is unchanged.

Watch, though: M2's halo-grey edge artefact also affects `hover`-band counting if a road edge happens to fall at lum 170–200 after a change.
