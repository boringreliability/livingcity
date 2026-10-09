# polish-001 Gold review #1

**Verdict: APPROVED**

Reviewed at commit `e83230e`. Implementation diff `83dadaa..HEAD`. Reviewer: a fresh adversarial Gold-gate subagent.

## Frozen tests

| File | sha256 (expected = actual) |
|---|---|
| `web/e2e/a11y.spec.ts` | `95f13b3fa4b0f9cb1fd5e06898b9e2a397ba563657ad68ea9ee3c559978d8501` ✓ |
| `web/tests/a11y_docs.test.ts` | `d8cd30e271fa78ef21dfec4ae027bc165813c27d0bc295026679d91e775de728` ✓ |

`git diff --stat 83dadaa..HEAD` touches only `.wdd/wards/polish/ward-001.md` (status), `docs/architecture.md`, `web/src/App.tsx`, `web/src/ui/{ControlPanel,MetricsStrip,ScenarioPanel}.tsx`. No test file, frozen or earlier approved, changed.

## What I ran

- `pnpm -C web typecheck`: exit 0.
- `pnpm -C web test`: 22 files, **111/111 passed**.
- `pnpm -C web e2e`: **82 passed, 1 skipped (13.5 min)**. All 7 `a11y.spec.ts` tests pass. The skip is the pre-existing `review1.spec.ts:78` `test.skip`.
- `cargo test --workspace --release`: 15 result blocks, **173 passed, 0 failed**.
- Manual smoke test plus probes on Vite dev at port 5299 (Playwright MCP, 1280×800). The server was stopped afterwards. Port 4243 was not touched.

## Smoke-test step log

1. **Keyboard-only flow.**
   - **Tab tour from the body, single view:**
     - Order: Pause → Speed → Diagnostics → Close the main bridge → Legend → Jump to start → −1 min → +1 min → Live → Timeline → (document) → wraps.
     - Every control showed `outline: solid 2px`. Buttons and selects use `--accent` with offset 2. The slider uses the text colour, offset 1.
     - The screenshot shows a clear white ring on the slider and on Compare. It is not hue-only.
   - Enter on "Close the main bridge" → `closed=[284,285]`, pressed=true, focus kept on the button.
   - Shift+Tab×3 → Pause, then Space → paused (native activation).
   - Tab to Timeline, ←×4 → rewound (tick 2618→2138).
   - B on the slider → branch B at 2138, "Viewing B: branch". The button shows "Main bridge closed — reopen (pending)".
   - Tab → A: original → B: branch → Compare. Enter → compare:
     - heading "Comparing A and B";
     - bridge text "Close the main bridge", `aria-pressed` absent, disabled, class `bridge ` (no `closed`), title "Exit comparison to change roads";
     - exactly one h1.
   - Esc in compare does nothing harmful (focus stays on Compare).
   - **Tab tour in compare:** Discard → Play → Speed → Diagnostics → Jump/−1/+1/Live → Timeline → Compare → Discard → out. The disabled bridge, A and B buttons are skipped. Every ring is solid 2px.
   - Enter on Compare leaves compare: "Viewing B: branch", button matches B.
   - Viewing A: "Viewing A: original", button matches A at that tick.
   - **PASS.**
2. **Pointer pick in Speed.** Click on the select, choose 60×. Focus goes to BODY and speed is 60. Space → running toggles. **PASS.**
3. **Confirm-replace Esc.** A rewound into its past, a road selected (link 35), B pressed → confirm opens and focus is on "Replace the branch" (focus-visible).
   - Esc 1: the confirm closes, `branchTick` stays 2138, `closed` is unchanged, the selection 35 is kept, focus goes to Timeline (focus-visible).
   - Esc 2: the selection is cleared and focus stays on Timeline.
   - **PASS.**
4. **Compare labels:** see step 1. **PASS.**
5. **h1:** "Living City: traffic simulation", rect 1×1 px. **PASS.**

## Red r2 hand-checks

