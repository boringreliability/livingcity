# polish-004 Red review #1

**Verdict: REJECTED** (2 MAJOR, 7 MINOR)

Reviewed files at HEAD `354223b`:
- `web/e2e/guide.spec.ts`, sha256 `d7d2bfe0b9b63b11380f77c5e331c70b71aded014e78ccd23c9ca2b5a1f4dcce`
- `web/tests/guide_static.test.ts`, sha256 `d74313adcccab7cdca799dae2cff19b7c65f2a95bf0487afc653a64da968ad19`

## What I ran
I started a private Vite server on port 5297 (and stopped it afterwards) and drove it from Node scripts using `@playwright/test`'s chromium with SwiftShader. The scripts are `scratchpad/red-p004/probe{1,2,3}.cjs`.
- **Layout (probe1 `layout`).** These are road sample extents (the same 10 points per link as test 1) and panel rects:
  - 1280×800: roads start at y = 121. In the centre column, x 397–889 have road points at y 121–135. The centre column is x 358–1008 and starts at y 16. Controls are 16–116.
  - 1024×768: roads start at y = 121 (centre column x 358–752, points at x 733–747). The column is 394 px wide.
  - 900×800: roads start at y = 141, with points at y 160 for x 29–368, which lies inside the single column.
  - 768×800: roads start at y = 181.
- **Warm-up (probe1 `warmup`, ×3 with and ×3 without the route).**
  - The wasm URL is `/src/wasm/sim_wasm_bg.wasm`, fetched by the worker `/src/sim/worker.ts?worker_file&type=module`.
  - `page.route('**/*.wasm*')` **does** intercept the worker's fetch (`routed: 1`).
  - "Starting the city…" was visible at `goto` resolution in every run. The first frame came at 1.41–1.60 s without the route and 1.70–1.73 s with it.
  - Test 8 is feasible and not racy.
- **Storage blocked (probe1 `storage`).**
  - The init script really blocks storage: reading `window.localStorage` throws "storage blocked".
  - The current app (Legend read and toggle) produces **no** `pageerror` or console error.
  - Test 5's blocked-storage section therefore cannot fail for reasons outside the guide.
- **60× rate (probe1 `rate`).** 1800 ticks in 15 s wall time (120 ticks/s achieved, matching the target) against the ≥ 840 that test 3 needs. This is feasible with a large margin.
- **Tab order (probe1 `tabs`).**
  - Today's order is Pause, Speed, Diagnostics, Close the main bridge, Legend, 4 timeline buttons, then the slider (a `DIV`, so the B shortcut fires on it).
  - The guide adds about 2 stops. The frozen Tab budgets (Follow ≤ 25, legend ≤ 30, Speed ≤ 40, city.spec 20 Tabs) stay satisfied.
