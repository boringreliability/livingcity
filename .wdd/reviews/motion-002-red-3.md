# motion-002 Red gate, review 3

**Verdict: REJECTED**

Reviewer: a fresh adversarial Red reviewer (subagent), 2026-10-12. Worktree HEAD 61781f7 (public-main).

## Files under review (sha256)
- `web/tests/motion002.test.ts`: `bd19acbfe20143d373351b1ddb859b289112a2823de1352f5da1d6ac44b6f08f`
- `web/e2e/motion002.spec.ts`: `9db49809d4b3f9fccbd80234840a84bfe27869c8a16e153b1f891c523beff797`

## Supersession checks
- **Diff scope: OK.** `git diff ceaa65e..HEAD -- web/tests web/e2e crates` shows only the two motion002 files and the `test.skip` markers with pointer comments on `motion.test.ts` tests 3–6 (S4–S7) and `motion.spec.ts` test 7 (S8).
- **Hashes: OK.** `git show ceaa65e:web/tests/motion.test.ts | shasum -a 256` = `6b83cbd1…af98be`, `git show ceaa65e:web/e2e/motion.spec.ts | shasum -a 256` = `6878ebd5…cef72`; both match the log.
- **Intent carried:** S4 breadth now sweeps River City + three_bridges (1336 + 188 pair × lanes) with a heading bound. S8's negative control now samples the true old-rule point. See F2 for why the S4 sweep cannot be passed by the spec's own curve.

