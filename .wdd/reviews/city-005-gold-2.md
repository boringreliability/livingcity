# city-005 Gold review, round 2

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 3 MINOR)

Reviewer: a fresh adversarial Gold subagent.
- Implementation: HEAD e6675dc, which is the r1 fixes on top of 92b16c0 + cb2ebc4.
- Red snapshot: 5cad6ac, approved at Red r4.

## Test freeze
- `git diff --name-status 5cad6ac HEAD -- web/tests web/e2e crates/sim-core/tests` gives exactly one line: `A web/tests/gold_city005.test.ts`. That file is the new Gold regression file.
- No frozen file has changed.
- The human-approved G4 `test.skip` in `review1.spec.ts` is unchanged. In the e2e run it shows as the 1 skipped test.

## Commands run
| Command | Result |
|---|---|
| `pnpm -C web build:wasm` | OK; tree clean afterwards |
| `pnpm -C web test` | 17 files, **80/80 passed** |
| `pnpm -C web typecheck` | OK |
| `pnpm -C web build` | OK (JS 274.3 kB / 86.5 kB gzip, wasm 147.8 kB) |
| `pnpm -C web e2e` | **46 passed, 1 skipped** (G4), 3.3 min |
| `pnpm -C web e2e e2e/city.e2e.spec.ts e2e/look.spec.ts e2e/gold5.spec.ts e2e/inspect.spec.ts --repeat-each 3` | **81/81 passed** (7.0 min) |
| `cargo test --workspace` | 126 passed, 8 ignored (calibration, debug build) |
| `cargo test -p sim-core --release` | **134 passed**, 0 ignored |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web e2e:perf` | 3/3 passed (4.6 min). The committed JSON was backed up first and restored afterwards with `git checkout -- web/perf-results`; tree clean |
| Manual smoke | Playwright MCP against a headed Chrome (ANGLE Metal, Apple M4 Pro). vite ran on 5193 and was killed afterwards. Screenshots in `.playwright-mcp/city-005-gold-2-*.png` |

## r1 findings: verification
| r1 | Status | Evidence |
|---|---|---|
| **M1** warm-up batch bound | **Resolved** | See below |
| m1 per-render allocations | **Resolved** | See below |
| m2 report mislabelled maximum / storage figure | **Resolved** | See below |
| m3 re-init clock | **Resolved** for `executedTicks` | See below |
| m4 label ref callback | **Resolved** | See below |
| m5 sub-resolution tick row | **Resolved** | See below |

**M1, warm-up batch bound.**
- `host.ts:160-174`: `warmStep` steps chunks of 32 ticks until 40 ms of `now` have passed.
- Real wasm + real `createSimHost`, timed around each `iterate()` (temporary vitest, deleted afterwards). Columns are scale: HEAD max batch, then r1 code from `git show HEAD~1:web/src/sim/host.ts`:
  - ×1: **40.1 ms** (r1 52.9);
  - ×3: **41.5 / 41.9 ms** (r1 124.2);
  - ×5: **43.3 / 44.3 ms** (r1 177.0);
  - ×6: **44.1 / 43.0 ms** (r1 195.9).
- Clocks: precise / 0.1-ms coarse. Every run reached ready at tick 1800.
- Measured while the e2e suite ran in parallel, so the numbers are conservative.
- The new regression file fails on the r1 host: rising cost 162 ms > 100, step cost 1600 ms > 100, and the re-init test gives `1 ≠ 193`. It passes on HEAD.
- The bound comment ("≤ 40 ms + one chunk, up to 1.9 ms/tick") matches the code. The measured cost at ×6 is about 0.26 ms/tick.

**m1, per-render allocations.**
- `App.tsx:94-95,104`: lazy `useState` initialisers. `SampleWindow` and `computeRenderStats` run only once at mount.

**m2, report figures.**
- `network-throughput-probe.json` reproduced **exactly** (node + wasm, seeds 2026/7, sampled per sim minute):
  - ×3: 6066 / 6200;
  - ×4: 6454 / 6541;
  - ×5: 6856 / 7042;
  - ×6: 6676 / 7615;
  - storage 32952, 30664 without zone connectors.
- Per-tick sampling gives a few more (×6 3 h: 7618). The JSON says "sampled once per sim minute", so the labelling is honest.

**m3, re-init clock.**
- `clock.ts:97-100` adds `resetExecuted`, called at `host.ts:153`. The regression test pins `tick = executedTicks` after a re-init.
- The other clock state carries over; see n2.

**m4, label ref callback.**
- `App.tsx:601`: places only new elements. The rAF loop re-places on camera or label-set change (`App.tsx:327-334`). `look.spec` `labels_follow_camera_while_paused` is green ×3.

**m5, sub-resolution tick row.**
- New `diag-tick-mean` row (`DiagnosticsPanel.tsx:35`), backed by `TickWindow.mean()` (`perf.ts:51-61`), which uses the same 1,000-tick truncation as `stats()`.
- In the browser: `0.100 / 0.200 ms` for the percentiles and **`0.066 ms`** for the mean.

## Perf re-run vs docs/performance.md
| Scenario | Field | Committed | Re-run |
|---|---|---|---|
| baseline 1× | on network med/max · tick mean · render med/p95 | 1772/1800 · 0.063 · 50/50.1 | 1772/1800 · 0.060 · 50/50.1 |
| baseline 20× | same | 1655/1805 · 0.058 · 50/50.1 | 1655/1805 · 0.059 · 50/50.1 |
| closure burst | same · max frame | 1841/2044 · 0.063 · 50/83.3 · 0.7 | 1846/2044 · 0.060 · 50/66.7 · 0.2 |
| stress ×5 | same · active max · waiting max | 5698/5899 · 0.248 · 100/116.7 · 27042 · 21143 | 5698/5903 · 0.238 · 100/116.7 · 27051 · 21148 |

- **Agreement:** the numbers agree within noise. The baseline counts are identical, which supports determinism.
- **Code change since the committed JSON:** the committed JSON predates the r1 fixes. The fixes touch only the unmeasured warm-up and App render allocations, and the re-run confirms that the report still holds.
- **Honesty:**
  - missed targets (60 FPS on SwiftShader, 10,000 on network) are stated as missed, with bottlenecks;
  - tick costs cite the mean;
  - the hardware run and the probe are labelled as not from the harness.

## Manual smoke test
1. **Open.**
   - Ready came before the first poll. Tick 1868 = sim 15:34, with 1,764 vehicles on the network, running.
   - Diagnostics was collapsed (`aria-expanded=false`, no region). The only console error was a favicon 404.
   - Screenshot: `-open.png`.
2. **Press D.** Rows after 2.5 s:
   - tick `0.100 / 0.200 ms`, **mean `0.066 ms`**, measured `1000`;
   - render `8.3 / 10.1 ms`, draw `0.0 / 0.1 ms`;
   - vehicles `1664 / 1664`, `26624 B`, `20.0× of 20×`.
   - Sim tick and render frame are shown separately, and the values are plausible on a 120 Hz Metal display.
   - Screenshot: `-diag.png`.
3. **Demo.** Pass.
   - Close: pre-closure queued was 45/19/32/50/24 (median 32), and queued peaked at 182 (≥ 2×). Old Bridge approach link 8 reached **80 % full** while feeder link 6 was at 25 %, **8.5 sim min** after the closure (`-closed.png`).
   - Follow: paused, picked the earliest car on Old Bridge link 288 (s = 10.5 m, trip 10866, route [288, 142, 144, 146, 327]), zoomed, clicked, then Follow. After 2.5 s running it was still tracked and driving, **0.45 px** from the canvas centre (`-follow-a/b.png`).
   - Reopen: queued fell from 204 to 106 (≤ 0.6×) in **2.6 sim min** (`-reopened.png`).
4. **`?demand=6`.** Pass.
   - "Starting the city…" (`role=status`) was visible about 74 ms after navigation and ready about 317 ms after it.
   - At ready: tick 1800, `demandScale` 6, 5,613 on the network, 25,174 active.
   - The badge reads "stress test ×6" with a dashed outline (`-demand6.png`).
   - It reached 40/40 ticks/s, with tick mean 0.258 ms and render 8.3/9.5 ms.
   - Pause took effect in **14 ms**, and the tick advanced 0 over 1 s while paused. No console warnings.

## Integration checklist
- **Exports.**
  - The new API since r1 is `SimClock.resetExecuted` (used by the host), `TickWindow.mean` (used by the host) and `PerfStats.tickMsMean` (panel and harness).
  - The r1 audit of `percentile`, `weightedPercentile`, `TICK_WINDOW`, `LivingCityDiagnostics` and `river_city_scaled` still holds.
  - No orphans.
- **Protocol.**
  - `init` (+`warmupS`/`demandScale`), `setRunning`, `setSpeed`, `command`, `returnBuffer`, `inspectVehicle` and `inspectLink` are sent by `client.ts`/App and handled in `host.handle`.
  - `ready` (+`tick`), `frame` (+`perf`) and `error` are consumed in `client.ts` → App.
- **Controls.** The Diagnostics button and `D` toggle the panel (D also verified live). The stress badge is display only. The speed select during warm-up is covered by test 16 (green).
- **Metric names.** `active`, `completed`, `mean_travel_time_s`, `on_network`, `queued`, `unserved` and `waiting_at_origin` all come from `metric_names()`.
- **Commands and config.** The CLAUDE.md commands (build, dev, test, single test, e2e, single spec, e2e:perf, cargo, single Rust test, clippy) are present. `.wdd/config.json` conventions are set.
- **city-001…004 features reachable** in the live run:
  - River City with three bridges, labels, decor and legend;
  - closed-road hatch and barriers;
  - congestion styling and queued-car squares;
  - vehicle inspect, Follow, ring and halo;
  - road panel (inspect e2e ×3 green);
  - unserved metric.
- **Warm-up correctness.**
  - Chunked and time-bounded, as measured above.
  - Commands sent during the warm-up are validated, then deferred and applied after the last warm-up tick (`host.ts:172,217-220`).
  - `addUnpaced` + `resync` leave no backlog: 20.0× of 20× right after ready.
  - A re-init clears warm-up, deferred commands, `TickWindow` and inspection.
- **Measurement isolation.** Pacing uses `now` and stats use `perfNow`. Warm-up ticks are not in the `TickWindow` or frame sums. Test 4 is green.
- **Determinism.** Identical on-network median/max in the committed and re-run baselines.
- **Hue-only signals.** None new. The badge is a dashed outline plus text, and the diag toggle shows `aria-expanded` plus an outline ring.

## Findings

### MINOR

**n1. The legend overlaps the metrics strip on viewports narrower than about 1,255 px, hiding the new UNSERVED value.**
- Where: `web/src/styles.css:177-182` (`.metrics`, left-anchored) and `:302-310` (`.legend`, right-anchored), with no collision handling.
- Reproduced in the MCP browser at its default 1200 × 818: strip `[16..535]`, legend `[480..1184]`, and the `unserved ⓘ` label at x 443–522 under the legend. Visible in `-open.png`, `-diag.png` and `-demand6.png` as "UNSER…" with the value hidden.
- Cause: the overlap is older than this ward (the city-004 legend). But the unserved metric is a city-005 deliverable, and at a common laptop width it cannot be read until the legend is collapsed.
- Tests: the e2e viewport is 1280, where there is no overlap, so no test sees it.
- Fix direction: wrap or stack the bottom band when it is narrow, or collapse the legend by default below a width. Carry it to `polish` if not fixed now.

**n2. A re-init resets only `executedTicks`; the rest of the `SimClock` state carries over.**
- Where: `web/src/sim/host.ts:135-157`, `clock.ts`.
- What carries over: backlog, `creditedUntil`, `msPerTick` EMA, and the 1-s `reports` window (achieved rate).
- With a warm-up, `resync()` clears backlog and credit, but the achieved-rate window still counts the previous world's ticks for up to 1 s. Without a warm-up, the old backlog is run in the new world.
- The spec says "a new `init` restarts everything". Found by reading the code.
- No visible effect today, because the app inits once per worker.

**n3. Carry-forwards and bookkeeping.**
- The other city-004 MINORs listed in CONTEXT § Known Limitations are not addressed and not gating: hover halo lightness, the hatch dropped below 14 px, and no e2e test for "close while paused".
- CONTEXT.md still says "next city-005" and the epic table is not updated (ward Must DO). This is expected at `wdd complete`. Make sure those MINORs, n1 and n2 are carried into CONTEXT/`polish` explicitly.
- Nit: `docs/performance.md` says the harness ran at "12:5x UTC", but `stress-5x.json` is stamped 13:01 UTC.

## Checked without a finding
- **Batch bound under all scales** (see M1 above). The regression test genuinely catches the r1 defect.
- **`TickWindow.mean()`** uses the same truncation as `stats()`, also when a single batch is larger than the window: the weight is clamped to 1,000.
- **Label placement:** a `WeakMap` per element plus the generation counter re-places labels on camera or label-set change. A remount is always placed.
- **Recording API**, **`?demand` validation** and **badge wording** ("a load test, not a forecast") are unchanged since r1 and still correct.
- **Worker per-frame cost:** `TickWindow.stats()` sorts up to about 1,000 samples per frame. This is measurement overhead in the worker only. It does not affect the sim and is not visible: the tick mean is unchanged versus r1.
