---
ward: 1
revision: null
name: "Keyboard, focus and honest labels"
epic: "polish"
status: "approved"
dependencies: ["timeline-005"]
layer: "typescript"
estimated_tests: 9
created: "2026-10-09"
completed: null
---
# Ward polish-001: Keyboard, focus and honest labels

## Scope
Contract **P1** of epic `polish`. The brief asks for "keyboard access, readable labels". This ward makes the whole app usable from the keyboard, with focus that is visible and never lost, and Esc that closes the innermost transient UI first. Every label and tooltip says what its value is.

Backlog ids resolved here (see `.wdd/memory/polish-backlog.md`): a1, a2, a3 (comment and docs only, see Specification), b4, b5, d3. An automated accessibility audit (axe-core) guards against regressions.

## Inputs
- **`web/src/App.tsx`:** the global key handler (`isInteractive`, Esc order), the pointer-click blur (timeline-005), `mainClosedConfirmed`, and `comparingNow`.
- **`web/src/ui/ScenarioPanel.tsx`:** `ScenarioPanel` and `ConfirmReplace` (autofocus on "Replace the branch").
- **`web/src/ui/ControlPanel.tsx`:** the Speed `<select>` and the main-bridge button (`aria-pressed`, `bridgeDisabledReason`).
- **`web/src/ui/MetricsStrip.tsx`:** `UNSERVED_TOOLTIP`.
- **`docs/architecture.md`:** § Deviations, the "Memory" item.
- **Test hook:** `window.__livingcity` (`snapshot()`, with `scenario`, `compare`, `sides`, `branchTick`, `selectedLink`, `trackedTrip`).
- **The baseline axe-core 4.10 run (2026-10-09):**
  - no serious or critical violations in single, diagnostics, branch or compare;
  - one moderate violation, `page-has-heading-one` in compare;
  - there is no `<h1>` anywhere.
- `@axe-core/playwright` is added as a dev dependency.

## Outputs
- **Keyboard.**
  - A pointer pick in the Speed select gives focus back after the change, like buttons do. Keyboard changes (Tab to the select, then arrows) keep focus.
  - Esc closes the innermost transient UI first: the confirm-replace panel (as Cancel), then the tracked vehicle, then the road selection.
  - When a panel that holds focus closes, focus moves to a sensible, visible element and never stays on a detached node.
- **Visible focus.** Every focusable control shows a focus ring of at least 2 px when it is focused from the keyboard. The ring uses outline or box-shadow, not colour alone.
- **Honest labels.**
  - While comparing, the scenario panel's heading reads **"Comparing A and B"**. Outside compare it stays "Viewing A: original" / "Viewing B: branch".
  - The main-bridge button reflects the scenario it would act on, which is the viewed one.
  - While comparing it is disabled. It shows the neutral text "Close the main bridge" with no `aria-pressed`, and its title gives the reason.
- **Heading.** The page has exactly one `<h1>` in every state. It is visually hidden: "Living City: traffic simulation".
- **Unserved.**
  - The `UNSERVED_TOOLTIP` code comment states the real formula: no_route + stranded + all removals (unreachable + gridlock).
  - The tooltip text itself is pinned (see Specification); `docs/traffic-model.md` carries the full definition.
- **Docs.** The "Memory" deviation in `docs/architecture.md` matches the host: the old B is freed before the new one is built, so the peak is A plus one B.

## Specification
- **Pinned by frozen tests (do not change):**
  - `web/tests/metrics_strip.test.ts` (city-005 test 17) pins the exact `unserved` tooltip text, and that the strip never contains the word "unreachable". a3 is therefore resolved by the comment and the docs only. The tooltip's "no route at the origin" covers the trips removed for having no route.
  - `compare.spec.ts` pins `viewed` across compare. Only the heading text changes.
- **Esc semantics (innermost first):**
  1. confirm-replace open → Cancel: nothing changes, and A and B are untouched;
  2. else a vehicle tracked or gone-notice shown → clear it;
  3. else a road selected → clear it.

  Esc must still work while focus is on a button or the slider. It must not act while focus is in the Speed select's open list, which the browser owns.
