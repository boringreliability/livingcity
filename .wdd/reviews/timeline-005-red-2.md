# timeline-005 Red review #2

**Verdict: APPROVED**

Reviewed at commit `366496a`. Reviewer: a fresh adversarial Red-gate subagent, round 2.

| File | sha256 |
|---|---|
| `web/e2e/acceptance.spec.ts` | `b347681bc73ed59a35c67418af4ef37952c8d1ae9bd2b02d3cfbae287cddbe6d` |
| `web/tests/integration.test.ts` | `b2d0fdefdead8b95137159137fe222f2aa2717cea04b519bfe74129846bb96ed` |
| `web/e2e/perf_timeline.spec.ts` | `db947a2f5aed7a0ef74b9a53c1948c3eb782a91b86d5001b5e9e6b4b2eec3d6e` |

## Status of the round-1 findings

| r1 | Status | Evidence |
|---|---|---|
| B1: test 9 forced `Simwindow_metrics` | **Resolved** | `clean()` (`integration.test.ts:226`) is applied to the titles and to the doc leads in the same way, and keeps inner dots. A mock `architecture.md` that writes `` **`Sim.window_metrics`** `` passes. |
| M1: no Completion Criteria; trivial titles | **Resolved** | `section()` is bounded at the next `#`/`##` heading. Titles must *lead* a `- ` item or a `###` heading. The four epic criterion labels (`Tests`, `Determinism`, `In the browser`, `Performance`) are extracted and required (`:242-246`). |
| M2: test 6 let fabricated numbers through | **Mostly resolved** | Prose and tables are both scanned now. Numbers with a glued unit (`123.4ms`, `3.2x`) are caught, integers must equal an integer leaf exactly, and the heading is matched exactly. I confirmed each by mutation (below). What remains is in m1 and m2. |
| M3: mentions counted as use | **Resolved** | Exports now count only through import clauses, re-export `from` clauses or `ns.Name` namespace use, all with comments stripped. The export regex covers `default`/`async`/`let`/`var`/`function*` and `export { … }` lists. It reports the same 14 orphans as before. |
| M4: test 2 not keyboard-only | **Resolved** | There is no JS blur and no Escape. `b` is pressed on the focused slider. A capture-phase counter of pointer, mouse, touch and wheel events (excluding `click`) must be `[]`. `branchTick < closedAt` is asserted. |
| M5: seeks at a single replay distance | **Resolved** | 24 track clicks, spread over the window. In my run the replay offsets were 5…119, with 24 distinct values. Targets are asserted to be inside the window, with a spread over 0.8. `frameBound` is recorded and its consistency asserted. |
| M6: different sim ranges | **Resolved** | Single and lockstep each record from the first frame at or after `start` to the first frame at or after `start + 2400`. Start and end are recorded, and both are asserted within 20 ticks. In my run they were [15647, 18052] and [15660, 18056]. |
| M7: no conditions or sub-resolution flag | **Resolved** | The JSON records headless (from CDP), launch args, city, multiplier, hardware, and per recording the achieved ticks/s, achieved speed and on-network median/max. `tickBelowTimerResolution` is checked against its recomputation. |
| m1–m10 | Resolved except m9 (partly) | See m3 below. |

## Findings

No BLOCKER or MAJOR findings.

### MINOR

**m1. Test 6 exempts every inline code span, so a fabricated number in backticks passes** (`integration.test.ts:170`)
- I appended ``Seek p99 was `123.4 ms`.`` to the Timeline section. The test passed. A number inside a fenced block also passes.
- The headline values must still be cited in plain text (`:183-188`), so the real numbers cannot be hidden. The Gold reviewer's audit of the doc is the backstop.
- **Fix (optional):** exempt only spans that are paths, commands or URL parameters, e.g. spans containing `/`, `=`, `-C ` or `.json`. Scan the digits in all other spans.

**m2. Test 6 accepts or rejects honest small integers depending on the run** (`integration.test.ts:178`)
- `seek.targets` and `seek.replayTicks` contribute 48 run-dependent integers to the leaf set. In this run the integers 0–30 present were 0, 1, 5, 11, 17, 23, 24 and 29.
- Consequences:
  - "within 2 × the budget" fails in this run. "at least 20 seeks" passed in my mock only because the mock JSON happened to contain 20.
  - The 1,655-style thousands separators already used in `performance.md` also fail (`655`), and so do dates (`2026-10-09`).
  - A small fabricated integer passes about one time in five.
