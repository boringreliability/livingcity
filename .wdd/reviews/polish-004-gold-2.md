# polish-004 Gold review #2

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 6 MINOR)

Reviewed HEAD `677aa50` (round-2 fixes: `git diff HEAD~1..HEAD`); full implementation `911bf59..HEAD`.

## Frozen tests
- `web/e2e/guide.spec.ts` sha256 `84d9651218c0643745753717b5930919c9778973a9004aa8c4aeab9d154c4456`: **unchanged**.
- `web/tests/guide_static.test.ts` sha256 `e68e439e560418a6dfffa8997b39ad9060d54027ef6f7e9fb9535b85e12eb9ce`: **unchanged**.
- `git diff --stat 911bf59..HEAD -- web/e2e web/tests` shows one change: a new file, `web/e2e/gold_polish004.spec.ts` (95 lines, regressions). No approved test was edited.

## What I ran
| Command | Load avg (1/5/15) before → after | Result |
|---|---|---|
| `pnpm -C web typecheck` | 56.00 / 46.36 / 38.78 → 64.49 / 48.28 / 39.50 | exit 0 |
| `pnpm -C web test` | → 72.46 / 50.20 / 40.23 | **24 files, 118 tests passed** |
| `pnpm -C web e2e` (full, 19.7 min, port 5190) | 65.84 / 49.88 / 40.29 → 29.57 / 31.37 / 35.01 | **114 passed, 0 failed**, 1 skipped (G4). All 7 `guide.spec.ts` tests passed, and so did all 4 `gold_polish004.spec.ts` regressions. `layout.spec.ts labels_never_half_cut` (round-1 MINOR 6, intermittent) passed this run. |

## Round-1 findings: status
- **MAJOR 1 (complete state pushed the × off-screen): resolved.**
  - `min-width: 0` is now set on `.guide` and `.guide-now`, and the text is "Demo complete — hide with ×".
  - Measured in the complete state, the guide stays inside its 240 px column and the hide button stays on screen:
    - 1280: guide x 1024–1264, × at 1229–1253;
    - 1024: guide 768–1008, × 973–997;
    - 900: guide 644–884, × 849–873;
    - 768: guide 512–752, × 717–741.
  - `.guide-now` scrollWidth equals clientWidth (186), so nothing is clipped.
  - The guide is 55 px tall, and no road lies under it.
- **MAJOR 2 (bridge label wrapped, controls covered a road at 1024): resolved.**
  - "?" now sits in the first row, and the bridge button is a single line (29 px) in every state: open, "Main bridge closed — reopen" and "Close the main bridge (pending)".
  - At 1280, 1024, 900 and 768 the control panel's bottom is 114 (≤ 120), with 0 sampled road points under it and no overlap with the guide.
- **MINOR 1 (hint wording): resolved.** The hint now reads "Tip: 60× gets B to A’s time faster (+ or Speed)".
- **MINOR 3 (no "how"): resolved.** Each step now has a `title` tooltip and `sr-only` "how" text.
- **MINOR 4 (aria-pressed while comparing): resolved.** In compare, "?" is `disabled`, `aria-pressed=false`, title "The demo guide steps aside while comparing". After leaving compare it is `aria-pressed=true` and enabled again.
- **MINOR 2 (step 2 can tick from paused seeks across an open interval): not addressed.** It is still contrived and low-impact. It stays MINOR (see 5 below).
- **MINOR 6 (pre-existing `labels_never_half_cut` flake): not logged in `.wdd/memory/polish-backlog.md`** (see 6 below).

## Smoke log (Playwright MCP, Vite on :5299 with `localStorage` cleared; 1280×800 unless noted; port 4243 not touched)
1. **Fresh load.**
   - The guide is at the top right (1024–1264 × 16–73) and reads "1. Close the main bridge", with markers 1–5 and none done.
   - The control row reads Pause · 20× · "20.0× of 20×" · **?** · ≡, and the row does not overflow.
   - Controls bottom = 114. No road is under either panel.
2. **Close the main bridge** (button) → ✓1, now "2. Watch the queues". The bridge label "Main bridge closed — reopen" stays on one line.
3. **Resized to 1024×768** with the bridge closed: controls bottom 114, 0 roads under them, guide 768–1008. Step 2 ticked once about 3 sim min had run → "3. Pause and rewind".
4. **Space, then −1 min** → ✓3, now "4. Try another decision". The sr-only/tooltip "how" text reads "Change a road there (B, or a road's Close link)…".
5. **B** → branch B is created, ✓4.
   - The guide now reads "5. Compare side by side" with the hint "Tip: 60× gets B to A’s time faster…" (wrapped to 2 lines; the guide is 87 px, bottom 103).
   - The bridge reads "Close the main bridge (pending)" on one line, controls bottom 114.
   - The Scenarios panel spans x 358–752, which does not overlap the guide.
