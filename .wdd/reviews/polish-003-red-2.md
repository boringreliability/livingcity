# polish-003 Red review 2

**Verdict: REJECTED**

Reviewer: fresh adversarial Red-gate subagent, round 2. Artifacts reviewed at HEAD `4712a7a`: `.wdd/wards/polish/ward-003.md`, the three test files, and the context files. No implementation exists yet. Probes were written in `scratchpad/red-p003-r2/`, copied into the repo only while they ran, and deleted afterwards. `git status` is clean apart from this file.

## Test file hashes (sha256)
- `8e951dc1f40daabf67472a4969bc197d2cdc2507527b57ddacdb71a2fe361f18  crates/sim-core/tests/polish_003_next_links.rs`
- `e403d7e2a286f0b5895062885e72eb961c8484fef4951e9db2e1432f2588277b  web/tests/motion.test.ts`
- `c2ec92409153821604e135ac9bcd18344688aa5ceb55dc8e1450107c770a7e4a  web/e2e/motion.spec.ts`

## What I ran
1. **Reference `motion.ts`, a literal reading of the revised spec.** I placed it temporarily at `web/src/render/motion.ts`.
   - It uses B = min(6, len/2) and a quadratic Bézier with t linear in s.
   - The control point is the in/out intersection when it lies ahead of P0 and behind P2. Otherwise it is `P2 − dir(out)·|P2−P0|/2`.
   - The heading falls back to dir(out).
   - `extrapolate` clamps at the link end.
   - The clock uses a tick anchor, the speed-change rebase and a cap of 1.5 × (tick delta × 0.5).

   Then I ran `pnpm -C web exec vitest run tests/motion.test.ts`:
   - **Test 3 times out at the default 5000 ms.** It needs 11.2 s.
   - With `--testTimeout=120000`, tests 3, 4, 5 and 6 all pass with the reference. Test 2 fails as expected (`nextLinks` undefined).
2. **Test 3 overhead probe.** I ran the same loop as test 3 with a zero-cost draw function, so only the `expect` and template-string overhead remained. It made 7,146,640 calls in 12.5 s.
3. **Test 1 expectation probe.** I copied `polish_003_next_links.rs` and computed the expected values without `write_next_links`:
   - river_city: 102 of 1633 are `NO_NEXT`;
   - three_bridges closed: **91 of 161 are `NO_NEXT`** (82 stranded and 9 on their final link). This fails `none * 2 <= count`.
4. **Test 8 probe (Rust, native).**
   - Model: `geometry.ts`'s two-way offsets, the spec curve, clamped extrapolation and the tick-anchored clock.
   - Setup: River City from tick 2000, 5× speed (0.005 sim s per wall ms), a frame every 100 ms (ideal, with no jitter), and rAF at 16.7 ms and at 37 ms (the SwiftShader median measured in round 1).
   - For every on-network vehicle and every consecutive pair of samples, I applied test 8's own criterion: `moved ≤ along + 0.9`, with the same exemptions. The run lasted 60 s wall time.
5. **Test 7 probe (Rust).**
   - Setup: `river_city_scaled(2026, 7, 3.0)`. The central bridge closes at tick 1810, 1900 or 2100, and then 1210 ticks run.
   - Measured: blend-zone cars in the city, the densest 60 m cluster, and the curved (≥ 1.5 m off) and plain cars in a 4 px/m window of 1280 × 800 centred on the densest spot.
6. **Playwright** `pnpm -C web exec playwright test e2e/motion.spec.ts` (port 5190). All 4 tests fail, each for the expected reason:
   - 7: `vehicleDraw` is missing.
   - 8: `trackedDraw` is missing.
   - 9: "a dash pattern".
   - 10: "0.07: … (0 → 0)". MIN_ZOOM passes today because of the end barriers; vehicles are hidden, so the before count is now 0.

## Round-1 findings: status
| R1 | Status |
|---|---|
| B1 test 8 timing (snap-back, lane exemption, jitter, finished trips) | **Resolved as designed.** The geometric criterion with \|Δs\| absorbs snap-backs. Crossings now happen only at frame arrival, so the lane exemption sits on the right sample. A car that finishes is re-tracked. In my probe, no failing samples came from snap-backs, straight segments or reroutes (0 "next changed on the same link"). **But see the new B1:** the criterion is infeasible inside the blend zone. |
| B2 test 7 has no curved cars | **Partly resolved.** Queues now exist, but the margin is too thin (M1). |
| B3 step bound | **Resolved.** 0.75 m passes for all 1336 pair-lanes with the reference. |
| M1 control point | **Resolved.** The reference passes 3(a). |
| M2 test 10 versus spec | **Resolved.** The spec says glyph "at every zoom" and vehicles are hidden (before = 0). The dark-outline check was dropped, see m1. |
| M3 stranded | **Spec resolved, but the test is now infeasible** (B3 below). |
| m3 clock "expected advance" | **Resolved** (spec :57). |

