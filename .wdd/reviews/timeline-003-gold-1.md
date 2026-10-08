# timeline-003 Gold review, round 1

**Verdict: REJECTED** (0 BLOCKER, 3 MAJOR, 8 MINOR)

Reviewer: a fresh adversarial Gold subagent.
- Implementation: HEAD ecca7c8.
- Red snapshot: 6f4a043 (Red r3 APPROVED).

## Test freeze
- `git diff 6f4a043 HEAD -- web/tests web/e2e crates/*/tests` is empty.
- sha256 `web/tests/timeline.test.ts` = `520101a0…76cf10` and `web/e2e/timeline.spec.ts` = `dd4eb8d0…87993`. Both match Red r3.
- `git diff --stat 6f4a043 HEAD` touches only `crates/sim-wasm/src/lib.rs`, `web/src/{App.tsx,styles.css}`, `web/src/sim/{client,host,protocol}.ts` and `web/src/ui/{ScenarioPanel,TimelineBar,testHook}.tsx`.

## Commands run (from the worktree root)
| Command | Result |
|---|---|
| `cargo test --workspace` | 165 passed, 0 failed |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web build:wasm` | OK |
| `pnpm -C web test` | 18 files, **91/91 passed** |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web build` | OK |
| `pnpm -C web e2e` | **55 passed, 1 skipped** (the human-approved G4 skip), 6.4 min |
| `pnpm -C web e2e timeline look inspect city.e2e gold5 --repeat-each 3` | **107 passed, 1 failed**: `city.e2e full_demo_on_river_city` repeat 2 failed at its first assertion `s0.running === true` (504 ms); see m8 |
| `pnpm -C web e2e city.e2e -g full_demo_on_river_city --repeat-each 8` | 8/8 passed |

## Manual smoke test (Playwright MCP, vite on 5188, 1280×800, River City)
Screenshots are `.playwright-mcp/timeline-003-gold-1-*.png`.
1. **The window grows.** At 60×, the memory rose 5.3 → 8.2 MiB over 10 s, and the text read "x.x / 48 MiB replay memory (per scenario)". After 132 s the window was full: start 480, head 20,391, 47.92 MiB, and eviction had begun (`-02-full-window`). The labels say "SIM TIME". ✓
2. **Drag back about 5 min.** A real pointer drag from the head, 40 moves over about 600 ms, posted **11 seeks with gaps of 100, 101, 101, 101, 99, 100, 101, 101, 101 ms and a final release seek 78 ms later**. The throttle is correct. The run ended paused at 21,799, 646 ticks back. The sim time and `aria-valuetext` both read 03:01:39 (`-03`). ✓
3. **"Close the main bridge" in the past.** It posted one `branch {fromTick: 21799}` and no native dialog. The panel showed "Viewing B: branch", with "B: branch from 03:01:39" pressed.
   - The bridge is **not** visibly closed and the button gives no pending cue until Play (m2).
   - After Play, `closed` was [284, 285].
   - Switching to A showed A open at 21,799, with head 22,445. ✓ apart from m2.
4. **Replace confirmation.** Going 3 min back in A and pressing B showed the inline "Replace the branch?" (`-06-confirm`).
   - Cancel left B at 21,799.
   - Replace made B at 21,439, the new A position. No dialog appeared. ✓
   - The confirmation also survives a scenario switch (m1).
5. **Discard.** It returned to A at its own position (21,319). The panel is gone and `branchTick` is null. ✓ (focus falls to `<body>`, m9)
6. **The vehicle panel closes on a seek.** At zoom 1.61 px/m I clicked a car: `trackedTrip` was 65,889 and the panel was open. ← on the slider gave `trackedTrip` null and closed the panel (`-08`, `-09`). ✓
7. **Grayscale** (`-10` … `-14`).
   - The A/B cue reads without hue:
     - the viewed label has a solid frame for A, and a dashed frame plus hatch for B;
     - the pressed button has an outline and bold text;
     - the text names the viewed scenario.
   - The branch marker is a ◆ with text. ✓
   - When the playhead is at or near the branch tick, the branch text overprints the playhead label (m3).
