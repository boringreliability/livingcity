---
epic: "polish"
name: "Finish, accessibility and performance"
status: "active"
created: "2026-10-06"
---
# Epic: Finish, accessibility and performance

## Goal
This epic covers the brief's last two implementation steps:
- **step 7**, *"Polish the city, accessibility, and first-run demonstration"*;
- **step 8**, *"Profile and optimize measured bottlenecks"*.

It also covers the verification line *"check keyboard access, readable labels, and control responsiveness under load"*.

It closes the open MINOR backlog from epics core, city and timeline. That backlog was collected from every review log on 2026-10-09; the items keep their ids (a1–f7). It also adds the missing first-run guidance. No new simulation features. The traffic model, determinism and the timeline contracts (core, city, T1–T5) stay binding and unchanged.

## Wards
| Ward | Name | Status |
|------|------|--------|
| polish-001 | Keyboard, focus and honest labels | complete |
| polish-002 | Layout that fits: resize refit, split-view panels and narrow widths | complete |
| polish-003 | Calm motion and clear markers in the renderer | complete |
| polish-004 | First-run demonstration | complete |
| polish-005 | Profile and optimize the measured per-frame bottlenecks | complete |
| polish-006 | Finished product, verified (integration ward) | complete |

## Measured basis (2026-10-09)
Measured natively in release on River City (seed 2026/7) with a temporary probe that is not committed. Setup: 1 sim h of warm-up, then 2,000 ticks, with each part timed separately per tick. The machine is an Apple M4 Pro.

| `?demand=` scale | on network | `step` mean / p95 | `World::metrics()` mean / p95 | vehicle records | link stats |
|---|---|---|---|---|---|
| 1 | ≈ 1,761 | 0.021 / 0.034 ms | 0.009 / 0.012 ms | 0.005 ms | 0.004 ms |
| 3 | ≈ 6,125 | 0.140 / 0.173 ms | 0.155 / 0.178 ms | 0.013 ms | 0.013 ms |
| 5 | ≈ 6,973 | 0.302 / 0.395 ms | **0.348 / 0.438 ms** | 0.017 ms | 0.015 ms |

What the numbers show:
- Under stress, `World::metrics()`, which the host calls once per posted frame, costs **more than a whole tick**. It makes a full pass over the lanes and a full pass over all slots, and allocates a `Vec` for the ages.
- `step` grows superlinearly: ×15 cost from scale 1 to 5 for ×4 the vehicles on the network. Profile this before changing anything; a candidate is the per-tick scans over the 20k+ origin-buffered trips.
- Earlier wards measured three more costs:
  - the host encodes and posts frames every 16 ms even while paused (core-005 Gold);
  - the frame pool practically never reuses a buffer, and in compare B allocates a buffer every frame (timeline-004 Gold);
  - `Timeline::branch` clones every retained snapshot and then evicts: 6.1 ms at 48 MiB, 10–13 ms with a smaller B budget (timeline-002 Gold).

## Contract additions (binding; core, city and timeline contracts stay in force)

### P1. Keyboard and labels (polish-001)
**Keyboard access**
- Every interactive control is reachable with Tab, in a visible and logical order, with a visible focus ring (not hue alone).
- Esc closes the innermost transient UI first, in this order: confirm-replace, then the vehicle, then the road selection.
- A pointer pick in the Speed select returns focus as buttons do, so Space and B remain shortcuts (backlog a1, a2).

**Honest labels**
- Labels and tooltips say what the value is:
  - `unserved` (a3);
  - "Comparing A and B" while comparing (b5);
  - the main-bridge button reflects the scenario it would act on, or reads neutral while comparing (b4).
- Docs match the code (d3).

**Audit**
- An automated accessibility audit (axe-core through Playwright) reports **no serious or critical violations** on these states:
  - the single view;
  - a selection;
  - compare;
  - the confirm-replace panel;
  - the diagnostics panel.
- Canvas content is exempt. Its information is mirrored in the panels.

### P2. Layout (polish-002)
**Resize refit**
- When the canvas size changes, the view keeps showing the city: it refits if the user had not moved the camera since the last fit, and otherwise keeps the camera's centre (b1).
- This applies in the single view and in compare.

**Panels in compare**
- No panel covers a road of either half while comparing. Fix this by placing the panels, not by changing `COMPARE_FIT_INSETS`, which frozen test `compare.spec.ts` 11 pins (b2).
- District labels are not cut at a half's edge: a clipped label is hidden or shifted, never half-drawn (b3).

**Narrow widths**
- At 1024, 900 and 768 px wide, the panels do not overlap one another and nothing scrolls horizontally (a5, b7).
- Below 768 px is out of scope, and this is documented.

### P3. Motion and markers (polish-003)
**Junction continuity**
- A vehicle drawn across a junction moves continuously: no jump of more than 2 px at the reference zoom of 2.24 px/m (c1).
- This holds for the tracked car, its ring and Follow mode.

