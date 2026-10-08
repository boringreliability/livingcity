# city-005 Red r4: APPROVED (convergence rule)

**Basis.** The r4 reviewer (`city-005-red-4.md`) found 0 BLOCKER and 1 MAJOR (C1). C1 is a contract defect: the `timerResolutionMs` rule never stopped under fake clocks, and the frozen host suites would hang. Because it was a contract defect, the round was escalated. On 2026-10-08 the user accepted the exact spec amendment proposed by the reviewer (option 1). It changes no tests.

**Incorporated:**
- **C1 (spec):** resolution reads are bounded by 50 ms of `perfNow()` time or 100,000 reads, whichever comes first, giving 0 if no positive difference is seen (ward-005 § Red-phase contract details).
- **MINOR 1:** test 7 ties `diag-render` loosely to `diagnostics().render.intervalMedianMs` (within max(2 ms, 25 %)).
- **MINOR 2:** the tautological `tickMsMaxFrame ≥ tickMsMean` check is removed from `perf.spec.ts`.
- **MINOR 3:** the CDP session used for `headless` is detached.

**Gate history:**
- r1 REJECTED (1 BLOCKER, 4 MAJOR);
- r2 REJECTED (1 MAJOR);
- r3 REJECTED (2 MAJOR). This was the 3rd rejection, so it was escalated; the user chose a fresh r4;
- r4 escalated on C1, and the user accepted the amendment.

**Verdict: APPROVED.** Tests are frozen at this commit.
