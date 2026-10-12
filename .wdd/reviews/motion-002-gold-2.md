# motion-002 Gold review r2

**Verdict: APPROVED**

Reviewer: fresh adversarial Gold subagent. I worked only from the artifacts: the ward spec, the epic, the supersessions, the Red verdicts r1–r6, Gold r1, the diff `6f223ad..HEAD` and the commands below.
Date: 2026-10-13. HEAD: `f4c50d1`, branch `public-main`.

Both Gold r1 rejection grounds are fixed and verified:
- **B1:** typecheck and build are green.
- **M1:** the presenter history is bounded without animation frames. I verified this in the browser, both single-view and in compare.

No new BLOCKER or MAJOR finding. The remaining minors are documentation or backlog items.

## Frozen tests: hashes and drift
| File | sha256 (measured) | Expected (Red r6-auto) |
|---|---|---|
| `web/tests/motion002.test.ts` | `bd9de6d6…4246` | match |
| `web/e2e/motion002.spec.ts` | `fdf90fee…68dd7` | match |
| `web/tests/motion002_gold.test.ts` | `bd9d0055…44d10e2` | match |

- `git diff 6f223ad..HEAD --stat -- web/tests web/e2e crates/*/tests` touches only two files:
  - `web/e2e/motion002.spec.ts`: the Red r5 amendment of test 9, plus the typing-only line 71 change approved in Red r6.
  - `web/tests/motion002_gold.test.ts`: new in Red r6.
- `motion002.test.ts` has no commits since 6f223ad.
- No `ALLOWLIST` change in the test diff.

## Commands run
| Command | Result |
|---|---|
| `pnpm -C web build:wasm` | ok |
| `pnpm -C web build` (tsc --noEmit + vite build) | **green**, exit 0, so B1 is resolved |
| `pnpm -C web test` | 30 files, 150 passed, 7 skipped (S1–S7), exit 0, 313 s |
| `cargo test --workspace` | 170 passed, 0 failed, 9 ignored (calibration, debug build), exit 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean, exit 0 |
| e2e, port 5194: motion002, motion, gold_city003, inspect, compare, gold_polish002, integration_polish | **41 passed, 1 skipped** (motion.spec 7, S8), exit 0, 7.8 min. Load 19.4 at start, 18.6 at end. |
| motion002.spec test 8 latency log | median 310.8 ms at 1×, 37.7 ms at 20× (bounds 600 and 120) |
| `motion.spec.ts -g tracked_car_moves_continuously --repeat-each=6` (Gold r1 m1) | **6/6 passed**, load 16.6–20.3, run in parallel with a browser smoke run |
| Mutant `keep_stale` in `presentation.ts` | gold test: 2 failed (without-rAF, compare). Killed. |
| Mutant `MAX_KEPT = 2` in `presentation.ts` | gold test: 3 failed (all `normal_playback_never_hits_the_bound`). Killed. |
| Mutant restore | file restored byte-exactly (sha `c80eb8dd…2d1c` before and after) |
| Node heap probe (temporary vitest file, deleted) | 127 retained frames: +11.1 MB at 2,000 cars and **+34.4 MB at 6,000 cars**. See n1. |

## B1 and M1: verification
- **B1:** `pnpm -C web build` passes. The spec change is the one-line typing amendment and no expectation changed.
- **M1, code:**
  - `Presenter.push` restarts the history at the newest frame once `frames.length >= MAX_KEPT` (128). This does not depend on rAF.
  - `CityRenderer.advance` now calls `p.advance` even with 0 cars.
  - In compare, a cap reset calls `clock.reset`, which sets the shared P to the minimum newest time over the sides, so A and B stay on one time.
- **M1, browser:** SwiftShader, 1280×800, River City at 20×. `requestAnimationFrame` was withheld for **30 s**, with forced GC every 2.5 s.

  | Case | Heap before | Heap after 30 s withheld | After resume | GC trace during the 30 s |
  |---|---|---|---|---|
  | Single view | 15.0 MB | 17.7 MB | 18.0 MB | flat sawtooth, 17–23 MB |
  | Compare | 16.6 MB | 17.9 MB | 17.7 MB | 20–30 MB, no growth trend |

  Gold r1 measured 14.7 → 70.4 MB in 20 s on the old code. After the compare case, both sides resumed on one tick: 19 samples, 0 mismatches.
- **The bound never fires in normal play (browser):**
  - Setup: 60× for 15 s, including a 2 s main-thread busy block, with P steps measured against the rAF timestamps.
  - 0 steps over 1.5 × rate × Δt; the maximum ratio was 1.31.
  - So no reset jump showed up, and catch-up after the stall stays within the clock's 1.5× rate limit.

## Findings

### n1: MINOR. The memory figure in the `MAX_KEPT` comment is about 3.5× too low
- `presentation.ts:322-326` says "128 frames hold ≈ 10 MB at 6,000 cars". Red r6-auto repeats it.
- I measured 34.4 MB for 127 frames at 6,000 cars; the per-frame `Map` of trip to record dominates.
- The bound is still real, and it caps memory far below the old unbounded growth.
- **Fix:** correct the figure (≈ 35 MB at 6,000 cars) or trim the per-frame cost.

