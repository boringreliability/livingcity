# motion-005: legend regression test, Red review r1

**Verdict: APPROVED** (no BLOCKER and no MAJOR findings; 4 minor findings below)

- **Reviewer:** a fresh adversarial Red subagent, 2026-10-14.
- **Artifacts:**
  - `web/e2e/motion005_legend.spec.ts` (uncommitted; sha256 `6db415cc…0833d`);
  - `git diff HEAD -- web/src/ui/bottomBand.ts web/src/App.tsx`;
  - `.wdd/reviews/motion-005-gold-2.md` MAJOR 1;
  - frozen `web/e2e/fonts.spec.ts`.

## Method
- **No file swaps in the worktree.** Another session was running e2e in this worktree on port 5190 with the fixed files. Swapping the files in place would have hot-reloaded those files under that run.
- **Isolated copies instead.** Every variant ran in an isolated copy of `web/` in the scratchpad:
  - each copy used rsync without `node_modules`, plus a symlink to the real `node_modules`;
  - each copy had its own port (5197–5207);
  - each copy's Vite config got `server.fs.allow` for the real `node_modules`, so that the bundled fonts load.
- **The worktree itself was never modified.**
- **Scripts:** `scratchpad/{setup,fixvite,addlog,mutants,runmut,cilike}.sh`.
- **Logging in the copies:** the copied spec gets `console.log` lines for the base band and each target.

| Variant | `motion005_legend.spec` | frozen `fonts.spec` (5 tests) |
|---|---|---|
| HEAD `bottomBand.ts` + `App.tsx` (hysteresis 12/24) | **FAIL**: "gap 12.5 px: the legend is beside the metrics again" (stacked, offset 62 px) | 5/5 pass |
| Fix (working tree) | PASS (base gap 26.58; targets 12.5/15/19/23 all beside) | 5/5 pass |
| Fix, `--repeat-each=6` (under concurrent load from the other session's run) | 6/6 pass, about 6.7 s each | – |
| Mutant "never stacks" | FAIL ("stacked above the metrics before trying gap 12.5") | 4 fail |
| Mutant: small hysteresis (stack < 12, unstack ≥ 13) | **FAIL** at 12.5 (legend y 638–688, CI's rectangle) | 5/5 pass |
| Mutant: ResizeObserver removed | FAIL | 1 fail (3b) |
| Mutant: ResizeObserver on the legend only, not the metrics | **FAIL** | 5/5 pass |
| Mutant: window `resize` listener removed | pass | 2 fail (4, 5) |
| CI-like font metrics (metrics `padding-right: 19.6px`, base gap 18.98 px), fix | PASS (12.5 and 15 run; 19 and 23 skipped) | 5/5 pass |
| CI-like font metrics, HEAD | **FAIL** at 12.5 | **5/5 pass**: the frozen suite does not see the CI defect |

**What the table shows:**
- The test fails on HEAD for the right reason and passes on the fix, both at the local gap (26.6) and at a CI-like gap (19.0).
- It catches three regressions that the frozen `fonts.spec` lets through: the CI defect itself, a residual small hysteresis, and a missing metrics observer.
- A fix that never stacks fails, both in the loop (the "stacked" precondition) and in the final gap < 12 check.

## The specific questions
- **Vacuous or tautological?** No.
  - Every placement is asserted on measured rectangles.
  - The gap actually reached is asserted (≥ 12), not assumed.
  - The stacked precondition before each target proves that the hysteresis path is really entered.
- **Same code path as real content changes?** Yes.
  - `min-width` with `border-box` changes the metrics panel's box, so the ResizeObserver fires and `check()` runs. A wider font or a wider value takes the same route.
  - The `nometricsro` and `noro` mutants confirm that the test depends on that observer.
  - The width is read once, before any override, while the sim is paused, so the values cannot drift.
- **Robustness across machines.**
  - The test requires `base.gap ≥ 14`, so 12.5 always runs. 12.5 is the target that discriminates any hysteresis ≥ 12.5.
  - The `continue` only drops targets above the base gap, which cannot be reached by narrowing.
  - Verified at gap 18.98, where the 19 and 23 targets are skipped and the result is still correct.
  - A machine with a base gap between 12 and 14 fails the precondition loudly instead of passing silently. That is acceptable: it is an environment assertion with a clear message.

## Findings
- **minor 1: the window-resize path is not covered for unstacking.** The test only changes the content width. "Stacked at a narrow window → widen the window so that the gap lands in 12–24 px → beside" is not tested here or in `fonts.spec`, which tests resize only toward stacking (4 and 5 catch a missing `resize` listener only in that direction). In the fix every trigger goes through one `check()` → `nextStacked(gap)`, so a path-specific regression is unlikely. Optional: add one step to this spec (1024 → 1280 and assert beside).
- **minor 2: the fonts-ready transient (the actual CI trigger) is simulated, not reproduced.** Delaying the woff2 responses and then releasing them would be more faithful. That depends on whether the system fallback font is wider than Inter on the runner, so it is not portable. The `min-width` stand-in exercises the same observer path. Acceptable as is.
- **minor 3: the exact CI gap is not guaranteed a target.** At a base gap of 18.98, target 19 is skipped. That does not matter, because 12.5 and 15 already lie inside the old band. If the intent is "the CI gap itself is checked", a target derived from `base.gap - 0.5` would do it.
- **minor 4: wording in the header comment.** The comment says "(gap ≥ 12 px, `ui/bottomBand.ts`)". That reads as if the test pins the constant's location. Cosmetic only.

## Not reviewed
- The fix itself, which is Gold's job.
- Whether the stacked placement should also reserve inset height so that it never covers the city: that is the review's alternative fix, and this test does not pin it.
