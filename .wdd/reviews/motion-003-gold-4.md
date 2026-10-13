# motion-003 Gold gate, round 4: APPROVED

Reviewer: a fresh adversarial implementation-review subagent. Scope: the whole ward (`git diff 4667113 HEAD`, HEAD = 5054126), with a focus on the fix commit 5054126, which answers Gold r3 MAJOR-1 (the `.at-end` shift moved a head marker off its tick). Context: the ward spec, CLAUDE.md, `livingcity.md`, the user's task, Gold r1–r3, Red r1–r5, and the docs.

## Verdict: APPROVED (0 BLOCKER, 0 MAJOR, 3 minor, 3 observations)

- **Gold r3 MAJOR-1 is fixed.** The `.at-end` class and its CSS rule are gone. The reopen marker at the head is centred on its tick: −0.88 px at 1280×800 and −1.0 px at 1280×720, against ≤ 2. The frozen `motion003.spec.ts › intervention_summary_and_map_markers` passes.
- **The Gold r1 and r2 fixes still hold:**
  - pins cover no label (0 overlaps, single view and compare, 1280×800 and 1280×720);
  - the compare timeline names A's and B's own interventions ("A: Closed Main Bridge at 00:15:19", "B: …");
  - B's marker at the window start stays inside the track.
- **One frozen-test failure in 4 runs.** I traced it to the test's data, not to a product defect (m-1). Three reruns with `--repeat-each 3` passed.

## Frozen tests (verified)
| File | sha256 (measured) | Match |
|---|---|---|
| `crates/sim-core/tests/motion_003_consequences.rs` | 26d2388bdbd244cdc8058316bb98f084e7f0e25a13005b1e204b86a16a387b87 | yes |
| `web/tests/motion003.test.ts` | 4ea646df425d5516483754ac8a80871df3ad8faa1901315156cd94a691dbee4f | yes |
| `web/e2e/motion003.spec.ts` | 9b9ca968622bccc86169b1819faa0644c2aae9170498708fc53bfad02da4095e | yes |
| `web/e2e/motion003_gold.spec.ts` | aad8d3342396c57f073aea2a374efd171da07c59ded5b90bc878f1d3d6a6b89a | yes (Red r5, fae9cab) |

- `git diff --stat fae9cab HEAD -- web/e2e web/tests crates/*/tests` is empty: no test has changed since Red r5.
- 5054126 touches only `styles.css`, `TimelineBar.tsx`, `docs/known-issues.md` and the Gold r3 verdict.
- `.wdd/memory/supersessions.md` has no motion-003 entry. The 7 skipped vitest tests are the earlier supersessions S1–S7.

## Commands and results
The load average was 6–7 at the start and 25–36 during the browser runs (macOS, SwiftShader).

| Command | Result |
|---|---|
| `pnpm -C web build:wasm` | exit 0 |
| `pnpm -C web build` | exit 0 (typecheck and Vite build) |
| `pnpm -C web test` | 31 files, **156 passed, 7 skipped**, exit 0 |
| `cargo test --workspace` | **173 passed, 0 failed, 9 ignored**, exit 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |
| `playwright -c zz-alt-port2.config.ts motion003 motion003_gold look layout guide a11y` | **39 passed, 1 failed** (12.4 min; load 6.2 → 34.1). The failure: `motion003.spec.ts:209 compare_shows_crossings_since_branch`, "queue pins on A", received 0 (see m-1). |
| Rerun of that test, `--repeat-each 3` | **3 of 3 passed** (2.1 min; load 30.8 → 32.5) |
| `playwright -c zz-alt-port.config.ts compare gold_polish002 timeline acceptance inspect motion002` (port 5194, run in parallel) | **51 passed** (13.2 min; load 24.6 → 30.4) |
| Reviewer micro-benchmark (node + real wasm, River City, Main Bridge closed, tick 3600–4000) | `command_log` + 4 × `exits_at` cost **0.74 µs/frame median** (p95 1.55); `encode_frame` costs 20.4 µs. This agrees with `docs/performance.md` (0.66 µs vs 24.3 µs). |

