# polish-005 Red review, round 1

**Verdict: REJECTED** (1 BLOCKER, 4 MAJOR, 5 MINOR)

Reviewed at HEAD `5c1e550`. sha256 of the test files:
- `crates/sim-core/tests/polish_005_perf.rs`: `3c048a7ce4ea734d63ccc0aa0507ac8f3cd61cbf076bf13c29eee019a9484f9b`
- `web/tests/polish005.test.ts`: `591dde1110b372d695c1c71521b1a530fcbbd35844f2b8538e9c64de29846e0c`
- `web/e2e/restart.spec.ts`: `ad92f6a12f06142fd59a2b2f181e3b36d322e5e871721c4368ef1f17960c7308`

## What I ran
Load during the runs: `uptime` load averages were between 9.6 and 20.8 (shared machine).

1. **Scratch copy of the workspace with thin wrappers on the pre-ward code** (scratchpad `red-p005/ws`; the repo was not touched).
   - `metrics_full_scan()` is `metrics()`.
   - `last_step_visits()` counts, inside the existing full scans, the live slots with `(tick + trip_id) % 240 == 0` and the retries that are due.
   - `shared_snapshots()` returns 0.
   - A static `MODE` switch changes the visiting order of the periodic and retry steps.
   - `cargo test -p sim-core --release --test polish_005_perf` on it:
     - `golden_hashes_hold` **passes**: all 7 golden hashes re-derived on the pre-ward code.
     - `incremental_metrics_equal_full_scan` passes, as expected for wrappers.
     - `schedules_visit_only_due_slots` **passes on the full-scan code** (see M2).
     - `metrics_is_cheap` fails: 0.332 vs 0.364 ms.
     - `branch_shares_snapshots` fails: 0 vs 172.
     - The failures are the expected ones.
2. **Order-sensitivity probe** (`zz_probe::order_sensitivity`, `per_tick_trip_order`).
   - In the order `[x1 TL, x1 B, x5 TL, x5 B, tb1200, tb2400, tb3600]`:
     - periodic in descending slot order changes `x5 TL` and `x5 B`;
     - retries in descending slot order change `tb2400` and `tb3600`;
     - retries in ascending **trip-id** order change `tb2400` and `tb3600`;
     - periodic in ascending **trip-id** order changes **none** of the 7 golden hashes.
   - Per-tick hashes on River City ×5 with the bridge closed at 2000:
     - The trip-id-ordered periodic queue differs from the slot-ordered one on 18 ticks (2001–2018), then converges again.
     - Slot order and trip order disagree often: 86,822 adjacent inversions over 353,464 enqueues.
   - Retry activity in three_bridges: 6,313 due retries, and 1,369 ticks with more than one retry due.
   - In the River City ×5 closure path, the priority and periodic queue backlogs reach 1,893 and 823.
3. **Cost probe** (`zz_probe::cost_and_due`, River City ×5 after 7,200 ticks, 500 calls, 3 repetitions).

   | Part | ms | Share of `metrics()` |
   |---|---|---|
   | full `metrics()` | 0.32–0.35 | 100 % |
   | queued lane scan alone | 0.0055–0.0061 | **2 %** |
   | `counts()` | ~0.16 | ~50 % |
   | ages `Vec` | ~0.15 | ~45 % |

   - State: active 70,453, on network 6,856, waiting 63,597, no-route 0, stranded 0, queued 2,230.
   - Residues mod 240 are even: from 272 to 309 live slots each, mean 293.6.
   - Over 240 ticks, the worst periodic visits are 1.08 × live/240, against the bound 1.2 + 10/293.6.
   - Retries due: 0, and at most 0 vehicles without a route.
   - Live vehicles grew to at most 72,838 (+3 %).
4. **Snapshot probe** (River City ×1, 21,600 ticks).
   - There are 181 snapshots (62.5 MB, at most 358 KB each). 172 of them lie below `at`.
   - A branch with an 8 MiB budget keeps 22 snapshots below `at` and holds 8,074,506 bytes.
   - Test 5's preconditions hold.
