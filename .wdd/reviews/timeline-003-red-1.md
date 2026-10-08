# timeline-003 Red review, round 1

**Verdict: REJECTED** (0 BLOCKER, 6 MAJOR, 8 MINOR)

Reviewed at commit 6a23a56:
- `web/tests/timeline.test.ts` (sha256 `a57d7aee11e595ce3478cdd1630dbe783307fac7793bca4d413db9b38467c5ac`), tests 1–10;
- `web/e2e/timeline.spec.ts` (sha256 `3cd8ff83374478b02723ec8877c5b48300557a775c915e43c16965082d336bf5`), tests 11–18.

I checked them against `.wdd/wards/timeline/ward-003.md`, `.wdd/epics/timeline.md` § T3, `livingcity.md` (Replay and branching, keyboard/labels), CLAUDE.md, `crates/sim-wasm/src/lib.rs`, `crates/sim-core/src/timeline.rs`, `web/src/sim/{host,protocol,clock}.ts`, `web/src/App.tsx`, `web/src/ui/*`, `web/src/styles.css` and the frozen suites.

## What I ran
- **Frozen vitest baseline:** `vitest run` gives 17 files and 80 tests passing. All 10 failures are in `timeline.test.ts`, which is expected because the API is missing (`timeline` undefined, no errors for the new messages).
- **Scratch premise test** (`scratchpad/red-tl003/premise.test.ts`, using the real wasm and the current host):
  - three_bridges at 60× with a 16 ms fake clock reaches tick 900 in 469 iterations, at most 2 ticks per frame. Every tick from about 0 up is visible in some frame.
  - After pausing: `running` false, `backlogTicks` 0, `executedTicks` 900.
  - `inspectVehicle {frameTick: 900, record: 0}` resolves (trip 303, driving).
  - The premises of tests 1, 4, 5 and 8 hold.
- **Geometry and cost probe** (`scratchpad/red-tl003/{geo,bottom}.mjs`):
  - River City spans y −1800 … 1940 and x −3000 … 3140. The south bridge (links at y = −1800, x ±200) is at the bottom edge.
  - There is also a **full-width bottom road at y = −1800 from x −3000 to 3000** (links 0–9, 142–151, 288/289).
  - In node wasm, stepping River City 0 → 1800 takes 77 ms and 120 ticks at 1800 take 4.5 ms, so one seek replays ≤ 119 ticks cheaply.
- **Window premise.** `Sim` wraps a `Timeline` from construction (tick 0), and the host warm-up steps through it. Snapshots are about 0.35 MB (ward-001), so 48 MiB holds about 137 snapshots, roughly 2.3 sim hours.
  - In the app, `window_start` therefore stays **0** after the 1,800-tick warm-up; it is not 1800.
  - `ready()`'s second poll (`head − start > 600`) is satisfied at once. That is harmless, but its comment assumes a window that starts after the warm-up (see m7).

## BLOCKER
None.

