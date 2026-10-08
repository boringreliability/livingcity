# timeline-004 Red review, round 1

**Verdict: REJECTED** (1 BLOCKER, 9 MAJOR, 9 MINOR)

Reviewed at commit 25db253:
- `web/tests/compare.test.ts` (sha256 `dcef618770cb6c1f93d7f6b809842b40c182e27d2732988b4103cca9fd135e95`), tests 1–8;
- `web/e2e/compare.spec.ts` (sha256 `ed81c9f1aff89e616146b56550e9a5543bafffd2860809499fdb830af5c446c2`), tests 9–16.

I checked them against `.wdd/wards/timeline/ward-004.md`, `.wdd/epics/timeline.md` § T4, `livingcity.md` (Replay and branching, Meaningful metrics, colourblind rules), CLAUDE.md, `web/src/sim/{host,clock,protocol}.ts`, `crates/sim-wasm/src/lib.rs`, `web/src/App.tsx`, `web/src/ui/*`, `web/src/styles.css` and the frozen suites.

## What I ran
- **Frozen vitest baseline:** `vitest run` gives 20 files, 93 tests passing and 8 failing. All 8 failures are in `compare.test.ts`, which is expected because the API is missing.
- **Premise probe** (`scratchpad/red-tl004/probe.test.ts`, real wasm, the timeline-003 host behind the same Proxy as the test):
  - `scenario()` gives `bTick` = **901** (not 900). A's info is `[0, 1200, 1000, …]` and B's is `[0, 901, 901, …]`.
  - **Test 2's reference B holds.** After A is seeked to 901 and A and B are stepped to 1500, A's hash equals a plain run. B's hash equals `step(600); close_link(50, 51); step(900)`, so `branch(600)` + `then` at 600 ≡ a fresh run with the close at tick 600.
  - **`closed_links()` does not show a close until a tick runs.** After `close_link` it returns `[]`, and after one `step` it returns `[50]`. This matters for test 14 (see M4).
  - **B's window starts at 0**, not at the branch tick. `B.seek(590)` and `B.seek(599)` succeed, and `B.window_metrics(600)` at tick 599 returns `[600, 599, 0, 0, 0, 0, 0, NaN, NaN]` (see m1).
