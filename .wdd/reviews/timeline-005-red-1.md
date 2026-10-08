# timeline-005 Red review #1

**Verdict: REJECTED**

Reviewed at commit `e98641a`. Reviewer: fresh adversarial Red-gate subagent.

| File | sha256 |
|---|---|
| `web/e2e/acceptance.spec.ts` | `5a656d5e04078e8b7214530aa5b1d60313dd67435252ec8497b19b44a7107c1a` |
| `web/tests/integration.test.ts` | `537e950d78a470b35cf0f6e629920f17ad085b4578dc92b6832a7c205e5b619e` |
| `web/e2e/perf_timeline.spec.ts` | `5f1c88ba1688ff90fd375ed69ffccdcba9be849d2700d619f0da07734898334b` |

## Findings

### BLOCKER

**B1. Test 9 forces a nonsense string into `docs/architecture.md`** (`web/tests/integration.test.ts:149` and `:152`)
- Titles are normalised with `.replace(/[.`]/g, '')`, which removes dots. The documentation side (`plain`) only strips `` ` `` and `*`.
- ward-003's deviation title `` `Sim.window_metrics` `` therefore becomes **`Simwindow_metrics`**. I extracted it and confirmed it is required verbatim.
- An architecture doc that correctly writes `Sim.window_metrics` fails. The only way to pass is to write a token that does not exist in the code, which violates "docs must match the code". Because the test is frozen at Red, this cannot be fixed later.
- **Fix:** normalise both sides the same way, for example `norm = s => s.replace(/[`*]/g,'').replace(/\.$/,'').trim()`, applied to the title and to the doc. Only strip a trailing period from titles, never inner dots.

### MAJOR

**M1. Test 9 does not check the epic's Completion Criteria, and half the titles pass trivially** (`integration.test.ts:138-154`)
- The spec says test 9 covers "the Deviations sections of timeline wards 003/004 **and the epic file's Completion Criteria**". The test never reads `.wdd/epics/timeline.md`.
- The titles `Protocol` and `Memory` are satisfied by any architecture doc that uses those words anywhere after `## Deviations`. The slice runs to the end of the file, so they can appear in any later section.
- **Fix:**
  - Bound the Deviations slice at the next `\n## `.
  - Require each title as a list-item or heading lead, e.g. `^[-*]\s+\**<title>` or `^###\s+<title>`.
  - Add a check that the epic's Completion Criteria bullets are addressed: at minimum, each bold criterion label (`Tests`, `Determinism`, `In the browser`, `Performance`) appears in the Deviations or a "Completion" section with its status.

**M2. Test 6 lets fabricated numbers through** (`integration.test.ts:109-115`)
- (a) Only table rows (`|…`) are scanned. The spec says "every number in the Timeline section", so a fabricated number in prose passes.
- (b) The lookahead `(?![\w.])` skips any number with a unit glued on. I verified that `12.3ms` and `3.2x` are not extracted at all, while `12.3 ms` is.
- (c) An integer passes if *any* leaf rounds to it. The JSON has about 30 leaves, including 1280, 800, 1, 24, 48, 45, 50 and 2400, so small fabricated integers often match.
- (d) `indexOf('## Timeline')` also matches `### Timeline…`.
- **Fix:**
  - Scan every line of the section except fenced code and the `timeline.json` path line.
  - Use `/(?<![\w.])\d+(?:\.\d+)?/g` with no word-character lookahead, so unit suffixes are still captured.
  - Only exempt explicitly whitelisted non-measurement tokens, such as `60×` and the section's `p95`/`p50` labels, with a documented list.
  - Match the heading with `/^## Timeline\b/m`.
  - Optionally require integers to match a leaf exactly (`v === Number(d)`) unless the leaf is non-integral.

