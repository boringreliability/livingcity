# polish-006 Red gate, review 1

**Verdict: REJECTED**

Reviewed at HEAD `41330b7`.
- sha256 `web/e2e/integration_polish.spec.ts` = `86643b9e9221b8e6c90f3e25c7feb803c5ba14b400a6e371f0640c63680eb60e`
- sha256 `web/tests/polish006.test.ts` = `8fcb3d191eb83f19e487aa88bc0418028af9b21146e9b7f712d281aa95aa6b70`

## What I ran (with load)
1. `pnpm -C web exec vitest run tests/polish006.test.ts` (load 9.41 / 9.56 / 12.31). Test 4 **passes on HEAD**. Test 7 fails with 8 `Diff in` lines, all in `cities.rs`. Test 8 fails with ENOENT on `docs/known-issues.md`. Test 9 fails because `baseline-1x.json` is dated `2026-10-08T12:57:34.806Z`.
2. A probe copy of test 4 without the `viewScenario(0)` step, so the replace starts while B is viewed. It **fails on HEAD**: `frames come from A: expected 1 to be +0`. The file was deleted afterwards.
3. `pnpm -C web exec playwright test e2e/integration_polish.spec.ts` (load 3.85 at the start, 9.23 at the end). Results:
   - Test 1 fails. The medians were pause 106, play 106, seek 101, compareOn 342 and compareOff 842 ms. `on_network` ≥ 4000 was reached right after warm-up, and the test took 7.7 s.
   - Test 2 passes.
   - Test 3 fails because Play stays enabled while halted.
   - Test 5 fails because Esc moves focus off the body.
   - Test 6 fails: Guide shows `solid|2px|rgb(227, 231, 236)|-2px|none` both focused and unfocused.
4. A probe e2e (`zz_red_probe.spec.ts`, deleted afterwards; load 4.96 at the start, 5.04 at the end) toggled compare 4× at `?demand=5`. It recorded the worker flag (`snapshot().timeline.compare`), the UI flag (`snapshot().compare`) and the longest gap between rAF ticks:
   - **on:** worker 762 / 232 / 6 / 244 ms, UI 762 / 232 / 299 / 244 ms.
   - **off:** worker 9 / 672 / 734 / 561 ms, UI 1224 / 672 / 734 / 561 ms.
   - **longest rAF gap ≈ the whole latency every time** (for example 1215 ms of 1224). The cost is one main-thread long task: the renderer-B create/dispose plus the re-layout. The worker round trip is not the problem.
5. `cargo fmt --check` gave hunks per file. Non-frozen files have 89 in total, for example `world.rs` 56, `cities.rs` 19, `sim-wasm/src/lib.rs` 11, `timeline.rs` 7 and the examples 1–6 each. There is no `rustfmt.toml`, and the workspace edition is 2021, which matches the `--edition 2021` in test 7. No `#[cfg(test)]` modules live under `crates/*/src`, so formatting `src` reformats no frozen test.
6. Static reads of `host.ts` (branch/replace, pools, iterate), `App.tsx` (the `restart`, the compare layout effect, the Esc handler, the snapshot hook), `ControlPanel.tsx`, `ScenarioPanel.tsx` (the confirm `autoFocus`), `styles.css:128/209/550/778`, `restart.spec.ts`, `a11y.spec.ts` (`focusIsSane`, `esc_closes_innermost_first`), the backlog, and the perf harness's `timestamp` field.

`git status` is clean apart from this file.

## Findings

### 1. MAJOR: test 4 does not exercise f6; it passes on the unfixed host (`polish006.test.ts:76-78`)
f6 is "while a B replace is being built, `viewed` stays 1". The test calls `viewScenario(0)` before the replacing `branch`, so `viewed` is already 0 when the old B is freed. On HEAD, `branch()` sets `sim = a` before `free()` and leaves `viewed` untouched (`host.ts:409-413`), so HEAD passes every assertion.

I removed lines 76-77 and started the replace with B viewed. HEAD then fails on `frames come from A: expected 1 to be +0`. The frames come from A's sim but are labelled scenario 1, which is the f6 bug. The protocol accepts `branch` while `viewed === 1`, so this state is reachable at the host boundary that test 4 targets. The spec's "a probe sim's `free()` hook records the host's `scenario()` view" is also not implemented: nothing is recorded at the moment of `free`.

