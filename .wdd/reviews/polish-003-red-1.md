# polish-003 Red review 1

**Verdict: REJECTED**

Reviewer: fresh adversarial Red-gate subagent. Artifacts reviewed at HEAD `2709188`: `.wdd/wards/polish/ward-003.md`, the three test files, and the context listed in the brief. No implementation exists yet. Probes were written in the scratchpad, copied into the repo only while they ran, and deleted afterwards (`git status` is clean apart from this file).

## Test file hashes (sha256)
- `643093daa64a603b9d6f02d6c4139c4433cc1b13c6d07c6250d749e704eca1b7  crates/sim-core/tests/polish_003_next_links.rs`
- `4e2e8f69d876189a3d39ad404f11f2b6a8a7440eb9df99e74fc1c2915ab170a9  web/tests/motion.test.ts`
- `f42e7a0689cd58eb027fe4eef364c35632bf0818d13e75e94192e3d37b2d0727  web/e2e/motion.spec.ts`

## What I ran
1. **Rust test 1.** `cargo test -p sim-core --test polish_003_next_links` gives E0432 (unresolved `write_next_links` and `NO_NEXT_LINK`). That is the expected red.
2. **Vitest.** `pnpm -C web exec vitest run tests/motion.test.ts` gives "Cannot find module '../src/render/motion'". That is the expected red.
3. **Playwright.** `pnpm -C web exec playwright test e2e/motion.spec.ts` (port 5190) fails all 4 tests:
   - 7: `h.vehicleDraw is not a function`.
   - 8: `h.trackedDraw is not a function`.
   - 9: "hovered congested road: a dash pattern".
   - 10: passes at MIN_ZOOM (the existing 0.12/0.88 barriers fall inside the 14 px window), then fails at "0.07: the closure adds a bright marker (28 → 28)".
4. **Reference `motion.ts`, a literal reading of the spec.** I placed it temporarily at `web/src/render/motion.ts` and ran vitest with two control-point variants:
   - "literal": the control point is the in-lane/out-lane intersection, or the in-lane end when the lines are parallel.
   - "fixed": the control point is on the out-lane line behind P2.

   In both variants, tests 4, 5 and 6 pass and test 3 fails on `0→82 lane 0 at s=694.1: 0.388 > 0.25`. Over all 1336 River City (pair, lane) cases:
   - literal: 504 fail heading (a), 515 fail step (b), worst step 0.654 m;
   - fixed: 0 fail heading (a), 643 fail step (b), worst step 0.521 m;
   - chord |P2−P0| / B is up to 2.34. Even with arc-length parametrisation, 22 cases of the fixed curve need more than 0.25 m per 0.1 m step.
5. **Rust probe, tracked-car continuity (test 8).**
   - Setup: River City, default demand. I followed every moving car (v ≥ 2) from ticks 1850, 2400 and 3000 for 600 ticks (= 60 s wall at 5×).
   - Method: I applied the P3 extrapolation (continue onto `next`) at each frame arrival and compared with the next frame.
   - Results:

     | Start tick | Moving cars | Back-snap above the allowance | Lane mispredicted at an extrapolated crossing | Clean through 3 crossings |
     |---|---|---|---|---|
     | 1850 | 1681 | 1008–1037 | 797–818 | 63–68 |
     | 2400 | 1741 | 1055–1081 | 842–877 | 70–77 |
     | 3000 | 1579 | 877–920 | 778–818 | 62–65 |

     The ranges come from two counting variants of the probe. The median worst snap is 3.1–3.7 m and p90 is 6.0–6.4 m. 741–810 of the cars **finish their trip before 3 crossings**.
6. **Rust probe, blend-zone density (test 7).**
   - Setup: `river_city_scaled(2026, 7, s)` with s = 1 and 2, ticks 1810–1920. The box is ±160 × ±100 m around the Main Bridge midpoint, which is the 4 px/m view.
   - Result: 19–34 cars in view, **0** in a blend zone and **0** curved, at every sample.
   - The browser probe confirms it: `?demand=2` at zoom 4.04 shows `vis 28, blend 0`.
7. **Browser probe, test 10's windows.** The central bridge is 400 m long.

   | Zoom (px/m) | Bridge length on screen | Bright px before → after closure | Dark px before |
   |---|---|---|---|
   | 0.05 | 20 px | 22 → 46 | 64 |
   | 0.0602 | 24 px | 28 → 28 | 66 |
   | 0.170 | 68 px | 33 → 28 | 58 |