- This does not block, because the implementer can see the rule and can write "twice" or "at least twenty".
- **Fix (optional):** walk only the measurement subtrees, i.e. exclude `seek.targets` and `seek.replayTicks` from the leaves. Note in the doc that numbers are written without thousands separators.

**m3. Test 8 skips the test-name filter whenever a command has a trailing `# comment`** (`integration.test.ts:214`)
- CLAUDE.md lists its commands with trailing `# …` comments, and a README is likely to copy that style.
- With that style, `cargo test -p sim-core --test city_005_scale not_a_real_fn # one test` passes. Without the comment it fails, which is correct.
- `pnpm --dir web nosuch` and `cd web && pnpm nosuch` are still unchecked; this is the remainder of r1-m9.
- **Fix (optional):** strip `\s+#.*$` from `cmd` before running the filter regex, and also match `pnpm (?:-C|--dir) web (\S+)`.

**m4. Test 7's start/end tolerance of ±20 ticks is close to what was observed** (`perf_timeline.spec.ts:267-269`)
- At 60× there are 120 ticks/s. With lockstep frames at 83 ms, one frame carries about 10 ticks, and I observed a start offset of 13.
- If SwiftShader slows to about 167 ms per frame under load, the check fails without any bug.
- **Fix (optional):** derive the tolerance from the recording, e.g. `≤ max(20, ceil(achievedTicksPerS × renderIntervalP95Ms / 1000) + 2)`.

**m5. Test 4's allowlist lives inside the frozen test file** (`integration.test.ts:78-80`)
- The spec offers "an explicit, commented allowlist" as a legitimate way out, but adding an entry after Red approval changes the frozen file's hash.
- In practice every one of the 14 current orphans can be resolved by removing its `export`, so this does not block a correct implementation.
- **Note for the implementer and the Gold reviewer:** the allowlist is effectively closed. Resolve orphans by un-exporting them, or by importing them where they are genuinely used.

**m6. Test 4 has blind spots that do not matter today**
- A default export imported as `import X from` is never recorded (`:99` only reads `{…}`), so any future `export default` is reported as an orphan.
- `export abstract class` and `export * from` are not parsed.
- `stripComments` treats `/*` inside a string (e.g. `'**/*.wasm'` at `e2e/city.e2e.spec.ts:366`) as the start of a comment.
- None of these affect current files: the orphan list is identical to round 1.

**m7. Test 5 has trivial matches and a narrow definition form** (`integration.test.ts:136,141`)
- `\bB\b` and `\bD\b` match "A/B" anywhere in the README.
- Definitions must have the form `**queued**` + `means|is|:|=`. `is` is also found inside other words, and a definition table, or a bold label like `**Queued vehicles**`, would fail.
- The implementer can see the form. My natural mock (`- **Queued** means …`) passed.

**m8. Test 2 never checks that B's own decision took effect**
- Test 2 does not check `sides.b.closed`.
- Test 1 covers this for the North Bridge closure, so this is acceptable for a "same core path" test.

### Note for Gold
- Re-running `e2e:perf` rewrites `web/perf-results/timeline.json`, and test 6 then fails until `performance.md` § Timeline is updated.
- Either restore the committed JSON after the smoke run, or update the doc from the new run.

## What I ran

1. `pnpm -C web exec vitest run tests/integration.test.ts`: 6 tests, 5 failed (4, 5, 6, 8, 9) and 1 passed (3). This is expected at Red.
   - Test 4 lists the same 14 orphans as round 1: 9 renderer constants, `HostDeps`, `TrackedOutcome`, `VEHICLE_DETAIL_HEADER`, `LivingCityDiagnostics` and `LivingCityHook`.
   - Tests 5, 8 and 9 fail because `README.md` and `architecture.md` are missing. Test 6 fails because there is no `## Timeline` section.
