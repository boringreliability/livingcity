# timeline-005 Gold review, round 2

**Verdict: APPROVED**

Reviewed commit ed82a71. The implementation diff is `45a18a4..HEAD` and the round-1 fix diff is `HEAD~1..HEAD`.

Round 1's only MAJOR (M1, "press Space" after a button click) is resolved in the app, not only in the doc. I followed `docs/demo.md` literally in a real browser and every step behaved as written. All suites are green, including the new regression spec. The frozen tests are unchanged. I found no regression from the new global pointer-click blur. The remaining findings are all MINOR.

## Round-1 findings: status
| # | Status | Evidence |
|---|---|---|
| M1 Space after a button click | **Resolved** | `App.tsx:628-637`: a window `click` listener blurs the clicked `<button>` when `e.detail > 0`. In the browser, after clicking "Close the main bridge", "Close link" and "Compare side by side", `activeElement` was `BODY` each time, and Space paused, ran B and ran lockstep respectively (details in the log below). The regression spec `gold_timeline005.spec.ts` passes (2/2). |
| m1 sub-pixel bridge directions | Resolved | Demo step 4.1 now says to zoom in first. At 2.37 px/m the centres of 286 and 287 are 10.7 px apart, and both were clickable. |
| m2 tick order | Resolved | `traffic-model.md:8-16` matches `world.rs:1178-1190` (`enqueue_periodic` → `run_retries` → `process_reroute_queues`). The priority queue is drained before the periodic one (`world.rs:1033-1038`), which matches "closure-triggered first". |
| m3 unserved in comparison | Resolved | `traffic-model.md:107` now separates the strip (`world.rs:543`: no_route + stranded + removed) from the panel (`ComparisonPanel.tsx:34`: w[4] + w[5]). |
| m4 inspectLink | Resolved | `architecture.md:28` matches `protocol.ts:55-57`. |
| m5 branch sample | Resolved | Now "(one sample) … bounded by when the next frame arrives". The "nothing had been evicted yet" wording matches `window.startTick: 0`. My re-run measured 18 ms against 38.3 ms committed, which is consistent with a frame-bound single sample. |
| m6 demo step 2 timing | Resolved | The doc now says "5–15 sim minutes, 15–45 s" and "fluctuates". I observed queued going 60 → 87 → 83 → 151 → 157 → 140 → 164 over about 10 sim min, with visible orange queues on the Old and North Bridge approaches. |
| m7 Must DO | Still open | This is expected at `wdd complete` (see m6 below). |

## Findings

### MINOR

**m1. Demo step 4: "let B run past the time where you paused A" can take more than a minute at 20×** (`docs/demo.md:41`)
- **What I saw:** I branched at tick 1880 and A's head was at 4630. B needed about 2,750 ticks, which takes about 69 s of wall time at 20×.
- **Why it matters:** the doc gives no duration, so a newcomer may think it is stuck. The 5-minute promise still roughly holds.
- **Fix:** add "(press **+** for 60× to get there faster)".

