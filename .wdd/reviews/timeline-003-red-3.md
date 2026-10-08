# timeline-003 Red review, round 3

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 3 MINOR)

Reviewed at commit 6e8e114:
- `web/tests/timeline.test.ts` (sha256 `520101a002e6481edd6fe7d94013c7c4c3c7dcbe160c9a87c06dfa6ebb76cf10`), tests 1–10 and 20;
- `web/e2e/timeline.spec.ts` (sha256 `dd4eb8d045bfbc22bdf46544173da87be4d4a76ca6f6bcef379118b02ce87993`), tests 11–19.

I checked them against `.wdd/wards/timeline/ward-003.md`, `.wdd/epics/timeline.md` § T3, `livingcity.md`, CLAUDE.md, `crates/sim-wasm/src/lib.rs`, `web/src/sim/{clock,protocol}.ts`, `web/src/ui/testHook.ts`, `web/src/App.tsx`, `web/src/render/layout.ts` and the frozen suites (`host.test.ts:185` for the frame/clock invariant). I am a fresh reviewer; rounds 1 and 2 are `timeline-003-red-1.md` and `-red-2.md`.

## What I ran
- **Vitest:** `vitest run` gives 18 files, 91 tests: 80 frozen pass, and the 11 new ones fail only on the missing API.
- **Native probe for test 20's pinned values** (`scratchpad/red2-tl003/probe`, re-run): `World::from_scenario(three_bridges(17,23).scenario)` wrapped in `Timeline::new(_, 48 MiB)`, `step_n(1200)`:
  - `window_metrics(400)` = `[400, 1200, 282, 117, 0, 0, 165]`, mean 237.65, p95 326;
  - `window_metrics(1200)` = all zero, means `None`;
  - window = start 0, head 1200, position 1200, 11 snapshots.
  - `Sim::three_bridges` builds its world in exactly the same way (`sim-wasm/src/lib.rs:34-36`, `from_city`), so the pin at `timeline.test.ts:290` is sound.
- **Browser probe** (`scratchpad/red3-tl003/e2e/layout.spec.ts`, own vite on port 5189, SwiftShader, 1280×800, the current app):
  - **Layout today:** metrics strip at y 728–784 (x 16–535), legend at y 734–784, bottom road centreline at y 680.4, and roads span x 180–1100.
    - A full-width bar under the strip and legend therefore has ~44 px before the strip reaches the road, or FIT_INSETS can grow.
    - Test 11's no-cover requirement is feasible, so the tests do not force a frozen-test conflict.
  - **Test 14's new premise:** with the sim paused at the head, "Close the main bridge" leaves `closed` empty until play, and after Space `closed` contains `central_bridge` (284/285). The 300 ms check and the post-Space poll in test 14 match how the app actually behaves.
- `snapshot().metrics` is a `Record<string, number>` (`testHook.ts:11`, `App.tsx:235`), so test 14's `{ ...s.metrics }` versus `s0.metrics` comparison is like for like.

