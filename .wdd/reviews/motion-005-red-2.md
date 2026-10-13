# motion-005 Red gate, round 2

**Verdict: REJECTED** (0 blocker, 1 major, 4 minor)

Reviewer: a fresh adversarial Red reviewer (subagent), 2026-10-13. Commit under review: ec088cf (fixes in `git diff 80d529c ec088cf`).

## Hashes verified (sha256, worktree = ec088cf, clean)
- `web/tests/motion005.test.ts` `3e98a7331b664d49394bf682cdba4d9b6ce60e730942c83d4f79e1feb024cf9f`: matches.
- `web/e2e/motion005.spec.ts` `c3d021fcc9410b9f1a7c61d8f7336728d99d89a718fd43d435870c3dd39d5e2b`: matches. The same file was copied into every mutation tree (all 13 trees show `c3d021fcc9410b9f…`).
- `git diff 80d529c ec088cf` touches only the spec, the vitest file, the ward spec and the r1 review. There is no product change, so the r1 trees (`git archive` of 80d529c) are still valid bases. `diff -r` of each tree's `src` against the worktree shows exactly the one mutation per tree.

## Commands and results
- `pnpm -C web exec vitest run tests/motion005.test.ts`: 2 failed, as the spec predicts.
  - Test 7 fails at the missing `docs/verification/motion-005.md`.
  - Test 8 fails at the missing `web/perf-results/motion-epic-before-after.json`.
- Baseline e2e (scratch tree `m5red1/base`, port 5401, `playwright test e2e/motion005.spec.ts`), run in two lanes alongside the mutation runs, load 9.6 → 30.3 (14 cores):
  - **8/9 passed. `flow_queue_forms_and_releases` FAILED**: "1×: frames with queued cars: expected ≥ 20, received 13" (see minor 1).
- Diagnostic copy of flow 2 (`diagq.spec.ts`, which logs the frame counts), 3 sequential runs at load 14–24: **3/3 passed**.
  - 1×: 71/71, 68/68 and 64/64 frames had queued cars.
  - 20×: 35/64, 34/59 and 35/55.

  So the failure was too few animation frames under load, not a drained queue.
- Scripts and logs: `/private/tmp/claude-502/…/scratchpad/m5red2/` (`setup.sh`, `run.sh`, `all.sh`, `mkG2.sh`, `diag.sh`, `*.log`).

## Mutation table (current spec in every tree)
| id | mutation | flows run | result |
|---|---|---|---|
| mA | presentation off (P = newest frame) | 1, 4, 5 × both | **Caught at 1×** in all three ("13.22 m in 37 ms", "6.64 m in 49 ms", "17.90 m on B"). Not caught at 20×, as the spec now says. |
| mX | running ahead / extrapolation | 1, 4, 5 × both | **Caught 6/6** |
| mB | paused frames posted again | 4 × both | **Caught 2/2** |
| mC | held cars past the stop line | 2 | **Caught** (1×) |
| mD1 | closure ring fragment discarded | 3 | **Caught** ("1×: the ring on link 284 is drawn"): r1 MAJOR 3 fixed |
| mD2 | close entries missing from interventions | 3 | **Caught** |
| mE | old frames kept across a seek (clock reset) | 5 × both, **two runs** | **Caught 4/4, at 1× too** ("cars on their records' links after the running seek"): r1 MAJOR 1 fixed |
| mE2 | no reset on seek | 5 × both | **Caught 2/2** |
| mF | separate clock for B | 6 | **Caught** |
| mH | presentation frozen after the 2nd reset | 1 (1×), 5 × both, 6 | Flow 1 passed (expected: no seek). **Caught**: flow 5 at 1× ("the followed car moves on B"), flow 5 at 20× (a 586 m jump, incidental) and flow 6 ("A's presentation advances"). r1 MAJOR 2 fixed for A. |
| **mG** (new) | B's renderer never gets `setFrame` after compare starts | 6 | Passed. Not a real visual failure: B keeps the record count from the start of compare and still draws moving poses, so this mutation is too weak to count. |
| **mG2** (new) | `rendererB.current?.advance(now)` → `presentRef.current?.b.advance(now)`: B's presenter advances, but B's renderer never uploads poses | 6 | **NOT caught: passed.** The `compare-20x.png` screenshot shows **B's map with no cars at all** while A's are drawn. |

### On mE escaping at 1× (r1, orchestrator)
I could not reproduce the escape. Both of my mE runs failed at 1× and at 20× on the running seek. The mechanism explains why it can go either way:
- With mE, stale frames are drawn only if the presenter still holds ≥ 2 pre-seek frames when the seek frame arrives.
- At 1× (DT = 0.5 s), the presentation trails by 1–4 DT. If the seek takes longer than that lag, P catches up to the newest pre-seek frame, the history trims to one frame, and the clamped α = 1 draws the new frame correctly.

So whether mE is visible at 1× depends on the seek latency, and the test checks exactly what is visible. A pass at 1× means the screen was right. This is acceptable: no finding, and no fix needed.

