# polish-002 Gold review, round 1

**Verdict: REJECTED** (2 MAJOR, 5 MINOR)

Reviewer: a fresh Gold-gate subagent. I reviewed only the artifacts: the ward spec, the frozen test, `git diff 584c830..HEAD`, and the running app.

## What I ran
- **Frozen test:** `shasum -a 256 web/e2e/layout.spec.ts` gives `d62394ae26aab425bfc88e2f09d417d140bbfa6619f339c8e2b9da7ec6e0cad8`, so it is unchanged. `git diff --name-only 584c830..HEAD` touches no test file in `web/e2e`, `web/tests` or `crates/*/tests`. The diff covers:
  - `App.tsx`, `ScenarioPanel.tsx`, `styles.css`, `README.md`;
  - the ward's status line.
- **Typecheck:** `pnpm -C web typecheck` is clean.
- **Unit tests:** `pnpm -C web test` gives 22 files, **111 passed**.
- **e2e:** `pnpm -C web e2e` gives **88 passed, 1 skipped** in 14.5 min. All 6 `layout.spec.ts` tests pass.
- **Manual smoke test and probes:**
  - Dev server `vite --port 5299`, stopped afterwards.
  - Playwright MCP (Chromium), with in-page probes that reuse the spec's overlap, road-cover and label-cut criteria.
  - The probe screenshots are in the session scratchpad (`gold-p002/*.png`).

## Smoke-test log (the ward's Manual Smoke Test)
1. **1280×800: branch, select a road, compare.**
   - No panel overlaps, there is no horizontal scroll, and no label is cut.
   - The road-cover probe sampled 3,340 points per half and found 0 covered in each case: no selection, a road selected on A, and a road selected on B.
   - The road panel sits bottom-left (y 536–726), just below A's city (bottom at about 530).
   - The compare frame is a neutral solid border, and B's dashed and striped pattern is gone. **PASS**
2. **Resize while comparing, untouched: 1280×720, 1024×768, 900×800, 768×800.**
   - At each size the camera refits to the compare fit and no panels overlap.
   - The same holds in single view and branch view at all five sizes.
   - Road coverage at 1280×720, 900 and 768: see MINOR 1. **PASS** (within the P2 scope)
3. **Zoom and pan, then resize.**
   - After a wheel zoom to 1.39 and Follow on a vehicle, I resized 1280 → 1024 → 900 → 768. The camera stayed at `zoom` 1.3873507 with an unchanged `cx`/`cy` (paused), and Follow stayed on. It did not refit.
   - After a pan in compare, a DPR change (CDP, 2 → 1) kept the camera exactly. **PASS**
4. **Compare at 1024: labels at the halves' edges.**
   - Labels such as Eastgate and Eastgate Fields are hidden, never cut. The probe found 0 visible cut labels and 0 hidden labels that would fit.
   - After zooming into A near the divider, it again found 0 of either. **PASS**

**Pass criteria**
- No overlaps or horizontal scroll at the supported widths: **FAIL**, in the states outside the test matrix (MAJOR 1 and 2).
- Refit only when untouched: **PASS**.
- In compare at 1280 and 1024, no covered roads and no cut labels: **PASS**.

### Extra probes
- **Diagnostics open with a branch at ≤ 959 px (the `:has()` rule).**
  - At 900 and 768 the stack is controls 16–116, Scenarios 132–244, Diagnostics 260–462, with no overlap. At 1280, 1280×720 and 1024 there is no overlap either. OK.
- **Vehicle panel (tracked, Follow).**
  - No overlap at any of 1280, 1024, 900 and 768. Branching drops the tracked vehicle, so there is no vehicle panel in compare. OK.
- **Resize during compare entry.**
  - I resized to 1024 while the Compare click was in flight, then to 1000. The camera equals an exit and re-enter at that size (identical `cy`/`zoom`). OK.
- **Error panel.**
  - It appears only on a fatal WebGL2 or worker error, when no scenario panel exists, and it is a `p.panel`. Not reachable together with the other panels. Not applicable.
