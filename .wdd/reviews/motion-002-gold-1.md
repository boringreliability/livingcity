# motion-002 Gold review r1

**Verdict: REJECTED**

Reviewer: fresh adversarial Gold subagent. I worked only from the artifacts: the ward spec, the epic, the supersessions, the Red verdicts r1–r5, the diff `6f223ad..HEAD` and the commands below.
Date: 2026-10-13. HEAD: `c890b48`, branch `public-main`.

## Frozen tests: hashes and drift
- `web/tests/motion002.test.ts`: sha256 `bd9de6d61ae82aafafb8a0e83ac6b9024a8eda83983d5f3a396a88c2667b4246`. This matches Red r4 and r5.
- `web/e2e/motion002.spec.ts`: sha256 `9859df9eae47bb50b11bc4b91e37317454f5d707a7f4cc15ca2d053e082d5d09`. This matches Red r5.
- `git diff 6f223ad..HEAD --stat -- web/tests web/e2e crates/*/tests` changes only `web/e2e/motion002.spec.ts`. That is the Red r5 amendment of test 9: commits 93a7297 and 8fe0bbf.
- `git diff 8fe0bbf..HEAD -- web/tests web/e2e` is empty, so no test file changed after Red r5 approval.
- Supersessions S4–S8 are logged in `.wdd/memory/supersessions.md` and marked `test.skip` (motion.test 3–6, motion.spec 7). The vitest run has 7 skips: S1–S3 from motion-001 and S4–S7.

## Commands run
| Command | Result |
|---|---|
| `pnpm -C web build:wasm` | ok |
| `pnpm -C web typecheck` | **FAILED (exit 2):** `e2e/motion002.spec.ts(71,71): error TS2532: Object is possibly 'undefined'.` |
| `pnpm -C web test` | 29 files, 144 passed, 7 skipped, exit 0 (313 s) |
| `cargo test --workspace` | 170 passed, 0 failed, 9 ignored (the calibration tests, debug build), exit 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean, exit 0 |
| e2e, port 5194: motion002, motion, gold_city003, inspect, compare, gold_polish002, integration_polish | 39 passed, 1 skipped (motion.spec 7, S8), **2 failed**, 9.5 min at load 12–23. See below. |
| Rerun of the two failures, `--repeat-each=2`, load 13–18 | 4/4 passed |
| Scratch probe (vitest, `Presenter` directly) | 600 new-tick frames pushed without `advance`: 601 frames retained, about 66 MB for 2,000 cars. After one `advance`: 2 frames, and P catches up at once. |
| Smoke script (Playwright, port 5221, SwiftShader, 1280×800) | Steps 1–3 in run 1, steps 4–6 in run 2. Results below. |

The two e2e failures in the first run:
- `integration_polish.spec.ts:70 controls_respond_under_load`: `compareOn` took 303.3 ms against a bound of 300 ms. This is timing under load and it passed on rerun. It is not a finding.
- `motion.spec.ts:155 tracked_car_moves_continuously` (kept frozen test 8): `265@589.9→265@595.3 lane 0.138→0.593: moved 10.42 m, along 9.47 m` (excess 0.053 m). It passed twice on rerun. See m1.

## Findings

### B1: BLOCKER. `pnpm -C web typecheck` and `pnpm -C web build` fail at HEAD
- **Where:** line 71 of the frozen `web/e2e/motion002.spec.ts`, `for (...) m[k] += d[i + k]! / ...`. With `noUncheckedIndexedAccess`, `m[k]` is `number | undefined`.
- **Origin:** the line came in with the Red r5 "fixes" commit `8fe0bbf`. It was not in 93a7297.
- **Impact:** `build` runs `tsc --noEmit && vite build`, so the production build documented in CLAUDE.md and the README fails. Gold cannot be approved with a red typecheck.
- **Fix:** the change is typing only and leaves the test's expectations unchanged, e.g. `m[k] = m[k]! + d[i + k]! / (d.length / 4)`. The file is frozen, though, so the change needs a Red amendment with a new hash. Gold must not edit it silently.