- **Branch / B semantics (probe2).**
  - A's head was 1803. After ← and B: B's frames report `headTick: 1683` (B's own head), and **A's head is not in any frame while B is viewed**.
  - After leaving compare, the viewed scenario is B (paused).
  - The Scenarios panel is `[358,16,1008,96]` at 1280 with 0 roads under it, and `[358,16,752,128]` at 1024 with 8 road points under it.
- **The frozen gold_polish002 `confirm_replace…` state (probe3)** has diagnostics, a road, B, and the confirm panel open.
  - At 900×800 and 768×800 the single column ends at y 564 (Diagnostics) and the Legend starts at y 612. That leaves about 40 px for a guide in the column.
  - At 1280 and 1024 the centre column ends at y 234 or 246, so there is plenty of room.
- **Playwright importing TSX.** A temporary `e2e/zz_red_probe.spec.ts` imported a JSX `.tsx` module and `src/ui/ScenarioPanel.tsx`, and `playwright test --list` loaded it. Both files were deleted afterwards.
  - Importing `GUIDE_STEPS` from `DemoGuide.tsx` in the Playwright Node runner works, as long as that module has no CSS import or browser global at top level.
- `git status` is clean apart from this file.

## Findings

### MAJOR 1: wrong step conditions pass. The step-2 time rule and three step negatives are untested
P4's core promise is "ticked only from real actions, sim ticks never wall time". Correct-looking but wrong implementations pass all 9 tests:
- **(a) Step 2 by wall time** (e.g. "closed for ≥ 9 s"). At 20×, 380 ticks take about 9.5 s, so test 2 cannot tell. Test 3 never closes the main bridge. `guide.spec.ts:86-87`.
- **(b) Step 2 ignoring "closed throughout".** A rule of "≥ 360 ticks since the closure was first seen", even if reopened, passes. Nothing closes and then reopens the main bridge before running.
- **(c) Step 2 on any closure.** Test 3 keeps the other road closed only about 1 s at 60× (≈ 120 ticks < 360) (`guide.spec.ts:139-141`). A rule of "any road closed for 3 min" passes.
- **(d) Step 3 on pause alone.** "Paused after step 1" without the position check passes. Test 2 checks step 3 only before the pause (`:89`) and after the rewind (`:92`), never between `pause()` and `stepBack()`. Test 3 never has step 1.
- **(e) Step 5 when B exists.** Test 2 never asserts step 5 false before compare (`:97-99`), so ticking step 5 together with step 4 passes.

**Fix:**
- In test 2:
  - after `await pause(page)` (`:90`), add `expect((await done(page))[2]).toBe(false)` (paused at the head);
  - after step 4 (`:97`), add `expect((await done(page))[4]).toBe(false)`.
- In test 3 (at 60×):
  1. Keep the other road closed while running for ≥ 4 s (≥ 480 ticks) before "Reopen link", and still expect all false.
  2. Then, paused, close the main bridge with the button. Sleep ≥ 12 s of wall time and expect `[true,false,false,false,false]`.
  3. Reopen the main bridge (still paused) and press Space. Run ≥ 480 ticks (poll `tick`) and expect step 2 still false.

### MAJOR 2: "does not cover the city during the steps" is checked only before step 1
The epic P4 says "It does not cover the city during the steps". The ward's Must NOT says "Cover the city in single view at the supported sizes". Test 1 checks only the fresh state, with no branch, no hint and no "Demo complete" line.
- **The guide pushes Scenarios onto the city.** The spec places the guide *above* the Scenarios panel. Once B exists (steps 4–5, single view), Scenarios moves down by the guide's height.
  - At 1280×800, Scenarios today covers 0 road points (`[358,16,1008,96]`). With a guide of about 80 px above it, Scenarios lands at about y 104–184, while roads lie at y ≥ 121 across x 397–889.
  - At 1024×768 it already covers 8 points and would cover far more.
  - The 60× hint makes the guide taller in exactly this state.
- **Narrow widths are covered too.** README says 768 px and wider are supported. At 900/768 the guide sits in the single column at y ≈ 124+, and roads start at y 141 (900, x 29–368) or 181 (768).
- **An implementation can satisfy every test while covering the city during steps 4–5 at every size.** The Gold reviewer could then reject it under Must NOT. This has to be settled before the tests freeze.

**Fix:** decide the rule in the spec, then pin it in a test. My suggestion:
- In test 2, after step 4 (B viewed, single view, hint visible at 20×), at 1280×800 and 1024×768, compare the road points under **any** `section.panel`/top band with the guide visible against the same points after hiding it with "Hide demo guide". The guide must add **zero** covered points. Re-show it via "Guide" afterwards.
- The same "adds zero" check in test 1 also covers the pre-branch state at all four widths.
- If narrow widths (< 960) are meant to be exempt, the ward must say so explicitly (and README/CONTEXT list it as a deviation) instead of the open-ended "supported sizes".

This will likely force a different placement than "above the Scenarios panel", for example beside Scenarios in the 650-px column, or in the right column's top slot. That is the point: the current spec placement cannot meet P4 once B exists.

### MINOR 1: test 6 pins the button's raw text, not its name
`guide.spec.ts:200` checks `textContent.trim() === 'Guide'`. A correct "Guide" button with an `aria-hidden` icon (e.g. `<span aria-hidden>?</span> Guide`) has the accessible name "Guide" but fails here.

**Fix:** `await expect(page.getByRole('button', { name: 'Guide', exact: true })).toBeFocused()`.

### MINOR 2: test 5 cannot tell `localStorage` from `sessionStorage`
`guide.spec.ts:156-162` uses reloads and `goto` in the same tab, and sessionStorage survives both. An implementation that "remembers" only per tab passes, which contradicts "per viewer (`localStorage`…)".

**Fix:** after hiding, open `await context.newPage()` (same context, so localStorage is shared and sessionStorage is not), call `ready()` there, and expect the guide hidden.

### MINOR 3: test 4's callback check catches only `on*` props
`guide_static.test.ts:22`: a prop `toggleBridge: () => void` (called as `toggleBridge()`) or `actions: SimActions` passes both the callback check and the call regex at `:18`.

Also, `:20` requires an `interface …Props` declared with a column-0 closing brace. A `type Props = {…}` or `interface Props extends X {` fails a correct implementation, so the implementer must know this.

**Fix:** collect every member whose type is a function (`/^\s*(\w+)\??\s*(?:\(|:\s*(?:\([^)]*\)\s*=>|\(\s*\)\s*=>|Function\b))/gm`) and expect `['onHide']`. Accept either `interface` or `type … = {` for Props.

### MINOR 4: the hint's negative cases are untested (d1)
Test 7 checks only "B lags at 20× → shown" and "60× → gone". A hint shown whenever the speed is below 60× (e.g. in A on first visit) passes every test.

**Fix:**
- In test 7, before branching, add `await expect(guide(page)).not.toContainText('60×')` (A, 20×).
- Optionally also check after `A: original` is clicked (`speed` back to 20 first).

### MINOR 5: test 2's step 4 does not match the ward table
The table says "Close the North Bridge in A's past (a branch)". The test presses B on the slider while the main bridge is closed at that position, which *reopens* the main bridge in B. This is valid for "a branch exists", but the table or the test comment should say what is actually done.

### MINOR 6: some requirements have no test
These are untested: "Demo complete … offers to hide itself" (only the text is checked), stickiness after **discard** and after rewinding to before the closure, and Esc-hide being remembered across a reload.
- At least add the discard case to test 2 (`Discard branch` → still `[true×5]`).

### MINOR 7: implementation notes (not test defects; the spec should state them)
1. **A's head is not in the frame while B is viewed** (measured: B's frame has `headTick` 1683, A's head is 1803). The hint condition "below A's head" needs A's head remembered from the last A frame (or exposed by the host). The spec's Inputs imply it is in `frame.timeline`.
2. **`done()` requires each `listitem`'s text to contain the full title.** In the 394 px centre column at 1024, five visible titles wrap past the ~104 px budget, since roads start at y 121. Expect titles as visually hidden text with visible numbers/✓.
3. **Height budget at narrow widths.** In the frozen `gold_polish002` confirm-replace state at 900×800 and 768×800, the guide has about 40 px between Diagnostics (bottom 564) and the Legend (top 612). Any taller guide fails that frozen test.
4. **`DemoGuide.tsx` must stay importable in Node.** It needs no CSS import or `window` access at module top level, because `guide.spec.ts:5` imports it in Playwright's runner.

## Verified sound
- Test 3's ≥ 840 ticks: 1800 measured.
- Test 8's route pattern does catch the worker's wasm fetch, and the warm-up status is reliably visible.
- Test 5's blocked-storage section: the init script works and the existing app produces no error.
- Test 2's flow is feasible:
  - B on the focused slider (a `DIV`) branches;
  - ← gives position < head;
  - after compare the view returns to B, so steps 1 and 3 must be sticky, which gives real teeth to the stickiness rule.
- Test 2's timings at 20× (380 ticks ≈ 9.5 s) are fine.
- Test 1's road check at 1280/1024 is feasible for a guide of ≤ ~100 px in the top band.
- No guide text collides with frozen locators: they use `getByRole('button')`, the guide is hidden while comparing, so compare.spec's `getByText` is unaffected, and frozen tab tours only require focus rings on the new buttons.
- Test 9's ordering check has teeth: `docs/demo.md` currently lacks "Watch the queues" and "Pause and rewind", so it fails today for the right reason.
