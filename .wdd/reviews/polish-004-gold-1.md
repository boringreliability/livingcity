# polish-004 Gold review #1

**Verdict: REJECTED** (0 BLOCKER, 2 MAJOR, 6 MINOR)

Reviewed HEAD `9af7d00`; implementation diff `911bf59..HEAD`.

## Frozen tests
- `web/e2e/guide.spec.ts` sha256 `84d9651218c0643745753717b5930919c9778973a9004aa8c4aeab9d154c4456`: **unchanged**.
- `web/tests/guide_static.test.ts` sha256 `e68e439e560418a6dfffa8997b39ad9060d54027ef6f7e9fb9535b85e12eb9ce`: **unchanged**.
- `git diff --stat 911bf59..HEAD` touches no test file. It covers the ward status, README, `docs/demo.md`, `App.tsx`, `styles.css`, `ControlPanel.tsx`, `DemoGuide.tsx` and `guideProgress.ts`.

## What I ran
| Command | Load avg (1/5/15) before → after | Result |
|---|---|---|
| `pnpm -C web typecheck` | 18.35 / 23.11 / 37.96 | exit 0 |
| `pnpm -C web test` | → 17.68 / 22.89 / 37.80 | **24 files, 118 tests passed** |
| `pnpm -C web e2e` (full, 23.6 min) | 16.83 / 22.63 / 37.62 → 35.31 / 37.87 / 37.41 | **109 passed, 1 failed** (`layout.spec.ts:323 labels_never_half_cut`), 1 skipped (G4) |
| `playwright test e2e/layout.spec.ts -g labels_never_half_cut --repeat-each 3` at HEAD | 30.59 → 27.02 | 3/3 failed: Eastgate and Eastgate Fields "hidden although they fit" after the 768 → 1280 resize |
| The same test on a `git archive 911bf59` copy of `web/` (same wasm), `--repeat-each 3`, then `--repeat-each 2` | ~19–20 | fails there too (2 of 2 runs had failures) → **pre-existing, not caused by this ward** (MINOR 6) |

All 7 `guide.spec.ts` tests passed, and so did both static tests (test 4, test 9).

## Code checks requested by Red r3
- **Step 2 counts frame ticks.** `guideProgress.ts:31-34` uses `f.tick - since.tick >= 360` from frames. There is no `performance.now()` and no speed × wall time. ✔
- **App passes no setter or client into the guide.** `App.tsx:1111` passes `done`, `hint` (a string), and `onHide={() => hideGuide(true)}`, which only sets UI state and storage. `DemoGuide.tsx` imports nothing. `guideProgress.ts` only does `import type` from `sim/protocol`. ✔ The guide never sends anything.
- **Storage.** Reads and writes are wrapped in try/catch (`App.tsx` `readGuideHidden`/`writeGuideHidden`), and the initial read is a lazy `useState` initializer. ✔
- **Esc ordering.** The guide branch comes first, but only when the target is inside `section.guide`. The confirm → vehicle → road order of polish-001 is unchanged otherwise. ✔ See MINOR 5.
- **Tab order** (measured): Play, Speed, Diagnostics, Close the main bridge, **Guide**, **Hide demo guide**, Legend, timeline controls. ✔

## Smoke log (Playwright MCP, Vite on :5299 with storage cleared, 1280×800 unless noted)
1. **Fresh load.** The guide is at the top right (x 1024–1264, y 16–73, 57 px tall). It reads "1. Close the main bridge" with markers 1–5 and none done, and it covers no road. ✔
2. **Close the main bridge** (button) → "✓1", now "2. Watch the queues". After about 3.5 sim min at 20× → "✓2", now "3. Pause and rewind". ✔
   - The bridge button's label "Main bridge closed — reopen" now **wraps to two lines**, and the control panel grows to 113 px (bottom y = 129). See MAJOR 2.
3. **Pause, then −1 min** (position 6222 < head 6342) → "✓3", now "4. Try another decision". ✔
   - As a newcomer I had no cue for *how* to "try another decision". Reopening the bridge in the past was the only obvious action. See MINOR 3.
4. **Reopen the bridge in A's past** → branch B, "✓4", now "5. Compare side by side".
   - The hint "Tip: 60× brings B to A's time sooner (+ or Speed)" appears. The guide is 87 px tall with the hint, and the scenarios panel ends at x 1008 < 1024. ✔
   - Play at 20×. Once B's position (6704) passed A's head (6342), **the hint disappeared** (the Red r3 "below A's head" check). ✔
5. **Compare side by side** → the guide is hidden. ✔ The "Guide" button still says `aria-pressed=true` (MINOR 4).
6. **Leave compare** → all five ✓ and "Demo complete — hide this guide with ×". ✔ text, but **the panel overflows**: it is 290 px wide in a 240 px column, and **the × button sits at x 1279–1303 in a 1280 px viewport**. At 1024×768 it sits at x 1023–1047. See MAJOR 1.
7. **Discard branch** → all five steps stay ✓ and "Demo complete" stays (the Red r3 stickiness check). ✔
8. **Keyboard.** Tab reaches Hide demo guide, but its focus ring is off-screen (MAJOR 1). Esc → the guide is hidden, focus is on "Guide", `aria-pressed=false`, and the stored value is `"1"`. ✔
9. **Reload** → the guide stays hidden (the Esc-hide is remembered: Red r3 check). ✔ "Guide" → it is shown again, `aria-pressed=true`, the stored value is `"0"`, and progress restarts at step 1 (per session, as specified). ✔
10. **Widths with the bridge closed** (single view, the core demo state):

    | Width | Guide position | Overlaps | Roads under the controls |
    |---|---|---|---|
    | 1280 | x 1024–1264 | none | 0 |
    | 1024×768 | x 768–1008 | none | **link 292** (the Westbrook Heights access road, y 120–128) and the label "Westbrook Heights", both under Simulation controls. With the Guide button hidden (DOM probe) the same state covers 0 roads |
    | 900 | x 644–884 | none | 0 |
    | 768 | x 512–752 | none | 0 |

    The Legend covers bottom roads at 900 and 1024. That predates this ward (the legend is expanded) and is not attributed here.
