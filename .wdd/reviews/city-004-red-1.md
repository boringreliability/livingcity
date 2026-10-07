# city-004 Red review, round 1

**Verdict: REJECTED** (2 MAJOR, 7 MINOR)

Reviewed: `web/tests/decor.test.ts` (1–7) and `web/e2e/look.spec.ts` (8–16) at commit 65680d2, against `.wdd/wards/city/ward-004.md`, `.wdd/epics/city.md`, CLAUDE.md, the current `web/src` (renderer.ts, App.tsx, camera.ts, host.ts, styles.css) and the River City network from the shipped wasm.

## What I ran
- `pnpm -C web exec tsc --noEmit`: the only errors are the missing ward API (`cities/*`, `layout`, `linkTable`, `Camera.fitInsets`, hook `setDebug/approachLinks/linkCapacity`) and implicit-any errors that follow from it. No other type problems.
- `pnpm -C web exec vitest run tests/decor.test.ts`: red, because the modules are missing (expected).
- Scratch scripts (in `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/r004/`) on the real wasm `Sim.river_city`:
  - `layout.mjs`: bounds, `fitInsets` zoom, label boxes, bridge and junction screen positions, Old Bridge approaches, non-bridge links in the corridor.
  - `fill.mjs` / `trace.mjs`: Old Bridge approach count and queued count after a Main Bridge closure, for 6 seed pairs.

### Facts established
- Corridor `[-75, 75]`. Bounds x −3000..3140, y −1800..1940.
- `fitInsets` on 1280 × 800 gives zoom **0.1508 px/m**, touching on y. The old `fit(…, 64)` gave 0.1797.
- Test 5 premise holds. All 22 label boxes are on the canvas with no overlaps, and the margins are generous: the nearest pairs are ≥ 70 px apart.
- Test 3 premise holds. No non-bridge link has a point inside the corridor. Bridges run from x = −200 to 200, so they are 60 px long at fit zoom.
- Main Bridge on screen: y ≈ 432.0 / 433.2, x 599.3–659.6. East junction at (659.6, 433.2).
  - Test 9: the 5 × 5 junction clip (x 657–661) sits ≥ 3.4 px past a hatch shortened by 6 px. Nothing else there can satisfy `r > 200 && g > 150 && b < 90`: the hatch is (242, 194, 41), and the current full-congestion road colour is ≈ (139, 120, 85). **Premise OK.**
  - Test 10: the drag starts in the river (no DOM there). An integer 37 px pan moves every world-anchored primitive by whole pixels, so MSAA coverage is identical. **Premise OK.**
  - Test 12: picking at the ew/we midpoints picks the intended direction, because they are 1.2 px apart and pickLink takes the nearest. The halo of the selected link would cover nearly all of the opposite hatch if it were drawn later, so the test discriminates. **OK.**
- Old Bridge `approachLinks(288)` = `[8, 131]`. Link 8 runs west → east, 300 m, 1 lane, cap 40. Its reverse, link 9, is drawn after it. On screen it is at y ≈ 704.3, exactly on the bottom inset edge.
  - Link 8 reaches 60 % (24 vehicles) **21–27 wall-s** after the closure at 20×, for all 8 seed/start-tick combinations. The 180 s timeout is ample.
- The tests fail against the current code for the right reasons:
  - 8: B toggles on repeat.
  - 9: the hatch reaches the node.
  - 10: the hatch is screen-anchored.
  - 11: barriers are 2.4 m, which is 0.36 px.
  - 12: the halo pass covers the hatch.
  - 14 / 16: the API and the disable behaviour are missing.

## MAJOR

### M1: Test 14 is flaky (≈ 25–35 %) for a spec-faithful implementation, because the queued share drops to 0 for 2 s at every discharge
The spec drives the congestion LOD by **queued share** ("a road's drawn width grows by up to +3 CSS px with its queued share"). The renderer does the same today: `linkQueued / capacity` per frame. The test, however, waits on `linkCounts / cap ≥ 0.6`, pauses on whatever frame is current, and measures. I traced link 8 tick by tick after the closure (`trace.mjs 460 1`, as count/queued):

