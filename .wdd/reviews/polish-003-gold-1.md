# polish-003 Gold review 1

**Verdict: APPROVED** (no BLOCKER or MAJOR against the Red-approved ward contract). Two findings (F1, F2) are spec-level limitations that the frozen tests lock in. The implementation cannot fix them in this ward, so they must be **presented to the human at the epic gate** as deviations from epic P3.

Reviewer: fresh Gold subagent. Diff reviewed: `git diff 7c97251..HEAD` (12 files, +386/−56).

## What I ran
| Check | Result |
|---|---|
| Frozen hashes | All 3 match: `polish_003_next_links.rs` 8d0b6361…, `motion.test.ts` 6b83cbd1…, `motion.spec.ts` 6878ebd5…. The diff touches no test or e2e file. The only spec change is the `status` line. |
| `pnpm -C web build:wasm` | ok, rebuilt from HEAD |
| `cargo test --workspace --release` | 174 passed, 0 failed (includes `next_links_follow_routes`, snapshot/branch/determinism suites) |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web test` | 116/116 (motion.test.ts 5/5) |
| `pnpm -C web e2e` | 103 passed, 1 skipped (`review1` G4, an old `test.skip`), 17.2 min. All 4 motion.spec tests pass, as do the frozen `gold5` G1, `look.spec` and `gold_city003` Follow tests. |

## Smoke log (Playwright MCP, dev server :5299, Chromium/ANGLE Metal)
1. **Turns at 1× (central bridge, 3.2 px/m):** cars curve onto the next road with no lateral jump. However, a moving car **stops at the end of the curve for up to one frame interval and then leaps ahead**. Measured on a followed car at 1×: frozen for 467 ms, then a 7.13 m step (16 px at 2.24 px/m). At 5×: a 6.64 m step after a short hold. See F1.
2. **Track + Follow at 5×:** across 1394 rAF samples, the ring sits on `trackedDraw` within 0.05 px and the camera moves with the car. The median step is 0.90 m and p99 is 1.49 m. The only large step is the junction leap from F1. Both crossings went into the predicted lane.
3. **Speed 20→5→60→1→20→5→60 while tracking (3 cars, 955 samples):** I saw no backward step caused by a speed change. At **steady 20×**, cars step back 0.15–0.74 m about every 100 ms. See F4. There were none at 1×, 5× or 60×.
4. **Hover (`?demand=3`, paused):**
   - An empty road shows the grey halo plus a white dashed centre stroke, which is clearly a dash pattern.
   - A congested road (link 16, occupancy 1.0, 0.95 px/m) shows the dashes between the queued cars, and it is distinguishable without hue.
   - The halo is still there (see F3).
5. **Closure:** after B, the ring sign is visible at fit zoom (0.155) with the hatch and both barriers, and at MIN_ZOOM 0.05. I checked the full-screen shot as well.
   - **c6:** the north-bridge railings are visible over land and over water at 1.6 px/m.
6. **Red r3 m3 (congested junctions):** see F2.

Pass criteria:
- Turns smooth: **partly met.** There is no lateral jump, but moving cars hold and then leap forward (F1).
- No backward step on a speed change: met. F4 is steady-state behaviour and is not caused by a speed change.
- Hover distinguishable without hue: met.
- Closure visible at every zoom: met.

## Code checks
- **Determinism / boundary:**
  - `write_next_links` / `World::for_each_on_network_next` (world.rs:1520) only read the world. They use the same `lanes.iter().flatten().flatten()` order as `for_each_on_network_trip`.
  - Test 1 asserts that `state_hash` is unchanged by encoding.
  - Rust gains no screen coordinates or colours.
- **Shader = motion.ts:** `VEH_VS` `lanePoint` matches `vehiclePosition`: the same texel ends, normal, `(lanes−1)/2 − lane` and clamp. `linkDir` matches `dirOf`. The blend test (`s > len − blend`), the control-point conditions, the fallback, the Bézier and the tangent fallback are identical. Test 7 confirms the GPU output.
- **Picking:** `pickVehicle` gets `r.next` and uses the same clamp plus `vehicleDrawPosition` (picking.ts:62–66). `vehicleScreenCenter` uses `drawPose`.
- **Compare:** B gets `f.nextLinks` live (App.tsx:284) and on late renderer creation (`bRecordsRef.next`, App.tsx:416).
- **Diagnostics:** `frameBytes` = records + next links, in both A and B. Measured at the default demand: 1703 vehicles → 30 654 B (27 248 + 3 406), +12.5 %.
- **Docs:** the `protocol.ts` header and `FrameMessage.nextLinks` are documented. The data-flow section of `docs/architecture.md` is updated (two small inaccuracies, F6).

## Findings
### F1 (MINOR for this ward; ESCALATE at epic gate). Moving cars hold at the end of the curve, then leap 6–7 m
- **Where:** `web/src/render/motion.ts:89–93` (`extrapolate` clamps at the link end) and the matching clamp in `VEH_VS`. This is mandated by spec Outputs and frozen test 4.
- **Problem.** The car is drawn at the next link's start until the next tick arrives, and then appears at the sim's position on the next link.
  - At 1× this means a stop of up to 500 ms and then a step of up to v·0.5 s (measured: 467 ms, then 7.13 m ≈ 16 px at the reference zoom).
  - Epic P3 c1 says "no jump of more than 2 px at 2.24 px/m". The ward reinterpreted this as *geometric* continuity (displacement ≤ drawn path + 0.9 m, test 8). A leap along the path passes test 8 but is visibly a jump.
  - It is **not a regression**: the old code had the same clamp plus the 4.6 m lateral offset.
- **Fix:** outside this ward, because frozen tests 3(a)/4 pin "clamp at end, end = next start". Options for a follow-up:
  - draw one frame behind and interpolate between frames, keyed by trip id (the record→trip table already exists in sim-wasm);
  - or extrapolate onto `next` only for records that are not held.
- Present this to the human as a P3 deviation.

### F2 (MINOR, ESCALATE at epic gate). Red r3 m3 confirmed: held cars are drawn inside the junction and stack
- **Where:** the same rule (`vehicleDrawPosition` at `s = length`).
- **Problem.** A queued car held at its stop line (`s = length`) is drawn at the next link's start. That is past the junction box and on the next road, heading along it. Cars from different approaches (and both lanes of one approach) with the same next link are drawn on one point.
  - `?demand=3`, main bridge closed 10 sim min: 120 blend-zone cars, and 60 cross-link overlap pairs (< 1.5 m), with spots of up to 4 cars on one point. At link 6, two cars from both lanes of link 107 and one from link 4 sit on one square, and the visible queues end short of the stop line.
  - Default demand, main bridge closed 10 min: 13 of 170 queued cars are drawn in junctions, with 6 cross-link overlap pairs.
  - Before this ward, these cars sat separately at their own stop lines. The effect is local and modest at the default demand, but it is a small readability regression at exactly the queues the demo is about.
  - The frozen tests (3(a), 4, 7) pin it, so it cannot be fixed under them.
- **Fix:** together with F1 in a follow-up. One option is to end the curve inside the junction gap (no farther than the in-link stop line) and draw queued records straight. Record it as a known issue at the epic gate.

### F3 (MINOR). Hover deviates from the spec wording
- **Where:** `renderer.ts:152–154`.
- **Problem.** The spec says the dashed stroke is drawn "instead of the light-grey halo". The implementation keeps the halo (the frozen `gold5` G1 requires it) and adds the dashes. The result reads well. The smoke step 4 wording ("hover outline is clearly a ring") is stale.
- **Fix:** record the deviation in CONTEXT / the epic-gate deviations list.

### F4 (MINOR, pre-existing). Backward jitter at steady 20×
- **Problem.** Between new-tick frames, the extrapolation at the requested rate overshoots the next frame. Cars step back 0.15–0.74 m about every 100 ms.
- **Not a regression:** the old anchor logic was the same, and the new 1.5× cap is tighter than the old 2 s cap. Spec test 5 only covers speed changes and same-tick frames.
- **Fix (later):** derive the rate from the measured new-tick frame interval (`advanceS / interval`).

### F5 (MINOR). The closure sign is a ring, not "a white core of at least 6 × 6 CSS px"
- **Where:** `renderer.ts:28–30, 189–196`.
- **Problem.** The sign has a white annulus from r = 5 to 7 px, between dark rings, with the hatch visible inside. It is clearly visible at MIN_ZOOM and at fit, and test 10 passes. It is a deviation from the spec text, forced by `look.spec` needing hatch yellow at the midpoint.
- **Also:** it resembles the legend's "Selected / followed (halo, ring)" icon, and the legend's "Closed road (hatch, barriers)" entry does not show the sign.
- **Fix:** record the deviation, and add the sign to the legend entry (in a later polish ward).

### F6 (MINOR). Docs and allocation details
- `docs/architecture.md:26` says the cap is "1.5 × the frame interval". It is 1.5 × the expected sim advance (the tick delta of the last two new-tick frames × DT).
  - Step 2 still implies the whole frame is transferred, but `nextLinks` is structured-cloned.
- `host.ts:523`: `next_links()` clones the wasm Vec into a new `Uint16Array` per frame, and the array is then structured-cloned again, because it is not in the transfer list (`host.ts:536`). The spec says both "transferable or a fresh copy" and "no per-frame allocation added". This is the same pattern as `link_counts`/`link_queued` and costs 2 B per vehicle.
  - Cheap improvement: add `nextLinks.buffer` to the transfer list.
- Must DO "measure frame bytes before/after" is not recorded yet. My measurement is above (+12.5 %, 16 → 18 B per vehicle). Put it into CONTEXT when completing.

## Summary
- All suites are green and the frozen tests are unchanged.
- Determinism and the sim/render boundary are intact. The shader mirrors `motion.ts` exactly, and picking, Follow, the ring and compare B all use the new rule.
- P3 c2–c6 are met in the browser.
- c1 is met laterally. The remaining hold-and-leap at junctions (F1) and the stacking of held cars (F2) come from the frozen spec rule, not from the implementation. They must be shown to the human at the epic gate as deviations from P3, with a follow-up proposal.
