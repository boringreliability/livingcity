# motion-005 S10 Red review r2

**Verdict: APPROVED**

What I reviewed (working tree against HEAD c4f8408):
- `web/e2e/motion005.spec.ts`;
- `.wdd/memory/supersessions.md` row S10;
- `.wdd/memory/authorization-2026-10-14-s10-queue-release.md`, which records both of the user's answers. The second answer chose A2;
- `.wdd/reviews/motion-005-s10-red-1.md`;
- `.wdd/wards/motion/ward-005.md:106`.

## 1. Identity and the frozen test
- `scratchpad/s10_ident.py` reports `identical up to release: True 2690 2690` and `frozen body unchanged: True`.
  - The replacement's body is byte-identical to the frozen test's body up to `// release`.
  - The frozen test is unchanged apart from `test(` → `test.skip(` and the comment above it.
- `git show HEAD:web/e2e/motion005.spec.ts | shasum -a 256` gives `2589ddf4…2d18d`, which matches the S10 row.
- The pre-closure sampling block that r1 MAJOR 2 found has been removed.
- `tsc -p web/tsconfig.json --noEmit` exits 0. That tsconfig includes `e2e`.

## 2. The A2 oracle against the r1 mutants
How I ran it: `s10red/r2run.sh <variant> <log> <n>`. The script copies the **current** spec into the isolated copy, checks the copy with `cmp`, runs `-g s10` and writes a JSON report with the attachments. `r2ext.py` extracts the results. The `src/` trees: base is identical to the worktree, and each mutant differs from base only in `host.ts`. The spec is not instrumented: the numbers below come from the test's own `attachJson` output.

| Variant | Runs | Result | Where it failed |
|---|---|---|---|
| base, 3 copies in parallel (load) | 3 | 2 pass, 1 fail | The failure is the unchanged pre-release check `20×: frames with queued cars` (8 < 15) |
| base, alone | 4 | **4 pass** | - |
| **uilie** (the sim keeps the bridge closed, the UI says it is open) | 3 | **3 fail** | All 3 at `Main Bridge link 284 carries cars again` (`flow.mainMax = [0,0]`) |
| **halfopen** (only one direction reopens) | 3 | **3 fail** | All 3 at `Main Bridge link 285 carries cars again` (`mainMax = [27–29, 0]`) |

- Base reached the release oracle in 6 of 6 runs and passed it in all 6:
  - `flow.mainMax` was [25–30, 6] on the two bridge links;
  - before → after means: 8.0→2.0, 12.5→1.6, 7.7→2.2, 5.9→0.7, 5.6→0.6, 5.9→0.8;
  - n = 60–61 per 2-minute window and 150 in the flow window;
  - every window reached its full sim span.
- Both mutants now fail **at the release oracle**. r1 BLOCKER 1 is resolved: a reopen that does not reopen (fully or in one direction) is caught by a structural signal the sim cannot fake.

## 3. Vacuity and flakiness
- **The `linkCounts > 0 within 5 sim min` check is robust.**
  - With the bridge closed it is exactly 0 on both links (all 6 mutant runs, and every `before.mainMax`).
  - After a real reopen it reaches ≥ 6 on the weaker link and ≥ 25 on the stronger one, every time.
  - It uses the max over 150 samples, so one sample is enough. That is the right statistic for "carries cars again".
- **The wall caps are less demanding than the frozen test.**
  - The windows need an effective sim rate of ≥ 2× (120 sim s within the 60 s cap) and ≥ 5× (300 sim s within 60 s).
  - The frozen test needed 900 sim s within its 120 s poll budget, about 7.5×.
  - Locally each window took about 6 s or 15 s of wall time, under 3-way load as well.
  - If a runner is slower than that, the span assertions fail loudly with a clear message. They never pass silently.
- **The check `after.mean ≤ before.mean + 2` is not trivially true, but it does not discriminate much (minor 1).**
  - In base it held with a wide margin (after ≤ 2.2 against before ≥ 5.6).
  - With the bridge still closed (the uilie flow means 6.5, 6.7 and 0.8, against before 7.5, 9.4 and 6.2) it would also pass.
  - So it guards only against "the reopen makes the queues grow", which is exactly what the user chose (A2: "køen vokser ikke"). The bridge check carries the release.

## Findings

### minor 1: the queue-growth guard is loose compared with the measured margin
Base after/before is ≤ 0.4 in all 6 runs, so a guard of `after.mean < before.mean` would also have held. The +2 is what the user approved, so this is not a reason to reject. It is noted for the epic gate as "release is shown by bridge flow, the queue term is a non-growth guard".

### minor 2: nothing guards the case where `pinLinks` is empty
- `queuePins()` returns only links with ≥ 3 queued at that instant (`topQueues`, `min = 3`), read after the 20× observation, which the spec itself says can drain the queue.
- If the list is empty, both means are 0 and the queue term passes trivially. The bridge term still holds.
- It did not happen in any of the 12 runs (before means 5.6–12.5).
- Suggested fix: fall back to `pin.link` when `pinLinks` is empty, or assert `pinLinks.length ≥ 1`. That is optional.

### minor 3: the wall caps could be roomier
- The test budget is 420 s, and the pre-release part plus the three windows use at most about 120 + 20 + 180 s.
- A 60 s cap per window means a runner below 5× effective at "20×" fails on the flow window.
- That is still more lenient than the frozen test, so this is not a regression. Optional fix: raise the caps to 90–120 s.

### Observation (out of S10 scope, carried over from r1)
- The unchanged pre-release assertion `20×: frames with queued cars ≥ 15` failed again under 3-way parallel load (8 < 15): 1 of 3 parallel base runs, and 0 of 4 runs alone.
- The S10 authorization cannot change it. It must go to the epic gate as a CI flake risk for this test (or to the user separately).

## Residual r1 findings
| r1 finding | Status |
|---|---|
| BLOCKER 1 (vacuous oracle) | Resolved (see section 2) |
| MAJOR 1 (formula looser than approved) | Moot: the user chose A2 in a second, recorded answer, and the code implements A2 as stated |
| MAJOR 2 (not identical before the release) | Resolved (identity checker) |
| minor 1 (ward spec does not list S10) | Resolved (`ward-005.md:106`) |
| minor 2 (redundant guard) | Gone |
| minor 3 (max baseline, pins re-read) | Resolved: mean baseline, and `pinLinks` is read once |

The S10 row, the `SUPERSEDED` comment and the authorization note now describe the code accurately.

What the replacement drops is acknowledged in the authorization record, which this review cannot check against the user directly:
- the frozen test's `q0 > 0`;
- A's "≥ 10 queued at the reopen".

A2 replaced both, and the record shows the user saw the trade-off ("rerouting dissolves the closure's queue before the reopen").

Evidence: `scratchpad/s10red/r2base.{log,json}`, `r2base2.{log,json}`, `r2uilie.{log,json}`, `r2half.{log,json}`, and the scripts `r2run.sh`, `r2par.sh` and `r2ext.py`.
