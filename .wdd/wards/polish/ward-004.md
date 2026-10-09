---
ward: 4
revision: null
name: "First-run demonstration"
epic: "polish"
status: "red"
dependencies: ["polish-003"]
layer: "typescript"
estimated_tests: 9
created: "2026-10-09"
completed: null
---
# Ward polish-004: First-run demonstration

## Scope
This ward implements contract **P4** of epic `polish` and resolves backlog items d1 and d2. The brief asks for a "first-run demonstration": a newcomer should be able to go through the demo without reading `docs/demo.md`.

A compact, dismissible **demo guide** inside the app shows the five steps. Each step is ticked off by **observing what the user actually did in the simulation**. The guide never drives the simulation and never scripts outcomes. The warm-up state ("Starting the city…") is tested.

## Inputs
- **`web/src/App.tsx`:** frame state (`frame.closed`, `frame.timeline` with position, head, branch and compare, `frame.clock`), `ready`, landmarks (`central_bridge`), the `.top-band` grid (polish-002) and the "Starting the city…" status panel.
- **`web/src/ui/ControlPanel.tsx`:** the place for a "Guide" control.
- **`web/src/styles.css`:** `.top-band` (centre column: scenarios, confirm, error).
- **`docs/demo.md`:** the five demo steps.
- **Existing tests:** a11y (polish-001), layout (polish-002) and every frozen e2e spec. Each one runs in a **fresh browser context**, so each one sees the guide.

## Outputs
**The guide (`web/src/ui/DemoGuide.tsx`, new; `section.panel` with `aria-label="Demo guide"`)**
- **Placement.** It sits in the `.top-band` centre column, above the scenario panel. In narrow windows it joins the single column after the controls.
- **Size.** It is compact: one line naming the current step, plus five numbered step markers. A done step shows ✓ and its number, so state is never shown by colour alone.
- **Visibility.** It is hidden while comparing and during the warm-up.

**The five steps (`GUIDE_STEPS`, exported)** are ticked off from sim state only:
1. **"Close the main bridge":** every link of the main bridge is closed in the viewed scenario.
2. **"Watch the queues":** the main bridge has been closed for at least 3 sim minutes while the sim was running. This uses sim ticks, never wall time.
3. **"Pause and rewind":** the viewed scenario A is paused at a position below its head, after step 1.
4. **"Try another decision":** a branch B exists.
5. **"Compare side by side":** compare was entered with a branch.

Rules for the steps:
- Steps tick in any order the user achieves them.
- A ticked step stays ticked for the session, also after rewinding or discarding.
- When all five are ticked, the guide shows "Demo complete" and offers to hide itself.

**Never drives the simulation.** The guide reads state only: it imports no client and calls no command, seek, branch or speed function.

**Speed hint (d1).** When B is viewed, its position is below A's head, and the speed is below 60×, the guide shows the hint "Tip: 60× gets B to A's time faster (+ or Speed)". It is text only.

**Dismissing and reopening**
- "Hide demo guide" (×) hides the guide and remembers that per viewer (`localStorage` key `livingcity.guide.hidden`, wrapped in try/catch).
- A "Guide" toggle button in the control panel (`aria-pressed`) shows or hides it.
- With storage blocked, the guide still works and is shown on each visit.

**Keyboard and accessibility**
- The guide's controls are in the tab order.
- Esc while focus is inside the guide hides it and moves focus to the "Guide" button.
- The guide adds no axe violation of impact serious or critical.

**Warm-up (d2).** "Starting the city…" is visible from page load until the first frame, then disappears.

**Docs.** `docs/demo.md` names the same five step titles as `GUIDE_STEPS`, and README mentions the guide.

## Specification
- **Names must not collide.** No guide control may share an accessible name with an existing control. Frozen tests locate controls by name, for example "Close the main bridge", "Compare side by side", "Discard branch" and the speed select. So the step titles are plain text, not buttons.
- **Placement must not break pinned layout:**
  - `COMPARE_FIT_INSETS` and `FIT_INSETS` stay unchanged;
  - the guide never overlaps another panel at the supported widths (`layout.spec`);
  - while it is visible in single view, the fitted city's roads are not under it at 1280×800 and 1024×768.
