# city-004 Red review, round 2

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 4 MINOR)

Reviewed: `web/tests/decor.test.ts` (1–7) and `web/e2e/look.spec.ts` (8–16) at commit 5766914, against `.wdd/wards/city/ward-004.md`, `.wdd/epics/city.md`, CLAUDE.md, round 1 (`city-004-red-1.md`), the current `web/src` and the River City network from the shipped wasm.

## What I ran
- `git diff --stat 67f41a3 HEAD`: only `look.spec.ts`, `decor.test.ts`, the ward, CONTEXT and the r1 review changed. No earlier test file was touched.
- `pnpm -C web exec tsc --noEmit -p .`: the only errors are the missing ward API (`cities/*`, `layout`, `linkTable`, `Camera.fitInsets`, hook `setDebug` / `approachLinks` / `linkCapacity`) and implicit-any errors that follow from it. The new r1 code (the onCanvas guard, the area loop, `edge()`) has no type errors of its own.
- Scratch scripts in `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/r004b/` (copies of r004 plus new ones):
  - `occ.mjs`: occupancy of link 8 (the Old Bridge west approach, cap 40) tick by tick after a Main Bridge closure, for 8 seed pairs and closure ticks 460 and 1200.
  - `occ2.mjs`: the app seed (2026, 7), with closure ticks 451–560 and poll phases 0/13/26. It finds the first 1-s poll that sees ≥ 24 vehicles and takes the minimum count over the next 60 and 120 ticks (1.5 s and 3 s wall at 20×). That covers the poll interval plus the pause latency.
  - `m2.mjs`: the test-2 water checks (corridor, containment ± 2 m, area within 5 %, swing ≥ 20 m), run verbatim against toy decors.
  - `fill.mjs`: occupancy before the closure.
  - `layout.mjs`: label, bridge and approach screen positions at `fitInsets` zoom 0.1508.

## Round-1 findings: verification

### M1 (test 14 flaky): fixed
- The spec now drives the congestion LOD by occupancy, which does not blink. It also draws congested links last.
- The test checks `linkCounts / cap ≥ 0.55` on the measured paused frame, and checks that the clip corners hit the CANVAS.
- Evidence from `occ2.mjs` (148 runs): no run had any count < 22 (0.55) in the 3-s window after the poll hit. The histogram of minimum counts was 23: 27, 24: 51, 25: 63, 26: 5, 27: 2.
- `occ.mjs` (16 seed and start combinations): the minimum within 80 ticks of the hit is ≥ 22. Occupancy only collapses much later, at the end of the peak. The guard therefore holds for the app seed and is not flaky.
- Occupancy before the closure is ≤ 3/40 (0.075) for all seeds, so the before/after contrast is real.
- Labels have `pointer-events: none`, so `elementFromPoint` sees through them. The nearest label (Millbrook, x 366–452, y 674–692) is clear of the clip (x 564–589, y 692–716).

### M2 (water not bound to the profile): fixed
I ran `m2.mjs` against toy decors:

| Toy decor | Result |
|---|---|
| A faithful strip | pass (0.00 m, 0.00 %) |
| Straight corridor water with a wavy profile | **fail** (containment 42.5 m, area 66 %) |
| ±2 m jitter profile | **fail** (swing) |
| A strip drawn twice (overlapping triangles) | **fail** (area 100 %) |
| Dense (10 m) smooth water against a 50 m profile, wavelength 1200 / 500 m | pass (worst 0.20 m / 1.32 m) |

The checks catch the broken implementations and accept faithful dense ones. The trapezoid profile area equals the strip area exactly for quads between samples.

### Minors
| r1 minor | Status |
|---|---|
| m1 (tiny boxes) | Fixed: ≥ 6 m a side |
| m2 (empty SVGs) | Partially fixed: see MINOR 1 below |
| m3 (rAF vs frame) | Documented, and handed to the Gold reviewer |
| m4 (barrier core) | Spec now says ≥ 4 px core |
| m5 (label centring) | Spec now says the label box is centred on its point. The test's box model now matches the spec. DOM centring is not asserted (see MINOR 3) |
| m6 (test 1 file walk) | Fixed: recursive walk, `decor.ts` scanned, missing file tolerated |
| m7 (test 8) | Fixed: `aria-pressed="false"` and no "pending" |

## Other premises re-checked at the new fit zoom
| Test | Premise | Status |
|---|---|---|
| 9 | The barrier at 12 % (7.2 px from the node, core ≥ 4 px) does not reach the 5 × 5 junction clip, and barriers are white, not hatch-yellow | OK |
| 10 | The drag start (629, 513) is clear of every label (Cathedral Quarter ends at x ≈ 588) | OK |
| 12 | Barriers at ±22.8 px sit at most ~0.2 px inside the ±20 px clip, and they are equal before and after the selection, so the ratio is unaffected | OK |
| 13 | The drag start (640, 660) is clear of every label | OK |
| 5 | Same-row label gaps are ≥ 84 px with the estimate, so letter-spacing and an icon cannot create overlaps | OK |
| Earlier e2e | `city.spec` #7 (first 20 Tabs) and `inspect.spec` (Follow within 25 Tabs) still have budget for one extra legend toggle, provided Gold gives it an accessible name (city.spec #7 requires every focused button to have one) | OK, note for Gold |

## MINOR (non-blocking)
1. **Test 15 checks five shaped SVGs anywhere in the legend, not one per symbol.**
   - Four symbol samples plus an SVG chevron in the toggle button would pass.
   - Suggested hardening: for each of the five texts, select the item containing it (`legend.locator('li').filter({ hasText })`) and require that its own `svg` contains a shape.
   - The Gold reviewer can check this by eye.
2. **Test 14's margin depends on the unspecified occupancy → width/lightness ramp.**
   - The spec says "up to +3 CSS px", which a linear ramp from 0 satisfies.
   - The measured frame can be as low as 0.55–0.6 occupancy, against 0.075 before the closure. A linear ramp then gives only about +1.4 px of total widening, close to the ≥ 1 px pixel-count threshold.
   - Recommendation for Gold, and optionally the spec: let the ramp saturate by about 50 % occupancy, so that 0.55 already shows the full cue. This is not proven flaky, because the effect is deterministic for a given ramp and the Gold reviewer runs the test.
3. **Label centring and the top inset are not asserted.**
   - Test 5 models boxes centred on the zone point (per spec), but no test checks the DOM placement.
   - The top-row labels (Westbrook Heights, Innovation Hub) sit at y ≈ 140 ± 9, right on the top inset line, so their upper half can touch the control panel area.
   - The Gold reviewer should check both in the screenshots, including that the `.zone` `translate(-50%, -150%)` is changed to `-50%, -50%`.
4. **`riverProfile` must span the whole drawn water.**
   - `edge()` clamps beyond the profile ends, and the area check compares totals.
   - If Gold draws water far past the city's y range ± 500 m (to hide the river's end when panning) but samples the profile only over that range, test 2 fails.
   - Gold should sample the profile over the full drawn-water range, which the test allows (only a lower bound on coverage). The spec could say "covers at least the city's y range ± 500 m and all drawn water".
