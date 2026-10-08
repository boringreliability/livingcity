# timeline-004 Red review, round 3

**Verdict: REJECTED** (1 BLOCKER, 0 MAJOR, 4 MINOR)

Reviewed at commit f476011:
- `web/tests/compare.test.ts` (sha256 `ff8e856136875825a2f8ff75d25663ddf69e0666854381987c1dd6cd39d5a878`), tests 1–10;
- `web/e2e/compare.spec.ts` (sha256 `1a441539849595d95fbc0c4457dfceb5342a2fadf1bcec4640ebd8a26ba0009d`), tests 11–18.

I checked them against `.wdd/wards/timeline/ward-004.md`, `.wdd/epics/timeline.md` § T4, `livingcity.md`, CLAUDE.md, `.wdd/reviews/timeline-004-red-{1,2}.md`, `git diff HEAD~1 HEAD`, `web/src/{App.tsx,render/camera.ts,render/geometry.ts,render/renderer.ts,sim/protocol.ts,sim/host.ts}` and `playwright.config.ts`.

## What I ran
All probes are in `scratchpad/red3-tl004/`.

- **City correction.** The app runs `river_city` (scale 1, seeds 2026/7, 900 s warm-up; `protocol.ts:27`, `worker.ts:23–28`), not `three_bridges`. r2's `mean.test.ts` probed `three_bridges`, so I re-probed every e2e numeric premise on `Sim.river_city_scaled(2026, 7, 1)`.
- **Host tests against a ward-literal host.** I ran the current `compare.test.ts` (imports rewritten only) against r2's prototype host (`host.ts`): **10/10 pass**. This includes the new test 9 step (tracked in single view, then null in compare), test 1's `timeline_info()[1]` and test 10.
- **Test 12 premise, "both means defined past branch + 700"** (`premise.test.ts`, branch at 2161…2300, central bridge closed in B):
  - the mean and the p95 become finite after **161–191 ticks**, on both sides;
  - branch + 700 therefore has a wide margin;
  - at entry (a few ticks past the branch) both are NaN, so the "—" case is still exercised.
- **Test 11 fit-touch premise** (`premise.test.ts`: the real `Camera.fitInsets` and `buildRoadGeometry`, with `COMPARE_FIT_INSETS` on a 639/640 × 800 half):
  - the extents are x [15.72, 623.28] for [16, 623];
  - the fit is width-limited and the x-axis touches within 0.28 px;
  - containment holds inside the 1 px tolerance, despite the right-hand lane offset of the endpoints;
  - y [160, 530] lies inside [120, 570].
- **Test 17 context premises** (`ctx3.mjs`, Playwright Chromium, `--use-angle=swiftshader`):
  - after `WEBGL_lose_context.loseContext()` on a canvas that is then removed, that canvas's `getContext('webgl2').isContextLost()` is `true`, and A's context stays live;
  - `loseContext()` logs **no** `CONTEXT_LOST`/"Too many active WebGL contexts" console message, even when GL calls follow it, so the console check cannot penalise a correct release.
- **Test 15 vehicle-pick premise** (`cars*.test.ts`: the compare fit on the A half, then `zoomAt(canvas centre, 1.16)` until ≥ 1.5 px/m, exactly what `zoomInAt` does, then decoded frame records filtered as the test filters them). See BLOCKER 1.

## BLOCKER
1. **Test 15's precondition `centres.length > 0` fails for a correct implementation** (`compare.spec.ts:265–277`).
   - **What the test does.** `zoomInAt(page, a.x + a.width / 2, a.y + a.height / 2, 1.5)` anchors the zoom at A's canvas centre.
   - **Why that window is empty.** The insets are asymmetric (top 120, bottom 230), so after the compare fit the canvas centre lies 55 px below the network's centre. That is world (70, −486).
     - At 1.66 px/m the filtered window is about 360 × 250 m.
     - It contains only **2 links** and **0 vehicles**.
   - **Measured.** The count is 0 at ticks 2165, 2175, 2190, 2210, 2300, 2400, 2700 and 3000. It is also 0 for canvas sizes 639×720, 639×900 and 512×768.
     - Decoding is verified: all 1,743–1,756 records are on screen at the fit zoom.
     - A and B are nearly identical a few ticks after the branch, and the window has almost no road, so the side `vehicleScreenCenter` reads from does not change the result.
   - **The consequence.** The camera is deterministic, so this fails every run. With r2's M1 now written, the test is impossible to pass.
   - **Fix.**
     - **Test.** Anchor the zoom on A's central bridge, which is open and busy in A and is already computed as `pa`:
       ```ts
       await zoomInAt(page, pa![0], pa![1], 1.5);
       ```
       This is verified: the anchor lands at canvas (313, 352), inside the filter, and **27–31 cars** are in the filtered window at ticks 2165–2300.
       The busiest link gives 20–28 cars, but the bridge needs no extra hook data.
       The road clicks before this keep the camera unchanged, so `pa` is still valid.
     - **Ward.** In row 15, write "zoomed at A's central bridge to ≥ 1.5 px/m".

