# timeline-005 Gold review, round 1

**Verdict: REJECTED**

Reviewed commit a06f7ff. The implementation diff is `45a18a4..a06f7ff`.

All suites pass. The frozen tests are unchanged. The integration checks have teeth. The § Timeline numbers match `timeline.json` and reproduce on a re-run.

The rejection has one cause: `docs/demo.md` fails as written at three of its "press Space" steps. The ward makes the demo a pass criterion ("README and the demo work as written"), so this is MAJOR.

## Findings

### MAJOR

**M1. In `docs/demo.md`, "Press Space" fails right after a button click (steps 3, 4 and 5)**
- **Where:**
  - `docs/demo.md:28` (step 3, "Press **Space** to pause");
  - `:41` (step 4, "Press **Space** and let B run");
  - `:47` (step 5, "Press **Space**: both advance in lockstep").
- **Cause:** the global shortcut handler returns early while focus is on a control (`web/src/App.tsx:606`). A clicked `<button>` keeps focus, and Space then activates that button natively. Each of these demo steps follows a step where the user clicks a button, so Space hits the button instead of play/pause.
- **What I saw in the browser,** following the doc literally (Playwright, port 5299):
  - **Step 4.** I clicked **Close link** twice, as step 4 says, then pressed Space. B did not start: `running:false, tick:1500` before and after. Focus was still on the "Close link" button, which was pressed again.
  - **Step 5.** I clicked **Compare side by side**, then pressed Space. Compare was switched **off**: `compare:false, sides:null`. Nothing advanced in lockstep.
  - **Step 3.** I clicked **Close the main bridge** in step 2, let it run, then pressed Space. The bridge **reopened**: `closed:[284,285]` → `[]`. The sim kept running (`running:true`).
    - This step works only if the user also follows step 2's optional "click a road", because clicking the canvas moves focus to `BODY`.
- **The acceptance test works around the same trap.** `web/e2e/acceptance.spec.ts:8,13` calls `blur()` before every Space press.
- **The flow does work with the right inputs.** Clicking Play/Pause, or clicking the map before pressing Space, gave lockstep `sides.a.tick == sides.b.tick` (3112). So this is a doc/UX defect, not a sim defect.
- **Fix (either option):**
  - **(a) App (preferred, because a newcomer will hit this whatever the doc says).** Drop focus from panel buttons after a *pointer* click and keep keyboard focus semantics. For example, add a capture-phase `pointerup` listener that blurs `BUTTON` targets, or use `onClick={(e) => { …; if (e.detail > 0) e.currentTarget.blur(); }}` on the Close-the-main-bridge, Close/Reopen link, Compare, A/B and Play buttons. Add a regression e2e in a **new** spec: click button → Space → play/pause toggles and the button is not re-activated. Do not touch the frozen files.
  - **(b) Doc only.** In steps 3–5, say "click **Play/Pause**", or "click an empty spot on the map first, then press Space".

### MINOR

**m1. "Click the other direction of the North Bridge" is a sub-pixel target at the initial zoom** (`docs/demo.md:37`)
- At the fit zoom (0.176 px/m), the drawn midpoints of links 286 and 287 are 0.8 px apart: (687.6, 145.1) and (687.6, 144.3).
- Three clicks on the same spot all selected 286.
- **Fix:** add "zoom in on the bridge (mouse wheel) until the two directions separate, then click the other one".

**m2. The tick order in `docs/traffic-model.md:11-12` does not match the code**
- `World::step` (`crates/sim-core/src/world.rs:1184-1186`) does three things in this order:
  1. it enqueues periodic reroutes (`enqueue_periodic`);
  2. it runs the NoRoute/stranded retries (`run_retries`);
  3. it processes the budgeted priority and periodic queues (`process_reroute_queues`).
- The doc lists "4. reroutes" before "5. NoRoute retries".
- **Fix:** "4. periodic reroutes are queued; 5. NoRoute retries; 6. budgeted reroutes (closure-triggered first)", and renumber the rest.

**m3. The Comparison panel's "Unserved" row is not the "unserved" that `traffic-model.md` defines**
- **What the panel shows** (`web/src/ui/ComparisonPanel.tsx:39`): the cohort's removals only, unreachable plus gridlock.
- **What the doc defines** (`docs/traffic-model.md:106`): "unserved" as NoRoute + stranded + removed, which is the metrics strip's definition.
- In the comparison, NoRoute and stranded trips are counted under Incomplete instead.
- **Fix:** add one line to the "incomplete" bullet: "In the Comparison panel, the **Unserved** row is the cohort's removals (unreachable + gridlocked); trips currently without a route count as incomplete there."

**m4. `inspectLink` is described as "keyed by frame tick and record"** (`docs/architecture.md:28`)
- Only `inspectVehicle` carries `frameTick` and `record`. `inspectLink` carries only `link` (`web/src/sim/protocol.ts:55-57`).
- **Fix:** "`inspectVehicle` (keyed by frame tick and record) and `inspectLink` (by link id)".

