# polish-005 Red review, round 2

**Verdict: REJECTED** (0 BLOCKER, 3 MAJOR, 6 MINOR)

Reviewed at HEAD `0452d5c`. sha256 of the test files:
- `crates/sim-core/tests/polish_005_perf.rs`: `e0a92f6cc6df8f97079b7b6c96c6493c8ca93d824cb06d8fd905003e2d37a21a`
- `web/tests/polish005.test.ts`: `f7d4ecf08311ba988cac42bdd46db10882de47884cfac56d4f822282aa3b95f9`
- `web/e2e/restart.spec.ts`: `672765d98e226cab150c186697239e415fe6ccd689894409b10509bbf007c021`

## Round-1 findings

| R1 | Status | Evidence |
|---|---|---|
| B1 test 6 vs frozen G4/G4b | **Resolved in the tests.** The spec still contradicts it (see M2 below). | Test 6 no longer bounds paused frames. With a per-side pool implementation, G4/G4b/F2/F6/G8 pass. |
| M1 periodic order not pinned | **Resolved** | The order probe was re-run against the new test 1. Trip-id periodic order (MODE 3) now fails at `×5 right after the closure, tick 2001`. Reversed periodic order (MODE 1) fails `×5 timeline`. Reversed retries (MODE 2) and trip-id retries (MODE 4) fail `three_bridges timeline`. All golden hashes, including the 6 new ones, pass on the unmodified pre-ward code. |
| M2 step improvement unchecked, retry check vacuous | **Resolved**, with a residual (m3) | Test 10 now asserts `after.x5.stepMs ≤ 0.8 × before`. Feasibility probe on HEAD code at ×5 after 7,200 ticks: the two full scans cost 0.18–0.20 ms of a 0.27–0.30 ms `step` (64–73 %). At ×3 they are 50–55 %. So 0.8× is reachable. The retry half on three_bridges with every bridge closed is now real (`total > 0` holds). |
| M3 identity only through the harness | **Resolved in the host test**, but the client/App half is untested (M1 below) | With a minimal per-side pool (`pools[msg.scenario ?? viewed]`), test 7 passes. HEAD fails it on identity, as intended. |
| M4 clock-reset shortcut, no wiring check | **Resolved** | 9a fails on HEAD with `reset is not a function`. 9b fails on HEAD (tick 2 vs 1 in the first post-init frame). Adding `SimClock.reset()` plus `clock.reset()` in `init` makes 9, 9b and the frozen host/review2/review3/sim tests pass. |
| m1 | Resolved: `inspectVehicle` and `setRunning` added. The returnBuffer loop is moot without a heartbeat. | |
| m2 | Resolved | Probe: at seek 1300 there are 35 no-route and 82 stranded vehicles; at 2100, 204 no-route; at 1900, 209 no-route. |
| m3 | Partially resolved (m4 below) | |
| m4 | Partially resolved: workers are counted. Compare and `messageerror` are still untested (accepted). | |
| m5 | Resolved: `live` is re-read every tick. | |

## Findings

### M1 MAJOR: nothing checks that the client and App send `scenario` with `returnBuffer`
- **Where:**
  - spec `ward-005.md:78` ("the client and App send the side of the frame the buffer came from");
  - `web/tests/polish005.test.ts:105`, which sends `scenario` itself;
  - `web/tests/integration.test.ts` test 3, which checks message *types* only.
- **Problem:** I implemented only the host side: a per-side pool keyed by `msg.scenario ?? viewed`, with `client.ts:69` and `App.tsx:312/334/341/342/350/392` left unchanged. All of polish005 (except the doc test), host, review2, review3, sim and the integration wiring checks pass.
  - In the real app every returned buffer then carries no side and goes to the viewed side.
  - So in compare, B still allocates on every frame. That is exactly e3, which the ward claims to fix. Round 1 asked for this ("Add the field to the integration wiring check").
- **Fix:** Add a static check, for example in `polish005.test.ts`:
  - `client.ts`'s `returnBuffer` takes a second parameter and puts `scenario` into the posted message;
  - every `.returnBuffer(` call in `web/src` (outside `client.ts`) passes two arguments;
  - `protocol.ts`'s `returnBuffer` variant declares `scenario?: 0 | 1`.

### M2 MAJOR: the spec and smoke test still demand an idle paused host, which the tests (rightly) no longer allow
- **Where:**
  - `ward-005.md:96`: "Heartbeat: at most 2 frames/s while paused and idle";
  - `ward-005.md:95`: the pinned list names only "host tests that expect a frame after each message";
  - Smoke step 2 (`:127`, "Pause and watch the browser's CPU: it is near idle") and pass criterion "Paused is near idle" (`:132`);
  - Epic `polish.md:122`, the P5 required outcome "Paused frames … posts only when something changed (e2)".
