# timeline-004 Gold review, round 1

**Verdict: REJECTED** (0 BLOCKER, 1 MAJOR, 7 MINOR)

Reviewer: a fresh adversarial Gold subagent. It saw only the artifacts: the ward spec, the T4 contract, the frozen tests, the diff and the Red verdict files.
- Implementation: HEAD 8c2e364.
- Red snapshot: c5a53fc (Red approved by the user after r3).

The engineering core is sound. Lockstep is bit-identical to separate runs (probed independently, including after seeks and re-entries), pairs are committed together, buffers are returned, B's context is released, and every suite is green and stable. The one MAJOR is a UI defect: none of the controls disabled by this ward look disabled.

## Test freeze
- `git diff c5a53fc HEAD -- web/tests web/e2e crates/*/tests` is **empty**.
- sha256 `web/tests/compare.test.ts` = `b749a549…`, `web/e2e/compare.spec.ts` = `a5cf7547…`. Both are identical at c5a53fc and HEAD.

## Commands run (from the worktree root)
| Command | Result |
|---|---|
| `cargo test --workspace` | 165 passed, 0 failed |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `pnpm -C web build:wasm` | OK |
| `pnpm -C web test` | 20 files, **103/103 passed** |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web build` | OK |
| `pnpm -C web e2e` | **66 passed, 1 skipped** (the human-approved G4 skip), 10.2 min |
| `pnpm -C web exec playwright test compare.spec timeline.spec gold_timeline003.spec city.e2e.spec look.spec --repeat-each 3` | **111 passed, 0 failed, 0 flaky**, 25.0 min |

## Lockstep equivalence probe (own, node + real wasm through `createSimHost`)
File: `scratchpad/gold-tl004/lockstep.test.ts`, on three_bridges 17/23.
- **Setup.** A closes link 5 at 301 and link 9 at 1201 (a command after the branch tick), runs to 1300 and seeks to 1000. B branches at 600 with the main bridge closed. B opens link 5 at 801 (its own command) and runs to 900.
- **Checks.** Each check compares both sims' `state_hash_hex` with fresh separate references, and checks that the last two frames are (0, t, compare 1), (1, t, compare 1). There were 10 checks:
  - entry with B viewed (A sought back to 900);
  - a run to 1500;
  - a seek to 700, then a run to 1450;
  - a seek to 1100;
  - exit, view A, seek 1250, re-entry;
  - a run to 1700;
  - exit, A run alone to 1900, re-entry (B stepped forward 1701 → 1900);
  - seeks to the exact shared bounds lo = 600 and hi = 1900.
- **Result.** All 10 checks are equal, and there are no errors.
- **Probe caveat.** `World::state_hash` includes the whole `command_log`, including commands later than the position (`world.rs:750ff`). At a position before a scenario's last command, a plain separate run therefore hashes differently, so for those 4 checks the reference was "a separate run with all commands, then `seek`". The 6 checks at or after every command use fully independent runs (no seek).

## Manual smoke test (Playwright MCP, vite on 5183, River City)
- **GPU.** Hardware: `ANGLE Metal Renderer: Apple M4 Pro`, not SwiftShader.
- **Screenshots.** `.playwright-mcp/timeline-004-gold-1-*.png`.
- **Dialogs.** `alert` and `confirm` were stubbed to count calls: **0 native dialogs** in the whole session.

1. **Branch and enter compare.** Pause, ← ←, then "Close the main bridge" made B at 2804. "Compare side by side" gave two labelled halves ("A: original" solid, "B: branch" dashed) at the same tick 2804. The panel showed 0/0/0 and "—" for mean and p95, with "—" Δ. The shared window was [2804, 2804], and the run was paused (`-01-enter`). ✓
2. **20× run.** In 20 samples at 250 ms, `sides.a.tick === sides.b.tick` every time. Comparison at about +X min after the branch:

   | +min | A incomplete | B incomplete | A mean | B mean | A p95 | B p95 |
   |---|---|---|---|---|---|---|
   | 8.4 | 1644 | 1733 | 3:45 | 3:40 | 6:07 | 5:53 |
   | 15.1 | 1705 | 2014 | 4:15 | 4:20 | 7:22 | 8:35 |
   | 18.5 | 1671 | 2049 | 4:21 | 4:33 | 7:39 | 9:23 |
   | 21.9 | 1674 | 2060 | 4:24 | 4:43 | 7:48 | 10:05 |
   | 25.2 | 1831 | 2147 | 4:26 | 4:56 | 7:52 | 10:49 |

   B's incomplete count is above A's from the start, and B's mean passes A's from about +15 min. At about +20 min, B has about 2,050 vs A about 1,670. This is consistent with the timeline-002 probe (B 2,039 vs A 1,741 at +20 min; this run used a different branch tick). Generated is equal on both sides, and Unserved is 0/0 (`-02-running-25min`). ✓
3. **Pan and zoom.**
   - A wheel zoom on B's half took the zoom from 0.099 to 1.064, and a drag on A's half moved the view (60, 40) px.
   - `linkScreenPointB − linkScreenPoint` stayed exactly (640, 0) throughout, and `drawnCameras.a == drawnCameras.b` (`-04-zoom-pan`). ✓
4. **Scrub.**
   - ← moved both sides from 7643 to 7523, and the comparison tick followed (7523).
   - Home went to the shared window start (2804, the branch). A further ← and "Jump to start" both stayed at 2804, clamped, with no error banner (`-05-scrub`). ✓
5. **Grayscale** (`-03-grayscale`). The sides read by their text and solid vs dashed+hatched frame. Δ reads by its sign and the ▲/▼ glyph. B's closed bridge keeps its hatched barrier. No cue depends on hue. ✓
6. **Cost** (60×, 10 s each, the same sim range 2804 → 4005, from `startPerfRecording`):

   | | ms per tick (mean over about 1,200 ticks) | median / p95 (0.1 ms timer) | achieved | render interval median / p95 | draw CPU median / p95 |
   |---|---|---|---|---|---|
   | single view (B) | **0.070** | 0.1 / 0.2 | 120/120 ticks/s | 8.3 / 9.3 ms | 0.0 / 0.1 ms |
   | lockstep pair | **0.131** (×1.87) | 0.1 / 0.2 | 120/120 ticks/s | 8.3 / 9.3 ms | 0.0 / 0.1 ms |

   The render interval is vsync-bound (a 120 Hz display) in both modes. On this GPU, the second canvas costs nothing measurable. ✓
7. **Toggle 30 times** (15 enter/exit cycles):
   - JS heap after a forced GC: 14 MiB before and 14 MiB after;
   - every removed B canvas: `isContextLost() === true` (15/15);
   - A's context was not lost, with no `webglcontextlost` event on A and no console context messages;
   - one canvas after each exit. ✓
8. **Picking per side.**
   - Clicking B's central bridge gave `pickAt` = {link 284, side B, vehicle null} and the panel "Link 284 (B) … state closed", with "Reopen link" disabled and titled.
   - Clicking A's gave "Link 284 (A) … vehicles 19, queued 1, state open".
   - The B key gave no confirmation and no pending cue (`-07-pick-B`). ✓
9. **Layouts.**
   - **1024×768 after a fresh entry:** the scenario panel wraps to two rows clear of the control panel, and no link sample point is under the comparison or scenario panel (`-09-refit-1024x768`).
   - **1280×720:** see m2 (`-09-refit-1280x720`).
   - **Resize while comparing:** see m3 (`-08-layout-1024x768`).
10. **Exit and discard.**
    - Exiting gave one canvas, the single-view fit (zoom 0.150), and the strip and legend back (`-10-exit`).
    - Discarding while comparing returned to A, `branchTick` null, no comparison region, and focus on the slider (`-11-discard`). ✓

Vite on 5183 was killed afterwards. Port 4243 was not touched.

## Code review
- **Lockstep.**
  - `iterate` plans `n` once and steps `scenarios[0]` and `scenarios[1]` by `n` inside one timed region (`host.ts:598-602`).
  - Pairs are posted together by `postPair` (`host.ts:281-285`), and no path posts a lone frame while `comparing`.
- **Comparison.**
  - It is posted only from `afterPairJump` (entry and seek), from a pause while comparing, and from `iterate` after a pair with `n > 0` and at least 500 ms since the last one (`host.ts:613-616`).
  - `tick` is `a.tick()`, which is the pair's tick, and `fromTick` is `branchTick`.
  - Nothing is posted outside compare.
  - Note: the pause comparison is taken at the sims' current tick. This can be a few ticks past the last posted pair until the next paused pair arrives (at most one frame interval).
- **Shared window and seeks.** The window is `[max(starts, branchTick), min(heads)]` (`host.ts:274-278`), and a non-integer or out-of-window seek is refused before either sim moves.
- **Branch and replace order.** Validation is done against A's `timeline_info` before anything is freed. Then `free(B)` runs, then `scenarios = [a]` and `comparing = false`, then `a.branch` (`host.ts:390-406`). See m7.
- **Pairs in the UI.**
  - A is held in `pendingPairA` until its B arrives (`App.tsx:286-302`).
  - Every path returns its buffers:
    - a superseded A;
    - a mismatched or orphaned pair, where both are returned;
    - B in `applyFrameB`;
    - A in `applyFrame`;
    - a pending A when a single-view frame arrives.
  - B's records are copied (`slice`) before the buffer is transferred back, so a renderer created later replays valid data.
- **B context.** On exit, the layout effect disposes B's renderer and calls `WEBGL_lose_context` (`App.tsx:399-405`). This was verified in the browser.
- **Mode flips after layout.**
  - `compareViewRef` and `setCompareView` are set at the end of the `useLayoutEffect`, after the resize and `fitInsets` (`App.tsx:383-421`).
  - `snapshot().scenario` comes from `viewedRef`, which is updated only on single-view frames.
- **Interventions off.**
  - `intervene` returns early while comparing (`App.tsx:539`), which also covers the B key.
  - The host refuses `command` (`host.ts:245-248`), refuses `viewScenario`, and ignores `inspectVehicle`.
  - `pickVehicleAt` returns null while comparing.
- **Road panel per side.** It takes its frame from `bFrameRef` when picked on B, and host link detail is suppressed while comparing.
- **Colourblind.**
  - Δ is shown as "+n ▲" / "−n ▼" / "0", and time Δ as "+m:ss ▲" etc.
  - Frames are solid vs dashed+hatched. No hue is used.
- **Orphaned exports.** None. Every new export has a consumer:
  - `COMPARISON_INTERVAL_MS`, `ComparisonMessage`, `COMPARE_FIT_INSETS`;
  - `loseContext`, `onComparison`, `compare`;
  - `TimelineStatus.compare`, `SelectionPanel.side/actionsDisabled`, `ControlPanel.bridgeDisabledReason`.
- **Deviations.** The ward spec's "Deviations from T4" section records all four: two canvases, interventions off, vehicle inspection and the view switch off, and seeks below the branch refused. They are still to be carried into CONTEXT.md and the epic-gate notes.

## BLOCKER
None.

## MAJOR
**M1. No control disabled by this ward looks disabled.**
- **Where.** `styles.css` has no `:disabled` rule at all. The base `button` rule (`styles.css:127-136`) gives every button the same colours and `cursor: pointer`.
- **Which controls.** While comparing, these are functionally disabled but drawn exactly like live controls:
  - "Close the main bridge" (`ControlPanel.tsx:70`);
  - the road panel's Close/Reopen (`SelectionPanel.tsx:57,61`);
  - the A/B scenario buttons (`ScenarioPanel.tsx:20,23`).
- **Repro.** In compare, `getComputedStyle(bridgeButton)` gives `opacity 1, cursor pointer`, while `disabled === true`. See screenshots `-02`, `-03` and `-07`: the bridge button, "A: original" and "Reopen link" are indistinguishable from enabled buttons.
- **Effect.** The demo's most prominent action silently does nothing on click, and the only cue is a hover tooltip. In grayscale, "B: branch from …" still reads as a pressed, live button. The ward's own contract is "interventions are disabled", and a user must be able to see that, which needs a non-hue cue: dimming, a cursor change, or a hatch/strike.
- **Fix.** A `button:disabled { opacity: .45; cursor: not-allowed; }`, or similar, plus a check that the hatch icon on the bridge button dims too.

## MINOR
- **m1. A stale hover highlight on A while comparing.**
  - `move` returns before hover handling while comparing (`App.tsx:658`), and the layout effect does not clear `hoveredRef`.
  - A road hovered in single view therefore stays highlighted on A, and only on A, for the whole comparison, so the two sides render the same link differently.
  - Repro: hover link 150, then click "Compare side by side". The crops `-06c` (A, highlighted) and `-06d` (B, not highlighted) differ.
  - Fix: set `hoveredRef.current = null` in the layout effect.
- **m2. The side labels cover the map corner at 1280×720.**
  - `.side-label` is fixed at `top: 128px` (`styles.css:521-523`).
  - At 1280×720 the compare fit puts each network's top edge at y ≈ 132, so "A: original" and "B: branch" sit on the NW corner roads.
  - 10 link sample points (out of 3 per link) lie under each label. The label is `pointer-events: none`, so the roads under it are still clickable.
  - At 1280×800 and 1024×768 the labels are clear.
- **m3. A window resize while comparing does not refit.**
  - The ResizeObserver only calls `setViewport` (`App.tsx:428-432`).
  - Going from 1280 to 1024 wide in compare leaves each 512 px half showing a cropped city (`-08-layout-1024x768`): "Hillside" and "Eastgate" are cut off, and the side labels overlap "Westbrook Heights".
  - The single view has the same behaviour, but halving the width makes it much worse. Re-entering refits correctly.
- **m4. The road panel covers B's NE corner.**
  - With a road selected while comparing, the "Selected road" panel at (1024,16)–(1264,197) covers B's top-right road row (y ≈ 173, x 1024–1250) at 1280×800 (`-07-pick-B`).
  - `COMPARE_FIT_INSETS.right = 16` leaves no room for the side panel on B's half.
- **m5. Diagnostics in compare are A-only or unlabelled.**
  - "sim tick (median / p95)" silently becomes the **pair** cost (`DiagnosticsPanel.tsx:33`), with no label saying so.
  - "frame size", "vehicles" and "frame encode" show A's frame only.
  - The ward asks for the lockstep cost to be visible in diagnostics, so label it, e.g. "sim tick (A+B pair)".
- **m6. Buffer pooling is broken for B's frames.**
  - `postFrame` sets `pool = []` after taking a buffer (`host.ts:504-506`).
  - In a pair, A's frame therefore discards B's returned buffer, and B's frame always allocates a new `ArrayBuffer`. While paused (equal sizes every frame) this is about 60 allocations/s that the pool was meant to avoid.
  - This is not a leak, because GC collects them, but returning B's buffer is pointless as written.
- **m7. `sim` can dangle during a replace.**
  - The replace now frees B before `a.branch` (as the ward requires), but `sim` still points at the freed B until `sim = b` (`host.ts:400-406`).
  - If `a.branch` ever threw after validation, the outer catch would report an error and the next `iterate` would call `step` on a freed wasm object, so the host would halt.
  - It is unreachable today, because validation matches `Timeline::branch`'s range. Assign `sim = a; viewed = 0` before the free for robustness.

## Observations (no action required)
- **Comparison lag.** The panel's "sim time … (both)" lags the playhead by up to 500 ms of host time while running: 10 sim s at 20×, 30 at 60×, for example 00:49:40 in the panel vs ▸ 00:49:50 on the bar in `-02`. This is the specified throttle, and the line is labelled with its own tick.
- **Panel layout.** The comparison panel is wider than its table because of the one-line "sim time … measured since …" header, which leaves an empty right half (cosmetic).
- **Hash caveat.** The `state_hash` includes the full command log, including future entries (see the probe caveat). Future hash-based equivalence tests at positions before the last command need a reference built the same way.
