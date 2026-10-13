# motion-003 Gold gate, round 2: REJECTED

Reviewer: a fresh adversarial implementation-review subagent. Scope: the fix commit 01d7bc6 (`git show 01d7bc6`) on top of `git diff 6753f58..HEAD -- crates web/src docs`, at HEAD 01d7bc6. Context: the round 1 verdict (`motion-003-gold-1.md`), the ward spec, epic M3 and task §3.

## Verdict: REJECTED (0 BLOCKER, 1 MAJOR, 4 minor)

- **MAJOR-2 (compare timeline) is fixed.**
- **MAJOR-1 (queue pins covering labels) is only partly fixed.** The new `clearPins` handles the single-pin case, but a pin still covers a district or bridge name whenever none of its four candidate places is free. The usual cause is two top-queued links that end at the same intersection next to a label. In that case it silently falls back to the default "above" place, on top of the label. I reproduced this on the standard demo path (River City, single view and compare) with the paused, painted picture (screenshots below). Round 1's acceptance bar was "no shown label overlaps a shown pin". The ward text now promises "the first of four places … that overlaps no shown label", but it does not say what happens when all four overlap.

## Frozen tests (verified)
- sha256:
  - `web/e2e/motion003.spec.ts` = 9b9ca968…095e;
  - `web/tests/motion003.test.ts` = 4ea646df…bee4f;
  - `crates/sim-core/tests/motion_003_consequences.rs` = 26d2388b…7b87.

  All three match the red-4-auto freeze.
- `git diff 34d6a55..HEAD --stat` lists `.wdd/reviews/motion-003-gold-1.md`, `.wdd/wards/motion/ward-003.md`, `docs/architecture.md`, `docs/demo.md`, `web/src/App.tsx` and `web/src/ui/TimelineBar.tsx`. No test file has changed since the Red freeze.
- `git diff 6753f58..HEAD --stat -- web/tests web/e2e crates/*/tests` lists only `web/e2e/motion003.spec.ts`. Those are the Red r3 and r4 changes, as in round 1.
- No Rust change in the fix commit. Determinism and golden hashes are unaffected (the cargo suite is green).

## Commands and results
| Command | Result |
|---|---|
| `pnpm -C web build:wasm` | exit 0 |
| `pnpm -C web build` | exit 0 |
| `pnpm -C web test` | 31 files, **156 passed, 7 skipped**, exit 0 (305 s) |
| `cargo test --workspace` | **173 passed, 0 failed, 9 ignored**, exit 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |
| `playwright -c zz-alt-port.config.ts e2e/motion003 look layout a11y guide` | **37 passed** (7.7 min; load at start 9.6, at end 27.7) |
| `playwright -c zz-alt-port2.config.ts e2e/timeline gold_polish002 compare acceptance inspect motion002 gold_timeline003/004/005` | **51 passed** (12.9 min; load at start 9.6, at end 20.5) |
| Per-frame pin placement cost (copy of `clearPins` in the page, 6 pins in compare, layout dirtied each call, 300 runs) | median 0.20 ms, p95 0.30 ms, max 2.7 ms |
| Render interval at `?demand=3`, 20×, Main Bridge closed, 3 pins (600 rAF intervals) | median 8.3 ms, p95 10 ms (120 Hz display, load ~20). No perf concern. |

## Manual Smoke Test
Dev server on port 5270, viewport 1280×800, Playwright MCP. Screenshots are in `.playwright-mcp/g2-*.png`, which git ignores.

1. **PASS, with the MAJOR-1 residue.**
   - River City at 20×: the Main Bridge closed at tick 2247 and was run to 5354 (> 15 sim min).
   - Summary: "✕ Closed Main Bridge · 00:18:43". That is 2247 × 0.5 s, so the time is correct.
   - Timeline ✕ at x = 581. The expected x is 401 + 2247/5354 × 428.3 = 580.8.
   - Bridge labels: North, Main and Old Bridge.
   - Pins ▼62 / ▼44 / ▼19 on links 140 / 110 / 66, which equal `queuePins()`.
   - In the end state (g2-smoke1.png) there is no overlap, and the pins read as at their queue heads. For example, ▼62 sits below the stop line, on the orange queue.