**Fix:**
- Drop the `viewScenario(0)` and `iterate(2)` before the replace, so the replace starts with `viewed === 1`.
- Optionally run the A-viewed variant as a second case.
- Scope `posted.some(error)` to the messages after `n`.

### 2. MAJOR: test 3's k3 checks are vacuous (`integration_polish.spec.ts:145-157`)
**(a) "The alert stays until the new world's first frame."** `firstFrameSeen` reads `snapshot().tick > 0 && renderFrames > 0`. `restart()` (`App.tsx:130-136`) calls `setFrame(null)` but never clears `frameRef`, and `renderFrames` is a counter that never resets. Both stay > 0 from the dead world, so `firstFrameSeen` is always true and the `stillThere` assertion is skipped. HEAD clears the banner on click, which is exactly k3's bug, and it would pass this part. A correct implementation that keeps `frameRef` would skip it too.

**Fix:** before the click, install an in-page rAF or MutationObserver recorder that stores `alertGoneAt` and `newFrameAt`. A halted worker posts nothing, so the first change of `snapshot().tick` (or `timeline.headTick`) after the click marks the new world's first frame. Assert `alertGoneAt >= newFrameAt`, with a tolerance of one rAF, and assert that the alert was still present on the first rAF after the click.

**(b) "The bridge is disabled with a reason."** The trap fires while comparing. The bridge is already disabled then, with `title = NO_INTERVENTIONS_WHILE_COMPARING` (`App.tsx:1099`, `ControlPanel.tsx:104-105`), so the bridge check passes without any k3 work.

**Fix:** assert that each of the three controls has a title matching `/stopped|halted|restart/i`, or check the bridge in a phase without compare.

### 3. MAJOR: test 3's k2 assertions on selection and tracking are vacuous (`integration_polish.spec.ts:131-140, 160-162`)
- The road selected at 131-140 is cleared by the next compare toggle. The compare layout effect sets `selectedRef.current = null` and `setSelected(null)` (`App.tsx:481-484`), so `selectedLink` is already null at the trap.
- No vehicle is tracked and Follow is never switched on, although the comment at 117 says "a selection and a tracked vehicle". `trackedTrip === null` is therefore trivially true.
- Follow, pending seek, the held A/B pair and the confirm dialog are named in k2 but never set up or checked.

So of k2's list, only the guide reset and compare are actually tested. HEAD's k2 bug, "the selected road carries over", would pass.

**Fix:** use two trap/restart phases.
- **Phase 1, not comparing:** select a road, track a vehicle with Follow on, open confirm-replace, and do a pending seek if possible. Trap and Restart, then assert `selectedLink`, `trackedTrip` and `following` are null or false and the confirm region has count 0.
- **Phase 2, comparing:** select a road on side A in compare, then trap and Restart, then assert compare is off and the selection is null.

Alternatively, select during compare and track before it, if the app allows both.

### 4. MAJOR: test 1's compare timing can be gamed and does not measure what the user sees (`integration_polish.spec.ts:33-56`)
`timed()` calls `poll()` synchronously right after the act. `snapshot().compare` is the UI ref `compareViewRef`, not a worker or drawn state. An implementation that flips that ref inside the click handler would therefore measure about 0 ms even if the main thread then blocks for 800 ms. My probe shows that the entire latency today *is* such a main-thread long task (longest rAF gap ≈ total), so the gamed version would leave the user-visible delay unchanged. The same hole applies to `running` or `positionTick` if the snapshot ever reads optimistic UI state.

**Fix:**
- Start polling with `requestAnimationFrame(poll)` instead of `poll()`, and resolve only inside a rAF callback, so every long task after the act is counted.
- For compare-on, also require that B was drawn: `drawnCameras !== null` (or `renderFrames` advanced after the flip).
- For compare-off, require `drawnCameras === null` and a `renderFrames` increase.

### 5. MAJOR: k5 has no test
k5 says that `init` clears both frame pools and that leaving compare clears B's pool. This is a behavioural host fix, and no test in the table covers it, so a missing or partial implementation passes.

Reuse is observable in Node through `ArrayBuffer` identity in `posted`, because `post` does not transfer.
- **The `init` case:** while paused, `returnBuffer` the last A frame's buffer with `scenario: 0`, then `init` again with the same seeds. The first frame's `vehicles` must not be that buffer. The count is equal when paused.
- **The compare case:** return B's buffer with `scenario: 1` while comparing and paused. Then compare off and on again. No B frame may reuse that buffer.

