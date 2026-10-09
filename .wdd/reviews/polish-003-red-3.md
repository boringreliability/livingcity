# polish-003 Red review 3

**Verdict: APPROVED** (with minors m1–m5 below)

Reviewer: a fresh adversarial Red-gate subagent, round 3. I reviewed the artifacts at HEAD `8cb3f1d`:
- `.wdd/wards/polish/ward-003.md`;
- the three test files;
- `git diff HEAD~1..HEAD`;
- the context files.

No implementation exists yet. I kept my probes in `scratchpad/red-p003-r3/`. I copied them into the repo only while they ran and deleted them afterwards. `git status` is clean apart from this file.

## Test file hashes (sha256)
- `8d0b636191604a6f94a1d4896eae4e81d208607b924fb74cd4e2f55850040536  crates/sim-core/tests/polish_003_next_links.rs`
- `6b83cbd11fec12e94e61aa1b1927cf9226cf823236f12a5bc7249577e8af98be  web/tests/motion.test.ts`
- `6878ebd52193b4757eb35b76c0688336fb7ea84b58e24f85942a6b47c08cef72  web/e2e/motion.spec.ts`

## What I ran
1. **Vitest against a reference `motion.ts`.**
   - The reference is round 2's literal spec reference with the control-point bound switched on, as the spec now requires ("within |P2 − P0| of both"). I placed it temporarily at `web/src/render/motion.ts`.
   - I ran `pnpm -C web exec vitest run tests/motion.test.ts`.
   - Result: tests 3, 4, 5 and 6 **pass**. The whole file takes 165 ms, so test 3 is no longer anywhere near a timeout.
   - Test 2 fails as expected: `nextLinks` is undefined.
2. **Test 1 and test 2 expectation probe (Rust, release).** I computed the expected next links without `write_next_links`.

   | World | Count | Stranded | Non-stranded without a next link | Result |
   |---|---|---|---|---|
   | three_bridges closed | 161 | 82 | 9 of 79 | Half rule ✓, `stranded ≥ 1` ✓ |
   | river_city busy | 1633 | 0 | 102 | ✓ |

   - Test 2's states also pass "some > count/2" and reachability (0 bad):
     - river_city at ticks 1600, 1800 and 1810: 102–123 of about 1750 have no next link;
     - branch B with the main bridge closed, after +1, +30, +60 and +120 ticks: 106–121 of about 1750.
3. **Test 8 probe (Rust, release), with test 8's new criterion applied literally.**
   - The setup follows round 2's renderer model:
     - the two-way offsets from `geometry.ts`;
     - the spec Bézier with the bounded control point;
     - extrapolation clamped at the link end;
     - a tick-anchored clock with a cap of 0.75.
   - Along-route distance is the **drawn path length**: `draw` summed over sub-steps of 0.1 m. On the same link it runs from `s_prev` to `s_now`. Across a crossing it is the rest of the old link plus the start of the new one, with the same exemptions as the test.
   - The run covers every on-network vehicle for 60 s wall time from tick 2000 at 5×.

   | rAF | Frame interval | Samples | Same-lane crossings | Failing samples | Worst excess |
   |---|---|---|---|---|---|
   | 16.7 ms | 100 ms | 6.30 M | 6583 | **0** | 0.000 |
   | 37 ms | 100 ms | 2.84 M | 6583 | **0** | 0.000 |
   | 16.7 ms | 100 ± 60 ms (jitter) | 6.30 M | 6659 | **0** | 0.000 |
   | 37 ms | 100 ± 80 ms (jitter) | 2.84 M | 6696 | **0** | 0.000 |

   This is what the triangle inequality predicts: chord ≤ polyline whenever `trackedDraw.world` = `drawAt(...)`, and test 3(a) makes the curve end equal the next link's start.
4. **Test 8 sensitivity (same probe, wrong implementations).**
   - `trackedDraw` uses the old straight rule while `drawAt` is the curve, or both are straight.
   - 3,232 of 6,583 same-lane crossings fail (49 %), with a worst excess of 9.4 m (a jump of 10.8 m against 0.5 m along).
   - See m1.
