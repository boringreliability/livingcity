# motion-002 Red review, round 5: amendment to e2e test 9 `gpu_draws_where_presentation_says`

**Verdict: APPROVED, with one required fix test (F1).** This is round 5, so the convergence rule applies: F1 is a verified, fixable measurement gap, not a contract defect.

**Scope**
- Frozen: `web/e2e/motion002.spec.ts` sha256 `09e7f795…5cf5e8d` (6f223ad).
- Amended: sha256 `606593d0…4492bc` (93a7297), checked against the working tree. Only test 9 changed (`git diff 6f223ad 93a7297`), and so did ward row 9.

## Verdict on the questions asked

**1. Is it at least as strong as the frozen test? Yes, once F1 is fixed.**
- These checks are unchanged:
  - the paused checks on every held car (own link, `stop ≤ length − 0.5`, `ŝ ≤ stop`, `next = NO_NEXT`);
  - the running 20× check.
- The old-point check is still exact for the old rule. With a single-lane next link, `linkScreenPoint(next, 0)` is the old rule's `vehiclePosition(B, 0, 0)`.
- I verified this with GPU mutants (M3, M4 below): both fail the test.

**2. Does dropping the follower filter weaken anything? Yes, but only the positive check (F2), and that is covered.**
- The amendment's argument is right for the negative control. A follower is behind the head on its own link and never reaches the next link's start.
- It does not hold for the *positive* check. That is the reason the filter was added (r1 M6, r2 R4).
- Under the old-rule GPU (M4), the frame-position followers still cover the presented point of heads whose stop line is at `len − 6.25`, so those heads pass the positive check.
- The old GPU is now caught only by the negative control: 0 of 8 old points were empty under M4, and 2 of 8 under M3, where at least 4 are required. That is enough, but the stated rationale should say so.

**3. Can the panning loop measure the wrong car? Not observed.**
- `drawnOf` matches on (link, lane, queued, `s ≥ length`). At most one record per (link, lane) can be held at the link end.
- Lanes 0 and 1 of links 12, 39 and 52 resolved to different page points 14.1 px apart.
- Paused records are stable, so matching by record index would be exact (m1, optional).

**4. Can it pass trivially? No.**
- Both mutants fail.
- The stated reason is consistent with what I saw: 0–3 of the visited heads per run had no follower within 9.5 m.

## Findings

### F1: MAJOR (required fix). The luminance criterion fails on the correct implementation.
**What happens.** The amended test **failed in 5 of 5 runs** against the Gold implementation at 93a7297:
- the original spec once, failing at car 2 with Δ = 8.6;
- an instrumented copy 4 times, using soft asserts so that every visited car is logged. The copy is identical apart from logging.

In all of these runs the car **is** drawn at its presented point:
- The shown 3×3 luminance is 175.9 every time. That is the orange held-car colour, also visible in screenshots of 80×80 clips.
- But the road under it differs from place to place. Link 6's stop point is light road, RGB (180,166,141) and luminance 167.3, so Δ = 8.6.
- At link 26 the sample point lands partly on a white dash, giving Δ = −17. Link 28 gives Δ = 24.
- Any car-sized luminance close to the background fails the |Δ| ≥ 30 check.

**Why it now fails so often.** The frozen version has the same flaw. Visiting cars one by one makes it fail far more often, because link 6 (`stop = len − 2.25`) is usually among the first candidates.

**Required fix.** Use a colour distance in place of luminance:
- Average the 3×3 RGB.
- Define `cdist = max over r,g,b of |shown − hidden|`.
- Positive check: `cdist ≥ 30`.
- Old point counts as empty when `cdist < 30`.
- Update the ward's row 9 text to match: "colour difference (max channel) ≥ 30".

**Verified in the copy.**

| Run | Result |
|---|---|
| Unmutated, run e | **passed** (link 6: cd = 90; minimum over all visited cars 90) |
| Unmutated, run f | **passed** (minimum 90) |
| M4 (old-rule GPU) | **failed**: 4 per-car positive failures (cd 0 / 8.7 / 0 / 7.7) and 0 of 8 old points empty |
| M3 (raw-frame GPU) | **failed**: 5 per-car positive failures and 2 of 8 old points empty |