## MINOR
1. **Camera-dependent reads right after `compare` flips can race the refit** (`compare.spec.ts:222/224`, `:251`, `:329–332`).
   - **The race.** The tests read `linkScreenPointB`/`linkScreenPoint`/`camera` once, as soon as `snapshot().compare` has changed.
   - **Who it affects.** An implementation that refits from the `ResizeObserver` callback, after the A canvas changes width, sets the camera one rendering step later than the state flip.
   - **Fix (ward or tests).**
     - Ward: pin "`snapshot().compare` changes only once the layout and the fit of the new mode are applied".
     - Tests: poll the first read until it is stable, e.g. `expect.poll(() => snap(page).then((s) => s.camera.zoom))` across two reads.
   - Test 11 is less exposed, because several auto-waiting assertions run before its extents are read.
2. **Test 9's `linkDetail` check is vacuous** (`compare.test.ts:338–339`).
   - No `inspectLink` is ever sent, so `linkDetail` is null whatever the host does. This is r2 m4's second half.
   - **Fix.** Send `{ type: 'inspectLink', link: main[0] }` (with the right message shape from `protocol.ts`) before `compare on`, check that a single-view frame carries a non-null `linkDetail`, then keep the compare-pair assertions.
3. **Test 16 does not pin the ward's "`snapshot().scenario` keeps reporting the scenario viewed before entering"** (`compare.spec.ts:310`).
   - `after.scenario === before.scenario` holds for a UI that reports the last frame's side, which is "B" on every pair.
   - **Fix.** Add `expect(before.scenario).toBe('B')`, and in a test that enters compare with A viewed, `expect((await snap(page)).scenario).toBe('A')`.
     - Test 17's exit/re-enter, or test 18's flow, could host it.
     - With A viewed, the last frame of each pair is B's, so the check then discriminates.
4. **Small items.**
   - `compare.spec.ts:341`: `?? true` would turn a missing `webgl2` context into a pass. The renderer only uses `webgl2` (`renderer.ts:418`), so this is harmless today. `=== true` on `isContextLost()` without the fallback is cleaner.
   - `compare.test.ts:370`: `expect(before).toBeGreaterThan(0)` is still filler. `before` is otherwise unused, so remove both.

## r2 findings: status
| r2 | Status |
|---|---|
| B1 test 1 `:132` vs the shared window | **Resolved.** It reads A's own head (`timeline_info()[1]`); it passes on the prototype |
| M1 vehicle-pick tautology | Addressed in intent (zoom ≥ 1.5, real centres, click, `trackedTrip`), but the premise is broken (**BLOCKER 1**) |
| M2 context leak undetectable | **Resolved.** `isContextLost()` is checked on the removed B canvas at every exit; the premise was verified in swiftshader, and there are no console false positives |
| M3 time Δ unchecked | **Resolved.** Exact `fmtTimeDelta` on the Mean and p95 rows, at entry ("—") and past branch + 700 (both defined; the margin was re-verified on `river_city`); round(B) − round(A) is pinned in the ward |
| M4 scrub margin | **Resolved.** It polls to branch + 240 before pausing |
| m1 pair on entry | Resolved (ward: synchronous alignment, then the pair and the comparison at once) |
| m2 fit insets | Resolved: the whole-network extents, the touch check verified (0.28 px), and the refit on leaving compared with the load-time fit |
| m3 count Δ substrings | Resolved (exact equality) |
| m4 tracked before compare / link detail | Tracked: resolved. Link detail: vacuous (MINOR 2) |
| m5 viewed scenario | Ward pinned; the test does not discriminate (MINOR 3) |
| m6 entry ambiguity | Resolved (synchronous) |
| m7 filler / pattern frame | The pattern frame is resolved (`.side-label` border solid/dashed). The filler was replaced by another filler (MINOR 4) |

## r1 findings
- **Resolved or superseded.** All r1 items are resolved or superseded by the decisions recorded under Deviations, as tabulated in r2: view switch and vehicle inspection off, seeks below the branch refused, interventions disabled, B context only while comparing.
- **r1 M8 (context leak)** is now genuinely closed by the per-exit release check.

## Checked and OK
- **Host suite.** It passes 10/10 against a ward-literal prototype. The test 6 arithmetic (3 ms cost: 120/s single, 100/s pair, longest ≤ 14 ms) was re-verified in r2, and the one-sim-timing mutant fails.
- **Test 12.** The timing (700 ticks at 20× ≈ 18 s against a 60 s timeout) is comfortable at `river_city`'s tick cost.
- **Test 17's `singleFit`.** It is captured after `ready` (tick > 1800, the warm-up end), when `fitInsets(g.bounds, FIT_INSETS)` has run, and no camera input happens before compare. The same viewport gives the same fit.
- **Test 15's UI path.** The vehicle panel opens only on a host `tracked` response, so the click check is backed by the hook's `pickAt`, which shares `pickVehicleAt` with the click handler (`App.tsx:442–447`, `:528–531`). Together they enforce "no vehicle picked", once BLOCKER 1's anchor gives real cars.
- **No new conflicts with the frozen suites.** The changes are confined to the two new files and the ward.