5. **Test 7 probe (Rust, release).**
   - The setup is `river_city_scaled(2026, 7, 3.0)` with the main bridge closed at tick 1810, 1850, 1900, 2000 or 2100, then 1210 ticks.
   - I used the bounded curve and the densest 60 m cluster centred in a window of ±150 × ±90 m, which is 1200 × 720 px at 4 px/m.
   - Curved cars in view (≥ 1.5 m off the straight point): **6 / 4 / 5 / 5 / 6** (need 3). Plain cars: 73–128 (need 8).
   - Straight points that lie on some drawn car (an oriented rectangle of 4.4 × 1.8 m, or 3.6 × 2.3 m when queued, plus 0.25 m): 0–1 per run. "Half empty" holds with a wide margin.
6. **Overlap probe.**
   - These are pairs of drawn vehicle centres less than 2 m apart, comparing the straight rule with the curve rule. Under the curve rule, cars held at the stop line (s = length) are drawn at the start of their next link.
   - At the default demand at tick 3060: 5 pairs straight versus 9 with the curve.
   - At demand 3 with the bridge closed: **23 versus 87**. See m3.
7. **Red state confirmed.**
   - `cargo test -p sim-core --test polish_003_next_links` fails with E0432: `write_next_links` and `NO_NEXT_LINK` are unresolved.
   - `pnpm -C web exec playwright test e2e/motion.spec.ts` (port 5190) fails all 4 tests, each for the expected reason:
     - 7: `h.vehicleDraw is not a function`;
     - 8: `h.trackedDraw is not a function`;
     - 9: "a dash pattern";
     - 10: "0.07: … (0 → 0)".

## Round-2 findings: status
| R2 | Status |
|---|---|
| **B1** test 8 credited s instead of the drawn path | **Resolved.** The `drawAt` path length with 0.1 m sub-steps gives 0 failing samples in 15.6 M samples, with and without frame jitter. The test still discriminates (see probe 4). |
| **B2** test 3 timeout | **Resolved.** Test 3 samples only the blend zone, makes one assertion per pair-lane and has an explicit timeout of 120 s. It runs in under 0.2 s. |
| **B3** test 1 half rule against stranded vehicles | **Resolved.** The half rule applies to non-stranded vehicles (9 of 79 without a next link). Stranded vehicles are required in three_bridges (82 of them), and the spec's row 1 is updated. |
| **M1** test 7 margin and centring | **Resolved.** The spot is dragged to the canvas centre and the bar is lowered to 3 curved cars. The measured supply is 4–6 when centred, see m2. |
| m1 (r2) glyph core vs +12 | **Resolved.** The spec states a white core of 6 × 6 and the test requires +20. A 6 × 6 core at a sub-pixel position still has 5 × 5 = 25 fully covered pixels. The before count is 0 with vehicles hidden. |
| m2 (r2) ring not tied to `motion.ts` | **Resolved.** At every sample, the ring (`trackedScreenCenter`) must be within 1 px of `trackedDraw.page`. Both read `performance.now()` and the same camera, so a correct implementation agrees well within 1 px. |
| m3 (r2) unbounded control point | **Resolved** in the spec (`ward-003.md:49`). The bounded reference passes 3(b). |
| m4 (r2) no browser check of GPU extrapolation | Still open and low risk, as in round 2. It is unchanged here. |

## Findings
No BLOCKER and no MAJOR.

### m1 (MINOR): test 8 does not tie `trackedDraw.world` to `drawAt`, so a tracked path on the old rule passes about 1 run in 8
- **Where:** `web/e2e/motion.spec.ts:201–239`.
- **Problem.** The criterion uses `drawAt` for the path length, but it never checks that the sampled `d.world` *is* `drawAt(d.link, d.s, d.lane, d.next)`.
  - Consider a wrong implementation where `trackedDraw` and the ring are built on the old straight `trackedWorldPosition`, while the pure rule is correct (so tests 3 and 7 pass).
  - Probe 4: such an implementation fails only 49 % of same-lane crossings. With 3 crossings required, it passes about 0.51³ ≈ 13 % of runs.
  - Smoke step 2 would still catch it.