2. **PASS.**

   | Bridge | now | before | change |
   |---|---|---|---|
   | North Bridge | 373 | 41 | +332 ▲ |
   | Main Bridge | 0 | 520 | −520 ▼ |
   | Old Bridge | 208 | 76 | +132 ▲ |

   - The hook gives 372.998 / 41, 0 / 520 and 208.16 / 76.
   - The caption reads "(observed): now and before the bridge closure at 00:18:43".
3. **PASS.**
   - Clicking "Link 140 · 62 queued" gives `selectedLink` 140, and the panel shows "queued 62".
   - Esc brings the summary back.
4. **PASS.**
   - The summary shows "○ Reopened Main Bridge · 00:44:37".
   - The ○ marker is at x = 819, with two hook entries in tick order.
5. **PASS.**
   - After Jump to start, the summary is gone, and `interventions()` and `crossings()` are [].
   - The markers stay at 577 and 819 (the window grew between steps, so the closure marker moved from 581 to 577).
6. **PASS.**
   - Branch at 15:00 with B, which closes the Main Bridge in B. In B, Link 110 was then closed at 18:21 and the Main Bridge reopened at 22:32. Then compare.
   - Rows Crossings · North / Main / Old Bridge: A 159 / 236 / 140, B 275 / 41 / 181, Δ +116 ▲ / −195 ▼ / +41 ▲.
   - Generated is 3639 = 3639. Incomplete (1718 / 1753) and Unserved are shown (g2-compare1.png).

### MAJOR-2 re-check: fixed
- In compare (window 1800–3005, branch at 1800), the markers are:
  - "A: Closed Main Bridge at 00:18:43" (✕A);
  - "B: Closed Main Bridge at 00:15:00" (✕B);
  - "B: Closed Link 110 at 00:18:21" (✕B);
  - "B: Reopened Main Bridge at 00:22:32" (○B).

  Each side's own interventions are named, and the glyph plus letter does not rely on colour. This covers a B closure that is not at the branch tick, and a reopen.
