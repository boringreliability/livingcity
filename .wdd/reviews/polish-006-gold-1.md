# polish-006 Gold review 1

**Verdict: APPROVED** (no MAJOR findings; MINORs below)

Reviewer: fresh adversarial Gold subagent. HEAD 09b566b, Red approval commit df34e97. Date 2026-10-10.

## Frozen tests
- `web/tests/polish006.test.ts` sha256 = `8621b611bba81748bb13e395f2d2763f72cc98f0ff76a0ef02322edfc8fce44c`: matches.
- `web/e2e/integration_polish.spec.ts` sha256 = `b9b5fdc47ac59262535a4a463dc1882cf75b2b047606cd93c08a78d891fa9719`: matches.
- `git diff df34e97..HEAD --stat` touches no file under `web/e2e/`, `web/tests/` or `crates/*/tests/`. The only `.wdd` change is ward-006's status `approved → gold`.
- Rust changes are rustfmt only. I ran `rustfmt --edition 2021` on the df34e97 version of every changed `.rs` file (16 files) and compared it with HEAD. 15 files are identical. `timeline.rs` differs only in the k4 doc comment ("derived (empty in the snapshot): router; index (… rebuilt … by `World::restored`)"). The comment is accurate: `World::snapshot` sets `index: SlotIndex::default()` (world.rs:763) and `restored` rebuilds it (world.rs:826).

## Commands and results (with load)
| Command | Result | Load (1-min) |
|---|---|---|
| `cargo test --workspace` | all green, 0 failed | 8.2 → 7.5 |
| `cargo test -p sim-core --release --test polish_005_perf` | 5 passed (golden_hashes_hold included) | 7.5 |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean | 7.5 |
| `pnpm -C web build:wasm`, then `pnpm -C web test` | 26 files, 129 tests passed | 6.2 |
| `pnpm -C web typecheck` / `pnpm -C web build` | clean / built | 5.9 |
| `pnpm -C web exec playwright test` (full, excludes @perf) | **120 passed, 1 skipped** (the pre-existing `test.skip` review1 G4), 18.8 min | 4.8 at start, 15–19 during, 19.6 at end |
| test 1 log line | medians pause 108, play 102, seek 95, compareOn **280**, compareOff 15 ms | 19.1 / 18.9 |
| `git status` after everything | clean (perf-results untouched; I did not run e2e:perf) | n/a |

## Checks
- **Responsiveness approach (App.tsx).** I timed it with getContext and loseContext instrumentation and a longtask observer at `?demand=5` (probe.cjs, load 12–14, one page):
  - Branch: the spare B context is made 138 ms after the B key, a 614 ms task.
  - Compare on: no long task, so the spare is used.
  - Compare off: loseContext runs about 600 ms after the click (after the first single-view draw) and takes 617–626 ms. The new spare follows: getContext, 145–168 ms.

  So the switch really is drawn within 300 ms. The GPU waits come right after it and are disclosed in docs/known-issues.md § Epic gate and in docs/architecture.md. The work is not hidden in a dishonest way: the user does see the switch at once.
- The snapshot() microtask release makes test 17 (compare.spec) see the release at once. I checked the real path without a hook read between the switch and the check: the removed B context is lost after 3 s (`true`).
- No "Too many active WebGL contexts" or CONTEXT_LOST messages appeared in the smoke run (only SwiftShader ReadPixels perf warnings). The cleanup of the client effect releases the spare and the pending Bs on restart. A spare is never made while fatal (`fatalRef` guard).
- The 2×-wide backing store keeps the right aspect, because the projection uses the camera's CSS viewport and u_pxPerM is in CSS px. The A half looks the same as the B half in a screenshot (1b-compare-picked.png). Picking on B works (clicking a B road opened "Link 0 (B)"). Labels show on both halves.
- **f6 (host.ts:411–427).** The host points at A (`viewed=0`, `branchTick=-1`, `comparing=false`) before B is freed. On failure it pauses, `afterJump(a)`, and rethrows to `handle()`, which reports the error.
- **k5.** Pools are cleared on init, on compare-off with `viewed===0`, on replace and on discard.
- **k2/k3.** Restart clears selection, tracking, Follow, the pending seek, confirm, mainPending, the held pair, comparison and guide. The alert goes on the first frame of the new world. Play, Speed and the bridge are disabled with "The simulation stopped: restart it to continue".
- **j3.** A focused pressed "?" shows an outer accent ring with a gap (`box-shadow 0 0 0 2px bg, 0 0 0 4px accent`) around the inner white outline. That is a shape difference, not only a colour (screenshot j3-focused.png).
- **Docs.** The numbers in performance.md match the JSONs:
  - stress-5x: tickMsMean 0.1605, on-network median 5699 / max 5909, active 27083, waiting 21174, frameBytes 106362.
  - The before value 0.248 is df34e97's stress-5x.json from 2026-10-08.
  - frame-cost.json matches the table.

  known-issues.md covers every backlog id. I spot-checked k4, k5, f6, e5–e8 and j2 (tooltip "the ? (Guide) button"). architecture.md now says "1.5 × the expected sim advance" and that `nextLinks` is copied, which host.ts:545 confirms.