8. **Browser probe, frame timing at 5× on SwiftShader.**
   - rAF interval: median 37 ms, p95 49 ms, max 135 ms.
   - Wall time per tick: median 105 ms, p5 72 ms, p95 131 ms, max 149 ms (ideal is 100 ms).
9. **Test 1 feasibility (Rust probe).**
   - three_bridges closed: 161 records, 9 with `NO_NEXT` (5.6 %), **82 stranded, all with a route next link**, 25 next links closed.
   - river_city: 1633 records, 102 with `NO_NEXT` (6.2 %).

## Findings

### B1 (BLOCKER): test 8 cannot be passed by a correct implementation
**Where:** `web/e2e/motion.spec.ts:124–194` (the bound at :174, the exemption at :179, the end conditions at :185 and :191–193).

There are four independent causes, all measured.

1. **The sim decelerates instantly, and cars are held at stop lines.**
   - The sim decelerates instantly (`params.rs`: "Deceleration is instantaneous") and holds cars at the stop line when they have no discharge credit.
   - The P3 rule (continue onto `next`) therefore extrapolates a car up to v·0.5 s past where the next frame puts it. The next frame then snaps it back by 3–7 m.
   - The allowance `max(v)·Δt·1.2 + 0.9` is about 2.2 m at 14 m/s with 16 ms rAF.
   - Measured: 62 % of moving cars have such a snap within 300 sim s. Only about 4 % are clean through 3 crossings.
   - No renderer that follows the spec can avoid this, because it cannot know the credits or the leader's stop.
2. **The lane exemption is attached to the wrong sample.**
   - With extrapolation onto `next`, the link change happens *during extrapolation*, drawn in the predicted lane `min(lane, next.lanes−1)`.
   - When the frame with the sim's actual entry lane arrives, `prev.link === d.link`. The lateral jump of 3.5 m is therefore judged as an ordinary step and fails.
   - The spec (ward-003.md:75) explicitly allows that jump. It happens at 49 % of tracked cars.
   - Note also that a back-snap across the link end counts as a second "crossing".
3. **Frame arrival jitter on SwiftShader.**
   - A tick arrives every 72–131 ms (p5–p95) instead of 100 ms, and rAF runs at about 37 ms.
   - A late anchor followed by an on-time frame gives a forward jump of v·δ·0.005. At δ = 45 ms that is 3.2 m, on top of v·Δt, against an allowance of about 4 m.
4. **The tracked car often finishes its trip.**
   - 46 % of moving cars complete their trip before 3 crossings within the 60 s window. `trackedDraw()` then returns null, and the test resolves `lost: true` and fails.
   - The choice of car (first pickable, non-queued record) does not guard against this.

**Fix:** test geometric continuity, not timing or sim kinematics.
- Add `s` (and the frame tick) to `trackedDraw`.
- For consecutive samples, compute the along-route path distance between the two drawn states:
  - same link: |Δs|;
  - `prev.next == link`: `(len_prev − s_prev) + s_now`;
  - the reverse for a snap back across the end.
- Require world displacement ≤ path distance + 0.9 m.
- Exempt a lane change on the same link within one tick after a crossing, which is the frame correcting the predicted lane.
- Count a crossing only for forward link changes.
- Choose a car with `trackedRoute.length ≥ 5`, and re-track another car if the first one arrives.

### B2 (BLOCKER): test 7 cannot find 5 curved cars
**Where:** `web/e2e/motion.spec.ts:83–103`.

- At `?demand=2`, paused at about tick 1800, the 4 px/m view around the Main Bridge has 19–34 cars, and none of them is in a blend zone. That holds in Rust at every sample from 1810 to 1920 and in the browser.
- Free-flowing cars skip the last 6 m in a single 0.5 s tick (7 m per tick), and there are no stop-line queues near the bridge at that time.
- `expect(curved.length).toBeGreaterThanOrEqual(5)` therefore fails whatever the shader does.

**Fix:** create queues at junctions, then go to them.
- Close the main bridge, or use `?demand=3` as test 9 does, and run for about 120 sim s.
- At the overview zoom, use `vehicleDraw` over all records to find the junction with the most `inBlend` cars that are offset ≥ 1.5 m.
- Wheel-zoom to ≥ 4 px/m at that point.
- Optionally visit up to 3 such spots until there are ≥ 5 curved and ≥ 8 plain cars.
- Re-run the probe on the new setup before freezing.

