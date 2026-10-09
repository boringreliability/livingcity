# polish-002 Gold review, round 2

**Verdict: REJECTED** (1 MAJOR, 5 MINOR)

Reviewer: a fresh Gold-gate subagent. I reviewed only the artifacts: the ward spec, the frozen test, round 1's review, `git diff 584c830..HEAD` / `HEAD~1..HEAD`, and the running app.

## What I ran
- **Frozen test:** `shasum -a 256 web/e2e/layout.spec.ts` gives `d62394ae26aab425bfc88e2f09d417d140bbfa6619f339c8e2b9da7ec6e0cad8`, unchanged. In `584c830..HEAD` the only test file touched is the new `web/e2e/gold_polish002.spec.ts` (a regression spec added by the implementer). No approved test file changed.
- **Typecheck:** `pnpm -C web typecheck` is clean.
- **Unit tests:** `pnpm -C web test` gives 22 files, **111 passed**.
- **e2e:** `pnpm -C web e2e` gives **94 passed, 1 skipped** (the existing G4 skip) in 14.6 min. That includes all 6 `layout.spec.ts` tests, the new `gold_polish002.spec.ts`, and the a11y and timeline suites.
- **Manual smoke test and probes:**
  - Dev server `vite --port 5299 --strictPort`, stopped afterwards. Port 4243 was not touched.
  - Playwright MCP (Chromium, DPR 1), with an in-page probe that checks pairwise overlap among visible `.panel` and `.side-label` elements, panels off screen, and `scrollWidth`.
  - Screenshots are in `.playwright-mcp/p002g2-*.png` (git-ignored).
  - No probe file was copied into `web/e2e`, and `git status` is clean apart from this file.

## Round-1 findings: status
| R1 | Status |
|---|---|
| MAJOR 1: confirm panel over the scenario and road panels at 900/768 | **Resolved.** At ≤ 959 the confirm panel sits in the left stack (16–342 × 244–354 at 900 and 768). At ≥ 960 it sits in the centre stack below the scenario panel (1024: 375–735 × 136–246; 960: 358–688 × 136–246). There are 0 overlaps at 1280×800, 1280×720, 1024, 960, 959, 900 and 768 with diagnostics open and a road selected. |
| MAJOR 2: `left: 358px` assumed a narrow control panel | **Resolved.** `.controls` is now 326 px wide. With `?demand=6` and the full "⚠ Behind — the engine cannot keep up with this speed" text injected, the controls span 16–342 × 16–164 and push the stack down. There are 0 overlaps at 1280, 1024 and 768, including confirm + diagnostics at 768. |
| m3: road panel at 1280×720 in compare | Unchanged (road panel at 456–646). Acceptable as a known issue. |
| m4: scenario panel over A's top rows at ≤ 959 in compare | Mostly gone. The panel ends at y 236 and A's city starts at about 240 at 768. |
| m5: label layout thrash | **Resolved.** `hideCutLabels` reads all rects first and then writes (`App.tsx:189-196`). The per-mount call in the ref callback runs once per new element only. |
| m6: timeline at 768/900 | **Resolved below 960** (two rows, glyph buttons, the track at 716 px of 768). See MINOR 3 for 960–1100. |
| m7: `compare-view` unstyled class | Not addressed. Nit. |

## Smoke-test log (the ward's Manual Smoke Test)
1. **1280×800: branch, select a road, compare.**
   - No overlaps and no horizontal scroll.
   - The road panel moves bottom-left in compare (16–256 × 536–726).
   - Labels at the halves' edges are hidden, not cut.
   - The compare frame is neutral ("Comparing A and B", solid border). **PASS**
2. **Resize to 1280×720, 1024, 960, 959, 900 and 768,** in branch, confirm-replace (with diagnostics), compare, and compare with a road picked on B.
   - The probe found 0 overlaps everywhere, apart from the error panel in MAJOR 1.
   - The camera refits each time.
   - The panels rearrange at the 959/960 boundary as designed. **PASS** apart from MAJOR 1