## MAJOR
1. **"A seek / branch / view switch pauses" is never tested. Every test pauses before acting.**
   - **Vitest.** `runTo()` ends with `setRunning(false)` (`timeline.test.ts:39`).
     - The `running === false` checks in test 1 (`:66`), test 6 (`:164`) and test 2 (`:87`) are therefore tautological.
     - So is `backlogTicks === 0` in test 4 (`:121`): `setRunning(false)` already zeroes the backlog, as my probe shows.
     - `viewScenario` in test 6 (`:173`) is sent after B was paused (`:168`).
   - **E2E.** Tests 12, 13 and 14 call `pause()` before the first seek. The "pressing ← pauses" check in test 12 (`timeline.spec.ts:58`) is tautological.
   - **Result:** a host that never calls `setRunning(false)` on `seek`, `branch` or `viewScenario` passes every test, even though the T3 contract says "A seek pauses the scenario".
   - **Fix:**
     - **Test 1:** after `x.runTo(1000)`, add
       ```ts
       x.send({ type: 'setRunning', running: true }); x.iterate(3);
       expect(x.last().clock.running).toBe(true);
       const head = x.last().timeline.headTick;
       ```
       Then seek and keep `expect(f.clock.running).toBe(false)` and `headTick === head`.
     - **Test 6:** send `setRunning(true)` + `iterate(2)` before the `branch`, and keep `:164`.
     - **Same test:** move the `setRunning(false)` at `:168` to *after* `viewScenario` and assert `x.last().clock.running === false`.
     - **Test 4:** run (`setRunning(true)`, `iterate(3)`) before the seek, so that the backlog-0 assertion means something.
     - **Test 12:** add a running variant before `pause()`:
       ```ts
       await ready(page);                       // the app auto-runs
       expect((await snap(page)).running).toBe(true);
       await slider(page).focus();
       await page.keyboard.press('ArrowLeft');
       await expect.poll(async () => (await snap(page)).running).toBe(false);
       const s = await snap(page);
       expect(s.timeline.headTick - s.timeline.positionTick).toBeGreaterThanOrEqual(120);
       expect(s.timeline.headTick - s.timeline.positionTick).toBeLessThanOrEqual(140);
       ```
       Then `End`, `pause()` and continue with the exact arithmetic.
     - **Test 13:** start the click with the sim running and assert `running === false` afterwards.

2. **E2E tests act on a position they have not waited for, which races the worker round trip.** Each of these reads the position, or intervenes, right after a key press, before the seek frame has arrived:
   - test 14 `:101-103` (two ← presses back to back; the second ← may be computed from the stale `aria-valuenow`, and then `head − 240` is never reached);
   - test 15 `:121-124` (`pos` is read with no poll, so it can be `head` or `head − 120`);
   - test 16 `:151-152` and `:158-160`;
   - test 17 `:183-184`;
   - test 18 `:209-210`.

   **Consequences:**
   - If "Close the main bridge" is clicked while the UI still believes position = head, it becomes an ordinary command on A. No B is created, and tests 16, 17 and 18 time out.
   - In test 16 a stale `newPos` equals `firstBranch`, so the final `branchTick === newPos` fails, or passes without proving a *new* tick.
   - Under SwiftShader the main thread is busy drawing, which widens the window.
   - The ward also never says whether consecutive keys accumulate from the requested position or from the last frame.

   **Fix:** add a helper and use it everywhere ← is pressed before an action.
   ```ts
   async function stepBack(page: Page, n = 1): Promise<number> {
     for (let k = 0; k < n; k++) {
       const p = (await snap(page)).timeline.positionTick;
       await page.keyboard.press('ArrowLeft');
       await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p - 120);
     }
     return (await snap(page)).timeline.positionTick;
   }
   ```
   - Tests 14 and 15: `const pos = await stepBack(page, 2)`.
   - Test 16: `await stepBack(page)` for the first branch, then `const newPos = await stepBack(page); expect(newPos).toBe(firstBranch! - 120);`.
   - Tests 17 and 18: `await stepBack(page)` before clicking.
   - In the ward, add one line saying the UI's intervention logic and `aria-valuenow` use the last *requested* position.

3. **The timeline buttons are never exercised** (`timeline.spec.ts:198-200` checks visibility only).
   - "Jump to start", "−1 min", "+1 min" and "Live" are ward Outputs, and CLAUDE.md forbids UI controls without effect. Buttons wired to nothing pass.
   - Test 18 also claims they are "reachable by Tab", but it tabs only until the slider.
   - **Fix:** add to test 12, after `pause()`:
     ```ts
     const { headTick: hi, windowStartTick: lo } = (await snap(page)).timeline;
     const pos = async () => (await snap(page)).timeline.positionTick;
     await page.getByRole('button', { name: '−1 min' }).click();
     await expect.poll(pos).toBe(hi - 120);
     await page.getByRole('button', { name: '+1 min' }).click();
     await expect.poll(pos).toBe(hi);
     await page.getByRole('button', { name: 'Jump to start' }).click();
     await expect.poll(pos).toBe(lo);
     await page.getByRole('button', { name: 'Live' }).click();
     await expect.poll(pos).toBe(hi);
     ```
     In test 18, tab up to 60 times and collect the accessible names of the focused elements. The set must contain `Timeline`, `Jump to start`, `−1 min`, `+1 min` and `Live`.

