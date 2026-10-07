# Review city-003 RED 1

**Reviewer:** adversarial test reviewer (fresh subagent, round 1), 2026-10-07
**Verdict:** REJECTED (1 BLOCKER, 4 MAJOR, 6 MINOR)

Scope: `.wdd/wards/city/ward-003.md`, `.wdd/epics/city.md` § C4, `.wdd/epics/core.md`, and the tests at commit 26ec428:
- `crates/sim-core/tests/city_003_inspect.rs` (tests 1–5)
- `web/tests/inspect.test.ts` (tests 6–10)
- `web/e2e/inspect.spec.ts` (tests 11–16)

I also read the existing code they build on: `world.rs`, `frame.rs`, `cities.rs`, `params.rs`, `host.ts`, `clock.ts`, `geometry.ts`, `camera.ts`, `picking.ts`, `App.tsx`, `testHook.ts`, `playwright.config.ts`, `tsconfig.json`, and the earlier e2e suites that click roads.

## What I ran

I built a scratch crate at `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/r003/proto`. It depends on the worktree's `sim-core` by path and does not modify it. It reproduces the premises through the existing public API. For the Vitest premises it also replays the host's exact tick schedule: `SimClock` at 60× with fake time += 16 ms gives a backlog of +1.92 per iteration and `floor`, so the cumulative ticks are 1, 3, 5, … and 60 iterations reach tick 115.

| Premise | Result |
|---|---|
| Test 7: a vehicle on its final link exists in the frame after `advance(60)` (tick 115) | **No.** There are 344 records and **0** have `route_pos == route.len() - 1` |
| Same, after 100 / 150 / 200 / 300 iterations | 7 / 6 / 39 / 81 final-link vehicles. The first one completes after 16 / 11 / 5 / 14 frames, and all of them complete |
| Tests 1 and 6: on-network count at tick 1200 | 1640 (> 500). 0 stranded |
| Test 2: live trips at 2400 | 1766 (> 500), with 5565 completed |
| Test 3: three_bridges completed at 1200 | 261. With every bridge closed at 1200, at 1900: removed_unreachable 111, **removed_gridlock 0** (so `gone.len() == removed_unreachable` holds). The ring builder is byte-identical to city_001's, which asserts a gridlock removal within 3000 ticks |
| Test 8: frames have distinct ticks at 60× | Yes (no duplicates). The pick is 4 frames old, so it is retained. After `advance(30)` it is no longer retained |
| Test 15: Old Bridge (link 288, free flow 52.19 s) without a closure | cost − ff = 0.0 at every 120-tick sample through tick 1200. The first sample above ff + 1 is at **tick 1560** |
| Test 15: main bridge closed at t0 = 150 / 300 / 450 / 600 / 900 | cost > ff + 1 after 511 / 481 / 511 / 421 / 361 ticks, inside the 960-tick bound. The test discriminates |
| Earlier e2e road clicks: a vehicle within 43 m (8 px at fit zoom, about 0.187 px/m) of a bridge midpoint | Central bridge: first at **tick 221**, and 77 % of ticks after that. North bridge: first at tick 363, 28 % |

The Rust tests 1–5 look sound to me: the APIs match, the preconditions are measured, free flow uses the exact `free_flow_cost` expression, and test 5's queries are read-only. I could not run the TS or e2e tests because the API does not exist yet.

## BLOCKER

### B1. Test 7 `worker_tracks_one_vehicle` fails against a correct implementation (wrong premise)
After `r.advance(60)` the sim is at tick 115 (57.5 s). No vehicle is on its final link yet; I measured 0 of 344. So `expect(record).toBeGreaterThanOrEqual(0)` fails deterministically, whatever the implementation does.

**Fix:**
- Advance far enough. At 150 iterations (tick ≈ 288) there are 6 candidates, and the first completes 11 frames later. The completion stays deterministic because the clock is faked.
- Avoid a candidate that is about to arrive, which would make `goneIdx` 0. Pick one with remaining distance ≥ 30 m.

```ts
  const r = riverHost();
  r.advance(150);
  const f = r.frames().at(-1)!;
  const sim = r.sim();
  const len = r.ready.network.linkLength;
  let record = -1;
  let trip = -1;
  for (let i = 0; i < f.count; i++) {
    const t = sim.trip_at_record(f.tick, i);
    const d = decodeVehicleDetail(sim.vehicle_detail(t));
    if (d && d.route.length === 1 && len[d.link]! - d.s >= 30) { record = i; trip = t; break; }
  }
  expect(record).toBeGreaterThanOrEqual(0); // precondition (measured: 6 final-link vehicles at tick ≈ 288)
```

## MAJOR

### M1. Test 12: a missing ring passes, because the route highlight alone satisfies the ring check
The ring check counts light pixels (≥ 235) in a 30×30 box centred on the vehicle and needs a delta of ≥ 12. The spec, however, draws the dashed light route line along the remaining route with the current link first, so that line runs straight through that box. A dashed line ≥ 2 px wide over about 15–30 px of length gives about 15–60 light pixels. An implementation with **no ring at all** therefore passes.

