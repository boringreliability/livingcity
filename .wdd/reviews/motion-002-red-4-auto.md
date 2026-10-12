# motion-002 Red gate, review 4

**Verdict: APPROVED, with one required fix test (convergence rule, round 4: the only MAJOR is a verified-fixable test gap)**

Reviewer: a fresh adversarial Red reviewer (subagent), 2026-10-12. Worktree HEAD 8a167ac (public-main). Under the user's convergence rule this approval is conditional: fix test F1 below must be added before Gold starts, and it does not need another Red round. Log it as `motion-002-red-4-auto` if your process needs that name.

## Files under review (sha256)
- `web/tests/motion002.test.ts`: `e97494d284efb915d3d454483eaf11d39a9d53b27b5c7e171464d0e21018b65b`
- `web/e2e/motion002.spec.ts`: `19108a412c6883252255e17544cd063625afc2ea5d64ae5293f959ff4d4528e4`

## Supersession checks
- **Diff scope: OK.** `git diff --stat ceaa65e..HEAD -- web/tests web/e2e crates` shows only:
  - `motion002.test.ts` and `motion002.spec.ts`;
  - the `test.skip` markers with pointer comments in `motion.test.ts` (tests 3–6, S4–S7) and `motion.spec.ts` (test 7, S8).
- **Logged hashes: OK.** S4–S8 in `.wdd/memory/supersessions.md` carry the full pre-change hashes. These are unchanged since r3, which verified them.