## Manual Smoke Test
- **Method:** a Playwright script (`smoke.mjs`) on my own dev server (port 5287), headless Chromium on SwiftShader.
- **Viewports:** 1280×800, with the whole run repeated at 1280×720.
- **Evidence:** screenshots `s1/s3/s4/s5/s6.png` and `s4-timeline.png` / `s6-timeline.png`, in the reviewer's scratch directory.
- **Numbers:** the figures below are from the 1280×800 run.

1. **PASS.** The Main Bridge was closed at tick 1839 at 20× and the sim run to 3647 (15.1 sim min).
   - Summary: "✕ Closed Main Bridge · 00:15:19".
   - The timeline ✕ marker centre is 620.9, against an expected 620.8 (+0.1 px).
   - `bridgeLabels()` lists North, Main and Old Bridge, all shown.
   - The pins on links 110 / 131 / 108 (▼86 / ▼28 / ▼10) equal `topQueues(linkQueued)`. The hook places each 0.0 px from its stop-line end.
   - There are 0 pin-to-label overlaps and 0 panel overlaps.
2. **PASS.** Crossings per 10 min (now / before / change):

   | Bridge | now | before | change |
   |---|---|---|---|
   | North Bridge | 390 | 43 | +347 ▲ |
   | Main Bridge | 0 | 493 | −493 ▼ |
   | Old Bridge | 206 | 64 | +142 ▲ |

   - The hook gives 389.7 / 43, 0 / 493 and 205.9 / 64.
   - The caption reads "Crossings per 10 min (observed): now and before the bridge closure at 00:15:19".
   - No text matches the forbidden pattern `because|caused|due to|faster|slower`.
3. **PASS.**
   - Clicking "Link 110 · 86 queued" gives `selectedLink` 110, and the *Selected road* panel shows "queued 86".
   - The summary yields to the panel. After Esc it is back.
4. **PASS.**
   - The summary shows "○ Reopened Main Bridge · 00:30:23", and the hook has 2 entries in tick order.
   - The ○ marker is at the head: centre 835.0 against an expected 835.8 (−0.88 px). The glyph's right edge is 839.8 against the track's right edge at 837.2, a 2.6 px overhang that `docs/known-issues.md` documents.
   - The marker does not reach the playhead label, which starts at 847.2.
5. **PASS.**
   - After Jump to start (position 0), `interventions()` and `crossings()` are [] and the summary is hidden.
   - Both markers stay in place: 620.3 and 835.0.