- **"Pointer pick" for the select:** a `change` event that follows a pointerdown or mousedown on the select within the same interaction. A keyboard change (no preceding pointerdown) keeps focus.
- **The axe audit:**
  - Use `@axe-core/playwright` with its default rule set.
  - Run it in these states: single view; a road selected; a vehicle tracked (zoomed in); the diagnostics panel open; branch B viewed; the confirm-replace panel open; compare.
  - **No violation with impact serious or critical** in any state.
  - `page-has-heading-one` must pass in all of them.
  - The canvases are part of the audit; they already carry `aria-label`s.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `tab_reaches_every_control_with_visible_focus` (e2e) | In single view, with a road selected, and in compare, Tab from the body visits every visible, enabled control: buttons, the select, the slider, Diagnostics and the panel buttons. Each one, when focused, has a computed focus indicator: `outline-style ≠ none` and `outline-width ≥ 2px`, or a non-empty `box-shadow`. Shift+Tab walks back in the reverse order. |
| 2 | `esc_closes_innermost_first` (e2e) | Branch B exists, A is in the past, and a road is selected. An intervention opens confirm-replace. The first Esc closes it with nothing changed: same `branchTick`, B's closed set the same, A not edited. The selection is still there. The second Esc clears the selection. With a tracked vehicle and a selected road, the first Esc clears the vehicle and the second clears the road. |
| 3 | `speed_select_pointer_pick_keeps_shortcuts` (e2e) | After a pointer pick of 60× (a click on the select, then the choice), focus is no longer on the select, and Space pauses with the speed still 60×. After a keyboard change (Tab to the select, then typing `2`, which selects 20×; arrow keys only open the popup on macOS), focus stays on the select and the speed is 20×. |
| 4 | `focus_never_left_on_removed_elements` (e2e) | After each of these, `document.activeElement` is a connected, visible control, never the body (focus is not dropped): Esc on confirm-replace, Replace, Esc clearing a selection while the road panel's "Close link" had focus, leaving compare, and Discard branch. |
| 5 | `compare_heading_and_bridge_button_are_honest` (e2e) | A has the main bridge closed; B branched before the closure, so B's bridge is open. Viewing B (single), the bridge button is not pressed and reads "Close the main bridge". Viewing A, it is pressed and reads as closed. While comparing, the heading reads "Comparing A and B", the button is disabled with no `aria-pressed`, reads "Close the main bridge", and has a non-empty title. After leaving compare, the heading and button match the viewed scenario again. |
| 6 | `page_has_one_h1` (e2e) | Exactly one `h1`, with non-empty text and visually hidden (rendered area ≤ 1 px²), in single view, in branch and in compare. |
| 7 | `axe_no_serious_or_critical` (e2e) | Each of the 7 states listed in the Specification has no axe violation with impact `serious` or `critical`, and `page-has-heading-one` is not among the violations. The failure message lists the rule ids and targets. |
| 8 | `unserved_definition_is_documented` (vitest, static) | The comment above `UNSERVED_TOOLTIP` names no_route, stranded and both removal kinds (unreachable and gridlock). `docs/traffic-model.md` defines unserved with the same terms. |
| 9 | `memory_deviation_matches_the_host` (vitest, static) | `docs/architecture.md` § Deviations "Memory" does not claim "two Bs". It states that the old B is freed before the new one is built. `web/src/sim/host.ts` indeed calls the old B's `free()` before building the new B (static order check in the replace path). |

## Must NOT
- Edit frozen tests.
- Change the `unserved` tooltip text or `viewed` semantics across compare (both pinned).
- Rely on hue for focus or state.
- Steal focus from keyboard users: keyboard activation keeps focus.

## Must DO
- Add regression coverage only in new files.
- Update `docs/demo.md` and README if a key changes; keys are not expected to change.
- Update CONTEXT after the ward.

## Manual Smoke Test
### Setup
`pnpm -C web build:wasm && pnpm -C web dev` (port not 4243), desktop browser at 1280×800.
### Steps
1. Without a mouse, Tab through the whole UI. Every control shows a clear ring. Close the main bridge with Enter, pause with Space, rewind with ← on the slider, press B to branch, Tab to Compare and press Enter, then Esc and Tab out.
2. With the mouse, pick 60× in Speed, then press Space. The sim pauses (it does not open the select).
3. Open confirm-replace (an intervention in A's past while B exists) and press Esc. The panel closes and nothing changes.
4. While comparing, check that the heading says "Comparing A and B" and that the bridge button reads neutral and is disabled.
### Pass criteria
- [ ] Keyboard-only flow completes, and focus is always visible.
- [ ] Space and B work after pointer use of any control.
- [ ] Labels match the state shown.
- [ ] The axe audit is clean (serious and critical).
