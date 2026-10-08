# city-005 Red review, round 3

**Verdict: REJECTED** (0 BLOCKER, 2 MAJOR, 2 MINOR)

Reviewed at commit 54e3ee8: `crates/sim-core/tests/city_005_scale.rs` (1), `web/tests/diagnostics.test.ts` (2–5, weightedPercentile, parseDemandScale), `web/tests/metrics_strip.test.ts` (17), `web/e2e/city.e2e.spec.ts` (6–11, 15, 16), `web/e2e/perf.spec.ts` (12–14), `web/playwright.config.ts`, `web/package.json`. I checked them against `.wdd/wards/city/ward-005.md`, `.wdd/epics/city.md` § C5, `livingcity.md` and CLAUDE.md.

Both MAJOR findings are in the perf harness's honesty mechanism. Each one makes the frozen harness write a false or unguarded statement into the JSON that `docs/performance.md` must cite, and an implementer cannot fix either without editing the test file after Red approval. Each fix is one or two lines.

## What I ran
- `tsc --noEmit -p web`. For the city-005 files, the only errors come from the missing ward API: `perf.ts`, `WARMUP_SIM_S`, `parseDemandScale`, `ReadyMessage.tick`, `init.warmupS/demandScale`, the new `PerfStats` fields, and the hook's `diagnostics` / `demandScale` / `frameVehicle` / `start|stopPerfRecording`. There are also implicit-any errors that follow from these.
- Scratch probes in the session scratchpad `r005c/`:
  - **`res.mjs`** runs Playwright Chromium 153 with the config's SwiftShader args. In a dedicated worker it measures the timer resolution exactly as the spec defines it: the smallest positive difference between consecutive `performance.now()` readings, over ≤ 1,000 reads. I ran 200 trials:

    | Result | Trials |
    |---|---|
    | 0 (no positive difference) | **140** |
    | 0.1 ms | most of the rest |
    | 1.3 ms (one preempted trial) | 1 |

  - **`ua.mjs`** creates a context with `devices['Desktop Chrome']` (as the config does) and reads `navigator.userAgent`. It gets `Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/153… Safari/537.36`, and `/Headless/` is **false**. The same probe without the device override shows `HeadlessChrome/153…`.

## r1 / r2 findings: status
| Finding | Status | Evidence |
|---|---|---|
| r1 B1, M1, M2, M4, minors 1–9 | Resolved (confirmed in r2, unchanged since) | Re-read `diagnostics.test.ts:217-287` and `city.e2e.spec.ts:230-331`. Nothing regressed. |
| r1 M3 / r2 m1 sub-resolution ticks | **Not effectively resolved** | The threshold is now `p95 < 10 × resolution` (`perf.spec.ts:65, 137`), but the resolution itself is 0 in about 70 % of runs. See **A1**. |
| r2 A1 target scored on `active` | **Resolved** | `onNetworkVehicles` is scored on `onNetworkMax` (`:94-99, 141`). `activeMax` and `waitingAtOriginMax` are recorded. The old key must be absent (`:140`), and `activeMax ≥ onNetworkMax` is asserted (`:138`). With ×5 tops near 6,900 on the network, the JSON will honestly say "missed". |
| r2 m2 3-decimal float compare | **Resolved** | String compare via `toFixed(3)` on both sides (`city.e2e.spec.ts:132-133`). The spec pins `toFixed(3)` for the display, so parse → `toFixed(3)` round-trips exactly. |
| r2 m3 bytes/vehicles format | **Resolved** | Pinned in the spec (`"N B"`, plain integers). The tests use `toHaveText(\`${frameBytes} B\`)` and an anchored regex. |
| r2 m4 coverage floors as perf floors | **Resolved** | Sanity floors only: ≥ 1 render sample/s, > 0 frames and ticks (`:127-130`). |
| r2 m5 calibration numbers | **Resolved** in the spec. A stale code comment remains (m2). | |
| r2 m6 headless reports config | **Not resolved, now always wrong** | See **A2**. |