The reverse also happens. The route check samples the midpoint of `trackedRoute[1]`. River City connectors are 140 m, about 26 px at fit zoom, so for a vehicle near a junction the next link's midpoint is about 13 px away and the ring can supply the "route" pixels.

Separately, the panel that opens can cover the sampled boxes. `clickableVehicle` checks for the canvas only *before* the panel exists, and light panel text would count as "ring" pixels.

**Fix:**
- Count only ring pixels **off the road axis**, using the tracked link's direction.
- Take the route sample at a route link whose midpoint is ≥ 30 px from the vehicle.
- Assert that every sampled box is still canvas after the panel opens.
- Pin a minimum ring radius in the spec (outer radius ≥ 7 px) so the off-axis band is meaningful.

```ts
/** Light pixels farther than `band` px from the line through the box centre along unit `dir`. */
async function lightOffAxis(page: Page, at: [number, number], w: number, h: number, dir: [number, number], band = 4) {
  const lum = await luminance(page, at, w, h);
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - w / 2, dy = y + 0.5 - h / 2;
      if (Math.abs(dx * dir[1] - dy * dir[0]) > band && lum[y * w + x]! >= 235) n++;
    }
  return n;
}
const onCanvasBox = (page: Page, [x, y]: [number, number], r: number) =>
  page.evaluate(([x, y, r]) => [[x, y], [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]]
    .every(([a, b]) => document.elementFromPoint(a!, b!)?.tagName === 'CANVAS'), [x, y, r] as const);
```
In the test:
1. After selecting, read `s.trackedRoute[0]`.
2. Compute `dir` from `linkScreenPoint(l, 0)` → `linkScreenPoint(l, 1)`, normalised.
3. Assert `onCanvasBox(v.at, 15)`.
4. Compare `lightOffAxis` before and after selection, requiring a delta ≥ 12.
5. For the route, choose the first `l` in `trackedRoute` whose `linkScreenCenter(l)` is ≥ 30 px from `v.at` and passes `onCanvasBox(mid, 12)`. A precondition asserts that such a link exists. If none does, try the next candidate vehicle.

### M2. Test 13 `follow_keeps_vehicle_centred` does not tell following apart from not following
- **The 12 px tolerance is wide at fit zoom.** Fit zoom is about 0.187 px/m (1280×800, 64 px padding, a 6000 × 3600 m city), so 12 px ≈ 64 m. At 1× even an arterial vehicle (13.9 m/s × 1.1) covers only about 46 m (about 8.6 px) in the 3 s window. An implementation that centres the camera **once** when Follow is clicked, and never again, passes.
- **A `null` from the hook ends the check early.** `if (p === null) break` lets an implementation whose `trackedScreenCenter()` always returns `null` pass with zero samples.

**Fix:**
- Add `camera: { cx, cy, zoom }` and `trackedState` to `snapshot()` in the ward spec's hook additions.
- Zoom in before measuring: wheel at the canvas centre until `zoom ≥ 2`, with the poll loop used in review2 because the wheel rate is unspecified.
- Choose a vehicle whose `trackedState === 'driving'`; otherwise press Escape and take the next candidate.
- Require ≥ 4 non-null samples, unless the panel shows the gone text.
- Require the camera centre to move ≥ 5 m over the window.

```ts
  let samples = 0;
  const c0 = (await snap(page))!.camera;
  for (let k = 0; k < 6; k++) {
    await sleep(500);
    const p = await page.evaluate(() => window.__livingcity!.trackedScreenCenter());
    if (p === null) { await expect(page.getByRole('region', { name: 'Selected vehicle' })).toContainText(/Arrived after|Removed:/); break; }
    samples++;
    expect(Math.hypot(p[0] - centre[0], p[1] - centre[1])).toBeLessThanOrEqual(12);
  }
  const c1 = (await snap(page))!.camera;
  expect(samples).toBeGreaterThanOrEqual(4);
  expect(Math.hypot(c1.cx - c0.cx, c1.cy - c0.cy)).toBeGreaterThanOrEqual(5); // the camera really followed a moving car
```
At zoom 2, a car that is not followed leaves the 12 px circle within about 0.5 s.

### M3. "Vehicles first" picking puts earlier approved e2e suites at risk, and makes busy roads hard to select at fit zoom
The ward says "A click tries vehicles first, then roads" with an 8 px tolerance. At fit zoom 8 px ≈ 43 m. Several earlier, frozen tests click `linkScreenCenter` of a bridge and expect `selectedLink`:
- `city.spec.ts` test 6;
- `review1` G3 and N2;
- `review2` G5 HiDPI, which clicks a second time after a wheel-zoom loop;
- `gold5` G1 (north bridge).

