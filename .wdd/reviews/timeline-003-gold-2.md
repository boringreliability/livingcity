# timeline-003 Gold review, round 2

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 3 MINOR)

Reviewer: a fresh adversarial Gold subagent. It did not see round 1's reasoning, only its verdict file.
- Implementation: HEAD f254a99. The r1 fixes are in `git diff HEAD~1 HEAD`.
- Red snapshot: 6f4a043 (Red r3 APPROVED).

## Test freeze
- `git diff 6f4a043 HEAD -- web/tests web/e2e crates/*/tests` only **adds** two new regression files, `web/tests/gold_timeline003.test.ts` and `web/e2e/gold_timeline003.spec.ts`. No frozen file changed.
- sha256 `web/tests/timeline.test.ts` = `520101a0…76cf10` and `web/e2e/timeline.spec.ts` = `dd4eb8d0…87993`. Both are unchanged since Red r3 and round 1.

## Commands run (from the worktree root)
| Command | Result |
|---|---|
| `cargo test --workspace` | 165 passed, 0 failed |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web build:wasm` | OK |
| `pnpm -C web test` | 19 files, **93/93 passed** (91 frozen and earlier tests plus 2 new regressions) |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web build` | OK |
| `pnpm -C web e2e` | **58 passed, 1 skipped** (the human-approved G4 skip), 7.6 min |
| `pnpm -C web e2e timeline.spec gold_timeline003.spec city.e2e.spec look.spec inspect.spec --repeat-each 3` | **108 passed, 0 failed**, 18.7 min. The r1 m8 flake (`full_demo_on_river_city`, `running` false right after ready) did not recur. |

## Round 1 findings: re-verified
| r1 | Status | How it was verified |
|---|---|---|
| MAJOR 1: the scenario panel covers the city and the side panels | **Resolved at 1280 px wide** | Over 5 points per link on every link, `elementFromPoint` hit `section.scenarios` 0 times at 1280×800 and 0 times at 1280×720. With a road selected (north bridge), the "Selected road" panel is at (1024,16)–(1264,267) and the panel at (369,16)–(911,59), so they do not overlap. The panel also stays clear of the control panel at (16,16)–(302,114). Screenshots `-05-layout-1280x800`, `-05-layout-1280x720`. Narrower windows: see m1. |
| MAJOR 2: a stale `mainPending` turns the past branch into an "open" | **Resolved** | Repro: Live, then B at A's head gives "Main bridge closed — reopen (pending)". ← (pos 5874) gives "Close the main bridge". B then opens the confirmation, and Replace sends `branch {fromTick: 5754, then: close 284, close 285}`. B shows "(pending)" until Play, and after Play `closed` = [284, 285]. `forgetPosition()` (`App.tsx:380`) runs on seek, view, discard and branch. |
| MAJOR 3: a replaced or discarded B is never freed | **Resolved** | **Node, through the real `createSimHost`** (`scratchpad/gold2-tl003/probe/leak_host.test.ts`, River City, A full at 47.9 MiB): heap 56 → 116 → 170 MiB after replace 2, then **170 MiB flat through replace 8 and the discard**, with no errors. **Browser:** the worker's `WebAssembly.Memory` read through CDP `Runtime.queryObjects` stayed at **50.8 MiB flat across 8 UI replaces** (B key → Replace → Play 1 s) and the discard. `free()` is called at `host.ts:307` and `host.ts:334`, and also for every scenario on re-init (`host.ts:157`). See m3 for the transient peak. |
| m1: the confirmation outlives a view switch or seek, and Replace uses the position at click time | **Resolved** | The confirmation was gone after clicking "B: branch from …" (count 0) and after ← (count 0). Replace sent the captured `at` (5754 = the position where B was pressed). |
| m2: no pending cue after a branch | **Resolved** | Right after the branch, the button read "Main bridge closed — reopen (pending)" (`-03-branch-pending`). After Play it read "reopen", and B's `closed` was [284, 285] (`-04`). |
| m3: the branch marker overprints the playhead label | **Resolved** | `.to-left` applies when frac > 0.6. Right after a branch, "◆ branch 00:44:57" ends at the track's right edge, and "▸ 00:44:57" reads cleanly (`-03`, `-08`). |
| m4: `viewScenario` keeps the target's frame trip tables | **Resolved** | `forget_frames()` is called in `viewScenario` (`host.ts:327`), and the regression test checks the call order (A, then B1). |
| m5: the drag has no cancel handling | **Resolved** | `onPointerCancel` and `onLostPointerCapture` → `endDrag` (`TimelineBar.tsx:83-87, 127-128`). `lostpointercapture` after a normal `pointerup` is a no-op, because `drag.current` is already null. A real drag sent 11 seeks with gaps of 100/100/101/100/100/100/100/100/101 ms and a final 88 ms, and ended paused exactly 600 ticks back. `aria-valuetext` read "sim time 00:44:57". |
| m6: orphaned `STEP_TICKS` export | **Resolved** | It is no longer exported. Every new export has a consumer. `window_metrics` is a documented T3 deviation (timeline-004). |
| m7: no head marker | **Resolved** | `.timeline-head` is a double rule at the track's right edge (`TimelineBar.tsx:131`). |
| m8: flake (pre-existing) | **Resolved / not reproduced** | `c.setRunning(true)` is now sent right after `createSimClient` (`App.tsx:205-206`). `full_demo_on_river_city` passed 3/3 in the repeat run and in the full run. |
| m9: Discard drops focus to `<body>` | **Resolved for Discard** | After Discard, focus is on the "Timeline" slider. The same defect exists on the confirmation's buttons; see m2 below. |