4. **Two of the ward's intervention paths have no test.**
   - (a) **The road panel's Close/Reopen while A is in its past** must create B. The ward's Outputs name it explicitly, but only the main-bridge button and the B key are tested.
     - Today `SelectionPanel.onClose` calls `client.closeLink` directly.
     - Left as is, the host refuses the command, and the user sees an error alert instead of a branch. All 18 tests still pass.
   - (b) **An intervention while *B* is viewed in its past** must edit B's future: an ordinary `command`, with no "Replace the branch?" prompt.
     - This UI decision is untested in e2e. Host test 8 only covers the host.
   - **Fix:** add test 19, `road_panel_in_the_past_branches_and_b_past_edits_b`:
     ```ts
     const s0 = await ready(page);
     await pause(page);
     await slider(page).focus();
     const pos = await stepBack(page);
     await blur(page);
     const road = s0.landmarks!.north_bridge[0];
     const p = (await page.evaluate((l) => window.__livingcity!.linkScreenCenter(l), road))!;
     await page.mouse.click(p[0], p[1]);
     await expect.poll(async () => (await snap(page)).selectedLink).toBe(road);
     await page.getByRole('region', { name: 'Selected road' }).getByRole('button', { name: 'Close link' }).click();
     await expect.poll(async () => (await snap(page)).scenario).toBe('B');
     expect((await snap(page)).branchTick).toBe(pos);
     await expect(page.getByRole('alert')).toHaveCount(0);
     // B: run a little, step back in B, close the main bridge: no confirmation, B's head is cut
     await blur(page); await page.keyboard.press('Space');
     await expect.poll(async () => (await snap(page)).timeline.headTick).toBeGreaterThan(pos + 240);
     await pause(page);
     await slider(page).focus();
     const bPos = await stepBack(page);
     await page.getByRole('button', { name: /close the main bridge/i }).click();
     await expect(page.getByText('Replace the branch?')).toHaveCount(0);
     await expect.poll(async () => (await snap(page)).timeline.headTick).toBe(bPos);
     expect((await snap(page)).scenario).toBe('B');
     expect((await snap(page)).branchTick).toBe(pos);
     ```
     Set `estimated_tests: 19` and add the row.

5. **Test 11 does not check what its row claims** (`timeline.spec.ts:39-47`).
   - (a) **The memory text is not tied to the data.** `/\d+(\.\d)? \/ 48 MiB/` also accepts a hard-coded "0.0 / 48 MiB", yet the ward's Must DO is "the memory window is visible".
   - (b) **The cover check samples only the south bridge**, which sits at x ±200 m, mid-screen.
     - The panels being moved are the metrics strip (bottom-left, `styles.css:177`) and the legend (bottom-right, `:302`).
     - River City has a full-width road along the bottom edge (y = −1800, x −3000 … 3000; links 0–9 and 142–151), and those are exactly the points they could cover.
   - (c) **The cover check accepts any canvas.** `tagName !== 'CANVAS'` passes if the bar itself draws its track on a `<canvas>` that covers the city.
   - **Fix:**
     ```ts
     const s = await snap(page);
     const mib = (s.timeline.snapshotBytes / 1048576).toFixed(1);
     await expect(page.getByText(`${mib} / 48 MiB replay memory`)).toBeVisible();
     const covered = await page.evaluate(() => {
       const h = window.__livingcity!;
       const city = document.querySelector('canvas.city');
       const bottom = [0,1,2,3,4,5,6,7,8,9,142,143,144,145,146,147,148,149,150,151, ...h.snapshot().landmarks!.south_bridge];
       const pts = bottom.flatMap((l) => [0.1, 0.5, 0.9].map((t) => h.linkScreenPoint(l, t)));
       return pts.filter((p) => !p || document.elementFromPoint(p[0], p[1]) !== city).length;
     });
     expect(covered).toBe(0);
     ```
     To avoid hard-coded ids, derive them in the page: take every link whose `linkScreenPoint(l, 0)` and `(l, 1)` y-values are both within 2 px of the maximum over all links.
     Also check the visible window-start and head labels:
     ```ts
     const hms = (t) => { const s = Math.floor(t * 0.5); … };
     await expect(bar).toContainText(hms(lo)); await expect(bar).toContainText(hms(hi));
     ```