## r1 findings: status
- **MAJOR 1** (seek while running): fixed. mE is caught.
- **MAJOR 2** (frozen presentation): fixed for A and for the tracked car on B. B's **picture** is still unverified (see MAJOR 1 below).
- **MAJOR 3** (ring tautological): fixed with pixels. mD1 is caught.
- **minor 1** (brackets): fixed with pixels in test 4. Test 1 no longer asserts the marker.
- **minor 2**: the spec's Motion bound paragraph now qualifies 20×. The Red-phase bullet "test 1 and test 5 fail if the junction jump comes back" is still unqualified (minor 4).
- **minor 3**: the spec says ≥ 20 with a SwiftShader justification. Test and spec agree.
- **minor 4**: fixed. The strict next-link rule plus a lag allowance; no false failures seen in 4 baseline/unaffected runs at 20×.
- **minor 5**: mostly fixed: scenarios, `frameBytes.definition`, per-metric table values, alternating `runs` with `load1min`. "Within one hour" is still unverifiable (minor 3).
- **minor 6**: fixed. 12 distinct PNGs, one line per case.

## Findings

### MAJOR 1: flow 6 does not require that B's map draws (or moves) any cars. B showing an empty map passes.
- **Evidence:** mutation mG2 (one line in `App.tsx:780`; B's presenter still advances, so `presentation.tickB` advances) passes `flow_side_by_side_compare` at both speeds.
  - Its screenshot `m5red2/mG2-out/motion005-flow-side-by-side-compare/compare-20x.png` shows the right half with roads and pins but **no vehicles**.
  - The spec concedes "B's cars have no hook, so B's motion is shown by its presentation tick and the shared clock". The tick advancing proves the clock, not the picture.
  - No other e2e spec looks at B's vehicles. A grep of `e2e/` finds no pixel or hook check of `canvas.city-b` cars, and `setDebug({hideVehicles})` only affects A (`App.tsx:1326`).
- **Why it matters:** "Both maps move together" is the user's smoke criterion and r1 MAJOR 2's explicit ask ("some car on each side moves"). This is the epic's integration ward, and the B renderer ↔ presenter wiring is exactly the kind of orphaned link the integration review must catch.
- **Fix:** pick one of these (both are feasible):
  - **(a) Pixels.** At each speed, take a screenshot clip of `canvas.city-b` at the start and at the end of the 3 s window, and build the mask of bright pixels (lum ≥ ~230; cars are white).
    - Require that the masks differ in ≥ N pixels (choose N from the baseline, e.g. ≥ 25 % of the baseline's count). Labels are static, so they cancel out.
    - Optionally also require the same on A as a reference.
  - **(b) Hooks.** Let Gold add `vehicleDrawB(record)` (and/or extend `setDebug.hideVehicles` to B), and apply A's "≥ 10 cars, ≤ 50 % still at the same place" rule to B as well, plus a shown-vs-hidden pixel difference on B.

  Verify that mG2 fails. Also try a "B frozen" variant: `rendererB.advance` called only once.

### minor 1: flow 2's non-vacuity floor counts absolute frames and fails under load
- **Evidence:** the baseline failed "1×: frames with queued cars: 13 < 20" at load ≈ 30. At 1× the queue cannot drain in 1.5 sim s: diagnostic runs show 100 % of frames with queued cars at 1×. So only ≈ 13 animation frames were produced in 3 s.
- **Fix:** sample until ≥ 30 frames *and* ≥ 3 s, bounded at 15 s. Alternatively require ≥ 20 frames with queued cars, or ≥ 50 % of the frames.
  - The 20× floor sits close to the edge already: 34–35 of 55–64 frames.
  - Under 2 lanes at load 30, the absolute rule false-fails a correct implementation.
- I rate this minor because it occurred once in 4 runs, only with a parallel suite. Fix it anyway: the Gold gate reruns at similar load.

### minor 2: no branch while running (scenario change with a full history)
The running-seek fix covers seeks. A branch is still only made while paused, after P has caught up, so a presenter that resets on epoch but not on a scenario switch with retained frames is caught only by luck (mE2-type). The user's task says "Seek **and scenario changes** clear stale motion history".
- **Fix:** if the UI allows it, after the branch press "A: original" ↔ "B" while running and apply the running-seek assertions: no tick from the other scenario shown, ≥ 80 % of cars on their record's links.

### minor 3: test 8 cannot verify "within one hour", and accepts a metric-less hardware group
- `runs` has no timestamps, so the spec's "within one hour" goes unchecked. Add a `startedAt` (ISO) per run and check that they span ≤ 60 min.
- `hardware` without `measured: false` passes when it has only a non-SwiftShader `renderer` string and no metrics. Require at least `renderIntervalMedianMs` there.

### minor 4: the Red-phase text still says test 1 and test 5 fail on the junction jump without qualification
The "Motion bound" paragraph is right, but the Red-phase bullet should say "at 1×". mA passes all three 20× cases, again in this round.

## What is good
- Every r1 MAJOR is fixed with an observable (pixels, the running seek, progress of the drawn car).
- The mutation coverage is broad: 10 of 11 realistic regressions are caught, mE at both speeds in this round.
- Flows 1 and 3–6 were stable under load ≈ 20–30.
- The static tests now pin scenarios, interleaving and per-metric table values.