3. **Refit only when untouched.**
   - Covered by `resize_refits_an_untouched_view` and `resize_keeps_a_user_camera` (both green).
   - I also loaded the page at 200×150, 500×400, 767×600, 1200×700, 1280×720 and 1920×1080, and resized during start-up. Every case refit to the fresh-fit camera at 1280×800 (`cx` 70, `cy` 70, `zoom` 0.14973). **PASS**
   - One unreproduced observation: the very first MCP page load showed `cx` −257, `cy` −188, `zoom` 0.219, a zoomed-in, unfitted view. I could not reproduce it in 8 later attempts. It was probably a browser-launch artifact (viewport set before the first navigation), but it is worth noting.
4. **Compare at 1024:** labels near the divider are hidden, not cut (Eastgate on B, for example). **PASS**

**Pass criteria**
- No overlaps or horizontal scroll at the supported widths: **FAIL** (MAJOR 1).
- Refit only when untouched: **PASS**.
- In compare, no covered roads and no cut labels: **PASS** (1280/1024).

### Regression probes asked for
- **Pointer events through the stacks' empty areas.**
  - `elementFromPoint` at the empty points (350,60), (200,120), (400,105) and (700,110) in compare at 1280 returns `CANVAS.city` / `city-b`.
  - Both stacks use `pointer-events: none` with `auto` on their panels. OK.
- **Timeline at 768.**
  - A pointer click at 30 % of the track gives tick 545 of 0–1817.
  - ArrowRight adds +120.
  - A drag from 30 % to 60 % gives 1090.
  - The buttons are 22 px tall on one line, and their accessible names stay the long text. OK.
- **Tab order.**
  - At ≤ 959: Play, Speed, Diagnostics, Compare, Discard, then the timeline.
  - At ≥ 960: controls, then the timeline, then the scenario panel (the old DOM order).
  - Both are coherent, and the a11y suite is green.
- **Media-query switch with a panel open:** see MINOR 1, which is a real remount.
- **"Starting the city…":** centred, and it collides with nothing.
- **Error panel:** see MAJOR 1.

## Findings

### 1. MAJOR: the error panel is reachable in normal use, is never cleared, and sits on top of the controls, the scenario panel and the road panel at every supported width
`web/src/styles.css:373-379` (`.error { top: 64px; left: 50%; transform: translateX(-50%); max-width: 420px }`) and `web/src/App.tsx:1058-1062` (rendered outside both stacks). `setError` is never reset (`App.tsx:169,252,266`, with no `setError(null)` anywhere).

Round 1 judged the error panel "only on a fatal WebGL2 or worker error, when no scenario panel exists". That is wrong: `c.onError` (`App.tsx:265`) receives every host refusal, and the UI can trigger these.

**Reproduction (3 clicks):**
1. Branch.
2. Click "A: original" and step back on the timeline to before the branch tick.
3. Click "Compare side by side".

The host replies `compare refused: tick 2023 is before the branch (2143) or the other scenario's window` (`host.ts:331`), and a `p.panel.error` appears and stays for the rest of the session, even after a later successful compare.

**Probe results:**

| Window | Overlaps |
|---|---|
| 1280×800, 1280×720 | Scenarios × error. In compare the error (417–863 × 77–131) covers the "Discard branch" button. |
| 1024, 960 | Simulation controls × error, Scenarios × error |
| 900, 768 | Simulation controls × error, Scenarios × error, Selected road × error |

- `elementFromPoint` on the right part of "Close the main bridge" at 900 returns `P.panel error`. `pointer-events` is `auto`, so the banner **blocks part of the demo's main button** permanently. See screenshots `p002g2-compare-900x800.png` and `p002g2-error-persists-1280.png`.
- The cause (a sticky error, and Compare not guarded before the branch) predates this ward. But P2's contract is "Panels never sit on top of each other, at any supported width". This state is reachable through the normal UI, the element is a `.panel`, and this ward is the one that introduced the stacking mechanism that fixes exactly this.
- The ward spec's narrower test definition (`section.panel`) explains why the frozen test misses it. It does not make the overlap acceptable.

**Fix (small):**
- Render the error as the first child of the centre stack (≥ 960) or of the left stack (≤ 959), like the scenario and confirm panels, so it stacks instead of floating at `top: 64px`.
- Make it dismissible, or clear it on the next accepted command, so a refusal does not stay up forever.
- Add a case to `gold_polish002.spec.ts` that triggers the refused compare, then asserts no overlap and that "Close the main bridge" and "Discard branch" are hit-testable.
- (Guarding Compare when the viewed position is before the branch would be nice, but the layout fix is what P2 needs.)