2. `pnpm -C web exec playwright test e2e/acceptance.spec.ts`: `✓ brief_acceptance_flow (1.0m)` and `✓ acceptance_flow_keyboard_only (8.7s)`, 2 passed (1.2m).
3. **Doc-feasibility probe.**
   - I copied the test temporarily to `web/tests/zz_red_probe.test.ts` with `ROOT` redirected to a scratch tree. That tree held a natural mock README, mock architecture (with Deviations and criteria), traffic-model, demo and performance (with a Timeline table) docs, and a JSON in the new schema. The copy is deleted.
   - Tests 5, 6, 8 and 9 **pass** on a correct-looking doc set, so nothing forces a false negative.
   - Mutation results (`scratchpad/red-tl005-r2/variants.log`):

| Test | Mutation | Result |
|---|---|---|
| 6 | fabricated number in prose (`123.4 ms`) | FAIL ✓ |
| 6 | fabricated with glued unit (`123.4ms`) | FAIL ✓ |
| 6 | fabricated `3.2x` | FAIL ✓ |
| 6 | fabricated number in link text | FAIL ✓ |
| 6 | fabricated number in a code span | PASS (m1) |
| 6 | fabricated number in a fenced block | PASS (m1) |
| 6 | honest `2 × budget` | FAIL (m2) |
| 6 | honest date | FAIL (m2) |
| 6 | honest thousands separator | FAIL (m2) |
| 6 | `0.0488` extra digits | PASS |
| 6 | `WebGL2` | PASS |
| 6 | numbers in a later `##` section | ignored ✓ |
| 8 | bad test fn without a comment | FAIL ✓ |
| 8 | bad test fn behind `# comment` | PASS (m3) |
| 8 | bad `--test` file | FAIL ✓ |
| 8 | bad `-p` package | FAIL ✓ |
| 8 | bad `pnpm -C web` script | FAIL ✓ |
| 8 | bad script via `--dir` or `cd web &&` | PASS (m3) |

4. `cd web && PERF=1 ./node_modules/.bin/playwright test e2e/perf_timeline.spec.ts`: `✓ perf_timeline_recorded @perf (3.1m)`.
   - The JSON is copied to `scratchpad/red-tl005-r2/timeline.json`, and the generated file is deleted from `web/perf-results/`.
   - Window 0..18647. A was at 44.3 MiB (not yet evicting), and the test only requires more than 44 MiB.
   - Seeks: n=24, targets 287…18158, stride 777, replay offsets 5…119 (24 distinct). Median 86.7 ms, p95 90.8 ms, render interval 50 ms, `frameBound: true`.
   - Branch: 54.4 ms at tick 15536.
   - Memory: A 44.31, B 37.03, total 81.33 MiB against a 48 MiB budget.
   - Single [15647, 18052]: 2405 ticks, mean 0.0475 ms, 119.96 ticks/s, `tickBelowTimerResolution: true`.
   - Lockstep [15660, 18056]: 2396 ticks, mean 0.0850 ms, render 83.3 ms.
   - Ratio 1.79.
5. Static greps:
   - No `import('…')` type references, `export default`, `export {` or `export *` in `web/src`.
   - The only `/*`-in-a-string case is `e2e/city.e2e.spec.ts:366` (m6).
   - `client.ts` send methods: 12 of 13 match the method regex, and the multi-line `inspectVehicle` matches through `\s*`.
6. `git status` is clean after the probes. The only file I wrote in the repo is this review.

## What is good
- Test 1 has teeth at every step:
  - the spillback and doubling criterion within 15 sim minutes, failing at once;
  - `branchTick === at < closedAt`;
  - B runs past A's head, with the North Bridge closed and every main link open;
  - in compare, `a.tick === b.tick ≥ aHead`, with the closed sets per side;
  - `fromTick === at`;
  - the Generated and Incomplete cells equal the sim's comparison values.
- Test 2 is now a genuine keyboard-only path, with a pointer-event counter.
- Test 3 also requires every client send method to be called from the UI.
- Test 7's measurements are honest and their provenance is recorded:
  - the seek method and resolution flag;
  - the same-range recordings with their tick bounds;
  - the run conditions;
  - memory per side, and after the lockstep run.
