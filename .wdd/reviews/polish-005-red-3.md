# polish-005 Red review, round 3

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 5 MINOR)

Reviewed at HEAD `b2e693f`. sha256 of the test files:
- `crates/sim-core/tests/polish_005_perf.rs`: `e51fce84b2209d7baa684305383b077ad330ae737718b8ac6c89cae872e7448c`
- `web/tests/polish005.test.ts`: `8577307daab668fa9b3458a3513d5b6585191d33c059a9f7fe3d0318eb447723`
- `web/e2e/restart.spec.ts`: `cd55c4ebb642acd528f8127724906d39bbbf91abe2ab209bb160fdeb1fb91e78`

## Round-2 findings

| R2 | Status | Evidence |
|---|---|---|
| M1: client/App do not send `scenario` | **Resolved** | Test 7b on the round-2 minimal web implementation (host-side per-side pool, client and App unchanged) **fails** (protocol regex). After the natural change, 7b passes: protocol `scenario?: 0 \| 1`, client `returnBuffer(buffer, scenario)` → `send({ type: 'returnBuffer', buffer, scenario }, [buffer])`, and all six App calls pass `x.vehicles, x.scenario`. `tsc --noEmit` is clean (with `exactOptionalPropertyTypes`). polish005, host, review2, review3, sim and integration then give 33 passed. The only failures are docs/JSON that were not copied into the scratch copy (test 10, integration 5/6/8/9), as in round 2. Residual: m1 below. |
| M2: spec/smoke/epic demand an idle paused host | **Resolved** | The heartbeat line is gone. `ward-005.md:96` now pins G4/G4b, smoke step 2 and its pass criterion are rewritten, and `polish.md:122` records the deviation for the epic gate. No remaining "idle"/"heartbeat" requirement in the ward or epic (grep). |
| M3: no gridlock removal / `spawn_with_route` in test 2 | **Resolved** | Mutation probe (below): incremental live count and creation-tick sum feed `metrics().mean_incomplete_age_s`, and `metrics_full_scan()` is the old code. **MUT 0** (correct updates everywhere): test 2 passes. **MUT 1** (no update in `remove_gridlocked`): fails `ring: metric 15 (735 vs NaN) at tick 1470`. **MUT 2** (no update for `spawn_with_route`): fails `ring at spawn: metric 15 (NaN vs 0) at tick 0`. The ring removes vehicles; the `removed_gridlock ≥ 1` precondition holds. |
| m1 test 6 passes on HEAD | Accepted as a regression pin (still passes on HEAD) | |
| m2 vacuous `byteLength ≥ 0` | Resolved (removed) | |
| m3 retry visits self-reported | Open, accepted: the Gold reviewer checks the code | |
| m4 `baseline` null / not tied to before | Resolved: `toBeTruthy()`, and `baseline.<scale>.stepMs === before.<scale>.stepMs` for x1/x3/x5 | |
| m5 9b comment | Resolved (comment corrected) | |
| m6 test 8 stale tick | Partially resolved (m3 below) | |

## Findings

### m1 MINOR: 7b accepts a wrong side
- **Where:** `web/tests/polish005.test.ts:121-123`.
- **Problem:** 7b checks only that each App call has two arguments. Probe: replacing all six calls with `c.returnBuffer(x.vehicles, 0)` passes 7b. In compare, B's buffers then land in A's pool and B allocates every frame (e3 not fixed). A plausible variant is passing the *viewed* side instead of the frame's side.
- **Fix:** Require the second argument to be the same object's side, e.g. `/\.returnBuffer\(\s*([\w.]+)\.vehicles\s*,\s*\1\.scenario\s*\)/` for every call. Otherwise the Gold reviewer must check it by reading `App.tsx`.

### m2 MINOR: 7b is format-bound
- **Where:** `polish005.test.ts:118` and `:122`.
- **Problem:** Correct code can fail it:
  - a typed lambda `(buffer: ArrayBuffer, scenario: 0 | 1) =>` fails the client regex;
  - a different key order fails it too;
  - factoring the six App calls into one helper fails `calls.length > 2`.
  
  The natural edit passes (verified), so this is not a blocker.
- **Fix:** Optional. Loosen the regexes, for example `returnBuffer:\s*\(\s*buffer[^,]*,\s*scenario` plus `type:\s*'returnBuffer'[^}]*\bscenario\b`. Or note in the spec that the form is fixed.

