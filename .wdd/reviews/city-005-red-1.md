# city-005 Red review, round 1

**Verdict: REJECTED** (1 BLOCKER, 4 MAJOR, 10 MINOR)

Reviewed: `crates/sim-core/tests/city_005_scale.rs` (1), `web/tests/diagnostics.test.ts` (2–5, parseDemandScale), `web/e2e/city.e2e.spec.ts` (6–11, 15), `web/e2e/perf.spec.ts` (12–14), and the infra changes at commit aa8fb55. I checked them against `.wdd/wards/city/ward-005.md`, `.wdd/epics/city.md` § C5, `livingcity.md` (Performance goals, Verification), CLAUDE.md, the current `web/src` (host, clock, App, MetricsStrip) and the shipped wasm.

## What I ran
- `git show HEAD -- web/e2e/review1.spec.ts`: the only change is `test` → `test.skip` plus a 2-line comment. The body is unchanged. `playwright.config.ts` and `package.json` contain only the `grepInvert` and `e2e:perf` additions.
- `cargo test -p sim-core --test city_005_scale`: the only errors are the missing `river_city_scaled` / `InvalidDemandScale` / `DEMAND_SCALE_MAX`, plus inference errors that follow from them.
- `tsc --noEmit -p web`: the only errors are the missing ward API (`perf.ts`, `WARMUP_SIM_S`, `parseDemandScale`, `ReadyMessage.tick`, `init.warmupS`, `PerfStats` fields, and the hook's `diagnostics` / `demandScale` / `frameVehicle`). No frozen test builds a `ReadyMessage` or `PerfStats` literal.
- `playwright test --list`: `@perf` is excluded by default, and `PERF=1 --grep @perf` lists the 3 harness tests. **`city.e2e.spec.ts` sorts before `city.spec.ts`, so test 6 is the first test of the whole e2e run.**
- Scratch scripts (node + the real wasm and the real `SimClock`) in the session scratchpad `r005/`:
  - `warm.mjs`: warm-up cost and state at tick 1,800 for 3 seed pairs;
  - `t5.ts`: the real `SimClock` under test 5's post-warm-up loop;
  - `t4.ts`: `SimClock` with test 4's perf clock leaked into `report()`;
  - `calib.mjs` / `sweep.mjs`: test 10's doubling and spillback criteria, with closure every 2 ticks in [1840, 2040) for the app seed and coarser grids for 5 seed pairs, plus reopen;
  - `onnet.mjs`: on-network count over the first hour and `unserved` with and without the closure;
  - `look8.mjs`, `city5.mjs`: frozen `look.spec` #8 and `city.spec` #5 premises after a 1,800-tick warm-up.

## BLOCKER
### B1. Test 5's post-warm-up tick bound fails a correct implementation, and its rate and backlog checks are tautological (`web/tests/diagnostics.test.ts:252-256`)
- **The bound is wrong.** Each fake tick costs 2 ms of `now` time, and that cost is part of the elapsed wall time the clock credits. After ready, 200 iterations take 200 × 16 + 2·N ms, so at 40 ticks/s N = 128 + 0.08·N ≈ 139.
  - `t5.ts` runs the real `SimClock` in the best case for the implementation: the clock is resynced exactly at ready, with zero backlog. It executes **139** ticks.
  - The test allows at most `ceil(200·16·40/1000) + 2 = 130`.
  - So a correct host fails.
- **Line 254 is tautological.** `achievedTicksPerS ≤ 46` is read on the last frame, 3.2 s after ready. The 1-s window has long since dropped any warm-up reports, so it passes even if every warm-up tick was reported: `t5.ts` without a resync gives a last value of 40, while the max over the frames is 83.
- **Line 255 is tautological.** `backlogTicks ≤ 40` equals the clock's own cap (`MAX_BACKLOG_S × 40`), so it can never fail.
- **Fix:**
  - Accumulate the elapsed fake time after ready: the sum of `x.iterate()` return values + 16 per iteration.
  - Assert `last.tick − 1800 ≤ ceil(elapsed·40/1000) + 2`.
  - Assert `max(after.map(f => f.clock.achievedTicksPerS)) ≤ 46` (all frames, not the last one).
  - Assert `after[0].clock.backlogTicks ≤ 2`, because no warm-up time may be owed.
  - Add a lower bound so the speed chosen during the warm-up is proven to be honoured: `last.tick − 1800 ≥ 0.9 × elapsed·40/1000`.

## MAJOR
### M1. Test 10 is flaky, and § Calibration does not support its 10-minute deadline (`web/e2e/city.e2e.spec.ts:221-242`, ward § Calibration)
`sweep.mjs` uses the app seed 2026/7 and closes at every second tick in [1840, 2040). The e2e closes about 40–200 ticks after ready.

| Criterion | Result |
|---|---|
| Spillback (approach ≥ 80 % while its feeder is ≥ 20 %) | First met **5.8–9.8 sim min** after the closure. **52 of 100 closure ticks need more than 9 min.** The deadline is 10 min, and the e2e samples only every ~10 ticks. |
| Doubling (`queued ≥ 2 × max(1, q0)`, with `q0` one snapshot) | Never reached within 10 min for **3–5 of 100** closure ticks, depending on the 0/10/40-tick lag between `before` and the click. `q0` can be a local spike: 120 at tick 1960, against a typical 40–80. |
| Other seeds (`calib.mjs`) | 5/9 never spills back within 10 min for closures at 1800–1900. 42/43 needs up to 9.8 min. |

- The ward's calibration lists doubling times (4.4 / 0.2 / 4.6 min, with `q0` taken exactly at tick 1800) and peak occupancies. It does not list *when* the spillback happens, which is right at the deadline.
- The reopen criterion is robust: at most 2.25 sim min against a 10-min limit, across 5 seeds × 6 closure ticks × 4 reopen delays.
- **Fix:**
  - Take `q0` as the median of ≥ 5 snapshots over ≥ 1 sim minute (≥ 120 ticks) before the click.
  - Raise both closure deadlines to 15 sim min, or calibrate the network so spillback appears clearly earlier.
  - Update § Calibration with the measured spillback times and the e2e-like closure window (ticks 1840–2040), not only closure at exactly tick 1800.

### M2. The perf harness mislabels what its numbers cover, and test 12 depends on an unspecified warm-up rule (`web/e2e/perf.spec.ts:45-78, 109, 122-144`; ward § Perf windows)
- **1× baseline.** It measures 5 + 20 s at 2 ticks/s, about 70 ticks after ready, but `check()` requires `ticksMeasured ≥ 100`.
  - That only passes if the warm-up batches are added to the `TickWindow`. The ward is silent on this: it says warm-up ticks stay out of the achieved-rate window and the backlog, but says nothing about the tick window.
  - In that case about 930 of the 1,000 window ticks in `baseline-1x.json` are warm-up timings (large batches, different load), and they get reported as "baseline at 1×".
- **Closure burst.** Median and p95 come from the window that is current at the end: the last 1,000 ticks, about 25 s at 20×. The JSON's `scenario` says "first 60 s after closing", but the first 35 s, which include the immediate rerouting, are not in the median/p95. `tickMsMax` is fine, because it is polled every 500 ms.
- **Render stats everywhere.** They cover only the last 300 frames (about 5 s at 60 fps), while `durationS` says 20 / 30 / 60 s.
- **Fix:**
  - Spec: warm-up batches are not added to the `TickWindow`. Add a vitest assertion in test 5: the first frame after ready has `perf.ticksMeasured ≤` the ticks executed since ready.
  - Harness: aggregate over the whole measurement. Either poll every ≤ 4 s and keep the series, or expose cumulative tick ms and tick counts in `diagnostics()`, and compute median/p95 over all samples.
  - Write `windowTicks` and `windowFrames` (or `coversS`) into the JSON.
  - Run the 1× baseline for ≥ 60 s so that ≥ 100 real ticks are measured.

### M3. The harness can report sub-resolution tick times as "0 ms" (`web/e2e/perf.spec.ts:63-66`)
- Measured in node, a River City tick costs **0.031 ms median and 0.045 ms p95** (`stress.mjs`).
- At 1× and 20× the worker runs batches of about 1 tick per 16 ms iteration.
- The app is not cross-origin isolated (no COOP/COEP in `vite.config.ts`), so the worker's `performance.now()` is coarsened to 100 µs.
- The tick median will read 0 and p95 0 or 0.1, and the report would present these as measurements. The host comment at `web/src/sim/host.ts:90-92` already admits this.
- **Fix:**
  - Record the timer resolution measured in the worker (the smallest non-zero `performance.now()` delta) in each JSON.
  - Also record an unbiased `tickMsMean = Σ batch ms / Σ ticks` over the scenario.
  - Have `check()` require that any median/p95 below the resolution is flagged (for example `belowResolution: true`), so `docs/performance.md` cannot print "0.00 ms" as a tick time.

### M4. Test 4 does not catch the measurement clock leaking into the `SimClock` (`web/tests/diagnostics.test.ts:159-162`)
- `(k·7919) % 37 === k % 37`, because 7919 ≡ 1 (mod 37). The "jitter" is therefore a clock that advances 1 ms per call and wraps every 37 calls.
- `t4.ts` feeds that perf clock into `SimClock.report()`, which is exactly the leak the § contract forbids. The tick schedule is **identical** (1,344 vs 1,344 ticks).
  - The leaked ms/tick is ≈ 0.5, so the 8 ms budget allows 16 ticks per batch, more than the ~2 needed.
  - A negative sample at each wrap makes the budget infinite.
- Frame timing and `clock.status()` use `now`, so frame counts, ticks, hashes and metrics all match, and the test passes with the leak in place.
- **Fix:**
  - Use a perf clock that advances fast, for example `() => (k++) * 1000`. In `t4.ts` the leak then gives 700 ticks against 1,344, so it is caught.
  - Also compare `f.clock` deep-equal frame by frame.
  - Optionally give both hosts `tickCostMs > 0`, so that the batch budget matters.

## MINOR
1. **Test 6's 5-s budget includes a cold dev server** (`city.e2e.spec.ts:59,75`).
   - Test 6 is the first test of the whole run (see `--list`), and the clock starts before `page.goto`, so Vite's first transform of the app and the worker counts against the 5 s.
   - The warm-up itself is cheap: 1,800 ticks take about 50 ms in node.
   - Fix: warm the server in a `beforeAll` (one `goto('/')`), or measure from `performance.timeOrigin` / `domcontentloaded`.
2. **Test 8's value check is `"0" === "0"`** (`city.e2e.spec.ts:162-165`).
   - `unserved` is 0 for the whole first hour, and also for 30 min after the Main Bridge closure (`onnet.mjs`). Because `unreachable` is also 0, a strip that showed `unreachable` (or any zero metric) under the new label would pass.
   - Fix: add a vitest render test of `MetricsStrip` with `{ unserved: 7, unreachable: 3 }` that expects "7" under "unserved ⓘ".
3. **Test 9 checks only the parsed scale, not the simulated one** (`city.e2e.spec.ts:179`).
   - Nothing proves that `demandScale` reaches `createSim` / `Sim.river_city_scaled` at `?demand=3`.
   - Test 11's `on_network > 2000` at ×5 does prove it indirectly: the baseline peaks at 1,809 in the first hour, a narrow margin.
   - Fix: add a host vitest asserting that `createSim` receives `demandScale` from `init`. Also assert in test 9 that `on_network` at `?demand=3` is clearly above the ×1 value (for example > 2,600) after the warm-up.
4. **Test 5 details** (`diagnostics.test.ts:202-233`).
   - (a) `init` not stepping is only bounded by "≤ 100 ms". Assert `x.sim().tick() === 0` right after `init`.
   - (b) Assert that every `send()` returns ≤ 100, not only `init`.
   - (c) Spec/test mismatch: the spec allows handing queued commands to the sim "when [the warm-up] ends", which may be before `ready` (they still apply at tick 1801). The test, however, requires `closed_links()` at ready not to contain the bridge.
     - Either clarify the spec ("handed to the sim after `ready` is posted"), or make the assertion behavioural: compare `state_hash_hex()` at tick 1800 with a reference host warmed up without the command. That proves the close did not affect ticks ≤ 1800.
5. **The warm-up UI is untested.** The "Starting the city…" `role="status"` and the usable control panel during the warm-up are ward outputs with no test.
   - Today `ControlPanel` has `disabled={p.disabled}`, and frozen `gold_city002` passes even with disabled controls, because Playwright waits for them to be enabled.
   - Fix: delay the wasm with `page.route('**/*.wasm', …)`, then assert that the status is visible and that the speed `<select>` is enabled before ready.
6. **Test 7 does not tie the panel's tick/render/draw numbers to the hook.**
   - Swapping tick and render is caught (render > 1 ms), but showing `drawMedianMs` in the render row, or a stale p95, is not.
   - Fix: after `pause`, compare `diag-tick`, `diag-render` and `diag-draw` with `diagnostics()` (rounded as displayed), and check the `diag-speed` format `/^\d+(\.\d+)?× of \d+×$/`.
7. **Test 1 compares the network by counts only** (`city_005_scale.rs:28-29`). `Link` and `Node` derive `PartialEq`, so assert `c.scenario.network.links() == base.scenario.network.links()` and the same for `nodes()`.
8. **The perf JSON lacks workload conditions and target status** (`perf.spec.ts:80-93`).
   - Add `viewport`, `devicePixelRatio`, `headless`, the Chromium launch args (SwiftShader is forced by the config, so every render number is a software-raster number) and the renderer backend the app actually uses. `gpu()` creates its own new WebGL2 context, so it may not match the app's renderer.
   - Add the brief's targets with met/missed: 10,000 active, ≈ 60 FPS, and the ward's ≥ 5,000 on-network for test 14. Test 14 asserts only `> 0`.
   - Consider a second, non-SwiftShader run for the "where hardware allows" FPS target.
9. **Test 10's follow can lose the car** (`city.e2e.spec.ts:245-286`). A car picked on the Old Bridge may finish its trip within the 1.5 s (≈ 30 sim s) before `trackedTrip` is checked. Prefer the candidate with the longest remaining route (`trackedRoute`), or check within 0.5 s.
10. **Frozen e2e under the warm-up** (for the Gold reviewer, not a test change).

    | Frozen test | Re-check after the 1,800-tick warm-up |
    |---|---|
    | `look.spec` #8 | Before the closure, link 8 holds ≤ 3/40. After the ≥ 0.6 poll hit (8–9.4 sim min), the minimum in the next 60 ticks is ≥ 22/40 in 200 of 201 closure × phase cases. One case dips to 21 (< 0.55), about a 0.5 % flake. |
    | `city.spec` #5 | OK in 52 of 52 closure ticks: alternatives' after/before ≥ 8×, and the bridge empties well within the poll. |
    | `gold5` G1 | Should be re-run: denser bridges at load can cover outline pixels. |
    | `city.spec` #7, `inspect` Tab budget | Unaffected: about 10 tab stops now, and Diagnostics adds one. |
    | Ready polls | The warm-up takes ≪ 30 s. |

## Checked and OK
- **Test 15 really supersedes G4.**
  - It uses the same clip (60 × 16 around the midpoint of `central_bridge`), the same steps (1×, pause, capture, resume, `b`, wait for closed, pause, capture) and the same threshold (mean absolute grayscale difference > 15).
  - Hiding the vehicles replaces the empty-bridge precondition while keeping G4's "independent of vehicles" intent.
  - The frozen file's only change is the skip plus a comment.
- **Tests 2 and 3 arithmetic, verified by hand.**
  - Nearest rank, including the floating-point checks 0.95·20 = 19, 0.95·1000 = 950 and 20/1000 = 0.02.
  - The weighted cases distinguish weighted from unweighted percentiles.
  - Truncation of the oldest batch, the oversize single batch, and invalid batches ignored while 0 ms is accepted.
- **Test 1.** The invalid set (0, −1, NaN, ±∞, 6 + 1e-9, 7), the boundaries, scale 1 ≡ `river_city` by `state_hash` after 10 min, and the behavioural "×3 gives > 2× trips".
- **Test 11** distinguishes ×5 from ×1, because the baseline on-network count never exceeds 1,809 in the first hour.
- **Test 7's held-D check** sends 5 repeats, an odd number, so a non-ignoring handler ends collapsed and is caught. The listener is on `window`, like B and Space.
- **Frozen host vitests** keep the default `warmupS = 0` (the third test 5 case checks this). No frozen test depends on the old `PerfStats` shape or on `createSim`'s arity.
