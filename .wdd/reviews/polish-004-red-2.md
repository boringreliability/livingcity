# polish-004 Red review #2

**Verdict: REJECTED** (1 MAJOR, 7 MINOR)

Reviewed files at HEAD `a89152c`:
- `web/e2e/guide.spec.ts`, sha256 `7690641d8395d16ba2ee73556f8f5ac5372d4e7632446466ac375dc189efb7b1`
- `web/tests/guide_static.test.ts`, sha256 `fdea4ba44a46fba0cbf78b19223f85fadc292f4da26dec8d6cf5811226a6a7da`

## What I ran
- **`pnpm -C web exec vitest run tests/guide_static.test.ts`.** It fails on importing `../src/ui/DemoGuide`, as expected.
- **The frozen e2e suite with a fake guide.** I wrote a Vite config in the scratchpad (`scratchpad/red-p004-r2/vite.inject.config.mjs` + `inject.js`). It injects a worst-case guide:
  - a `section.panel[aria-label="Demo guide"]`, 240×**100** px;
  - inserted as the first child of `.side` once the first frame exists, and `display:none` under `.app.comparing`;
  - containing 5 `li` with visually hidden titles and a focusable "Hide demo guide" ×.

  I ran the whole frozen e2e suite against it through a temporary Playwright config (port 5298, `guide.spec` ignored; the config was deleted afterwards). Result: **103 passed, 1 skipped, 0 failed (18.6 min)**. This covers `layout`, `gold_polish002`, `compare`, `inspect`, `a11y` (Tab budgets, Esc, axe) and `gold_city003`.
- **Geometry (`probe.cjs geom`, port 5299, guide injected):**

  | Size | Guide rect | Top band right edge | Lowest road y in the right column | Roads under the guide |
  |---|---|---|---|---|
  | 1280 | [1024,16,1264,116] | 1008 (16 px gap) | 141 | 0 |
  | 1024 | [768,16,1008,116] | 752 | 139 | 0 |
  | 900 | [644,16,884,116] | 342 | 141 | 0 |
  | 768 | [512,16,752,116] | 342 | 181 | 0 |

  The right-column placement works at every supported width, with about 23 px of headroom for a hint line.
- **Test-3 timing (`probe.cjs t3timing`, 60×).** I closed the main bridge while running, then paused as `pause()` does. The closure was first seen only **2–3 ticks** before the pause (×3).
- **Cleanup.** Probe servers are stopped (port 4243 untouched), and `git status` is clean apart from this file.

