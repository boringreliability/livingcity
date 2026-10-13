# motion-005 Gold gate, round 1: REJECTED

**Verdict: REJECTED.** 0 BLOCKER, 2 MAJOR, 4 minor.
- Reviewer: a fresh adversarial Gold reviewer (subagent), 2026-10-13.
- Reviewed: Gold commit `18c0f74` against the Red approval `23da733`.

The six flows work, at 1× and at 20×, under SwiftShader and on the hardware GPU. The Red snapshot is intact, and no product code changed. The rejection is about what was delivered:
- the measurement of the epic's frame payload and transfer rate is wrong;
- the epic's completion criterion (GitHub Actions green) is unmet, and the Gold notes do not report it.

## Commands and results
Load (1 min) was 8.6–19.6 throughout.

| What | Result |
|---|---|
| sha256 `web/tests/motion005.test.ts` | `e7d3031a…af00`: matches the Red snapshot |
| sha256 `web/e2e/motion005.spec.ts` | `2589ddf4…d18d`: matches the Red snapshot |
| `git diff 23da733 18c0f74 -- web/tests web/e2e` | empty |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web exec vitest run` | 33 files; 162 passed, 7 skipped (310 s) |
| `playwright test e2e/motion005.spec.ts`, run 1 | 9/9 passed (2.6 min, load 8.6 → 17.9) |
| `playwright test e2e/motion005.spec.ts`, run 2 | 9/9 passed (2.5 min, load 15.6 → 19.4) |
| The 5 tests that failed in the orchestrator's full e2e run (gold_city003 M1, integration_polish `controls_respond_under_load`, motion.spec `tracked_car_moves_continuously`, motion002 `compare_shares_one_presentation_time`, motion002 `presentation_latency_is_bounded_in_the_browser`) | 5/5 passed alone at load ~17. Lag medians: 1× 282 ms, 20× 37 ms. |
| `gh run list` | **CI is red on `main` for the last 4 pushes** (motion-002 complete … motion-004 complete). `18c0f74` is not pushed (local branch ahead of `origin/main` by 6). |

I did not rerun `cargo test` or clippy: the ward changes no Rust. CI's Rust job is green on `b128cbf`.

## Smoke test (Manual Smoke Test, performed)
- **Setup.** Headed Chromium on the hardware GPU (`ANGLE Metal Renderer: Apple M4 Pro`), 1280×800, a dev server on port 5398 (stopped afterwards).
- **Evidence.** Everything is in `/private/tmp/claude-502/-Users-Z6DEC-kmddev-livingcity--claude-worktrees-epic-sim-core/e54ac286-31c4-4bad-9122-a1c59df1c97d/scratchpad/m5gold1/`:
  - the script: `smoke.mjs`;
  - in `smoke-gpu/`: the video `video/page@5387d07ab5eb4e0edd248e2319af50f1.webm` (60 s, the whole run), the screenshots `01`–`09*.png`, the per-rAF samples `junction-1x.json` and `junction-20x.json`, the results `smoke.json`, and frame tiles extracted from the video in `sheet/` (an overview, and the junction crossings at 10 and 20 fps).

### Steps
1. **A followed car crossing a junction, sampled on every animation frame (120 Hz).**
   - **At 1×:** 1441 samples, 1 link change, the largest step 0.25 m (in 9.4 ms), 0 backward steps, 0 samples over the motion bound, and 99 % of the frames between two sim frames.
   - **At 20×:** 601 samples, 4 link changes, the largest step 7.3 m (in 8.5 ms; the 20× bound there is about 33 m), 0 backward steps, 0 samples over the bound, and 84 % of the frames between two sim frames.
   - At 20×, 43 of the 600 frames have no presentation advance, because the presentation reaches the newest frame (the lag there is 15–25 ms). After a car is released from a stop line, it crosses the junction curve at up to about 40 m/s drawn (the curve is drawn within the compressed end zone). Both stay within the spec's bound; this is an observation only.
2. **Close the Main Bridge at 20×.**
   - `closed` held both central links after 55 ms. 2 rings were drawn, and the `close` "Main Bridge" entry appeared.
   - Pins appeared, with up to 18 queued. At 3+ px/m the queued cars can be counted one by one (`03-queue-zoomed-paused.png`, `04-queue-1x.png`).
   - **Reopen:** the rings disappeared (0 rings), and the queue on the pinned links fell from 24 to 5.
3. **Pause** (`06-paused-diagnostics.png`).
   - Over 2 s: `framesReceived` +0, tick unchanged, `renderFrames` +240. The followed car moved 0 m while paused.
   - On resume at 1×, 721 samples: largest step 0.14 m, 0 backward steps.
   - **However, the Diagnostics panel has no frame-rate or traffic row** (see minor 1).
4. **Rewind 2 min and branch.**
   - The branch was created: scenario B, `branchTick` 2045.
   - My own per-frame rewind filter used the wrong tick threshold (DT 0.5 s), so my sampler recorded no post-seek samples. Seek freshness is instead covered by the two passing runs of flow 5 (running and paused seek, 1× and 20×) and by the video.
5. **Compare side by side.**
   - At 1×: 361 frames; same tick on 361, one presentation time on 361; presA 2051 → 2056.4.
   - At 20×: 361 frames, same on 361; presA 2057 → 2176.4.
   - `comparison().crossings.baseTick` = 2045, the branch tick.
   - Both maps move in the video (`09-compare-*.png`).
6. **Docs against what I saw.** `docs/verification/motion-005.md` matches. `docs/performance.md` does not, for transfer and paused bytes (MAJOR 1). `docs/demo.md` does not, for the Diagnostics panel (minor 1).

## Integration check (epic motion-001…005)
- **Frame fields and their consumers:**
  - `tripIds` → `render/presentation.ts:460` and the frame size;
  - `interventions` and `bridgeFlow` → `ui/consequences.ts` (`summarizeInterventions`, `crossingRates`), App's timeline markers and ConsequencesPanel, and the test hooks;
  - `nextLinks` → picking and the records;
  - `world` → `sim/client.ts` pool tags and the presenter key;
  - `epoch` → the presenter key.

  None is without a consumer.
- **Hooks.** `interventions`, `crossings`, `queuePins`, `bridgeLabels`, `closureSigns`, `trackedMarker`, `routeEnd`, `roadClasses` and `districtSamples` are all implemented in App and used by the e2e tests.
- **UI controls.** Bridge button, Space, `−1 min`, `b`, Compare, `A: original` and D all had an effect in the smoke test.
- **Orphaned exports.** `extrapolate` and `ExtrapolationClock` in `src/render/motion.ts` are dead product code (minor 2).
- **Supersession log.** S1–S8 each name a file with a 64-hex sha256, the test, the pinned behaviour, the reason and the replacing tests. The skips carry `SUPERSEDED … supersessions.md` comments, and the authorization names the task file. Test 7 passes.
- **Known issues.** e2, e3, i1, i2, i4 and i5 are marked resolved, in both `docs/known-issues.md` and `docs/architecture.md`.
- **§ Delivery coverage.** What changed and why, the superseded contracts, the verified tests and flows, the latency trade-off and the remaining limitations are all documented (architecture, known-issues, verification, performance). The payload/transfer trade-off is documented wrongly (MAJOR 1).

## Findings

### MAJOR 1: the epic's transfer and paused-bytes numbers omit the vehicle records, so the payload trade-off is overstated about 7× and paused production understated about 6×
- **Cause.** `epic_probe.mjs` sums `byteLength` only where `ArrayBuffer.isView(v)`. `FrameMessage.vehicles` is a plain, transferred `ArrayBuffer` (`protocol.ts:185`, `host.ts:632`), so the largest buffer, the 16-B-per-vehicle records, is never counted, in either build.
- **Arithmetic check.** The raw `probe.json` gives about 5,000 B per frame "before" at 1,765 vehicles. The records alone are 28 kB. The harness's own `frameBytes` (30.6 kB before) cannot be reconciled with 273 kB/s at 54.6 frames/s.
- **The repo's own record contradicts it.** S1 in `supersessions.md` records the paused cost before the epic as 1.65 MB/s. The epic JSON says 262 kB/s.
- **Re-measured.** I added `ArrayBuffer` counting to a copy of the probe (`m5gold1/probe_fix.mjs`, `ab_fix.py`, results in `fix-runs.json`). Interleaved before/after/before/after, SwiftShader, load 19–24:

| | before-1 | after-1 | before-2 | after-2 |
|---|---|---|---|---|
| Running 20×, all arrays (B/s) | 1,698,545 | 2,061,897 | 1,725,155 | 2,089,960 |
| Per frame, all (B) | 33,248 | 40,519 | 33,251 | 40,510 |
| Typed arrays only (the committed method, B/s) | 255,936 | 625,990 | 259,938 | 634,524 |
| Paused, all (B/s) | 1,672,318 | 0 | 1,662,301 | 0 |

- **What is true.** Transfer while running grew by about 21 % (≈ 1.71 → 2.08 MB/s), not by about 143 % (273 → 665 kB/s). The +7.3 kB per frame is the trip ids (4 B × 1,764 = 7.06 kB) plus about 0.2 kB of consequence data. The per-link arrays did not grow, contrary to `performance.md` ("so it also includes … the per-link arrays"). Paused traffic before the epic was ≈ 1.67 MB/s, not ≈ 262 kB/s.
- **Affected:**
  - the JSON `swiftshader.transferBytesPerS`, `pausedBytesPerS` and `hardware.transferBytesPerS`, and their `source` text ("every typed array in the frame messages");
  - the two tables and the "What the numbers say" bullets in `docs/performance.md` § Epic motion;
  - the Gold commit message.

  The user asked explicitly for "frame payload size and transfer rate" before/after. As committed, that deliverable is wrong.
- **Fix.**
  - Count `ArrayBuffer` values too, or sum `ev.data` recursively.
  - Re-run the interleaved SwiftShader and hardware probes, and rebuild the JSON.
  - Correct the tables and the bullets: about +21 %, the delta is trip ids, paused ≈ 1.67 MB/s → 0.
  - Make the `source` definition explicit. Test 8 only checks `frameBytes`, `renderIntervalMedianMs` and `pausedFramesPerS` rows, so it cannot catch this.

### MAJOR 2: GitHub Actions has been red since motion-002, and the ward's Must DO and pass criterion are unmet and unreported
- **Must DO:** "Check that GitHub Actions is green on the pushed commit (the epic's completion criterion)."
- **Pass criterion:** "All suites are green locally and on GitHub Actions".
- **What happens.** `gh run list` shows `CI` failing on `main` for 4 consecutive pushes:
  - 38324890220 (motion-002 complete);
  - 38344091053;
  - 38375153078 (motion-003 complete);
  - 38444124587 (motion-004 complete).

  Each time the Web job fails because one Vitest test times out at 600 s. In the latest run it is `tests/motion002.test.ts:527` (`3b visual_rule_sweep`, ≈ 812 s for the file on the runner). The E2E job is therefore **skipped** on CI for the whole epic.
- **Not reported.** The Gold notes do not mention CI at all, and `18c0f74` is not pushed.
- **Fix.** Escalate to the user: the test is frozen (motion-002), so a timeout or performance change in it needs the normal process. Make CI green, push, and confirm the Web and E2E jobs pass. At least state the status in the Gold notes and the epic-gate report.

### minor 1: `docs/demo.md` claims the Diagnostics panel shows "0 frames/s" while paused, but the panel has no such row
- `DiagnosticsPanel.tsx` shows sim tick, encode, render interval, draw CPU, vehicles, **frame size** (38,610 B, still shown while paused) and speed. It shows no frame rate and no bytes per second (`06-paused-diagnostics.png`).
- So smoke step 3 ("the Diagnostics panel shows no frame traffic while paused") cannot be checked by a user.
- **Fix.** Reword the demo text, for example "the worker stops sending frames; the Diagnostics numbers stop changing". A frames/s row would be a product change and needs a test.

### minor 2: orphaned product exports
- `extrapolate()` and `ExtrapolationClock` in `web/src/render/motion.ts` (lines 83–130) are no longer used by any product code. Only the superseded, `test.skip` tests S5–S7 import them.
- S6 itself says "The class is replaced by the presentation clock".
- `App.tsx:758`'s comment "extrapolates only while running" is stale.
- **Fix.** Remove the dead code, and the frozen file's now-unused imports under the existing S5–S7 authorization (record it in `supersessions.md`). Or list it as a known leftover.

### minor 3: "after" is `23da733`, not the Gold commit
- The spec says "After is this ward's Gold commit". The JSON and `performance.md` use `23da733`.
- The product code is identical (Gold changed docs and data only), so this is a wording deviation. State it in the Gold notes.

### minor 4: render-interval rows mix loads
- SwiftShader before-1 started at load 10.6; all the after runs started at 34–43.
- The doc says this and claims nothing from it, which is correct.
- `renderIntervalP95Ms baseline-20x` is in the JSON but not in the table. That is acceptable, but list it for completeness.

## What passed (for the next round)
- The tests are unchanged since the Red approval.
- All six flows pass at both speeds, twice.
- The smoke test passes on the hardware GPU, with a recording.
- Determinism-relevant code is untouched.
- Paused frames are 0 per second on both renderers.
- Native and worker tick cost are unchanged (I checked the raw `frame-cost-baseline.json` and the harness JSONs against the committed JSON).
- Hardware and SwiftShader are kept apart.
- The verification doc's 12 cases and 14 PNGs exist.
- The known issues and the supersession log are complete.