5. `pnpm -C web exec vitest run tests/polish005.test.ts tests/review2.test.ts tests/review3.test.ts`:
   - Tests 6, 7, 9 and 10 fail for their intended reasons: 312 frames > 11, buffer identity, `reset` is not a function, and `frame-cost.json` missing.
   - The frozen review2 and review3 tests (13) pass today, **including G4 and G4b** (see B1).
6. `pnpm -C web exec playwright test e2e/restart.spec.ts`:
   - It fails at `window.__livingcity.debugTrap is not a function`, as intended.
   - The warm-up to tick > 1800 is reached in about 1 s.
7. Afterwards `git status` is clean apart from this file.

## Findings

### B1 BLOCKER: test 6 contradicts frozen tests G4 and G4b; both sides cannot pass
- **Where:** `web/tests/polish005.test.ts:49-51` against two frozen tests:
  - `web/tests/review2.test.ts:107-121` (G4): paused and idle, `advance(100)` at 16 ms, then `expect(frames − n0) ≥ 95`.
  - `web/tests/review3.test.ts:107-122` (G4b): paused, two `command`s, 10 iterations, then `expect(paused.length) ≥ 9`.
- **Problem:** Test 6 requires at most 11 frames in 312 paused, idle iterations, which is at most 2 heartbeats/s.
  - G4 requires about 1 frame per 16 ms in exactly that state: real-wasm three_bridges host, fake 16 ms clock, paused after running at 60×, no messages.
  - G4b requires 9 frames in the 10 iterations after the messages. With "one frame after each message plus at most 2/s", it would get 1–2.
  - No implementation can tell these situations apart, so one of the frozen tests must break.
  - The ward's Specification lists only "host tests that expect a frame after each message" as pinned. It missed G4 and G4b, whose titles literally are "frames keep coming while paused".
- **Fix:** This is a spec conflict with frozen tests. Under the rules it cannot be resolved by editing G4/G4b. Either:
  - (a) escalate to the human for an explicit supersession of G4's "≥ 95" and G4b's "≥ 9" (recorded as a deviation), or
  - (b) drop the heartbeat from P5 and keep 60 paused frames/s, so e2 stays open in the backlog, and remove test 6's ≤ 11 assertion.
- Re-check `e2e/*` specs that poll `snapshot()` while paused once the choice is made.

### M1 MAJOR: test 1 does not pin the periodic processing order, despite the spec's claim
- **Where:** `crates/sim-core/tests/polish_005_perf.rs:31-58`; ward spec test 4 says "The golden hashes (test 1) prove the order is unchanged".
- **Problem:** The most natural schedule implementation is a per-residue bucket appended at spawn time, which yields **trip-id order**. My probe enqueued periodic candidates in trip-id order: all 7 golden hashes are unchanged.
  - The order does show in the state: the hashed `periodic_queue` differs on 18 ticks after the closure.
  - The end states converge again, and the golden hashes are taken only at the end (×5 at 4000/3000).
  - Only a reversed slot order is caught. The retry order is pinned: both reversed and trip-id order change tb2400/tb3600.
- **Fix:** Pin intermediate hashes inside the backlog window, recorded from pre-ward code. For example:
  - River City ×5, a plain `World` with the central bridge closed at 2000;
  - `state_hash` at ticks 2005, 2010 and 2017 (any tick in 2001–2018 differs under trip order);
  - assert them in test 1.
- Alternatively, add a doc-hidden reference `enqueue_periodic_full_scan` and assert in test 4 that the queue tail it produces equals the schedule's, tick by tick, through that window.

