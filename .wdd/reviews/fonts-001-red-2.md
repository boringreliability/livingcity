# fonts-001 Red review 2

**Verdict: APPROVED**

Reviewer: a fresh adversarial Red-gate subagent. HEAD 5bde512 (public-main), 2026-10-11.

## Test files reviewed (sha256)
- `6bf1734bbfabde464fdd5aebe5d7e4a5e0bb638480f101e2a72dc720086a1aea  web/tests/fonts001.test.ts`
- `bf85687042eb1295ab9c8303a4f29efd5575a10b3ef979dc615dd5f57f0e44ec  web/e2e/fonts.spec.ts`

## Commands and results
Load (`uptime`): 8.11 at 22:54, 15.04 at 22:56 and 25.18 at 22:58 (shared machine). No failure depended on timing.

| Command | Result |
|---|---|
| `npm view @fontsource-variable/inter@5.3.0` / `@fontsource/jetbrains-mono@5.3.0` | Both versions exist, both OFL-1.1. The family names in the package CSS are `'Inter Variable'` and `'JetBrains Mono'`. The file names start with `inter-` and `jetbrains-mono-`, which matches test 1's regexes. |
| `pnpm -C web exec vitest run tests/fonts001.test.ts` | 1 failed at :25 because the package is missing. That is the right reason. |
| `pnpm -C web typecheck` | Clean. |
| `pnpm -C web exec playwright test e2e/fonts.spec.ts --reporter=line` | 4 failed, 1 passed (15.5 s). All failures are for the right reason. Test 2: no loaded FontFace for Inter Variable (:87). Test 3: layout problems at 1280 with wide text (:107). Test 3b: not stacked at 1600 with 0.35em (:132). Test 5: `blocked` = 0 (:200). Test 4 passes as a pin of existing behaviour. |
| Probe A: copy of the spec with a crude measured placement injected (polls panel boxes, gap hysteresis 8/16 px, `.lc-stacked` sets bottom 112), system fonts | Tests 3, 3b and 4 pass, and the layout part of test 5 passes. The tests are satisfiable by a measured implementation. |
| Probe B: shortcut `@media (max-width:1599px){.legend{bottom:112px}}` | Test 3b fails at :132 (1600 with wide text, not stacked). **The Red r1 M1 shortcut is now caught.** |
| Probe C: shortcut `@media (max-width:1600px)` | Test 3b fails at :128 and test 4 fails at :158 (not beside at 1600). |
| Probe D: always stacked | Tests 3b and 4 fail ("1600: beside"). |
| Probe E: measured placement plus the real Inter Variable / JetBrains Mono 5.3.0 latin woff2 (served same-origin by `page.route`, stacks overridden) | Tests 2, 3, 3b and 4 pass, so test 2's FontFace-status check and width-equality check work with the real fonts. With Inter at 1600×900, the gap is 346 px with normal text and −192 px with 0.35em. Both margins are large, so the discriminator is robust on Linux, where the bundled glyphs are identical. |
| Probe F: frozen sizes with Inter (1280×720, 1280×800, 1366×768, 1024×768), both placements | `layoutProblems` = [] in both placements at every size. With Inter the gap at 1280 is 26 px, so the measured choice could be either. No conflict with the frozen overlap checks. |

All probe files were deleted, and `git status` is clean.

## MAJOR
None.

Red r1 M1 is genuinely fixed. Test 3b (fonts.spec.ts:123–150) keeps a fixed 1600×900 window and requires three placements in turn: beside with normal text, stacked with 0.35em, then beside again once the style is removed. No fixed breakpoint, always-stacked layout or resize-only re-measurement can pass it (probes B to D). Test 3b also covers the "metrics' width changes" re-check and the collapse/expand re-check (Red r1 m4).

## MINOR
- **m1. Test 5 does not fully block JetBrains Mono.** Fontsource's JetBrains Mono CSS lists `.woff2` and then `.woff`. Vite emits both, so with `**/*.woff2` aborted (fonts.spec.ts:184) the browser falls back to the `.woff` and loads JetBrains Mono anyway. Only Inter (woff2 only) is truly blocked. The layout assertions still exercise the wide-fallback case for the UI font, which is what matters for the legend, so this is not a MAJOR. To fully match "fonts blocked", route `**/*.{woff,woff2}`.
- **m2. Hysteresis is still untested** (carried over from r1 m2). It is a Specification item, not an Output.
- **m3. The `document.fonts.ready` re-check has no direct test** (carried over from r1 m3). An implementation using ResizeObserver or polling covers it implicitly.
- **m4. COEP `require-corp` is not exercised** (carried over from r1 m6): the dev server does not apply `public/_headers`. The Gold reviewer must verify the live deploy, or `vite preview` with the headers.
- **m5. Test 1 runs a full `vite build` inside Vitest** (120 s timeout). Watch it under CI load (carried over from r1 m8).
- **m6. Frozen-test risk at Gold, not a test conflict.** With Inter, 1280 sits 26 px from the border, so the implementation's hysteresis threshold decides the placement there. Probe F shows both placements are clean at the frozen sizes on macOS. The Gold reviewer should confirm on the Linux CI run.

## Coverage summary
- **F1** is covered by tests 1 and 2: packages at exact versions, entry imports, stack order, emitted woff2 files, same-origin `@font-face`, faces actually loaded, the metrics and sim-time text rendered in the bundled families, and no foreign requests. The Inter README check is now `\bInter\b`.
- **F2** is covered by tests 3, 3b, 4 and 5: measured placement independent of the window (3b), the resize re-check (3), collapse/expand (3b, 4), beside when it fits (4) and blocked fonts (5).
- **F3** is checked at Gold: the CI run on the final commit.
