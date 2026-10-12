# motion-001 Gold gate, round 1

**Verdict: APPROVED**

Reviewer: fresh adversarial Gold-gate subagent, 2026-10-12. Worktree HEAD 639d6d4 (branch public-main). Machine load during the review was 10–24 (`uptime` 1-min). No timing failures occurred, so nothing had to be re-run alone.

## Frozen tests (hashes verified)
- `web/tests/motion001.test.ts`: `45f4fcb51bbd7bd91c59c810163a578cab3b8d16fc12c671a30fdeff32ce4e15`. This matches the Red-r2 freeze.
- `web/e2e/motion001.spec.ts`: `32eef04abf16649b712039a8e76d4776114cf5320fe65261bd941cf9ee51e55a`. This matches the Red-r2 freeze.
- `git diff 985c316..HEAD -- web/tests web/e2e crates`: **empty**. No test or Rust file changed after the Red approval.
- `git diff 19e9fbf..HEAD -- web/tests web/e2e crates` touches only these files:
  - the two new motion001 files;
  - `review2.test.ts` G4 and G8, and `review3.test.ts` G4b. Each of these changes is only `test(` → `test.skip(` plus a SUPERSEDED comment that points to S1–S3. No assertion was weakened in place.
- Kept-frozen tests are green in the suites listed below: host F3/F6, polish005 6/7/7b, polish006 4/4b, compare 9, timeline 2/4/8, gold_fixes F1, gold_city003 m8, and city.e2e `diagnostics_panel_toggle`.

## Outputs, checked against the code (`git diff 985c316..HEAD`)
- **Dirty marking.** `host.ts:585` sets dirty for every message except `returnBuffer`. It is set before the `try`, so ignored and failing messages count too (for example `inspectVehicle` while comparing, errors, or a seek outside the window).
- **Posting rule.** The post condition in `iterate` (`host.ts:683`) is `dirty || settle || (running && t - lastPost >= 16)`.
  - A handler post does not clear dirty, so an `iterate` frame always follows a handled message.
  - A paused, clean host posts nothing, and it does not call `encode_frame`, because `postFrame` is the only place that calls it.
  - Comparison posts are unchanged: on pause (handler), on compare-on and seek (`afterPairJump`), and every 500 ms only when `n > 0`.
- **Settling frame.** `settleAt = t + WINDOW_MS + 16` is set when `iterate` sees running → paused. It is cleared on resume and cleared after it fires, so it fires once per pause.
  - Pauses made inside a handler (seek, branch, viewScenario, discard, compare-on) are caught too, because the transition is read from `clock.isRunning` in `iterate`.
  - Stale `settleAt` across seek or branch: a re-pause pushes the time later, and a resume nulls it. I found no path that leaves a stale value which matters.
- **Bounded clock window.** `clock.ts` `report` trims with the same `<= t - WINDOW_MS` rule as `status()`, so the achieved rate is unchanged. `windowSize()` exists.
- **Pools.**
  - Each side has a LIFO pool, scanned from the newest end. A buffer of the exact size is spliced out, which removes it on use.
  - A push over `POOL_MAX = 4` shifts the oldest out.
  - A returned buffer with `byteLength 0` is rejected.
  - A buffer from a stale world is rejected. A missing `world` counts as the current world.
  - Malformed returns now throw inside the `try`, so they are reported as errors and no longer poison the pool. Before this ward a non-buffer in the pool would have halted the sim in `postFrame`.
- **World generations.**
  - `init` bumps both sides (`host.ts:183-184`).
  - `branch` bumps B (`:431`), which also covers a replace, since replace goes through branch.
  - `discardBranch` bumps B (`:474`). This answers Red n2 by reading the code.
  - Pools are cleared on each of these, and B's pool is cleared on compare-off while viewing A.
- **Client.**
  - `createWorker` option.
  - A `WeakMap<ArrayBuffer, world>` filled in `onmessage` per delivered frame.
  - `world` is added inside `send`, so the polish005 7b literal `send({ type: 'returnBuffer', buffer, scenario }` is kept.
- **Diagnostics while paused.** `App.tsx:669-672` bumps a version state whenever the render-stats cache refreshes and Diagnostics is open. This follows Red n8: it is the cache refresh, not an independent timer.
- **Test hook.** `framesReceived` is counted in `onFrame` and covers both sides.
- **Measured after.** I re-ran the probe myself (see below) and got the same result as `paused-after.json`.

