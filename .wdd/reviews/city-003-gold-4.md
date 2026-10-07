# city-003 Gold review, round 4

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 4 MINOR)

Reviewer: fresh adversarial Gold subagent (round 4, run after the human approved a fourth round following three rejections). Implementation = HEAD e8277eb (round-3 fix commit). Red snapshot = 8522c56.

## Test freeze
`git diff --name-status 8522c56 -- crates/sim-core/tests web/tests web/e2e` lists only **added** files: `A web/e2e/gold_city003.spec.ts` and `A web/tests/gold_city003.test.ts` (Gold regression tests). No frozen test changed.

## Commands run
| Command | Result |
|---|---|
| `cargo test --workspace --release` | all green (city_001 28, city_002 12, city_003 5, core_001 20, core_002 24, core_003 36, core_004 5) |
| `cargo test -p sim-core` (debug) | all green (city_002: 4 passed, 8 ignored, the pre-existing release-only tests) |
| `cargo clippy -p sim-core -p sim-wasm --all-targets -- -D warnings` | clean |
| `pnpm -C web build:wasm` / `typecheck` / `build` | OK |
| `pnpm -C web test` | 13 files, 54/54 passed |
| `pnpm -C web e2e` (full suite) | 30/30 passed (includes the new Gold r3 regressions for M-C and M-B) |
| `playwright test e2e/inspect.spec.ts e2e/gold_city003.spec.ts --repeat-each=4 --workers=4` | **40/40 passed** |
| `playwright test e2e/city.spec.ts e2e/review1.spec.ts e2e/review2.spec.ts e2e/gold5.spec.ts --repeat-each=2` | 32/32 passed |
| Scratch Playwright measurements (vite on port 5194) | `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/g003d/review3.mjs` (modes `race`, `play`, `speedup`, `smoke`) and `old.mjs` (smoke step 3 + grayscale) |

The scratch race script was hardened against round 3's version:
- B is never A: candidates within 15 px of `trackedScreenCenter()` are excluded.
- Identity check (paused runs): after the race, the tracked vehicle's drawn centre must coincide with the clicked point. `isB` = distance in px, and 0 means the tracked vehicle is B.

## Round-3 findings: status

### M-C (pick lost after a clear, inspection then dead): fixed
Setup: River City, paused, zoom 1.5, a driving vehicle A tracked, then Escape and a click on B.

| Trigger | Correct new vehicle tracked |
|---|---|
| Escape + pointerdown/up on B dispatched in the **same task** (GAP 0) | **6/6** (`isB` = 0 every time) |
| GAP 10 ms | **5/5** |
| **Real input during a 400 ms main-thread block** (`keyboard.press('Escape')`, then a real `mouse.click` on B 120 ms later) | **8/8** (round 3: 5/5 lost) |
| Click on B while A is tracked, without Escape, under the same jank | 4/4 switched to B |
| Running at 20×, GAP 0 | 3/3 tracked (2 iterations found no stationary B candidate, a script limitation) |

Inspection keeps working afterwards: every iteration ends with Escape and then re-tracks A with a normal click, and that succeeded in all of them. The new Gold e2e `fix M-C` passed 1× in the full run and 4× in the stress run.

### M-B (in-flight frames resurrect a cleared vehicle): stays fixed
Frozen test 16 passed in the full run and 4/4 under load. The new `fix M-B` regression passed 5/5.

### M-A (lurch right after Play): stays fixed
Follow at 1×, zoom 2.24, samples per requestAnimationFrame started in the same task as the Play keydown:

| Pause before Play | Max step in the first 1.5 s | Backward steps |
|---|---|---|
| 300 ms | 9.07 px | 0 |
| 1.5 s | 2.03 px | 0 |
| 4 s | 1.86 px | 0 |

The single 9.07 px step is flagged `link: true`: it is the known junction step (m-3), not a tick lurch.

### m-1 (speed change rescales the extrapolation): fixed

| Switch while following | Result |
|---|---|
| 1× → 60×, zoom 1.2 (2 runs) | First steps 17–54 px/frame, which is ordinary 60× motion (≈1900 px/s at zoom 2.24, ≈1000 px/s at zoom 1.2). No outlier jump. Round 3 had an 85 px one-off jump. 0 backward steps. |
| 1× → 5×, zoom 2.24 | Max step 6.6 px, 0 backward steps, first step after the switch 0.8 px |

## New-defect hunt around the seq design (no MAJOR found)
- **Host init vs the UI counter.**
  - Host `init` does not reset `inspectSeq`. The UI counter (`inspectSeqRef`) is monotonic for the component's lifetime.
  - A new worker (StrictMode remount) starts at `inspectSeq = 0`, but it omits `tracked`/`trackedSeq` until the first `inspectVehicle`. That request carries the UI's current (higher) counter. So a fresh host can never echo a seq below the UI's, except for frames built before that request, which are correctly stale.