The colour metric also sharpens the negative control. Under M4, link 26 had old Δlum = 0, but cdOld = 102.

### F2: minor. The positive check no longer discriminates for heads that have a close follower.
**Evidence.** Under M4, the positive check passed for 4 of 8 visited cars (links 16, 22, 26, 49, all with `stop = len − 6.25`). Followers drawn at their frame `s = len − 7.5 ± 1.8` cover that point. The test still fails through the negative control.

**Recommendation.** Not required, because the negative control catches the old GPU exactly.
- Count a visited car as *discriminating* when no other car in the same link and lane has a frame `s` within ±2.6 m of ŝ.
- Require at least 2 discriminating cars.
- Observed counts per run are 2–4 (the `stop = len − 2.25` links 2/4/6/8). Under M4, exactly those cars failed the positive check.

At the least, correct the comment and ward wording: the follower argument applies to the old point only.

### m1: minor (optional). Match by record index in `drawnOf`.
`drawnOf` could use the record index of `c` instead of matching on (link, lane), because records do not change while paused. I saw no wrong match.

### Note
- `git status` now also shows `web/perf-results/*.json` as modified. I did not cause this: I did not run perf, and none of my runs used the worktree's `src`.
- All mutants and instrumentation lived in an untracked copy at `<scratchpad>/webm`, with `node_modules` symlinked and served on port 5195.
- The worktree is unchanged apart from this file. `web/test-results/` is gitignored.

## Commands and results

| Command | Result |
|---|---|
| `shasum -a 256 web/e2e/motion002.spec.ts`; `git show 6f223ad:… \| shasum` | 606593d0… / 09e7f795… (matches the stated hashes) |
| `cd web && node_modules/.bin/playwright test -c zz-alt-port.config.ts e2e/motion002.spec.ts -g gpu_draws --reporter=line` (port 5194, load ≈ 18–20, full suite running on 5190) | **1 failed**: "held head car 2 drawn at its presented point", received 8.58 (1.3 min) |
| Copy, unmutated, probe with soft asserts, runs 0/a/b/c/d | probe 0 passed. a failed (link 26, Δ 17). b, c and d failed (link 6, Δ 8.58 each time; c also link 28, Δ 24). Shown luminance was 175.9 for every car. |
| Copy, `MUT=4` (GPU draws every car by the old `vehicleDrawPosition(frame s, next)`) | failed: 3 positive failures, 0 of 8 old points empty |
| Copy, `MUT=3` (GPU draws every car at its raw frame position) | failed: 5 positive failures, 2 of 8 empty |
| Copy with the F1 RGB fix: unmutated × 2, MUT 4, MUT 3 | passed, passed, failed, failed (details above) |

---

## Applied under the convergence rule (round 5, 2026-10-13)

APPROVED with one required fix, so it is logged as `-auto`:
- **F1:** test 9 compares the mean RGB of 3×3 pixels; a car is drawn when the largest channel difference (shown vs hidden) is ≥ 30, an old point is empty when it is < 30.
- **F2 (applied):** ≥ 2 visited cars must have no same-lane car whose frame `s` lies within ±2.6 m of their ŝ; such cars are visited first. The comment and ward row 9 are corrected.
- **m1 (applied):** the visited car is found by its record index.

Run after the fixes: test 9 passed twice (2.3 min, 2.2 min) against the Gold implementation (port 5194).

**Frozen (sha256):**
- `web/tests/motion002.test.ts`: `bd9de6d61ae82aafafb8a0e83ac6b9024a8eda83983d5f3a396a88c2667b4246` (unchanged since Red r4)
- `web/e2e/motion002.spec.ts`: `9859df9eae47bb50b11bc4b91e37317454f5d707a7f4cc15ca2d053e082d5d09`
