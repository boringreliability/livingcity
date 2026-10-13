# motion-003 Gold gate, round 3: REJECTED

Reviewer: a fresh adversarial implementation-review subagent. Scope: the fix commit c4f4cc5 (`git show c4f4cc5`) on top of 01d7bc6. HEAD moved to fae9cab during the review (Red r5 approved `web/e2e/motion003_gold.spec.ts`; no source change). Context: `motion-003-gold-1.md`, `motion-003-gold-2.md`, the ward spec and CLAUDE.md.

## Verdict: REJECTED (0 BLOCKER, 1 MAJOR, 1 minor, 1 observation)

- **r2 MAJOR-1 (queue pins covering labels) is fixed.** No overlap was found in the single view or in compare, while running or paused. That covers ≈ 3 400 rAF-synchronised samples, 1 290 dense replay positions, and the frozen regression spec.
- **New MAJOR:** the m-c fix (`.at-end`) moves a marker near the window's end off its tick. The **frozen** `web/e2e/motion003.spec.ts › intervention_summary_and_map_markers` now fails deterministically (4 of 4 runs): "reopen marker at its tick", 5.83 px against ≤ 2.

## Frozen tests (verified)
- sha256:
  - `web/e2e/motion003.spec.ts` = 9b9ca968…095e;
  - `web/tests/motion003.test.ts` = 4ea646df…bee4f;
  - `crates/sim-core/tests/motion_003_consequences.rs` = 26d2388b…7b87.

  All three are unchanged.
- `web/e2e/motion003_gold.spec.ts` was b700640e…4cbf at c4f4cc5 and is **aad8d334…b89a at fae9cab**: the parallel Red r5 changed and approved it. I ran the committed fae9cab version.
- `git diff --stat 34d6a55 HEAD -- web/e2e web/tests crates/*/tests` lists only `web/e2e/motion003_gold.spec.ts` (+201). No other test file has changed.
- c4f4cc5..fae9cab contains no change under `web/src`, `crates` or `docs`.

## Commands and results
| Command | Result |
|---|---|
| `pnpm -C web build:wasm` | exit 0 |
| `pnpm -C web build` | exit 0 |
| `pnpm -C web test` | 31 files, **156 passed, 7 skipped**, exit 0 (300 s) |
| `cargo test --workspace` | **173 passed, 0 failed, 9 ignored**, exit 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |
| `playwright -c zz-alt-port2.config.ts motion003 motion003_gold layout look a11y guide` | **38 passed, 1 failed**: `motion003.spec.ts:62 intervention_summary_and_map_markers`, "reopen marker at its tick", received 5.823 (10.6 min; load 15.5 at start, 29.5 at end) |
| Rerun of that test, `--repeat-each 3` | **3 of 3 failed**, received 5.8257 each time. That is deterministic, not timing (load 18.6 → 16.1). |
| `playwright … compare gold_polish002 timeline acceptance inspect motion002` | **41 passed** (11.2 min; load 13.7 → 27.8) |
| `playwright … motion003_gold` at fae9cab | **3 passed** (4.1 min; load 18.0 → 28.9) |

**Note: the worktree is shared.** Between 05:00 and 05:14:41 the parallel Red reviewer repeatedly mutated `web/src/App.tsx`. My Vite log shows ten `hmr update /src/App.tsx` events. One of my early probe runs was hot-patched in that window and showed pins over labels. I **discarded every probe run that started before 05:14:41**. All results below are from after the last mutation. `git status` shows `App.tsx` equal to HEAD, and no further HMR events occurred.

## r2 MAJOR-1 re-check: fixed
The probes were Playwright scripts on my own dev server (port 5287, 1280×800, SwiftShader). Each sample checks every shown `.queue-pin` against every shown `.zone`, `.bridge-label` and other pin on its layer (area > 0.5 px in both axes). Every probe also replicated `clearPins`' 16-place search on the live geometry and counted pins forced into the "least covered" fallback.

**Single view**
| Probe | Samples | Overlaps |
|---|---|---|
| Closed at 1830, dense paused sweep (1 click per track px, 426 positions over 0–6003) | 426 | **0** |
| Closed at 2130, dense paused sweep (426 positions) | 426 | **0** |
| Closed at 1831, rAF sampling while running to 4800, with replication | 970 | **0** overlaps, **0** forced fallbacks, **0** mismatches between the replicated choice and the real transform |
| Closed after warm-up, 14 × 150 rAF samples while running, then a 97-position sweep to head 11 449 (load ≈ 25–40) | 2 391 samples, 7 075 pins | **0** |

**Compare (the r2 case)**
- Setup: A closes the Main Bridge at about 2240, runs to 3000, then rewinds to 1802. B branches there and closes the Main Bridge. Then compare, run to head 8138.
- 1 200 rAF samples while running gave 7 136 pins and **0** overlaps. A 54-position sweep gave **0**.
- Screenshot `g3-compare-end.png` shows ▼53, ▼65 and ▼60 on A, and ▼65 ▼53 side by side and ▼80 on B, all clear of "North Bridge", "Old Exchange" and "Old Bridge".

**Spec.** The frozen `motion003_gold.spec.ts` (3 tests, including A-closed compare) passed.

## Manual Smoke Test
Screenshots are in the reviewer's scratch directory (`g3-smoke1/3/4/5/6.png`, `g3-compare-end.png`).

1. **PASS.** The Main Bridge was closed at tick 1832 at 20× and the sim run to 3655 (15.2 sim min).
   - Summary: "✕ Closed Main Bridge · 00:15:16".
   - The ✕ marker centre is 619.6, and the expected x is 619.6.
   - North, Main and Old Bridge labels are shown.
   - The pins ▼66 / ▼30 / ▼25 on links 110 / 131 / 6 equal `queuePins()`.