### m3 MINOR: test 8's "new world" check is near-vacuous
- **Where:** `web/e2e/restart.spec.ts:27,36`.
- **Problem:** `t0 < deadTick + 1800` (about 3,640) also holds for the dead worker's stale tick (about 1,840), and for a restart that resumes the old state. The real guard is the final poll (`tick > t0` within 20 s), which a stale UI fails. That poll is sound.
- **Fix:** Optional. Poll until `tick !== deadTick` before the `> 1800` poll. Or assert that the timeline head/start resets, if "new world" matters.

### m4 MINOR: "Branch cost at 48 MiB is re-measured" (P5) is not checked
- **Where:** epic `polish.md:125`; test 10 requires only `metricsMs`/`stepMs`.
- **Problem:** An implementation can skip re-measuring the branch cost and pass every test. Test 5 checks sharing via the self-reported `shared_snapshots`. Whether that uses `Arc::ptr_eq` and avoids deep clones is code-level.
- **Fix:** Add a `branchMs` (48 MiB) before/after pair to `frame-cost.json`, checked in test 10, or have the Gold reviewer check it explicitly.

### m5 MINOR: the e3 deviation is recorded in the ward but not in the epic
- **Where:** `ward-005.md:79` says "no allocation per frame … recorded as a pinned deviation". Epic `polish.md:124` still demands "no per-frame allocation once warm" without a deviation note. The test file header (`polish005.test.ts:1`) still says "an idle host while paused".
- **Problem:** This is the same kind of spec/epic drift as round-2 M2, but milder: the smoke test now asks only for "no growth in memory", which is achievable.
- **Fix:** Add a deviation note to `polish.md:124`, as was done for e2, and correct the header comment.

## Checked and found sound
- **Test 2:** with the ring, every incremental-counter site is exercised: spawn via `spawn_with_route`, gridlock removal, the drain to zero live vehicles, unreachable removal, completions, seeks and branches. Bit-identity of `mean_incomplete_age_s` is achievable incrementally, because `DT = 0.5` makes every age exactly representable. The mutant with correct updates (MUT 0) passes.
- **Thin-wrapper copy** (pre-ward code plus doc-hidden wrappers) with HEAD's test file:
  - tests 1, 2 and 4 pass, so the golden hashes still hold on the pre-ward code;
  - test 3 and test 5 fail as intended (no optimization, no sharing).
- **HEAD vitest:** 7, 7b, 9, 9b and 10 fail for the intended reasons. Test 6 passes (pin).
- The spec and smoke test no longer contradict G4/G4b.

## What I ran
Load during the runs: `uptime` load averages were 9.7–13.6 (shared machine).

1. **Rust:** `scratchpad/red-p005-r3/ws` is a copy of the round-2 thin-wrapper workspace with HEAD's `polish_005_perf.rs`. Mutation patch `mut.py`:
   - incremental `inc_live`/`inc_csum` used by `metrics()`;
   - `metrics_full_scan()` is the original;
   - `LC_MUT=1` skips the update in `remove_gridlocked`;
   - `LC_MUT=2` undoes it for `spawn_with_route`.
   
   `r3.sh` runs `cargo test -p sim-core --release --test polish_005_perf incremental` for MUT 0/1/2. Results: pass / fail at tick 1470 / fail at tick 0.

   The full file in release (MUT 0) gives 3 passed, and fails `metrics_is_cheap` and `branch_shares_snapshots`. Test 2 in debug passes.
2. **Web:** `scratchpad/red-p005-r3/wweb` is the round-2 minimal implementation with HEAD's tests.
   - 7b fails before the client/App/protocol edit.
   - After the edit, `tsc --noEmit` is clean. polish005, host, review2, review3, sim and integration give 33 passed, with 5 doc-only failures.
   - The constant-side mutant (`, 0)`) passes 7b, which is the evidence for m1.
3. **Repo HEAD:** `pnpm -C web exec vitest run tests/polish005.test.ts` gives 5 failed (7, 7b, 9, 9b, 10) and 1 passed (6).
4. The e2e test 8 was not run: it changed only by `deadTick`, and HEAD fails at `debugTrap`, as round 1 showed.
5. `git status` is clean apart from this file.
