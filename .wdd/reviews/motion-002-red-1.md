# motion-002 Red gate, review 1

**Verdict: REJECTED**

Reviewer: fresh adversarial Red reviewer (subagent), 2026-10-12. Worktree HEAD c44536c (public-main).

## Files under review (sha256)
- `web/tests/motion002.test.ts`: `c358363087ac57295aa1f7af185b1080d908056928627f78b8f241d45bba83f6`
- `web/e2e/motion002.spec.ts`: `213fe52f6b9bbe9e3c7ee5e020b24ad7d5b5374f9e88122d7e541d30ffe7c656`

## Supersession checks
- `git diff ceaa65e..HEAD -- web/tests web/e2e crates`: only the two new motion002 files, plus the `test.skip` + comment markers on `motion.test.ts` tests 3–6 and `motion.spec.ts` test 7. No other frozen test was touched. OK.
- Hashes match the log: `git show ceaa65e:web/tests/motion.test.ts | shasum -a 256` = `6b83cbd1…af98be` (S4–S7), and `git show ceaa65e:web/e2e/motion.spec.ts | shasum -a 256` = `6878ebd5…cef72` (S8). OK.
- Intent carried: **not fully.** S4 and S8 lose valid intent. See M6 and M7.

## Method
I wrote a throw-away prototype `Presenter` in an untracked copy, ran a copy of `motion002.test.ts` against it, and deleted both afterwards. Real trip ids were attached via `sim.trip_at_record`. The prototype:
- resets per spec;
- uses `D`, holds at the newest frame, and catches up at 1.5×;
- clamps to the stop line;
- draws the transition along the drawn arc length.

With it, tests 2, 3, 4, 5, 6 and 8 all pass, so the tests are satisfiable. I then flipped single behaviours to check whether the tests catch known shortcuts and bugs:

| Variant | Tests 2–6, 8 | Should they fail? |
|---|---|---|
| Release from held jumps (path starts at sim `s = length`, i.e. the curve end) | all green; worst pose step **8.56 m** | yes (i1) |
| P snaps forward (`P = newest − D` when lag > 2D) | all green; one forward snap of **1.07 sim s** | yes (c2/c3) |
| Matching by record index instead of trip id | test 5 **green**; only test 4 fails, by accident of real data | test 5 should |
| Transition progress by sim distance on today's Bézier | test 3 fails: 2.27× mean step on the 90° turn | (see m2) |

## MAJOR findings