## Round-1 findings: status
| R1 | Status |
|---|---|
| MAJOR 1a: step 2 by wall time | **Partly.** A wall-time rule that counts while paused is caught (`:175-177`). A rule that counts wall time or frames *while running* is not. See MAJOR 1 below. |
| MAJOR 1b: "closed throughout" | Resolved (`:178-185`: reopened, ≥ 480 ticks, step 2 false). |
| MAJOR 1c: any closure | Resolved (`:144-169`: another road closed ≥ 480 ticks). |
| MAJOR 1d: step 3 on pause alone | Resolved (`:90-92`). |
| MAJOR 1e: step 5 with B | Resolved (`:100`). |
| MAJOR 2: guide pushes Scenarios onto the city | Resolved. The guide moved to `.side`, `:101-120` compares covered roads with the guide shown and hidden while B exists (hint visible at 20×), and the frozen suite is green with a 100 px guide. |
| MINOR 1: focus by text | Resolved (`:247` `toBeFocused` by role). |
| MINOR 2: sessionStorage | Resolved (`:200-204` new page). |
| MINOR 3: props regex | Improved, but still brittle (MINOR 3 below). |
| MINOR 4: hint in A | Resolved (`:258`). |
| MINOR 5: table vs. test | Resolved in the table. |
| MINOR 6: discard, Esc remembered, "offers to hide itself" | Still open (MINOR 5 below). |
| MINOR 7: implementation notes | Mostly folded into the spec (A's head remembered, Node-importable). |

## Findings

### MAJOR 1: step 2 still passes with a wall-time (or frame-count) rule that counts only while running
P4 says step 2 "uses sim ticks, never wall time". The two places that could catch a wall-time rule don't:
- **Test 2 (`guide.spec.ts:86`)** runs at 20×, where 380 ticks take about 9.5 s of wall time. A rule such as "main bridge closed and `running` for ≥ 5 s (`performance.now()`)" ticks there too.
- **Test 3 runs the closed bridge for almost no time.** It closes the main bridge while running at 60× (`:173`) and pauses at once (`:175`). I measured only 2–3 ticks (a few tens of ms) of running time with the bridge closed. The 12 s wait is paused, so it catches only a rule that counts wall time regardless of `running`.

A running-wall-time rule, or a "≥ N frames received while running and closed" rule, therefore passes all nine tests. This is the round-1 MAJOR 1a class, only half fixed. It is the headline rule of step 2.

**Fix (test 3):**
1. Before the main-bridge section, select **1×** (`selectOption('1')` + `blur`).
2. Close the main bridge while running.
3. Run for **12 s of wall time**. Assert the sim advanced by fewer than 300 ticks (1× gives about 24).
4. Expect `[true, false, false, false, false]`.

Running at 1× catches wall-time rules both with and without the `running` gate, and frame-count rules, while staying far below 360 ticks. The existing paused-12-s block can stay or be replaced. Then reopen and continue as now (`:178-185`, ideally back at 60× so the 480 ticks are quick).

### MINOR 1: the 3-minute threshold has no lower bound
Any threshold from about 5 to 380 ticks passes, e.g. "closed for 60 ticks (30 sim s)". `:84` only checks step 2 immediately after step 1, and test 3's closure lasts about 3 ticks.

**Fix:** in test 2, at 20×, do the following, then resume with Space:
1. Poll until `tick ≥ closedAt + 280`.
2. Pause.
3. Assert `snap.tick < closedAt + 360`, then `expect((await done(page))[1]).toBe(false)`.

At 40 ticks/s the pause latency is a few ticks. Step 3 cannot tick here, because the position equals the head.

### MINOR 2: step 3's "after step 1" condition is untested
A rule of "A paused below its head" without the step-1 precondition passes. Test 7 rewinds twice without closing anything, but never reads the steps.

**Fix:** in test 7, after the two `stepBack`s (`:256`), add `expect((await done(page))[2], 'no step 3 before step 1').toBe(false)`.

### MINOR 3: test 4's static regexes reject some correct implementations
The implementer must know these constraints before the tests freeze. Either state them in the ward spec or relax the regexes.
- **`:18`.** Any `seek(`, `branch(`, `compare(` (with or without a space) in a **string or JSX text** fails. For example, the hint or step copy "…press B to branch (an intervention in A's past)" fails. Comments are stripped; strings are not.
- **`:20`.** `interface DemoGuideProps extends Base {` does not match.
- **`:22`.**
  - `readonly onHide: () => void` captures `readonly` and yields `[]`.
  - `onHide: VoidFunction` is not seen as a function, which also yields `[]`.

  Both fail a correct implementation.

**Fix:**
- Allow an optional `readonly` before the member name.
- Accept `\w*Function\b` and `extends [^{]+` in the Props regexes.
- Add one line to the ward spec: "no `seek(`/`branch(`/`compare(` in any string".

### MINOR 4: Tab detection in test 6 depends on how the name is built
`:242` accepts only `aria-label === 'Hide demo guide'` or a trimmed `textContent` equal to it. A button `<span aria-hidden>×</span><span class="sr-only">Hide demo guide</span>` has the right accessible name but fails.

**Fix:** inside the loop, use `await guide(page).getByRole('button', { name: 'Hide demo guide' }).evaluate((e) => e === document.activeElement)`.

### MINOR 5 (carried from round 1, MINOR 6): some requirements have no test
These are untested:
- stickiness after **Discard branch** (only stickiness across compare and B view is tested);
- Esc-hide being remembered across a reload;
- "Demo complete … offers to hide itself".

**Fix:** at the end of test 2, click "Discard branch" and expect `[true×5]`.

### MINOR 6: the hint's "below A's head" condition is untested
A hint shown whenever B is viewed at a speed below 60× passes, because B always lags in test 7. This is acceptable for d1, which is cosmetic. I note it for the Gold reviewer's smoke test.

### MINOR 7: the size limits are not asserted directly
"≤ 100 px tall" and "≥ 4 px clear of the centre column" are not asserted. They are covered only indirectly, by the road and overlap checks at 1280 and 1024 (`:52-71`, `:101-120`).
- My probe shows that a 100 px guide in `.side` leaves 16 px to the centre column and about 23 px to the first right-column road.
- `layout.spec` (frozen) covers overlaps at the narrow widths.

**Optional:** add `expect(g.height).toBeLessThanOrEqual(100)` and `expect(g.left - topBandRight).toBeGreaterThanOrEqual(4)` in test 1.

## Verified sound
- **Placement feasibility.**
  - A 100 px guide at the top of `.side` passes the whole frozen e2e suite (103/103 non-skipped).
  - It covers no road at 1280, 1024, 900 or 768, and sits 16 px from the centre column at ≥ 960 px.
  - The 5 titles fit as visually hidden text inside `li`, and `done()` reads `textContent`.
- **The bridge button keeps `aria-label="Close the main bridge"` when closed** (`ControlPanel.tsx`), so the re-click at `guide.spec.ts:179` reopens it.
- **Test 2 has teeth on persistence.**
  - Hiding and re-showing the guide mid-flow (`:117-122`) forces step state to survive the guide's unmounting.
  - After compare the view is B, with the bridge open in B, which forces stickiness of step 1.
- **Test 3's timings are feasible.**
  - The pause comes 2–3 ticks after the closure, far below 360.
  - A previous measurement gives 120 ticks/s at 60×, so ≥ 480 ticks takes about 4 s.
- **Test 5's new-page check** really separates localStorage from sessionStorage.
- **Test 8's route** catches the worker's wasm fetch (round 1). `toHaveCount(0)` with `getByRole` also accepts a guide that is mounted but `display:none`.
