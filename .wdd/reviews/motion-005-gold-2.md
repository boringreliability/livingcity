# motion-005 Gold gate, round 2: REJECTED

**Verdict: REJECTED.** 0 BLOCKER, 2 MAJOR, 5 minor.
- Reviewer: a fresh adversarial Gold reviewer (subagent), 2026-10-14.
- Reviewed: `2284e32` (pushed to `origin/main`) against the r1 verdict at `18c0f74`, and the Red approval at `23da733`. The diff since r1 is `04d9492` (S9 and CI) plus `2284e32` (the r1 fixes).

Both r1 MAJORs were addressed as described:
- the frame-transfer numbers are now right;
- S9 was applied exactly as authorized, and the Web job is green on GitHub.

Making the Web job green let the **E2E job run on CI for the first time since motion-001, and it fails: 8 of 156 tests fail.**
- Seven of the failures share one product cause that I reproduced locally to the pixel: the bottom-band legend gets stuck in its "stacked" placement and covers the map.
- The eighth failure is motion-005's own `flow_queue_forms_and_releases`.

The epic's completion criterion ("green on GitHub Actions") is therefore still unmet.

## Commands and results
Load (1 min) was 7–20 during the local runs.

| What | Result |
|---|---|
| sha256 `web/tests/motion005.test.ts` | `e7d3031a…af00`: matches the Red snapshot |
| sha256 `web/e2e/motion005.spec.ts` | `2589ddf4…d18d`: matches the Red snapshot |
| `git diff --stat 23da733 2284e32 -- web/tests web/e2e` | only `web/tests/motion002.test.ts` (S9) |
| S9 body check | Lines 530–582 (skipped `3b`) are byte-identical to lines 586–638 (`3b-ci`) (`diff`: identical). The timeouts are `600_000` → `1_800_000`, and the SUPERSEDED comment points to S9. The supersessions row, the authorization file, the ward Must-NOT and the README all match the authorization. In `ci.yml`, deploy has `if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'` and Web has `timeout-minutes: 60`. |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web exec vitest run` | 33 files; 162 passed, 8 skipped (295 s). The extra skip is the old `3b`; `3b-ci` passes. |
| `playwright test e2e/motion005.spec.ts` | 9/9 passed (2.7 min, load 7.6 → 18.7) |
| Frozen visual and motion subset: `motion002.spec`, `motion004.spec`, `look.spec`, `motion.spec` | 21 passed, 1 skipped (6.7 min, load 16 → 20) |
| Product diff since r1 | one comment line in `App.tsx:758` |

## CI: run 38475090804 on `2284e32`: **failure**

| Job | Result | Duration |
|---|---|---|
| Rust (clippy, tests debug + release) | success | 1 min 29 s (22:03:21 → 22:04:50 UTC) |
| Web (wasm, typecheck, Vitest, build) | **success** | **11 min 20 s** (22:03:21 → 22:14:41) |
| E2E (Playwright, SwiftShader) | **failure** | **39 min 47 s** (22:14:43 → 22:54:30); Playwright: 146 passed, **8 failed**, 2 skipped (39.3 min) |
| Deploy | skipped (push event: correct under the S9 deploy change) | |

Details of the Web job:
- Vitest took 633.4 s: 162 passed, 8 skipped.
- `tests/motion002.test.ts` took 633.1 s (15 tests, 1 skipped).
- **`3b-ci visual_rule_sweep` took 567.3 s.** That is below the old 600 s on this runner. Earlier runs exceeded 600 s, so the runner time varies, and the 1800 s limit gives about 3.2× margin.
- The Web job used 11 of its 60 minutes.

The E2E job used 40 of its 60 minutes. The job log is in `scratchpad/m5gold2/e2e-job.log`, and the artifact is in `scratchpad/m5gold2/ci-artifact/`.

The 8 failures:
1. `city.e2e.spec` `full_demo_on_river_city`: a hover predicate timed out (30 s).
2. `gold5.spec` `fix G1: a hovered road gets a lighter grey outline at fit zoom`: halo pixels 0 (≥ 60 required).
3. `inspect.spec` `road_panel_real_stats`: `clickableRoadPoint` returned null.
4. `look.spec` `labels_follow_camera_while_paused`: the labels moved 0 px (−30 expected). The drag did not pan.
5. `look.spec` `congestion_reads_in_grayscale`: the measured point is not on the canvas.
6. `motion004.spec` `wide_zoom_shows_major_routes`: bridge link 288 has a cross-section width of 0.
7. `motion005.spec` `flow_queue_forms_and_releases`: "queues released within 15 sim min (from 6)": 4 > 3.
8. `timeline.spec` `timeline_bar_shows_window_and_memory`: `covered` = 46 (0 required).

The last green E2E on CI was `639d6d4` (motion-001 Gold, run 38184697031). Every run since then stopped in the Web job.

## Findings

### MAJOR 1: on CI the legend is stuck "stacked" over the map, which fails 7 frozen e2e tests. The product defect is an epic regression that is invisible on macOS.
**Evidence: CI against local.**
- **On CI** (`ci-artifact/motion005-flow-queue-forms-and-releases/queue-formed.png`, 1280×800):
  - the legend spans x 562–1263, **y 638–688**;
  - the metrics panel's right edge is at about 543.
- **Locally** (`docs/verification/motion-005/queue-formed.png`), the legend sits beside the metrics at y 700–750.

**The hysteresis band.**
- `ui/bottomBand.ts` stacks the legend when the gap is below 12 px, and unstacks it only when the gap is at least 24 px.
- On CI the gap is about 19 px, inside that band. Once the legend has stacked (for example while a wider fallback font is shown before Inter loads), it never unstacks.
- On macOS the measured gap is 26.6 px, only 2.6 px above the unstack threshold.

**Reproduced locally** (`scratchpad/m5gold2/stack_repro.mjs`, results in `stack_repro.json` and screenshots `as-is.png` and `ci-like-stuck-stacked.png`). On a dev server (port 5391, stopped afterwards) at 1280×800 under SwiftShader:
- I widened the metrics panel by 20 px, so that the legend stacks.
- Then I set it to +9 px, giving a gap of 17.6 px, as on CI.
- **Result:**
  - the legend stayed `stacked` at **[562, 638, 1264, 688]**, CI's exact rectangle;
  - the `timeline.spec` coverage predicate gives **`covered` = 46**, CI's exact value;
  - the drag start of `look.spec` at (640, 660) hits `SECTION.panel legend stacked` instead of `canvas.city`. That is why the drag did not pan.

  The unmodified page gives `stacked: false`, gap 26.6, `covered` 0.

**Why it matters.**
- The stacked legend covers roads at the bottom edge of the city. `timeline.spec` pins this as required: "the bar and the moved panels never cover the city".
- On Linux (or any machine whose font metrics land the gap in 12–24 px), users get a legend over the map.
- The other failing tests hover, click or sample pixels at map points that now lie under the legend: 1, 2, 3, 5 and 6 above. The mechanism is the same, but I verified it only for `look.spec` and `timeline.spec`.

**Likely origin.** motion-004 lengthened the legend labels, for example "Selected / followed (halo, ring)" → "(halo, brackets)". E2E was green on CI at motion-001 and has not run since.

**Fix.** This is product behaviour, so it needs a failing regression test first. Then do one of:
- make the stacked placement reserve its height in the fit insets (or never cover the city);
- re-check the placement after the fonts load without the sticky hysteresis;
- shorten the legend so that it fits with margin.

Then get the full CI E2E green. Do not change any of the 7 frozen tests.

### MAJOR 2: motion-005's own `flow_queue_forms_and_releases` fails on CI, because its release oracle is fragile when the queue at the reopen is small
- The test sums `linkQueued` over the pinned links at the reopen (`q0`) and requires ≤ 0.5·q0 within 15 sim min.
- Before the reopen, the test spends 3–10 s of wall time per speed sampling at 1× and 20× (wall-clock dependent). By the time of the reopen the pinned queues had mostly drained on CI, so q0 = 6, and ordinary stop-and-go traffic left 4 > 3.
- The test passed locally 3 times: twice in r1 and once here. It is the ward's own Red-approved test, and it is red on the CI that is the epic's completion criterion.
- The test is frozen since the Red approval. A more robust oracle needs the user's authorization and a new Red gate, for example:
  - take q0 at the closure's peak;
  - require a minimum q0;
  - compare with the open-bridge baseline.

  Otherwise escalate it as a known CI flake. **Do not edit it in place.**

### minor 1: `docs/performance.md` § Epic motion: "The p95 values move by one 16.7 ms step either way" is false for baseline 20×
before-2 is 166.7 ms against 66.7 ms after, a 100 ms difference (raw `epic-ab/before-2/baseline-20x.json`).

### minor 2: `docs/performance.md`: "≈ 1.56 MB/s, as motion-001 measured" misattributes the number
- motion-001 measured 1,650,041 B/s (performance.md line 103; S1: "1.65 MB/s").
- 1.56 MB/s is this run set's SwiftShader value; the GPU runs gave 1.60–1.62 MB/s.

### minor 3: `docs/known-issues.md:31` cites the replaced run set
- It says "0.49–0.57 s at a load of about 40" and "about 0.28 s" on the GPU.
- The committed JSON now has 0.44–0.47 s (at a load of about 20) and 0.22–0.28 s on the GPU.

### minor 4: `docs/known-issues.md:137` still describes a Diagnostics "frames/s" row that does not exist
This is the same root as r1 minor 1, which was fixed in `demo.md` only.

### minor 5: the ward's Gold notes are partly stale
- "all runs within 17 minutes": the new set spans 21:32–21:57 UTC, about 25 min including the GPU runs.
- "vitest: 162 passed, 7 skipped": it is now 8 skipped.
- The GitHub duration "recorded after the push" is still unrecorded. Use the numbers above (Web 11 min 20 s; `3b-ci` 567 s; E2E 39 min 47 s, red).

## r1 findings: resolution

| r1 | Status | Evidence |
|---|---|---|
| MAJOR 1 (probe missed the vehicle `ArrayBuffer`) | **Resolved** | `epic_probe.mjs:25` counts `ArrayBuffer.isView(v) \|\| v instanceof ArrayBuffer`. Every buffer in `FrameMessage` is top-level (`protocol.ts:180–226`), so no nested buffer is missed. Every value in the committed JSON equals the raw data (`epic-ab/*/probe.json`, `*/baseline-*.json`, `*/stress-5x.json`, `*/frame-cost-baseline.json`, `hw-ab/*.json`): transfer 1,685,706 / 1,652,999 → 2,044,364 / 2,047,856 (+22.6 %); GPU 1,687,718 / 1,691,123 → 2,062,045 / 2,062,103 (+22.1 %); paused 1,578,974 / 1,548,308 → 0. This agrees with r1's independent ~1.71 → 2.08 MB/s (+21 %) and paused ~1.67 MB/s within load variation. The tables in `performance.md` match the JSON (apart from minors 1–2). |
| MAJOR 2 (CI red, E2E never ran) | **Partly resolved** | S9 was applied as authorized, and the Web job is green. E2E now runs and is red (MAJOR 1 and 2 above). |
| minor 1 (demo "0 frames/s") | Resolved in `demo.md` and in the ward smoke step | The `known-issues.md:137` remnant is minor 4. |
| minor 2 (orphaned exports) | Accepted as a known issue | `known-issues.md:33`; the comment in `App.tsx` is fixed. |
| minor 3 (after commit) | Resolved | JSON `after.note` and the `performance.md` intro |
| minor 4 (p95 row) | Resolved | The row was added; see minor 1 for its interpretation. |

## Observations (no finding)
- Native step is 0.0158 / 0.0157 ms after against 0.0149 / 0.0145 ms before, which is +7 % in both after runs. The r0 set (0.0148–0.0152, equal before and after) supports the doc's "noise, no change claimed".
- `frameBytes` grows by +6.9 kB per frame, and the whole message by +7.3 kB. The 0.2 kB consequence-data figure in the docs is approximate (vehicle count differs by about 5 between runs).
- The Red r2 info item still stands: confirm in the Cloudflare dashboard that the Pages project has no Git auto-deploy.
