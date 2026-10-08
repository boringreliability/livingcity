# city-005 Red review, round 2

**Verdict: REJECTED** (0 BLOCKER, 1 MAJOR, 6 MINOR)

Reviewed at commit 50398f2: `crates/sim-core/tests/city_005_scale.rs` (1), `web/tests/diagnostics.test.ts` (2–5, weightedPercentile, parseDemandScale), `web/tests/metrics_strip.test.ts` (17), `web/e2e/city.e2e.spec.ts` (6–11, 15, 16), `web/e2e/perf.spec.ts` (12–14). I checked them against `.wdd/wards/city/ward-005.md`, `.wdd/epics/city.md` § C5, `livingcity.md` § Performance goals and CLAUDE.md. I also checked them against the current `web/src` (host, clock, worker, App hook, MetricsStrip, ControlPanel) and the shipped wasm.

## What I ran
- `tsc --noEmit -p web`. The only errors come from the missing ward API: `perf.ts`, `WARMUP_SIM_S`, `parseDemandScale`, `ReadyMessage.tick`, `init.warmupS/demandScale`, the new `PerfStats` fields, and the hook's `diagnostics` / `demandScale` / `frameVehicle` / `start|stopPerfRecording`. There are also implicit-any errors that follow from these.
- Scratch probes in the session scratchpad `r005b/`:
  - **`calib2.mjs`** (node + real wasm, seeds 2026/7) reproduces test 10 the way the e2e runs it.
    - **Setup:**
      - q0 is the median of 5 snapshots at `close − L − 120 + 30j`, with L ∈ {0, 20, 60, 120} ticks of click lag.
      - The doubling deadline is 15 min.
      - Spillback is sampled every 10 ticks, and I report the worst phase.
    - **Results:**

      | Closure ticks | Closures | Fails | Worst doubling | Worst spillback | Spillback p90 |
      |---|---|---|---|---|---|
      | [1840, 2040), every 2nd tick | 100 | 0 | 6.44 min | 10.09 min | 9.72 min |
      | [2040, 2400), every 6th tick | 60 | 0 | 6.67 min | 10.00 min | n/a |

    - The calibration holds with ≥ 4.9 min of margin.
  - **`follow.mjs`** probes test 10's follow step. Closure ticks 1840–2100 × 5 delays after closing give 65 cases. In every case the earliest car on the Old Bridge has ≥ 5 remaining route links, and it is still live 60 ticks (30 sim s) later. **r1 minor 9 is resolved.**
  - **`scaleprobe`** is a scratch crate on `sim-core` that scales the flows by hand, as `river_city_scaled` will.

    | Scale | on_network at tick 1800 | active at tick 1800 | Max on_network (1 h) | Warm-up (native) |
    |---|---|---|---|---|
    | ×1 | 1,750 | 1,757 | 1,838 | 62 ms |
    | ×3 | 4,599 | 9,875 | n/a | n/a |
    | ×5 | 5,536 | 19,763 | 6,874 | 175 ms |

    At ×5, `active` passes 25,000 at about tick 2,400 and 70,000 at 1 h. Almost all of it is `waiting_at_origin`.
    - Test 9 holds: 4,599 > 1.3 × 1,750.
    - Test 11 holds: > 2,000.
    - Test 14 holds: ≥ 5,000.
  - **`route.mjs`** (Playwright against a scratch Vite on port 5197) checks the premise of test 16. `page.route('**/*.wasm')` does intercept the **worker's** fetch of `/src/wasm/sim_wasm_bg.wasm`, and the first tick appears at 2.3 s. So test 16's premise is real.
  - Float check for test 7's tolerance (see m2).