### The running-during-warm-up change (`App.tsx:204-206`)
`setRunning(true)` now reaches the host during the warm-up. The warm-up contract still holds:
- During the warm-up, `iterate()` returns before `clock.plan()` (`host.ts:480-483`), so no paced ticks run and no frames are posted.
- At the end, `warmStep` runs `addUnpaced(ran)` and then `resync()` (`host.ts:188-189`). `resync` zeroes the backlog and restarts `graceStart` because running is already true. No catch-up burst follows and no false "behind" appears.
- Warm-up ticks stay out of `TickWindow` and the frame perf counters, as before.
- The `onReady` call to `setRunning(true)` is now a no-op (`clock.ts:44`).
- All city-005 warm-up e2e and vitest suites pass.

## Manual smoke test (Playwright MCP, vite on 5187, River City)
Screenshots are `.playwright-mcp/timeline-003-gold-2-*.png`. `Worker.postMessage`, `confirm` and `alert` were instrumented to log messages and count dialogs.
1. **The window grows.** At 60×, the head went from 2,191 to 3,392 in 10 s and the memory from 4.4 to 7.3 MiB. The text read "7.3 / 48 MiB replay memory (per scenario)", and the labels say "SIM TIME" (`-01`). ✓
2. **Drag back 5 min.** It was throttled to about 100 ms per seek with a final seek on release, and ended paused at 5,394 with head 5,994. The frame tick, the metrics and `aria-valuetext` all agree (`-02`). ✓
3. **"Close the main bridge" in the past.** It posted exactly one `branch {fromTick 5394, then close 284/285}` and no `command`.
   - The panel showed "Viewing B: branch" in a dashed, hatched frame, with "B: branch from 00:44:57" pressed.
   - The pending cue showed before Play. After Play the bridge was closed in B.
   - Switching to A showed A at 5,394 with head 5,994 and `closed` = []. ✓
