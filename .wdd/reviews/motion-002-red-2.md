# motion-002 Red gate, review 2

**Verdict: REJECTED**

Reviewer: a fresh adversarial Red reviewer (subagent), 2026-10-12. Worktree HEAD 2ddd83a (public-main).

## Files under review (sha256)
- `web/tests/motion002.test.ts`: `93124e95ff8c7bee2b8b976e8bc0c887aba51f709d7fbb505985827f5803a8cd`
- `web/e2e/motion002.spec.ts`: `abfe3eaece625d77cfbd64a80d87403826f5d558efdbb32d63c4540f2659c498`

## Supersession checks
- **Diff scope: OK.** `git diff ceaa65e..HEAD -- web/tests web/e2e crates` shows only:
  - the two new motion002 files;
  - the `test.skip` markers with comments on `motion.test.ts` tests 3–6 (S4–S7) and `motion.spec.ts` test 7 (S8).
- **Hashes: OK.** They match the log.
  - `git show ceaa65e:web/tests/motion.test.ts | shasum -a 256` = `6b83cbd1…af98be`.
  - `git show ceaa65e:web/e2e/motion.spec.ts | shasum -a 256` = `6878ebd5…cef72`.
- **Intent carried: not fully.**
  - S4 sweeps a different, smaller network (MAJOR R3).
  - S8's negative control does not discriminate the old rule (MAJOR R4).

## Method
I built a throw-away prototype `Presenter` / `PresentationClock` / `visualPose` that follows the ward model, in the untracked file `web/src/render/_proto/presentation.ts`. I ran a copy of `motion002.test.ts` against it, with trip ids attached from `sim.trip_at_record` at post time. I then switched on single mutants through an environment variable. All the untracked files have been deleted again.

The prototype's model:
- `visualS` compression;
- the stop-line clamp;
- the transition path from `visualS(A, s_old)` through the curve to `visualS(B, s_new)`, at uniform arc length;
- `P` trailing by `D`, clamped at the newest frame, with 1.5× catch-up above 2·D and a 1.5× glide while paused;
- a shared clock targeting the minimum newest frame of both sides;
- resets on epoch, scenario, world, compare and a lower tick.

**Result:** tests 2, 2b, 3b, 4, 4b, 5, 5b, 6 and 8 pass. Test 1 fails only because `epoch` is not in the host frame yet. Test 3 needs one unstated choice, the initial `P` (m1). So the contract is satisfiable.

### Mutant matrix (each on top of the prototype)
| Mutant | Fails | Verdict |
|---|---|---|
| `snap`: P jumps to newest − D when lag > 2D | 4, 6 | caught (round-1 M2 fixed) |
| `snapnewest`: P = newest always | 2b, 3, 4, 4b, 5, 5b, 6 | caught |
| `index`: matching by record index | 2, 2b, 3, 4, 5, 6 | caught (M4 fixed) |
| `ownclock`: each presenter has its own clock | 5b | caught (M5 pure part fixed) |
| `relcurveend`: release path starts at the curve end | 2b | caught (M1 fixed) |
| `simdist`: transition progress by sim distance | 2b, 3 | caught |
| `noclamp`, `novs` (no stop-line clamp / no compression) | 3b; 2, 4 | caught |
| `noreset`, `noepoch`, `tickjump` (> 8-tick heuristic) | 6; 6; 4, 6 | caught |
| `fastcatch` (3× catch-up), `ahead` (P beyond newest) | 4, 6; 4, 4b, 6, 8 | caught |
| **`holdcar`**: a car on the same link in both frames is drawn at its **older** frame position until P reaches the newer one, then jumps | **none** | **not caught (R1)** |
| **`roundcar`**: the same car is drawn at the older position for α < 0.5, then at the newer one | **none** | **not caught (R1)** |
| `snapcar`: the same car is drawn at the newer position | only 2b, by a float accident (a sample at P = 104·DT + ε, "ends at B") | effectively not caught (R1) |
| **`nopauseglide`**: P snaps to newest when paused | **none** | **not caught (R2)** |
| `ownclockmax`: the shared clock targets max(newest A, newest B), so P runs ahead of the slower side | none | minor (m3) |