- **"Running" for step 2** means the sim time advanced by at least 360 ticks (3 min) between the frame where the closure was first seen and a later frame, with the bridge still closed throughout.
- **Determinism.** The guide cannot affect the sim, because it sends nothing.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `guide_shows_on_first_visit` (e2e) | In a fresh context, after ready, the region "Demo guide" is visible and lists 5 steps in `GUIDE_STEPS` order, none done (no ✓). It overlaps no other panel, and no sampled road point of the fitted city lies under it, at 1280×800 and 1024×768. It is not shown before the first frame. |
| 2 | `steps_tick_from_real_actions` (e2e) | Close the main bridge → step 1 done. Run until the closure is 3 sim minutes old → step 2 done. Pause and rewind with ← → step 3 done. Close the North Bridge in A's past (a branch) → step 4 done. Enter compare: the guide is hidden. Leave compare: step 5 done and "Demo complete" is shown. Done steps show ✓ (text), not colour alone. |
| 3 | `no_step_ticks_by_time_alone` (e2e) | With the guide open at 60× and no interaction for 15 s of wall time (≥ 7 sim min), no step is done. Closing and reopening a road elsewhere (not the main bridge) ticks no step. |
| 4 | `guide_never_drives_the_simulation` (vitest, static) | `DemoGuide.tsx` imports nothing from `sim/client` or `sim/host` and receives no callback that sends to the worker. Its props are state values plus `onHide`. `GUIDE_STEPS` has exactly the 5 titles above, in order. |
| 5 | `dismiss_is_remembered_and_reopenable` (e2e) | "Hide demo guide" hides it. After a reload it stays hidden. The "Guide" button (`aria-pressed=false`) shows it again (`aria-pressed=true`), and after a reload it is visible again. With `localStorage` throwing (init script), the guide is shown, can be hidden and shown, and no page error occurs. |
| 6 | `guide_keyboard_and_axe` (e2e) | Tab reaches "Hide demo guide". Esc with focus inside the guide hides it and focuses the "Guide" button. With the guide visible, axe reports no serious or critical violation. |
| 7 | `speed_hint_when_b_lags` (e2e) | After branching and viewing B (below A's head) at 20×, the guide shows a hint containing "60×". After switching to 60× the hint is gone. The hint is not a button. |
| 8 | `warmup_state_is_shown` (e2e) | With the wasm request delayed by 1.5 s (route interception), the status "Starting the city…" is visible before the first frame and is gone after ready. The guide is not visible during the warm-up. |
| 9 | `demo_doc_matches_the_guide` (vitest, static) | `docs/demo.md` contains each `GUIDE_STEPS` title in order (as headings or bold step leads). README mentions the in-app guide and how to reopen it ("Guide"). |

## Must NOT
- Script or drive the sim: no commands, seeks, branches or speed changes from the guide.
- Collide with existing control names.
- Edit frozen tests.
- Cover the city in single view at the supported sizes.

## Must DO
- Keep all frozen suites green. The guide appears in every fresh-context test.
- Update CONTEXT.

## Manual Smoke Test
### Setup
In a fresh browser profile (or with site data cleared), run `pnpm -C web dev`.
### Steps
1. Open the app. The guide shows 5 steps, and it is not in the way.
2. Follow only the guide (no docs) through the whole demo. Each step ticks when you actually do it.
3. Hide the guide and reload: it stays hidden. Show it again with "Guide".
4. Use the keyboard only: Tab into the guide and press Esc.
### Pass criteria
- [ ] A newcomer completes the demo from the guide alone.
- [ ] Steps tick only from real actions.
- [ ] Dismissing is remembered, and the guide can be reopened.
- [ ] No overlaps, and the city is not covered.