**M3. Test 4 counts any textual mention as "use", so the 14 current orphans can be "fixed" by mentioning them in a comment** (`integration.test.ts:70-71`)
- The test currently fails with 14 orphans: renderer constants, `HostDeps`, `TrackedOutcome`, `VEHICLE_DETAIL_HEADER`, `LivingCityDiagnostics` and `LivingCityHook`.
- A word-boundary hit in any comment, string or same-named local in `tests/` or `e2e/` satisfies the check. That bypasses the "commented allowlist with a reason" discipline the spec asks for.
- The spec says "is **imported** somewhere else".
- The export regex also misses `export async function`, `export let`, `export default …` and `export { … }`. None exist today, but they would silently escape.
- I probed a stricter rule: strip comments, then require the name inside an `import … from` clause or an `import('…').Name` in another file. Across all 110 current exports it gives **exactly the same result** as the current check. The stricter version therefore costs nothing today and closes the gaming route.
- **Fix:**
  - Use the import-clause rule above.
  - Broaden the export regex to `^export\s+(?:default\s+)?(?:async\s+)?(?:declare\s+)?(?:abstract\s+)?(?:const|let|function|class|interface|type|enum)\s+(\w+)`.
  - Fail on any `export {` or `export *` in `web/src` (or parse them).

**M4. Test 2 is not keyboard-only and deviates from the spec's key sequence** (`web/e2e/acceptance.spec.ts:132` and `:153-154`)
- After rewinding, the test presses `Escape` and then calls `document.activeElement.blur()` through `page.evaluate`. That is a programmatic focus change no keyboard user can perform.
- The spec's path is "Tab to the slider, ←, **B**". I ran exactly that, pressing `b` directly on the focused slider with no Escape and no JS blur, and it works today: the branch is created and Compare is reached in 3 Tabs from the slider. So the crutch is unnecessary, and it masks the regression this test exists to catch (B no longer working while the slider has focus).
- "No pointer events are used" is also never asserted.
- **Fix:**
  - Delete lines 153–154 and the initial `blur` at line 132, which is a no-op because `activeElement` is BODY at load.
  - Install an init script that counts trusted `pointerdown`/`mousedown`/`pointermove` events on `window` (capture) and assert 0 at the end. Do not count `click`: Enter on a button legitimately dispatches a trusted `click`, which my probe counted as 1.

**M5. Test 7's seek measurement samples a single replay distance near the head, not "≥ 20 seeks across a full window"** (`web/e2e/perf_timeline.spec.ts:74-76`)
- Snapshots sit at multiples of 120 (timeline-001) and every ← is exactly 120 ticks. So all 24 seeks replay the same `head mod 120` ticks.
- In my run `headTick` was 21048, so every seek replayed 48 ticks.
- The seeks also cover only the newest ~24 of ~164 retained sim minutes.
- The median and p95 therefore describe one arbitrary replay distance. If the pause happened to land on a multiple of 120, every seek would be a free restore.
- In my run seek median was 45.6 ms against a render interval of 50 ms. The number is dominated by rAF quantisation, and that is not flagged.
- "All within the window" is not asserted.
- **Fix:**
  - Seek to ≥ 20 targets spread across `[windowStartTick, headTick]` with varied offsets mod 120. For example, use the slider's real input (Home, then →, or pointer positions along the track), or step with an odd stride such as alternating End/Home plus ←×k.
  - Record each target and its replay offset (`target % 120`) and assert every target is within `[windowStart, head]`.
  - Record the render interval as the seek's resolution and flag `seekBelowFrameResolution` when the median is within one frame interval.

**M6. Test 7's "same sim range" for lockstep against single view is neither achieved nor recorded** (`perf_timeline.spec.ts:71` and `:89-94`)
- `single` is the last 20 s of wall time before the pause, ending at the head: about [H−2400, H].
- `lockstep` starts at A's position after 24 ← presses: [H−2880, H−480] in my run.
- These are different ranges, in different demand periods. Neither range is written to the JSON, and nothing asserts they match. The spec requires "tick means come from recordings over the same sim range".
- **Fix:**
  - Record `startTick`/`endTick` for both recordings.
  - Measure single view over the same range as lockstep: seek A to X, run single view to X+N, seek back to X, then compare and run lockstep to X+N.
  - Stop both by tick, not by wall time, and assert equal start and end ticks (± one batch).

**M7. Test 7 does not record the run conditions "the same as the other harness files", and does not flag sub-resolution values** (`perf_timeline.spec.ts:104-123`)
- `baseline-20x.json` records:
  - `conditions.headless`, `launchArgs`, `city`, `multiplier`, `achievedSpeed`/`targetTicksPerS`, `onNetwork*`/`active*` vehicle counts;
  - `tickBelowTimerResolution`.