```
2026,7  24/17 24/16 24/16 24/16 23/15 24/1 24/0 24/0 24/0 25/16 25/16 … 25/17 25/0 26/0 26/0 26/0 26/20 …
1,2     24/22 24/21 24/21 24/21 23/20 24/1 24/0 24/0 24/0 24/20 … 23/20 23/0 23/0 23/0 23/0 23/20 …
3,4     … 24/18 24/0 25/0 25/0 25/0 25/19 … 27/22 27/0 27/0 27/0 27/0 27/22 …
```

Every time the head vehicle discharges onto the Old Bridge (sat flow 0.25/s), the whole queue moves above 2 m/s for about 4 ticks. During that time `linkQueued` is about 0, even with 40/40 vehicles on the link. That covers 25–35 % of ticks. If the pause lands on such a frame, the road is drawn uncongested, and `after.width ≥ before.width + 1` and `after.light ≥ before.light + 10` fail. The same effect also makes congested roads **blink** at 20× (every ~0.25 s wall), which contradicts "congestion must be visible" and calm LOD.

**Fix (spec + test, pick one):**
- (a, recommended) Change the ward spec: the congestion LOD is driven by **occupancy** = `linkCounts / storage capacity`. That is the same quantity the test already conditions on, and it does not flicker. Then add a guard so the test measures a congested frame:
  ```ts
  const after = await measure();
  // the paused frame that was measured is itself congested
  expect((await snap(page)).linkCounts[link]! / cap).toBeGreaterThanOrEqual(0.55);
  ```
- (b) Keep the queued share but smooth it over **sim ticks** (in the worker or core; smoothing per frame does not help, because frames repeat while paused). Then add `linkQueued` to the snapshot and assert, on the paused frame, `linkQueued[link] / cap ≥ 0.5` before measuring. If it is lower, resume for ~0.5 s and pause again, at most 10 attempts.

Also add an on-canvas guard, because the measured clip (y 692–716) sits exactly on the bottom inset line where a legend or metrics overlay could go:
```ts
const onCanvas = await page.evaluate(([x, y]) =>
  [[x - 12, y - 12], [x + 12, y - 12], [x - 12, y + 12], [x + 12, y + 12]].every(
    ([a, b]) => document.elementFromPoint(a!, b!)?.tagName === 'CANVAS'), m);
expect(onCanvas).toBe(true);
```

### M2: Test 2's "meanders" assertion is not bound to the drawn water, and tiny jitter satisfies it
Test 2 checks that water vertices lie in the **corridor** and that `riverProfile` has more than 3 distinct rounded `x0`. Two broken implementations pass:
- straight corridor water (the old `riverDecor` rectangle) plus any wavy `riverProfile`;
- a profile with ±2 m noise, which gives `Set(round(x0)).size > 3`.

The meandering river is the ward's headline visual, and test 3 (bridges) and test 4 (buildings) also trust `riverProfile`. The profile therefore has to *be* the drawn river. Replacement for the end of test 2:
```ts
// the drawn water is the profile: every vertex inside the profile at its y …
const edge = (y: number): [number, number] => {
  let i = p.findIndex((s) => s.y >= y);
  if (i <= 0) i = 1;
  const a = p[i - 1]!, q = p[Math.min(i, p.length - 1)]!;
  const t = q.y === a.y ? 0 : Math.min(1, Math.max(0, (y - a.y) / (q.y - a.y)));
  return [a.x0 + (q.x0 - a.x0) * t, a.x1 + (q.x1 - a.x1) * t];
};
for (let i = 0; i < d.water.length; i += 2) {
  const [x0, x1] = edge(d.water[i + 1]!);
  expect(d.water[i]!).toBeGreaterThanOrEqual(x0 - 2);
  expect(d.water[i]!).toBeLessThanOrEqual(x1 + 2);
}
// … and it fills the profile (area within 5 %)
let area = 0;
for (let i = 0; i < d.water.length; i += 6) {
  const [ax, ay, bx, by, cx, cy] = Array.from(d.water.subarray(i, i + 6));
  area += Math.abs((bx! - ax!) * (cy! - ay!) - (cx! - ax!) * (by! - ay!)) / 2;
}
let prof = 0;
for (let i = 1; i < p.length; i++) prof += ((p[i]!.x1 - p[i]!.x0 + p[i - 1]!.x1 - p[i - 1]!.x0) / 2) * (p[i]!.y - p[i - 1]!.y);
expect(Math.abs(area - prof) / prof).toBeLessThan(0.05);
// and it visibly meanders: the centre line swings ≥ 20 m
const mids = p.map((s) => (s.x0 + s.x1) / 2);
expect(Math.max(...mids) - Math.min(...mids)).toBeGreaterThanOrEqual(20);
```
The 2 m tolerance covers a smooth curve drawn denser than the ≤ 50 m profile samples. The chord error is below 1 m for any meander that fits the 150 m corridor.

