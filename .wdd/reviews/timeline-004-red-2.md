# timeline-004 Red review, round 2

**Verdict: REJECTED** (1 BLOCKER, 4 MAJOR, 7 MINOR)

Reviewed at commit 1c42b8a:
- `web/tests/compare.test.ts` (sha256 `aaa43ebdbf6013dac83fdc4cd523e025ada63c9f028249683a4eb9753c837626`), tests 1–10;
- `web/e2e/compare.spec.ts` (sha256 `79fb672ae856ee89bbca673da6763d991870c8799a9d1ea0fd118e381f91fda0`), tests 11–18.

I checked them against `.wdd/wards/timeline/ward-004.md`, `.wdd/epics/timeline.md` § T4, `livingcity.md`, CLAUDE.md, `.wdd/reviews/timeline-004-red-1.md`, `web/src/sim/{host,clock,protocol}.ts`, `crates/sim-wasm/src/lib.rs`, `web/src/App.tsx`, `web/src/ui/*`, `web/src/render/picking.ts` and the frozen suites.

## What I ran
- **Reference host prototype** (`scratchpad/red2-tl004/host.ts`). This is a copy of the current host plus a minimal compare mode that follows the ward literally:
  - pair stepping, timed together;
  - the shared window reported in both frames;
  - a pair posted at once on entry;
  - comparisons throttled to iterations that post a pair, and also sent on entry, seek and pause;
  - `command` and `viewScenario` refused, `inspectVehicle` ignored;
  - a replace checks the window first, then frees B, then branches.

  I ran `compare.test.ts` against it unchanged except for import paths.
  - **9/10 pass. Test 1 fails at `:132`** (see BLOCKER 1). With `:132` replaced by `x.sims[0].timeline_info()[1] >= 1200`, all 10 pass.
  - **Mutant "time only one sim":** test 6 fails (`behind` false). The r1 BLOCKER fix discriminates.
  - **Mutant "no pair posted on entry":** tests 1 and 10 fail (see m1).
- **Cohort-mean premise** (`scratchpad/red2-tl004/mean.test.ts`, seeds 2026/7 as in the app, central bridge closed in B, branch at 2161…2300):
  - the cohort mean becomes finite only after **331–381 ticks in A** and **450–493 ticks in B**;
  - so test 12 right after entering always sees "—" on both sides. The r1 conditional is now effectively unconditional, which is good.
  - At "c.tick + 400", A is usually defined and B is not. See M3.
- **WebGL context-limit premise** (`scratchpad/red2-tl004/ctx.mjs`, Playwright Chromium, `--use-angle=swiftshader` as in `playwright.config.ts`, one A context plus N leaked B contexts on removed canvases):

  | B sessions leaked | A lost | warning |
  |---|---|---|
  | 9 (18 toggles) | **no** | none |
  | 15 | no | none |
  | 16 | **yes** | "Too many active WebGL contexts. Oldest context will be lost." |
  | 20, with `WEBGL_lose_context` | no | none; the removed B canvas's context `isContextLost()` = **true** |

  See M2.