## Method
I rebuilt a throw-away prototype (`visualS`, `visualPose` with the spec's cubic, `PresentationClock`, `Presenter`) exactly per the ward model in an untracked `web/src/render/_proto/presentation.ts`, ran an untracked copy of `motion002.test.ts` against it (trip ids attached via `sim.trip_at_record` at post time, since the host has no `tripIds` yet), and switched single mutants on through an env variable. For tests 3/3b I also ran throw-away geometry sweeps. All untracked files are deleted; `git status` is clean.

### Round-2 findings re-checked with their mutants
To run the non-curve mutants, the test-3 copy skipped the pairs where the spec curve itself kinks (F2).

| Mutant | Fails | Round-2 item |
|---|---|---|
| `holdcar` (old position until the newer frame, then jump) | 2c, 3 | R1 fixed |
| `roundcar` (switch at α = 0.5) | 2c | R1 fixed |
| `snapcar` (newer position at once) | 2c | R1 fixed |
| `smoothstep` (eased α) | 2c | — |
| `nopauseglide` (snap P to newest when paused) | 4b | R2 fixed |
| `freezepause` (P stops on pause) | 4b | R2 fixed |
| `oldcurve` (old quadratic with fallback) | 3b | R3: caught, but so is the spec cubic (F2) |
| old-rule GPU in e2e test 9 | analytic: the old rule drew a held head car at `vehiclePosition(B, 0, min(lane, 0))` = B's centreline start for single-lane B = `linkScreenPoint(next, 0)`; the follower filter (9.5 m) keeps other bodies off the presented point | R4 fixed (cannot run in Red: `frameVehicle` has no `next` yet) |
| `snapnewest` | 2b 3 4 4b 5 6 | caught |
| `snap` (P jumps to newest − D) | 4 6 | caught |
| `index` (record index) | 4 5 | caught |
| `ownclock` / `ownclockmax` | 5b / 5b | caught (r2 m3 fixed) |
| `relcurveend` / `relstop` (release starts at curve end / at stop line) | 2b 3 / 3 | caught |
| `simdist` (transition by ŝ, not arc length) | 3 | caught |
| `notrans` / `transsnap` (no transition path / switch at α = 0.5) | 2b 3 / 2b 3 | caught |
| `noreset`, `noepoch`, `tickjump` | 6; 6; 4 6 | caught |
| `fastcatch` (3×), `ahead` (P beyond newest) | 4 6; 2c 2b 3 4 4b 5 5b 6 8 | caught |
| `novs` (no compression) | 2 2c 4 | caught |

Baseline prototype: 2, 2c, 2b, 4b, 5, 5b, 6, 8 pass; 3 passes only with the kinked pairs skipped. 1, 3b, 3 and 4 fail as described below.

## MAJOR findings

**F1: Tests 1 and 4 run River City frames against three_bridges topology. A correct implementation fails both.**
- **Where:** `motion002.test.ts:159` and `:448`. The host is initialised without `city`, so it uses `DEFAULT_CITY = 'river_city'` (`web/src/sim/protocol.ts:31`). But `:176` (`const { to, from } = network()`) and `:462` (`const net = network()`) take three_bridges (the default of `network()`, line 79).
- **Scenario:**
  - Test 1, with correct trip ids from `trip_at_record`: `same trip on another link: one it reached from its old link: expected 1 to be 6`. River City link ids are looked up in three_bridges' `from`/`to`.
  - Test 4: the presenter gets three_bridges geometry for River City link ids. The prototype threw `Cannot read properties of undefined (reading 'length')`, and the test's own `vS(net.links[v.link]!, …)` at `:497` does the same for any link id ≥ three_bridges' count.
- **Verified fix:** with `network('river_city')` at :176 and :462, test 4 passes on the prototype (26 s), and test 1 passes its identity part and then stops at `typeof epoch` (expected in Red). Alternatively, pass `city: 'three_bridges'` in both `init` calls.

**F2: The ward's mandated junction curve fails its own tests 3b and 3. No single cubic can pass 3b on these networks.**
- **Where:** ward-002 § The model, the cubic with h = |P3 − P0|/3. Tests 3b (`:423–438`), 3 (`:364–369`) and, for a hook pair, 2b.
- **Measured** with the spec cubic, sweeping ŝ in 0.1 m steps, heading change > 10° per step:
  - River City: **427 / 1336** pair × lanes; worst **58.2°** (3→82 lane 0, 7→106 lane 0).
  - three_bridges: **62 / 188**; worst 41.3° (4→17 lane 0).
  - Test 3 on the prototype: `three_bridges 4→17: heading turns gradually: expected -0.103 ≥ 0.866`, about a 96° flip between two 2 ms samples.
  - With arc-length parametrisation it is no better: 493 / 1336.
  - With the best handle lengths from a grid of 0.5–10 m for each end (arc-length parametrised, step ≤ 0.75 m), **347 / 1336 and 48 / 188 still fail**; worst 36.8°.
- **Root cause (geometry, not implementation).** Drawn links end on the node line, right-shifted. On right turns, B's start therefore lies to the *left of and barely ahead of* A's lane at the stop line.
  - Example, three_bridges 4→17 lane 0: P0 = (−556, −5.75), heading +x. P3 = (−552.3, 0), heading −y.
  - The path must hook left and then turn more than 180° right within about 6 m of ŝ.
  - Only loop-like curves (for example arc + straight + semicircle at r ≈ 1.1 m) fit under 10° per 0.1 m. That is not "one smooth motion".
- **Assessment.** The tests encode a valid user intent ("link transitions and sharp turns", no visible snaps). The spec's claim that the cubic "never snaps" is false. Gold cannot satisfy both the spec and the tests, and a Gold-time deviation would be a design change.
- **Decision needed (spec, not test):** where a junction path ends. One example: on B's lane at B's junction clearance (s > 0), with the drawn junction region excluded from both links. That changes `drawAt`/`visualPose` semantics, which the kept `motion.spec` test 8 path check uses, and it needs test 3b's end assertion restated. Architecture-level, so it is escalated.

**F3: The fixed 6 m stop line still draws held cars inside the junction, on another road's lanes, in about half of River City's approaches. No test checks "visually before the junction".**
- **Where:** tests 2 (`:252`), 3b (`:417`) and e2e 9 (`:184`, `:254`) pin `stop = length − min(6, length/2)`. No assertion relates the held body to the crossing roads.
- **Measured:** a held car body (3.6 × 2.3 m, as in `VEH_VS`) at the spec stop line overlaps the drawn lanes of another link at the same node:
  - River City: **232 / 444** approach lanes;
  - three_bridges: 14 / 76.
- **Example:** River City link 3 (1 lane, heading −x, ends x = −2300), lane 0.
  - Its stop-line body spans x ∈ [−2295.8, −2292.2], y ≈ −1797.8 ± 1.15.
  - Link 82 (2 lanes, northbound, x ∈ [−2299.5, −2292.5], starting at y = −1800) draws its cars at s ≈ 0–4 m exactly there.
  - Two-lane crossing roads extend 7.5 m from the node line, but the held car's front is only 4.2 m from it.
- **Why MAJOR:** the user requirement is "A vehicle held at a stop line must remain visually before the junction", and the defect is "overlap inside intersections". A Gold that follows the spec passes every test with this overlap present in the demo city. A Gold that fixes it (per-approach clearance) would fail tests 2, 3b and 9, which hard-code 6 m.
- **Fix:** F2 and F3 have the same root cause, so one spec decision covers both: a per-approach stop line / junction clearance derived from the incident link widths, plus a curve that ends at B's clearance. Then restate tests 2, 3b, 9 (and 2b/3 endpoints) against that clearance, and add a 3b assertion that the held body at the stop line does not intersect any other incident link's lanes.

## MINOR findings
- **m1:** Test 2b's turn pair is the sharpest three_bridges turn of length ≥ 40. On the spec cubic it happens not to be a hook pair, so 2b does not exercise a right-turn release (relevant once F2 is decided). Add one hook pair, for example 4→17 lane 0.
- **m2:** Test 3 runs lane 0 only. Multi-lane transitions are covered only geometrically by 3b, not through the presenter.
- **m3:** Lane changes between frames are not specified or tested. Kept `motion.spec` test 8 flags a mid-link lateral snap of 3.5 m as a jump (> along + 0.9 m), so Gold needs a defined lateral rule.
- **m4:** Still open from r2:
  - 3b's "short links" is vacuous: no link is shorter than 12 m;
  - e2e test 9 filters held cars by the hook's own `length` (r2 m6 part 1; `inView` now uses `box.x`/`box.y`, fixed);
  - e2e test 10 is probabilistic and passed against today's code again.
- **m5:** `no_orphaned_exports` fails in Red (stub exports). That is acceptable; Gold must use the exports, with no ALLOWLIST entry.
- **Fixed since r2:**
  - r2 m1 (test 3 priming frame and per-step ΔP share);
  - m2 (test 4 explicit 120 s timeout; it needs 26 s on the prototype);
  - m3 (5b `P ≤ min(newest A, newest B)`, which catches `ownclockmax`);
  - m5 (lagMs cross-check skips behind samples).

## What is sound
- Every test fails for the right reason against the stub:
  - Vitest: test 1 fails with "tripIds expected undefined"; the others fail with "presentation: not implemented".
  - E2e: test 7 gets presentation null; test 8 gets median NaN; test 9 finds 0 held cars, because the hook lacks `length`.
- The R1 and R2 mutants are now caught: 2c is exact-linear within 1e-6 at 1× and 20×, and 4b has a mid-interval pause, a quiet pause and a glide observation.
- Kept frozen tests:
  - `motion.spec` test 8 is consistent with `drawAt = visualPose` and with the (A, ŝ, B) → (B, ŝ, NO_NEXT) presented sequence;
  - `motion.test` test 2 still loads;
  - typecheck is clean.

## Commands and results
Load (`uptime`):
- 10.79 / 8.11 / 7.55 at the start;
- 3.0–4.8 during the prototype runs;
- 3.59 at e2e start, 12.63 at its end;
- 11.06 at the full suite.

- **`pnpm -C web exec vitest run tests/motion002.test.ts`:** 12 / 12 fail, for the reasons above.
- **`pnpm -C web test`:** 2 files failed, 27 passed. 13 tests failed (motion002 × 12 + `integration` `no_orphaned_exports`), 129 passed, 7 skipped.
- **`pnpm -C web typecheck`:** clean.
- **`pnpm -C web exec playwright test e2e/motion002.spec.ts --reporter=line`** (port 5190): 3 failed (7, 8, 9, for the reasons above), 1 passed (10; probabilistic), 1.1 min.
- **Prototype and mutants:** see the tables above. The geometry sweeps were throw-away vitest files, now deleted.

## Escalation
This is round 3 with a REJECT, so it goes to the human.
- **F1** is a two-line test fix.
- **F2 and F3** need one design decision on junction geometry: where the stop line and the curve end lie relative to crossing roads. That decision changes `visualPose` semantics and the 6 m constant pinned by tests 2, 3b and 9.
