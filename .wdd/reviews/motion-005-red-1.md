# motion-005 Red gate, round 1

**Verdict: REJECTED** (0 blocker, 3 major, 6 minor)

Reviewer: fresh adversarial Red reviewer (subagent), 2026-10-13. Commit under review: 80d529c.

## Hashes verified
- `web/tests/motion005.test.ts` sha256 `048ff0f1ae43713729ec844dfaa4b4ab1e3a4d2545acb389c5167985c5c9b769`: matches.
- `web/e2e/motion005.spec.ts` sha256 `f964f6c603309477a79700eb8b4ba4de422e49e8aa0cd603256becbe0d88aaa3`: matches.
- Supersession log hashes, checked with `git show <commit>:<file> | shasum -a 256`. All four match: review2.test.ts@19e9fbf `f3856b…6c0a`, review3.test.ts@19e9fbf `499373…7e`, motion.test.ts@ceaa65e `6b83cb…be`, motion.spec.ts@ceaa65e `6878eb…f72`.

## Commands and results
- `pnpm -C web exec vitest run tests/motion005.test.ts`: 2 failed, as the spec predicts.
  - Test 7 passes the supersession, known-issues and WDD-state parts, then fails at `read('docs/verification/motion-005.md')` (line 54).
  - Test 8 fails at the missing `web/perf-results/motion-epic-before-after.json`.
