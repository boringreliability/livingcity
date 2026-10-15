# motion-005 Gold gate, round 4: APPROVED

**Verdict: APPROVED.** 0 BLOCKER, 0 MAJOR, 1 minor.
- Reviewer: a fresh adversarial Gold reviewer (subagent), 2026-10-15.
- Reviewed: `45b42b5` on `public-main`, against the r3 verdict at `9dc3f3e` and the fixes in `f66e2f6` and `45b42b5`.
- The convergence rule was not applied. There was no blocker, contract defect, unverified finding, or disagreement.

## Hashes

| File | sha256 | Expected |
|---|---|---|
| `web/e2e/motion005.spec.ts` | `ef21bac22b01ddb21695494d90c85d63b68dee7f6be18e65bde4f2bd8ab22dd7` | S10 row after the comment-only fix. Unchanged since `f66e2f6`. At `9dc3f3e` it was `8ea41fe3…` |
| `web/tests/motion005.test.ts` | `e7d3031affb29dc5f5a4fe8dc0320e985f1c3b16b70fab6ee6c04853b044af00` | Unchanged since r3 |
| `web/e2e/motion005_legend.spec.ts` | `6db415cce3388fe64bc2d44005cbb26c1d31517dcb33a741e2f9d7c49410833d` | Unchanged since r3 |
| `web/e2e/motion.spec.ts` | `2df0b3440aa76e5bfe71afc98ae78228f68d7a6a15d1383c10916f980c8cd668` | S11 Red snapshot. At `f66e2f6` it was `c7f494ec…` |

`45b42b5` changes no `web/src` and no Rust. The skipped `closed_road_marked_at_every_zoom` body is byte-identical to `f66e2f6` once `test.skip(` is put back to `test(`. `supersessions.md` is on the line immediately above that skip, and the S10 pointer is on the line above its skip. The replacement keeps the three zooms and `c.bright - b.bright >= 20`.

## CI: run 38738516921 on `45b42b5`: success

https://github.com/boringreliability/livingcity/actions/runs/38738516921

| Job | Result |
|---|---|
| Rust (clippy, tests debug + release) | success |
| Web (wasm, typecheck, Vitest, build) | success. Vitest 162 passed, 8 skipped |
| E2E (Playwright, SwiftShader) | success. **155 passed, 4 skipped, 0 failed** (48.9 min) |
| Deploy | skipped (manual `workflow_dispatch`) |

This is the first green E2E job after the legend fix and S10. On this run: `legend_unstacks_whenever_it_fits` 5.5 s, `flow_queue_forms_and_releases_s10` 49.6 s, `closed_road_marked_at_every_zoom_s11` 38.3 s.

The four skips are superseded tests:

- `gpu_draws_cars_where_the_cpu_says` (S8). `docs/known-issues.md` lists i2 as resolved.
- `closed_road_marked_at_every_zoom` (S11). The replacement passed in the same job.
- `flow_queue_forms_and_releases` (S10). The replacement passed in the same job.
- `fix G4: closing the main bridge changes its grayscale appearance` (city-005, `web/e2e/review1.spec.ts`).

## Commands and results

| What | Result |
|---|---|
| `pnpm -C web exec vitest run tests/motion005.test.ts` | 2 passed, including `epic_wiring_and_docs` |
| `pnpm -C web exec playwright test e2e/motion005.spec.ts e2e/motion005_legend.spec.ts e2e/motion.spec.ts -g "closed_road_marked_at_every_zoom_s11\|flow_queue_forms_and_releases_s10\|legend_unstacks"` | 3 passed in 1.2 min. SwiftShader |

## Manual smoke test (performed by this reviewer)

Headed Chromium on the GPU: ANGLE Metal, Apple M4 Pro, 1280×800. Not SwiftShader. Two recordings (junction and queue, 4.4 MB; pause, rewind and compare, 2.8 MB) plus per-frame samples at 120 fps.

| Step | Observed |
|---|---|
| 1. Junction 1× | 292 frames, 1 link change (38 → 284), max step 0.33 m, 0 backward, 99 % of frames between sim frames |
| 1. Junction 20× | 182 frames, 1 link change, max step 6.33 m, 0 backward, 85 % between frames |
| 2. Close at 20× | 2 closure rings; longest pin 14 queued. At 1×, 175 frames with queued cars, 0 past the stop line. At 20×, 108 such frames, 0 past the stop |
| 2. Reopen | Rings 2 → 0. Over 12 s / 1474 frames the pin totals went 21 → 14 |
| 3. Pause 1× and 20× | `framesReceived` +1, tick unchanged, `renderFrames` +240. A road was selected. The paused car moved 0 m. Resume: 1× max step 0.29 m; 20× two link changes, max step 7.54 m; no backward steps |
| 4. Rewind 2 min and branch | Tick 1961 → 1722. Scenario B, `branchTick` 1722. No same-tick jump |
| 5. Compare 1× and 20× | Every frame had equal ticks, one presentation time, and equal cameras. Ticks rose. Generated trips matched (6 and 6, then 293 and 293). Incomplete and unserved were on the panel |
| 6. Docs | The six flows match `docs/verification/motion-005.md`. The epic table in `docs/performance.md` matches the JSON. Legend at 1280×800 was not stacked (gap 27 px) |

No product change in `9dc3f3e..45b42b5`. The compare samples kept identical generated counts on A and B.

## Findings

### minor 1: the verification doc still described the pre-S10 release oracle
- `docs/verification/motion-005.md:10` said that after the reopen the pinned queues fell to ≤ 50 % within 15 sim min.
- S10, the authorization, and `docs/known-issues.md` say the mean is taken from 5 to 7 sim min after the reopen.
- Nothing failed. After this verdict the sentence was updated to state the S10 check. Comment and doc lines only.

## r3 findings: resolution

| r3 | Status | Evidence |
|---|---|---|
| MAJOR 1 (S10 comment fails `epic_wiring_and_docs`, E2E skipped) | Resolved | Pointer is on the line above the skip. Vitest `epic_wiring_and_docs` passed locally and on CI. E2E ran and passed |
| minor 1 (S10 window wording) | Resolved in `f66e2f6` | The authorization, the supersessions row and `known-issues.md` say 5 to 7 sim min. The verification-doc sentence is minor 1 above |
| minor 2 (legend near 12 px) | Resolved as a known issue | Noted in `known-issues.md`. Smoke gap was 27 px, legend not stacked |
