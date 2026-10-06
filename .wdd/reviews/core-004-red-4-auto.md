# core-004 Red gate: approved after round 4 (user decision + convergence rule)

## Round 4 result (`core-004-red-4.md`)
- BLOCKER: none.
- MAJOR M1 (test gap): lowering the speed with a backlog was untested. Verified fix G11 incorporated.
- MAJOR M2 (spec defect): "a speed-lowering clamp is not a cap event" only held at that instant, so `behind` would blink for 1 s. **Escalated to the user**, who chose option (ii) on 2026-10-06: no clamp is a cap event until a plan has left the backlog below the new cap. The spec was updated and the verified test G11b incorporated.
- MINOR: G12 (cap events inside the grace period) and G13 (setSpeed crediting at the old speed) incorporated, plus the wording "since the last plan or speed change" and "`setRunning(true)` while running is a no-op". Accepted survivors: C18, H19, H24, R2 (equivalent), R8 (unreachable), C27/C28 (now decided by the spec but untested; low impact).

## Basis for approval
The user's convergence rule (2026-10-06): from round 4 on, a gate whose remaining MAJOR findings are verified-fixable test gaps is approved once the fixes are incorporated. The only spec defect was decided by the user.

## Action
core-004 Red **approved**. The test files are frozen at the commit recording this note.