**m5. The branch latency is a single sample, frame-bound and not flagged as such** (`docs/performance.md`, § Timeline, Branch row)
- `branch.ms` is n = 1 and shorter than one 50 ms SwiftShader render interval.
- My re-run measured **16.3 ms**; the committed run has **38.3 ms**.
- The seek row is honestly flagged `frameBound`, but the branch row is not.
- **Fix:** add "(one sample; bounded by the render interval like the seek)", and point to `timeline_probe` for the native branch cost. That cost is measured: median 4.34 ms, p95 8.48 ms, n = 50.
- Separately, "with the replay window filled first (2.6 sim h retained)" suggests that the budget was reached. It was not: A holds 44.3 of 48 MiB with `startTick: 0`, so no snapshots had been evicted. Say "grown to 2.6 sim h (below the budget, no eviction yet)".

**m6. Demo step 2's wall-time and "queued rising" are optimistic**
- In three runs where I closed the bridge at the warm-up head:
  - **Run 1:** queued rose 22 → 93 within 5 sim min.
  - **Run 2:** queued rose from about 70 to 180–240 only after about 5–6 sim min, i.e. ≥ 15–18 s of wall time at 20×.
  - **Run 3** (closure at tick ≈ 1802): queued read 77 → 75 → 57 at +4 and +9 sim min.
- Queued is noisy right after the warm-up. Its baseline at 12:30 was already 104.
- **Fix:** say "about 20–30 s" and "queued climbs, with fluctuations, to well above its earlier level". Also point at the visible spillback squares, which are the stronger signal.

**m7. Must DO items are still open: `CONTEXT.md` and the epic table, plus the epic-gate summary**
- They are not in this diff. This is expected at `wdd complete`, so treat it as a reminder.

### Checked and OK
- **Frozen hashes match:**
  - `acceptance.spec.ts` b347681b…;
  - `integration.test.ts` b2d0fdef…;
  - `perf_timeline.spec.ts` db947a2f….
- No test file changed in `45a18a4..a06f7ff`. The changes are 5 docs, `timeline.json`, 4 `web/src` files (export removals only), `CLAUDE.md` (duration) and the ward status.
- **The 14 export removals are safe:**
  - every symbol is used only inside its own module;
  - `tsconfig` includes `src`, `tests` and `e2e`, so `typecheck` covers all importers;
  - a grep of `src`, `tests`, `e2e`, docs and README finds no other reference, including no evaluated-string or dynamic imports.
  - The renderer constants are still interpolated into the shaders. The look and legend e2e tests are green.
- **The integration checks have teeth.** I mutated a scratch copy of the tree:
  - re-exporting `DECK_MIN_PX` → test 4 fails;
  - adding a new unused `export function` → test 4 fails;
  - removing `case 'discardBranch'` from the host → test 3 fails ("host handles discardBranch");
  - adding a `ToWorker` type with no sender → test 3 fails;
  - changing 86.9 → 85.0 ms in § Timeline → test 6 fails.
- **No buffers or messages without consumers.** Every `FrameMessage` field is read in `App.tsx` and the UI or renderer. The 4 `FromWorker` types are posted and routed.
- **Architecture claims verified:**
  - 0.5 s tick (`params.rs:5`);
  - wall clock and HashMap forbidden by `crates/sim-core/clippy.toml`;
  - counter-based demand (`demand.rs:97-110`, `splitmix64(mix3(seed, tick, flow))`);
  - behaviour RNG drives `speed_factor` 0.9 + 0.2·u (`world.rs:901`);
  - `SNAPSHOT_INTERVAL_TICKS = 120`;
  - seek replays ≤ 119 ticks (probe: max 119);
  - 48 MiB budget per scenario (`sim-wasm/src/lib.rs:19`);
  - 16-byte records with the flag bits as described (`protocol.ts:4-23`);
  - `returnBuffer` as a transferable;
  - comparison every 500 ms plus on entering compare, on a seek and on pause (`host.ts:298-310`, `:543`, `:616`);
  - `SimClock` 8 ms budget and 1 s cap;
  - compare refused below the branch tick (`host.ts:330`);
  - interventions refused while comparing (`host.ts:246`).
- **Traffic-model constants verified:**
  - `params.rs`: jam spacing 7.5, sat flow 0.5/lane, credit cap 1, accel 2, queued < 2 m/s, origin admit 2, cost epoch 60, EMA 0.5, reroute period 240, budget 200, hysteresis 0.85 and 20 s, NoRoute retry 60 × 10, gridlock 120 and 1200;
  - `routing.rs`: free-flow formula, integer-ms keys, lowest-link-id ties;
  - `update_costs`: observed = max(mean exit, queue term);
  - `discharge_lane`: arrival not credit-limited, forced decision at a closed next link;
  - River City (`cities.rs`): 22 zones; bridges 2 / 1 / 1 lanes, Old Bridge at 30 km/h and 900 veh/h; west→east demand 5 × 680 × 0.9 = 3,060 veh/h; flat `Profile::default()`;
  - `window_metrics` (`world.rs:693-732`): cohort, incomplete and nearest-rank p95 as described.