- **Frames without `trackedSeq`.** These appear only before vehicle inspection is used, and then `tracked` is also absent (`f.tracked` undefined), so the App changes nothing. `trackedSeq` and `tracked` are always emitted together (`host.ts` postFrame).
- **Callers without `seq`.** The only callers of `inspectVehicle`/`clearInspectedVehicle` are in `App.tsx`, and both pass a seq. The frozen unit tests send no seq, and the host then keeps its previous value (no UI is involved there).
- **A pick that resolves to −1.**
  - The host still adopts the new seq and keeps the current `trackedTrip`.
  - Clear then failed pick: frames carry `tracked: null` at the new seq, and the UI shows nothing. That is consistent.
  - Pick B while tracking A, and B fails: A stays shown. This is documented behaviour ("an unresolvable pick keeps whatever is tracked now").
  - Nothing can lock.
- **Gone notice.**
  - A gone frame built at seq n is ignored only if the UI has already sent request n+1, and that newer request supersedes it.
  - Without a newer request, the gone notice is shown. Frozen `vehicle_gone_message` is green (1× full run plus 4× stress).
  - The host's `tracked()` clears `trackedTrip` on gone even when the UI ignores that frame. This is harmless, because the UI's newer request redefines the tracked trip anyway.
- **`linkDetail` is unaffected.** `setLinkDetail(f.linkDetail ?? null)` is outside the seq branch, so road panels update on every frame (frozen `road_panel_real_stats` 5/5 green).

## Findings

### MINOR
- **m-1 (new): restarting the anchor on a speed change drops the extrapolation in progress to 0.**
  - When the multiplier changes mid-tick, `frameAtMs` is reset while the frame positions stay at the old tick. Cars can step back by up to one tick's worth of extrapolation (at 1×: ≤ 0.5 s × v ≈ 7 m).
  - Not visible in measurements (1→5×, 1→60×: 0 backward steps > 1 px).
  - A smoother alternative: re-base so the current `dtSim` is preserved (`frameAtMs = now − dtSimNow / newRate`). That needs the App's `simPerMs`, so it is optional.
- **m-2: no host-level unit test for the `trackedSeq` echo.** It is covered only by the e2e regressions.
  - Suggestion: a Vitest test that sends `inspectVehicle{…, seq: 5}` and `{clear, seq: 6}` and asserts that `trackedSeq` echoes 5 and then 6.
  - Also assert that a seq-less message keeps the previous value.
- **m-3 (carried, round 2 m-A): junction step.** One step of about 9 px at zoom 2.24 when the tracked car changes link (measured 9.07 px).
- **m-4 (carried, round 3 m-3): the behind/extrapolation interaction is bounded only by the 2 s cap.** Switching to the achieved rate when `behind` is flagged also rescales the elapsed part retroactively. Not observed here (`behind` never raised at 60× on this machine).
- Note (trivial): with a pick in flight and nothing yet tracked (`trackedRef` null), Escape goes to the road deselect, and the pending pick then appears. This is expected-ish UX and pre-existing.

## Manual smoke test (Playwright, screenshots in `.playwright-mcp/city003-g4-*.png`)
1. **Car on the Main Bridge:** trip #777 on link 284 (route `[284,172,174,176]`).
   - Panel: "Trip #777: Old Town → Tech Park, ▶ driving, 48 km/h, on trip 1:36, link 284, route changes 0, Follow".
   - Ring and dashed route visible (`02-main-bridge-car.png`).
   - Follow at 1× for 4 s: the tracked car sits 0.45 px from the canvas centre (`03-follow-1x.png`). **Pass.**
2. **Approaching car, then close the Main Bridge:** trip #486 (Riverside → St. Mary's Hospital).
   - Before the closure: route `[38,284,172,…]`, route changes 0.
   - After the closure: route `[38,135,133,131,288,…]` via the Old Bridge, route changes **1**.
   - The dashed line turns south before the hatched, closed bridge (`05-rerouted.png`). **Pass.**
3. **Old Bridge (link 288, `old.mjs`):**
   - Capacity 900 veh/h (≤ 900).
   - Before the closure: travel time now 52.2 s = free flow 52.2 s.
   - After the closure (sim 09:23): travel time now 131.7 s > free flow 52.2 s, 48 queued (`06a-old-bridge-before.png`, `06-old-bridge.png`). **Pass.**
4. **Grayscale** (`07-grayscale-fit.png`, plus the ring/route in `02`):
   - The closed bridge is a hatch pattern and stays unmistakable in grayscale.
   - The ring (white outline) and the dashed near-white route are luminance-distinct from the grey roads. **Pass.**

Pass criteria: every suite is green, clippy is clean and the build is OK. Follow is smooth at 1×: 0 backward steps, median step 0.3–1.0 px. The ring and route are visible in grayscale.

## Housekeeping
- No source or test file was modified.
- `git status` is clean. The screenshots are in the git-ignored `.playwright-mcp/`.
- The scratch files live only under `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/g003d/`.
- The dev server on 5194 was stopped. Port 4243 was not touched.