- **Clock arithmetic probe** (`scratchpad/red-tl004/clock.test.ts`, the real `SimClock`, test 6's loop):

  | tickCostMs | iterate ms | single view | pair, both timed | pair, only one sim timed |
  |---|---|---|---|---|
  | 5 (as written) | 4 | 112/s, not behind | **72/s**, behind | 72/s, behind |
  | 5 | 1 | 120, not behind | 91, behind | 91, behind |
  | **3** | **4** | **120, not behind** | **100, behind** | **120, not behind** |

## BLOCKER
1. **Test 6 fails for a correct implementation, and its premise "pair ≤ 100 ticks/s" is wrong** (`compare.test.ts:205–220`).
   - **Why it fails.** `ITERATION_BUDGET_MS` = 8. With 5 ms per sim step, the pair's ms per tick is 10, so `plan()` returns `max(1, floor(8/10))` = 1 tick. Each iteration then costs 4 ms (`iterate`) + 10 ms (the pair) = 14 ms, and 1000 / 14 ≈ **72 ticks/s**. The assertion `> 90` fails.
   - **Single view.** The single-view half gives 1000 / 9 ≈ **112**, not "≈ 120" as the ward claims. It passes `> 110` by a margin of 2.
   - **The test does not discriminate either.** With c = 5, a host that times only one sim also plans 1 tick (`floor(8/5)` = 1), so it produces exactly the same numbers (72, behind). The ward's key rule, "the clock's ms per tick is the pair's", goes untested.
   - **Fix.** Use `tickCostMs: 3` and keep the 4 ms iterations. Verified with the real `SimClock`: single view reaches 120 and is not behind; pair timing gives 100 and behind; a host that times only one sim reaches 120 and is not behind, so it fails the test. Change `:205` to `host({ tickCostMs: 3 })` and assert:
     ```ts
     expect(single.behind).toBe(false);
     expect(single.achievedTicksPerS).toBeGreaterThanOrEqual(115);
     ...
     expect(pair.behind).toBe(true);
     expect(pair.achievedTicksPerS).toBeGreaterThan(90);
     expect(pair.achievedTicksPerS).toBeLessThan(110);
     ```
     In the ward's table row 6, change the text to "3 ms per sim step: one sim ≤ 333 ticks/s; with 4 ms per iteration and the 8 ms budget the pair manages 1 tick per 10 ms = 100/s".
   - **Optional, sharper.** Record the fake time spent per `h.iterate()` while comparing and assert that it is ≤ `ITERATION_BUDGET_MS` + 2 × cost (≤ 14 ms with c = 3). A host that times one sim plans 2 ticks, which takes 12 ms of steps plus overshoot.

## MAJOR
1. **`pairs()` makes "every posted frame pair has equal ticks" vacuous for malformed sequences** (`compare.test.ts:82–88`, used at `:96`, `:127`, `:180`).
   - **The problem.** Only adjacent (0, 1) frames are inspected. Lone frames, (1, 0) orders, or a (0, 0, 1) sequence with a stale A are skipped silently. The Must NOT ("let their ticks differ in any posted pair") is not enforced.
   - **Fix.** Add a strict helper and use it on every compare-mode slice:
     ```ts
     function strictPairs(fs: FrameMessage[]): [FrameMessage, FrameMessage][] {
       expect(fs.length % 2).toBe(0);
       const out: [FrameMessage, FrameMessage][] = [];
       for (let i = 0; i < fs.length; i += 2) {
         expect([fs[i]!.scenario, fs[i + 1]!.scenario]).toEqual([0, 1]);
         expect(fs[i]!.tick).toBe(fs[i + 1]!.tick);
         expect([fs[i]!.timeline.compare, fs[i + 1]!.timeline.compare]).toEqual([1, 1]);
         out.push([fs[i]!, fs[i + 1]!]);
       }
       return out;
     }
     ```
     In test 2 (`:127`), slice from `n` up to the frames before `setRunning(false)`, then call `strictPairs`.
2. **No test checks that frame 1 actually comes from B.**
   - **The gap.** A host that encodes the viewed sim twice and labels the copies 0 and 1 passes tests 1–4. The ticks are equal, and the hashes in test 2 come from the sims, not from the frames.
   - **Fix.** At the end of test 2, or test 1, add:
     ```ts
     const [fa, fb] = ps.at(-1)!;
     expect(Array.from(fb.closed)).toEqual(expect.arrayContaining(main));
     expect(Array.from(fa.closed).some((l) => main.includes(l))).toBe(false);
     expect(Array.from(fa.metrics)).toEqual(Array.from(simA.metrics()));
     expect(Array.from(fb.metrics)).toEqual(Array.from(simB.metrics()));
     ```
     The closed lists and the two `metrics` equalities are enough to tell the sides apart.
3. **Test 1's "B steps forward" half can pass vacuously** (`compare.test.ts:111`).
   - **The problem.** `for (const [a, b] of pairs(...))` has no length assertion. A host that refuses, or never posts after aligning, passes. It also never checks that A was aligned by a seek (A's head stays 1200) and not by rebuilding.
   - **Fix:**
     ```ts
     const ps2 = pairs(x.frames().slice(m));
     expect(ps2.length).toBeGreaterThan(0);
     for (const [a, b] of ps2) { expect(a.tick).toBe(1100); expect(b.tick).toBe(1100); expect(a.clock.running || b.clock.running).toBe(false); }
     ```
     In the first half, add `expect(ps.at(-1)![0].timeline.headTick).toBeGreaterThanOrEqual(1200)` (A seeked, history kept) and `expect(b.timeline.compare).toBe(1)`.
   - **Also:** enter compare once **while running**. Send `setRunning(true)` and `iterate(3)` before `compare on`, so that "both are paused after aligning" is not tautological. In `scenario()` both are already paused.
4. **Test 14 cannot fail on closures. The scenario is paused, and a close only shows after a tick runs** (`compare.spec.ts:157–165`).
   - **The problem.** `comparing()` leaves both sides paused (compare-on pauses). The probe shows `closed_links()` stays `[]` until a step runs. A buggy UI and host that apply the B key's close or reopen leave `sides.*.closed` unchanged for the 400 ms sleep.
   - **What else goes undetected.** The confirmation "Replace the branch?" opening, or a "(pending)" cue on the bridge button.
   - **Fix:**
     ```ts
     await page.keyboard.press('b');
     await expect(page.getByRole('button', { name: 'Replace the branch' })).toHaveCount(0);
     await expect(bridge).not.toContainText(/pending/i);
     await blur(page);
     await page.keyboard.press('Space');                       // run so a scheduled command would apply
     await expect.poll(async () => (await snap(page)).sides!.a.tick).toBeGreaterThan(before.sides!.a.tick + 20);
     await pause(page);
     const after = await snap(page);
     ```
     Then keep the closed, scenario and alert checks. Also assert that the selected road panel's Close/Reopen button is disabled with the same title (Outputs: "the road panel's Close/Reopen").
5. **Picking per side checks only a heading suffix, not the data shown** (`compare.spec.ts:139–149`).
   - **The problem.** A UI that derives "(B)" from the click x but shows A's link state still passes. The north bridge is open in both scenarios, so the test cannot tell the sides apart.
   - **Fix.** Use the closed central bridge: `const road = (await snap(page)).landmarks!.central_bridge[0]`. Then:
     ```ts
     await expect(page.getByRole('region', { name: 'Selected road' })).toContainText('(B)');
     await expect(page.getByRole('region', { name: 'Selected road' })).toContainText(/state\s*closed/);
     // … click A's point …
     await expect(page.getByRole('region', { name: 'Selected road' })).toContainText('(A)');
     await expect(page.getByRole('region', { name: 'Selected road' })).toContainText(/state\s*open/);
     ```
     Also assert `pickAt(...).link` is one of `central_bridge`, so the pick was not of a vehicle or another road.
6. **`viewScenario` while comparing, and vehicle inspection per side, are untested, and the current host would break both.**
   - **Current host.** `viewScenario` (`host.ts:317–329`) pauses, calls `target.forget_frames()` and posts **one** frame via `afterJump`.
   - **Why it matters.** The ward says `viewScenario` "keeps comparing" and decides which side inspection follows. Clicking a vehicle on B therefore presumably sends `viewScenario 1` and then `inspectVehicle`. `forget_frames` would make B's own `trip_at_record(frameTick, record)` fail, and the single frame breaks the pairing.
   - **The ward does not specify** how a vehicle pick reaches the right sim.
   - **Fix (ward).** State the protocol, e.g. "`inspectVehicle`/`inspectLink` while comparing resolve against the viewed side; `viewScenario` while comparing does not call `forget_frames` on a side whose frames are still current, does not pause, and posts a pair".
   - **Fix (tests).** Add a host test:
     ```ts
     test('9 view_switch_keeps_comparing', () => {
       const { x } = scenario();
       x.send({ type: 'compare', on: true }); x.iterate(2);
       const [, fb] = pairs(x.frames()).at(-1)!;
       x.send({ type: 'inspectVehicle', frameTick: fb.tick, record: 0, seq: 1 });   // B is viewed
       x.send({ type: 'viewScenario', scenario: 0 });
       const n = x.frames().length; x.iterate(3);
       const after = x.frames().slice(n);
       expect(after.length).toBeGreaterThan(0);
       expect(strictPairs(after).length).toBeGreaterThan(0);
       x.send({ type: 'viewScenario', scenario: 1 }); x.iterate(1);
       const [, fb2] = pairs(x.frames()).at(-1)!;
       x.send({ type: 'inspectVehicle', frameTick: fb2.tick, record: 0, seq: 2 }); x.iterate(2);
       expect((x.frames().at(-1) as { tracked?: unknown }).tracked).not.toBeNull();
     });
     ```
     Add an e2e step to test 13 that clicks a vehicle on the B half (`vehicleScreenCenter` needs a B variant, or use `pickAt` on B points) and checks that the vehicle panel names "(B)".
7. **Δ (sign + glyph, "—" when undefined) and the Unserved / Mean / p95 rows are never checked against numbers.**
   - **Why it matters.** This is the colourblind enforcement point. "No hue as the only cue" is a CLAUDE.md invariant, and the ward specifies "+"/"−" plus ▲/▼ and "m:ss". Test 10 checks only Generated, Completed and Incomplete for A and B.
   - **Fix (test 10).**
     ```ts
     const cellsOf = async (name: string) => panel(page).getByRole('row', { name: new RegExp(`^${name}`) }).getByRole('cell').allTextContents();
     const fmtDelta = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0');
     for (const [name, i] of [['Generated', 2], ['Completed', 3], ['Incomplete', 6]] as const) {
       const d = c.b[i] - c.a[i];
       const t = (await cellsOf(name))[2]!;
       expect(t).toContain(fmtDelta(d));
       expect(t.includes('▲')).toBe(d > 0);
       expect(t.includes('▼')).toBe(d < 0);
     }
     const unserved = await cellsOf('Unserved');
     expect([Number(unserved[0]), Number(unserved[1])]).toEqual([c.a[4] + c.a[5], c.b[4] + c.b[5]]);
     const mss = (s: number) => (Number.isFinite(s) ? `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}` : '—');
     const mean = await cellsOf('Mean trip');
     expect(mean.slice(0, 2)).toEqual([mss(c.a[7]), mss(c.b[7])]);
     if (!Number.isFinite(c.a[7]) || !Number.isFinite(c.b[7])) expect(mean[2]).toBe('—');
     ```
   - **Fix (ward).** Pin these in the ward: "Unserved = removed_unreachable + removed_gridlock", the zero-Δ text, the rounding of m:ss, and that `NaN` displays as "—".
   - **Make the "—" branch reachable.** Also check the panel directly after entering compare at a tick ≤ branch + a few ticks (cohort mean undefined → "—"). The current conditional assertion is otherwise only conditionally exercised.
8. **Exit and cleanup: repeated toggling can leak WebGL contexts, and nothing tests it.**
   - **The risk.** Two contexts per compare session (Deviation 1). If the B `CityRenderer` and its context are not released on exit, about 16 toggles make Chrome drop the **oldest** context, which is A's map. Test 15 toggles once, and `toBeHidden()` even accepts a B canvas that stays mounted.
   - **A second conflict.** A B canvas left in the DOM collides with frozen single-view queries such as `document.querySelector('canvas')` / `canvas.city` (`city.spec.ts:24, 76, 199`, `gold_timeline003.spec.ts:45`) as soon as DOM order or display changes.
   - **Fix (test 15).**
     ```ts
     await expect(page.locator('canvas.city-b')).toHaveCount(0);     // not merely hidden (both places)
     for (let k = 0; k < 18; k++) {
       await compareButton(page).click(); await expect.poll(async () => (await snap(page)).compare).toBe(k % 2 === 1 ? false : true);
     }
     ```
     Toggle an even number of times to end single, starting from compare off. Then:
     ```ts
     expect(await page.evaluate(() => (document.querySelector('canvas.city') as HTMLCanvasElement).getContext('webgl2')!.isContextLost())).toBe(false);
     const f0 = (await snap(page)).renderFrames; await expect.poll(async () => (await snap(page)).renderFrames).toBeGreaterThan(f0 + 5);
     await expect(page.locator('canvas')).toHaveCount(1);
     ```
     Also listen for `console` messages matching /Too many active WebGL contexts|CONTEXT_LOST/ and assert none.
9. **Comparison messages: "same tick on both sides" and "tick = the frames' tick" are only checked once paused** (`compare.test.ts:156–166`).
   - **The problem.** When paused, both sims are trivially at the same tick. A host that computes `a` after stepping A but before stepping B, or that emits a comparison at a tick for which no pair was posted, passes. The running comparisons (`running`) are only counted.
   - **Fix.** Log the tick at which each sim's `window_metrics` is called. In `wrap`, add:
     ```ts
     if (key === 'window_metrics') return (from: number) => { wmCalls.push({ sim: sims.indexOf(s), tick: s.tick(), from }); return s.window_metrics(from); };
     ```
     Then, for every running comparison `c`:
     ```ts
     const pairTicks = new Set(pairs(x.frames()).map(([a]) => a.tick));
     for (const c of running) {
       expect(c.fromTick).toBe(600);
       expect(pairTicks.has(c.tick)).toBe(true);
       for (const w of [c.a, c.b]) expect(w[6]).toBe(w[2]! - w[3]! - w[4]! - w[5]!);
     }
     // every window_metrics call made for a comparison is at that comparison's tick, both sims
     ```
     Also add `expect(simB.tick()).toBe(last.tick)`, `expect(c0).toBe(0)` (no comparison outside compare), and `expect(x.errors()).toEqual([])`.

## MINOR
1. **Seeking below `branchTick` while comparing is unspecified** (probe: B's window starts at 0).
   - `seek(500)` is "in both windows". It puts B before its own branch, and `window_metrics(600)` then returns `from 600 > to 499` with zeros.
   - **Fix:** the ward should decide whether to refuse, clamp to `branchTick`, or show "before the branch". Test 4 should cover it with `x.send({ type: 'seek', tick: 599 })`.
   - The slider range while comparing (A's window, B's window or the intersection) is unspecified too.
2. **The "A: original" corner-label check in test 9 is vacuous** (`compare.spec.ts:60`).
   - The scenario panel's button text is exactly "A: original" (`ScenarioPanel.tsx:17`), so `getByText(..., {exact: true}).first()` finds the button even without any corner label.
   - **Fix.** Assert that a non-button label lies inside each canvas's box:
     ```ts
     for (const [text, box] of [['A: original', a], ['B: branch', b]] as const) {
       const hits = await page.getByText(text, { exact: true }).evaluateAll((els) => els.filter((e) => !e.closest('button')).map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
       expect(hits.some(([x, y, w, h]) => w! > 0 && x! >= box.x && x! + w! <= box.x + box.width && y! >= box.y && y! + h! <= box.y + box.height), text).toBe(true);
     }
     ```
   - I grade this MINOR only because the B label check is genuine ("B: branch" is not an exact match for the button text). Fix it all the same.
3. **The UI does not have to commit frames as a pair, so test 11 is either flaky or forces unspecified behaviour** (`compare.spec.ts:97–102`).
   - The worker posts A and then B as two message events, and `page.evaluate` can run between them, so `sides.a.tick ≠ sides.b.tick` for a moment.
   - **Fix (ward):** "the UI holds the scenario-0 frame until its scenario-1 partner arrives and applies (and draws) both together; `sides` reflects the committed pair". Test 11 then becomes sound.
   - Test 11 also never selects 20× (it relies on `DEFAULT_SPEED = 20`). Add `await page.getByRole('combobox', { name: 'Speed' }).selectOption('20')`.
4. **The linked-camera check is near-tautological, and the zoom anchor on the B half is untested** (`compare.spec.ts:110–136`).
   - If `linkScreenPointB` is computed from the shared camera plus B's rect, `rel` is equal whatever B's renderer draws.
   - **Zoom anchor.** Wheel over a road point `q` on the **right** half and assert that `linkScreenPointB(road, 0.5)` stays within 2 px of `q`. This catches a zoom anchored to A's rect.
   - **Pan.** Assert that the drag moves `linkScreenPointB` by (60, 30) ± 2.
   - **Optional.** Expose the camera each renderer last drew with (e.g. `snapshot().drawnCameras`) and assert both are equal.
5. **`COMPARE_FIT_INSETS` on entering and leaving is untested.**
   - **Fix:** after entering, assert that the central bridge's `linkScreenPointB` lies within B's rect inset by (16, 120, 16, 230). After leaving, assert that the camera equals a fresh single-view fit, comparing with the `camera` snapshot taken before entering compare.
6. **E2E sleeps used instead of polls.**
   - Test 10: `:78` and `:80` `sleep(700)`. Test 11: `:104`.
   - **Fix:** replace with `await expect.poll(async () => (await page.evaluate(() => window.__livingcity!.comparison()))?.tick).toBe((await snap(page)).tick)`.
7. **Scrubbing in compare through the UI is not covered (smoke step 4).**
   - **Fix:** in test 11, after pausing, focus the slider and press ArrowLeft. Then poll until `sides.a.tick === sides.b.tick === p − 120` and the panel's sim time equals `hms(p − 120)`.
8. **The host-side replace order (timeline-003 MINOR, now an Output) has no test.**
   - The Output reads: "check `fromTick` against A's window before building; free the old B before building the new one".
   - **Fix:** a host test that logs `free`/`branch` calls through the Proxy:
     - an out-of-window `branch` leaves the old B unfreed and still viewed;
     - a valid replace calls `B.free` **before** `A.branch`;
     - a `branch` while comparing ends compare (`timeline.compare` 0).
9. **Small tightenings.**
   - **Test 1 `:101`:** check each side (`a.clock.running === false && b.clock.running === false`).
   - **Test 7:** after the discard, assert that no `comparison` message is posted (`comparisons().length` stays constant over `iterate(50, 16)` while running).
   - **Test 8:** assert that no `comparison` is posted.
   - **Test 16:** also assert that after **Replace** the focus is on the slider, since the ward says "Cancel and Replace".
   - **The ward** should name the field that tells the UI the viewed side while comparing, because `frame.scenario` then means "side" and no longer "viewed".

## Checked and OK
- **Test 2's premise holds** (probe). `branch(600)` + `then` closes at 600 ≡ a fresh run stepped to 600, `close_link` on both bridge links, then stepped on. A seeked back to 901 and stepped forward ≡ a plain run.
- **Test 1's alignment numbers.** `bTick` is 901, which the test uses through the variable. A's window (0…1200) contains it, and seek 1100 > B's head 901 exercises the forward step.
- **Test 3's throttle bounds** are consistent: 4,000 ms / 500 ms gives ≤ 8 running messages (+1 slack). The ≥ 6 floor is achievable, and the pause message is excluded from `running`.
- **Test 4's refusal case** (B's head + 50, within A's window) is real. The hash and tick checks catch a host that seeks A before B refuses.
- **Test 7's `free` patch** reaches the host: the Proxy's `Reflect.get(target, 'free')` finds the patched own property on the raw `Sim`.
- **Frozen conflicts.**
  - `canvas.city` + `.first()` is used only in compare-mode tests.
  - The new `compare: 0` stays numeric in the frozen payload rule (`sim.test.ts:141`).
  - The `timeline` `toEqual(before.timeline)` checks in `timeline.test.ts` compare like with like.
  - `getByRole('button', { name: 'A: original' })` (frozen `timeline.spec.ts:229/247/310`) is not matched by "Compare side by side".
  - `Replace the branch` focus-on-open is compatible with frozen `timeline.spec.ts:262–264`, which blurs before pressing B.
  - The Tab-reach test (`timeline.spec.ts:300`) runs without B, so the new Compare button does not affect it.
- **Test 16's overlap check is real.** `.scenarios` is centred with `translateX(-50%)` in the top band, and `.controls` spans from 16 px to at least 276 px, so at 1024 px a wider panel (with the Compare button) covers the diagnostics toggle at the right of the control panel.