## Hazards probed (no MAJOR found)
- **Warm-up end and ready.** `init` sets dirty. `iterate` returns early during warm-up without clearing it, so the first iteration after `ready` posts a frame. Commands deferred during warm-up are covered the same way.
- **Restart.** `restart_is_clean` (e2e) passed.
- **debugTrap and fatal.** dirty is set, the next iterate traps, and the fatal error is posted. A halted host is quiet, as before.
- **Seek, branch, view and discard.** Each handler posts a frame itself (`afterJump`/`afterPairJump`), and a dirty `iterate` frame follows.
- **Seek while comparing and paused.** In the browser it gave 4 frames (2 pairs) and then quiet.
- **A command on B below its head.** It goes through the dirty path, so a frame shows the new `headTick`. `road_panel_in_the_past_branches_and_b_past_edits_b` passed.
- **Speed change while paused.** dirty → a frame shows the new target.
- **Behind and cap state.** These are sticky for `WINDOW_MS`, and the settling frame lands after that.
- **Cross-scenario and stale reuse, checked in the browser.** I instrumented `Worker.postMessage` and ran these steps:
  1. warm up;
  2. pause and seek;
  3. branch and compare;
  4. run 2 s;
  5. discard and run.

  Results:
  - There were 1,295 returns.
  - Every return carried the world and side of its frame: `0:1` 1,179 and `1:2` 116, equal to the frames delivered.
  - No return lacked a world, and no detached buffer was returned.
- **Memory.**
  - Pools are ≤ 4 per side.
  - Entries in the WeakMap die when the buffer is transferred back.
  - `frameTimes` and the clock reports are trimmed to 1 s.

## Determinism
- `git diff 19e9fbf..HEAD -- crates` is empty.
- `cargo test -p sim-core --release --test polish_005_perf`: 5 passed (the golden hashes hold).
- The host's tick and command timing are unchanged. Test 4 passes, and in the browser a closure issued while paused applied at tick 1802 (paused at 1801).

## MAJOR findings
None.