- **Problem:** `:77` now records e2 as a pinned deviation, but the Specification, the Manual Smoke Test and the epic contract still require the heartbeat.
  - The Gold reviewer executes the smoke test. A correct implementation, which keeps 60 paused frames/s because G4/G4b require it, fails "Paused is near idle" and violates `:96`.
  - That sets up a Gold deadlock over a spec contradiction rather than a defect.
- **Fix:**
  - Delete `:96`. Add review2 G4 and review3 G4b to the pinned list at `:95`.
  - Rewrite smoke step 2 and its criterion. For example: "paused: hover/pan respond; the paused frame rate is unchanged (pinned deviation e2)".
  - Record the e2 deviation against `polish.md:122`, in the epic file or in the backlog/deviation list the epic gate reads.

### M3 MAJOR: test 2 never runs through a gridlock removal (or `spawn_with_route`), which the P5 contract names explicitly
- **Where:** `polish_005_perf.rs:86-150`; epic `polish.md:121`: "a test runs both side by side through a run with closures, **gridlock** and seeks".
- **Problem:** Gridlock removal (`world.rs:1380 remove_gridlocked`) is its own path that takes a vehicle out of a lane. Incremental `on_network`, queued and created-tick-sum counters must be updated there.
  - Probe: `removed_gridlock` is 0 throughout test 2's paths:
    - three_bridges closed at 2400 and at 3600;
    - each seek point;
    - River City ×3 at 14,400 ticks.
  - The frozen ring tests (`city_001_relief` step_checked, `timeline_001` test 4) check counts, conservation and `removed_gridlock`. They do not compare `metrics()` against a full scan.
  - If the counters are snapshotted rather than rebuilt, a restored world drifts identically, so the `timeline_001` metrics fingerprint does not catch it either.
  - So an implementation that forgets to update the counters in `remove_gridlocked`, or in `spawn_with_route`, which the ring uses, passes every test.
- **Fix:** Add the city-001 ring to test 2. Copy the construction, as `timeline_001_snapshots.rs:144` already does. Step it about 3,000 ticks through the first removals and the drain. Call `same_metrics` every tick, or at least every tick in the window around the removals. Also assert `removed_gridlock ≥ 1` as a precondition. Optionally run it through a `Timeline` with a seek across the first removal.

### m1 MINOR: test 6 passes on HEAD and is implied by frozen G4
- **Where:** `polish005.test.ts:40-71`.
- **Problem:** G4 pins about one paused frame per 16 ms iteration, so "a frame within one iteration after each message" holds for any G4-compliant host (it passes today). It is a regression pin, not a Red test.
- **Fix:** Acceptable as is. Either say so in the spec ("passes before the ward; pins the frame-per-message rule"), or make it meaningful: assert that the frame after each message *reflects* the message. For example, after `seek` the frame's `tick === head-60`; after `command` the link is in `closed`; after `setSpeed` `clock.multiplier === 5`.

### m2 MINOR: a vacuous assertion in test 7
- **Where:** `polish005.test.ts:96`.
- **Problem:** `byteLength ≥ 0` is always true, because a detached buffer has `byteLength` 0. Line 95 already covers detachment whenever `count > 0`.
- **Fix:** Remove the assertion, or replace it with `expect(f.vehicles.byteLength).toBe(f.count * 16)` together with `f.count > 0`.

### m3 MINOR: the retry "visits" are still self-reported, and a full retry scan passes the step-improvement check
- **Where:** `polish_005_perf.rs:188-208`, `polish005.test.ts:190`.
- **Problem:** River City ×5 has no retries. Replacing only the periodic scan saves roughly the periodic half of the 64–73 % (by my scan replica), so `after.x5.stepMs` lands near 0.6–0.7 × before and passes 0.8.
  - A `run_retries` that keeps the full slot scan but counts only the due slots passes test 4, because the counter increments after the due check, as the natural code does.
- **Fix:** State in test 4 or the spec that a visit is every slot the retry step *reads*, and that the Gold reviewer must check the code. Optionally add `retries` timing on three_bridges closed to the probe JSON.

### m4 MINOR: test 10's `baseline` check accepts `null`, and the "before" step is not tied to it
- **Where:** `polish005.test.ts:188`.
- **Problem:** `typeof null === 'object'`, so `"baseline": null` passes. The ×5 improvement check uses `before.x5.stepMs`. The spec says that value *is* the `4e5d5c1` measurement, but nothing ties the two together, so a "before" taken under a different load can inflate the ratio.
- **Fix:** For `x1`, `x3` and `x5`, assert that `json.baseline.<scale>.stepMs` is a number and equals `json.before.<scale>.stepMs`.

### m5 MINOR: 9b's "stalls" are not stalls
- **Where:** `polish005.test.ts:168`.
- **Problem:** `advance(8)` is eight ordinary 16 ms iterations.
  - With the fake clock, `step` takes 0 ms, so `msPerTick = 0` and the batch is unlimited. The used host therefore never has a backlog beyond a fraction of a tick and has no real estimate.
  - 9b still fails on HEAD through the leftover achieved window, the backlog fraction and the grace period, so it proves the wiring. 9a covers backlog and estimate.
  - The comment is misleading.
