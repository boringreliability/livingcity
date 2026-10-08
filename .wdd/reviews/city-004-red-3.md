# city-004 Red review, round 3 (test amendment during Gold)

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 3 MINOR)

Reviewed: the amendment to `web/e2e/look.spec.ts` tests 9, 10, 11, 12 and 14 (`git diff 56179c5 HEAD -- web/e2e/look.spec.ts`), against the frozen version at 56179c5, `.wdd/wards/city/ward-004.md` (Tests table rows 9–14), `.wdd/wards/core/ward-004.md` row 31, `.wdd/reviews/core-004-red-3.md` (m3/m4, H21), `web/tests/review3.test.ts` (G4b), CLAUDE.md and `city-004-red-2.md`.

## What I ran
- `git diff 56179c5 HEAD --stat`: the only test file touched is `look.spec.ts` (21 lines). The other ward-file change is the Gold FIT_INSETS refinement, which is outside this review (see MINOR 3).
- `pnpm -C web exec vitest run tests/review3.test.ts -t G4b`: passes. The G4b contract is in force.
- `pnpm -C web exec playwright test e2e/look.spec.ts`: **9/9 passed** (48.7 s).
- `pnpm -C web exec playwright test e2e/look.spec.ts --repeat-each 3 -g "hatch|barriers|halo|grayscale"`: **15/15 passed** (2.3 min). Test 14 took 36.0–36.1 s each run, so its timing is stable.

## 1. Is the G4b claim true? Yes
- `core-004` ward row 31 is approved: "`G4b paused frames show the unchanged state…` — a close issued while paused is not in `closed` until resumed".
- It came from core-004 Red r3 m4/H21. That review explicitly called a pending closure listed in `closed` while paused a defect, because the frame would disagree with its own records.
- The frozen tests 9–12 called `pause()` and then `closeMain()`. `closeMain` itself polls until `snapshot().closed` contains both Main Bridge links. Under G4b that poll can never succeed while paused, so it times out.
- Frozen test 14 had the same problem: `measure()` pauses, then `closeMain()` was called before Space.
- The frozen tests therefore contradicted an earlier approved contract, and no correct implementation could pass them. An amendment was necessary. Changing G4b instead would reopen a resolved core-004 defect (H21).

## 2. Same behaviour, same invariants? Yes
| Test | Change | Assertions | Ward row still satisfied? |
|---|---|---|---|
| 9 | `pause` moved after `closeMain` | unchanged (0 yellow at junction, > 5 at mid) | yes: "Main Bridge closed, paused, vehicles hidden" |
| 10 | same | unchanged (Δx ≈ 37, > 20 yellow, maxDiff ≤ 2) | yes |
| 11 | same | unchanged (white run ≥ 3 per closed link) | yes |
| 12 | `pause` moved after the panel close and Escape | unchanged (> 20 before, ≥ 90 % after) | yes: only east→west closed, west→east selected |
| 14 | close after Space; adds `poll running == true` | unchanged (≥ 0.6 fill, ≥ 0.55 in measured frame, width +1, light +10) | yes: "before" is still measured before the closure, on a paused frame |

- No expectation, tolerance or threshold changed, and no assertion was removed.
- The amended tests still measure a paused, static canvas. All pixel reads happen after `pause()` plus a 300 ms settle, as before.
- The amendment does not make any test pass trivially. The hatch, barrier and congestion pixels can still only come from the renderer drawing `closed` links and occupancy.
- Test 14 got slightly stronger: it now asserts that the sim is running before it issues the closure.

## 3. New flakiness? None found
- **Tests 9–12:** vehicles are hidden (`hideVehicles`), so the few extra ticks between the close and the pause cannot put vehicle pixels in the clips. Those ticks run at the default speed, just after tick ~10, with occupancy near zero.
- **Occupancy-driven road styling:** congestion could in principle change road width and lightness during that window. It cannot produce hatch-yellow (blue < 90), and at near-zero occupancy it does not change anything.
- **Test 11 (white run):** the near-white threshold (lum ≥ 220) is unaffected for the same reason.
- **Test 10:** it compares two paused frames with each other, so the pause point does not matter.
- **Test 14:** the closure tick moves by a handful of ticks, from "first resumed tick" to "the first tick after Space plus one poll". Red r2's `occ2.mjs` covered closure ticks 451–560 with the 0.55 guard holding in every run, so this shift is well inside the analysed range. The three repeat runs agree.
- **Focus:** `pause()` blurs before pressing Space, so focus left on the "Close the main bridge" or "Close link" button cannot swallow the key. Test 12 also blurs and presses Escape before pausing.

## MINOR (non-blocking)
1. **Tests 9–11 no longer exercise "closure while paused" at all.**
   - That is correct under G4b, but no e2e test checks the G4b contract in the browser: pause, close, `closed` unchanged, resume, closure appears within a few ticks.
   - It is covered only by the Vitest host test.
   - core-004 Red r3 handed this browser check to the Gold reviewer. The city-004 Gold reviewer should repeat it by hand, since the UI button now sits in a new panel.
2. **The amendment comment is repeated in three tests.** The comment in tests 9–11 is copied verbatim. A one-line note in the `closeMain` helper would be cleaner. Cosmetic.
3. **Out of scope, flagged for Gold:** the ward diff also changes the specified `FIT_INSETS` from `{140, 24, 96, 24}` to `{120, 24, 120, 24}`, labelled "Gold refinement".
   - This is a spec change, not a test change, so it was not part of this review.
   - The Gold reviewer should confirm two things: that no frozen test pinned the old values, and that the top-row district labels (Red r2 MINOR 3) still clear the control panel with a 120 px top inset.