### M1: MAJOR. The presenter keeps frames without limit while animation frames do not run
- **Mechanism:**
  - `Presenter.push` adds every new-tick frame to `frames`.
  - Frames are dropped only in `Presenter.advance`, which runs only from the rAF loop through `CityRenderer.advance`.
  - `CityRenderer.advance` also skips `p.advance` when `frameCount === 0`.
  - `App` handles worker frames in `onmessage` and returns the buffer at once, so the worker keeps posting while rAF is suspended (hidden tab, minimised window).
  - Each retained frame is a full copy: link, s, lane, queued and trip arrays, plus a `Map` of trip to record.
- **Evidence, browser:** at 20×, River City, about 1,700 cars, I withheld rAF for 20 s (monkeypatched `requestAnimationFrame`, simulating a hidden tab). `usedJSHeapSize` went from 14.7 MB to 70.4 MB, about 2.8 MB/s. It fell back to 16.9 MB after rAF resumed and GC ran (`results-4.json`, `memory-raf-withheld-20s-20x`). Five minutes in a background tab at 20× would be about 0.8 GB, and more at `?demand=5`.
- **Evidence, node:** 601 frames retained for 2,000 cars came to about 66 MB.
- **Why it matters:**
  - Epic M1 requires that "Frames in flight are bounded, so a stalled UI does not queue frames without limit." This ward reintroduces an unbounded queue on the UI side.
  - The brief requires explicit memory budgets.
  - The picture gains nothing from the retained frames: after a long gap the first `clock.at` steps P almost to the newest frame (Δwall is large), so all but the last frame or two are discarded unused.
- **Fix (suggestion):** bound the history in `push`. Drop frames older than the clock's ceiling minus a few D, or cap the count (e.g. 8). Alternatively, call `advance(now)` from `push`. In either case `CityRenderer.advance` should not skip `p.advance` when the count is 0. Add a regression test in a new file.

### m1: MINOR. Kept frozen motion.spec test 8 is not reliably green under load
- **Failure:** once in 3 runs, at load ~20. The excess was 0.053 m, during a transition with lane blending (fractional lane 0.14 → 0.59).
- **Mechanism:**
  - The test measures the drawn path from `drawAt(link, s, lane, next)` at the newest presented lane.
  - The blended transition path moves sideways and reshapes the curve as the lane changes (P3 moves with the lane), so a single long rAF step at 5× can cover more than the fixed-lane path length plus 0.9 m.
  - That lane blending was required by Red r4 F1.
- **Severity:** it passed on both reruns and needs long rAF steps, so I rate it MINOR. Still, the ward lists test 8 as "must stay green". Gold should check that the blended path's per-step chord stays within the test's 0.9 m slack at realistic step sizes (5×, 100–150 ms rAF), or record it as a known flake with its mechanism.

### m2: MINOR. Shape and flags come from the newest frame, the pose from the lagged presentation
The GPU takes `a_flags` (queued, stranded) from the newest frame's AoS buffer, but `a_pose` from the presenter. A car can therefore be drawn short and square (queued) up to D ≤ 4·DT sim seconds before its drawn position stops. The effect is cosmetic and small, and it is not documented.

### m3: MINOR. Dead code
`Presenter.newestTick()` is unused in `src` and in the tests. `no_orphaned_exports` does not check methods. Remove it or use it.

### m4: MINOR. Latency is not in the perf JSON
`docs/performance.md` cites the latencies (281 ms at 1×, 37 ms at 20×) from the motion002.spec test 8 log, but `web/perf-results/motion002-before-after.json` holds only the render, draw and byte numbers. Everything else in the docs table matches the JSON exactly:
- render interval 66.6/116.6 → 50.0/99.9, 50.1/100.1 → 50.0/83.3, 116.7/200 → 116.7/200;
- draw CPU 0 → 0.3/0.4 and 0.7/0.8;
- frame bytes 32,220 → 39,446 = 18 → 22 B per vehicle.

The node figure of 0.95 ms for 6,887 cars has no artifact.

## Checks that passed (no finding)
- **Sim unchanged:**
  - The only crate change is `Sim::trip_ids()`, a read-only copy of `frame_trips.back()`.
  - The 16-byte record is unchanged.
  - `cargo test`, including the golden-hash and determinism tests, is green.
  - There is no sim logic in the UI.
