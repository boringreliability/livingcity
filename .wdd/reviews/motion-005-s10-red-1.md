# motion-005 S10 Red review r1

**Verdict: REJECTED**

Reviewed:
- `web/e2e/motion005.spec.ts` (working tree vs HEAD c4f8408; the frozen file at HEAD is sha256 2589ddf4174895b45ca4bd0d7d94e847d5ebaf3b721373439c2ce09ee7e2d18d, verified with `git show HEAD:web/e2e/motion005.spec.ts | shasum -a 256`);
- `.wdd/memory/supersessions.md` row S10 and `.wdd/memory/authorization-2026-10-14-s10-queue-release.md`;
- `.wdd/reviews/motion-005-gold-2.md` MAJOR 2, ward-005 test 2, and `livingcity.md` (closure, queues).

## How it was run
- Isolated copies live in `<scratchpad>/s10red/web-{base,noopen,uilie,halfopen}`. Each is an rsync of `web/` with `node_modules` symlinked, its own port (5420–5423) and `server.fs.allow` added. Scripts: `s10red/setup.sh` and `s10red/instr.sh`.
- `instr.sh` adds `console.log` lines only: q0, open level, the open samples, each poll's sum, sim seconds since s0, and the target. No assertion was changed.
- Runs used `s10red/run2.sh <variant> <log> <repeat>`, i.e. `playwright test e2e/motion005.spec.ts -g s10 --repeat-each=N`. Logs are in `s10red/*.log`.

Mutants:
- `noopen`: `client.openLink` no-op, so the reopen is never sent to the worker.
- `uilie`: the worker ignores `open`, and the frame's `closed` hides the links the user reopened. The sim keeps the Main Bridge closed while the UI shows it open, and the ring is gone.
- `halfopen`: only the first `open` reaches the sim (one direction of the Main Bridge); the others are ignored and hidden as in `uilie`.

| Variant | Runs | Result | Where it failed |
|---|---|---|---|
| base (uninstrumented) | 1 | pass | - |
| base (instrumented) | 3 | 3 pass | - |
| **uilie** (bridge never reopens in the sim) | 3 | **2 pass**, 1 fail | The failure is the pre-release `20×: frames with queued cars` (4 < 15), before any reopen |
| **halfopen** | 2 | **2 pass** | - |
| noopen | 3 | 3 fail | 2 at the reopen poll `closed…length` toBe 0 (received 2); 1 at the pre-release `20×: frames with queued cars` (6 < 15) |
| frozen test, un-skipped, on uilie (for comparison) | 3 | 3 pass | - |

## Findings

### BLOCKER 1: the S10 release oracle is vacuous. A bridge that never reopens in the sim passes it.
The `uilie` mutant keeps the Main Bridge closed in the sim for the rest of the test. It passed the S10 release check in both runs that reached it:
- `S10W 51 7 1107 [100,44,110]` → `S10P 17 6 31`. That is q0 = 51, open level 7, target 31; 6 sim s later the sum was 17 ≤ 31, with the bridge still closed.
- `S10W 27 11 1077 [100,110,54]` → `S10P 10 4 21`. 4 sim s later the sum was 10 ≤ 21.

`halfopen` also passed twice (`S10P 1 4 14.5` and `S10P 12 5 25`).

The base runs pass the same way, on the first poll after 4 sim s (37 → 18, 20 → 1, 33 → 29 → 17). No queue of 20–50 cars can discharge through a junction in 4–14 sim s, so even the base "release" is not a release. The cause:
- `linkQueued` counts cars with `v < QUEUED_SPEED` at one instant.
- The sum over three links swings by tens of cars within a few sim seconds (stop-and-go and junction discharge).
- The open-bridge samples taken 0.5 s wall apart show the same swing: `[12,1,6,9,3,0,12,11,17,0]` and `[2,0,0,0,0,4,0,0,7,16]`.
- q0 is taken at the first poll that crosses "open level + 10", which selects an upward swing. The `expect.poll` then succeeds on the first single sample ≤ target. With excess = 10 the target is only 3 cars below q0.

The frozen test is equally vacuous against `uilie` (3/3 pass: `FROZ 9 → FROZP 1 10`, `FROZ 14 → FROZP 0 21`). So S10 is not *weaker* than the frozen test here. It still fails the Red rule against tests that pass trivially, and the S10 row's claim that "the excess form keeps its intent" is not true: the intent "the queue releases after the reopen" is not tested at all.