- Baseline e2e on a scratch copy (`git archive HEAD web`, the worktree's wasm copied in, node_modules symlinked, PORT 5401): `playwright test e2e/motion005.spec.ts`.
  - Run 1: **9/9 passed** in 2.4 min (load 7 → 20).
  - Run 2: **9/9 passed** in 2.3 min (load 21.6 → 16.9; 14 cores).
  - No flakiness seen. Mutation runs went two at a time at load 19–27, and the unaffected cases still passed.

## Mutations (each on its own scratch copy, ports 5402–5411; only the relevant flows run)
| id | mutation (realistic regression) | flows run | result |
|---|---|---|---|
| mA | Presentation off: `Presenter.advance` sets `P` = newest frame time, so cars are drawn at their frame records | 1, 4, 5 at both speeds | **Caught at 1×** in all three ("1× junction: step of 7.36 m in 42 ms", "1× resume: 13.73 m", "1× on B: 7.46 m"). **Not caught at 20×** (bound ≈ 22 m per frame). |
| mX | Old-style running ahead / extrapolation: `P` = clock + 2·DT, alpha unclamped up to 3 | 1, 4, 5 at both speeds | **Caught, 6/6**, at 20× too ("no backward step on link 284"). |
| mB | Paused frames posted every 16 ms again (`running &&` dropped from the host's post condition) | 4 at both speeds | **Caught** at both speeds ("frames received while paused"). |
| mC | Held cars past the stop line: `visualS` end zone not compressed, plus the straight clamp at `l.length` instead of `stop` | 2 | **Caught** at 1× ("queued cars held behind the stop line"). |
| mD1 | Closure ring not drawn: the ring fragment is discarded in `BAR_FS` | 3 | **NOT caught**: passed. |
| mD2 | Close entries missing from `summarizeInterventions` | 3 | **Caught.** |
| mE | Presenter keeps its old frames across a seek: on reset, append instead of replace; the clock is still reset | 5 at both speeds | **NOT caught**: passed at 1× and 20×. |
| mE2 | Presenter never resets on epoch or tick-back, and the clock accepts the older tick | 5 at both speeds | **Caught** ("the presentation stands on the new frame"). |
| mF | Separate `PresentationClock` for B | 6 | **Caught** ("1×: one presentation time"). |
| mH | Presentation frozen after any seek or branch: the clock's `lastMs` is set to ∞ on its 2nd+ reset | 1 (1×), 5 at both speeds, 6 | **NOT caught** for flow 5 at 1× or flow 6 (both speeds). Flow 5 at 20× failed only incidentally: the MAX_KEPT overflow reset caused a 508 m jump. Flow 1 passed, as expected (no seek). |

## Findings

### MAJOR 1: flow 5 cannot catch "the presenter keeps history across a seek" (mE), which the spec names as its mutation
- Test 5 pauses first and waits until `running === false`. By then the animation frames have caught `P` up to the newest frame, and `advance` has trimmed the presenter to a single frame.
- So a presenter that keeps its history across a seek (mE) has nothing stale left to show, and test 5 passes at both speeds.
- In the product, a seek can arrive while the presenter still holds several running frames: "−1 min" is clickable during playback, and the host pauses on seek. With mE, those old frames have T > the new P. The cars are then drawn at their **old** places and stay there while paused. That is exactly the stale-motion defect the user's task names ("Seek and scenario changes clear stale motion history").
- **Fix:** add a seek **while running** at each speed: click "−1 min" during playback, without pausing first, and sample from the click. Apply the same assertions as now (presentation on the new frame; ≥ 95 % of cars on their new record's link within 15 m; no motion while the result is paused).
  - Keep the paused case too.
  - Ideally also do one branch while running if the UI allows it.
  - Verify that mE then fails.

### MAJOR 2: motion after a branch (flow 5 at 1×) and in the comparison (flow 6) is never required. A frozen presentation passes.
- Test 5 "Resume on B" runs `checkTracked` over 3 s. That only checks bounds, backward steps and route order, all of which a frozen car satisfies. Its only progress check is that B's **tick** advances in the snapshot. The drawn car's progress is never checked, although test 4 does check it after its resume.
- Test 6 checks `sides.a.tick === sides.b.tick`, camera equality, and `presentation.tickA === tickB`. Two frozen presentations are equal. Nothing requires the drawn cars, or `tickA`, to advance, although the smoke test says "Both maps move together".
- mH (the presentation frozen after a seek or branch) passes flow 5 at 1× and flow 6 at both speeds.
- **Fix:**
  - **(a) Test 5:** after the resume on B, apply test 4's progress assertion: the last sample's ŝ > the first, or a later route link is reached.
  - **(b) Test 6:** at each speed, require `presentation.tickA` (and `tickB`) of the last sample to exceed the first by ≥ 0.5·m·3 s / DT·k for a reasonable k. A simpler alternative is "≥ +5 ticks", as motion002 test 7 does. Also require that some car on each side moves: sample one `vehicleDraw` per side (or a followed car on A) and check the motion bound, with nonzero total movement.
  - Verify that mH fails.

### MAJOR 3: flow 3's "ring" assertion is tautological. A missing ring (mD1) passes.
- `closureSigns()` (App.tsx ~1240) is computed from `frameRef.current.closed` and the link geometry. It never asks the renderer what it drew. So "a ring within 2 px of each central link's drawn midpoint" restates `closed ⊇ main` plus geometry.
- With the ring fragment discarded, test 3 passes.
- The spec lists "closure ring missing" as a mutation that test 3 must catch.
- **Fix:** make test 3 look at the picture at each ring position, at both speeds. For example:
  - read the canvas pixels (screenshot crop) on a circle of radius ≈ `radiusPx − 1.5` around `closureSigns().page`, and require the near-white ring core: luminance > 0.85 on ≥ 70 % of the circle points;
  - and/or compare against the same crop after the reopen (ring gone).
  - Verify that mD1 fails.
- (look.spec may pin the ring elsewhere in the full suite. That does not make this flow's check meaningful, and the spec claims it here.)

### minor 1: the bracket checks in tests 1 and 4 are tautological
`trackedMarker()` and `trackedScreenCenter()` both call `renderer.trackedWorldPosition()`, so their distance is always 0. Either drop the claim or check against something independent, for example `trackedDraw().page` from the presenter (also the same source…) or pixels. motion-004 pixel-checks the brackets, so this is minor. Do not list it as an integration check.

### minor 2: the 20× halves of flows 1, 4 and 5 do not catch "cars drawn at frame records" (mA)
At m = 20 the bound is about 22 m per animation frame, while the record steps are about 7 m. The 20× half does catch running-ahead backward steps (mX), so it has value. But the spec says flows 1 and 5 fail on mA without qualification. Correct the spec wording ("at 1×; at 20× the backward-step check catches extrapolation"). Optionally add a 20× smoothness check, for example a step of ≤ 2 × the median step over the window for the followed car while on one link.

### minor 3: test 4 is weaker than the spec
The spec says `renderFrames` grows by **≥ 30** in 2 s; the test asserts ≥ 20 (line 216). Align them, or justify 20 in the spec (SwiftShader at load).

### minor 4: test 1's "next on the route" accepts skipped links, and can false-fail at 20×
- `prev.route.indexOf(link) >= 1` accepts any later route link, not only the next one, so a skip of two links passes the route rule. The motion bound would usually catch it at 1×, but not at 20×. Tighten it to `=== 1`, or to "every link between was drawn".
- Conversely, `trackedRoute` comes from the newest frame while drawing lags by up to 4·DT. At 20× a short link can be both entered and left within the lag. The drawn link is then neither `prev.route[≥1]` nor `x.route[0]`, which gives a false failure.
- Suggested rule: the entered link is the next link after the previously drawn one in the union of the routes seen so far.

### minor 5: test 8 accepts a single series where the spec requires scenarios, and does not check "per run" or interleaving
- `renderIntervalMedianMs/P95Ms` need baseline 1×, baseline 20× and stress; `presentationLagMsMedian` needs 1× and 20×. The test accepts any single series. Require labelled sub-series for these, with the scenario labels from the spec.
- `load1min` "has an entry per run" is checked only as ≥ 4 keys.
- Interleaving cannot be verified. Ask for a `runs: [{label, commit, startedAt}]` list, and check that it alternates before/after and spans ≤ 1 h.
- `frameBytes` at 19e9fbf counted fewer arrays (no `tripIds`) than at HEAD. The note or JSON should define the measure; `transferBytesPerS`, measured by the probe's Worker shim, is the comparable one. Ask that the definition be stated in the JSON.
- The table check matches numbers against *any* number in the JSON (viewport, load…). Match each row against that metric's own values.

### minor 6: test 7's verification-doc check can be satisfied by a hollow doc
- One line holding "junction queue reopen pause branch compar 1× 20×", plus one PNG linked 12 times, passes.
- Require 12 **distinct** linked PNGs, and one line or row per flow × speed that names its own PNG.
- The supersession sha256 is not checked against git. It is verified manually above, so this is acceptable.

## Feasibility of the measurement plan
Feasible, with the scope gaps of minor 5:
- 19e9fbf contains `perf.spec.ts` with the same `tickMsMean`, `renderInterval*` and `frameBytes` fields, and `examples/frame_cost_probe.rs`.
- `scripts/paused_probe.mjs` is external (`node paused_probe.mjs <baseURL>`), so it can measure the "before" build too.
- `transferBytesPerS` while running needs a small probe variant: the same Worker shim, running at 20×. That is feasible.
- `presentationLagMsMedian` uses `diagnostics().presentation.lagMs`, which has no before value, and `before: null` plus a note is allowed.
- The SwiftShader/hardware separation is enforced by the renderer strings.
- The plan covers every § Verification item in the user's task: tick cost, render intervals, payload + transfer rate, paused frames, presentation latency.

## What is good
- The flows are true integration flows (demo order: close → queue → reopen; pause/inspect/resume; rewind/branch; compare), not duplicates of motion-001…004.
- mA, mX, mB, mC, mD2, mE2 and mF are all caught.
- The baseline is stable under load ≈ 20.
- The motion bound is sound at 1×.
- The oracles avoid `drawAt` circularity.