6. **`Sim.window_metrics(from)` is a ward Output with no test and no consumer** (ward `:37`; nothing in tests 1–18).
   - Its layout `[from, to, generated, completed, removed_unreachable, removed_gridlock, incomplete, mean | NaN, p95 | NaN]` can ship wrong and still pass, for example with swapped fields or 0 instead of NaN.
   - It is also an orphaned export until timeline-004, which the integration-ward rule forbids.
   - `timeline_info()`'s sixth value, `snapshots`, is likewise never read.
   - **Fix (either):**
     - (a) Move `window_metrics` to timeline-004's Outputs.
     - (b) Add vitest test 20:
       ```ts
       const s = Sim.three_bridges(17, 23); s.step(1200);
       const w = Array.from(s.window_metrics(400));
       expect(w.length).toBe(9);
       expect(w[0]).toBe(400); expect(w[1]).toBe(1200);
       expect(w[6]).toBe(w[2] - w[3] - w[4] - w[5]);
       expect(w[3] > 0 ? w[7] <= w[8] : Number.isNaN(w[7])).toBe(true);
       // from = now: an empty cohort
       const e = Array.from(s.window_metrics(1200));
       expect(e.slice(2, 7)).toEqual([0,0,0,0,0]); expect(Number.isNaN(e[7])).toBe(true);
       const ti = Array.from(s.timeline_info());
       expect(ti.length).toBe(6); expect(ti[5]).toBe(11);   // 0,120,…,1200
       ```

## MINOR
1. **Test 14's determinism check is close to tautological** (`timeline.spec.ts:109-113`).
   - `seekForTest(head)` restores the *original* snapshot ≤ head, which was taken before the replay. `Timeline::step` never overwrites an existing snapshot (`tick > newest`).
   - The check therefore re-tests seek ≡ original, which vitest 1 already covers with the hash. It does not test that *playing* from the past reproduced the old head.
   - Vitest 5 covers this in the host, so the risk is low.
   - **Fix:** step back one minute at 5×, which is 10 ticks/s, so every tick appears in some frame. Capture the metrics in the page with a 2 ms `setInterval` while `snapshot().tick === head` during play, and compare those with `metricsAtHead`.
2. **Parts of the reset are untested.**
   - The host's perf window reset (ward `:54`) has no test. In test 4, assert `x.last().perf.ticksMeasured === 0` on the seek frame.
   - The UI side has no e2e test either:
     - an open vehicle panel closes after a seek (`trackedTrip === null`);
     - the metrics strip's sim time shows the position (`.simtime .value` = hh:mm:ss of `pos × 0.5`).
3. **B's state at the branch point is never compared with A's.** Test 6 should save A's frame after `seek(800)`. Directly after `branch`, before running, assert:
   ```ts
   Array.from(last().metrics)  === Array.from(aFrame.metrics)
   Array.from(last().linkCounts) === Array.from(aFrame.linkCounts)
   ```
   The `then` commands apply on the next tick, so the two are equal at 800.
4. **The colourblind cues are only partly tested.**
   - The branch marker (a diamond with a label) is never asserted.
   - The corner label's pattern frame is not checked.
   - Test 17 does not assert that "Viewing …" disappears after a discard.
   - The B button's time is not checked against `pos`.
   - **Fix:**
     - test 15: `toHaveAccessibleName(\`B: branch from ${hms(pos)}\`)`, and expect a visible element whose text contains `branch ${hms(pos)}` inside the timeline bar;
     - test 17: `await expect(page.getByText(/Viewing [AB]:/)).toHaveCount(0)`.