Add this as test 4b in `polish006.test.ts`.

### 6. MINOR: test 7 passes when rustfmt does not run (`polish006.test.ts:89-95`)
- If `rustfmt` is missing, the call fails with ENOENT. Then `out = "Error: spawnSync rustfmt ENOENT"`, which has no `Diff in` line, so the test passes.
- A parse error writes only to stderr, so the test also passes.
- A new `rustfmt.toml` with `disable_all_formatting = true` would pass trivially.

**Fix:**
- Record `failed = true` in the `catch`, and assert `failed === false` with the output as the message.
- Assert that no `rustfmt.toml` or `.rustfmt.toml` exists at the root or under `crates/`, or that any such file has no `disable_all_formatting` or `ignore` key.

### 7. MINOR: test 8's format and section slices (`polish006.test.ts:104-116`)
- The id lead must be `**a1**`. An author who copies the backlog's own form, `**a1:**`, gets "ids missing". Allow `\*\*([a-k]\d+):?\*\*`.
- A duplicated id with two different statuses collapses silently in the `Map`. Assert `lines.length === listed.size`.
- `gate` and `polish` are sliced to the end of the file. If `## Epic gate` comes *before* the per-id list, every id is trivially "named". Slice to the next `^## ` heading, and for architecture to the end of the "From epic polish" list.

### 8. MINOR: test 9 has gaps (`polish006.test.ts:118-127`)
- It does not forbid keeping the wrong sentence: `docs/architecture.md:26` "capped at 1.5 × the frame interval" can stay next to the new one. Add `not.toMatch(/1\.5 × the frame interval/)`.
- `frame-cost.json` already exists from polish-005, so the existence check cannot detect whether k1's re-run of `frame_cost_probe` happened. The file has no timestamp; at least check that its `loadAvg` differs from the current one.
- The "browser before/after (polish-005) comparison of the stress run" in `performance.md` is not checked. Assert a heading or line that names `stress-5x` with both a before and an after value.

### 9. MINOR: test 1 does not log the load the spec requires, and relies on a default (`integration_polish.spec.ts:66-94`)
- The spec says "The test log records the machine load (`uptime`)". Add `os.loadavg()` to the `console.log`.
- The test assumes 20× through `DEFAULT_SPEED = 20`. Assert `combobox Speed` has value `20`, so a default change cannot silently weaken the test.
- **Feasibility note for the Gold reviewer:** at load ~5, compare-on is 232–299 ms after the cold first toggle (762 ms with shader compile). The 300 ms median is achievable only if B's renderer is not rebuilt on every toggle, or is made much cheaper. Results above load ~10 must be judged against the logged load.

### 10. MINOR: j2 and k4 have no tests
Both are cheap static checks:
- `README.md`, `docs/demo.md` and the "×" tooltip in `DemoGuide.tsx` contain `the **?** (Guide) button` or its plain-text equivalent;
- the classification comment in `timeline.rs` lists `index` under derived.

### 11. MINOR: test 6 accepts a difference in colour only (`integration_polish.spec.ts:213-226`)
The user is colourblind, and CLAUDE.md says never to rely on colour. The test also does not assert that focus is `:focus-visible`.

**Fix:**
- Require that a non-colour component differs: outline width, style, offset or box-shadow geometry.
- Add `expect(await t.evaluate((el) => el.matches(':focus-visible'))).toBe(true)`.

### 12. MINOR: test 5 skips a case
Focus on another control outside the panel (for example the Diagnostics button) followed by Esc should close the confirm and leave focus on that control. This is g1's "from anywhere". Add one step.

## No conflict found with frozen tests
- **`restart.spec.ts`:** it presses Space on the slider while halted, and disabled controls do not affect that.
- **`a11y.spec.ts`, Esc on confirm:** the confirm `autoFocus`es "Replace the branch", so focus is inside the panel. The g1 guard keeps the move to the slider, and `focusIsSane` stays green.
- **`a11y.spec.ts:129-131`:** the ring check needs an outline of at least 2 px or a box-shadow, which a j3 fix can keep.
- **The rustfmt gate:** it touches no frozen file.