- Second branch, at 25:11 from A (after A's closure at 18:43), with B reopening the bridge. The compare window starts at the branch tick (3023), so the shared closure at 18:43 is outside the window and not shown. Only "B: Reopened Main Bridge at 00:25:11" is shown, which is correct. The "shared history unmarked" branch of the code is unreachable in practice, because the compare window never precedes the branch tick. It is harmless.
- Outside compare, B's markers are unlabelled and include the inherited 18:43 closure, as before.

## Findings

### MAJOR-1 (residual): a pin still covers labels when none of its four places is free
- **Code.** `App.tsx` `clearPins` starts from `let chosen = PIN_PLACES[0]`. If every place overlaps something in `taken` (labels or earlier pins), it keeps "above", whatever that covers. Nothing hides or yields either mark.
- **Trigger.** Two of the top-3 queued links often share a stop-line node, because two approaches feed one congested junction. The first pin takes "above" or "below", and the second then has every place blocked by the first pin and the neighbouring label.
- **Evidence 1: single view, demo path, paused, the painted state after two rAFs** (g2-pin-fallback-3794.png). River City, the Main Bridge closed at 18:43, position tick 3794.
  - "▼ 20" and "▼ 11" both sit at the point (494, 410).
  - ▼20 takes "below".
  - ▼11 is blocked:
    - above by "⌂ Old Town";
    - below, right and left by ▼20.

    It falls back to above, covering "Old Town" [481, 382, 550, 397]. The label reads "⌂ ▼11 d Town".
  - A sweep of 40 replay positions (0–5234, every 120 ticks) found 2 persistent overlaps (ticks 3794 and 1154, both over Old Town).
  - Running at 20×, rAF-synchronised sampling found 2 of 95 samples overlapping (▼4 over Old Bridge, ▼36 over North Bridge).
- **Evidence 2: compare**, painted and persistent while paused (g2-compare-overlap.png). Tick 4823, B half.
  - "▼ 38" and "▼ 5" share the point (864, 352).
  - ▼5 falls back to above and covers "⌂ Old Town", which reads "⌂ ▼5 Town". This is the same symptom as round 1's "▼27 rth Bridge".
  - While running in compare (tick 3005 → 4808), **34 of 169** rAF-synchronised samples had an overlap. Many are on **A's half, which is the standard demo state** (A: Main Bridge closed): "▼ 10…▼ 22" over "Old Bridge" from tick 3047 to 3304, more than 2 sim min almost continuously, and "▼ 5" over "North Bridge".
  - Some B-half samples follow my extra Link 110 closure.
- **three_bridges.** 0 of 169 samples overlapped over 15 sim min after the closure.
- **Why MAJOR.** This is the defect round 1 rejected: an opaque pin hides a map name on the demo path, and in compare it does so on the side the user is comparing. The fix covers the easy case and leaves the documented guarantee ("overlaps no shown label") false whenever the four places run out.
- **Fix direction**, any of these:
  - when no place is free, hide the lower-priority mark: the overlapped zone or bridge label, or the smaller pin;
  - merge co-located pins into one ("▼ 20 · 11");
  - try further offsets, for example stacking a pin beside the other pin.

  Then add the regression test round 1 asked for, in a **new** file through a Red gate. In single and compare views after the closure, sampled after rAF over a run, no shown pin may intersect a shown `.zone`, `.bridge-label` or other pin. No such test was added. That is how this residue got through: every suite is green.

### Minor
- **m-a (carried over from round 1, not addressed or recorded): m1, m3 and m6.**
  - **m1:** the markers are still children of `role="slider"`. `aria-valuetext` is only "sim time …", so the A/B intervention names may not reach assistive tech.
  - **m3:** the reserved empty guide band.
  - **m6:** "North / Bridge" and "Main / Bridge" still wrap in the summary's crossing table at 1280 px (g2-smoke1.png).

  None of the three is fixed, and none is in `.wdd/memory/polish-backlog.md` or in the ward as deferred. Either fix them, or record them as deferred (backlog plus epic gate known issues).
- **m-b (new, cosmetic): adjacent A/B markers run together.** Markers are now 14–17 px wide ("✕B", "○B"), and close interventions on A and B merge visually. In g2-compare1.png, "✕B✕A" sits at x 537–568 with a 1 px gap, so it is ambiguous which letter belongs to which glyph. If A and B intervene at the same tick, their markers overlap completely. Possible fixes:
  - put the A and B markers on separate sub-rows;
  - or offset or stack them on collision.
- **m-c (new, cosmetic): a marker at the window start overhangs the track.** In compare, B's marker at the branch tick is centred on the track's left edge (x 394–409 against a track starting at 401). It overlaps the "SIM TIME 00:15:00" start label region, although it is readable.
- **m-d (docs):**
  - `docs/demo.md` § compare does not mention that the timeline then shows A's and B's own interventions as "A: …"/"B: …" (✕A/✕B). Only the ward text describes it.
  - The ward's pin sentence should state the behaviour when no place is free (after MAJOR-1 is fixed).

  The round 1 m4 and m5 doc fixes are done: the getters are named in `docs/architecture.md`, "up to three", "for the same trips and time window", and the summary yielding to detail panels.

### Checked, no finding
- **Determinism and invariants.** The fix is UI-only. No `World` state, message type or Rust change was added, and identical demand is preserved (Generated equal).
- **Wording.** No causal words were added. demo.md's "where the traffic went instead" is now "for the same trips and time window".
- **Colourblind safety.** The scenario on a marker is carried by a letter and an accessible name, not colour.
- **Performance.** `clearPins` interleaves transform writes and `getBoundingClientRect` reads, so it forces up to 4 layouts per pin per frame. Measured at ≤ 0.3 ms p95 with 6 pins. The DOM size does not depend on demand. The render interval at `?demand=3` is 8.3 / 10 ms (median / p95).

## Git state
After the review, `git status --short` lists only the pre-existing `web/zz-alt-port*.config.ts` and this file. The dev server (port 5270) and the browser are stopped. The screenshots are in `.playwright-mcp/`, which git ignores.