**M1: Release of a held car is never tested. A jump on release passes everything.**
- Where: `motion002.test.ts` tests 2 (155–183) and 3 (185–234).
- Test 2 covers only the held phase. Test 3 starts the car at `A.length − 12` while moving.
- The defining i1/i2 case is not covered: several frames at `(A, length, v=0, queued)`, then `(B, 2)`.
  - In that case the car is drawn at the stop line, and then the transition path naturally begins at sim `s = length`, which is the curve end (B's start).
  - The prototype jumps **8.56 m** in one sample, and every motion002 test stays green.
  - Kept `motion.spec` test 8 exempts this case: `next` changes from NO_NEXT to B, so it falls under "exempt".
  - E2e test 10 checks only `s`, not the pose.
- This is the user's "traverse the junction only once the simulation permits; visually continuous" and "queueing and release".
- **Fix:** add a held→release sequence (≥ 3 held frames, then B at 2, 4, …), for the straight pair and the sharp turn. Require:
  - the first transition pose equals the held stop-line pose;
  - every step ≤ a bound relative to the drawn path (as in test 3);
  - the heading turns gradually;
  - there is no backward step along the drawn path.

**M2: Forward discontinuities are unbounded. Test 4 is one-sided.**
- Where: test 4, 266–281.
- Test 4 asserts only: P non-decreasing, P ≤ newest, and per-trip `s` non-decreasing on the same link.
- An implementation that snaps P forward on a delayed frame or a speed change passes. Verified: a 1.07 s snap went unnoticed. Its visible forward jumps are exactly the "speed changes or delayed worker frames create discontinuities" that this ward must fix.
- The spec's catch-up cap ("at up to 1.5 × rate") is tested nowhere.
- **Fix:** in test 4, assert at every sample that `ΔP ≤ 1.5 · requestedRate · Δwall + ε`, using the rate in force at that moment. Optionally also bound each trip's pose step by its drawn path length.
- Add a pure case: a stall of more than 2·D, then frames resume. P catches up at ≤ 1.5× without jumping.

**M3: Pause and resume are untested.**
- Where: `PAUSED` at line 94 is declared and never used (`void PAUSED` at 379). Test 4 filters out paused frames (line 252).
- The Model and Outputs say "settles on the newest frame when paused". The task lists "Pause and resume" explicitly.
- Nothing checks that:
  - P settles on the newest frame and never goes beyond it;
  - resume neither steps back (for example by re-trailing to `newest − D`) nor jumps.
- **Fix:** a pure test. Running → paused frame: P reaches the newest frame, monotonically and without overshoot. Then resume with new frames: P is non-decreasing, has no jump (bounded as in M2), and no trip goes backwards.

**M4: The identity test does not discriminate record-index matching.**
- Where: test 5, 289–328.
- Verified: a presenter that matches by record index passes test 5. Trip 10 moves to record 2, which did not exist before, so it "appears" at `s = 14`, inside [10, 14]. Trip 11 keeps record 1, and t10 is never checked after tick 401.
- Only test 4 happened to catch it, by an accident of real data. Index matching is the exact shortcut the user names.
- **Fix:** in frame 401, give trip 10 a record index that held another trip on the same link in frame 400 (for example, swap 10 and 11). Assert t10 and t11 throughout both intervals, including t10 ∈ [14, 18] after 401. Assert that t12 is never drawn on A, i.e. never slid from the record-0 car.

**M5: The shared presentation time can be faked.**
- Where: e2e test 7 (100–121) is the only check. It reads `diagnostics().presentation`, so a diagnostics object that reports `tickB = tickA` passes while A and B draw at different P.
- `PresentationClock`, and the `clock` constructor argument of `Presenter`, have no test at all. They appear only in the orphan list.
- **Fix:**
  - A pure test: two Presenters share one `PresentationClock`, and A and B frames arrive at different wall times and cadences. Each call returns the identical P, and P never exceeds either side's newest frame.
  - In e2e, the reported tick must be the one each renderer actually drew with. For example, add a per-side drawn-P stat set by the render loop, or add a per-side `vehicleDraw` check showing that both sides' presented `s` for a shared trip correspond to the same P.

**M6: E2e test 9 drops S8's negative control, and no browser test pins the running state.**
- Where: `motion002.spec.ts` 144–196.
- Superseded test 7 required cars at their CPU point *and* "the straight (old) points mostly empty". Test 9 checks only "luminance differs at the hook point". It also checks the first 12 visible cars in record order, which are not necessarily held cars.
- In a queue, the follower sits 7.5 m back with a 3.6 m queued body (renderer `VEH_VS` size 3.6), so it covers the head car's stop-line point (len − 9.3 … len − 5.7 ∋ len − 6). A GPU that still draws held cars at the next link's start (the old shader) would very likely pass.
- The held-position assertions use only the hook (`vehicleDraw`), and only while paused.
- No browser test fails deterministically on today's *running* behaviour. Test 10 caught i4 once in my run at 20× (392.997 → 392.5 m); the caller reports it passing.
- **Fix:**
  - Sample held head cars specifically. Prefer ones with no follower within 9 m, or sample a point beyond the stop line, not between it and the follower.
  - Also sample their old-rule points (the next link's start, or `drawAt(link, length, lane, nextLinks[record])`) and require most of those to be empty with vehicles shown versus hidden.
  - Add a running check: at 20× with the bridge closed, sample `vehicleDraw` of held cars for 2 s. All must be ≤ the stop line with `next = NO_NEXT`. This fails on today's code.

**M7: Supersession S4 loses breadth. The new visual rule (`visualPose` = `drawAt`) is untested.**
- Old test 3 swept **every** junction pair (> 300) × **every lane**:
  - continuity through the curve;
  - end = next lane start, heading along B;
  - exact straight placement off the curve;
  - NO_NEXT placement for 40 links.
- Test 3 now checks **two** pairs, lane 0 only, and only links ≥ 40 m (`pairs()` line 59–61). Never tested:
  - short links, where `STOP_M = length/2`;
  - multi-lane entry (`min(lane, b.lanes − 1)`);
  - the end heading;
  - any lane but 0.
- `visualPose` is exported but untested. It is the rule that kept `motion.spec` test 8 relies on through `drawAt`.
- **Fix:** a network-wide sweep of `visualPose`, over all non-U-turn pairs × lanes, short links included:
  - with `next`: continuity for s ∈ [stopLine, length] (step bound), end = B's lane-start placement, heading at the end along B;
  - straight placement for s ≤ stopLine;
  - with NO_NEXT: placement at min(s, stopLine).

## MINOR findings
- **m1: test 3's thresholds are fragile and depend on timing.**
  - Lines 192–194, 220–222 and 294–298 push all frames, with future timestamps, *before* any `advance`.
  - The step bound uses the mean step over all samples, so it assumes P advances uniformly over the whole window. Any hold (an implementation that takes "now" from `push`, or pushes in time order) halves the mean and fails "no jump" for the wrong reason.
  - The endpoint tolerance of 0.05 m holds only if P lands exactly on 201·DT. At 1×, one 2 ms sample is ≈ 0.06–0.07 m of path.
  - Push in time order, compare each step with the path fraction of its ΔP, and take the endpoint at P = 201·DT exactly.
- **m2: the spec and test 3 disagree.**
  - The spec says transition progress "follows sim distance" on "the curve as today". Read that way, the 90° turn gives a 2.27× mean step (the curve is 9.1 m drawn for 6 m of sim), and test 3 fails.
  - The test effectively requires uniform progress along the drawn arc length. State that in the spec.
  - Require the hook `s` to stay consistent with `drawAt` (`drawAt(link, s, lane, next)` = the pose), because kept `motion.spec` test 8 measures path length through `drawAt`.
- **m3: test 2 does not pin the held pose to the stop line.**
  - It checks only ≤ the stop line plus "not at B's start". Drawing a held car anywhere behind (for example at s = 0) passes, and `held.s` is never checked.
  - Assert pose = `vehiclePosition(A, stopLine(A), lane)` and `held.s = stopLine(A)`.
- **m4: spec consequence for the epic gate.** The head car drawn at len − 6 overlaps its follower at len − 7.5 (2 × 1.8 m half-bodies give ≈ 2.1 m overlap) at every queue front. The test pins it: "exactly its own s" for s < the stop line. Document it, or reconsider before Gold.
- **m5: test 1 is weaker than its spec row.**
  - It checks trip id correctness for one record, not "every record".
  - The `if (j >= 0)` check can be vacuous.
  - "Record index changes" is never asserted.
  - After the seek and in B, it checks length and uniqueness only.
  - Proxy `createSim` and compare `trip_at_record(tick, i)` for all records in A, after the seek, and in B (proxy the branch's Sim too).
- **m6: test 4's progress checks cover the same link only.** Returning to an earlier link is not caught (e2e test 10 does catch it). "Beyond the newest position" is checked only when the link matches.
- **m7: the seek heuristic is weak.** "> 8 ticks" misses a short forward seek (≤ 8 ticks would be interpolated). A stalled worker at 60× (≥ 9 ticks per frame) resets on ordinary playback. Consider an explicit timeline epoch in the frame, or at least document the limit.
- **m8: test 9 filters held cars with the hook's own `length`** (the value under test). Use `ready.network` link lengths. It currently fails for the right reason: `length` is missing, so 0 held cars.
- **m9: test 10 catches today's i4 only probabilistically** (it failed here at 20× and passes for the caller). It is fine as a regression guard, but see M6.
- **m10: e2e test 8 never checks `lagMs` against `lagS / rate`**, so a fake `lagMs` passes. Spec items with no test:
  - lane-change interpolation;
  - the history cap of ≤ 8 frames;
  - `D` capped at 4·DT;
  - "achieved rate when behind".
- **m11: `no_orphaned_exports` fails in Red** (`PresentedVehicle`, `PresentationClock`, `visualPose`). That is acceptable: it forces wiring in Gold. It must be resolved by real use (M5, M7), never by an ALLOWLIST entry.

## What is sound
- Every test fails for the right reason now: the stub throws, `tripIds` is missing, the hook has no `length`, and `diagnostics().presentation` is undefined.
- `stopLine` and the `STOP_M` geometry are correct, and the f32 rounding of `length − 20` / `length − 12` is exact.
- Test 6 is sound for the cases it lists.
- Test 8's bounds are consistent with `D` + one frame interval.
- No conflict found with the kept frozen tests: `motion.spec` 8, 9 and 10, Follow/picking via `vehicleScreenCenter` ≡ `pickAt`, 16 B records, and `sim`/`host` sizes. The condition is that hook `s` stays consistent with `drawAt` (m2).
- The e2e setup works on SwiftShader. Test 7 reaches compare.

## Commands and results
Load (`uptime`): 8.59 / 8.77 / 9.44 at start, 6.88 at the vitest runs, 11.23 / 10.78 / 9.86 during the e2e run (shared, loaded machine).
- `pnpm -C web exec vitest run tests/motion002.test.ts`: 7/7 fail. Test 1: "a tripIds array: expected undefined". Tests 2–6 and 8: "presentation: not implemented".
- `pnpm -C web test`: 2 files failed, 27 passed. 8 tests failed (motion002 ×7 + `integration` `no_orphaned_exports`: `PresentedVehicle`, `PresentationClock`, `visualPose`), 129 passed, 7 skipped (S1–S8 markers).
- `pnpm -C web typecheck`: clean.
- `pnpm -C web exec playwright test e2e/motion002.spec.ts --reporter=line` (port 5190 from the config): 4 failed.
  - Test 7: `presentation` is null.
  - Test 8: median NaN.
  - Test 9: 0 held cars (`length` missing).
  - Test 10: "20×: tracked car steps back on link 284 (392.997 → 392.5)", which is today's i4.
- Prototype experiments (untracked; deleted, `git status` clean): see the table under Method.
