# core-003 Red gate: auto-approved after round 7

## Basis
User decision 2026-10-06 (answer "1" to the escalation after round 6): from the 4th round on, a gate whose only BLOCKER/MAJOR findings are verified-fixable **test gaps** is approved once the reviewer's fix tests are incorporated verbatim, without another round. A BLOCKER, a contract defect, a finding without a verified fix, or a disagreement escalates to the human.

## Round 7 result (`core-003-red-7.md`)
- BLOCKER: none.
- MAJOR: 1, F1 `forced_from_from` (the forced reroute's start node was untested), classified by the reviewer as a **test gap**, with a verified fix (test 36; passes on the reference, fails on the stubs, clippy-clean, kills 9 mutants).
- Contract defects: none.
- MINOR: `forced_fail_switch` (verified one-line fix incorporated into test 35), plus the previously accepted bookkeeping/ordering/equivalent survivors.

## Action
- Test 36 appended verbatim from the reviewer's `fixes7_tail.rs`. The test-35 `route_switches == 0` assert was added.
- core-003 Red **approved**. The test files are frozen at the commit recording this note.