### B3 (BLOCKER): test 3(b)'s 0.25 m per 0.1 m step bound is infeasible for the specified curve
**Where:** `web/tests/motion.test.ts:110–114`.

- The blend spans only B = min(6 m, length/2) of `s`, but the chord P0→P2 is up to 2.34·B (multi-lane left turns, two-way offsets).
- With t linear in s, a quadratic Bézier moves up to 2|C−P0|·0.1/B per step:
  - literal spec: worst 0.654 m, 515 of 1336 cases fail;
  - a variant with heading (a) fixed: worst 0.521 m, 643 cases fail;
  - even an arc-length reparametrised curve still fails 22 cases.

**Fix:** loosen the bound to something that still rules out the c1 jump (4.6 m median), for example **≤ 0.75 m per 0.1 m step**. A stricter alternative is ≤ 0.1·3·max(1, |P2−P0|/B). Validate the bound against a reference implementation before re-submitting. Alternatively, change the spec to B = min(12 m, length/2) and re-measure.

### M1 (MAJOR): the spec's control-point rule fails test 3(a) for right turns and parallel offset lanes
**Where:** `.wdd/wards/polish/ward-003.md:48`, which conflicts with `web/tests/motion.test.ts:105–108`.

- **Right turns.** The drawn in-lane end overshoots the out-lane line. The in/out intersection then lies *before* the in end and *beyond* P2 along `out`, so the tangent at s = length points backwards (heading error π).
- **Parallel lines with different offsets.** An example is a 2-lane two-way road into a 1-lane road. The in-lane end is used as the control point, so the end tangent is perpendicular to `out`.
- **Nearly parallel lines.** The intersection can be kilometres away.
- **Collinear straight-through.** C = P2, so the tangent is zero and the heading is NaN.
- Measured: 504 of 1336 cases fail heading (a) under the literal rule.

An implementer who follows the spec fails a test that is frozen at approval.

**Fix:** amend the spec. Use the intersection only when it lies ahead of P0 along `in` and behind P2 along `out`, within a bounded distance (for example ≤ |P2−P0|). Otherwise use C = P2 − dir(out)·|P2−P0|/2. If the tangent degenerates, fall back to dir(out). My "fixed" variant does this and passes (a) for all 1336 cases.

### M2 (MAJOR): test 10 contradicts the spec, is noisy from vehicles, and its dark check does not discriminate
**Where:** `web/e2e/motion.spec.ts:282–317`, and `ward-003.md:62`.

- **It contradicts the spec.**
  - The spec draws the glyph only "when a link is too short on screen for the hatch".
  - At the test's "0.07" (it lands at 0.060) the bridge is 24 px long, and at "0.2" (lands at 0.170) it is 68 px. Both are above the hatch threshold of 2·6 + 2 = 14 px, so the hatch is drawn and the spec requires no glyph.
  - The black/yellow hatch peaks at luminance 193, below the test's ≥ 220.
  - So the test demands a white midpoint glyph at every zoom. Measured with the hatch: 28 → 28 and 33 → 28.
- **Vehicles add noise.**
  - The bright pixels "before" (22–33) are moving cars (luminance ≈ 228) on the bridge.
  - Cars move between the before and after shots: 33 → 28 at 0.17 with nothing else changed.
  - A spec-minimum 6 × 6 px glyph with a dark outline adds about 16 bright pixels, so the +12 margin can be eaten by one or two cars.
- **The dark check never fails.**
  - "dark ≥ 12" is already met before the closure (58–66 pixels, from the railings and the background).
  - So the "dark outline" requirement is never tested.

**Fix:**
- Amend the spec to "a midpoint glyph at every zoom (in addition to hatch and barriers)", or make the test accept the hatch where it is drawn.
- Call `setDebug({ hideVehicles: true })` before both measurements.
- Require dark pixels inside a ring around the bright core, or `dark(after) − dark(before) ≥ 8`.

### M3 (MAJOR): stranded vehicles' next link — test 1 contradicts the spec, and the spec's 10 % is false
**Where:** `crates/sim-core/tests/polish_003_next_links.rs:49,56`, and `ward-003.md:39,81`.