- **Wiring.** `CityRenderer.element`, `haltedReason`, `restarting`, `fatalRef` and `shownCompare` are all consumed. The JSX B canvas is gone, and `canvasBRef` now points at the spare's element, which the pointer effect and the hook use. I found no orphaned export or prop.
- **Invariants.** No sim logic moved to the UI thread. The golden hashes hold. No per-frame JSON was added.

## Manual smoke test (smoke.cjs and probe.cjs, Playwright Chromium + SwiftShader, vite on port 5391, load 10.9–15)
1. **Guide flow with the pointer: OK.** I closed the main bridge, which ticked steps 1 and 2 after 3 sim min. Then I paused, clicked the track to rewind to tick 902, and clicked the bridge button, which made branch B. Compare showed 2 canvases (A 1280×800 backing at 640 CSS px, B 640×800). After compare-off, all 5 guide steps showed ✓.
2. **Keyboard only: OK.** b closed the bridge, Space paused, Tab reached the Timeline slider, ← rewound, b branched. Tab reached "Compare side by side" and Enter toggled compare on and off.
3. **`?demand=5` at 20× (5,532 on the network): OK.** Pause 51 / 348 ms, play 19 ms, seek 123 ms, compare-on 119–189 ms, compare-off 100–105 ms. Play pressed right after compare-on took 99–103 ms. Play right after compare-off: see m1.
4. **debugTrap while comparing, then Restart: OK.** The alert read "The simulation stopped: simulation halted: unreachable". Play, Speed and the bridge were disabled with the reason. After Restart: running, compare off, no branch, nothing closed, 1 canvas, guide reset, bridge enabled. Branch and compare worked again afterwards (2 canvases).
5. **known-issues.md: OK.** Every id has an honest status, and § Epic gate lists e2, e3, i1, i2, i3, i5 plus the new GPU-wait item.

## MAJOR
None.

## MINOR
- **m1, post-switch stall.** In my multi-tab smoke run (two other app pages still open in the same browser), a Play pressed right after compare-off took **2.9 s** in 2 of 3 trials, with 2.9 s long tasks. In a single isolated page the tasks were 0.6 s release + 0.15–0.6 s spare. known-issues says "0.1–0.8 s". That holds for one page, but with more GPU contention the stall is several times longer. Suggestion: state it as "≥ 0.6 s, more under contention", or skip remaking the spare right after compare-off (wait for idle, `requestIdleCallback`).
- **m2, shortcuts bypass the halted controls (App.tsx:786–800).** While halted, `+`/`-` still change the speed: the disabled Speed select went from 20× to 60×, and that speed carried into the restarted world. Space still calls `setRunning` on the dead client. k3 asks for disabled controls, which they are, but the shortcuts are not gated on `fatalRef`. The timeline buttons, Compare and Discard also stay enabled while halted.
- **m3, hook side effect (App.tsx:916).** `snapshot()` performs real work: it releases pending B contexts. Production timing then differs from what tests observe. It is documented in the code and the real path does release (verified), but a test hook should not have side effects.
- **m4, late-returned B buffers (host.ts:580).** A B buffer returned after compare-off (posted before it) is pushed back into `pools[1]` after the clear, and can be reused on the next compare. It is bounded and harmless, but "B's pool is cleared" is only true for buffers already returned.
- **m5, stray doc comment (renderer.ts:558).** The doc comment "Release the WebGL context itself …" now sits above the new `get element()`, and `loseContext()` lost its doc.
- **m6, alert wording.** The alert still reads "The simulation stopped: simulation halted: unreachable", which is redundant (part of the k3 backlog wording complaint).
- **m7, test 1 margin.** compareOn's median was 280 ms at load 19 in the full e2e run (119–189 ms at load 13). It passes, but close to the 300 ms limit on a loaded machine.