11. **Console.** Only favicon 404s, no page errors.

## Findings

### MAJOR 1: the "Demo complete" state pushes the hide button off-screen (`web/src/ui/DemoGuide.tsx:23`, `web/src/styles.css:723`)
**Problem.**
- `.guide-now` is a flex item with `white-space: nowrap` but no `min-width: 0`. The flex item cannot shrink below its content, so the ellipsis never applies.
- The text "Demo complete — hide this guide with ×" (236 px) plus the × button make the guide 290 px wide in the 240 px `.side` column.
- At 1280×800 the "Hide demo guide" button lies at x 1279–1303, outside the 1280 px viewport. At 1024×768 it lies at x 1023–1047.
- The body does not scroll horizontally, so in exactly the state where P4 says the guide "offers to hide itself", the offered control cannot be clicked. Its keyboard focus ring is invisible, and the panel breaks the layout rule against off-screen panels.
- No frozen test inspects geometry in the complete state, so the suite stays green.

**Fix.**
- Add `min-width: 0` to `.guide-now`, or let the line wrap within ≤ 100 px.
- Use a shorter complete line, for example "✓ Demo complete — hide with ×".
- Then verify that the guide's right edge is ≤ the viewport minus 16 px at 1280, 1024, 900 and 768 in the complete state.

### MAJOR 2: the Guide button makes the control panel taller than the top inset, covering a road at 1024×768 (`web/src/ui/ControlPanel.tsx:85-102`, `web/src/styles.css:770-777`)
**Problem.**
- Putting "Guide" beside the bridge button shrinks the bridge button to about 240 px. Its labels "Main bridge closed — reopen" and "Close the main bridge (pending)" then wrap to two lines.
- The control panel grows from 98 px to 113 px (bottom y = 129), which exceeds `FIT_INSETS.top = 120`.
- At 1024×768, with the main bridge closed (the core demo state from step 1 on), it covers link 292 and the "Westbrook Heights" label. Without the Guide button the same state covers 0 roads.
- This is a regression of polish-002's pinned top band (controls within the inset band), and it breaks the ward's Must NOT "cover the city in single view at the supported sizes".
- `layout.spec` only checks coverage with the bridge open, so it does not catch this.

**Fix.** Keep the bridge label on one line at every state. For example:
- move "Guide" into the first row as a compact button next to the Diagnostics "≡" (there is room before it);
- or give the bridge row's labels a guaranteed single line.

Then check that the controls' bottom is ≤ 120 at all four widths with the bridge closed and pending.

### MINOR 1: the hint wording differs from the spec (`web/src/ui/guideProgress.ts:56`)
The spec says "Tip: 60× gets B to A's time faster (+ or Speed)". The code says "…brings B to A's time sooner…". The test only checks "60×".

**Fix:** use the spec text, or amend the spec.

### MINOR 2: step 2 can tick from timeline jumps in A's past (`web/src/ui/guideProgress.ts:31-34`)
"Closed throughout" is only checked at the frames that arrive. Take a close, reopen and re-close history in A. Paused, a click-seek from just after the first closure to more than 360 ticks later (also closed) skips the open interval, and step 2 ticks.

This is contrived and low-impact.

**Fix:** only accumulate while `f.clock.running`, or reset `since` when the tick jumps forward while paused.

### MINOR 3: "Try another decision" gives a newcomer no way in (`web/src/ui/DemoGuide.tsx:23`)
The current-step line names step 4 but not how to do it: "change a road in the past to start branch B". I guessed it. The spec only asks for a title, so this is not a P4 failure. It does weaken the pass criterion "a newcomer completes the demo from the guide alone".

**Fix:** a short "how" sub-line or a `title` per step, within ≤ 100 px.

### MINOR 4: the Guide toggle claims `aria-pressed=true` while comparing, but the guide is hidden (`web/src/App.tsx:1079`)
Pressing it in compare silently persists "hidden".

**Fix:** pass `guideShown={!guideHidden && !comparingNow}`, or disable it while comparing.

### MINOR 5: Esc inside the guide takes priority over an open "replace branch" confirmation (`web/src/App.tsx` Esc branch)
This only happens when focus is inside the guide, which the spec asks for. Noted for awareness; no change needed.

### MINOR 6 (pre-existing, not this ward): `layout.spec.ts:323 labels_never_half_cut` fails intermittently
It fails at load average ~20–30 both at HEAD and on an extracted `911bf59` tree. Eastgate labels stay hidden after the 768 → 1280 resize, and in compare at 1024, labels are cut. Please log it in the backlog. It does not count against polish-004.

## Verified sound
- Steps derive from frames only. Step 1 is every `central_bridge` link closed. Step 3 needs step 1, scenario A, paused, and position < head. Step 4 is `branchTick ≥ 0`. Step 5 is compare with a branch.
- Steps are sticky for the session, including after Discard branch.
- Hidden during warm-up (`ready && frame`) and while comparing.
- Done steps are shown with a text "✓" plus a solid border. Screen readers get the titles and "(done)".
- No name collisions: the step titles are `sr-only` spans and `title` attributes, not buttons.
- Docs: `docs/demo.md` names the five titles, and README explains the guide and "Guide".
- Cleanup: Vite on :5299 is stopped, the scratch baseline is deleted, and port 4243 was never touched. `git status` is clean apart from this file (`.playwright-mcp/` is gitignored).