- `timeline.json` has none of these. The brief requires "vehicle counts and conditions" with every performance number.
- In my run `single.tickMsMean` = 0.049 ms and `lockstep.tickMsMean` = 0.086 ms, both below 10 × the 0.1 ms timer resolution. They are unflagged, which violates the ward's "sub-resolution values are flagged".
- No assertion checks that the fields exist.
- **Fix:**
  - Add `headless`, `launchArgs`, `city`, `multiplier`, achieved and target ticks per second, and the median/max of on-network vehicles for each recording.
  - Add `tickBelowTimerResolution`, computed as in `perf.spec.ts:65-67`, for single and lockstep, and assert it equals the recomputed condition, as `perf.spec.ts:144` does.

### MINOR

- **m1** `acceptance.spec.ts:84,106,114`: "main is open" is checked only for `central_bridge[0]`. Check every link: `for (const l of lm.central_bridge) expect(...).not.toContain(l)`.
- **m2** `acceptance.spec.ts:111-116`:
  - Nothing asserts that compare happens at or after A's head (`s.sides!.a.tick >= aHead`), which step 6/7 implies.
  - The Incomplete row is only checked for visibility. Also compare its two cells with `c.a[6]`/`c.b[6]`, as is done for Generated.
- **m3** `acceptance.spec.ts:155-156`:
  - Nothing asserts `branchTick < closedAt`, i.e. that the branch is in A's past before the closure.
  - Nothing checks that B's decision took effect. B is paused after branching and `closed` is `[]` until it steps, as I observed. Step once (Space/Space), then check that `closed ⊇ central_bridge`.
- **m4** `perf_timeline.spec.ts:24-40`: `timedStepBack` waits for `positionTick === from − 120` with no timeout. A clamp at the window start would hang for the full 900 s. Add an in-page deadline that rejects. It also dispatches an untrusted `KeyboardEvent`; that is acceptable, but say so in the JSON (`seekInput: 'keydown ArrowLeft'`).
- **m5** `perf_timeline.spec.ts:80-83`:
  - Branch time uses `Date.now()` plus Playwright polling round trips, so CDP overhead is included.
  - Measure it in-page, as for seeks: `performance.now()` from the keydown to the first frame with `scenario === 1`.
  - Record the frame-interval resolution.
- **m6** `perf_timeline.spec.ts:85-88`: memory is only sampled right after the branch. B was 41.3 MiB at that point in my run, so the ≤ 2 × budget bound does have teeth. Also sample A and B after the lockstep run, and record `snapshotBytes` per side.
- **m7** `integration.test.ts:44,50`: `includes("type: 'x'")` would also match a comment or type annotation. It also does not check that each `SimClient` method is actually called from `App`/`ui`; an API method nobody calls is an unwired message at the UI level. Suggested fix: for each client method name, require `\.\s*<name>\s*\(` in `web/src/App.tsx` or `web/src/ui/*`, after stripping comments.
- **m8** `integration.test.ts:77-93`, test 5:
  - "defines queued, incomplete, unserved" is checked as "mentions". Require a definition form such as `/\*\*Queued\*\*[^\n]*:|^-\s+\*\*queued\*\*/im` or a definition-table row.
  - The README is not checked for the prerequisites (Rust, wasm-pack, Node, pnpm), the URL parameters (`?city=`, `?demand=`), the keys, or a link to `docs/traffic-model.md`.
  - `architecture.md` ≤ 2 pages is unchecked; a line or word cap would work, e.g. ≤ 1100 words.
- **m9** `integration.test.ts:127-135`, test 8:
  - `--test` is always resolved under `crates/sim-core/tests` even with `-p sim-wasm`.
  - A positional test-name filter, such as `cargo test -p sim-core --test city_005_scale scale_one_is_river_city`, is not verified to exist; grep `fn <name>` in the test file.
  - `--bench` is not checked.
  - `pnpm --dir web …` or `cd web && pnpm …` forms escape the script check.
- **m10** `acceptance.spec.ts:67-78`: once `tick − closedAt > 15 min`, the poll keeps returning `'timeout'` until the full 150 s expires. This is harmless but slow on failure. Throw instead, so the failure is immediate and says so.

## What I ran