2. **PASS.** Crossings per 10 min, now / before / change:

   | Bridge | now | before | change |
   |---|---|---|---|
   | North Bridge | 394 | 43 | +351 ▲ |
   | Main Bridge | 0 | 493 | −493 ▼ |
   | Old Bridge | 207 | 64 | +143 ▲ |

   - The hook gives 393.94 / 43, 0 / 493 and 206.53 / 64.
   - The caption reads "(observed): now and before the bridge closure at 00:15:16".
3. **PASS.** Clicking "Link 110 · 66 queued" gives `selectedLink` 110, and the panel shows "queued 66".
4. **PASS, but the marker is off its tick (MAJOR-1 below).**
   - The summary shows "○ Reopened Main Bridge", and the hook has two entries in tick order.
   - The ○ marker has class `at-end`. Its centre is **831.1 against an expected 836.9** (5.8 px).
5. **PASS.**
   - After Jump to start, `interventions()` and `crossings()` are [].
   - Both markers stay in place: 619.5 and 831.1.
6. **PASS.** Branch at 1560 (13:00) with B closing the Main Bridge, then compare and run to 18:02.

   | Row | A | B | Δ |
   |---|---|---|---|
   | Crossings · North Bridge | 21 | 92 | +71 ▲ |
   | Crossings · Main Bridge | 155 | 31 | −124 ▼ |
   | Crossings · Old Bridge | 43 | 76 | +33 ▲ |

   - These equal the two-direction sums of `comparison().crossings`: a = [18,3,114,41,35,8], b = [64,28,27,4,50,26].
   - Generated is 1830 = 1830.
   - Incomplete (1507 / 1516) and Unserved are shown.
   - The markers are "A: Closed Main Bridge at 00:15:16" and "B: Closed Main Bridge at 00:13:00". The B marker is `at-start` and inside the track.
   - The crossing row headers no longer wrap.

## Findings

### MAJOR-1 (new, regression of a frozen test): `.at-end` moves a marker off its tick
- **Code.**
  - `TimelineBar.tsx` adds `at-end` when `frac(e.tick) > 0.98`.
  - `styles.css` maps `.timeline-intervention.at-end` to `transform: translateX(-100%)` instead of `-50%`. The marker's centre therefore sits half its width (≈ 4.8–5.8 px) **left of its tick**.
  - `at-start` similarly puts the glyph's centre about 7 px right of the tick.
- **Effect.**
  - Right after an intervention, its marker is at the head (frac ≈ 1). It is therefore drawn before its time, and before the head by up to 2 % of the window.
  - The frozen `motion003.spec.ts:62` pins the requirement "a ○ marker at its tick" (≤ 2 px) and now fails every time: 5.823 / 5.8257 / 5.8257 / 5.8257.
  - The ward's own pass criterion, "all suites green", is not met.
  - The deviation is not in the ward or `docs/known-issues.md`.
- **Fix direction.** The frozen test needs a marker centred on its tick at the head. The approved gold spec needs B's branch-tick marker inside the track at the start. Options:
  - keep `at-start` (no frozen test covers the start), and drop `at-end` or keep the end overhang;
  - give the track's lower lane room for half a glyph at the right end;
  - clamp the shift so that the ○/✕ glyph itself stays at the tick and only the A/B letter moves.

  Then rerun the full motion003 spec. Do not touch the frozen test.

### Minor
- **m-1 (observation, not blocking): pins can sit up to 31 px from their stop line.** The far diagonal places use a 22 px gap; maxDetach was 22 px in the single view and 31.1 px in compare. No mis-attribution showed in the screenshots, but at a dense junction a far pin may read as belonging to a neighbouring link. Consider preferring places along the link's own direction, or documenting it.

### r2 minors
| Minor | Status |
|---|---|
| m-a: m1 (markers inside the slider) and m3 (reserved guide band) | Recorded as known issues in `docs/known-issues.md` (deferred). Accepted. |
| m-a: m6 (crossing row headers wrap) | Fixed with `white-space: nowrap`. The headers are on one line at 1280 px. |
| m-b (A/B markers run together) | Recorded as a known issue. Accepted. |
| m-c (start marker overhangs the track) | Fixed for the start, but the end variant causes MAJOR-1. |
| m-d (docs) | Done. `docs/demo.md` names "✕B"/"✕A", and the ward's pin sentence states the 16 places and the least-covered fallback. |

### Checked, no finding
- **Performance of `placeMarks`.** It runs every rAF and after every React render. Measured with an instrumented `getBoundingClientRect`, 3 pins, Main Bridge closed, 20×, at load ≈ 16–28 under SwiftShader:

  | Demand | Calls/s | Time in `getBoundingClientRect` | Paused |
  |---|---|---|---|
  | 1 | 3 208 | 15.2 ms/s | 799 calls/s, 1.4 ms/s |
  | 3 | 2 864 | 14.7 ms/s | — |
  | 5 | 2 941 | 13.4 ms/s | — |

  - That is ≈ 1.5 % of the main thread, independent of demand: the DOM marks do not scale with vehicles.
  - The rAF interval (66–117 ms) here is bound by the SwiftShader GL draw on a loaded machine, not by placement.
  - The layout thrash is real (a write and read per candidate place) but bounded: ≤ 16 places × ≤ 3 pins per layer.
  - No concern.
- **Determinism and invariants.** The change is UI-only. There is no Rust or worker change, and identical demand holds (Generated equal).
- **Wording and colour.** No causal wording. Markers use a glyph plus a letter plus an accessible name.

## Git state
After the review, `git status --short` lists the pre-existing `web/zz-alt-port*.config.ts` and this file. My dev server (5287) and browsers are stopped. Probe scripts and screenshots are in the reviewer's scratch directory.
