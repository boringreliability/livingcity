# motion-005 Red gate, round 3

**Verdict: REJECTED** (0 blocker, 1 major, 4 minor)

Reviewer: a fresh adversarial Red reviewer (subagent), 2026-10-13. Commit under review: 02ff690 (fixes in `git diff ec088cf 02ff690`).

## Hashes verified (sha256, worktree = 02ff690, clean)
- `web/tests/motion005.test.ts` `e7d3031affb29dc5f5a4fe8dc0320e985f1c3b16b70fab6ee6c04853b044af00`: matches.
- `web/e2e/motion005.spec.ts` `ae614d1a59e58c95644d0d984ef9f0680c27e4ac2db3227b5ec634421efe3cd1`: matches. I copied it into all 13 r1 trees (all now `ae614d1a…`).
- `git diff 80d529c 02ff690 -- web/src crates web/playwright.config.ts` is empty, so the r1 trees are still valid bases. `diff -r` of each tree's `src` against the worktree shows exactly one mutation per tree.

## Commands and results
- `pnpm -C web exec vitest run tests/motion005.test.ts`: 2 failed, as the spec predicts.
  - Test 7 fails with ENOENT on `docs/verification/motion-005.md`.
  - Test 8 fails because `web/perf-results/motion-epic-before-after.json` is missing.