### 2. MINOR: crossing 959/960 px remounts the scenario and confirm panels, which steals or drops focus
`App.tsx:903-950,1008,1057`: `scenarioPanels` is rendered in `.left-stack` when `narrow` and in `.center-stack` otherwise. A media-query change moves the panels to a different parent, so React unmounts and remounts them.

**Measured:**

| Panel open | Before the resize | After crossing 960 → 959 |
|---|---|---|
| Confirm-replace | focus on the timeline slider | focus jumps to **"Replace the branch"** (`ConfirmReplace` `autoFocus`, `ConfirmReplace.tsx:50`). Enter or Space then replaces B, a destructive action. |
| Scenario panel (compare) | focus on "Discard branch" | focus drops to `BODY` at 1024 → 900, and the keyboard position is lost. |

- These are edge cases (a window resize across the breakpoint while a panel has or lacks focus), so MINOR.
- **Fix:** keep one DOM position and move the panel with CSS only. For example, render `scenarioPanels` in a single container whose placement switches via the `(max-width: 959px)` media query. CSS grid areas on a shared wrapper, or `display: contents` tricks, would do it. Alternatively, preserve and restore `document.activeElement` across the switch and drop `autoFocus` on remount.

### 3. MINOR: from 960 to about 1100 px the timeline track is too short to scrub
- **960×800:** the track is about 115 px wide (x 400–515), and the "branch 00:17:51" caption fills it.
- **1024×768:** the track is about 178 px wide.
- Both are supported widths (README: ≥ 768). The two-row bar only starts at ≤ 959, and the regression spec checks track width only at 900 and 768.
- **Fix:** move the two-row breakpoint up (for example `max-width: 1099px`), or use a container query on `.timeline` that wraps when the track would be under about 40 % of the bar.

### 4. MINOR: the fixed 326 px control panel wraps the speed readout onto three lines with the stress badge
With `?demand=6` the row reads "0.0× / of / 20×", stacked beside the speed `select` (`p002g2-demand6-768x800.png`). It does not overlap anything, but it does not look finished.
- **Fix:** `white-space: nowrap` on the readout, with the stress badge wrapping to its own line, or move the badge to the "Behind" line.

### 5. MINOR: at 768×800 the left stack reaches the legend with no margin left
- With `?demand=6`, "Behind" shown, the confirm panel open and diagnostics open, the stack runs controls 16–164, Scenarios 172–284, Confirm 292–402, Diagnostics 410–**612**. The legend starts at **612**, so the gap is 0 px.
- Any extra line (a longer confirm text, a wrapping button) would overlap.
- **Fix:** give `.left-stack` a `max-height: calc(100vh - <bottom band>)` with `overflow: auto` on Diagnostics, or collapse Diagnostics while a confirm is open at ≤ 959.

### 6. MINOR (carried over): r1 m3 (the road panel at 1280×720 in compare) and r1 m7 (the unused `compare-view` class) are unchanged
List them under Known issues if they are not fixed.

## What is good
- The two-stack structure (`.left-stack` / `.center-stack`, `pointer-events: none` on the stacks and `auto` on their panels) removes the hard-coded `top` collisions from round 1. Panels of any height now stack.
- The React `narrow` state and the CSS media query use the same 959 px boundary, and the switch is consistent at 959 and 960.
- The timeline below 960 is clean:
  - the glyph buttons keep their long accessible names (`aria-label`, short glyphs `aria-hidden`);
  - the track gets its own full-width row;
  - the panels above the bar moved up by the extra row.
- The batched label hide is correct, and it keeps exactly the frozen test's 0.5 px tolerance.

## Required to pass
- Fix MAJOR 1: the error panel must not overlap any panel at any supported width, and it must not block controls permanently. Add regression coverage in a new or the existing non-frozen spec.
- The MINORs can be fixed or listed under Known issues. MINOR 2 (focus jumping to a destructive default on resize) is the one I would fix.