**m2. In compare mode, the main-bridge button shows A's state while the header says "Viewing B"** (`web/src/App.tsx:177`)
- **The cause:** `mainClosedConfirmed` reads `frame`, which is A's side when comparing.
- **What I saw:** with B viewed (B's main bridge open), the disabled button read "Main bridge closed — reopen" with `pressed`.
- **Scope:** this predates this ward and the button is disabled, so it has no effect on behaviour.
- **Fix:** while comparing, derive the label from the viewed side's frame, or show a neutral label.

**m3. The `unserved` tooltip and code comment do not match the value they describe** (`web/src/ui/MetricsStrip.tsx:13-15`)
- **The value** (`world.rs:543`) is `no_route + stranded + removed`, where removed includes the trips removed as unreachable.
- **The comment** says "(= unreachable + gridlock removals)", which is stale.
- **The tooltip** omits unreachable removals.
- **Scope:** `traffic-model.md` is correct. Only the UI text is off.
- **Fix:** change the tooltip to "…no route at the origin, stranded without a route, or removed (unreachable after retries, or 10 minutes in gridlock)", and correct the comment.

**m4. Esc does not dismiss the "Replace the branch?" confirmation** (`web/src/ui/ScenarioPanel.tsx:43-58`, `App.tsx:606`)
- **What I saw:** focus is on the autofocused "Replace the branch" button. Esc only clears the road selection, and the panel stays open.
- **Scope:** this predates the blur change, and it is not a regression from it.
- **Fix:** handle Escape in `ConfirmReplace` as Cancel.

**m5. The focus fix covers buttons only, not the Speed `<select>`** (`App.tsx:79-81`, `:628-637`)
- **What happens:** after the user picks a speed with the pointer, focus stays on the select. Space and B are then ignored by the shortcut handler; Space opens the select instead.
- **Scope:** the demo never presses Space right after the select, because step 2 clicks a button first.
- **Fix (optional):** blur the select on `change` when the change came from the pointer.

**m6. The Must DO items are still open** (ward-005 § Must DO)
- `CONTEXT.md` and the epic table are not yet updated.
- The epic-gate summary is not yet prepared.
- This is a reminder for `wdd complete`, not a blocker.

### Checked and OK
- **Frozen hashes match:**
  - `acceptance.spec.ts` b347681b…;
  - `integration.test.ts` b2d0fdef…;
  - `perf_timeline.spec.ts` db947a2f….
- **No approved test file changed.** The only test file in `45a18a4..HEAD` is the new `web/e2e/gold_timeline005.spec.ts`.
- **The blur change has no regressions** (tested in the browser):
  - **Keyboard activation keeps focus.** I focused Play/Pause and pressed Enter: it toggled and focus stayed on the button. A following Space activated the button natively, as expected. Tab moved on to Speed, then Diagnostics.
  - **Timeline slider.** A pointer click focuses the slider (`role=slider`, not blurred) and seeks exactly (target 2000 → 2000). ← then gave 1880. A pointer drag from 90 % to 40 % ended at 3450, where 3450.4 was expected. → and End work after the drag. Space and B work while the slider has focus, because it is a div.
  - **Confirm-replace.** After a pointer click on the intervention, the autofocus on "Replace the branch" survives: React commits before the window listener runs, and the listener blurs only the clicked, now unfocused, button. A pointer click on Cancel returns focus to the slider, and Space then plays.
  - **Discard branch.** The programmatic `focus()` on the slider survives the listener. D and Space work afterwards.
  - **Diagnostics.** Clicking the ≡ button toggles the panel, and a following Space plays.
  - **Road panel.** After a click on "Close link", focus is on `BODY` and Space runs B.
- **Integration wiring:**
  - the fix adds no exports and no messages;
  - `integration.test.ts` passes (orphan, protocol and doc-number checks);
  - the 14 privatised symbols are unchanged since round 1.
- **The performance § Timeline matches `timeline.json`.** Every cited number appears there: 86.9 / 91.7 / 92.9, 38.3, 44.3 / 37.0 / 81.3, 0.046 / 0.084 / 1.84, 50 / 83.3, 1644, 2.6 h, 24, 4–118, and the tick ranges. The wording is honest: "one sample", `frameBound`, "below timer resolution", and only means are cited.
- **README keys and URL parameters behave as described:**
  - Space, B, D and + were verified in the smoke test;
  - B in A's past created a branch;
  - ←/→/End on the focused timeline work.
  - The URL parameters were verified in round 1, and that code is unchanged.

## What I ran
| Command | Result |
|---|---|
| `shasum -a 256` on the 3 frozen files | all match |
| `pnpm -C web build:wasm` | ok |
| `pnpm -C web typecheck` | clean |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web test` | **21 files, 109 passed** |
| `cargo test --workspace --release` | all suites `ok`, 0 failed (core_003 36, timeline_002 19, timeline_001 18, …) |
| `pnpm -C web e2e` | **75 passed, 1 skipped** (the existing review1 G4 skip), 12.7 min. `brief_acceptance_flow` ✓ 1.0 m; `acceptance_flow_keyboard_only` ✓ 8.4 s; both `gold_timeline005` tests ✓ |
| `PERF=1 playwright test e2e/perf_timeline.spec.ts` | ✓ (3.1 m); see the comparison below |

**Re-run against the committed values:**

| Measurement | Committed | Re-run |
|---|---|---|
| seek median / p95 / max | 86.9 / 91.7 / 92.9 | 87 / 93 / 93.7 |
| branch | 38.3 | 18 (flagged as one frame-bound sample) |
| A / B MiB | 44.3 / 37.0 | 44.3 / 37.0 |
| tick mean, single / lockstep | 0.046 / 0.084 | 0.047 / 0.085 |
| ratio | 1.84 | 1.83 |
| render interval median | 50 / 83.3 | 50 / 83.3 |
| on network median | 1644 | 1644 |
| retained | 2.59 h | 2.59 h |

Afterwards I restored the committed `timeline.json` with `git checkout`. My copy is in `scratchpad/gold-tl005-r2/timeline-gold2.json`.

## Smoke-test log
I followed `docs/demo.md` literally in Playwright against Vite on port 5299, at a 1400 × 900 viewport, using real clicks, wheel and keys. The hook was used only to locate links and read state.

1. **Open.** River City is running at 20×. The metrics strip has sim time, active, completed, mean trip, queued ⓘ and unserved ⓘ. The legend, the timeline ("x / 48 MiB … (per scenario)") and the "20.0× of 20×" indicator are all present. ✓
2. **Click "Close the main bridge".**
   - `closed [284,285]`, the hatch and barriers appear, and focus is on `BODY`.
   - Queued went 60 → 164 over about 10 sim min, with visible orange queues at the Old and North Bridge approaches. ✓
   - Clicking the Old Bridge opened the *Selected road* panel ("Link 288": lanes, vehicles 53, queued 53, state, capacity). ✓
3. **Press Space.**
   - The sim paused (`running:false`), and the bridge stayed closed. ✓
   - A click on the track at tick 2000 → position 2000, `closed []`. ✓
   - ← on the focused track → 1880. ✓
   - On a fresh page I also tried the strict path (click "Close the main bridge" and then Space at once): it paused, and the bridge stayed closed. "−1 min" ×3 then went back 360 ticks to before the closure. ✓
4. **Branch.**
   - I zoomed in with the wheel over the North Bridge until the two directions were separate lanes. At 2.37 px/m the lanes are drawn clearly apart. ✓
   - Clicked 286 → "Close link" → B was created at 1880 ("Viewing B: branch", "B: branch from 00:15:40"). A's head stayed at 4630. ✓
   - Clicked 287 → "Close link" → **Space** → B runs, `closed [286,287]`. ✓
   - Pressed + (60×) and let B pass A's head; it was at 4737 after about 20 s (m1). ✓
   - A/B switching keeps each position: A at 1880, B at 4740. ✓
   - Pressing B in A's past (after a "−1 min" click) created a branch. ✓
5. **Click "Compare side by side".**
   - Both sides are at 4740: A has `closed [284,285]`, B has `[286,287]`. The cameras are identical. The labels "A: original" and "B: branch" are correct. ✓
   - The panel shows Generated 8605 = 8605, Completed, Incomplete, Unserved, mean and p95, with Δ and ▲/▼. ✓
   - **Space** → lockstep 5339 = 5339, and compare stays on. Space again pauses at 5340 = 5340. ✓
   - The interventions and the A/B buttons are disabled. ✓
   - Compare again exits. ✓
   - **Discard branch** → back to A, and the Scenarios panel is gone. ✓
6. **Also try.** D opened diagnostics, with the sim tick and the render interval shown separately. ✓

The dev server is stopped and the browser is closed. `git status` is clean apart from this file.