## MINOR findings
- **m1. The client remembers only `world` per buffer, not `scenario`** (`client.ts:43,49-52`). The ward's Output says the client remembers both. The side comes from App's `returnBuffer(f.vehicles, f.scenario)` calls (`App.tsx:392,415,422-423,431,479`). These always pass the frame's own side, so the behaviour is equivalent. A future caller that omits `scenario` would fall back to `viewed` on the host. Test 7's client leg passes.
- **m2. `init` does not reset `wasRunning`/`settleAt`** (`host.ts:169-205`). If a running host is re-initialised and the new world comes up paused, one extra settling frame goes out about 1 s after `ready`. This is harmless.
- **m3. The worker frames/s figure while paused shows the last frame's count** (`perf.framesPerS`). It reads 1 after the settling frame, not 0. The frame that answers a pause still counts the frames of the last running second. It is cosmetic.
- **m4. The Diagnostics refresh re-renders the whole `App` component about twice a second while the panel is open** (`App.tsx:671`). This is acceptable; a scoped panel component would be cheaper.
- **m5. Port mismatch in the docs.** The reproduce line in `docs/performance.md` uses `http://localhost:5173`. `paused-after.json` was measured against 5391 (the implementer's dev server), and the probe accepts any base URL. This is cosmetic.
- **m7. CI is red on one E2E test.** `motion.spec.ts` `gpu_draws_cars_where_the_cpu_says` failed in CI and is not attributable to this ward (see § CI). Re-run the job before the epic gate.
- **m6. Second frame after a handler post.** The second, `iterate`-driven frame after a handler that already posted (seek, branch, compare) is by design (Red n6). The `b` key's two close commands produce a single answering frame, which is fine.

## Manual Smoke Test (Playwright MCP, own dev server on :5411, 1280×800, headless Chromium)
1. **Play, then pause.**
   - `framesReceived` went 4 → 5 (the settling frame) within 1.8 s and stayed at 5 over the next 3 s. The tick stayed fixed at 1801.
   - Achieved speed read "0.5× of 20×" 0.4 s after the pause and **"0.0× of 20×" about 1.8 s after it** (step 5 ✓).
   - The worker posts nothing after the settle (probe below).
2. **Interactions while paused.**
   - Pan (drag) moved the camera ✓, and wheel zoom changed the zoom ✓.
   - Hovering a road and then clicking it (link 32) filled the "Selected road" panel with numbers: lanes 2, 50 km/h, 700 m, 15 vehicles, travel time 54.1 s ✓.
   - After zooming to 2.17×, clicking a car tracked trip 4220. The "Selected vehicle" panel showed "Cathedral Quarter → Old Exchange, driving, 52 km/h …" ✓.
   - Each interaction cost about 1 frame. The sim stayed paused at the same tick.
3. **Close the main bridge while paused.**
   - Pressing `b` produced "Main bridge closed — reopen (pending)". `closed` stayed `[]` at tick 1801, and 0 frames followed over 2 s.
   - Space (Play) applied the closure in 38 ms. At tick 1802 `closed` was `[284,285]`, and "(pending)" was gone ✓.
4. **Compare while paused.**
   - I sought back, branched B with `b`, ran B for 1.5 s, paused and pressed "Compare side by side". Over 3 s after a 2 s settle, **0 frames** arrived ✓. Both sides were at tick 1742: A had `closed []` and B had `[284,285]`.
   - A seek while comparing gave a pair at the new tick, then quiet.
   - I left compare and re-entered it. Both sides drew, with linked cameras (screenshot checked) ✓.
   - Resuming in compare gave 112 frames in 1 s ✓.
5. **Achieved speed.** It reads 0.0× about 1 s after a pause, also in compare ✓.

Pass criteria: paused frame production is 0 (measured), all interactions work while paused, and all suites are green with frozen tests unchanged apart from S1–S3 ✓.

## Measurement re-run
I ran `node web/scripts/paused_probe.mjs http://localhost:5411 /tmp/…/paused.json check` (load 13.2 → 24.4):

| Run | frames/s | bytes/s |
|---|---|---|
| default demand | 0 | 0 |
| `?demand=5` | 0 | 0 |
| compare | 0 | 0 |

This is identical to `paused-after.json`. The before-numbers in `docs/performance.md` match `paused-before.json` as cited in the ward.

The docs (`known-issues` e2, e3 and k9 resolved; `architecture` § "From epic polish", where the e2/e3 ids are kept; `performance` § Paused work) describe the implementation accurately.

## Commands and results
| Command | Result (load) |
|---|---|
| `shasum -a 256` on the two frozen files | both match |
| `git diff 985c316..HEAD -- web/tests web/e2e crates` | empty |
| `pnpm -C web typecheck` | clean (10.0) |
| `pnpm -C web test` | 28 files, 134 passed, 3 skipped (G4, G4b, G8) (10.0) |
| `vitest run motion001 host polish005 review2 review3` ×3 | 33 passed and 3 skipped each time |
| `pnpm -C web build` | built |
| `playwright test e2e/motion001 city.e2e integration_polish compare timeline --reporter=line` | **31 passed** (7.5 min, load 13.8 → 18.9) |
| `cargo test -p sim-core --release --test polish_005_perf` | 5 passed |
| paused probe (own server) | 0 / 0 / 0 |
| CI run 38184697031 (639d6d4) | Rust ✓, Web (wasm, typecheck, Vitest, build) ✓, **E2E ✗: 125 passed, 1 skipped, 1 failed** (`motion.spec.ts` `gpu_draws_cars_where_the_cpu_says`); Deploy skipped |
| `playwright test e2e/motion.spec.ts -g gpu_draws_cars_where_the_cpu_says --repeat-each=3` (load 5.8 → 16.9) | **3/3 passed** locally |

## CI
The E2E job of run 38184697031 is **red on one test**: `e2e/motion.spec.ts:89` `gpu_draws_cars_where_the_cpu_says`, at line 150. It reports "straight points left empty: expected ≥ 2, received 1", which means only 3–4 curved cars were in view.

**Why I do not attribute it to motion-001:**
- The test is from polish-003 and was not modified.
- It passed 3/3 locally at HEAD.
- Rendering is continuous rAF (`App.tsx:637-691`) and does not depend on worker frames.
- `ExtrapolationClock.frame` (`render/motion.ts:111`) sets extrapolation to 0 as soon as the frame that answers the pause arrives. That frame is the dirty frame, so it arrives immediately, as before.
- Every later paused frame, old or new, carries the same tick and the same records. The picture after a pause is therefore identical with or without the 16 ms paused frames.
- The test is pixel- and density-based. It runs at `?demand=3`, and the pause tick depends on wall time. With only 3–4 curved cars, one occupied straight point fails it.

So I read this as a flaky test, not a regression. This is a MINOR for the implementer (**m7**):
- re-run the failed E2E job, which I did not do because a green rerun would trigger the Cloudflare deploy job;
- log the flake in `docs/known-issues.md` if it recurs;
- do not present the epic gate on a red CI.