- **Baseline e2e** (`m5red1/base`, port 5401, full spec, 3 lanes, load 15 → 33): **9/9 passed** (3.0 min).
- **Flow 5 on trees that are correct for flow 5** (`base`; `mF` only touches B's clock in compare; `mD2` only touches the intervention summary). The official spec ran in 3 lanes, twice per tree, at load 16 → 33.
  - First runs: 3/3 passed.
  - Second runs (load ≈ 30–33): **3/3 FAILED at 20×** with "20× running seek: samples: expected ≥ 10, received 7 / 9 / 7".
  - Earlier, in the same conditions, the official **switch** check also failed on correct switching code. The diagnostic copy on `base` gave "1× switch to A: samples 7". On `mS` it gave "7" at 1× and "9" at 20× (mS does not change frame delivery). `mA` gave "9" at 1×. See MAJOR 1.
- Scripts and logs: `/private/tmp/claude-502/…/scratchpad/m5red3/` (`setup.sh`, `mk2.sh`, `run.sh`, `all.sh`, `all2.sh`, `mkzz.sh`, `zz.sh`, `zz2.sh`, `zzA.sh`, `flake.sh`, `*.log`).
  - One scratch-infrastructure flake: the trees share `node_modules/.vite` through a symlink, so the first `mG2` run died on a Vite deps-rename race.
  - That is not a finding about the tests. I reran it as `mG2b`.

## Mutation table (current spec in every tree)
| id | mutation | flows run | result |
|---|---|---|---|
| mA | presentation off (P = newest frame) | 1, 4, 5 × both | **Caught at 1×**: flow 1 ("6.33 m in 33 ms", bound 5.02) and flow 4 ("13.25 m in 67 ms"). Flow 5 at 1× failed only on the switch sample count (MAJOR 1): **the on-B motion check passed in this run** (load ≈ 35). In two dedicated reruns at load 15–20 the on-B check caught it ("7.53 m / 19.68 m in 33 ms"); see minor 1. Not caught at 20×, as documented. |
| mX | running ahead / extrapolation | 1, 4, 5 × both | **Caught 6/6** |
| mB | paused frames posted again | 4 × both | **Caught 2/2** (101 and 99 frames while paused) |
| mC | held cars past the stop line | 2 | **Caught** (1×) |
| mD1 | closure ring fragment discarded | 3 | **Caught** ("the ring on link 284 is drawn: 0") |
| mD2 | close entries missing from interventions | 3 | **Caught** |
| mE | old frames kept across a seek | 5 × both | **Caught 2/2**, at 1× too ("running seek: cars on their records' links: 0") |
| mE2 | no reset on seek | 5 × both | **Caught 2/2** ("no tick from before the seek is shown") |
| mF | separate clock for B | 6 | **Caught** ("one presentation time 0.35") |
| mG2 | B's presenter advances, B's renderer never uploads poses | 6 | **Caught** in the rerun ("cars drawn on B (0 car pixels)"): r2 MAJOR 1 fixed |
| mH | presentation frozen after the 2nd reset | 1 (1×), 5 × both, 6 | Flow 1 passed (expected: no seek). **Caught**: flow 5 at 1× ("the followed car moves on B"), flow 5 at 20× ("537 m"), and flow 6 ("B's cars move: 0.09", newly through B's pixels) |
| **mGB** (new) | B's renderer uploads poses once (a frozen picture) while B's presenter and `tickB` keep advancing | 6 | **Caught** ("1×: B's cars move: 0.038 < 0.3") |
| **mGA** (new) | B's renderer is given A's presenter | 6 | **Caught**, indirectly: B's presenter never advances ("one presentation time: 0") |
| **mGA2** (new, two edits) | as mGA, plus B's presenter is still advanced: B's map shows **A's traffic**, and `tickB` advances in step | 6 | **NOT caught: passed** (minor 3) |
| **mS** (new) | the presenter resets only on world/compare/tick-back; scenario and epoch are ignored | 5 × both | **NOT caught: passed.** Also passed a diagnostic forward switch (A → B, B ahead) at both speeds: `viewScenario` pauses, and the paused clock puts P on the newest frame, so no stale motion becomes visible. This is a weak check, not a missed visible defect (minor 2). |

## r2 findings: status
- **MAJOR 1** (B's map never checked): **fixed.** B's pixels are counted and compared. mG2, mGB and mH are caught through them. The mask is specific: 0 car pixels when B draws no cars.
- **minor 1** (flow 2's absolute frame floor): **fixed.** Sampling now runs until ≥ 15 frames with queued cars, bounded at 10 s. Flow 2 passed at load ≈ 30.
- **minor 2** (scenario change with a full history): **addressed in form only**; see minor 2 below.
- **minor 3** (`startedAt`, hardware metrics): **fixed** in test 8 and in the schema.
- **minor 4** (the Red-phase "at 1×" qualifier): **fixed.**

## On the +17 ms in the motion bound
- **Justified.**
  - The app's loop presents at its own rAF timestamp (`renderer.advance(now)`, App.tsx:779).
  - The sampler's callback can run before the app's within a frame. One sample step can then hold the presentation advance of the app's *previous* interval.
  - The sampler now also uses rAF timestamps instead of `performance.now()`, which removes the "1 ms" artefact.
- **Cost.** It adds a constant 1 m to the 1× bound: 4.0 m at 60 Hz, 5.0 m at 33 ms, 6.0 m at 50 ms.
  - mA's jump equals one record step: v · 0.5 s. In my diagnostics the record steps were 2.6–7.5 m (zzA-1: `[7.53, 4.5, 3.22, 5.84]`; zzA-2: `[3.29, 19.68, 2.62, 2.62, 2.62, 4.26]`).
  - So whether the jump is caught depends on the car's speed and on the frame cadence.
  - With +17, a 6.9 m step (50 km/h) is caught only while sample intervals stay below ≈ 65 ms; without it, below ≈ 82 ms.
- **Conclusion.** It does not break detection in flows 1 and 4 (caught in every round). It does make flow 5's on-B catch probabilistic: it escaped once in this round. See minor 1.

## Findings

### MAJOR 1: fixed 1.5 s windows with "≥ 10 samples" fail a correct implementation under the load the gates run at
- **Evidence.** The code under test was correct for flow 5 in every case below.
  - The official spec, flow 5, on `base`, `mF` and `mD2`, at load ≈ 30–33: **3 of 6 runs failed** at 20× with "running seek: samples: expected ≥ 10, received 7 / 9 / 7".
  - The new switch check failed the same way on correct switching code: "1× switch to A: samples 7" (`base`, diagnostic copy, identical up to that line), "7" and "9" (`mS`, which does not touch frame delivery), and "9" (`mA`).
  - The baseline full run at load 15–33 passed. So this is load-dependent, and it is the same mechanism as r2 minor 1.
- **Why the window is too tight.** The spec itself says SwiftShader draws ≈ 10 frames per second at load (test 4). The checks need ≥ 10 samples **after** the event inside a 1.5 s window that starts *before* the click. The seek or switch latency eats part of the window, and the switch check also drops its first A sample.
- **Why this is MAJOR, not minor.** The tests are frozen at Red approval. A correct Gold implementation would then fail its gate about every other run at load ≈ 30, and the only cure would be a supersession. r2 minor 1 fixed exactly this pattern for flow 2 but left it in flow 5.
- **Fix.** For all three windows in test 5 (running seek, paused seek, switch), sample until **both** hold, bounded at 10 s:
  - ≥ 1.5 s have passed since the event's first post-event sample;
  - ≥ 10 post-event samples exist (≥ 11 for the switch, because it drops one).

  Keep every assertion as it is. Optionally record the sample count in the attachment.

### minor 1: the "junction jump at 1×" catch on B (test 5) is probabilistic; the spec's 20× number is stale
- **Evidence.** In the lane run, mA passed the on-B `checkTracked` at 1×. Flow 5 then failed only on MAJOR 1's sample count. Dedicated reruns caught it with fast cars (7.53 m and 19.68 m in 33 ms), while most of mA's jumps (2.6–4.5 m) were within the bound.
- **Stale text.** The spec says "At 20× the bound (≈ 22 m per frame)". With +17 it is ≈ 42 m at 60 Hz, and the observed bound was 102 m at 67 ms.
- **Fix.**
  - Correct the 20× number.
  - Optionally add a load-independent oracle for "presentation on" at both speeds. On the running samples in tests 1, 4 and 5, `diagnostics().presentation.tickA` must be non-integer on ≥ 50 % of the frames while running. With mA, P is always a frame record's tick.

### minor 2: the "scenario switch while running" lands on a paused A, and the reset it is meant to check cannot be isolated
- **How the switch behaves.**
  - `host.viewScenario` calls `clock.setRunning(false)` (host.ts:541). A is shown paused: `onA` samples had a constant tick, with `presA` equal to it (for example `[1824, 1824] × 30+`).
  - A's tick (1824 / 1896 / 2027) is always **behind** B's (1831 / 1903 / 2170), so the tick-back rule resets the presenter anyway.
- **Result.** mS (scenario and epoch ignored in `Presenter.push`) passes. It also passes a forward switch A → B, because the pause puts P on the newest frame.
- **Why only minor.** The product cannot show the defect today: every switch pauses.
- **Fix.**
  - Describe it honestly in the ward spec ("a switch from a running B; the host pauses; the presentation stands on A's frame"). The real requirement is "the presentation stands on the new scenario's frame".
  - Assert `presA === tick` on every A sample after the first, like the paused seek. That is stronger than the current `≥ floor`, `≤ tick`, monotone rules.

### minor 3: B's map can show A's traffic and test 6 still passes (mGA2)
- **What passes.** With B's renderer bound to A's presenter, and B's presenter still advanced (two edits), all of test 6 passes:
  - `tickB` advances and equals `tickA`;
  - B's pixels move (A's cars);
  - `sides.b.closed` comes from B's frame.

  The decision (B reopened the bridge) is then visible only in data, not on B's map.
- **Why only minor.** A single-edit variant (mGA) is caught through `tickB`, so the two-edit variant is less likely as a regression.
- **Fix (optional).** At 20×, at the end of the window, require car pixels on B within the screen area of the central links (`linkScreenPoint` of the main bridge, ± a few px), and none on A there. A kept the closure for ≥ 600 ticks, so its bridge is empty, while B's reopened bridge carries cars after 60 sim s.

### minor 4: the Red-phase text on mE at 1× is outdated
- The ward spec says "mE … caught by the running seek at 20×. At 1× it passed".
- r2 caught it 4/4, and this round 2/2, at 1× too ("cars on their records' links: 0").
- **Fix:** say "caught at both speeds in r2/r3; whether it shows at 1× depends on the seek latency".

## What is good
- r2 MAJOR 1 is fixed with a real observable. B's pixel mask is specific (0 car pixels when B draws none) and sensitive (a frozen B gives 3.8 % changed against the 30 % required). It also catches mH on B.
- 15 of 17 mutations are caught. Of the two that pass, one is invisible in the product (mS) and the other needs two coordinated edits (mGA2).
- The test 8 schema now pins the timing and the hardware metrics.
- Flows 1–4 and 6 were stable at load 15–40.