## r1 findings: status
| r1 | Status | Evidence |
|---|---|---|
| B1 test 5 bound/tautologies | **Resolved** | `elapsedS` now includes the fake tick cost (the proxy advances `t`). Upper bound `ceil(elapsed·40)+2`, lower bound `0.8×`, `after[0].clock.backlogTicks ≤ 2`, and `achievedTicksPerS ≤ 46` checked on **every** frame after ready (`diagnostics.test.ts:275-282`). The r1 scenario (≈139 ticks in ≈3.48 s) is now inside the bounds. A host that does not resync, or that reports warm-up ticks to the clock, fails. |
| M1 test 10 calibration | **Resolved** | The deadline is 15 min and q0 is the median of 5 snapshots over 120 ticks (`city.e2e.spec.ts:236-263`). My probe confirms it (above). See m5 for a small doc inaccuracy. |
| M2 perf windows | **Resolved** | Spec: warm-up batches are excluded from `TickWindow` and from `frameTicks`. Test 5 asserts this (`:284-286`). The harness reduces one whole-measurement recording, and every scenario runs 60 s. Coverage fields: `ticksRecorded`, `framesRecorded`, `renderSamples`. |
| M3 sub-resolution ticks | **Mostly resolved** | `timerResolutionMs`, `tickMsMean` and `tickBelowTimerResolution` are recorded. A gap remains (m1). |
| M4 test 4 leak | **Resolved** | The perf clock is now `k++ * 1000`, which collapses the schedule if it leaks. Test 4 also compares `f.clock` frame by frame (`:196-203`). |
| minor 1 cold server | Resolved | `beforeAll` warm-up plus an in-page `performance.now() ≤ 5000` check (`:57-61, 82`). |
| minor 2 unserved value | Resolved | Test 17: unserved 7 vs unreachable 3, with markup-level pairing of label, title and value. |
| minor 3 scale reaches sim | Resolved | `createArgs[i][3]` (`:309-315`) and `stressed > 1.3 × plain` (`:209`). |
| minor 4 test 5 details | Resolved | `tick() === 0` after `init`, every `send` ≤ 100 ms, and the spec now says commands are handed to the sim after the last warm-up tick. |
| minor 5 warm-up UI | Resolved | Test 16. Its route premise is verified (above). |
| minor 6 panel ↔ hook | Resolved for tick, ticks-measured, vehicles, bytes and speed format | See m2. |
| minor 7 network equality | Resolved | `links()` / `nodes()` `==` (`city_005_scale.rs:28-29`). |
| minor 8 JSON conditions | Resolved | viewport, DPR, headless, launch args, the app's renderer, and targets with met/missed. See MAJOR A1 about *which* count the target uses. |
| minor 9 follow | Resolved | Candidates are sorted by `s` and the route must have ≥ 3 links. Probe: every case has ≥ 5 links and is still live after 30 sim s. |
| minor 10 | Gold note, carried in § Calibration | |

## MAJOR
### A1. The "10,000 active vehicles" target is scored on a count dominated by trips waiting at their origin, and `check()` enforces that misleading verdict (`web/e2e/perf.spec.ts:16, 90, 128`; ward `ward-005.md:166`)
- The sim's `active` includes `waiting_at_origin`. In the stress run (`?demand=5`, ready at tick 1800, then 20 s + 60 s at 5×, so roughly ticks 2,000–2,600), `active` is about 20,000–25,000. Only about 5,500–6,000 of those are on the network (`scaleprobe`). The rest sit in origin spawn queues and cost almost nothing to simulate.
- `targets.activeVehicles.met` will therefore be **true** in `stress-5x.json`. `docs/performance.md`, which must cite the JSON, would then say that the brief's "interactive operation at 10,000 active vehicles" target is met, while the simulated road load is about 6,000.
- That is a misleading performance claim, against the ward's § Must NOT and the brief's "targets to measure, not claims to fabricate".
- An implementer cannot fix it in the report either: `check()` asserts `met === (activeMax >= 10000)`.
- **Fix:**
  - In the spec and in `perf.spec.ts`, score the load target on vehicles actually simulated on roads: `onNetworkMax >= 10_000`, and name the field e.g. `vehiclesOnNetwork`.
  - Keep `activeMax` in the JSON, but add `waitingAtOriginMax` (or `activeIncludesWaitingAtOrigin: true`) so the breakdown is explicit.
  - Assert `met === (onNetworkMax >= 10_000)` in `check()`.
  - If no scale reaches 10,000 on the network (×5 tops out near 6,900 in 1 h), the JSON then honestly says "missed", with the measured maximum.

## MINOR
1. **`tickBelowTimerResolution` flags only a median strictly below one timer quantum** (`perf.spec.ts:61, 126`; ward `:165`).
   - Chrome coarsens the worker's `performance.now()` to about 100 µs here, because the app is not cross-origin isolated.
   - A median of exactly 1 quantum (0.1 ms) is therefore not flagged, and the report may print it as a tick time. The true cost is about 0.03 ms at ×1, and the quantization error at 1–2 quanta is ±50–100 %.
   - p95 is never flagged.
   - **Fix:** `tickResolutionLimited = tickMsP95 < 10 × timerResolutionMs` (or flag median and p95 separately with `≤ k × resolution`). When set, require the report to cite `tickMsMean`.
