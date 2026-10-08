# city-005 Red review, round 4

**Verdict: REJECTED (escalation: contract defect)** (0 BLOCKER, 1 MAJOR, 3 MINOR)

Reviewed at commit 4818305: `crates/sim-core/tests/city_005_scale.rs` (1), `web/tests/diagnostics.test.ts` (2–5, weightedPercentile, parseDemandScale), `web/tests/metrics_strip.test.ts` (17), `web/e2e/city.e2e.spec.ts` (6–11, 15, 16), `web/e2e/perf.spec.ts` (12–14), `web/playwright.config.ts` and `web/package.json`. I checked them against `.wdd/wards/city/ward-005.md`, `.wdd/epics/city.md` § C5, `livingcity.md` and CLAUDE.md. Round 4 runs under the convergence rule in CONTEXT.md.

**The test files are approvable as they stand.** The only MAJOR finding is in the **ward contract text** that the r3 fix added: the new `timerResolutionMs` measurement rule, implemented literally, never terminates under the fake clocks of the frozen Vitest suites. The fix is one sentence in the spec, and no test file changes. The convergence rule escalates contract defects, so I return REJECTED and do not auto-approve. If the human accepts the one-line spec amendment below, nothing else stands in the way of approval.

## What I ran
- `tsc --noEmit -p web`. For the city-005 files, the only errors come from the missing ward API (`perf.ts`, `WARMUP_SIM_S`, `parseDemandScale`, `ReadyMessage.tick`, `init.warmupS/demandScale`, the new `PerfStats` fields, and the hook's `diagnostics` / `demandScale` / `frameVehicle` / `start|stopPerfRecording`) and the implicit-any errors that follow from them. The new CDP line in `perf.spec.ts:91` type-checks.
- Scratch probes in the session scratchpad `r005d/`:
  - **`cdp.cjs`** uses Playwright 1.63 / Chromium 153 with the config's `devices['Desktop Chrome']` spread, viewport and SwiftShader args, and calls `page.context().newCDPSession(page).send('Browser.getVersion')` exactly as `perf.spec.ts:91` does:

    | Launch | Detected | CDP `userAgent` | Page UA |
    |---|---|---|---|
    | headless | **true** | `… HeadlessChrome/153.0.8010.12 …` | `… Windows NT 10.0 … Chrome/153…` |
    | headed | **false** | `… Chrome/153.0.0.0 …` | the same override |

  - **`res.cjs`** runs the r3 spec's new resolution rule in a dedicated Chrome worker for 200 trials: read `performance.now()` until 3 positive differences are seen, bounded by 50 ms. The result was **0.1 ms in 200 of 200 trials**. The r3 rule with ≤ 1,000 reads gave 0 in 140 of 200.
  - **`hang.cjs`** runs the same rule, read literally, with the clocks that frozen and new Vitest hosts pass to `createSimHost`. See **C1**.

## r1 / r2 / r3 findings: status
| Finding | Status | Evidence |
|---|---|---|
| r1 B1, M1, M2, M4, minors 1–10 | Resolved (confirmed in r2/r3, unchanged since) | Re-read `diagnostics.test.ts:172-322` and `city.e2e.spec.ts:56-331`. Nothing regressed. |
| r1 M3 / r2 m1 / **r3 A1** sub-resolution ticks | **Resolved** | The harness flag is `timerResolutionMs ≤ 0 \|\| p95 < 10 × res` (`perf.spec.ts:66-67`), and `check()` mirrors it (`:140`). An unknown resolution therefore forces "cite the mean". The measurement itself now gives 0.1 ms in 200/200 worker trials (`res.cjs`), so the flag is meaningful as well as safe. |
| r2 A1 target on on-network | Resolved (unchanged) | `perf.spec.ts:97-101, 142-145`. |
| r2 m2–m5 | Resolved (unchanged) | `city.e2e.spec.ts:129-135`; `perf.spec.ts:129-135`; ward § Calibration. |
| r2 m6 / **r3 A2** `conditions.headless` | **Resolved** | It now comes from the CDP `Browser.getVersion` user agent (`perf.spec.ts:91`). `cdp.cjs` shows true when headless and false when headed under the exact config, and `check()` asserts it is a boolean (`:141`). |
| r3 m1 tautological `achievedTicksPerS` check | Resolved | Removed. |
| r3 m2 stale comment in test 10 | Resolved | `city.e2e.spec.ts:249` now cites 6.7 / 10.1 sim min. |

## MAJOR
### C1. Contract defect: the r3 `timerResolutionMs` rule never terminates under fake clocks, so a literal implementation hangs frozen and new Vitest suites (`.wdd/wards/city/ward-005.md:129`, with `:115`)
- The spec says:
  - "Reads continue until at least 3 positive differences are seen, bounded by 50 ms of `now()` … measured when the host is created."
  - `HostDeps.perfNow` defaults to `now` (`ward-005.md:115`).
- Every Vitest host passes a fake `now` that does not advance while `createSimHost` runs:
  - `diagnostics.test.ts:146`, `now: () => t`;
  - test 4's host b, `perfNow: () => 0` (`:179`);
  - frozen `web/tests/river.test.ts:88, 110`, `now: () => 0`;
  - frozen `host.test.ts:30`, `sim.test.ts:57`, `river.test.ts:57`, and the other `createSimHost` suites, `now: () => t`.
- With such a clock, neither "3 positive differences" nor "50 ms of `now()`" is ever reached.
- **Verified** (`hang.cjs`): the literal loop, capped artificially at 5,000,000 reads, is still running at the cap for `perfNow = () => 0` and for `perfNow` = the fake `now`. Only test 4's host a (`k++ * 1000`) ends, after 3 reads.
- Consequence: the pinned contract conflicts with the frozen suites, which the ward's § Must DO says must stay green **unchanged**. The implementer has to add an unspecified second bound, and the Gold reviewer then sees a deviation from the contract. No test checks the measurement procedure, so no test file needs to change.
- **Exact fix (spec only, `ward-005.md:129`).** Replace the sentence with:

  > `timerResolutionMs`: the smallest positive difference between consecutive `perfNow()` readings, measured when the host is created. Reads continue until at least 3 positive differences are seen, bounded by 50 ms of `perfNow()` time **or 100,000 reads, whichever comes first** (0 if none is positive within the bound; a constant fake clock therefore gives 0 after 100,000 reads).

  100,000 reads take about 2–5 ms in real Chrome or node. With the fake clocks this costs a few ms per host creation, and only for hosts that are actually created. Test 4's "every `PerfStats` value is finite" accepts the 0.

## MINOR
1. **The render and draw rows are only checked for format and plausibility, not tied to the hook** (`city.e2e.spec.ts:118, 123-125`).
   - `render[0] > 1` catches a swap with the tick row. A panel that showed `drawMedianMs` in `diag-render` (with SwiftShader, draw CPU is typically several ms) or a frozen render p95 would still pass.
   - Render stats keep moving while the sim is paused, because rAF continues. An exact comparison is therefore not possible.
   - Optional loose tie, added after `:135`:
     ```ts
     const rr = (await pair('diag-render'))!;
     const d2 = await page.evaluate(() => window.__livingcity!.diagnostics());
     expect(Math.abs(rr[0]! - d2.render.intervalMedianMs)).toBeLessThanOrEqual(Math.max(2, 0.25 * d2.render.intervalMedianMs));
     ```
2. **`tickMsMaxFrame ≥ tickMsMean` is mathematically always true** (`perf.spec.ts:138`). A weighted mean is ≤ the max of its terms. It is harmless as a self-consistency check, and I note it only for completeness.
3. **The CDP session is not detached** (`perf.spec.ts:91`). One session is opened per `record()` call (4 per run) and dropped. This is harmless. `await s.detach()` would be tidier.

## Checked and OK
- **Tests 2/3 and `weightedPercentile`.** I re-verified the arithmetic by hand: rank = ceil(p·W), the truncation keeps exactly 1,000 ticks, the oversize batch is cut to 1,000, invalid samples are ignored, and 0 ms is a valid measurement.
- **Test 4.**
  - The `k++ * 1000` perf clock collapses the schedule if it leaks, and comparing `f.clock` frame by frame also catches a leak into frame pacing.
  - Host b's resolution will be 0, which is finite, so the finite check holds.
  - Under the amended C1 rule, host a's resolution measurement uses 4 reads. This shifts `k` but changes nothing the test compares.
- **Test 5.**
  - The bounds use the elapsed fake time, which includes the tick cost.
  - `backlogTicks ≤ 2` and the per-frame `achievedTicksPerS ≤ 46` checks are intact.
  - `ticksMeasured ≤` the ticks since ready, and Σ `frameTicks` = the ticks run.
  - `init` does not step, every `send` takes ≤ 100 ms, and the close lands after tick 1800.
  - The restart, `demandScale` → `createSim` and default cases are intact.
- **Tests 6–11, 15, 16, 17 and Rust test 1.** Unchanged since r2/r3 apart from the test 10 comment. Their premises were probe-verified in r1/r2: warm-up cost, the ×3 vs ×1 on-network margin, closure calibration with ≥ 4.9 min of margin, follow candidates, and `page.route` delaying the worker's wasm fetch.
- **Perf harness honesty.**
  - All statistics come from one whole-measurement recording.
  - Frames with 0 ticks are excluded, because `weightedPercentile` ignores weight 0 and `perFrame` filters `n > 0`.
  - The on-network target, the stress target (`measuredMax === onNetworkMax`, `met` derived) and the smooth-rendering target are derived and re-checked.
  - The headless and resolution flags now record the run truthfully (probes above).
- **Infra.** `grepInvert` for @perf and the `e2e:perf` script are unchanged. Frozen `review1.spec.ts` "fix G4" is only `test.skip`, and test 15 keeps its clip, steps and threshold.