6. **PASS.**
   - **Setup:** B branched at 1560 (00:13:00, before A's closure) with the **B** key, so B closes the Main Bridge. I then started compare and ran to 2446.
   - **Rows:** "Crossings · North / Main / Old Bridge" read A 102 / 159 / 94 and B 181 / 31 / 125, with Δ +79 ▲, −128 ▼ and +31 ▲.
     - These equal the two-direction sums of `comparison().crossings` (a = [78,24,118,41,70,24], b = [132,49,27,4,85,40]).
     - `baseTick` = `fromTick` = 1560.
   - **Other rows:** Generated is 2752 = 2752. Completed, Incomplete (1743 / 1763), Unserved, Mean trip and p95 trip are shown.
   - **Summary:** hidden while comparing.
   - **Timeline markers:** "A: Closed Main Bridge at 00:15:19" (✕A, +0.85 px from its tick) and "B: Closed Main Bridge at 00:13:00" (✕B, `at-start`, inside the track).
   - **Map:** 3 bridge labels and 3 pins on each half, 0 pin overlaps, 0 panel overlaps. The comparison panel has no forbidden words.
   - No page errors and no console errors.

The 1280×720 run gave the same results: every step passed, with 0 pin-to-label and 0 panel overlaps.

**Pass criteria**
- **All four Scope questions can be answered from what is shown, with numbers that match the hooks.** PASS.
- **No causal wording; markers are glyph plus text plus accessible name.** PASS.
- **All suites green.** PASS, apart from the load-dependent case in m-1.

## Findings

### BLOCKER / MAJOR
None.

### Minor
- **m-1 (verified test gap, not a product defect): frozen test 9's "queue pins on A > 0" depends on the data.**
  - **What failed:** in the first run, `compare_shows_crossings_since_branch` failed at line 253 with 0 received. A is the open scenario there.
  - **Probe:** `probe_apins2.mjs` repeats test 9's setup and samples about 600 rAF-spaced instants while comparing. A's pin layer was empty in 24 of 599 samples, and in **every one of them A's maximum `linkQueued` was < 3**. So the pins correctly follow `topQueues(linkQueued, 3, 3)`: an open A sometimes has no queue of 3 or more at the paused instant (about 4 %).
  - **Rerun:** the same test passed 3 of 3 times.
  - **Remedy:** none in the product. The frozen test cannot be changed without the user. Record it as a known flake of test 9 (for the epic gate).
- **m-2 (product, cosmetic): a queue pin can sit fully under a panel at 1280×720.**
  - **Where:** the pin of a queue at the Old Bridge's south approach (links 8 and 6). It takes the "below" places (+4 px, +22 px) when the places above are taken, and lands under the Legend.
  - **Reproduction:** `probe_cover2.mjs`, River City, Main Bridge closed at 20×, 1280×720.
    - At tick 2685 the pin "▼ 3" of link 8 is at y 622–638 and x 592–619, completely under the Legend panel (`cover720-legend.png`). The summary does list "Link 8 · 3 queued".
    - Over a 672-sample run, a pin was covered by the Legend in 71 samples, by the metrics strip in 3, and by the Intervention panel in 1.
    - At 1280×800 only 3 partial (27×9 px) metrics-strip overlaps occurred.
  - **Cause:** `clearPins` only avoids labels and pins of its own layer, not panels.
  - **Coverage:** test 10 checks only that pins stay inside their layer.
  - **Suggestion:** include the visible `section.panel` rectangles in `taken`, or document it.
- **m-3 (doc gap): the start-of-window shift is undocumented.**
  - `.at-start` (frac < 0.02) puts the glyph about 8 px right of its tick. The compare run measured B's marker at +8.13 px.
  - Red r5 approved this deliberately, so the marker stays in the track.
  - `docs/known-issues.md` now documents the head overhang but not this start shift. Only a CSS comment mentions it.
  - Add one line to the known issues.

### Observations
- **o-1: the hooks can lead the DOM by one frame while running.** At 20× the `snapshot().linkQueued` hook and the DOM pins differed in 4–5 of ~600 running samples (for example `want ▼92` while `got ▼56`). The frame ref updates before React re-renders. Paused, they always agree, and the frozen tests read them paused. Harmless.
- **o-2: "now" right after a closure is mostly pre-closure traffic.** At 00:15:50, half a minute after the closure, the Main Bridge row read now 498 / before 493, "+5 ▲", because the "now" 10-minute window still covers mostly pre-closure time. This is exactly the spec'd definition, and the row tooltip gives the measured span. It may surprise a viewer in the first minutes.
- **o-3: the invariants hold.**
  - **sim-core:** the change adds only the read-only `Timeline::exits_at`. There is no new World state, and the Rust test checks `state_hash` and seek equivalence.
  - **sim-wasm:** the change adds only the getters `command_log` and `exits_at`, and guards unknown links and NaN or negative ticks.
  - **Per-frame data:** frames carry two small `Float64Array`s, with no JSON and no per-vehicle calls.
  - **Branch base:** it is read once when the branch is made and reset on every scenario reset.
  - **Consumers:** every new protocol field has one. `interventions`, `bridgeFlow` and `crossings` reach the UI and hooks. `nowSpanS` and `beforeSpanS` reach the row tooltip.
  - **Identical demand:** Generated is equal in A and B.

## Git state
- **Working tree:** after the review, `git status --short` lists only the pre-existing `web/zz-alt-port*.config.ts` and this file. No tracked file was modified.
- **Processes:** my dev server (5287) and browsers are stopped.
- **Ports:** I used 5231 and 5194 for the Playwright configs, never 4243 or 5391.
- **Scratch:** scripts and screenshots are in the reviewer's scratch directory (`.../scratchpad/g4/`).