### n2: MINOR. Gold r1 minors m2 and m4 remain open, and none is recorded
- **m2:** flags and shape come from the newest frame, while the pose comes from the lagged presentation. This is cosmetic and is not mentioned in `docs/known-issues.md`.
- **m4:** the latency numbers in `docs/performance.md` are not in `web/perf-results/motion002-before-after.json`.
- **Fix:** record both in known-issues or the backlog at the epic gate. Neither blocks.

### n3: INFO. Compare when B's renderer cannot be created
- `App.tsx:596`: if `makeBRenderer` returns null, B's presenter keeps receiving compare frames but is never advanced.
- It then hits the cap every 128 frames, and each reset snaps the shared P to the newest tick, so A would jump about every 2 s at 20×.
- This happens only after a WebGL context failure, which is already a degraded state. Recorded for completeness, not required.

### Resolved from Gold r1
- **B1:** fixed.
- **M1:** fixed.
- **m1:** kept frozen motion.spec test 8 passed 7 of 7 times at load 16–21, so it is stable.
- **m3:** dead `newestTick` was removed. Its replacement `retainedFrames()` is used by the gold test.

## Determinism, sim and Must NOT
- **Crates:** the only change is the read-only `Sim::trip_ids()` in sim-wasm. sim-core is untouched, the 16 B record is unchanged, and the golden hashes and determinism tests are green under `cargo test`.
- **No extrapolation:** P is clamped to `ceil` (the minimum newest time).
- **No weakened kept frozen test.**
- **No `no_orphaned_exports` allowlist entry.**
- **Epochs:** bumped on init, seek, branch, discard, view switch and compare on/off.
- No sim logic in the UI.

## Manual Smoke Test (performed by the reviewer)
- **Setup:** Playwright on SwiftShader, 1280×800, vite on port 5231.
- **Scripts:** `scratchpad/gold2/smoke.spec.mjs` (all steps, run 1) and `scratchpad/gold2/rerun.spec.mjs` (steps 2 and 6 again, with more samples).
- **Results:** `results.json`, `results-rerun-step2.json`, `rerun6.log`, and screenshots, all under `/private/tmp/claude-502/-Users-Z6DEC-kmddev-livingcity/e54ac286-31c4-4bad-9122-a1c59df1c97d/scratchpad/gold2/`.
- **Load:** 10–26 throughout.

| Step | Result |
|---|---|
| 1. 1×, junction (zoom ≥ 5) | **Pass.** City-wide audit of 1,765 cars: `heldInside 0`, 0 held-vs-held overlaps on other links, and 0 overlaps involving a curve. The 29 same-lane pairs are queue spacing (3.75 m centre to centre, cars drawn short when queued). A tracked car through a junction for 8 s: 0 back steps, `maxZeroRun 0`, `jumpAfterStall 0`, median step 0.63 m, max 1.61 m. Screenshots: `s1-junction-1x-a/b.png`. |
| 2. 20×, Follow | **Pass.** 0 back steps, 0 returns, ring 0 px and Follow centre 0 px in all three follows: run 1 (67 tracked samples), and rerun rounds 1 and 2 (159 and 49 samples). At 20× a trip ends within seconds of wall time, so no single car lasts 30 s; three cars were followed. Screenshot: `s2-follow-20x.png`. |
| 3. 20× → 5× → 60× | **Pass.** 209 samples across 5 links: 0 back steps, 0 P back steps, and **0** P steps over 1.5 × 60× × Δt (now measured against rAF timestamps). |
| 4. Close and reopen the bridge | **Pass.** `viol 0` over 413,586 car-frame checks, so no presented car enters the closed links 284 and 285. `heldPast 0`. 14 cars were leaving the closed link, which is allowed. On reopen, P was monotone (0 back steps). Screenshots: `s4-bridge-closed-20x.png`, `s4-bridge-reopened.png`. |
| 5. Pause and resume | **Pass.** 0 back steps, lag 0 while paused (61 samples). |
| 6. Seek, branch, compare | **Pass.** Right after the seek, `tickA = tick` and lag 0, so nothing slides from a stale position. Seek then play: 0 P back steps. Branch: 0 P back steps. Compare at 20×, 88 samples: 0 A/B tick mismatches and 0 back steps. Compare off: B released and A advances. Screenshots: `s6-compare-20x.png`, `s6-after-compare-off.png`. |

Pass criteria:
- [x] Coherent motion at 1× and 20×.
- [x] No held car inside a junction, and no overlap at queue fronts.
- [x] Latency measured and stated: 310.8 ms at 1× and 37.7 ms at 20× in the e2e run, 1–55 ms in compare at 20×.

## Housekeeping
- Temporary probe `web/tests/zz_gold2_probe.test.ts` was deleted.
- `presentation.ts` was restored byte-exactly after the mutants.
- `git status` shows only the pre-existing untracked `web/zz-alt-port.config.ts`, plus this verdict.
