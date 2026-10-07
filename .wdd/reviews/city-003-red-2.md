# Review city-003 RED 2

**Reviewer:** adversarial test reviewer (fresh subagent, round 2), 2026-10-07
**Verdict:** REJECTED (1 BLOCKER, 1 MAJOR, 4 MINOR)

Scope: `.wdd/wards/city/ward-003.md`, `.wdd/epics/city.md` § C4, round 1 (`city-003-red-1.md`), and the tests at commit 48ce14b:
- `crates/sim-core/tests/city_003_inspect.rs` (1–5, unchanged since r1)
- `web/tests/inspect.test.ts` (6–10)
- `web/e2e/inspect.spec.ts` (11–17)

I also read the code these tests build on: `App.tsx`, `camera.ts`, `geometry.ts`, `picking.ts`, `renderer.ts` (vehicle pass), `host.ts`, `styles.css`, `testHook.ts`, `playwright.config.ts`, `tsconfig.json`, and the zoom/click paths in `review2.spec.ts`. `git diff --stat 3347245 48ce14b` confirms that no earlier test file changed.

## What I ran

I built a scratch crate at `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/r003b/proto`. It is a copy of the r1 setup with a new `main.rs` and depends on the worktree's `sim-core` by path. It reproduces the e2e view in Rust:
- River City with seeds (2026, 7), the same as `App`;
- `buildRoadGeometry`'s two-way offset, `vehiclePosition`, and `Camera.fit` on a 1280×800 canvas with 64 px padding;
- `zoomAt` at the canvas centre in ×1.16 steps, the wheel factor per −100 delta;
- approximate overlay rectangles for the controls, the metrics strip and the road panel;
- the `clickableVehicles` ±16 px on-canvas rule, in record order.