## MAJOR findings

**R1: Interpolation along a link is never asserted. Stepwise motion ("pause, then jump") passes every test.**
- **Where:** `motion002.test.ts` tests 4 (381–464), 5 (491–534), 8 (590–611); `motion002.spec.ts` test 10.
- **What the tests check:**
  - Steps are bounded only inside a link *transition* (2b, 3).
  - For motion along one link:
    - test 4 checks only "s non-decreasing" and "≤ newest";
    - test 5 checks only "s ∈ [s_old, s_new]";
    - e2e test 10 checks only "never back";
    - the kept `motion.spec` test 8 bounds the displacement by the drawn path length + 0.9 m, which a jump *along* the path satisfies.
- **The shortcut that passes:** a presenter that shows each car at its older frame's `s` and jumps to the newer one when P reaches it (`holdcar`), or at α ≥ 0.5 (`roundcar`). It passes all 11 vitest cases. At 1× that is a 0.5 s stop-and-jump of up to ~7 m per frame on every moving car. That is the user's i1 symptom ("cars pause … and then jump forward") and the opposite of "prefer interpolation between authoritative states".
- **Fix:**
  - In test 4 (real frames), for every trip on the same link in the two frames around P, assert that the presented `ŝ` equals `visualS(s_old) + α·(visualS(s_new) − visualS(s_old))` within a small tolerance. Alternatively, bound each per-sample step by `|Δŝ_interval| · ΔP / interval + ε`.
  - Add a pure 1× case: one car moving 0 → 14 m over two frames. Assert that the sampled `s` is strictly increasing between frames, with no step > 1.5 × the mean.

**R2: The pause glide is never exercised. A snap to newest on pause passes test 4b.**
- **Where:** test 4b (466–489).
- **Why the glide is untested:**
  - The last running frame (705) arrives at 2500 ms. At 1×, P reaches 705·DT at 3000 ms.
  - The paused frames start at 3000 ms, when the lag is already 0.
  - So "rising monotonically at ≤ 1.5·rate to the newest frame" is vacuous: `nopauseglide` (P := newest immediately on a paused frame) passes.
- **Why it matters:** in the app a pause lands mid-interval, with a lag of up to D (0.5 sim s at 1×, up to 2 sim s at 20×). A snap there is a visible forward jump of every car. That is the "pause and resume" case of the task, and round-1 M3 asked for exactly this.
- **Fix:**
  - Let the paused frame arrive mid-interval, for example at 2700 ms (lag ≈ 0.3 sim s).
  - Add a 20× variant with lag ≈ D.
  - Assert at least one sample with `newest − P > 0.1` after the paused frame, so the glide is observed, and keep the step bound.
  - Also cover the app's quiet pause: one paused frame, then no further frames.

**R3: The S4 breadth is lost, and the "turns gradually" contract fails on ~38 % of junction lanes without any test noticing.**
- **Where:** test 3b (345–379), `pick()` (96–110), tests 2b and 3.
- **The superseded sweep was wider.** The old `motion.test.ts` test 3 swept **River City**, the demo network (`Sim.river_city`): 900 junction pairs and 1336 pair × lane combinations. The new 3b sweeps **three_bridges**: 144 pairs and 188 pair × lanes. By CLAUDE.md, the replacement must not be weaker for wanted behaviour. Sweeping a smaller test city drops 85 % of the swept junction lanes, and all of the network users see.
- **3b checks no heading continuity.** Measured with the "as today" curve (`vehicleDrawPosition`, which the spec makes `visualPose` with `next`), the heading changes by more than 30° within one 0.1 m step:
  - in 70 of 188 pair × lanes on three_bridges (worst 85.8°);
  - in **504 of 1336 on River City** (worst 88.3°).