## Round-1 and round-2 findings: status
- **r1 M1–M6: still resolved.** I re-verified the paths that round 2 cited, and none of them regressed.
- **r2 M1 (an ordinary command at A's head after a replay): resolved** (`timeline.spec.ts:193-207`).
  - After the replay has passed the old head, the test pauses and asserts position = head. It then clicks "Close the main bridge" and checks: no prompt, `scenario` 'A', `branchTick` null and the head unchanged. Space then closes the bridge in A.
  - A UI that keeps a stale requested position (< head) would send `branch` and turn `scenario` into 'B', so the bug is caught.
- **r2 M2 (clock reset on branch, view and discard): resolved.**
  - `frame.tick === clock.executedTicks` is asserted for every frame in tests 1, 5, 6, 8 and 9 (`timeline.test.ts:76,157,202,239,264`).
  - `backlogTicks` is 0 after `viewScenario` (`:198`).
  - A host that skips `resetExecuted` on branch, view or discard fails these.
- **r2 m1: resolved.** Test 12 now polls `!running && head − pos ≥ 120` (`:100-105`).
- **r2 m2: resolved.** Test 11 steps back first, then checks the start, head and playhead labels separately (`:67-71`).
- **r2 m3: resolved.** Test 18 checks focus by locator identity (`:292-306`), not by text.
- **r2 m4: resolved.** Test 19 waits 300 ms before the no-alert check (`:330`).
- **r2 m5: resolved.** Test 20 pins the natively verified values, so the field order is fixed.
  - Swapping `removed_unreachable` and `removed_gridlock` is still undetectable, because both are 0. That is acceptable for a layout test.
- **r2 m6: still open** (see m1 below).
- **r2 m7: mostly resolved.**
  - The test ranges are corrected and the dangling `;` is fixed.
  - Row 11 still omits `aria-valuenow` and the labels (see m2).

## BLOCKER
None.

## MAJOR
None.

## MINOR
1. **Carried from rounds 1 and 2** (no e2e coverage):
   - **The vehicle panel closing on a seek** (`trackedTrip === null` after ← with a vehicle followed) is covered only at host level (test 4). Optionally add this to test 12:
     ```ts
     // click a vehicle, then ←
     await expect.poll(async () => (await snap(page)).trackedTrip).toBeNull();
     ```
   - **"A drag never queues more than one pending seek"** is untested. The Gold reviewer must check it in code: a throttle of at least 100 ms plus a single final seek on release.
2. **`ward-003.md` row 11 under-describes test 11.** The row does not mention the `aria-valuenow` check, the exact `aria-valuetext` "sim time hh:mm:ss", or the start, head and playhead labels that the test asserts. Update the row text; the test itself is correct.
3. **Test 20's exact pin couples a frozen layout test to model calibration** (`timeline.test.ts:290`). If a later ward changes demand or behaviour, it fails although the layout is still right.
   - This is acceptable within this epic.
   - If calibration changes later, the honest fix is a new ward test, not an edit to this one.
   - Optionally note the dependency in a comment.

## Checked and OK
- **Host tests discriminate:**
  - **1:** seek while running, paused, head unchanged, hash equals the fresh reference at 500, still paused 20 iterations later, clock invariant.
  - **2 and 7:** refusal leaves the timeline and the hash equal. In 7, a wrongly accepted command would cut A's head through `Timeline::schedule`, so `timeline` `toEqual` catches it even though the current hash would not change.
  - **3:** numeric timeline, budget 48 MiB, ordering, position = tick, branchTick −1.
  - **4:** reset during running, and stale `inspectVehicle` refused.
  - **5:** per-frame hash across the old head, more than 20 checks.
  - **6:** B at 800 equals A's seek frame, A's hash and head untouched, A's position preserved after A ran, closed list.
  - **8:** B's head is cut, and A's hash is unchanged.
  - **9:** replace below A's position, and discard returns A at its own tick.
  - **10:** three refusals during the warm-up, nothing deferred.
  - **20:** layout, partition, NaN for the empty cohort, and the `timeline_info` order.
- **E2E premises.**
  - Every intervention waits for its seek frame (`stepBack` polls).
  - The dialog counter is asserted in tests 15–19, and inline confirmations are used.
  - The speed label "5×" exists (frozen `city.e2e.spec.ts:376`).
  - `.simtime .value` exists (`MetricsStrip.tsx:26`).
  - Button names stay unique for substring matching against the existing controls (Pause, Speed, Diagnostics, Close the main bridge, Legend, Close link, Follow).
- **No conditional or tautological assertions remain.**
  - Test 14's `__atHead ?? null` turns a missed capture into a failure (`null ≠ metrics`).
  - Test 13's `seen.size ≥ 3` fails a release-only implementation.
  - Test 11's `bottom ≥ 10` precondition guards the hit-test sample.
- **Frozen suites are unchanged** at this commit (`git diff HEAD~1 HEAD` touches only the two timeline test files, the ward and the review log). The Gold reviewer must still run every frozen e2e spec after the layout change.