## Findings

### B1 (BLOCKER): test 8's "along-route distance" uses s, but the specified curve is longer than its s-span, so a correct implementation fails
**Where:** `web/e2e/motion.spec.ts:194–206` (`along = |Δs|` and `along = prev.length − prev.s + d.s`) and the limit at :226. The conflict is with `ward-003.md:46–50`.

**The cause.**
- The blend maps B = 6 m of `s` onto a curve from P0 to P2.
- The chord |P2 − P0| alone is up to 2.34 · B (round 1), and the Bézier with t ∝ s has local speed up to about 5 × (round 1: 0.52 m per 0.1 m).
- Each rAF sample therefore moves the drawn car up to k · Δs while the test credits only Δs + 0.9 m.
- At 5× speed, Δs per rAF is about 0.8–1.2 m at 60 fps and 1.5–2.6 m at 37 ms.

**Measured** with ideal 100 ms frames and River City from tick 2000 over 60 s wall:

| Curve | rAF (ms) | Cars that crossed ≥ 1 junction | With an excess > 0 | Median worst excess (m) | Max worst excess (m) |
|---|---|---|---|---|---|
| Spec Bézier | 16.7 | 2943 | 2567 (87 %) | 1.30 | 9.08 |
| Spec Bézier | 37 | 2943 | 2649 (90 %) | 2.38 | 8.91 |
| Spec Bézier with the intersection bounded to \|P2−P0\| | 16.7 | 2943 | 2567 | 1.20 | 7.83 |
| **Straight chord P0→P2 at uniform speed** | 16.7 | 2943 | 909 (31 %) | 0.42 | 5.25 |
| **Straight chord P0→P2 at uniform speed** | 37 | 2943 | 1961 (67 %) | 0.80 | 4.71 |

- In every variant, all failing samples are in the blend zone or at the crossing out of it. None is on a straight segment.
- The straight chord is the shortest possible path over B, so it is a lower bound for *any* curve. The criterion therefore cannot be met by any implementation of "B = min(6, len/2), the end at the next link's start". The test needs 3 crossings over several cars with zero excess, so it fails essentially always.

**Fix:** measure "along-route" on the **drawn path**, not in s.
- Add a pure hook `drawAt(link, s, lane, next) → [x, y]`, which is the CPU rule `vehicleDrawPosition`.
- In the sampler, compute the path length between `prev` and `d` by summing `drawAt` over sub-steps of ≤ 0.1 m of s:
  - on the same link, from `prev.s` to `d.s` (or in reverse for a snap-back);
  - across a crossing, from `prev.s` to `prev.length` on `prev.link` (with `prev.next`), then from 0 to `d.s` on `d.link`.
- Require `moved ≤ pathLen + 0.9`.

This still catches the 4.6 m c1 jump, where pathLen is about 0, and any GPU/CPU or ring divergence. It accepts every continuous curve. Re-run a probe like mine before freezing.

### B2 (BLOCKER): test 3 times out with any implementation
**Where:** `web/tests/motion.test.ts:90–137`. There is no timeout argument, and `web/vite.config.ts` sets no `testTimeout`, so the default 5000 ms applies.

- The 0.1 m loop runs over the **whole** length of every link for every pair-lane: 7.1 M `expect` calls, each with a template-string message.
- With a zero-cost draw function it takes 12.5 s. With the reference it takes 11.2 s inside the test.
- Result: "Test timed out in 5000ms", independent of correctness.

**Fix:**
- Sample only `s ∈ [len − B − 0.5, len]` (part (c) already covers the straight part).
- Track the worst step in a local variable and assert once per pair-lane, or once overall with the arg-max in the message.
- Pass an explicit timeout such as `60_000`.
- Check that it runs in under 5 s, or keep the explicit timeout.

### B3 (BLOCKER): test 1 cannot pass once stranded vehicles map to NO_NEXT_LINK
**Where:** `crates/sim-core/tests/polish_003_next_links.rs:62` (`assert!(none * 2 <= count, …)`), applied to `three_bridges_closed()`.