| Premise | Result |
|---|---|
| Fit zoom and camera centre | 0.1797 px/m, centre (70, 70) m, which is the middle of the Main Bridge. `zoomIn(1.5)` lands on 1.665 px/m and `zoomIn(2)` on 2.240 px/m, both about the same world point |
| When `ready()` returns (`frameRecords > 300`) | First on-network count above 300 at **tick 102**. With the default 20× (40 ticks/s) and `expect.poll`'s default back-off, the pause lands at about tick 105–180 |
| Vehicles in the zoomed view (z = 1.665 / 2.24), ticks 120–180 | **0 / 0** at every sampled tick. The first vehicle appears at tick 200 (1–2 of them). Counts are 4–5 at 220–240, 13–15 at 400, 22 at 460, and 25–50 at 500–900 |
| Test 12, with ticks ≥ 200 | The first or second candidate always has a remaining route link whose midpoint is ≥ 30 px away and on the canvas. Every chosen candidate is on a **2-lane** link, which puts its lane centre ±2.9 px off the drawn centreline. The route continues straight (turn 0°) |
| Test 13 at z = 2.24 | A driving vehicle (v ≥ 2, not stranded) is among the first 20 candidates at every tick ≥ 200. Its displacement after 6 ticks (about 3 s at 1×) is ≥ 17 m for ticks 200–720. At ticks 840–880 some candidates stop briefly, giving only 5.0–6.1 m |
| Test 7 (host's 60× schedule, 150 iterations) | Tick 288. The first final-link record with ≥ 30 m to go is record 745, trip 19, with 124 m left. It is gone 12 iterations later (goneIdx = 11), **completed**. B1 is fixed |

I could not run the TS or e2e tests, because the API does not exist yet (Gold).

## Round-1 findings: status

- **B1 (test 7 premise):** fixed. Measured above.
- **M1 (ring vs route):** partly fixed. The off-axis band, the ≥ 30 px route link and the canvas checks after the panel opens are all in place. One gap remains: the band ignores the lane offset. See M1 below.
- **M2 (follow):**
  - fixed: zoom ≥ 2, at least 4 non-null samples, the camera moves ≥ 5 m, `trackedState === 'driving'`;
  - premise holds at ticks ≥ 200, but see the BLOCKER.
- **M3 (vehicles-first picking):** fixed. Picking is zoom-gated (`VEHICLE_PICK_MIN_ZOOM` = 1). I checked the earlier suites:
  - `review2` N2 zooms to about 5 px/m but makes no clicks after zooming;
  - `review2` G5 clicks after one notch, at about 0.21 px/m;
  - the other earlier road clicks happen at fit zoom.
  Test 17 covers the rule.
- **M4 (`linkSatFlow`):** fixed. The field is optional and test 10 uses `?? []`.
- **Minors 1–6:** fixed. Formats and the 235 luminance threshold are pinned, stranded takes precedence over queued, test 15 has its precondition, the counting Proxy enforces the budget, Gold must read `state_hash` for `removed_log`, and the index is `usize`.

## BLOCKER

### B1. Tests 11, 12, 13, 14 and 16 zoom into an empty part of the city (wrong premise)
`zoomIn` wheels at the canvas centre. After `camera.fit` that point is the bounds centre (70, 70) m, the middle of the Main Bridge.

`ready()` returns as soon as `frameRecords > 300`, which first happens at tick 102. With the poll back-off and `pause()`, the sim stops at about tick 105–180. At those ticks the zoomed window holds **no vehicles at all**, at either 1.665 or 2.24 px/m. No cross-river traffic reaches the bridge area before about tick 200; r1 independently measured the first vehicle near the bridge midpoint at tick 221.

So, deterministically and for any implementation:
- `clickableVehicle` fails `all.length > 0` in tests 11, 14 and 16;
- test 12 throws "no candidate";
- test 13 fails `found`.

This is a test gap (a), verified fixable. Let traffic reach the centre before pausing. In `ready()`, after the `frameRecords` poll, add:
```ts
  // the zoomed tests look at the Main Bridge (canvas centre); cross-river traffic reaches it from tick ≈ 200
  await expect.poll(async () => (await snap(page))!.tick, { timeout: 60_000 }).toBeGreaterThanOrEqual(450);
```
This adds about 9 s at 20×. I checked what it does to each test:

| Test(s) | After the fix (pause at about tick 450–500) |
|---|---|
| 11, 14, 16 | 13–26 candidates at 1.665 px/m |
| 12 | Candidate 0 qualifies |
| 13 | 9–19 candidates at 2.24 px/m, a driving one is found, and 6-tick displacement is ≥ 17 m |
| 15 | Old Bridge cost = free flow through tick 1200 (r1), so the precondition holds. A closure at about tick 450 makes cost > ff + 1 after 511 ticks, within the 960 bound (r1) |
| 17 | Unaffected |

An alternative is to zoom with the cursor on a vehicle's fit-zoom screen centre. `zoomAt` keeps that point fixed, so at least one candidate is guaranteed. That alone does not guarantee 20 candidates or a driving one, though, so the tick wait is the simpler fix.

## MAJOR

### M1. Test 12: a missing ring still passes when the route line is ≥ about 4 px wide (lane offset)
`lightOffAxis` measures the band (> 4 px) from the axis through the **vehicle centre**. The route highlight, though, is a centre line on the **drawn link centreline**. Every candidate test 12 picks in River City is on a 2-lane link (measured), where the lane centre sits ±1.75 m off the centreline, which is ±2.9 px at 1.665 px/m.

The spec allows any route width ≥ 2 px. A dashed line of width 4 covers offsets from 0.9 to 4.9 px on one side of the vehicle axis. That fills a full pixel row beyond the band along the 30 px box, about 15–18 near-white pixels after dash duty, which meets the ≥ 12 delta with **no ring drawn**. Widths of 5 px or more pass trivially.

This is a test gap (a) with a concrete fix. The geometry is measured; the pixel counts are analytic, since there is no implementation yet. The route line lies on one side of the vehicle, while a ring is symmetric around it, so require off-axis pixels on both sides:
```ts
async function lightOffAxisSides(page: Page, at: [number, number], w: number, h: number, dir: [number, number], band = 4) {
  const lum = await luminance(page, at, w, h);
  const n = [0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - w / 2;
      const dy = y + 0.5 - h / 2;
      const perp = dx * dir[1] - dy * dir[0];
      if (Math.abs(perp) > band && lum[y * w + x]! >= 235) n[perp > 0 ? 0 : 1]!++;
    }
  return n as [number, number];
}
```
Then, using the "before" luminance with the same per-side split:
- assert the total delta ≥ 12;
- assert **each side's** delta ≥ 4.

A real ring meets this. An annulus of radius 5–7 px puts about 20 px² beyond |perp| = 4 on each side. Neither the route line nor a turning next link can supply both sides.

## MINOR

1. **The ring's upper size is unpinned (spec/test mismatch).** The spec says "outer radius ≥ 7 CSS px" but sets no upper bound. Test 12 samples a 30×30 box, so the ring must fit within a 15 px radius. A ring sized in world metres, for example 10 m (16.7 px at 1.665 px/m), meets the spec and fails the test. Pin "outer radius 7–12 CSS px, constant in screen space", or enlarge the box to 40×40 and `onCanvasBox(v.at, 20)`.
2. **`trackedScreenCenter` semantics (test 13).** The hook says `vehicleScreenCenter` is unextrapolated but does not say what `trackedScreenCenter` is. If Gold follows an extrapolated position, for smoothness, while the hook reports the unextrapolated one, the gap at 1× is up to v × dtSim. Pin it: "the screen position the vehicle is drawn at (the position Follow centres)".
3. **Test 13 trip-end risk.** If the chosen driving vehicle completes within about 3 s, `samples < 4` fails. That is rare at 1×, but it is cheap to exclude: accept a candidate only if `trackedRoute.length >= 2`.
4. **Test 13 displacement margin later in the run.** If the pause slipped to tick 840 or later, I measured candidates whose 6-tick displacement is only 5.0–6.1 m against the ≥ 5 m bound. With the B1 fix (pause at about tick 450–500) the margin is ≥ 17 m. Keep the tick wait bounded, so do not wait for a much later tick.

## Not a problem (checked)
- **Rust tests 1–5** are unchanged since r1, which found them sound. I agree.
- **Test 6.** The f32 rounding, the state mapping and the route head are correct.
- **Test 8.** Retention of 8 frames is correct, and so is the out-of-range index behaviour (−1 is not equal to the old trip).
- **Test 9.** Correct.
- **Test 10.** The Main Bridge gives 2 × 0.5 × 3600 = 3600, and the Old Bridge gives 0.25 × 3600 = 900.
- **The counting Proxy** forwards `typeof` and `in` and binds methods to the real `Sim`, so host guards still see functions.
- **Test 15.** The pinned formats parse correctly ("52.2 s", "900 veh/h"). `clickableRoadPoint` is valid at fit zoom, because vehicles are never picked there.
- **Test 17.** It has more than 10 on-canvas centres (over 300 records, stride 11). A vehicle centre always lies within its link's pick radius.
- **Earlier e2e suites.** No road click happens at ≥ 1 px/m (see M3 above). Escape with no tracked vehicle still clears the road. No earlier pixel test tracks a vehicle.
- **Type-check.** The new hook members used by the tests (`camera`, `trackedRoute`, `trackedState`, `frameRecords`, `vehicleScreenCenter`, `trackedScreenCenter`, `linkScreenPoint`, `pickAt`) are all named in the ward. I found no strict-mode or `noUncheckedIndexedAccess` problems in the test code beyond the missing API.