- **README:**
  - every `pnpm -C web` script and `cargo` target exists;
  - `pnpm -C web install` → "Already up to date";
  - `cargo run -p sim-core --release --example timeline_probe` runs: seek median 1.80 ms, branch median 4.34 ms;
  - `?city=three_bridges` → `city: three_bridges`;
  - `?demand=3` → `demandScale: 3` with the "stress test ×3" badge;
  - D toggles diagnostics;
  - the tool versions match the machine (rustc 1.93.0, Node 24.9.0, pnpm 11.10.0, wasm-pack 0.13.1);
  - `web/src/wasm/` is gitignored, as stated.
- **The § Timeline numbers all appear in `timeline.json`** and are formatted correctly: 86.9, 91.7, 92.9, 38.3, 44.3, 37.0, 81.3, 0.046, 0.084, 1.84, 50, 83.3, the tick ranges, 1644, 24, 4–118, 2.6 h, 1280 × 800.
- **The § Timeline flags are honest:** `frameBound`, `tickBelowTimerResolution`, and only means cited.

## What I ran
| Command | Result |
|---|---|
| `shasum -a 256` on the 3 frozen files | all match |
| `pnpm -C web build:wasm` | ok |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web test` | **21 files, 109 passed** |
| `cargo test --workspace --release` | all `ok`; timeline_002_branch 19, timeline_001_snapshots 18, core_003 36, etc.; 0 failed |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web e2e` | **73 passed, 1 skipped** (review1 G4, an existing skip), 12.6 min; `brief_acceptance_flow` ✓ (1.0 m), `acceptance_flow_keyboard_only` ✓ (8.7 s) |
| `PERF=1 playwright test e2e/perf_timeline.spec.ts` | ✓ (3.1 m); see the comparison below |
| `cargo test -p sim-core --test timeline_002_branch` (debug) | 19 passed |

Afterwards I restored the committed `timeline.json` with `git checkout`. My copy is in `scratchpad/gold-tl005/timeline-gold.json`.

**Re-run against the committed values:**

| Measurement | Committed | Re-run |
|---|---|---|
| seek median / p95 / max | 86.9 / 91.7 / 92.9 | 87.6 / 92.3 / 92.4 |
| branch | 38.3 | **16.3** (see m5) |
| A / B / pair MiB | 44.3 / 37.0 / 81.3 | 44.3 / 37.0 / 81.3 |
| tick mean, single / lockstep | 0.046 / 0.084 | 0.045 / 0.087 |
| ratio | 1.84 | 1.92 |
| render interval median | 50 / 83.3 | 50 / 83.3 |
| on network median | 1644 | 1644 |

Everything is in range except the branch sample.

## Smoke-test log
I followed `docs/demo.md` in Playwright against a Vite dev server on port 5299, at a 1400 × 900 viewport, as a literal user would.

1. **Open.** River City is running at about 15–18 sim min. The 20× select, sim time, the metrics strip with ⓘ on queued and unserved, the legend, and the timeline with "x / 48 MiB … (per scenario)" are all present. ✓
2. **Click "Close the main bridge".** The hatch and barriers appear, and the button reads "Main bridge closed — reopen".
   - Queued: 22 → 93 in 5 sim min in run 1. ✓
   - Run 3 was weak (see m6).
   - Clicking the Old Bridge opens the "Link 288" panel with lanes, vehicles, queued, state and capacity. ✓
3. **Press Space.**
   - With focus still on the bridge button, Space **reopened the bridge** and did not pause. ✗ (M1)
   - After clicking the map, Space paused. ✓
   - Clicking the track at about 12:30 seeks, and the main bridge is open in A's past. ✓
4. **Click the North Bridge (286) → Close link.**
   - B is created at tick 1500, "Viewing B: branch" appears, and A's head stays at 2877. ✓
   - The other direction (287) is selectable only at sub-pixel precision at this zoom. (m1)
   - Close link → both closures are pending.
   - **Press Space:** it re-pressed "Close link" and B stayed paused. ✗ (M1)
   - Clicking **Play** instead: `closed:[286,287]`, and B ran to 2952. ✓
5. **Click "Compare side by side".**
   - Both sides are at 2952: A has `closed [284,285]`, B has `[286,287]`. The camera is shared. The side labels are correct.
   - The panel shows Generated 4402 = 4402, Completed, **Incomplete**, Unserved, mean and p95, with Δ and ▲/▼. ✓
   - **Press Space:** compare was **turned off**. ✗ (M1)
   - Re-entering compare, clicking the map, then pressing Space: lockstep worked (3112 = 3112). ✓
   - Interventions and the A/B switch are disabled, with tooltips. ✓
   - Compare again exits. ✓
   - Discard branch removes the Scenarios panel. ✓
6. **"Also try".** D shows diagnostics, `?city=three_bridges` works, and `?demand=3` shows the badge. ✓

The dev server is stopped and the browser is closed. `git status` is clean apart from this file.