### M2 MAJOR: no test fails if `step` still scans every slot
- **Where:** `polish_005_perf.rs:131-143` (test 4) and `web/tests/polish005.test.ts:145-174` (test 10).
- **Problem 1: the visit counter is self-reported.** My wrapper counted "visited" as the residue-due live slots *inside the unchanged full scan*, and test 4 passed (worst 1.08 × live/240).
- **Problem 2: the retry half is vacuous.** River City ×5 has 0 vehicles without a route (measured), so `retries == 0` holds for any implementation.
- **Problem 3: test 10 checks nothing about the result.** It only checks that the before/after numbers exist and that the doc cites them. It never asserts that "after" is better.
- Together, the ward's central claim (e1: superlinear `step` fixed) is untested.
- **Fix:**
  - In test 10, assert the result on the recorded data:
    - `after.x5.stepMs ≤ 0.8 × before.x5.stepMs` (or `baseline.x5.stepMs`);
    - `after.x5.metricsMs ≤ 0.25 × before.x5.metricsMs`.
  - Make the retry half real: run test 4's retry assertion on three_bridges with all bridges closed. That world has thousands of due retries, measured at 6,313 over 2,400 ticks. There, assert:
    - `retries ≤ (no_route + stranded)` each tick;
    - the sum over 60 consecutive ticks is ≤ 1.1 × (no_route + stranded) + 5 and > 0.

### M3 MAJOR: test 7's identity check is only achievable through an artifact of the test harness
- **Where:** `web/tests/polish005.test.ts:94-104`.
- **Problem:** In the browser, `postMessage(msg, [vehicles])` detaches the worker's buffer, and `client.returnBuffer` (`client.ts:69`) transfers it back as a **new** `ArrayBuffer` object.
  - `returnBuffer` carries no `scenario` (`protocol.ts:57`). The host therefore cannot know which side a returned buffer belongs to.
  - In this test, `post` pushes plain objects with no transfer. So a `WeakMap<ArrayBuffer, side>` keyed on the *posted* object passes the test and does nothing in the real worker.
  - The test thus rewards an implementation that only works in the harness. The spec's own note ("the pool must know a returned buffer's side") is not reflected in the test.
- **Fix:**
  - Model the transfer in the test: `const back = structuredClone(f.vehicles, { transfer: [f.vehicles] })`, keep `last[side].buffer = back`, and send `back`.
  - Add `scenario: 0 | 1` to `returnBuffer`, wired through `client.returnBuffer(buffer, scenario)` and every `App.tsx` call site (lines 312, 334, 341–342, 350, 392), with the test sending it.
  - The frozen F6/G8 sends without `scenario` must keep working (treat a missing side as the viewed side, or any side).
  - Add the field to the integration wiring check.

### M4 MAJOR: test 9 does not exercise backlog or credit, nor that `init` resets the clock
- **Where:** `web/tests/polish005.test.ts:126-142`.
- **Problem 1:** `used.setRunning(false)` (line 135) already sets `backlog = 0` and `creditedUntil = now` (`clock.ts:47-48`). Then `run()` calls `setRunning(true)`, which resets `creditedUntil` again.
  - A `reset()` that never touches backlog or credit passes, although those are two of the four f1 items in the spec.
- **Problem 2:** Nothing checks that `init` calls `reset()`, and f1 is exactly the bug that `init` resets only `executedTicks`. An unwired `reset()` passes.
- **Fix:**
  - Remove line 135, so the clock is reset while running with a backlog. If `reset()` also clears `running`, the following `setRunning(true)` in `run()` starts it like the fresh clock.
  - Add a host-level check:
    1. Start a real-wasm host and run at 60× with stalls (`t += 120`) so it builds a backlog and an estimate.
    2. Send `init` again while running.
    3. Compare the next frames' `clock` (`achievedTicksPerS`, `backlogTicks`, `behind`) with those of a freshly created host on the same fake time line.