4. **Replace confirmation.** The inline "Replace the branch?" appeared (`-07`). Cancel left B unchanged at 5,394. Replace made B at the captured tick, and **0 native dialogs** appeared. ✓
5. **Discard.** It returned to A at 5,754, removed the panel and set `branchTick` to null, and focus went to the slider. ✓
6. **Seek and branch cost.** r1's `bench.mjs` was re-run on the current wasm, with the window full at 47.94 MiB and 167 snapshots:
   - seek: median **2.10 ms**, p95 4.11;
   - worst-case seek (+119 ticks): median 4.29 ms;
   - branch: median **6.53 ms**, p95 13.48, max 29.54;
   - the replay hash is equal, and seeks below the window and above the head are refused.
   Both are within the bounds (< 20 ms seek, < 40 ms branch). ✓
7. **Grayscale** (`-08` viewing B, `-09` viewing A). The viewed label uses a solid or dashed+hatched frame, the pressed button has an outline and bold text, and the branch marker is a ◆ with text. The closed-bridge button keeps its hatch icon. No cue depends on hue. ✓
8. **Memory after 8 replaces in the browser:** flat at 50.8 MiB (see MAJOR 3 above). ✓

## Code review
- **A is never edited in its past.**
  - `command` refuses A below the head (`host.ts:239-245`).
  - The UI's only direct-command path is `intervene` (`App.tsx:416`). It runs only when A is at its head or B is viewed.
  - Every probe in A's past posted `branch`, never `command`.
- **Jump resets.** `afterJump` runs on seek, branch, view and discard. The UI's `forgetPosition` clears pending and confirm on each of them, and view and discard also clear `pendingSeek`.
- **Freeing:**
  - the replaced B is freed only after `a.branch()` succeeds, so a refused branch keeps the old B;
  - `sim` is never left pointing at a freed object, because it is reassigned before or with each free.
- **Tab order:** the frozen Tab-budget suites pass, and the bar and scenario control come after the legend in the DOM.
- **Orphaned exports:** none.

## BLOCKER
None.

## MAJOR
None.

## MINOR
1. **The centred scenario panel collides with the control panel and the road panel below about 1,150 px of window width.**
   - `.scenarios` (`web/src/styles.css:448`) is centred, about 542 px wide, with `nowrap`.
   - **Measured** with a road selected:
     - at **1024×768**, the panel (241,16)–(783,59) overlaps "Simulation controls" (16,16)–(302,114) and "Selected road" (768,16)–(1008,267). `elementFromPoint` on the speed status "0.0× of 60×" and the **Diagnostics (≡) button** returns the scenario panel, so the button cannot be clicked;
     - at **1100×768**, the Diagnostics button is still covered;
     - at 1150 and 1180 px, nothing is covered;
     - at **900×700** (a size `city.spec.ts:198` uses), both overlaps occur.
   - Screenshots: `-05-layout-1024x768`, `-05-layout-900x700`, `-06-1024-controls-covered`.
   - No road is covered at any size tested. The tested and demo size of 1280 px is fine.
   - Suggested fix: wrap the panel or stack it under the control panel when it is narrow (for example a `max-width: calc(100% - 2 × 318px)` plus wrap, or a media query).
2. **Cancel and Replace in the inline confirmation drop focus to `<body>`.**
   - The `ConfirmReplace` section unmounts (`App.tsx:767-779`). Focus moved via keyboard to Cancel or Replace, followed by Enter, leaves `document.activeElement` as BODY.
   - This is the same class of defect as r1 m9, which was fixed only for Discard.
   - The confirmation also does not take focus when it opens, so a keyboard user who pressed B has to Tab to it.
3. **A replace briefly holds A plus two Bs.**
   - The new B is built (`host.ts:301`) before the old one is freed (`host.ts:307`). The node probe shows a one-time high-water mark of 170 MiB of wasm heap with A full: 56 MiB for A and about 57 MiB for each B. wasm memory never shrinks.
   - The steady state is flat (the leak is fixed), but the peak exceeds the deviation's "at most 96 MiB in total" by one B's worth.
   - Freeing first would lose B when the branch is refused, so the current order is defensible. The deviation text should state the transient peak, or the branch should be validated against A's window (as `timeline_info` allows) before the old B is freed.
