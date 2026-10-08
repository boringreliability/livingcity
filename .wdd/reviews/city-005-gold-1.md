# city-005 Gold review, round 1

**Verdict: REJECTED** (0 BLOCKER, 1 MAJOR, 5 MINOR)

Reviewer: fresh adversarial Gold subagent. Implementation = HEAD cb2ebc4 (92b16c0 + cb2ebc4). Red snapshot = 5cad6ac (Red r4 approved).

## Test freeze
- `git diff 5cad6ac HEAD -- web/tests web/e2e crates/sim-core/tests` is **empty**.
- Red phase (`git diff --stat 9030d20 5cad6ac` on test dirs): only new files (`city_005_scale.rs`, `city.e2e.spec.ts`, `perf.spec.ts`, `diagnostics.test.ts`, `metrics_strip.test.ts`) plus `review1.spec.ts` (+3/−1 in aa8fb55). That change is exactly the human-approved G4 `test.skip` with a comment pointing at city.e2e test 15. No other earlier test changed.
- Spec diff since Red: only `status: "red"` → `"approved"` in the ward front matter.

## Commands run
| Command | Result |
|---|---|
| `pnpm -C web build:wasm` | OK (tree clean afterwards) |
| `pnpm -C web test` | 16 files, **77/77 passed** |
| `pnpm -C web typecheck` | OK |
| `pnpm -C web build` | OK (JS 274.1 kB / 86.5 kB gzip, wasm 147.8 kB) |
| `pnpm -C web e2e` | **46 passed, 1 skipped** (the G4 skip), 3.9 min. `@perf` was excluded |
| `pnpm -C web exec playwright test e2e/city.e2e.spec.ts e2e/look.spec.ts e2e/gold5.spec.ts e2e/inspect.spec.ts --repeat-each 3` | **81/81 passed** (7.4 min) |
| `cargo test --workspace` | 126 passed, 8 ignored (calibration, debug build) |
| `cargo test -p sim-core --release` | **134 passed**, 0 ignored |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web e2e:perf` | 3/3 passed (4.7 min). Committed JSON was backed up first and restored afterwards with `git checkout -- web/perf-results` |
| Manual smoke | Playwright MCP (headed Chrome, Metal GPU) against vite on 5194 (stopped afterwards). Screenshots in `.playwright-mcp/city-005-gold-1-*.png` |

## Perf re-run vs docs/performance.md
| Scenario | Field | Committed | Re-run |
|---|---|---|---|
| baseline 1× | on network med/max · tick mean · render med/p95 | 1772/1800 · 0.063 · 50/50.1 | 1772/1800 · 0.067 · 50/83.3 |
| baseline 20× | same | 1655/1805 · 0.058 · 50/50.1 | 1655/1805 · 0.060 · 33.4/50.1 |
| closure burst | same, max frame | 1841/2044 · 0.063 · 50/83.3 · 0.7 | 1846/2044 · 0.061 · 50/66.7 · 0.3 |
| stress ×5 | same, waiting max | 5698/5899 · 0.248 · 100/116.7 · 21143 | 5698/5903 · 0.242 · 100/116.7 · 21148 |

The numbers agree within run-to-run noise. SwiftShader render intervals snap to 16.7 ms multiples, and the 20× median of 33.4 against 50 is that quantisation; the target is still missed. The vehicle counts are identical at the baselines, which shows determinism. Hardware-GPU spot check (MCP, `?demand=5` at 5×, 20 s recording): render 8.3/10.1 ms, tick mean 0.240 ms, on network max 5,640. That is consistent with `manual-hardware-gpu.json` (8.3/9.3, 0.292, 5,772).

Report honesty: missed targets are stated as missed, with a bottleneck. The tick mean is cited and the percentiles are flagged as sub-resolution. The hardware run is labelled as manual and not from the harness. See m2 for the one mislabelled claim.

## Manual smoke test
1. **Open.** "Starting the city…" (`role=status`) appeared, ready came about 260 ms after navigation at tick 1819 (sim 00:15:09), and 1,760 vehicles were on the network. Diagnostics was collapsed (`aria-expanded=false`, no region). The strip shows `UNSERVED ⓘ 0`. Pass (`-open.png`).
2. **Press D.** The rows read: tick `0.100 / 0.100 ms` (1000 measured), encode `0.10 ms`, render `8.3 / 10.1 ms`, draw `0.0 / 0.1 ms`, vehicles `1657 / 1660`, `26512 B`, `20.0× of 20×`. Sim tick and render are shown separately, and the magnitudes are plausible on a 120 Hz Metal display. Pass (`-diag.png`).
3. **Demo.**
   - Close: pre-closure queued was 33–62. Spillback appeared on the **Old Bridge** approach, link 8 at 80 % full feeding 288, while feeder link 6 was at 38 %, 9.3 sim min after the closure. Queued peaked at 304 (`-closed.png`).
   - Follow: a car picked at s = 1.5 m on Old Bridge link 288 (trip 24379, Millbrook → Station, route of 6 links) was clicked and followed. After 2 s running it was still tracked, 0.05 px from the canvas centre (`-follow-a/b.png`).
   - Reopen: queued fell from 224 to 55 (≤ 0.6×) in 1.7 sim min (`-reopened.png`).
   - Pass.
4. **`?demand=3`.** The badge reads "stress test ×3" and `demandScale = 3`. "Starting the city…" showed, then ready at tick 1800 with 4,599 on the network and 9,875 active. The app reached 20.0× of 20× with no *behind*. Pass.
5. **Grayscale** (`html{filter:grayscale(1)}`). The badge is a dashed outline plus text. The toggle's open state is a 2 px outline ring, and the closed state has none. No signal relies on hue alone. Pass (`-badge-gray.png`, `-toggle-off-gray.png`).

## Integration checklist
- **Orphaned exports.** The new exports without a `src` consumer are `percentile`, `weightedPercentile` and `TICK_WINDOW`. They are used in `perf.ts` itself and by `diagnostics.test.ts` and `perf.spec.ts`, and the harness depends on them, so they are legitimate. `LivingCityDiagnostics` is the hook's type. The rest of the list are earlier approved named constants. `sim-wasm` `river_city_scaled` is used by `worker.ts`. OK.
- **Protocol.** Every message has a sender and a consumer:
  - ToWorker `init` (+`warmupS`/`demandScale`), `setRunning`, `setSpeed`, `command`, `returnBuffer`, `inspectVehicle` and `inspectLink` are sent by `client.ts`/`App` and handled in `host.handle`.
  - FromWorker `ready` (+`tick`), `frame` (+ new `perf` fields) and `error` are consumed in `client.ts` → `App`.
  - Every new PerfStats field is read by the panel, the hook or the harness (`tickMsMax` and `lastBatchTicks` via `diagnostics().perf`).
  - OK.
- **UI controls.** The Diagnostics button and `D` toggle the panel. The stress badge is display only. The speed select works during warm-up (test 16). OK.
- **Metric names.** The UI reads `active`, `completed`, `mean_travel_time_s`, `on_network`, `queued`, `unserved` and `waiting_at_origin`. All are in `EXTENDED_METRIC_NAMES`, which is what `Sim::metric_names` returns. OK.
- **CLAUDE.md** has the build, dev, test, single-test, e2e, e2e:perf, cargo and clippy commands. **`.wdd/config.json`** conventions are set. OK.
- **Epic wiring.** All of city-001 to city-004 is reachable in the running app: unserved/gridlock metric, River City with three bridges, inspect and follow plus the road panel, decor/legend/labels/hatch and barriers. No buffer or message lacks a consumer.

## Findings

### MAJOR

**M1. The warm-up violates its own 100 ms batch bound under stress demand (and has only about 2× margin at scale 1).** `web/src/sim/host.ts:150,164-167`
- **Contract:** ward § Specification, "Warm-up must not block the worker's message handling for more than 100 ms at a time (batches)". The Red contract adds: "no batch exceeds `WARMUP_BATCH_MAX_MS = 100` of `now` time".
- **Cause:**
  - The first batch is 16 ticks on an almost empty city, which costs about 0.2 ms.
  - The next batch is sized from that cost: `floor(40 / perTick)`, capped at 4096. That covers all remaining 1,784 ticks in **one** batch.
  - Per-tick cost then grows by about 100× as the city fills, so the bound is never re-checked.
  - Test 5 passes only because its fake sim has a constant cost per tick.
- **Reproduced** with the real wasm and the real `createSimHost` (scratch vitest outside the repo, wall time timed around each `iterate()`):

  | scale | clock | batches (ms, ticks) |
  |---|---|---|
  | 1 | precise | (1.0, 16), (20.4, 693), (35.4, 1091) |
  | 1 | 0.1 ms coarse (as in the browser) | (0.2, 16), **(48.9, 1784)** |
  | 3 | either | (0.2, 16), **(116.7–119.7, 1784)** |
  | 5 | either | (0.3, 16), **(168.3–176.3, 1784)** |
  | 6 | either | (0.3, 16), **(187.3–191.3, 1784)** |

  At `?demand=3` and above, the worker's message handling blocks for 120–190 ms in one go. At scale 1 the bound only holds because the whole warm-up happens to take about 50 ms.
- **Fix direction (not prescriptive):**
  - Bound the growth of the batch, for example at most ×2 per step.
  - Size from the latest batch only.
  - Add a regression test (in a new file) with a sim whose tick cost rises with the tick count.

### MINOR

**m1. Per-render allocation and sorting on the UI thread.** `web/src/App.tsx:93-94,103`
- `useRef(new SampleWindow(...))` and `useRef({…, stats: computeRenderStats()})` evaluate their initial-value argument on **every** render of `App`, which re-renders on each frame message (about 55/s).
- So every render builds two throwaway `SampleWindow`s and sorts two 300-element copies, on top of the planned 2 Hz refresh.
- Found by reading the code: React semantics. The draw CPU p95 stays at 0.1 ms, so the measured effect is small.
- Use a lazy init or a constant initial value.

**m2. `docs/performance.md:47` mislabels a probe as the maximum.**
- The report says "The maximum is 5,899 at `?demand=5` in the harness, and 6,676 at the largest allowed scale ×6 over a simulated hour (node + wasm probe; not a harness file)".
- I reproduced 6,676 exactly (×6, tick 7200, seeds 2026/7). But at the same hour ×5 reaches **6,870**, and on-network was still rising: over 3 sim hours ×5 peaks at 7,046 and ×6 at **7,615**.
- So 6,676 is neither the maximum nor tied to the largest scale.
- The conclusion (10,000 is unreachable on this network) still holds. The figure should say "on-network after 1 sim h at ×6" or cite the measured plateau, and the probe should be committed or described well enough to rerun.
- The "about 30,700" storage figure has no file behind it either. The hook's `Σ linkCapacity` gives 32,952 over all 334 links, connectors included. State how it was computed.

**m3. A new `init` does not restart the `SimClock`.** `web/src/sim/host.ts:100,131-150`
- The ward says "a new `init` restarts everything". After a second init, `clock.executedTicks` keeps the old world's ticks and then adds the new warm-up (`addUnpaced`), so `frame.clock.executedTicks` / `clock.simTimeS` ≠ `tick`.
- Test 5 pins `f.tick === f.clock.executedTicks` for the first init only.
- The app inits once per worker, and the UI shows `frame.simTimeS` (= tick × DT), so there is no visible effect today. The behaviour predates this ward, but the warm-up makes it worse.

**m4. The city-004 MINOR carried "for city-005" is not addressed.** `web/src/App.tsx:597-599`
- CONTEXT § What Comes Next lists "the city-004 MINORs above" for this ward.
- The inline label `ref` callback still re-places all 22 labels on every React render (about 55/s).
- It is not in the ward's Tests or Must DO, so it is not gating. Carry it explicitly into CONTEXT or `polish`.

**m5. The diagnostics tick row shows sub-resolution percentiles without a visible flag.** `web/src/ui/DiagnosticsPanel.tsx:33-34`
- On the 0.1 ms browser clock the panel reads `0.100 / 0.100 ms`, while the measured mean is about 0.06 ms. Only the `title` tooltip mentions the timer step.
- The format is pinned by the Red contract, so this is not a defect against the spec. A visible "≤ timer step" hint, as `performance.md` does in prose, would keep the panel as honest as the report.

## Checked without a finding
- **Measurement isolation.** Pacing reads `now`, while `TickWindow`, `frameTickMs` and `encodeMs` read `perfNow` (`host.ts:352-366`, `postFrame`). Test 4 is green.
- **Warm-up batches** are not recorded in the TickWindow or frame sums.
- **Deferred commands** are validated before they are queued and applied after the last warm-up tick.
- **Clock resync** leaves no backlog: in the smoke run, achieved was 20.0× of 20× and *behind* never showed.
- **Recording API.** It covers exactly the frames and rAFs between start and stop. A stop without a start returns an empty recording.
- **`?demand` validation.** `abc` and `7` warn and fall back to 1 (seen in the e2e log).
- **Badge wording.** It never says "realistic". Its tooltip reads "a load test, not a forecast".
- **Determinism.** Identical on-network/active counts across the two perf runs.