I measured that from **tick 221** on, a vehicle is within 43 m of the central bridge midpoint in 77 % of ticks. These tests pass today only because they click within roughly the first 50–150 ticks, at 20× and about 40 ticks/s. That is an implicit timing dependency, and the ward's Must DO, "All earlier suites stay green unchanged", rests on it without saying so. On a slow runner, especially the DPR 2 test after its zoom loop, a click can land after tick 221 and select a car instead. The same rule also means a user cannot select a congested road at fit zoom, which is exactly when road stats matter. Tests 15 and 16 only work around this by scanning for a vehicle-free point.

**Fix (pick one and write it into the ward spec):**
- (a) Pick vehicles first only when the click is within the vehicle's *drawn* footprint plus about 3 px. This reduces the risk but does not remove it.
- (b) Pick a vehicle only if it is nearer than the road's centreline distance minus some margin.
- (c) Keep the rule. Document the dependency in the ward ("earlier road-click tests click before tick ≈ 200; measured first conflict at tick 221"), and make the Gold reviewer run `city.spec`, `review1`, `review2` and `gold5` three times each.

Today the risk is unacknowledged. It must at least be stated, with (c), so that Gold checks it.

### M4. `NetworkArrays.linkSatFlow` cannot type-check against both frozen `render.test.ts` and test 10
`tsconfig.json` includes `tests/`, and `build` = `tsc --noEmit && vite build`, which is a pass criterion. `render.test.ts` (frozen) builds `NetworkArrays` literals in `smallNetwork()` and `lineNetwork()` without `linkSatFlow`:
- If the field is **required**, as the ward's "NetworkArrays gains linkSatFlow" implies, those literals are type errors.
- If it is **optional**, test 10's `Array.from(r.ready.network.linkSatFlow)` is a type error under `strict`, because `undefined` is not iterable or ArrayLike.

Gold cannot satisfy both without editing a test.

**Fix:**
- In the ward, declare `linkSatFlow?: Float32Array`, optional like `SimLike.city_name?`.
- In test 10, write `expect(Array.from(r.ready.network.linkSatFlow ?? [])).toEqual(Array.from(sat));`. An empty array still fails against a non-empty `sat`.
- Also state that the new `SimLike` methods (`vehicle_detail`, `trip_outcome`, `link_detail`, `trip_at_record`, `link_sat_flow`) are optional or guarded, as existing fakes may lack them.

## MINOR

1. **Spec/test threshold mismatch (tests 12 and 15).** The spec says the ring and route are "light". The tests require luminance ≥ 235. Pin "luminance ≥ 235 (near-white)" in the ward. Similarly, test 15 parses `link-cost`, `link-freeflow` and `link-capacity` by stripping non-digits, so a format like `1:05` or `1 min 5 s` would parse wrongly. Pin "seconds as an integer or decimal number plus unit" (e.g. `57 s`) and "veh/h as a plain number".
2. **State precedence is unspecified.** Test 6 expects stranded to take precedence over queued, but the ward's state-code list does not say so. Add "stranded takes precedence over queued; queued = on network with v < QUEUED_SPEED".
3. **No precondition before closure in test 15.** Add `expect(await num('link-cost')).toBeLessThanOrEqual((await num('link-freeflow')) + 1)` before the closure. I measured cost = ff at these ticks, so it holds. Without it, a pre-congested bridge would make the "after closure" check trivial.
4. **Query budget is not tested.** "At most one `vehicle_detail` / `trip_outcome` / `link_detail` per encoded frame" has no check. Cheap to add to test 7: wrap the Sim in a counting `Proxy` in `createSim` and assert ≤ 1 call of each per `iterate()`.
5. **`removed_log` hash coverage is untested.** I accept this, since it cannot be observed from outside without contrived worlds, but the Gold reviewer should read `state_hash` for it explicitly.
6. **`vehicle_at` index type.** Test 1 passes a `usize` (`*k`, `10_000`), but the ward signature does not name the type. Write `index_from_front: usize` in Outputs.

## Not a problem (checked)
- **Test 8.** One frame is encoded per iterate, with distinct ticks, so 4 frames old is retained and 30 frames is not. A pick resolved against the current frame fails, because a different trip is at that record.
- **Test 9.** A 1-lane link has lane offset 0, so `worldToScreen(s, 0)` is the exact centre. ±7 / ±9 px and the tie at s = 25 are correct.
- **Clicking while paused.** The renderer extrapolates only while `clock.running`, so the unextrapolated centre is what is drawn when paused (tests 11, 12, 16). While paused, the host still encodes a frame every 16 ms with the same tick, so the clicked frame is always retained.
- **Test 14.** At 60×, 90 s of wall time is about 90 sim min, far beyond River City trip lengths, and a gridlock removal takes 10 min.
- **Test 16.** About 10 focusable controls in total, so 25 Tabs is enough, including wrap-around.
- **Test 3.** The scenarios are real and the counts reconcile (gridlock removals 0 in the closure scenario).
- **Earlier tests.** No earlier test pins literal `state_hash` values, so adding `removed_log` to the hash is safe.