- Measured: `three_bridges closed: count 161, expected NO_NEXT 91` (82 stranded and 9 on their final link).
- Since 91 · 2 > 161, the test's own expectation violates its own threshold. Any correct `write_next_links` fails.
- river_city is fine (102 of 1633).

**Fix:**
- Apply the "at least half" check only to non-stranded records, or only to river_city.
- For three_bridges, assert instead that ≥ 1 stranded record exists, so the stranded branch is non-vacuous. Each of those must be `NO_NEXT_LINK`, which the per-record assert already checks.
- Update the spec's table row 1 to match.

### M1 (MAJOR): test 7 is at the edge of feasibility, and the densest spot is not centred
**Where:** `web/e2e/motion.spec.ts:108–121`.

**Measured** with demand 3, the main bridge closed for 1210 ticks, and the densest cluster centred:

| Closed at tick | Blend-zone cars in the city | Densest 60 m cluster | Curved in the full 4 px/m viewport | Curved in the inner viewport | Plain cars |
|---|---|---|---|---|---|
| 1810 | 120 | 7 | 6 | 6 | 56–82 |
| 1900 | 134 | 7 | 5 | 5 | 100–145 |
| 2100 | 118 | 8 | 6 | 6 | 90–133 |

The test requires ≥ 5 curved cars, which is met by a margin of 0–1, and only if the spot is centred. Other factors push the count lower:
- `wheelZoom(page, best.page, …)` zooms **at the spot's current screen position**, so it keeps that position. If the spot sits near an edge or under a panel at the overview zoom, half of the 4 px/m window is off-canvas.
- `onCanvas` (±6 px) and `page > 20` filter further.
- The pause lands a few ticks later than the 1200-tick poll.

A correct shader can fail on the setup alone.

**Fix:**
- Centre the spot before zooming. One option is a hook `centerOn(world)`; another is to drag the canvas so that `best.page` reaches the canvas centre, then wheel at the centre.
- Optionally visit the top 3 clusters and accumulate the checked cars until ≥ 5 curved and ≥ 8 plain.
- Alternatively lower the bar to ≥ 3 curved.
- Re-measure in the browser.

### Minor
- **m1. Test 10's +12 bright-pixel bar against the spec minimum glyph** (`motion.spec.ts:349`, `ward-003.md:62`).
  - A "≥ 6 × 6 CSS px glyph, white with a dark outline" whose 1 px outline lies inside the 6 × 6 has a 4 × 4 white core.
  - At a sub-pixel position with MSAA, only about 3 × 3 = 9 pixels reach ≥ 220, which is < 12.
  - The dark outline is no longer checked at all.
  - Fix: state "white core ≥ 5 × 5 px" (or a glyph ≥ 8 × 8) in the spec, and add `dark(after) − dark(before) ≥ 4` in a ring.
- **m2 (r1 m2, still open). Nothing ties the ring or Follow to `motion.ts`.**
  - The spec says "`trackedWorldPosition`, the ring and Follow use `motion.ts`", but test 8 reads only `trackedDraw`.
  - Fix: in test 8 also assert `|trackedScreenCenter() − page(trackedDraw().world)| ≤ 1 px` per sample.
- **m3. Unbounded intersection control point** (`ward-003.md:48`).
  - Nearly parallel in/out lines with a slight kink pass the "ahead / behind" test with an intersection far away. The car then swings wide: in my reference, 3.1 m of displacement for 0.5 m of s on `294→30`.
  - It passes test 3, but it looks bad. Add "and within |P2 − P0| of both" (bounding it changes the B1 numbers only slightly).
- **m4. No browser check of GPU extrapolation.** Test 7 is paused. A shader that ignores `dtSim` passes. This is low risk now that extrapolation clamps; noted only.

## Not a problem (checked)
- **Tests 4, 5 and 6** pass against the reference; test 4's float equalities are exact for the f32-derived lengths.
- **Test 8 car selection and re-tracking.** A finished trip resolves the sampler, and the loop picks another car. The deadline of 240 s allows about 6 cars.
- **Test 8 reroutes.** No "next changed on the same link" excess occurred in 60 s, so the reroute exemption by link mismatch is enough.
- **Lanes** are fixed at link entry (`world.rs:1247`, `:1326`), so no mid-link lateral jumps occur.
- **Test 10:** vehicles hidden gives a before count of 0 bright pixels at all three zooms. That makes the test discriminating.
- **Test 2:** not re-measured in this round. Its "> half have a next link" in branch B is probably safe, since there are only about 30 iterations after the branch, but the implementer should confirm it given B3.