- **Stranded vehicles.**
  - The spec writes `NO_NEXT_LINK` "when it … has no route". A stranded vehicle is documented as "on a link without a route" (`VehicleInfo::stranded`).
  - In `three_bridges_closed`, 82 of 161 records are stranded and **all** of them still have `route[route_pos+1]`. 25 of those next links are closed.
  - The test pins `route.get(route_pos+1)`, so an implementation that follows the spec fails.
  - Pinning the route next makes stranded cars curve and extrapolate onto a closed bridge and then snap back.
- **The 10 % threshold.** The spec says "at least 10 % are u16::MAX", but the measured share is 5.6 % and 6.2 %. The test only asserts ≥ 1, which is consistent with the data but not with the spec.

**Fix:**
- Decide that stranded vehicles (and, arguably, those whose next link is closed) get `NO_NEXT_LINK`.
- Assert in the test that ≥ 1 stranded record exists and that each has `NO_NEXT_LINK`.
- Correct the spec's table row to "≥ 1 entry is u16::MAX, ≥ 50 % are not".

### Minor
- **m1. GPU extrapolation onto `next` is never checked in the browser.**
  - Test 7 runs paused (dtSim = 0) and test 8 reads only the CPU `trackedDraw`.
  - A shader that still clamps at the link end, which is today's stall at junctions, passes.
  - Suggestion: a `setDebug({ extrapolateS })` pin, plus a test-7 variant at, for example, 0.4 s for cars within 6 m of a link end.
- **m2. Nothing ties the ring or Follow to `motion.ts`** (spec :52).
  - `trackedDraw` can be computed separately from `trackedWorldPosition`.
  - Suggestion: in test 8, also assert `|trackedScreenCenter() − toPage(trackedDraw().world)| ≤ 1 px` at each sample.
- **m3. Test 6 constrains how the clock measures "expected advance"** (`motion.test.ts:225–230`, spec :57).
  - After the 2 s stall, a frame-interval measurement (wall interval × rate) would cap at 1.5·(2000 ms·0.03) and fail.
  - Only "tick delta × DT (0.5 s)" passes.
  - State this in the spec.
- **m4. Test 4's step is 0.01 m, not 0.1 m** (`motion.test.ts:152–158`).
  - The comment says 0.1 m, but `d += 0.01` with v = 10 and dt = d/10 gives 0.01 m steps.
  - A bound of 0.25 m per 0.01 m step is 25× the arc speed and catches only gross jumps.
  - Either use 0.1 m steps (with B3's bound) or tighten the bound to 0.08.
- **m5. `vehicleScreenCenter` is left unspecified.**
  - Picking switches to the new rule, but the spec does not say whether `vehicleScreenCenter` stays on the straight rule. `straightPage` implies it does.
  - The frozen tests `city.e2e.spec.ts:297–298`, `a11y.spec.ts:89`, `inspect.spec.ts:51/345`, `compare.spec.ts:271` and `gold_city003.spec.ts:33/110` assume `pickAt(vehicleScreenCenter(i))` hits i, or filter on it.
  - Their targets are mostly at low `s`, so the risk is low, but the spec should say "unchanged (straight rule)".
- **m6. Test 9 (hover) is sound against "dashes everything"**, because the unhovered congested road must show ≤ 1 alternation.
  - It relies on lane separators not appearing below 1.5 px/m. The zoom lands in 1.2–1.31, so that holds.
  - It also relies on no DOM hover card overlapping the sampled box. Note this in the spec.

## Not a problem (checked)
- **Test 5** (rebase within 1e-9 at the same `now`; 0 while paused; 10·rate after resume) and **test 6** (cap reached, at most 0.75) pass with a simple tick×DT clock.
- **Test 2**: count > 300 (1633 at tick 3600, and > 300 at 1800); > 50 % have a next link (94 %); seek and branch work as written.
- **Frozen-test conflicts**:
  - The fake `SimLike`s in frozen tests are Proxies over the real wasm, so new methods pass through.
  - `sim.test.ts` asserts `frame_words == count*4`, which forbids appending next links to the record buffer. This is consistent with the spec's separate pointer.
- **Test 7 luminance thresholds**, once the setup works:
  - queued car 176 vs congested road 133 = 43;
  - moving car 228 vs road 68–133 = ≥ 95;
  - stranded mark 20 vs road ≥ 48.

  All are ≥ 30 at 3 × 3 at the car centre, because the car quad is centred on p.