- **Where the kink sits.** It is at the stop line, where the curve begins (for example three_bridges 4→17, lane 0, at s = len − 6, a 90° turn: 67.8°). It comes from the fallback control point (`p2 − e·chord/2`), whose start tangent is not along A.
- **How the tests miss it.** Tests 2b and 3 assert "heading changes ≤ 30° per step", but only on two hand-picked lane-0 pairs that happen to be kink-free.
  - Forcing pairs [4,17] and [1,12] into test 3 makes the prototype fail: cos = 0.378, about 68°.
  - On River City, test 3's own `pick()` fails too: cos = 0.44, about 64°.
  - 2b does not catch it even on kinked pairs: its first sample is already on the curve, so the snap from the held heading to the curve heading falls between "held" and the first sample.
- **Consequence:** Gold can ship cars that rotate by up to 88° in one frame at the stop line on release, and every test is green. That violates the smoke test ("turn through it in one smooth motion") and the task's "sharp turns".
- **Fix:**
  - Sweep River City as well as three_bridges, or River City alone.
  - In 3b, assert the heading change per 0.1 m step along `visualPose(A, ·, lane, B)` for every pair × lane, including across the stop line (≤ 30° or a curvature-based bound).
  - In 2b, include the held pose as the first sample.
  - In the spec, define a curve that satisfies this. For example, put the control point on A's lane line (tangent along A at the stop line), or use a cubic with tangents d and e. "As today" does not satisfy it.

**R4: The negative control in e2e test 9 does not discriminate the old rule. Round-1 M6 is only partly fixed.**
- **Where:** `motion002.spec.ts` 197–208.
- **What the control samples:** `linkScreenPoint(A, 1)`, the end of A's *centreline*.
- **Where the old rule drew a held head car:** at B's start *in its lane*, heading along B (`vehicleDrawPosition(A, length, lane, B)`), with the queued body 3.6 × 2.3 m (`VEH_VS`).
- **How rarely it overlaps.** Over every junction pair × lane, the old-rule body covers the control point in only **15 %** of the cases on three_bridges (28 / 188) and **11 %** on River City (152 / 1336). It misses:
  - for multi-lane approaches, the centreline is 1.75 m off every lane centre, more than the 1.15 m half-width;
  - at turns, the right-shifted ends of A and B are about 3 m apart.
- **So the old GPU passes the control.** Under it, "≥ half of the old points empty" holds almost always.
- **The positive check passes under the old GPU as well**, whenever the head car has a follower. The old rule draws the follower at len − 7.5, with its body over len − 9.3 … len − 5.7 ∋ len − 6. Queued heads at demand = 3 with the bridge closed almost always have one.
- **So the GPU-side assertion is still not deterministic.**
- **Fix:**
  - Sample the true old-rule point. Expose the frame's next link per record in `frameVehicle` and use `drawAt(link, length, lane, next)`, or compute B's lane start.
  - And/or restrict the positive check to head cars without a follower within 9.5 m in the frame, so a GPU that draws them elsewhere leaves their stop-line point empty.

## MINOR findings
- **m1: test 3 depends on an unstated initial `P`** (lines 298–316).
  - The first frame (200) is pushed at 0 ms. Under the spec's "P restarts at the new frame", P = 200·DT and holds for 500 ms, and those 250 identical samples fall inside the `[200·DT, 201·DT]` filter. The mean step halves, and a correct presenter fails "no jump" (0.060 > 0.046).
  - It passes only if the first-ever frame starts P at `tick·DT − DT`. Test 6 forbids that for later resets, and the spec says nothing about it.
  - Either state it in the spec, or (better) prime the presenter with frame 199 at −500 ms, or compare each step with its ΔP share of the path. Round-1 m1 is not fully addressed.