- **Confirm-replace panel:** see MAJOR 1.
- **Control-panel width variants:** see MAJOR 2.
- **Red r3 MINORs**
  1. The implementation uses the same 0.5 px tolerance as the test (`App.tsx:178`). Resolved.
  2. Follow counts as a touch (`App.tsx:214`) and was verified in the browser (smoke step 3). No regression test was added. It is effectively covered anyway: picking a vehicle requires zoom ≥ 1.0, and the fitted zoom is about 0.15, so the user always wheel-zooms before Follow.
  3. The vehicle and confirm panels: see MAJOR 1.

## Findings

### 1. MAJOR: the confirm-replace panel overlaps the scenario panel at 900 and 768, and the road panel at 768
`web/src/styles.css:596-604` (new `≤ 959px` placement of `.scenarios` at `top: 132px; left: 16px`) against `.confirm` at `styles.css:493-500` (`top: 140px; left: 50%; max-width: 360px`).

**Reproduction:** branch, select a road, view A, step back one minute, press B. The "Replace the branch?" panel opens, which is a normal flow (`timeline.spec` `replace_branch_needs_confirmation`). Probe results:

| Window | Overlaps |
|---|---|
| 900×800 | **Scenarios × Confirm replacing the branch**. Confirm spans x 257–643, y 140–250; Scenarios spans 16–342 × 132–244. |
| 768×800 | Scenarios × Confirm, **and** Selected road × Confirm (the road panel spans 512–752 × 16–278). |
| 1280, 1280×720, 1024 | No overlap. |

- In the screenshot at 900, the dialog sits on top of the scenario panel's "B: branch from …" and "Discard branch" buttons. These are exactly the controls the dialog is about.
- This ward created the collision: it moved the scenario panel into the band at y ≥ 132 below the control panel, where the confirm panel already lives.
- The scope says "Panels never sit on top of each other, at any supported width", the state is reachable at a supported width, and Red r3 explicitly asked Gold to check this panel.

**Fix (CSS only):** at `max-width: 959px`, give the confirm panel a slot that the left stack and the right column do not use. Either option works:
- Place it in the left stack below the scenario panel: `.app:has(.scenarios) .confirm { top: 260px; left: 16px; transform: none; max-width: 326px }`. Diagnostics then needs to move further down, or the two need to share the slot.
- Or make the left column a real flex stack (controls, scenarios, confirm, diagnostics in normal flow with a gap), so no hard-coded `top` values can collide.

Add regression coverage in a new spec file. The frozen spec stays untouched.

### 2. MAJOR: the scenario panel's hard-coded `left: 358px` assumes the control panel is at most 342 px wide, but it grows to 387 or 406 px
`web/src/styles.css:456-469` (`.scenarios { left: 358px; right: 272px }`). The control panel (`.controls`, `styles.css:48-54`) has only `min-width: 260px` and grows with its content:
- **The "⚠ Behind — the engine cannot keep up with this speed" status.** The brief requires this message (speed controls must show when the engine cannot keep up). I injected the exact text into `.behind` to measure it, because this machine never falls behind at 60×. The control panel becomes **16–387 × 16–132**, which gives **Simulation controls × Scenarios at 1280×800** (any window ≥ 960 with B present). At 900 the control panel's bottom (132) touches the scenario panel's top (132) with zero gap.
- **`?demand=6` (stress badge).** The control panel is 16–406 even without "Behind". The probe found **Simulation controls × Scenarios at 1280×800**, and the screenshot shows the "stress test" badge hidden under the scenario panel. This is a documented URL parameter, so the state is reachable.

The base case (342 px with "Main bridge closed — reopen (pending)") leaves exactly 16 px, so the layout only works for the control panel's widths at the time of writing. The baseline controls × scenarios overlap that P2 set out to remove therefore comes back as soon as the engine falls behind.

**Fix:**
- Bound the control panel: `width: 326px; box-sizing: border-box` (the value the `≤ 959` scenario rule already assumes), and let `.behind` and the stress badge wrap inside it.
- Then make sure the extra height cannot reach the y = 132 slots. Options:
  - reserve the `.behind` line;
  - use the flex left-column stack from MAJOR 1;
  - derive `top` from the control panel's actual height.