1. `pnpm -C web exec vitest run tests/integration.test.ts`. Result: 6 tests, 5 failed (4, 5, 6, 8, 9) and 3 passed, as expected at Red.
   - Test 4 lists 14 orphans: `renderer.ts` LOD_OVERVIEW_PX_PER_M, LOD_DETAIL_PX_PER_M, CONGESTION_FULL_AT, HATCH_JUNCTION_INSET_PX, BARRIER_AT, DECK_MIN_PX, RING_INNER_PX, RING_OUTER_PX, ROUTE_WIDTH_PX; `host.ts` HostDeps; `protocol.ts` TrackedOutcome, VEHICLE_DETAIL_HEADER; `testHook.ts` LivingCityDiagnostics, LivingCityHook.
   - Tests 5 and 8 fail because README.md is missing; test 6 because the Timeline section is missing; test 9 because there is no Deviations section.
2. `pnpm -C web exec playwright test e2e/acceptance.spec.ts`. Result: `✓ brief_acceptance_flow (1.0m)`, `✓ acceptance_flow_keyboard_only (8.4s)`, 2 passed (1.2m).
3. A probe spec, `web/e2e/zz_red_probe.spec.ts`, added temporarily and deleted afterwards. Observed:
   - `PRE-CLOSURE spillback samples true: 0 /10`, so test 1's spillback criterion is not trivially satisfied before the closure (good).
   - `activeElement at load: BODY`.
   - Pure keyboard: Tab×10 to the slider, ← until before the closure, `b` **on the focused slider** creates B (`branchTick 1933 < closedAt 2017`), and 3 Tabs reach "Compare side by side", then Enter enters compare. No Escape or JS blur is needed (M4).
   - `B closed []` immediately after the branch: B is paused, and its decision applies on the first step (m3).
   - Trusted pointer/mouse/click events counted: 1. This is the `click` that Enter dispatches on a button, so the counter must exclude `click` (M4).
   - `paused: head 2293 … head mod 120 = 13`, showing that every ← seek replays the same offset (M5).
4. `PERF=1 pnpm -C web exec playwright test e2e/perf_timeline.spec.ts`. Result: `✓ perf_timeline_recorded @perf (3.1m)`.
   - The resulting `timeline.json` (copied to my scratchpad, then deleted from `web/perf-results/` to keep the tree clean):
     - `window` 1320..21048 (2.74 sim h);
     - seek n=24, median 45.6 ms, p95 48.6 ms, max 68.7 ms;
     - branch 45 ms;
     - memory: A 47.97, B 41.30, total 89.26 MiB (budget 48);
     - single: tickMsMean 0.0488, renderInterval median 50 ms;
     - lockstep: tickMsMean 0.0855, renderInterval median 83.3 ms;
     - ratio 1.75;
     - timerResolution 0.1 ms.
   - The head is 21048, so 21048 mod 120 = 48, and every seek replayed 48 ticks (M5). The seek median sits right at the 50 ms frame interval (M5). Both tick means are below 10 × resolution and unflagged (M7). Single covered about [18648, 21048] and lockstep about [18168, 20567] (M6).
5. A static probe (`scratchpad/red-tl005/orphans.mjs`) compared the "mentioned" rule with an "imported, comments stripped" rule over all 110 exports in `web/src`: there were 0 discrepancies, so the stricter rule from M3 is free today.
6. I extracted the test 9 titles: `Protocol`, `Seek runs synchronously`, `Memory`, **`Simwindow_metrics`**, `Two canvases (two WebGL contexts) instead of one context with two viewports`, `Interventions are disabled while comparing`, `Vehicle inspection is off while comparing, and so is the A/B view switch`, `Seeks below the branch tick are refused while comparing` (B1, M1).

`git status` is clean after the probes. The only file I wrote in the repo is this review.

## What is good
- Test 1 follows steps 1–7 faithfully:
  - the closure is an ordinary command at A's head;
  - the spillback/doubling criterion mirrors city-005 test 10 and is not true before the closure;
  - the branch tick equals the rewound position;
  - compare checks equal side ticks, A's main closure versus B's North closure, and `fromTick === at`;
  - the Generated cells equal the comparison values.
- Test 3 has real teeth: removing a `case` in `host.ts` or a `send` in `client.ts` fails it.
- Test 7 asserts `aMiB > 40`, so the window is genuinely full, and the B snapshot memory (about 41 MiB) gives the ≤ 2 × budget check real teeth.
