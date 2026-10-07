# Review city-003 RED 3

**Reviewer:** adversarial test reviewer (fresh subagent, round 3), 2026-10-07
**Verdict:** APPROVED (0 BLOCKER, 0 MAJOR, 3 MINOR)

Scope: `.wdd/wards/city/ward-003.md`, `.wdd/epics/city.md` § C4, `.wdd/reviews/city-003-red-{1,2}.md`, and the tests at commit d6edc8c:
- `crates/sim-core/tests/city_003_inspect.rs` (1–5)
- `web/tests/inspect.test.ts` (6–10)
- `web/e2e/inspect.spec.ts` (11–17)

I also read the code the tests build on: `host.ts` (frames are posted every 16 ms even while paused, so `tracked` reaches the UI while paused), `App.tsx` (DOM order, Escape handler, extrapolation only while running, default 20×, wheel factor), `camera.ts` (`fit`), `testHook.ts` (`linkScreenCenter` already exists), `playwright.config.ts` (120 s test timeout, DPR 1, 1280×800), `world.rs` (trip ids are dense: `next_trip_id` and `spawned` increment together; waiting vehicles are vehicles) and `routing.rs` (`free_flow_cost`).

## What I ran

- `git diff --stat 3347245 d6edc8c`: only the three new test files, the ward and review logs changed. No earlier test file was touched.
- `tsc --noEmit -p web`: 62 errors, all of them TS2339/TS2305/TS2322 for the API that Gold adds (`frameRecords`, `camera`, `trackedTrip`, `pickAt`, `pickVehicle`, `decodeVehicleDetail`, `inspectVehicle`, `tracked`, wasm methods). There are no strict-mode or `noUncheckedIndexedAccess` errors in the test code itself.
- I copied the r2 prototype to `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/r003c/proto`. It reproduces the e2e view in Rust (River City (2026, 7), two-way offset, lane offset, `Camera.fit` at 1280×800 with 64 px padding, ×1.16 wheel steps at the canvas centre, overlay rectangles, the ±16 px on-canvas rule, record order). I measured every 5 ticks for ticks 445–540, which covers where `ready()` + `pause()` can now land (≈ 450–510):

| Premise | Result |
|---|---|
| B1: candidates at z = 1.665 (tests 11, 14) / with the road panel open (test 16) | 20–27 / 20–27 at every sampled tick |
| Test 12: first qualifying candidate | Always k0. Its target is `route[1]` (never the current link), the continuation is straight (0°), and the vehicle is on a 2-lane link |
| Test 13 at z = 2.24: driving (v ≥ 2, not stranded) with ≥ 2 route links | Found at every tick (k0 from tick 450). 6-tick displacement is 15.2 m at tick 450 and 38–46 m after that; the worst case is 6.1 m at tick 445, which `ready()` excludes. The trip ends 194–610 ticks later, so it never ends within the 3 s window |
| Test 14: the first candidate's trip end | 280–619 ticks, completed in every case (≤ 5.2 sim min, ≈ 5 s wall at 60×) |
| Test 15: closure at ticks 450–560 | Before the closure the Old Bridge cost equals free flow (52.19 s). It exceeds ff + 1 after 401–511 ticks, within the 960 bound |

- I wrote a ring rasterisation check (`r003c/ring.py`: 4×4 supersampled coverage, near-white when coverage ≥ 0.9 over a dark background, 12 axis angles × 3 sub-pixel offsets, band 4 px). A minimal spec ring (2 px near-white band at outer radius 7) gives at least **8 per side and 21 in total**. Radius 8–12 gives 13–28 per side. So the two-sided thresholds (≥ 4 per side, ≥ 12 in total) admit every conforming ring. Without a ring, the route line on a straight continuation is one-sided, so it cannot meet the per-side bound.

## Round-2 findings: status
- **B1 (empty zoomed view):** fixed. `ready()` waits for tick ≥ 450 with a bounded timeout of 60 s. The measured candidate counts are above.
- **MAJOR (one-sided route line can fake the ring):** fixed. `lightOffAxisSides` requires a before/after delta of ≥ 4 on each side of the vehicle axis and ≥ 12 in total. Every chosen candidate continues straight, so a ringless implementation cannot get the other side from a turning route link.
- **Minors:**
  - fixed: the ring radius is pinned to 7–12 CSS px in screen space and fits the 30×30 box;
  - fixed: `trackedScreenCenter` is pinned to the extrapolated drawn position that Follow uses;
  - fixed: the test 13 candidate needs ≥ 2 route links;
  - fixed: the tick wait is bounded and lands around ticks 450–510, where the displacement margin is ≥ 15 m.

## MINOR

1. **Test 11 table text does not match the test.** The ward's table says "paused at fit zoom, clicking a vehicle's screen centre". Under the picking rule (r1 M3), and in the test itself, the click happens after `zoomIn(page, 1.5)`. Fix the table: "paused and zoomed to ≥ 1.5 px/m".
2. **The C4 contract in `.wdd/epics/city.md` is stale.** It still says `inspectVehicle { link, lane, index }` and `gone: 'completed' | 'removed'`. The ward refines these to `{ frameTick, record }` resolved through the trip table, and to four outcomes. Update C4, or mark the ward as the authoritative refinement, so the Gold reviewer does not flag a contract deviation.
3. **Test 12 has no settle time before the next candidate's "before" capture.** After `Escape` on a skipped candidate, the loop takes the next candidate's before-luminance without the 300 ms sleep. A leftover ring or route line could only *lower* the delta, so this risks a false failure, never a false pass. It is also unreachable in practice, because k0 always qualifies. An optional fix is `await sleep(300)` before `continue`.

## Not a problem (checked)
- **Rust 1–5.** Trip ids are dense: `next_trip_id` and `spawned` increment together, and waiting-at-origin trips are vehicles. So `counts().spawned` is a correct never-spawned id, and `(0..spawned)` is the right universe in test 3. Test 5 calls every query on every tick against an unqueried twin.
- **Vitest 6–10.** As r2 found:
  - the Proxy budget counts only host calls, not the test's direct `sim` calls;
  - test 8's 4-frame vs 30-frame retention matches the 8-frame rule.
  Paused or 1× frames that share a tick have identical record order, so keying by tick is sound.
- **Test 12 route check.** The target is always `route[1]` (measured). Its midpoint box (24×24) is ≥ 30 px from the vehicle, so the ring cannot reach it. Whether the current link's highlight starts at the vehicle or covers the whole link does not matter.
- **Test 13 centring.** Follow and `trackedScreenCenter` share the extrapolated position. The only gap is the vehicle's motion since the last rAF, which is ≤ 6 px even at 5 fps.
- **Tests 16 and 17.**
  - The canvas is first in DOM order, and there are only a few focusable controls, so 25 Tabs is ample.
  - At fit zoom picking never returns a vehicle, so earlier road-click suites are unaffected.
  - Zone labels are pointer-transparent and static while paused, so they cancel out of the before/after deltas.
- **Durations.** `ready()` takes ≈ 12–15 s at 20×. Every test fits the 120 s timeout.