- **Fix.** This is optional and safe for a correct implementation. Inside `step`, add a check that rejects when `Math.hypot(d.world[0] − q[0], d.world[1] − q[1]) > 1e-6`, where `q = h.drawAt(d.link, d.s, d.lane, d.next)`.

### m2 (MINOR): test 7 has a thin supply of curved cars
- **Where:** `web/e2e/motion.spec.ts:117–132`.
- **Problem.** Probe 5 measures 4–6 curved cars in a full 1200 × 720 px window when the spot is centred, against a requirement of 3. Several things can lower the count:
  - panels covered by `onCanvas`;
  - the `page > 20` filter;
  - a spot that sits under a panel at the overview zoom, where the drag starts on a panel and does not pan;
  - a spot within `CLICK_SLOP_PX` (4 px) of the centre, where the "drag" becomes a click that selects a road or a car. This one is harmless for the luminance comparison.
- **Fix, if it flakes at Gold.** Either drag from a point on the canvas (pan by the offset rather than starting on the spot), or accumulate cars over the top 2–3 clusters. Do not lower the bar further.

### m3 (MINOR, spec-level, for the epic gate): cars held at a stop line are drawn at the next link's start
- **Problem.** Under the spec rule, the curve ends at P2 at s = length, and the sim holds the first queued car at s = length. That car is therefore drawn *in* the junction, at the start of its next link. Cars from different approaches with the same next link stack at one point.
- **Measured (probe 6):** the number of drawn centre pairs closer than 2 m grows from 23 to 87 at demand 3 with the bridge closed (from 5 to 9 at default demand).
- **Effect.** No test fails because of this, and it may be acceptable. It is, however, a visible change ("cars you can follow" and "congestion visible through vehicle behaviour").
- **Fix.** Have the Gold reviewer look at a congested junction in smoke step 1 and record what they see. Mention it at the epic gate.

### m4 (MINOR): smoke step 4 still describes the rejected design
- **Where:** `ward-003.md:115` says "The hover outline is clearly a ring, not a wider road."
- **Problem.** The spec (:63) now specifies a **dashed centre stroke**.
- **Fix.** Change step 4 to "The hovered road shows a dashed stroke along its centre; a congested road never does."

### m5 (MINOR): leftover dead code in test 3
- **Where:** `web/tests/motion.test.ts:94` and `:130`.
- **Problem.** `end` is unused (`void end`), and `city().ready.network` is re-read inside the inner loop.
- **Fix.** Cosmetic only. Leave it, since the tests freeze at approval.

## Not a problem (checked)
- **Test 8 exemptions and counting.** A reroute counts as exempt whether it happens on the same link (`next` changed) or as a crossing into an unpredicted link. A lane-exempt crossing (40 % of crossings in the probe) does not count toward the 3 crossings. Same-lane crossings are plentiful: 6.6 k in 60 s city-wide.
- **Test 8 cost.** Each `path` call makes at most about 30 `drawAt` calls per rAF at 5×, which is negligible.
- **Ring check timing.** `trackedScreenCenter` already uses `performance.now()` fresh (`App.tsx:840`), and so would `trackedDraw`. Under Follow, both use the same camera at call time.
- **Test 10 baseline.** The before count is 0 bright pixels with vehicles hidden (round-2 run and this run: "0 → 0" at 0.07). The +20 bar is below the 25 guaranteed pixels of a 6 × 6 core.
- **Test 4's `toEqual({ link, s })`.** It passes with the reference, and the spec fixes the return shape.
- **Scope of HEAD's diff.** It touches only the three test files, the ward spec and the round-2 review. The frozen `core_004_frame.rs` is untouched.