## MAJOR
### A1. `tickBelowTimerResolution` is silently false whenever the measured resolution is 0, which happens in about 70 % of runs (`web/e2e/perf.spec.ts:65, 137`; ward § Red-phase contract `timerResolutionMs`)
- The spec defines `timerResolutionMs` as the smallest positive difference over ≤ 1,000 consecutive `perfNow()` reads, and 0 if none is positive.
- In a Chrome worker that is not cross-origin isolated, `performance.now()` is coarsened to 100 µs, and 1,000 reads take less than that. `res.mjs` gets **0 in 140 of 200 trials**.
- With `timerResolutionMs = 0`, the flag is `tickMsP95 < 0`, which is false. `check()` accepts that (`:137`), and nothing requires a positive resolution.
- The result is the exact case r1 M3 was raised for. At 1× and 20× (about 1 tick per batch, 0.03 ms of real cost), the recorded per-frame ms is 0 or 0.1, so `tickMsMedian` will be 0 and `tickMsP95` 0.1. The JSON says these are *not* below the timer resolution, and `docs/performance.md` may print "0.000 ms median" as a measured tick time.
- **Fix (pick one):**
  - **Spec + test:** measure the resolution by reading until the value changes, bounded by time (e.g. ≤ 20 ms of reads) instead of 1,000 reads. In `check()`, assert `timerResolutionMs > 0`.
  - **Harness only:** define the flag robustly, e.g. `tickBelowTimerResolution = r.timerResolutionMs <= 0 || p95 < 10 × r.timerResolutionMs`, and mirror it in `check()`. A resolution that could not be measured then forces citing the mean.

### A2. `conditions.headless` is always `false`, because the config overrides the user agent (`web/e2e/perf.spec.ts:88`; `playwright.config.ts:16`)
- `use` spreads `devices['Desktop Chrome']`, which sets `userAgent` to a Windows desktop Chrome string without "Headless".
- `navigator.userAgent` in the page is that override, so `/Headless/.test(…)` is false on every run, including the default headless run (`ua.mjs`).
- Every perf JSON will therefore state `headless: false` for a headless SwiftShader run. That is a false run condition, and the report, which must cite the JSON, would describe the render numbers as headed-browser numbers. The ward's § Must NOT forbids fabricated values, and the r2 fix was meant to record the run, not a guess.
- **Fix:**
  - Use `test.info().project.use.headless ?? true`, which reflects the CLI's `--headed` because Playwright resolves it into the project `use`.
  - Or read the UA without the override: `browser.newBrowserCDPSession()` → `Browser.getVersion().userAgent`. Or use `(await browser.newContext({ userAgent: undefined }))`, though the device spread makes that awkward.
  - Simplest: `headless: test.info().project.use.headless !== false`.

## MINOR
1. **`achievedTicksPerS` closeness check is tautological** (`perf.spec.ts:131`). The harness computes `achievedTicksPerS` as exactly `ticks / (wallMs/1000)` (`:70`), so the check can never fail. Harmless. Drop it, or compare against the hook's `diagnostics().achievedTicksPerS` with a loose tolerance.
2. **Stale comment in test 10** (`city.e2e.spec.ts:249`). It says "at most 5.5 and 9.7 sim min". § Calibration now states 6.7 and 10.1 for the e2e's sampling. Update the comment.

## Checked and OK
- **Tests 2/3 and `weightedPercentile` arithmetic.** Unchanged since r2, and I re-verified it by hand (rank = ceil(p·W); truncation keeps exactly 1,000 ticks).
- **Test 4.** The `k++ * 1000` perf clock still collapses the schedule if it leaks. Comparing `f.clock` frame by frame catches the leak in the frame pacing too. `timerResolutionMs` (from the ≤ 1,000 reads at creation) is covered by the "every `PerfStats` value is finite" check.
- **Test 5.** The bounds, the `backlogTicks ≤ 2` check, the per-frame achieved-rate check, `ticksMeasured ≤` ticks since ready, and Σ `frameTicks` = ticks run are all intact.
- **Test 7.** Exact string matches for the diagnostics rows, against the pinned formats. Paused stats are stable.
- **Tests 6, 8, 9, 10, 11, 15, 16, 17 and Rust test 1.** Unchanged since r2. Their premises were already probe-verified in r1/r2: warm-up cost, ×3 vs ×1 on-network margin, closure calibration, follow candidates, and `page.route` delaying the worker's wasm fetch.
- **Perf targets.**
  - The on-network scoring, the stress target (`measuredMax === onNetworkMax`, `met` derived) and the smooth-rendering target are consistent.
  - `activeMax ≥ onNetworkMax` holds per frame and therefore holds for the maxima.
  - `tickMsMaxFrame ≥ tickMsMean` holds mathematically, because a weighted mean is ≤ the max.
- **Infra.** `grepInvert` for @perf and the `e2e:perf` script are unchanged. Frozen `review1.spec.ts` "fix G4" is only `test.skip`.