6. **Compare side by side** → the guide is hidden and "?" is disabled with `aria-pressed=false`.
7. **Leave compare** → all five ✓ and "Demo complete — hide with ×". The "?" is re-enabled with `aria-pressed=true`. I measured the complete state at 1024, 900, 768 and 1280 (numbers above); everything is on screen.
8. **Tab order:** Play, Speed, **Guide ("?")**, Diagnostics, Close the main bridge, A: original, B: branch…, Compare side by side, Discard branch, **Hide demo guide**, Legend, timeline controls.
9. **Esc with focus on "Hide demo guide"** → the guide is hidden, focus moves to "Guide", `aria-pressed=false` and `livingcity.guide.hidden="1"`. Enter on "Guide" shows the guide again.
10. **`?demand=6`** (1280 and 1024):
    - The stress badge sits in the first row. "20.0× of 20×" wraps to 3 lines, and the panel is 112 px tall (bottom 128 > 120).
    - At 1024 the panel covers links 292/293 (the Westbrook Heights access road).
    - **With "?" removed via the DOM, the same is true** (bottom 128, the same links 292/293), so the vertical overflow and the coverage predate this ward.
    - What the ward does add: the badge and the bridge button now stick out past the panel's right border by ~36 px (content right 378 vs panel 342, against 345 without "?"). See MINOR 1.
11. **Console:** only the favicon 404 and the expected `?demand` warnings. No page errors.

## Findings

### MINOR 1: in `?demand=` stress mode the first row overflows the panel horizontally (`web/src/ui/ControlPanel.tsx:67-89`)
**Problem.**
- With the stress badge, Play + Speed + achieved speed + "?" + ≡ + "stress test ×6" no longer fit the 326 px panel.
- The badge (x 286–378) and the bridge button visibly extend about 36 px past the panel's right border (342).
- The panel's height overflow of the top band (bottom 128, covering links 292/293 at 1024) is **pre-existing**: it is identical with "?" removed. Only the horizontal spill is new, and it got worse by ~33 px.
- This is measurement-only mode, so it stays MINOR.

**Fix:** move the stress badge to its own line or below the bridge button, or let the row `flex-wrap`. Log the pre-existing ≤ 120 px violation under stress in the polish backlog.

### MINOR 2: the visible label is "?" but the docs and tooltip say "Guide" (`README.md:44`, `docs/demo.md:5`, `web/src/ui/DemoGuide.tsx` hide-button title)
**Problem.**
- README and demo.md say "the **Guide** button shows it again", and the × tooltip says "(Guide shows it again)".
- A sighted user sees only "?". The accessible name is "Guide", and the tooltip is "Show or hide the demo guide".
- "?" reads as "help", which is a reasonable mapping, so it is discoverable. But the docs name a label nobody sees.

**Fix:** write "the **?** (Guide) button" in README/demo.md and in the × title.

### MINOR 3: no visible focus ring on "?" while the guide is shown (`web/src/styles.css:778-781`)
**Problem.**
- `.guide-toggle[aria-pressed='true']` (specificity 0,2,0) overrides `button:focus-visible` (0,1,1). A focused, pressed "?" draws the same pressed outline (`--text`, offset −2) as an unfocused one, and the accent focus ring never shows.
- Measured: focused + pressed gives outline colour rgb(227,231,236), offset −2px.
- `.diag-toggle[aria-expanded]` and `.scenarios button[aria-pressed]` have the same pre-existing pattern.

**Fix:** add `.guide-toggle[aria-pressed='true']:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`, and do the same for the siblings.

### MINOR 4: the disabled "?" explains itself only through `title` (`web/src/ui/ControlPanel.tsx:74-75`)
A disabled button is not focusable, so keyboard and screen-reader users never get "The demo guide steps aside while comparing". This is harmless because the guide is hidden in compare anyway.

**Fix (optional):** `aria-disabled` plus a no-op handler, or leave it as is.

### MINOR 5 (carried over from round 1, MINOR 2): step 2 can tick from paused forward seeks across an open interval (`web/src/ui/guideProgress.ts:31-34`)
The fix is unchanged: accumulate only while `f.clock.running`.

### MINOR 6 (carried over from round 1, MINOR 6): the `labels_never_half_cut` flake is not in the backlog
It passed this run, but round 1 reproduced it at `911bf59`. It is not logged in `.wdd/memory/polish-backlog.md`.

**Fix:** add a backlog line.

## Verified sound
- Step logic is unchanged since round 1. The guide still sends nothing: `DemoGuide.tsx` imports nothing, and `HOW` is static text.
- `guideShown={!guideHidden && !comparingNow}` and `guideDisabledReason` are only set while comparing.
- The accessible name "Guide" is unique; the frozen tests locate it by role/name and pass.
- The new regression spec checks the complete-state geometry (1280, 768) and controls bottom ≤ 120 / 0 roads in the open, closed and pending states (1280, 1024). Both are real geometry checks, not tautologies.
- Cleanup: Vite on :5299 is stopped, the browser is closed, no probe files were copied into the repo, and port 4243 was not touched. `git status` is clean apart from this file (`.playwright-mcp/` is gitignored).