## MINOR
1. **Test 4 accepts trivially tiny boxes.** 200 boxes of 0.01 m pass. Add `expect(Math.min(x1 - x0, y1 - y0)).toBeGreaterThanOrEqual(6)` per box, and optionally a minimum total footprint area (for example ≥ 2 % of the bounds area), so "subtle building footprints per district" means real footprints.
2. **Test 15 accepts empty SVGs.** `svg` count ≥ 5 passes with five empty `<svg/>` elements, or with five SVGs in one item. Check per symbol instead:
   ```ts
   for (const text of [/closed road/i, /queued/i, /moving/i, /congest/i, /select/i]) {
     const item = legend.locator('li, [role=listitem], div').filter({ hasText: text }).last();
     const drawn = await item.locator('svg').evaluate((s) => (s as SVGSVGElement).querySelectorAll('rect,path,line,circle,polygon,polyline').length > 0 && (s as SVGSVGElement).getBBox().width > 0);
     expect(drawn, `${text} sample`).toBe(true);
   }
   ```
3. **Test 13 barely distinguishes "every rAF" from "on React render".** The worker posts frames about every 16 ms even while paused (`host.ts` `iterate` → `postFrame`). Each frame triggers `setFrame`, which re-renders `ZoneLabels`, so the *current* code moves the labels within the two-rAF wait most of the time. To make it discriminating, run the drag and the read inside one `page.evaluate`: dispatch `pointerdown/move/up` on the canvas, then read positions in the **first** `requestAnimationFrame` callback, and repeat 10 times. The app's loop callback is registered in the previous frame, so it runs before the test's callback.
4. **Test 11: "≥ 3 px thick" versus 3 fully near-white pixels.** If the 3 px includes the dark edge, or the white core is exactly 3.0 px at a fractional position, MSAA blends the edge pixels below lum 220 and the run is 2. The ew bar centre is at x ≈ 652.4, so a geometric 3.0 px core passes only by a 0.1 px margin. Make the spec say "near-white core ≥ 4 CSS px (≥ 3 whole pixels at any sub-pixel phase), plus a dark edge". The test can stay as it is.
5. **Test 5 label box versus the actual DOM placement.** The test models the box as *centred* on (x, y), but the current `.zone` CSS is `translate(-50%, -150%)`, which places it about 18 px above. Either the spec states that the label is centred on its zone (and Gold changes the CSS), or the test uses the real offset. Overlaps are unaffected, but the "inside the canvas" check is about the wrong box.
6. **Test 1:**
   - `readdirSync(cities/)` then `readFileSync` throws EISDIR if Gold adds a subfolder. Filter `.ts` files.
   - The generic fallback (`render/decor.ts`) is also "decor module source" but is not scanned. Scan it as well.
7. **Test 8:** `toBeVisible()` on the bridge button is always true, because its aria-label never changes. Assert `toHaveAttribute('aria-pressed', 'false')` and that the button text has no "(pending)", so a repeat that queued a pending toggle is also caught.

## Notes for Gold (not test defects)
- **Earlier e2e at the new fit zoom (0.1508):**
  - North Bridge centre is at y ≈ 161, south at y ≈ 704. The metrics strip top is ≈ 727, so the 40 × 24 clips of gold5 G1 stay on canvas.
  - All earlier tests use hook coordinates, so I see low risk.
  - Keep the canvas static while paused. Animated water would break `city.spec` "rendering is decoupled" (`Buffer.compare(a, b) === 0`).
  - Keep the legend away from the Old Bridge west approach (x 554–599, y 692–716).
- **Two-way streets overlap at fit zoom.** Link 9 (reverse) is drawn after link 8 and covers its centre (the directions are 0.68 px apart, each 2.5 px wide), so congestion on link 8 shows only in its widened margins. Test 14 still passes if widening and lightness are real, but consider drawing congested links last.
- **Test 12's ±10 % budget:** the barriers sit at 12 %/88 % (±22.8 px from the midpoint), just outside the 40 px clip. Do not move them inward.