- **Clock arithmetic for test 6** (r1's `clock.test.ts`, re-checked through the prototype):
  - single view: 120/s, not behind;
  - pair: 100/s, behind;
  - one-sim timing: 120/s, not behind.

  The `longest ≤ 8 + 6` bound holds with real pair timing (one tick = 6 ms; the first post-entry plan with the stale 3 ms EMA is 2 ticks = 12 ms).

## BLOCKER
1. **Test 1 contradicts the ward's shared window, so a correct host fails it** (`compare.test.ts:132`).
   - **The assertion.** `expect(ps.at(-1)![0].timeline.headTick).toBeGreaterThanOrEqual(1200)`.
   - **The ward.** Outputs › Host: "Both frames report the shared window as their `timeline` window", i.e. `headTick = min(headA, headB)`. Test 4 asserts exactly that at `:225`.
   - **Why it fails.** In test 1, B's head is ≈ 906, so A's frame reports headTick 906. The prototype fails here with "expected 906 to be ≥ 1200".
   - **Fix.** Assert A's own head on the sim, not on the frame:
     ```ts
     expect(x.sims[0]!.timeline_info()[1]).toBeGreaterThanOrEqual(1200); // A was sought (its history kept)
     ```
     Optionally also add `expect(ps.at(-1)![0].timeline.headTick).toBe(t1)`, since the shared head is B's head = t1.

## MAJOR
1. **Test 15's "no vehicle is picked" is tautological** (`compare.spec.ts:213–214`).
   - **The premise.** `VEHICLE_PICK_MIN_ZOOM = 1.0` (`src/render/picking.ts:6`), and `pickVehicleAt` returns null below it (`App.tsx` ~443). The single-view fit zoom is already < 1 (frozen `inspect.spec.ts:339`), and a half-width compare fit is smaller still.
   - **The consequence.** `pickA.vehicle === null` and "no vehicle panel opens" hold even for a UI that still picks and inspects vehicles while comparing. The ward's "Vehicles are not picked while comparing … no vehicle panel opens" and the hook rule "while comparing, its `vehicle` is always null" go unenforced.
   - **Fix.** After the road checks:
     - zoom in on the A half to ≥ `VEHICLE_PICK_MIN_ZOOM`, as `inspect.spec.ts` `zoomIn` does (move the mouse over `canvas.city`'s centre and wheel until `camera.zoom ≥ 1`);
     - collect `vehicleScreenCenter(i)` points lying over `canvas.city` (`elementFromPoint(...).tagName === 'CANVAS'`), and assert `expect(centres.length).toBeGreaterThan(5)`;
     - for each, `pickAt(x, y).vehicle` is null;
     - click one, then assert `getByRole('region', { name: 'Selected vehicle' })` has count 0 and `snapshot().trackedTrip` is null;
     - do the same on the B half if a B variant of `vehicleScreenCenter` is exposed.
2. **Test 17's 18 toggles cannot detect a leaked B context** (`compare.spec.ts:262–272`; this was r1 M8).
   - **Measured.** In this Playwright Chromium configuration, A's context is dropped only when **16** contexts are leaked. 18 toggles create 9 B contexts, so a host that never calls `WEBGL_lose_context` and never disposes passes `isContextLost() === false`, the render check and the console check.
   - **Fix (choose one; the first is sharper and cheap).**
     - Capture B's canvas before each exit and assert that its context was released:
       ```ts
       await page.evaluate(() => { (window as any).__b = document.querySelector('canvas.city-b'); });
       await compareButton(page).click(); // exit
       await expect.poll(async () => (await snap(page)).compare).toBe(false);
       expect(await page.evaluate(() => ((window as any).__b as HTMLCanvasElement).getContext('webgl2')!.isContextLost())).toBe(true);
       ```
       This is verified: `isContextLost()` reads true after `loseContext()` on a removed canvas, and false without it. Do this inside the toggle loop on every exit.
     - Or raise the loop to ≥ 34 toggles (≥ 17 sessions).
   - **Ward.** Update the row 17 wording accordingly.
3. **The time-Δ rules for Mean trip and p95 trip are never checked** (`compare.spec.ts:128–134`).
   - **What the ward specifies** (Cell formats and Specification):
     - the Δ shows "—" when either side is undefined;
     - otherwise it is "+m:ss ▲", "−m:ss ▼" or "0:00".
   - **What the test checks.**
     - It checks the Δ cell only at entry (`:107`), where the probe shows both sides are always NaN.
     - At the later point only the A and B cells are checked.
   - **What goes undetected.**
     - Per the probe, at "c.tick + 400" A's mean is typically defined and B's is not (B defined only after ≈ 450–493 ticks). A UI that shows "NaN", "+NaN" or a one-sided number in that Δ passes.
     - So does a UI that prints the time Δ with a colour-only sign. That is the colourblind invariant the ward calls out.
   - **Fix.**
     - In the `Mean trip`/`p95 trip` loop, add:
       ```ts
       const d = Number.isFinite(c.a[i]!) && Number.isFinite(c.b[i]!) ? Math.round(c.b[i]!) - Math.round(c.a[i]!) : NaN;
       const want = Number.isNaN(d) ? '—' : d > 0 ? `+${mss(d)} ▲` : d < 0 ? `−${mss(-d)} ▼` : '0:00';
       expect(cells[2]).toBe(want);
       ```
     - Pin in the ward whether the Δ is `round(b) − round(a)` or `round(b − a)`. They differ by up to 1 s.
     - To exercise the both-defined path deterministically, run until `sides.a.tick > snap.branchTick + 600` (the probe gives ≤ 493) before pausing. Optionally take one more fresh comparison at ≈ branch + 420 to hit the one-sided case.
4. **Test 13's scrub step has a thin timing margin and is flaky under load** (`compare.spec.ts:145–162`).
   - **The clamp.** `TimelineBar.seek` clamps to `lo` (`TimelineBar.tsx:33`). While comparing, `lo` = the shared start = `branchTick`, so `ArrowLeft` lands on `p − 120` only if `p − 120 ≥ branchTick`.
   - **The margin.**
     - `p` = branch + k + the ticks run during the sampling loop.
     - k is the few ticks B ran in `comparing()`: one poll interval plus the pause, ≈ 3–12.
     - The sampling loop is 10 × (300 ms sleep + one evaluate) ≈ 3.05–3.2 s, which is ≈ 122–128 ticks at 20× (40 ticks/s).
     - So the margin is ≈ 5–20 ticks, ≈ 0.15–0.5 s of wall time.
   - **The failure.** Any shortfall in the lockstep rate (two sims, two SwiftShader canvases on the same machine) makes the seek clamp to `branchTick`, and the poll for `p − 120` fails for a correct implementation.
   - **Fix.** After the 10 samples and before `pause`, add:
     ```ts
     await expect.poll(async () => (await snap(page)).sides!.a.tick, { timeout: 30_000 }).toBeGreaterThan((await snap(page)).branchTick! + 240);
     ```

## MINOR
1. **Tests 1 and 10 require a pair to be posted at once on entering compare, but the ward does not say so.**
   - The prototype mutant "no pair on entry" fails test 1 (`:126`, `ps.length` 0) and test 10 (`:350`, the last frame is still the `viewScenario` frame with `compare 0`).
   - **Fix (ward).** Add to Outputs › Host: "entering compare (after aligning) posts a frame pair at once, like `afterJump`".
2. **Test 11's fit check does not discriminate** (`compare.spec.ts:92–97`).
   - The central bridge is at the city centre, so it lies inside B's inset rectangle with `COMPARE_FIT_INSETS`, with `FIT_INSETS`, or with no refit at all: the camera centre maps to each half's centre.
   - **Fix.** Take `linkScreenPointB(l, 0)` and `(l, 1)` over all links. Assert that their bounding box lies within `b` inset by (16, 120, 16, 230) ± 2, and that it touches at least one inset edge within 4 px (a tight fit).
   - **Leaving is untested** (Outputs: "on leaving (the single view uses `FIT_INSETS` again)"). In test 17, after exit, compare `snapshot().camera` with the camera snapshot taken before entering compare (same viewport ⇒ same fit).
3. **Count Δ checks are substring checks** (`compare.spec.ts:122`).
   - `toContain('+5')` also matches "+50 ▲", and `toContain('0')` for d = 0 matches almost anything.
   - The ward pins "+n ▲", "−n ▼" and "0", so assert equality:
     ```ts
     expect(cells[2]).toBe(d > 0 ? `+${d} ▲` : d < 0 ? `−${-d} ▼` : '0')
     ```
4. **A vehicle tracked before entering compare is not covered.**
   - The ward says "nothing is tracked" while comparing, but test 9 only sends `inspectVehicle` after entry.
   - **Fix.** In test 9, send `inspectVehicle` for record 0 of B's last frame *before* `compare on`, confirm a single-view frame has `tracked` non-null, then enter compare. Assert every pair has `tracked ?? null` null.
   - Likewise "There is no host link detail while comparing": send `inspectLink` and assert that `linkDetail ?? null` is null in compare frames.
5. **`snapshot().scenario` while comparing, and how the UI knows the viewed side, are unspecified.**
   - `frame.scenario` now means the side, so a UI that derives `scenario` from the last frame reads "B" while comparing regardless of the viewed side. Test 16's `after.scenario === before.scenario` passes either way.
   - **Fix (ward).** State that the UI keeps the viewed scenario from the last single-view frame (or from the compare request) and that `snapshot().scenario` reports the viewed scenario while comparing.
6. **Entry alignment "in bounded chunks, as in the warm-up" is ambiguous.**
   - The warm-up spreads its work over iterations, but "comparison at once on entering" and tests 1 and 10 (MINOR 1) assume entry is synchronous.
   - **Fix (ward).** Say whether the forward step is synchronous (bounded only by being in chunks) or asynchronous. If asynchronous, say when the entry pair and the entry comparison are posted.
7. **Small items.**
   - `compare.test.ts:362`: `expect(before).toBeLessThan(x.calls.length)` is filler. Remove it, or assert something meaningful.
   - Test 11 does not check the "pattern frame" around the corner labels (T4: "text label and a pattern frame"). Consider a computed-style check on the label container: a non-`none` `border-style` or `background-image`.

## Design decisions recorded in r1's fix commit
- **View switch refused and vehicle picks off while comparing.**
  - Both are recorded under Deviations ("Vehicle inspection is off … and so is the A/B view switch").
  - They narrow T4's "Picking and inspection know which side was clicked" to road inspection only, which is a legitimate scope cut for the epic gate.
  - They remove r1 M6's `forget_frames`/single-frame hazard entirely.
  - **Sound**, but test 15 does not enforce the vehicle half (M1).
- **Seeks below the branch tick refused, and the shared window.** Recorded under Deviations, sound (B did not exist before `branchTick`), and tested in test 4. Test 1:132 contradicts the shared window (BLOCKER).
- **Pairs committed together in the UI.** This is a specification item rather than a deviation, and it is sound: it is the only way `sides.a.tick === sides.b.tick` can hold. Tested in test 13.
- **B canvas only while comparing.** Recorded in Deviation 1 ("B's context exists only while comparing"). Sound. The release is not effectively tested (M2).
- **Interventions disabled.** Recorded, and tested by test 16 (button, road panel, B key, after running).

## r1 findings: status
| r1 | Status |
|---|---|
| B1 test 6 premise | **Resolved.** 3 ms cost, bounds verified with the real `SimClock` and a prototype; the one-sim-timing mutant fails |
| M1 strict pairs | Resolved (`strictPairs`, used on every compare slice) |
| M2 frame 1 from B | Resolved (test 2 `:172–176`) |
| M3 test 1 vacuous | Resolved (`ps2.length > 0`, entered while running, both paused), but `:132` introduced the BLOCKER |
| M4 test 14 (now 16) closures | Resolved (runs after the B key, Close/Reopen disabled, no confirmation or pending cue) |
| M5 picking data | Resolved (central bridge, "state closed"/"state open", link in `central_bridge`) |
| M6 view switch / vehicle per side | Superseded by the recorded decision; host side tested (test 9); UI side tautological (M1) |
| M7 Δ formats | Partly: count Δ, Unserved and A/B m:ss are checked; the time Δ is not (M3) |
| M8 context leak | **Not resolved.** The 18 toggles are below Chromium's 16-context limit (M2) |
| M9 comparison ticks | Resolved (`window_metrics` call log at the comparison tick, pair ticks, partition, `fromTick`) |
| m1 below branch | Superseded (refused; test 4) |
| m2 corner labels | Resolved (non-button labels inside the canvas boxes) |
| m3 pair commit / 20× | Resolved (ward + speed selected) |
| m4 cameras | Resolved (anchor on B ± 2 px, exact pan, `drawnCameras`) |
| m5 fit insets | Weak on entering, missing on leaving (m2) |
| m6 sleeps | Resolved (`freshComparison` polls) |
| m7 scrub | Added, but racy (M4) |
| m8 replace order | Resolved (test 10, verified with the prototype) |
| m9 small tightenings | Resolved, except naming the viewed-side field (m5) |

## Checked and OK
- **Tests 2–10 premises** hold on real wasm with a ward-literal prototype:
  - the hashes in test 2;
  - `last.b[6] ≥ last.a[6]` in test 3;
  - the 600/head shared window and both refusals in test 4;
  - the `free(1)` → `branch(0)` order in test 10.
- **Test 3's throttle bounds** (≥ 6, ≤ floor(Δt/500) + 1) and the "comparison only in a pair-posting iteration" rule are consistent with the spec.
- **Test 6:**
  - the single view gives 120/s, not behind;
  - the pair gives 100/s, behind;
  - the longest iteration is ≤ 12 ms ≤ 14 ms.
- **Frozen conflicts.**
  - `pickAt` callers in the frozen e2e read only `.vehicle`/`.link`, so the added `side` is harmless.
  - The `timeline` `toEqual` checks in `timeline.test.ts` compare like with like.
  - There is one `<canvas>` in single view, so `canvas` count 1 is consistent.
  - The `role="alert"` element is only the app's error paragraph (`App.tsx:781`). The "behind" cue is `role="status"`, so test 16's alert check is not polluted by lockstep running behind.
- **Test 18's selectors** exist:
  - `.controls` region "Simulation controls";
  - the Cancel button in `ConfirmReplace`;
  - "A: original".
- **Test 12's "—" at entry is effectively unconditional** (probe: no finite cohort mean for ≥ 331 ticks).
