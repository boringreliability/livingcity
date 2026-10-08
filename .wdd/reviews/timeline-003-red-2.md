# timeline-003 Red review, round 2

**Verdict: REJECTED** (0 BLOCKER, 2 MAJOR, 7 MINOR)

Reviewed at commit cf83c83:
- `web/tests/timeline.test.ts` (sha256 `87a5ad5b5d42ddc893a554eb7f0e602c54dd8423f18fb6c7966b9e2c99635b00`), tests 1–10 and 20;
- `web/e2e/timeline.spec.ts` (sha256 `c6744c1682fd8b4bf59e2c14db8b0e7c3106a4184f6ce407deeeb5e6c26afa9f`), tests 11–19.

I checked them against `.wdd/wards/timeline/ward-003.md`, `.wdd/epics/timeline.md` § T3, `livingcity.md`, CLAUDE.md, `crates/sim-core/src/{timeline,world}.rs`, `crates/sim-wasm/src/lib.rs`, `web/src/sim/{host,clock,protocol}.ts`, `web/src/App.tsx`, `web/src/ui/*` and the frozen suites. I am a fresh reviewer; round 1 is `timeline-003-red-1.md`.

## What I ran
- **Vitest:** `vitest run` gives 18 files, 91 tests: 80 frozen pass, and the 11 new ones fail only on the missing API (`timeline` undefined, `window_metrics is not a function`, no errors for the new messages).
- **Native premise probe for test 20** (`scratchpad/red2-tl003/probe`, sim-core `Timeline::new(three_bridges(17,23), 48 MiB)`, `step_n(1200)`):
  - `window()` = start 0, head 1200, position 1200, 387,670 bytes, **11 snapshots**;
  - `window_metrics(400)` = gen 282, completed 117, 0/0 removed, incomplete 165, mean 237.65 ≤ p95 326;
  - `window_metrics(1200)` = all zero, mean/p95 `None`. Trips spawned in the step to 1200 carry `created_tick` 1199, so the empty-cohort premise holds.
  - All premises of test 20 hold.
- **Browser probe** (`scratchpad/red2-tl003/e2e/probe.spec.ts`, own vite on port 5191, SwiftShader, 1280×800, the current app):
  - **Test 11 derivation:** maxY = 680.4 px (from diagonal connectors 307/327). The both-endpoints-within-2-px filter finds **22 links** (0–9, 142–151, 288/289), so the `≥ 10` precondition holds. With today's layout, every sampled point hits `canvas.city`.
  - **Test 14 premise:** a 2 ms `setInterval` reading `snapshot().tick` saw **every tick with no gaps**. At 20× there were 322 consecutive ticks, with p50 of 20 ms between changes. At 5× there were 2 × 151 ticks, at p50 100 ms and max 121 ms. There were no long tasks.
  - **Test 12 slack:** at 20× (the default, 40 ticks/s) frames change every ~20 ms with no long tasks, so the 20-tick slack (≈ 500 ms) in `head − position ≤ 140` is ample.
  - **Test 19:** both north-bridge link centres (y ≈ 141 px) hit `canvas.city`, and `pickAt` returns the right link (286/287).
  - **Test 18:** only 5 tabbable controls precede the bar today (Pause, Speed, Diagnostics, Close the main bridge, Legend), so 60 Tabs is ample.

## Round-1 findings: status
- **M1 (pauses never tested): resolved.**
  - Test 1 runs before the seek. Test 4 runs before the seek and checks backlog and `ticksMeasured`. Test 6 runs A before the branch and runs B before `viewScenario`.
  - E2E: tests 12 and 13 start running and poll `running === false`; test 15 switches to A while B runs.