| Check | Result |
|---|---|
| Vehicle-panel tab tour | The panel holds one native `Follow` button, and the gone-notice holds `Close`. Both are native buttons and reachable. Focus on Follow, then Esc → the vehicle is cleared and focus goes to Timeline (visible ring). |
| Confirm-panel tab tour | Replace (autofocus) ⇄ Cancel with Tab and Shift+Tab, both ringed. Enter on Cancel → the panel closes and focus goes to Timeline. |
| Confirm open + vehicle tracked + road selected | Esc 1 closes only the confirm (vehicle 4264 and road 38 kept). Esc 2 clears the vehicle. Esc 3 clears the road. Correct innermost order. |
| Gone-notice Esc | Tracked trip #5147 arrived ("Arrived after 7:05"). Esc → the notice is removed. Focus was on BODY and stayed there (not moved). |
| Esc in the Speed list | `isInteractive` returns early for a SELECT target, so Esc on the focused or open select never reaches the global handler. Correct per spec. |
| Memory sentence meaning | It reads "frees the old B first and only then builds the new one … peak stays at A plus one B". This matches `host.ts:399-403`: `scenarios[1]?.free?.()` runs before `a.branch(fromTick)`. Correct. |
| Focus lands somewhere visible | Each focus move lands on the Timeline slider (visible, connected, focus-visible ring). |
| D after Esc | After 3 Escapes with focus on the slider, `d` opened Diagnostics. The slider is a DIV, so shortcuts are not swallowed. |

## Doc and comment check

- **The `MetricsStrip.tsx:13` comment matches the code.** The comment says `unserved = no_route + stranded + all removals`. The code is `world.rs:543`, `unserved: c.no_route + c.stranded + c.removed`.
- **The tooltip text is unchanged.**
- **`docs/traffic-model.md:107` agrees.**
- **No stale "two Bs" claim remains** in docs, README, `web/src` or CONTEXT.

## Findings

### BLOCKER
None.

### MAJOR
None.

### MINOR

1. **Esc on the confirm panel moves focus even when focus was not inside it** (`web/src/App.tsx:624-626`).
   - The confirm branch calls `focusTimeline()` unconditionally. The vehicle and road branches are guarded with `inPanel(...)`.
   - Probe: with confirm open, a canvas click moved focus to BODY. Esc then put focus on the slider with a visible ring. The spec says focus moves only "when a panel that holds focus closes".
   - Harmless today: the slider is a DIV, so Space, B and D still work.
   - Fix: `if (inPanel('section.confirm')) focusTimeline();` (and the same in `onCancel` only when focus was inside).
2. **A pointer open of Speed without a change leaves focus on the select** (`web/src/ui/ControlPanel.tsx:40-52`).
   - Clicking the select and dismissing it, or re-picking the current value, fires no `change`, so no blur happens. Focus stays on SELECT and the next Space opens the select instead of pausing.
   - Probe: running stayed `true` after Space.
   - This is outside the Outputs wording ("after the change") but grazes the pass criterion "Space and B work after pointer use of any control". `pointerPick` also stays `true` until the next keydown. That is harmless, since keydown resets it.
   - Fix (later ward): on a pointer-initiated interaction, also blur on a `click` with `detail > 0` once the popup has closed, or accept and note it in the backlog.
3. **Pre-existing, not a regression: the pending cue is lost across compare** (`web/src/App.tsx:518-521`, `forgetPosition`).
   - Branch with B's "then" close → "(pending)". Enter compare → leave compare. B's button reads "Close the main bridge", not pressed, `closed=[]`, until B runs a tick, after which it is closed.
   - The state shown is technically B's current state, but the queued closure is no longer signalled.
   - `bridgeStateHidden` is not the cause: the pending flag is cleared by the compare toggle.
   - Add it to the polish backlog.
4. **The panel styling contradicts the heading in compare** (`web/src/ui/ScenarioPanel.tsx:17`). The section keeps `viewing-b` (dashed B frame around the label) while the heading says "Comparing A and B". This is cosmetic. Consider a `comparing` class with a neutral frame.
5. **`.sr-only` is minimal** (`web/src/styles.css:583-589`). It lacks `white-space: nowrap; margin: -1px; border: 0; padding: 0`. It works for this h1 (rect 1×1; the axe and h1 tests pass). Hardening is optional and must keep the area ≤ 1 px² (frozen test 6).

## Checked and fine

- **The Esc ordering** is confirm → vehicle or gone-notice → road. Focus moves only when focus was inside `section.vehicle` / `section.selection`. Esc on a button works (`onButton` exception). Esc on the slider works. Esc on SELECT is ignored. There are no text inputs in the app.
- **The select pointer flag.** A keyboard change (typing `2`) keeps focus, because keydown clears the flag before `change`. A pointer pick always blurs. The flag cannot make a keyboard change blur, because each keydown resets it.
- **`bridgeStateHidden` while comparing:**
  - no `closed` class;
  - no "(pending)" suffix;
  - no `aria-pressed`;
  - the title is the reason.

  In single view after compare, it is not passed, so the state is shown again.
- **Exactly one h1** in single, branch and compare.
- **axe:** frozen test 7 passes in all 7 states.