- **No extrapolation:** P is clamped to the minimum newest frame time over all sides (`ceil`). `ExtrapolationClock`, `extrapolate` and `vehicleDrawPosition` remain only for the frozen motion.test and `pickVehicle`/inspect.test.
- **Epochs:** the host increments them on init (both sides), seek and compare (both sides through `afterPairJump`), compare off (both), and seek, branch or view switch (`afterJump`, the viewed side). Test 1 covers branch and discard and is green.
- **Shared clock:** A and B are `Presenter`s on one `PresentationClock`. B calls `release()` on every non-compare frame, so B does not hold the clock outside compare. Smoke step 6: `tickMismatch: 0` over 46 frames while comparing at 20×. After compare off, `tickB` is null and A keeps advancing (79 ticks in 2 s).
- **One rule everywhere:** picking (`pickPresentedVehicle` over `p.vehicles()`), Follow and the ring (`trackedWorldPosition` → `presenter.vehicle(tripId)`), and the hooks `vehicleScreenCenter`, `vehicleDraw`, `trackedDraw`, `drawAt` and `trackedScreenCenter` all read the presented state. `frameVehicle` gained `lane` and `next`, `linkInfo` is new, and `diagnostics().presentation` is present.
- **Docs:** `architecture.md` and `known-issues.md` were updated (i1, i2 and i4 marked resolved).

## Manual Smoke Test (performed by the reviewer)
Results are in `scratchpad/smoke/results-run1.json` and `results-4.json`. The script is `scratchpad/smoke/smoke.spec.mjs`, under `/private/tmp/claude-502/-Users-Z6DEC-kmddev-livingcity/e54ac286-31c4-4bad-9122-a1c59df1c97d/scratchpad/smoke/`.

| Step | Result |
|---|---|
| 1. 1×, junction (zoom ≥ 5) | **Pass.** Over the whole city (1,758 cars) no held car is drawn past its stop line or on a curve (`heldInside: 0`), and there are 0 overlapping held cars on different links and 0 overlaps involving a curve. Same-lane neighbours sit ≥ 3.75 m apart, which is the queue spacing; queued cars are drawn 3.6 m long, so they do not overlap. A tracked car through a junction for 8 s: no back step, no zero-motion run, and no stall-then-jump (`maxZeroRun 0`, `jumpAfterStall 0`, median step 0.74 m, max 2.73 m). Screenshots: `s1-junction-1x-a.png`, `s1-junction-1x-b.png`. |
| 2. 20×, Follow for 30 s | **Pass.** 592 samples across 6 links: 0 back steps, 0 returns to an earlier link, ring offset 0 px, and Follow centre offset 0 px. Screenshot: `s2-follow-20x.png`. |
| 3. Speed 20× → 5× → 60× | **Pass.** 0 back steps for P and for the tracked car. One sample went over my 1.5 × 60× × Δt bound, but I measured Δt at rAF callback time while the app uses the rAF timestamp, so this is a sampling artefact. The vitest test 4 bound is green. |
| 4. Close and reopen the main bridge | **Pass.** No presented car enters a closed link (`viol 0` over 344k car-frame checks). 14 samples showed a car still on the bridge in the presented state while the newest frame had it just off it; that is a car leaving, which is allowed. No held car past a stop line. No overlaps at queue fronts. On reopen, P was monotone. Screenshots: `s4-bridge-closed-20x.png`, `s4-bridge-reopened.png`. |
| 5. Pause and resume | **Pass.** 0 back steps; while paused the lag is 0 (the glide is covered by vitest 4b). |
| 6. Seek back, branch, compare | **Pass.** Right after the seek the presentation sits on the new frame: `tickA 3569 = tick`, `lagS 0`, so nothing slides from a stale position. While comparing, A and B are at the same tick in every frame. Screenshots: `s6-compare-20x.png`, `s6-after-compare-off.png`. |

Pass criteria:
- Coherent motion at 1× and 20×: yes.
- No held car inside a junction and no overlap at queue fronts: yes.
- Latency measured and stated: yes. In compare at 20× I saw 16–43 ms.

The smoke test itself passes. The rejection rests on B1 (build broken) and M1 (unbounded memory while rAF is suspended).

## Required to pass
1. B1: a typing-only Red amendment of `motion002.spec.ts` line 71 with a new hash, after which `pnpm -C web typecheck` and `build` are green.
2. M1: bound the presenter's history independently of rAF, with a regression test in a new file.
3. m1: show that the kept motion.spec test 8 is stable under load, or explain and record it.
