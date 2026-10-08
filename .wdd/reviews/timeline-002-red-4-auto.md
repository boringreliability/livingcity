# timeline-002 Red r4: APPROVED (convergence rule)

**Why the round ran.** r1, r2 and r3 rejected the gate. The 3rd rejection was escalated, and the user chose option 1: a fresh r4 under the convergence rule.

**r4 verdict** (`timeline-002-red-4.md`): APPROVED-WITH-FIXES.
- 0 BLOCKER. 1 MAJOR, a verified test gap: no test branched from an original that has removals, so the mutants `b_remfull`, `b_remempty` and `b_logsworld` survived.
- 1 MINOR: add the ward row.
- No contract defect and no disagreement.

**Incorporated verbatim:**
- test 19, `branch_truncates_the_removal_log` (verified by the reviewer on the reference implementation: 19/19 pass, and it kills all three mutants);
- ward row 19, with `estimated_tests: 19`.

**Gate history:**
- r1 REJECTED: 2 MAJOR (spawns mixed with demand; gridlock removals in a cohort).
- r2 REJECTED: 1 MAJOR (removed spawns).
- r3 REJECTED: 1 MAJOR (branch inside an evicted window). Escalated; the user chose r4.
- r4 APPROVED-WITH-FIXES: 1 MAJOR, the removal log in branches.

**Verdict: APPROVED.** The tests are frozen at this commit.
