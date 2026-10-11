# fonts-001 Red review 1

**Verdict: REJECTED**

Reviewer: fresh adversarial Red-gate subagent. HEAD 47340f9 (public-main), 2026-10-11.

## Test files reviewed (sha256)
- `6989812286a35230524de1762794c4ebf8c55e053ceb288c8b6231b09e69082e  web/tests/fonts001.test.ts`
- `ecc70ed65de8908d5e1a169026ea4bf519d5df80f151710a56d7d5dbe57b2384  web/e2e/fonts.spec.ts`

## Commands and results
Load: `uptime` 22:48 load 7.63 / 11.97 / 11.98; 22:51 load 8.26 / 10.11 / 11.19 (shared machine).

| Command | Result |
|---|---|
| `pnpm -C web exec vitest run tests/fonts001.test.ts` | 1 failed at fonts001.test.ts:25 (`@fontsource-variable/inter` undefined). Right reason. |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web exec playwright test e2e/fonts.spec.ts --reporter=line` | 3 failed, 1 passed (11.9 s). Test 2: no loaded FontFace for Inter Variable (:87). Test 3: "Simulation metrics × Legend" at 1280×800 with wide text (:107). Test 4: passes (pin of existing behaviour). Test 5: `blocked` = 0 (:169). Each failure is for the right reason. |
| Width probe (temporary spec, deleted) | macOS, current fonts: metrics 519 px, legend 704 px. Without the style the gap is 345 / 185 / 25 px at 1600 / 1440 / 1280. With `letter-spacing: 0.12em` it is metrics 563, legend 827, gap 179 / 19 / −141. Collapsed legend: 94 px. |
| Shortcut probe (copy of fonts.spec.ts plus a `@media (max-width: 1599px) { .legend { bottom: 112px } }` style, deleted) | Test 3 **passed**, test 4 **passed**. Test 5 failed only on `blocked > 0`, which is satisfied once the fonts are bundled. |

## MAJOR

**M1. A fixed breakpoint passes tests 3–5, so the "measured, fit-based" Output (F2) is not enforced.**
The relevant assertions:
- web/e2e/fonts.spec.ts:101–117 (test 3) requires stacking with wide text only at 1280. At 1440 it accepts either placement (:109).
- web/e2e/fonts.spec.ts:122–132 (test 4) requires beside only at 1600 and stacked at 1024.

So any `@media (max-width: N)` with N between 1281 and 1600 satisfies every placement assertion, with no measurement and no font awareness. I verified this for N = 1599 (shortcut probe above). Test 5 then passes as well on macOS and on Linux: a stacked legend at 1280 cannot overlap the metrics. The epic's F2 says "not by a fixed pixel breakpoint … This holds for any font". No test pins the behaviour that only measurement can produce: **the same viewport gives beside with narrow text and stacked with wide text.**

Concrete fix:
1. At a fixed width where normal text fits with a large margin, assert beside, for example 1600×900, where the gap is 345 px. After bundling, Inter widths are the same on every OS.
2. Inject a style that cannot fit there, *without resizing*, and assert stacked with `layoutProblems` = []. `letter-spacing: 0.12em` leaves 179 px at 1600, so use a stronger widening (for example ≥ 0.35em, or a measured width-dependent value), or test at 1440, where 0.12em leaves only 19 px and is too fragile.
3. Remove the style and assert beside again.

This also covers the stated Output "re-checked … when the metrics' width changes". No current test checks that, because test 3 always resizes after injecting the style. If the placement must also hold after a resize, keep the existing 1600 → 1280 resize leg.

## MINOR
- **m1. The README regex is satisfied without any README change.** fonts001.test.ts:57 `/Inter/` already matches "**Interface:**" in README.md:6. The JetBrains Mono and OFL checks still force an edit, but the Inter check is a no-op. Use `/\bInter\b/` or match "Inter" near the licence line.
- **m2. Hysteresis is not tested.** The Specification asks that the placement never flips back and forth at the border; no test sets a width at the border ±1–2 px and checks a stable placement across repeated resizes or ResizeObserver cycles. It is a Specification item rather than a listed Output, so this is not a MAJOR.
- **m3. The `document.fonts.ready` re-check has no direct test.** No test delays the woff2 responses so that the first measurement uses fallback metrics and the swap then changes the fit. A ResizeObserver-based implementation would cover it anyway, so this is MINOR.
- **m4. Collapse and expand are checked only at 1024**, fonts.spec.ts:134–145. A breakpoint keeps 1024 stacked anyway. A stronger check: at the M1 width with wide text, collapse (the legend is now 94 px wide), then expand and assert stacked with no overlap. That catches an implementation that measures the collapsed legend and does not re-check on expand.
- **m5. Test 2 departs from the Tests table.** The table says `document.fonts.check` is true, but the test instead checks `FontFace.status === 'loaded'` plus a width-equality check. This is stronger, not weaker, but the table and the test should agree.
- **m6. COEP is not exercised by the e2e tests.** The Vite dev server does not apply `public/_headers`. Under `require-corp` it is only verified through the manual Must-DO step on the live deploy. The Gold reviewer should check the live page loads the fonts (or a `vite preview` with the headers).
- **m7. Risk to frozen tests, not a test conflict.** If bundled Inter is wider than SF, the measured placement may stack the legend at 1280 in the frozen `panels_never_overlap` runs. The 1280×720 case is the tight one: the stacked legend (bottom 112 px) shares the right edge with the side column (guide plus selected road). The fonts tests do not force this, but the Gold reviewer should confirm that the frozen layout and covered-road tests pass at 1280×720 with whatever placement results.
- **m8. Test 1 runs a full `vite build`** inside Vitest with a 120 s timeout. On this loaded machine and in CI it may be slow. Watch it for flakiness; it is not a correctness issue.

## Coverage summary
- F1: tests 1 and 2. The tests check the packages, the imports, the stacks, emitted woff2 files, same-origin `@font-face`, that the fonts load and are actually used for the metrics/mono text, and that no request goes to another origin. Adequate.
- F2: tests 3–5. The tests check no overlap with wide or blocked fonts and the resize re-check. They are **missing a measured-vs-breakpoint discriminator (M1)**, the metrics-width re-check (M1), hysteresis (m2) and the fonts.ready re-check (m3).
- F3: by its nature, the CI run is checked at Gold.
- No conflict with frozen tests in the tests themselves. The single-view covered-road check in guide.spec.ts is relative (with guide vs without), so the legend's placement does not affect it.