**Extrapolation**
- A speed change does not move cars backwards (c2).
- A worker stall cannot extrapolate further than 1.5× the expected advance between frames (c3).

**Markers**
- Hover and congestion are distinguishable in lightness and shape, not by halo width alone (c4).
- A closed road keeps a visible closure marker at every zoom down to `MIN_ZOOM` (c5).
- The bridge railing is visible over land and water (c6, recheck).

### P4. First-run demonstration (polish-004)
**The guide**
- On a first visit, a compact, dismissible guide walks through the demo:
  1. close the main bridge;
  2. watch the queues;
  3. pause and rewind;
  4. try another decision (branch);
  5. compare side by side.
- Each step is checked off **by observing what the user actually did**, using the sim's own state. A step is never ticked by a timer.
- The guide never drives the simulation and never scripts an outcome.
- The guide is reachable by keyboard and can be closed with Esc.
- Dismissing it is remembered per viewer (`localStorage`, wrapped in try/catch). A "Guide" control reopens it.
- It does not cover the city during the steps: it sits in the existing panel bands.

**Demo pacing**
- When a step needs B to run past A, the guide suggests 60× (d1).

**Warm-up**
- The warm-up "Starting the city…" state is shown and tested (d2).
- `docs/demo.md` matches the guide.

### P5. Performance (polish-005)
Profile first, then optimize what the measurements show. Every before/after is measured with the same probe or harness, never estimated.

**Required outcomes**
- **`metrics()`:** at scale 5 its per-frame cost drops to ≤ 25 % of the measured 0.348 ms mean. This comes from incremental counters or one combined pass. The values stay bit-identical to the old `metrics()`; a test runs both side by side through a run with closures, gridlock and seeks.
- **Paused frames:** while paused (and not seeking or inspecting), the host does not encode or post frames continuously. After a settling frame it posts only when something changed (e2). The UI stays responsive, and hover and pan still render, because rendering does not need new frames. **Deviation (polish-005):** the frozen host tests `review2` G4 and `review3` G4b pin paused frames at the iteration rate, so this is not done; recorded for the epic gate.
- **Frame buffers:** they are reused in the steady state, single view and compare, with no per-frame allocation once warm (e3). **Deviation (polish-005):** the frozen host tests F2 (exact `count × 16` bytes) and G8 (a non-fitting returned buffer is dropped) pin the pool rule, so only per-side pools are done; recorded for the epic gate.
- **Branch:** it clones only the snapshots it keeps (e4). Branch cost at 48 MiB is re-measured.
- **The `step` superlinearity:** it is profiled and its cause is documented. It is fixed if the fix is local and preserves determinism; the `state_hash` of a fixed seed and command log must be unchanged across the change.
- **Robustness:** after a wasm trap, the UI offers "Restart simulation", which creates a new worker (f2). Re-init resets the whole clock (f1).

**Determinism guard**
No optimization may change sim results. Every existing Rust determinism, snapshot and branch test stays green, plus a golden `state_hash` test at scale 1 and scale 5 recorded before the changes.

### P6. Integration (polish-006)
**The product, verified**
- The brief's full browser workflow passes, together with:
  - the keyboard-only path;
  - the first-run guide path;
  - control responsiveness under load: Pause, seek and compare at `?demand=5` each respond within 300 ms.

**Docs and data**
- The perf harness is re-run and `docs/performance.md` is updated from the JSON.
- The docs (README, architecture, demo, traffic model) are updated.
- **Backlog accounting:** every backlog id a1–f7 is either resolved or listed as a known limitation with its reason.

**Remaining small items**
- a close-while-paused e2e test (f4);
- `viewed = 0` while a B replace is being built (f6);
- a `cargo fmt` gate limited to non-frozen files (f3).

## Integration Points
- **Inputs:**
  - the whole app as of epic timeline: `App.tsx`, `ui/*`, `render/renderer.ts`, `render/layout.ts`, `sim/host.ts`, `sim/clock.ts`;
  - sim-core `World::metrics`, `Timeline::branch`, the perf harness, and `web/tests/integration.test.ts` (wiring checks must stay green).
- **Frozen tests that constrain this epic:**
  - `compare.spec.ts` test 11 pins the compare insets;
  - city-005's Red contract pins the diagnostics value format;
  - all approved test files stay untouched, and regressions go in new files.

## Completion Criteria
- **Tests:** all earlier tests are green and unchanged, plus this epic's tests.
- **Accessibility:** the keyboard-only full flow passes, the axe audit is clean (no serious or critical violations), and the labels are honest.
- **Layout:** no overlaps at 1280, 1024, 900 and 768 px; refit on resize works.
- **First run:** a newcomer can complete the demo from the in-app guide alone.
- **Performance:** the measured bottlenecks are improved with before/after numbers, sim results are unchanged (golden hashes), and `docs/performance.md` is updated.
- **Backlog:** each item a1–f7 is resolved or documented as a known limitation.