### m1 MINOR: test 6 does not return buffers, and its message list is incomplete
- **Where:** `polish005.test.ts:48-66`.
- **Problem:** The real UI returns every frame's buffer (`App.tsx:312`, `392`).
  - An implementation that posts "one frame after every handled message" and counts `returnBuffer` as such a message creates a frame → return → frame loop. That loop keeps paused at 60 frames/s, and test 6 does not see it.
  - The message list also omits `inspectVehicle`, `branch`, `compare`, `discardBranch` and `setRunning(false)`, which the spec names ("and so on").
- **Fix:** Inside the idle window, `send({type:'returnBuffer', buffer})` for every posted frame. Add `inspectVehicle` and `setRunning(false)` to the list.

### m2 MINOR: test 2 never restores or branches while stranded or no-route vehicles exist
- **Where:** `polish_005_perf.rs:85-104`.
- **Problem:** The River City ×3 path, which has the seeks and the branch, has no stranded or no-route vehicles at those points. The three_bridges path, which has stranded vehicles and unreachable removals, is a plain `World` without restore.
  - A counter rebuilt on restore that forgets `stranded` or `no_route` passes.
- **Fix:** Run the three_bridges closed case through a `Timeline`. At ticks 2000, 2700 and 3300, `seek(t − 500)`, compare, step 37 and compare. Then branch at `position_tick()` and compare.

### m3 MINOR: test 10 does not check the `baseline` key the spec requires, nor that "before" is consistent
- **Where:** `polish005.test.ts:146-150`.
- **Problem:** The spec records the step means at `4e5d5c1` "in the JSON as `baseline`". Test 10 never reads `json.baseline`.
- **Fix:** Assert that `baseline.{x1,x3,x5}.stepMs` are numbers. Optionally, check that `before.x5.stepMs` lies within ×2 of `baseline.x5.stepMs`.
- Also note the number regex: the doc must put `4e5d5c1`, `polish-005` and similar tokens in backticks, or bare digits from them (for example `4`, `005`) must be JSON leaves. This is not a defect, but the implementer should know.

### m4 MINOR: test 8 does not show that a new worker is created, and does not cover compare
- **Where:** `web/e2e/restart.spec.ts:20-30`.
- **Fix:**
  - Count workers: `let workers = 0; page.on('worker', () => workers++)`, then expect 2 after the restart.
  - The spec says "Other actions (seek, compare)". Compare cannot be reached without a branch here, so either branch first or state that only seek and play are covered.
  - `messageerror` handling (spec) has no test. Acceptable as a source-level item, but name it as untested.

### m5 MINOR: test 4's `live` comes from a single sample
- **Where:** `polish_005_perf.rs:135`.
- **Problem:** `live` is measured once, before 240 ticks of growth. That growth is +3 % today; the margin is 1.08 vs 1.234, so it is fine now but fragile under demand changes.
- **Fix:** Re-read `metrics_full_scan().active` each tick, or use `max(live_before, live_now)`.

## Checked and found sound
- **Test 1:** the golden hash values are correct, re-derived on the pre-ward code through thin wrappers. The retry order is pinned by tb2400 and tb3600.
- **Test 2:** compares the full `metrics_to_extended_array`, all 18 fields, bit for bit. Bit-exact equality is achievable: `DT = 0.5`, so ages are exact binary fractions and a running `Σ created_tick` reproduces the scan's sum exactly.
- **Test 3:** the 0.25 ratio is achievable even if `queued` stays a lane scan (2 % of the full scan at ×5). Same-process timing makes it robust under load.
- **Test 5:**
  - The preconditions hold: 172 snapshots below `at`, 22 kept under 8 MiB, 8,074,506 bytes.
  - The semantics (shared means the same `Arc`; B's snapshot at `at` is not shared) are consistent with the spec.
  - The independence checks are trivially true with immutable `Arc` snapshots. That is acceptable.
- **Test 8:** a wasm panic in a wasm-bindgen call surfaces in the worker as a JS `RuntimeError: unreachable`. The host's try/catch (`host.ts:586`/`627`) catches it, so it does not become a page error. The "no page error" expectation is reasonable.