- **m2: test 4 (≈ 2.5 s on the prototype at load ≈ 5) runs under the default 5 s vitest timeout.** A real presenter that builds poses for every car at every 4 ms sample, on a loaded or CI machine, may time out. Give it an explicit timeout. (The River City variant timed out at 5 s.)
- **m3: test 5b checks only Pa === Pb, not P ≤ each side's newest.** A shared clock that targets max(newest A, newest B) passes (mutant `ownclockmax`). Add `P ≤ min(newest A, newest B)`.
- **m4: 3b's "including short links" is vacuous.** No link in either network is shorter than 12 m, so `STOP_M = length/2` is never exercised. Add a synthetic short `LinkGeom` pair, or drop the claim.
- **m5: e2e test 8's `lagMs ≈ lagS·1000/m` uses the requested multiplier.** The spec defines `lagMs` with the current rate, which is the achieved rate when behind. On a slow CI with the engine behind at 20×, a correct implementation fails. Read the rate from the snapshot or diagnostics, or skip samples where `behind`.
- **m6: e2e test 9 still filters held cars with the hook's own `length`** (round-1 m8), and `inView` compares page coordinates with `box.width`/`box.height` without `box.x`/`box.y`.
- **m7: untested spec items:**
  - the achieved rate when behind;
  - `D` capped at 4·DT (only indirectly, in the stall case);
  - interpolation of lane changes;
  - the history cap;
  - test 1's "ids correct after a seek" (only length is checked; B is checked in full).
- **m9: e2e test 10 is not red.** It passed against today's code in this run, as in round 1 for the caller. It is a probabilistic regression guard, and no browser test fails deterministically on i4. Once R1 is fixed, the pure tests carry this. Acceptable, but state it in the ward.
- **m8: `no_orphaned_exports` fails in Red.** The orphans are `STOP_M`, `stopLine`, `visualS`, `PresentedVehicle`. That is acceptable, but Gold must use them; no ALLOWLIST entry.

## What is sound
- **Every test fails for the right reason against the stub.**
  - Vitest: test 1 fails with "tripIds expected undefined"; the rest fail with "presentation: not implemented".
  - E2e:
    - test 7: presentation is null;
    - test 8: median NaN;
    - test 9: held cars fail on the missing `length`;
    - test 10: only when today's i4 is hit. It passed in this run (m9).
- **Round-1 fixes that are verified by mutants:** M1 (release from held), M2 (step bound and catch-up), M4 (swapped records), M5 (pure shared clock), M7's sweep of `visualPose` (the breadth is still short; see R3), and the M6 running check.
- **The geometry thresholds are consistent with the compressed queue front.**
  - Head car at len − 6, follower at len − 9.75: 3.75 m apart, ≥ 3.6.
  - The 3b step bound of 0.75 m and the exact end position and heading hold on both networks for the "as today" curve.
- **The kept frozen tests are compatible with the spec.**
  - `motion.spec` test 8: `drawAt` = `visualPose` keeps the path-length check consistent. Held → curve is exempt, and a crossing counts when `d.link === prev.next`.
  - Kept `motion.test.ts` test 2 still runs.
  - Typecheck is clean.

## Commands and results
Load (`uptime`):
- 10.34 / 8.10 / 8.52 at the start;
- 9.09 at the first vitest;
- 11.98 / 7.00 / 6.94 at the full suite;
- 12.37 / 7.37 / 7.07 at the start of the e2e run, up to 18.00 / 9.70 / 7.95 during it.

- **`pnpm -C web exec vitest run tests/motion002.test.ts`:** 11/11 fail, for the reasons listed above.
- **`pnpm -C web test`** (run as `vitest run --exclude 'tests/_proto*'` while my prototypes existed): 2 files failed, 27 passed. 12 tests failed (motion002 × 11 + `integration` `no_orphaned_exports`), 129 passed, 7 skipped.
- **`pnpm -C web typecheck`:** clean.
- **`pnpm -C web exec playwright test e2e/motion002.spec.ts --reporter=line`** (port 5190): 3 failed, 1 passed (1.1 min).
  - Test 7: "diagnostics().presentation", received null.
  - Test 8: "1×: median presentation lag", NaN.
  - Test 9: "held cars at junctions", 0 (the `length` is missing).
  - **Test 10 passed** against today's code. It did not hit i4 in this run (see m9).
- **Prototype runs** (untracked, deleted afterwards):
  - the base prototype passes everything except test 1 (no epoch in the host yet) and test 3 (m1);
  - the mutant matrix is above;
  - kink and control statistics come from a throw-away sweep over both networks.