8. **Seek and branch cost, measured at a full 48 MiB window** (River City 2026/7, window 240…20,160, 47.94 MiB, 167 snapshots):
   - **Chrome (Playwright), wasm called directly on the page:**
     - seek: median **2.1 ms**, p95 3.7, max 4.3 (n = 200);
     - branch: median **5.7 ms**, p95 10.6, max 15.8 (n = 40).
   - **Node, the same wasm** (`scratchpad/gold-tl003/bench.mjs`): seek median 2.03 ms, p95 4.15; worst-case seek (+119 ticks) median 4.28 ms; branch median 6.28 ms, max 25.85 ms.
   - **End to end in the app** (track click to the first frame at that position, full window, 2,880…22,445): median **7.4 ms**, p95 9.6 (n = 25).
   - Seek is well under 20 ms and branch well under 40 ms. ✓
   - Replay determinism: seek back plus `step` to the head gives the head hash. ✓

## BLOCKER
None.

## MAJOR
1. **The scenario panel covers the city and the road and vehicle panels.**
   - `.scenarios` is at `top:16px; right:16px; width:250px` (`web/src/styles.css:433`). That is the same corner as `.side` (`styles.css:210`, `top:16px; right:16px`), the column that holds the road panel and the vehicle panel.
   - **Measured at 1280×800 with B present:**
     - the panel spans (988,16)–(1264,162);
     - `elementFromPoint` at the top road row (y ≈ 140, x 1000–1078) returns the scenario panel or its Discard button;
     - with a road selected, the "Selected road" panel (1024,16)–(1264,267) sits under it: its heading "Link 196" resolves to `.scenario-label`, and its status and count rows are hidden (`-05-road-panel-under-scenarios.png`). Only "Close link" stays reachable.
   - **At 1280×720:** a 4-px scan with `pickAt` found 59 road samples (link 211, y 132) covered, all by the Scenarios panel.
   - This breaks "the bar plus the moved panels do not cover the city" and leaves the road and vehicle panels partly unreadable whenever B exists.
   - **Fix:** stack the scenario control inside `.side`, or place it where it clears both FIT_INSETS.top and the side column.
2. **A stale `mainPending` turns "Close the main bridge" in the past into a branch that *opens* the bridge.**
   - `toggleMainBridge` (`web/src/App.tsx:402-409`) computes `closedNow = mainPending ?? …`. `mainPending` clears only when a frame confirms it (`App.tsx:292`), and no seek, view switch or discard resets it.
   - **Reproduced:**
     1. Click Live (paused at head 22,445) and press B. The button reads "Main bridge closed — reopen (pending)", because a command at the head applies on the next step.
     2. Press ← on the slider (position 22,325). The bridge is open in view, but the button **still says "closed — reopen (pending)"**.
     3. Press B. It sends `branch {fromTick: 22325}` with `then = open` (`closedNow` was true).
     4. After Play, B has `closed: []` and the button still reads "(pending)".
   - The demo action creates a branch with a no-op intervention, and the label lies about the view. The same stale state carried into later branches in this session (`-14-gray-full.png`: B open, button "reopen (pending)").
   - **Fix:** reset `mainPending` on every jump (seek, branch, view, discard), or derive it per scenario and position.
3. **A replaced or discarded B is never freed, so wasm memory grows by about 57 MiB for each replace.**
   - `host.ts:302` (`scenarios = [a, b]`) and `host.ts:327` (`scenarios = [scenarios[0]!]`) drop the old B `Sim` without `.free()`. Release then depends on `FinalizationRegistry`, which runs only after a major GC of a tiny JS wrapper, which V8 has no reason to schedule. Wasm memory also never shrinks.
   - **Probe** (`scratchpad/gold-tl003/leak.mjs`, the built wasm):
     - with A full at 47.9 MiB, the wasm heap is 56 MiB;
     - each `a.branch(…)` that only drops the previous B grows the heap: 109 → 166 → 223 → … → **507 MiB after 8 replaces**.
   - This contradicts the ward's own deviation ("each scenario has its own 48 MiB budget, at most 96 MiB in total") and the brief's explicit replay memory budget.
   - **Fix:** add `free?()` to `SimLike` and call it on the replaced or discarded B.
   - I could not read the worker's heap in the browser. The defect is in the code path, and the node probe shows the per-replace cost.