### 3. MINOR: compare at 1280×720 — the road panel covers A's bottom-left roads
`styles.css:621-628` (the `.app.comparing .side` bottom-left at `bottom: 74px`).
- At 1280×720, after selecting a road in compare, the probe reports `A:Selected road`: the panel spans y 456–646 and A's city ends at about 490 (Mill Lane / Millbrook).
- P2 pins road coverage only at 1280×800 and 1024×768, so this is not a contract failure. But 1280×720 is a listed supported size, and the road panel hides the very roads the user is inspecting.
- **Fix suggestion:** under `(min-width: 1000px) and (max-height: 760px)`, lay the comparing road panel out horizontally (two columns of `dl`), or shorten it.

### 4. MINOR: compare at 900 and 768 — the scenario panel covers A's top roads and labels
- At ≤ 959 the scenario panel (16–342 × 132–244) sits over the north edge of A's city. Westbrook Heights and the top row of roads are covered.
- This is outside P2's road-cover scope (1280 and 1024 only), but it is visibly "covering the city needlessly".
- **Fix suggestion:** in compare at ≤ 959, put the scenario panel in the right column above the road panel, or collapse it to one row next to the controls.

### 5. MINOR: `placeLabel` forces a layout per label on every camera-moving frame
`web/src/App.tsx:170-180`.
- Each call writes `left`/`top` and then reads two `getBoundingClientRect()`s. The writes and reads interleave, so each label forces a synchronous layout.
- **Measured** on this machine (Apple silicon, 44 labels in compare, 200 iterations):

  | Pattern | Cost per frame |
  |---|---|
  | interleaved (current) | 0.59 ms |
  | write all, then read all | 0.07 ms |

- It runs only on frames where the camera moves, but that includes every frame during Follow and drag. On weaker hardware that is several ms per frame, charged to the render budget.
- **Fix:**
  - First pass: set `left`/`top` for all labels and read the layer rect once.
  - Second pass: read the label rects and set `visibility`.
  - Alternatively, cache each label's size once (labels are static text) and compute the cut test arithmetically.

### 6. MINOR (pre-existing, but now at a documented supported width): the timeline bar at 768 px
- **768:** "Jump to start", "−1 min" and "+1 min" wrap to 2–3 lines, and the branch marker caption ("branch 00:14:00") overlaps the "SIM TIME 00:00:00" caption.
- **900:** the caption overlaps "▸ 00:21:35".
- The timeline CSS is not in this diff. But the README now declares 768 px supported, and the bar does not look finished there.
- Record it in the polish backlog for the integration ward, or compact the timeline buttons below 960 px.

### 7. MINOR (nit): `compare-view` is an unstyled class
`ScenarioPanel.tsx:17`.
- The neutral frame works because `viewing-b` is absent. `compare-view` has no CSS rule and no consumer.
- Either keep it as a documented hook or drop it.
- Related at 1024 in branch view: the three-row scenario panel (16–128) cuts the "Innovation Hub" label so that only "…tion" peeks out between it and the road panel. This is cosmetic.

## What is good
- The `cameraTouched` paths are correct and complete. It is set on drag, wheel and Follow. It is reset on the first fit, on compare enter and exit, and on resize-refit. A DPR change goes through the same `resize()`.
- Refit on resize matches a fresh fit in both single and compare view, and the race between resize and compare entry is handled.
- The label hide rule matches the test's tolerance exactly, so labels are hidden only when they would be cut.
- The neutral compare frame and the README statement are both done as specified.

## Required to pass
- Fix MAJOR 1: no overlap involving the confirm-replace panel at 900 and 768.
- Fix MAJOR 2: the control panel must not reach the scenario panel when the "Behind" status or the stress badge is shown, at ≥ 960 and ≤ 959.
- Add regression coverage for both in a new e2e file. The frozen `layout.spec.ts` must not change.
- The MINORs can be fixed or listed under Known issues.