2. **Test 7's 3-decimal comparison can fail on a correct panel** (`city.e2e.spec.ts:132-133`). For example, `x = 0.3/8 = 0.0375` displays as `"0.037"`, and `|0.037 − 0.0375|` in floating point is `0.0005000000000000004`, which is > 0.0005.
   - Per-tick values of q/8 or q/40 ms (q = coarse-timer quanta) produce exact half-thousandths, so this is rare but possible.
   - **Fix:** compare strings, `tick[0].toFixed(3) === d.perf.tickMsMedian.toFixed(3)`, or use a tolerance of `0.0005 + 1e-9`.
3. **`diag-bytes` format is unspecified, but the test requires the raw integer** (`city.e2e.spec.ts:130`, ward `:155`). A readable "45.2 kB" would fail `toContainText(String(frameBytes))`. Likewise, `diag-vehicles` (`:129`) forbids thousands separators ("1,750").
   - **Fix:** pin both in § Red-phase contract (`diag-bytes` "N B" as an integer; `diag-vehicles` integers with no grouping), or relax the assertions to parse numbers out of the text.
4. **The perf coverage checks double as performance floors** (`perf.spec.ts:119-120`).
   - `renderSamples ≥ 20·durationS` fails the harness when SwiftShader renders below 20 fps.
   - `ticksRecorded ≥ 0.5·target·durationS` fails it when the engine cannot keep up.
   - In both cases an honest "missed" measurement becomes a red test, not a recorded result. The JSON is written before `check()`, but the suite goes red.
   - **Fix:** check coverage against the recording itself, for example `framesRecorded ≥ 0.9 × wallMs / max(renderIntervals)` or an explicit rAF counter from the hook. Or lower the floors to sanity levels (≥ 1/s) and let `targets` carry the verdict.
5. **§ Calibration understates the measured times** (ward `:173-176`). With the e2e's actual sampling (every ~10 ticks, worst phase) and 0–60 ticks of click lag, I measure doubling ≤ 6.4–6.7 min and spillback ≤ 10.1 min, not 5.5 / 9.7. The 15-min deadline still leaves ≥ 4.9 min. **Fix:** update the numbers and state the method (lags, sampling phase).
6. **`conditions.headless` reports the config, not the run** (`perf.spec.ts:84`). `--headed` on the CLI would still record `true`. **Fix:** record `test.info().project.use.headless`, or note "config default".

## Checked and OK
- **Arithmetic of tests 2/3 and `weightedPercentile`, verified by hand.**
  - Rank = ceil(p·W).
  - `0.95·100 = 95` and `0.995·100 → 100` hold in floating point.
  - Invalid samples are ignored, so `[3,4]` gives 3.
  - SampleWindow(4) gives `1,2,3,4` → median 2, p95 4.
  - The truncated window keeps the 3 ms batch after `add(1,50)` and drops every older batch after `add(20,1000)`.
- **Test 5:**
  - `ready` is first, at tick 1800, and `init` does not step.
  - The close is not in `closed_links()` at ready and is applied at > 1800.
  - Σ `frameTicks` after ready equals the ticks run.
  - The restart and default cases are covered.
  - A host that reports warm-up ticks to `SimClock.report` (the achieved window) or does not resync `creditedUntil` fails `:281-282`.
- **Test 4:** a leak of `perfNow` into the clock or into frame pacing changes the frame count or `f.clock`, so it is caught. Every `PerfStats` value is checked to be finite.
- **Test 17:** markup pairing works with the existing `MetricsStrip` structure. "00:15:05" is correct for 905 s.
- **Test 1:** full network/zone/landmark equality, per-flow × scale, scale 1 ≡ `river_city` by hash, ×3 > 2× trips (probe: 4,650 vs 1,344 active at 5 min), invalid set including NaN/±∞/6+1e-9, and `MIN_POSITIVE` and 6 accepted.
- **Test 9:** `'3x'` is rejected, so a `parseFloat` implementation fails. ×3 vs ×1 on-network has a wide margin.
- **Test 15 vs frozen G4:** the frozen test is only `test.skip`, and test 15 keeps its clip, steps and threshold.
- **Infra:** `grepInvert` for @perf and the `e2e:perf` script.