## Method
- I built a throw-away prototype from the ward model in an untracked `web/src/render/_proto4/presentation.ts`. It covers:
  - `clearances` (a 0.25 m grid from 0.5, separating-axis test against the other links' road rectangles at the node, reverse link excluded);
  - `visualS` (both end zones compressed);
  - `visualPose` (the spec cubic, h = |P3 − P0|/3, ending at B's entry point);
  - `PresentationClock` (shared, min over the members' newest frames, rate, 1.5× catch-up beyond 2·D, glide while paused);
  - `Presenter` (match by trip id, transition path by arc length, resets).
- An untracked copy of `motion002.test.ts` ran against it. Trip ids were attached at post time from `sim.trip_at_record`, because the host has no `tripIds` or `epoch` yet.
- Mutants were switched on through an environment variable.
- All untracked files are deleted. `git status` is clean apart from this file.

**Baseline prototype:** 2, 2c, 2b, 3, 3c, 3b, 4, 4b, 5, 5b, 6 and 8 pass. Test 1 passes its trip-id and identity part (River City, which fixes r3 F1) and stops only at `typeof epoch`, which is expected in Red. **The contract is satisfiable.**

### Round-3 findings re-checked
- **F1 (wrong city in tests 1 and 4): fixed.** Lines 252 and 557 now use `network('river_city')`, and test 4 passes on the prototype.
- **F2 (curve/heading): resolved.**
  - 3b passes on the spec cubic for every pair × lane of both networks (> 1,300 cases).
  - Mutants that end the curve at B's s = 0 (`oldend`) or use a quadratic (`quad`) fail 2b, 3 and 3b.
- **F3 (held cars inside junctions): resolved.**
  - 3c checks every link and lane of both networks: clear at the stop line and the entry point, minimal on the grid, ≤ length/2, and both zones fit.
  - Test 2 checks the held body against the crossing roads.
  - Clearance values match the spec: median 6.25 m and p95 19.75 m (River City), median 6.25 m and p95 9.75 m (three_bridges).
  - I also checked the body the renderer actually draws for a queued car (3.6 × 2.3 m, wider than the 4.5 × 2.0 m spec car) at every stop line. It overlaps no crossing road: 0 / 488 River City lanes and 0 / 88 three_bridges lanes.
- **r3 m1 (no right-turn case in 2b): fixed.** 2b now runs `turnR`.

### Mutants (each against the relevant subset)
| Mutant | Fails |
|---|---|
| `fixed6` (old 6 m stop line, entry 0.5) | 3c, 3b |
| `notmin` (+0.25 m) | 3c |
| `lane0only` (clearance from lane 0 only) | 3c |
| `narrow` (1.6 m car) | 3c |
| `short` (3.6 m car) | 2, 3c |
| `inclrev` (reverse link counted) | none. **Equivalent mutant:** a lane centre is ≥ 1.75 m from the road edge, there is a 1 m median gap and the car is 1 m half-wide, so the reverse link can never overlap |
| `nocompress` | 2c, 2b, 3 |
| `endonly` (no start-zone compression) | 2b, 3 |
| `nostartclamp` | 3b |
| `oldend` (curve ends at B's s = 0) | 2b, 3, 3b |
| `quad` | 2b, 3, 3b |
| `holdcar`, `snapcar`, `roundcar` | 2c, 2b, 3 |
| `index` (record index) | 4, 5 |
| `notrans`, `transsnap` | 2b, 3 |
| `relcurveend2` (release starts at the curve end) | 2b (step 4.50 m against a bound of 0.034 m) |
| `simdist2` (paced by sim distance) | 2b |
| `noreset`, `noepoch` | 6 |
| `tickjump` | 4, 6 |
| `snapnewest` | 2b, 3, 4, 4b, 5, 6 |
| `freezepause`, `nopauseglide` | 4b |
| `ownclock`, `ownclockmax` | 5b |
| `ahead` | 2c, 2b, 3, 4, 4b, 5, 5b, 6, 8 |
| `fastcatch` (3× catch-up), `snap` | 4, 6 |
| `slow` (0.75 × rate when lag < D) | 3, 8 |

The R1–R4 and M1–M7 mutants from rounds 1–2 stay caught. The two mutants that survived my first run (`relcurveend`, `simdist`) were wrong in my prototype; the corrected versions above are caught.

## MAJOR findings

**F1: Transitions into another entry lane snap sideways by a whole lane width, and no test covers it. Classification: (a) fixable test gap, plus one sentence in the spec.**
- **Where:**
  - The ward model § Transitions says the path runs "through the curve to B's entry point, then along B to `visualS(B, s_new)`". P3 is in lane `min(laneA, B.lanes − 1)`, but the car's lane on B in the newer frame can be a different one.
  - Tests 3 and 2b use lane 0 only (`motion002.test.ts:412–415`, `:375–377`), so the expected entry lane always matches.
  - Test 4 checks only progress along a link, not the pose.
  - Kept `motion.spec` test 8 exempts these crossings (`d.lane !== prev.nextLane`).
- **Measured with real frames (5×, 1,500 frames):**
  - The entry lane differs from `min(laneA, B.lanes − 1)` on **1,879 of 4,400 junction transitions in River City (43 %)** and on **219 of 583 in three_bridges (38 %)**.
  - There are no mid-link lane changes (0 of 405,812 same-link pairs) and no multi-link jumps.
- **Scenario:** a car goes from River City link 0, lane 0, to link 82, lane 1. With the spec read literally, the presented pose steps **3.50 m sideways in one 2 ms sample** where the step bound is 0.156 m. This happened in **712 of 712** River City pair × (la, lb) mismatch cases. That is a visible snap on about 40 % of all junction crossings, which is exactly the i1 class the ward exists to remove. Every current motion002 test stays green.
- **Verified fix:** the lane is blended linearly along the transition path, as a fractional `lane` passed to `visualPose`/`vehiclePosition`, which are linear in lane. The pose is then still `drawAt(link, ŝ, lane, next)` of the presented values, so `trackedDraw().page = drawAt(...)` holds, and the path is re-parametrised by its true arc length. Result: **712 / 712 cases pass** the test below, and all existing tests still pass, because they only use lane 0.
- **Required fix test** (add as test 3d `transition_into_another_lane_is_continuous`, or extend test 3):
  - **Cases:** for River City `junctionPairs(30, 'river_city')` with `A.lanes ≥ 2 || B.lanes ≥ 2`, every `la < A.lanes` and every `lb < B.lanes` with `lb !== Math.min(la, B.lanes − 1)`. That is 712 cases; a deterministic spread of ≥ 100 that includes both la < lb and la > lb is enough.
  - **Schedule:** exactly test 3's schedule, with `lane: la` on the frames at ticks 199 and 200 and `lane: lb` on the frames at ticks 201 and 202.
  - **Assertions:**
    - `near(poses[0], vehiclePosition(A, vS(A, C, s0), la), 0.05)`;
    - `near(poses.at(-1), vehiclePosition(B, vS(B, C, 3), lb), 0.05)`;
    - `expectSmooth(poses, tag)`.
  - **Spec sentence** (ward § Transitions): "If the newer frame's lane on B differs from `min(laneA, B.lanes − 1)`, the lateral change is spread over the transition path. The presented `lane` may be fractional, and the pose stays `visualPose` of the presented values."
  - This is a clarification of an ambiguous path description, not a change to the architecture or the signatures.

## MINOR findings
- **m1: two epoch assertions in test 1 pass trivially.**
  - Where: `:287` (branch) and `:298` (view switch). Both are `epoch equal && scenario equal → false`, and the scenario always changes there, so both pass without any epoch change.
  - Resets are still safe, because the presenter resets on a scenario change too (test 6).
  - Fix: after `viewScenario 0` → `1` → `0`, assert that A's epoch differs from A's epoch before it left.
- **m2: the 0.05 m endpoint tolerance in tests 3 and 2b relies on `P` landing on the frame time at a 2 ms sample.**
  - Any clock that runs at exactly the requested rate does land there, and test 8's 0.55 s bound at 1× forces that rate (mutant `slow` fails both 3 and 8). So this is not a contract defect.
  - More robust: tolerance `0.05 + 1.5 · ((poses[0].P − 200·DT)/DT) · pathLength`.
- **m3: e2e test 9 takes `d.stop` from the hook without checking it.** A hook that reports `stop = length` would make "held cars at or behind the stop line" weaker. Add `expect(c.d.stop).toBeLessThanOrEqual(c.d.length − 0.5 + 1e-6)`.
- **m4: in e2e test 9 an old point can be covered by a car entering B** when `start[B] < 2.25 m`, because the body extends behind the entry point. This applies to 4 of 180 single-lane River City links and 0 of 44 in three_bridges, so the risk is low, and the assertion only needs half of the points empty.
- **m5: spec text nit.** The ward writes `visualPose(links, link, ŝ, lane, next)`, while the stub and tests take `(links, C, link, ŝ, lane, next)`. `Presenter` computes its clearances internally. Align the ward text.
- **m6: carried over.**
  - e2e test 10 is probabilistic and passes against today's code.
  - `no_orphaned_exports` fails in Red because of the stub exports. Gold must use those exports, without an ALLOWLIST entry.

## What is sound
- Every test fails for the right reason against the stub:
  - **Vitest:** test 1 fails with "expected undefined to be a Uint32Array" (no `tripIds`); the others fail with "presentation: not implemented".
  - **E2e:** test 7 gets `presentation` null; test 8 gets a median of NaN; test 9 finds 0 held cars, because the hook has no `length` yet.
- The spec's geometric claims hold:
  - the clearances fit every link;
  - the cubic stays within 10° per 0.1 m everywhere;
  - a held body is clear of every crossing road.
- Kept frozen tests:
  - `motion.spec` test 8 stays consistent with `drawAt = visualPose`, the (A, ŝ, B) → (B, ŝ, NO_NEXT) sequence and a fractional-lane blend (its path is built from `drawAt`, and a lane mismatch at a crossing is exempt);
  - `motion.test` test 2 loads and passes;
  - typecheck is clean.

## Commands and results
Load (`uptime`):
- 10.11 / 9.93 / 7.98 at the start;
- 5.9–21.7 during the prototype and mutant runs (shared machine);
- 6.34 at e2e start, 11.12 at its end;
- 10.35 at the full suite;
- 9.67 at the end.

| Command | Result |
|---|---|
| `pnpm -C web exec vitest run tests/motion002.test.ts`, as part of `pnpm -C web test` | 13 / 13 motion002 tests fail, for the reasons above |
| `pnpm -C web test` | 2 files failed, 27 passed: motion002 × 13 and `integration` `no_orphaned_exports` (expected in Red). All kept frozen suites are green. |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web exec playwright test e2e/motion002.spec.ts --reporter=line` (port 5190, own server) | 3 failed (7, 8, 9, for the reasons above), 1 passed (10, probabilistic), 1.1 min |
| Prototype copy of `motion002.test.ts` | 12 / 13 pass; test 1 stops only at `epoch` (≈ 300 s under load) |
| Mutants | see the table above |
| Lane statistics and the lane-mismatch probe | see F1; throw-away vitest files, now deleted |

---

## Applied under the convergence rule (round 4, 2026-10-12)

The verdict was APPROVED with one required fix test, so it is logged as `-auto`.
- **F1:** new test 3d `transition_into_another_lane_is_continuous` (River City, `i % 5` spread of the lane-changing pairs, both directions). Ward § Transitions gains the fractional-lane sentence.
- **m1:** test 1 now checks that A has a new epoch after the view switch A → B → A, then discards from B.
- **m3:** e2e test 9 asserts `d.stop ≤ d.length − 0.5`.
- **m5:** the ward text now gives `visualPose(links, C, link, ŝ, lane, next)`.
- **m2, m4:** not applied (low risk, noted). **m6:** for Gold to handle (no ALLOWLIST).

Red run after the fixes: 14 motion002 tests fail for the right reasons; typecheck clean.

**Frozen at Red approval (sha256):**
- `web/tests/motion002.test.ts`: `bd9de6d61ae82aafafb8a0e83ac6b9024a8eda83983d5f3a396a88c2667b4246`
- `web/e2e/motion002.spec.ts`: `09e7f795067801b185bf4a85d997c90b75039354ebf0d8871112825053cf5e8d`
