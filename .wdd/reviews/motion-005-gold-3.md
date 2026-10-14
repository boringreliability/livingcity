# motion-005 Gold gate, round 3: REJECTED

**Verdict: REJECTED.** 0 BLOCKER, 1 MAJOR, 2 minor.
- Reviewer: a fresh adversarial Gold reviewer (subagent), 2026-10-14.
- Reviewed: `9dc3f3e` (pushed to `origin/main`) against the r2 verdict at `2284e32`. The diff since r2 is `c4f8408` (legend fix, regression test, doc minors) plus `9dc3f3e` (S10).

Both r2 MAJORs are addressed in substance, and the legend fix is sound. But S10 breaks motion-005's **own** frozen static test `tests/motion005.test.ts` › `epic_wiring_and_docs`. The Web job on GitHub fails on it, so E2E was skipped again. Neither r2 fix has been verified on CI, and the epic's completion criterion ("green on GitHub Actions") is still unmet.

## Commands and results
Load (1 min) was 11–17 during the local runs.

| What | Result |
|---|---|
| sha256 `web/e2e/motion005.spec.ts` | `8ea41fe3…cb2b`: matches the S10 Red r2 snapshot |
| sha256 `web/e2e/motion005_legend.spec.ts` | `6db415cc…833d`: matches the legend Red r1 snapshot |
| sha256 `web/tests/motion005.test.ts` | `e7d3031a…af00`: matches the Red snapshot |
| `git diff 2284e32 HEAD --stat` (tests) | only `web/e2e/motion005.spec.ts` (S10: the old test is `test.skip`, the new `_s10` test is appended, and the body before the release section is byte-identical) and the new `motion005_legend.spec.ts`. No other frozen test changed. |
| Product diff | `ui/bottomBand.ts`: `nextStacked(gap) = gap < 12` (the hysteresis is gone); `App.tsx:658` calls it without the previous state |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web exec vitest run tests/motion005.test.ts` | **1 failed, 1 passed**: `epic_wiring_and_docs`: "S10: the skip points to supersessions.md" |
| `playwright test e2e/motion005.spec.ts e2e/motion005_legend.spec.ts e2e/fonts.spec.ts` | 15 passed, 1 skipped (the superseded `flow_queue_forms_and_releases`), 3.3 min. The frozen `fonts.spec` passed 5/5, `legend_unstacks_whenever_it_fits` passed, and `flow_queue_forms_and_releases_s10` passed. |

## CI: run 38634393020 on `9dc3f3e`: **failure**

| Job | Result | Duration |
|---|---|---|
| Rust (clippy, tests debug + release) | success | 2 min 2 s (20:42:57 → 20:44:59 UTC) |
| Web (wasm, typecheck, Vitest, build) | **failure** | 14 min 13 s (20:42:57 → 20:57:10). Vitest: 32/33 files, **1 failed**, 161 passed, 8 skipped (809.5 s). The failure is `tests/motion005.test.ts` › `epic_wiring_and_docs`. |
| E2E (Playwright, SwiftShader) | **skipped** (needs Web) | — |
| Deploy | skipped | — |

- In this run `motion002.test.ts` took 809.1 s, and `3b-ci visual_rule_sweep` took **727.7 s**. That would have failed the old 600 s limit; the 1800 s limit leaves about 2.5× margin. S9 is confirmed necessary.
- The failed-step log is in `scratchpad/web-failed.log` (this reviewer's session).

## Findings

### MAJOR 1: S10 fails motion-005's own frozen test 7, which turns the Web job red on CI, so E2E never ran
- `tests/motion005.test.ts:30–33` (frozen, `e7d3031a…`) checks every supersession row. The frozen test's `test.skip(` line must have the string `supersessions.md` within the **3 lines above it** (`lines.slice(at - 3, at + 1)`).
- In `web/e2e/motion005.spec.ts:448–452` the S10 comment has four lines. The pointer `.wdd/memory/supersessions.md` is on line 448, which is **4 lines** above the `test.skip(` on line 452. The match fails:
  ```
  AssertionError: S10: the skip points to supersessions.md: expected '// instantaneous queue counts (CI: 6 …' to match /supersessions\.md/
  ```
- I reproduced this locally, and it is the only failure in the CI Web job.
- **Consequences:**
  - The E2E job was skipped. The legend fix (r2 MAJOR 1: 7 frozen e2e tests red on Linux) and `flow_queue_forms_and_releases_s10` (r2 MAJOR 2) are **unverified on GitHub's runners**, which is where both problems appeared.
  - Neither the S10 Red r1 nor the S10 Red r2 review ran `tests/motion005.test.ts`.
- **Fix.** Reflow the S10 comment so that `supersessions.md` falls within the 3 lines above the `test.skip(` line. For example, move the pointer to the comment's last line, or shorten the comment to ≤ 3 lines. Do not touch `motion005.test.ts`.
  - The change is comment-only, but it changes the Red snapshot of `motion005.spec.ts` (`8ea41fe3…`). Record the new hash with a short Red re-check, so the next Gold reviewer can verify it.
  - Then push and get the **whole** CI green, E2E included. Classify any E2E failure against `docs/known-issues.md`.

### minor 1: the S10 "after" window starts 5 sim min after the reopen, not right at it
- The authorization (`authorization-2026-10-14-s10-queue-release.md`) and the supersessions row say: "the mean queued on the pinned links over 2 sim min after the reopen".
- The test measures that window only after the 5 sim min bridge-flow window, so it covers minutes 5–7 after the reopen.
- This is defensible, and arguably a stronger "queue does not grow" check after the transient. But the wording in the authorization, the supersessions row and `known-issues.md` should say "over 2 sim min, 5 sim min after the reopen", so the record matches the test.

### minor 2: without the hysteresis, a metric value that gains a digit can move the legend when the gap is near 12 px
- This is not a feedback loop. Stacking only changes `bottom` (`styles.css:777`, `.legend.stacked { bottom: 112px }`, and 138 px under 959 px), so it cannot change the horizontal gap, and the placement is a pure function of the current widths.
- On a machine whose settled gap is within a few px of 12, the legend will jump up or down whenever, for example, ACTIVE goes from 999 to 1000 (the values are `tabular-nums`, but the digit count changes the width). Locally the gap is 26.6 px, and r2 measured about 19 px on CI, so this was not observed.
- Mention it in `known-issues.md` (or reserve a minimum width for the metric values) when the fix above is made. It does not block.

## r2 findings: resolution

| r2 | Status | Evidence |
|---|---|---|
| MAJOR 1 (legend stuck stacked on Linux CI) | **Resolved in code, not yet verified on CI** | `nextStacked` depends only on the gap. Stacking moves the legend only vertically (the CSS above), so there is no feedback, and dropping the hysteresis is sound. The regression `motion005_legend.spec` drives gaps of 12.5/15/19/23 px from a stacked start and passes. The frozen `fonts.spec` passed 5/5. Smoke at 1280×800: gap 26.6 px, `stacked` false, legend at [562, 700, 1264, 750], beside the metrics, both before and during the closure. The CI E2E proof is missing (MAJOR 1 above). |
| MAJOR 2 (fragile release oracle) | **Resolved via S10, not yet verified on CI** | The authorization is recorded with the verbatim question and answer. The supersessions row has all 7 columns and the old hash `2589ddf4…` (= r2's snapshot). The ward Must-NOT lists S10. The old test is `test.skip` with a SUPERSEDED comment, and its body before the release is byte-identical in `_s10` (diff checked). The release checks both Main Bridge links for `linkCounts` > 0 within 5 sim min, then queue mean after ≤ mean before + 2, plus the ring gone. It passed locally. Red r2 APPROVED it (both mutants fail). The pointer placement fails test 7 (MAJOR 1). |
| minor 1 (p95 wording) | Resolved | `performance.md`: "within one 16.7 ms step … except one before run at baseline 20× (166.7 ms …)" |
| minor 2 (1.56 MB/s attribution) | Resolved | "≈ 1.55–1.58 MB/s in this run set; motion-001 measured 1.65 MB/s" |
| minor 3 (known-issues lag numbers) | Resolved | 0.44–0.47 s at a load of 7–22; GPU 0.22–0.28 s |
| minor 4 (frames/s row) | Resolved | The entry is marked resolved: "since motion-002 a paused host sends no frames … the panel has no frames/s row" |
| minor 5 (stale ward notes) | Resolved | The notes now say about 25 min (21:32–21:57), 8 skipped, and the GitHub numbers of run 38475090804 |

## Manual Smoke Test (performed by this reviewer)
- **Setup:** headless Chromium under SwiftShader, 1280×800, dev server on :5441 (stopped afterwards).
- **Script:** `scratchpad/smoke/smoke.mjs`. Screenshots and a video are in `scratchpad/smoke/`.

| Step | Observed |
|---|---|
| Legend | gap 26.6 px, beside the metrics, not stacked (start and during closure) |
| 1. Follow at 1× / 20× (zoom 3.1, per-frame `trackedDraw` for 4 s) | 1×: 154 frames, max world step 0.64 m, 0 backward steps. 20×: 155 frames across 3 links, max step 15.2 m (within the spec bound), 0 backward steps |
| 2. Close the Main Bridge at 20× | 2 rings, queue pins with up to 14–18 queued within seconds, and the hatched closed bridge with queued cars visible (`03-closed-queues.png`). Reopen: rings 0; within 5 sim min, bridge link counts reached a max of 27 / 9. |
| 3. Pause | `framesReceived` 1790 → 1790 over 3 s. Road 284 selected while paused, and the road panel shows. Resume: frames flow again (→ 1871). |
| 4. Rewind 2 × −1 min, branch (B) | tick 3088 → 2849; branch created |
| 5. Compare side by side | 2 canvases; `comparison().tick` = 2849 for both A and B; the table reads "sim time 00:23:44 (both)" (`08-compare.png`) |
| 6. Docs | `performance.md` § Epic and `known-issues.md` match the JSON and the r2 corrections |

The smoke script could not read the Diagnostics render numbers. The panel showed only its toggle, so this is not evidence either way. The e2e `flow_pause_inspect_resume` (1× and 20×) covers it and passed.

## What is needed for APPROVED
1. Reflow the S10 comment in `motion005.spec.ts` (comment-only), and record the new snapshot hash.
2. Run `pnpm -C web exec vitest run tests/motion005.test.ts` locally until it is green.
3. Get the full CI green on GitHub, including the E2E job. That is the first CI proof of the legend fix and of `_s10`.
4. Optionally, fix the wording in minor 1 and add the known-issue for minor 2.