Directions (they need to stay inside, or go back to, the user's authorization; see MAJOR 1):
- Compare sustained levels instead of a single sample. For example: mean of the pinned sum over ≥ N polls spanning ≥ 2–3 sim min after the reopen, against the closed-bridge mean over a matching window just before the reopen, plus the open-bridge mean (not max).
- Or add a structural release signal that a closed sim cannot fake. For example: Main Bridge flow / `crossings` resumes after the reopen, or the cars that were queued on the pinned approach links leave via the bridge.

Whatever is chosen must be shown to fail `uilie` and `halfopen` (scripts provided) and to pass base repeatedly, including under CPU contention.

### MAJOR 1: the implemented formula is strictly more lenient than the one the user approved, and the stated reason for the deviation does not hold
- The user approved (A): "queue at most halved, or at most 2 cars above the open-bridge level" (that is, ≤ max(0.5·q0, open + 2)), with "at least 10 cars queued at the reopen".
- The implementation uses `target = open + 2 + 0.5·(q0 − open) = 0.5·q0 + 0.5·open + 2`.
- With excess ≥ 10, this target is always > 0.5·q0 + 2 and always ≥ open + 7. So it is above the approved bound in every case.
- The S10 row says the approved formula "was vacuous when the open level was 26 of q0 = 28". That vacuity came from the absolute precondition "≥ 10 queued", and the replacement already changes that precondition to "≥ 10 above the open level". Under that new precondition the approved bound max(0.5·q0, open + 2) ≤ q0 − 8 is not vacuous.
- So the loosening is unjustified, and it is outside what the user said yes to. Either use the approved bound (with the excess precondition) or put the changed formula to the user. In both cases BLOCKER 1 remains.

### MAJOR 2: "identical up to the release" is false, in the S10 row, the authorization's scope note and the code comment
- The replacement inserts a block before the closure: 10 `snap` samples of `linkQueued`, 500 ms wall apart.
- At 20× this moves the closure about 100 sim s later. Observed `closedAt` was 1006–1012 s; the frozen test closes at about 900 s.
- The block is passive, and it plausibly belongs to the release oracle (it is the baseline). But the scope the user authorized says "Everything before the release … stays identical", and the record says it does.
- Record the deviation honestly: S10 row, the `SUPERSEDED` comment ("everything before the release is identical") and the authorization note. If needed, confirm it with the user.

### minor 1: the ward spec does not list S10
`.wdd/wards/motion/ward-005.md:106` still reads "Change, skip or supersede any frozen test, except S9". CLAUDE.md requires that the ward spec (and the epic gate) list each supersession.

### minor 2: the guard `target < q0` is redundant
- Given `excess ≥ 10`, q0 − target = excess/2 − 2 ≥ 3, so the guard can never fail. It is harmless, but it does not add the protection it claims.
- The real non-vacuity problem is the noise (BLOCKER 1), not the arithmetic.

### minor 3: the open-bridge baseline is a max of 10 instantaneous samples over about 100 sim s
- The demand profile is constant (`Profile::default()` in `cities.rs`), so drift over sim time is not the concern.
- The concern is that the max of a quantity that swings 0 ↔ 17 is an upward-biased, high-variance estimate.
- The pins also change between the sampling and the reopen: `pinLinks` is re-read on every wait poll.
- Prefer a mean, or a median over a longer window.

### Observation (outside S10's scope, but it defeats S10's purpose): the unchanged pre-release part is itself flaky
- `20×: frames with queued cars` failed 2 of 10 runs that reached it: `uilie` run 3 (4 < 15) and `noopen` run 1 (6 < 15, run in parallel with another copy, i.e. a loaded machine). Both failures came before any reopen, so the mutants were not yet involved.
- On a slow CI runner this assertion can keep E2E red after S10. Report it at the epic gate (or ask the user separately); it cannot be changed under the S10 authorization.

## Checks that passed
- The frozen test is `test.skip`, unchanged otherwise, with a pointer to S10. The HEAD hash matches the S10 row.
- From the closure through the 1×/20× observation, the replacement's code is byte-identical to the frozen test, apart from the inserted pre-closure sampling (MAJOR 2).
- `noopen` and a worker that honestly ignores the reopen are caught, but by the reopen poll on `closed`, not by the release oracle.
- The ≥ 10-excess wait was reached within 1–3 polls (sim 1070–1107 s) locally; there is no sign that the 120 s wall budget is tight.