- **M2 (round-trip races): resolved.** `stepBack` polls each ← (`:43-51`) and is used in tests 12 and 14–19. The ward now defines the "last requested position".
- **M3 (buttons not exercised): resolved.** Test 12 (`:122-131`) checks all four buttons, and test 18 collects names over 60 Tabs. See m3 for a remaining coupling.
- **M4 (road panel / B's past): resolved.** Test 19 was added and the ward row exists.
- **M5 (test 11): resolved.**
  - The memory text is tied to `snapshotBytes`.
  - The bottom edge is derived in the page (verified: 22 links).
  - The check now compares against `canvas.city`.
  - The window-start and head labels are checked (see m2).
- **M6 (`window_metrics` untested): resolved.** Test 20 was added, and its premises were verified natively.
- **Minors.**
  - **Resolved:** m1 (test 14 now captures in the page during the replay), m3 (B equals A at the branch point), m4 (B-button time, branch marker, "Viewing" gone after discard), m5 (dialog counter and the 300 ms wait after Cancel), m7 (the window includes the warm-up), m8 (the deviations section).
  - **Partly resolved:**
    - m2: the sim-time strip is checked, but nothing checks that the vehicle panel closes on a seek in the e2e suite.
    - m6: the ← clamp is tested, but the drag "one pending seek" is still untested.

## BLOCKER
None.

## MAJOR
1. **"At A's head a close/open is an ordinary command" is never tested when A is paused at its head, or after a replay has caught up.**
   - **T3 requires it:** "At the head, a close or open is an ordinary command". Ward Outputs: "at A's head it is ordinary".
   - **No test covers it.**
     - Every timeline test intervenes in a past (15–19).
     - The frozen tests that click "Close the main bridge" never look at `scenario` / `branchTick`.
     - The only frozen test that would notice a wrongful branch is `city.e2e.spec.ts:249`, and only because a branch pauses a *running* sim. `inspect.spec.ts:289` closes while paused at the head and then presses Space, so a wrongful B at the head passes it unchanged.
   - **The plausible bug.** The ward makes intervention logic use the *last requested* position. An implementation that keeps the requested position at the last seek target after Play has replayed past the head (test 14's path) will, after a pause, see `requested < head` and create B at a stale tick, or ask "Replace the branch?". All 20 tests pass.
   - **Fix.** Extend test 14 (`timeline.spec.ts:183-185`) after the replay has passed the old head:
     ```ts
     await pause(page);
     const live = (await snap(page)).timeline;
     expect(live.positionTick).toBe(live.headTick);
     await page.getByRole('button', { name: /close the main bridge/i }).click();
     await sleep(300);
     await expect(page.getByText('Replace the branch?')).toHaveCount(0);
     let s = await snap(page);
     expect(s.scenario).toBe('A');
     expect(s.branchTick).toBeNull();
     expect(s.timeline.headTick).toBe(live.headTick);
     await blur(page);
     await page.keyboard.press('Space');
     await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(s.landmarks!.central_bridge));
     expect((await snap(page)).scenario).toBe('A');
     ```
     Optionally add the same check after `End` in test 12.

2. **The clock reset on `branch`, `viewScenario` and `discardBranch` is untested, which breaks the frozen frame invariant `frame.tick === clock.executedTicks`.**
   - **The invariant is established.** It is asserted for every frame in `host.test.ts:185`, `diagnostics.test.ts:268` and `gold_city005.test.ts:79`.
   - **The ward requires a reset on each switch:**
     - "resets the clock to B's tick" (branch);
     - "resets the clock to the newly viewed scenario's tick" (viewScenario);
     - "each scenario has its own executed ticks, which the clock reflects for the viewed one".
   - **Coverage.** Only test 4 checks `executedTicks`, and only after a seek.
   - **Result.** A host that forgets `resetExecuted` / `resync` on branch, view or discard passes tests 6, 8 and 9 while every later frame has `clock.executedTicks ≠ tick`. The diagnostics' sim time and pacing then report a different scenario's tick.
   - **Fix.** At the end of tests 6, 8 and 9 (and 1 and 5 for free), add:
     ```ts
     for (const f of x.frames()) expect(f.clock.executedTicks).toBe(f.tick);
     ```
     In test 6, also add `expect(f.clock.backlogTicks).toBe(0)` after `viewScenario` (`timeline.test.ts:193`).

## MINOR
1. **Test 12's first ← reads the frame right after `running` turns false** (`timeline.spec.ts:97-100`).
   - If the UI also pauses locally, or sends `setRunning(false)` before `seek`, a paused frame at the head can arrive before the seek frame. In that case `head − position = 0` and the test fails spuriously.
   - **Fix:** poll the condition:
     ```ts
     await expect.poll(async () => { const s = await snap(page); return !s.running && s.timeline.headTick - s.timeline.positionTick >= 120; }).toBe(true);
     ```
     Then assert `≤ 140`.
2. **Test 11's head label is not independently checked** (`:67-68`). The bar is paused at the head, so the playhead label already shows `hms(hi)`, and a missing head label passes.
   - **Fix:** `stepBack(page)` first, then expect `hms(lo)`, `hms(hi)` and `hms(hi − 120)` all in the bar.
3. **Test 18 derives names from `aria-label ?? textContent`** (`:273-276`), not from the accessible name.
   - A correct slider labelled through `aria-labelledby`, or a button with an icon glyph in its text (for example "⏮ Jump to start"), fails.
   - **Fix:** on each Tab, check which target locator is focused:
     ```ts
     for (const [n, loc] of targets) if (await loc.evaluate((e) => e === document.activeElement)) names.add(n);
     ```
     where `targets` = `slider(page)` and `getByRole('button', { name })`.
4. **Test 19's "no error alert" is checked at once** (`:303`). If the UI sends a refused `command` as well as `branch`, the alert can render after the assertion has already passed.
   - **Fix:** `await sleep(300)` before `toHaveCount(0)`, or poll `errors` through a hook.
5. **Test 20 cannot detect a swap of `removed_unreachable` / `removed_gridlock`.** Both are 0 at 1200, verified.
   - This is acceptable for a layout test. Optionally assert the exact natively verified values `[400, 1200, 282, 117, 0, 0, 165]`, or document the limitation.
6. **Carried from round 1:**
   - No e2e test checks that an open vehicle panel closes on a seek (`trackedTrip === null`).
   - The Spec's "a drag never queues more than one pending seek" is not tested. The Gold reviewer must check it in code (throttle ≥ 100 ms plus a single final seek).
7. **Ward inconsistencies.**
   - `ward-003.md` § Tests still says "Vitest … tests 1–10" and "Playwright … tests 11–18". These should be 1–10 + 20 and 11–19.
   - The "Test hook additions" list ends with a dangling `;` after the removed `seekForTest` line.
   - Row 11 still quotes the old regex: update it to the exact `"<x.x> / 48 MiB replay memory"`, `aria-valuenow` and the window-start and head labels.

## Checked and OK
- **Host tests discriminate:**
  - **1:** run, seek, paused, head unchanged, hash equals the reference.
  - **2 and 7:** refusal leaves the timeline equal.
  - **3:** the per-frame payload, and position = tick.
  - **4:** executed, backlog, `ticksMeasured` and the inspection reset.
  - **5:** per-frame hash across the old head.
  - **6:** B at 800 equals A's seek frame (metrics and `linkCounts`), A's hash and head are untouched, and A's position is preserved.
  - **8:** B's head is cut, and A's hash is unchanged.
  - **9:** replace and discard, and A's position is preserved.
  - **10:** refusals during the warm-up, nothing deferred.
- **Determinism premises.**
  - `Timeline::branch` works at a tick below A's current position, because it restores from a snapshot plus the logs prefix.
  - `metrics` are pure `World::metrics()` (`sim-wasm/src/lib.rs:223`), so test 6's and test 14's metric equalities are sound.
- **Frozen e2e conflicts: none in the tests.**
  - New button names stay unique against `/main bridge/i`, `exact: 'Play'` and `'Pause'`.
  - The bar comes after the legend in the DOM.
  - The look test's pan start at canvas bottom −140 px (y = 660) is above the bottom road (y ≈ 680), which test 11 already forbids covering.
  - The Gold reviewer must still run every frozen e2e spec after the layout change.
- **No test depends on `seekForTest`**, which was removed from the ward.
- **Every e2e step that intervenes waits** for its seek frame first.
- **The native-dialog counter is asserted** in tests 15–19.