5. **The native-dialog guard should count dialogs.** `page.on('dialog', () => { throw … })` makes the test hang or time out rather than report clearly.
   - Use `let dialogs = 0; page.on('dialog', (d) => { dialogs++; void d.dismiss(); });` and assert `dialogs === 0` at the end of tests 15–18.
   - Also, after Cancel (`:166-169`), wait about 300 ms before asserting `branchTick` and `scenario`. As written, an asynchronous wrongful `branch` would go unnoticed.
6. **Keyboard edges are untested.**
   - ← at the window start (after Home) must keep `positionTick === windowStartTick` and post no error alert.
   - No test checks that a drag never queues more than one pending seek. At minimum, the Gold reviewer should check this in code.
7. **The spec is ambiguous about whether the window includes the warm-up.**
   - As designed, `window_start` is 0, so Home and "Jump to start" go to an *empty* city at 00:00:00, before the warm-up. The ready() comment (`timeline.spec.ts:17`) assumes otherwise.
   - The tests work either way, but the ward should decide one of two options and say so:
     - "the window includes the warm-up";
     - or start the `Timeline` after the warm-up, with the warm-up stepping the bare world.
8. **The ward does not record its deviations from epic T3.**
   - **Protocol.** T3 specifies `seek {scenario, tick}` and `command.scenario?`. The ward has `seek {tick}` and `command` applying to the viewed scenario, plus new `viewScenario` and `branch.then`.
   - **Seek runs synchronously.** T3 asks for long resimulation in bounded batches (≤ 40 ms). This is acceptable because the replay is at most 119 ticks, but it must be stated.
   - **Memory.** B gets its own 48 MiB budget, so up to 96 MiB in total, while the UI shows only the viewed scenario's "x / 48 MiB". Either state this in the bar ("per scenario") or split the budget.
   - Add a "Deviations from T3" section so the epic gate can report them.

## Checked and OK
- **`seekForTest` is justified.**
  - Test 14 has to seek to an exact old head, which is no longer reachable with the keys once the head has moved, because End goes to the new head.
  - The ward defines it as sending a `seek` "exactly as the slider would". The Gold reviewer should confirm that it calls the same UI handler, with the same pause and inspection-clear path, and does not post to the client directly.
- **Host premises verified on real wasm:**
  - three_bridges reaches 1,000 / 1,200 / 1,300 quickly at 60×;
  - inspection of record 0 resolves;
  - pausing zeroes the backlog;
  - refused seeks leave `snapshotBytes` stable while paused, so `toEqual(before.timeline)` in tests 2 and 7 is sound.
- **Tests 5, 7, 8 and 10 discriminate.**
  - **Test 5:** per-frame hashes against a fresh reference across the old head.
  - **Test 7:** an error, an unchanged hash and an unchanged head after a command on A below its head.
  - **Test 8:** B's head is cut at 900 and A's hash is unchanged.
  - **Test 10:** errors during the warm-up and nothing deferred (tick 600, scenario 0, `branchTick` −1).
  - **Test 6's `headTick === head` after `viewScenario 0`** catches a host that applies `branch.then` to A, because `Timeline::schedule` below the head would cut A's head.
- **Test 4 catches a missing trip-table clear or tracked reset.** A stale trip id from tick 900 resolves to a `gone` notice at tick 300, so `tracked` is non-null.
- **Frozen-suite conflicts: none found in the tests themselves.**
  - The `/main bridge/i` button locators and `exact: 'Play'` / `'Pause'` stay unique, because the new buttons are named "A: original", "B: branch from …", "Discard branch", "Replace the branch", "Cancel", "Jump to start", "−1 min", "+1 min" and "Live".
  - `getByRole('status')` uses in the frozen tests are all text-filtered.
  - The frozen payload rule (`sim.test.ts:133`) accepts the `timeline` object of numbers.
  - The DOM order rule (the bar after the legend) protects the Follow ≤ 25 and Legend ≤ 30 Tab budgets.
  - The remaining risk is layout only (MAJOR 5b), and Gold must run all the frozen e2e suites.
- **The "−1 min" names use U+2212**, consistently in the ward and the test. The implementation must use the same character.