- **Fix:** Give `advance` a step-size parameter and use `t += 120` on every 9th iteration, or correct the comment.

### m6 MINOR: test 8 can read a stale tick after the restart
- **Where:** `restart.spec.ts:32-34`.
- **Problem:** If the UI keeps the dead worker's last frame until the new worker's first frame arrives, `tick > 1800` can be satisfied by the stale tick. `t0` is then the stale tick (about 1,840 at trap time).
  - The final poll still needs the new city to tick past it. At 20× that takes about 1–2 s, so this is not flaky today.
  - However, the "past the warm-up" check proves nothing on its own.
- **Fix:** Before restarting, record `trapTick = await tick(page)`. After the alert is gone, poll until `snapshot().tick` changes away from `trapTick`, or until the timeline head resets, before asserting `> 1800`.

## Checked and found sound
- **Test 1:**
  - All 13 golden hashes hold on the pre-ward code.
  - The intermediate ×5 hashes and the three_bridges timeline/branch pair make every order perturbation I tried fail: reverse or trip-id order for the periodic step, and for the retries.
- **Test 2:** the new three_bridges timeline segment seeks into states with no-route and stranded vehicles and branches there.
- **Test 4:** `live` is re-read every tick. The retry half on three_bridges has real activity.
- **Test 7:**
  - It models the transfer correctly: `structuredClone` with transfer, then returning the new object with its side.
  - A per-side pool satisfies it within the frozen F2/F6/G8 pool rules.
  - The other-side-in-between condition occurs, with at least 10 checks per side.
- **Tests 9/9b:** a full `reset()` (running, multiplier, credit, backlog, estimate, cap/grace state, reports) called from `init` passes both and every frozen host test. Both fail on HEAD for the intended reasons.
- **Test 10's thresholds** are consistent with test 3 (metrics 0.25×) and feasible for `step` (0.8×).

## What I ran
Load during the runs: `uptime` load averages were between 7.6 and 13.4 (shared machine).

1. **Rust scratch copy** `scratchpad/red-p005-r2/ws`: round-1 thin wrappers on the pre-ward code, with HEAD's `polish_005_perf.rs`. `MODE` can now be set by an environment variable.
   - `cargo test -p sim-core --release --test polish_005_perf`:
     - `golden_hashes_hold`, `incremental_metrics_equal_full_scan` and `schedules_visit_only_due_slots` pass;
     - `metrics_is_cheap` fails (0.3635 vs 0.3646 ms);
     - `branch_shares_snapshots` fails (0 vs 172).
   - Order probe, `LC_MODE=1..4` with `golden_hashes_hold` (`modes.sh`), all fail:
     - MODE 1 at `×5 timeline`;
     - MODE 2 at `three_bridges timeline`;
     - MODE 3 at `×5 right after the closure, tick 2001`;
     - MODE 4 at `three_bridges timeline`.
   - `zz_r2::gridlock_and_states`:
     - `removed_gridlock` stays 0 in test 2's paths;
     - no-route and stranded counts at the seek points are as listed under m2 in the round-1 table.
2. **Cost probe** `scratchpad/red-p005-r2/ws2`: pristine HEAD crate plus a read-only replica of the two slot scans (`zz_cost`, 600 steps, 3 repetitions after 7,200 ticks).

   | Scale | `step` (ms) | Two scans (ms) | Share |
   |---|---|---|---|
   | ×1 | 0.022 | 0.0045 | about 20 % |
   | ×3 | 0.14 | 0.074–0.080 | 50–55 % |
   | ×5 | 0.27–0.30 | 0.18–0.20 | 64–73 % |

3. **Web scratch copy** `scratchpad/red-p005-r2/wweb`, with `node_modules` symlinked. Minimal implementation:
   - per-side `pools` keyed by `msg.scenario ?? viewed`;
   - a `SimClock.reset()`;
   - `clock.reset()` in `init`;
   - **client and App left unchanged.**

   `vitest run tests/polish005.test.ts tests/host.test.ts tests/review2.test.ts tests/review3.test.ts tests/sim.test.ts tests/integration.test.ts` gave 32 passed. The only failures were test 10 and integration 5/6/8/9, all missing docs or JSON that were not copied into the scratch copy. Integration 3 (protocol wiring) passes, which is the evidence for M1.
4. **On the repo (HEAD):** `pnpm -C web exec vitest run tests/polish005.test.ts`.
   - Test 6 passes, which is the evidence for m1.
   - The others fail as intended:
     - test 7: identity, side 1;
     - test 9: `used.reset is not a function`;
     - test 9b: tick 2 vs 1;
     - test 10: `frame-cost.json` missing.
5. The e2e test 8 was not re-run. It changed only by the worker counter. Round 1 confirmed it fails at `debugTrap is not a function`.
6. `git status` is clean apart from this file. All probes live in the scratchpad.