## MINOR
1. **The inline confirmation outlives a scenario switch or a seek, and Replace uses the position at click time.**
   - `ConfirmReplace.onReplace` sends `branch(currentPosition(), confirmReplace)` (`App.tsx:742-743`).
   - **Reproduced:**
     1. View A at 21,319 and press B. The confirmation appears.
     2. Click "B: branch from …". The confirmation stays.
     3. Click Replace. The new `branchTick` is **21,439**, B's position, not the 21,319 where the user intervened.
   - **Fix:** capture the tick when the confirmation opens, and close the confirmation on any jump.
2. **No pending cue after a branch.**
   - After a branch from A's past, B is paused at `fromTick` with the bridge still drawn open and the button reading "Close the main bridge". The closure applies only on the first step, because `direct = false`, so `mainPending` is never set (`App.tsx:409`).
   - Smoke step 3 ("the bridge is closed") holds only after Play.
3. **The branch marker text overprints the playhead label.** When the playhead is near the branch tick, "◆ branch hh:mm:ss" (`TimelineBar.tsx:125`, `styles.css:416`, `white-space: nowrap`, overflowing the track) covers the "▸ hh:mm:ss" label (`TimelineBar.tsx:131`). Right after a branch the playhead time cannot be read (`-04`, `-10`, `-13`).
4. **`viewScenario` does not clear the target's retained frame trip tables** (`host.ts:311-321`).
   - A pick sent from a B frame that arrives after the switch to A is resolved by `trip_at_record` against A's tables, and A can hold a frame at the same tick, so the wrong vehicle gets tracked.
   - This is a small race found by code reading and not reproduced. `seek` does clear these tables (`lib.rs` `seek`).
5. **The drag has no `pointercancel` or `lostpointercapture` handling** (`TimelineBar.tsx:120`). If the up event is lost, `drag.current` stays set and hover moves keep seeking. Found by code reading.
6. **Orphaned export:** `STEP_TICKS` (`TimelineBar.tsx:6`) is exported but used only in its own file.
7. **No head marker on the track.** The spec asks for "a head marker". The track's right edge is the head, and only the "head hh:mm:ss" label marks it.
8. **Pre-existing flake, not attributed to this ward.**
   - `city.e2e full_demo_on_river_city` failed 1 of 3 repeats: `s0.running` was false right after `ready()`.
   - The first post-warm-up frame can precede the UI's `setRunning(true)` (`host.ts` `iterate`, a code path this diff does not change). The test then passed 8/8 in isolation.
   - Worth hardening in a later ward.
9. **Discard drops focus to `<body>`**, because the button unmounts. Keyboard users lose their place.

## Checked and OK
- **A is never edited in its past.**
  - The host refuses `command` when `viewed === 0 && position < head` (`host.ts`, in `command`), and frozen test 7 covers it.
  - The UI routes A-past interventions (bridge button, B key and road panel) through `intervene` to `branch` (`App.tsx` `intervene`).
  - My probes saw only `branch` messages, never a `command`, from A's past.
- **Every jump resets the clock, perf and inspection.** `afterJump` runs `resetExecuted`, `resync`, creates a new `TickWindow`, zeroes the counters, clears `trackedTrip` and posts a frame at once. It runs on seek, branch, view and discard.
- **pendingSeek** is cleared:
  - by a matching frame;
  - by any error, so a refused seek clears it;
  - on view and discard.
  - On a branch it is cleared by the branch frame (position = `fromTick` = the pending value).
- **The branch frame state is fresh:** a new `Sim` with empty frame and trip tables, and its own network export.
- **The frame payload stays numeric:** `timeline` is six numbers, and window metrics are not sent.
- **Bottom band:** the bar (y 758–790 at 800, 678–710 at 720), the metrics strip and the legend cover no road sample at either size, and frozen test 11 passes.
- **Tab budgets:** all frozen suites pass. The bar comes after the legend in the DOM.
- **Colourblind cues** hold in grayscale; see smoke step 7.
