# motion-001 Red gate, round 2

**Verdict: APPROVED**

Reviewer: fresh adversarial Red-gate subagent, 2026-10-12. Worktree HEAD 985c316 (branch public-main).

## Files under review (sha256)
- `web/tests/motion001.test.ts`: `45f4fcb51bbd7bd91c59c810163a578cab3b8d16fc12c671a30fdeff32ce4e15`
- `web/e2e/motion001.spec.ts`: `32eef04abf16649b712039a8e76d4776114cf5320fe65261bd941cf9ee51e55a`

## Supersession check
- `git diff 19e9fbf..HEAD -- web/tests web/e2e crates`: only the two new motion001 files, plus `review2.test.ts` (G4, G8) and `review3.test.ts` (G4b). The change in each is `test(` → `test.skip(` plus a SUPERSEDED comment. No other frozen file was touched, and `web/src` and `crates` are unchanged.
- The full sha256 values at 19e9fbf match the log: review2 `f3856beb…6c0a`, review3 `499373ef…f7e`. They are now recorded in full in `supersessions.md`.
- The valid intent is carried forward:
  - G4/G4b: test 4 covers the paused tick, no closure in paused frames, the closure ≤ 4 ticks after resume, and no error. It passes as a pin on the current code.
  - G8 "bounded pool": test 6 covers it, and now also pins the bounded *reuse* that S3 exists to allow.

## Method
- I ran the tests on HEAD to check the failure reasons.
- I built a throw-away prototype in an untracked copy (`.probe-web-r2/`, deleted afterwards). It has:
  - a dirty flag, set in `handle`'s `finally` for every message except `returnBuffer`;
  - posting while running (≤ 16 ms), when dirty, or for the settling frame at last-running + 1016 ms;
  - `SimClock.report` trimming the window, plus `windowSize()`;
  - LIFO pools capped at 4 that drop 0-length buffers and buffers from a stale world;
  - a world generation per side, bumped on init, branch and discard;
  - a client with a `createWorker` option and a buffer → {world, scenario} WeakMap, added inside `send` so the polish005 7b literal stays;
  - in App, `framesReceived` and a 500 ms `setInterval` re-render while Diagnostics is open.
- I ran mutants against it.

## Previous MAJORs
- **M1 (fixed).** Test 6 now requires that the first four message-driven frames carry exactly returned #10, #9, #8, #7 (`[9,8,7,6]`) and that later frames carry none of them. Mutants:
  - "clear pool on every post" (G8's behaviour): **fails test 6**;
  - FIFO, dropping the newest at the cap, cap 3, cap 5: each fails test 6.
- **M2 (fixed).**
  - The ward lists `city.e2e diagnostics_panel_toggle` as kept frozen, and has a "Diagnostics while paused" Output.
  - Test 8 loads the main thread (~120 ms per rAF) and requires the panel's render p95 to follow the hook.
  - Mutant "panel refreshes only on worker frames" (no UI timer): **fails test 8 4/4 and the frozen diagnostics_panel_toggle**.
  - The prototype with the timer passes both.

## MAJOR findings
None.

## MINOR findings
- **n1. The margin of test 8's Diagnostics leg is thin** (`motion001.spec.ts:56-75`).
  - With the "no timer" mutant the gap was 33.4–50.1 ms against a tolerance of about 29.2 ms (hook p95 ≈ 117 ms).
  - The stale panel value is already 67–83 ms because the two screenshots just before stall rAF and inflate the 300-sample window.
  - On a slower machine the stale value could land within 25 % of the hook, and then the mutant would pass test 8. The frozen city.e2e test still catches it.
  - Suggestion: read the panel's p95 right after opening it (before the burn) and also require `panel ≥ 100`, or a change from that reading. A heavier burn (≥ 250 ms per frame) would also help.
- **n2. The discard world bump is unobservable** (`motion001.test.ts:251-267`). Mutant "no world bump on discard" passes everything, because the next branch bumps the world and clears B's pool anyway. This is not a safety hole: B posts nothing between discard and branch, and B's pool is bounded at 4. The spec clause just has no test; the Gold reviewer can check it by reading the code.
- **n3. "Branch clears B's pool" is not observable either.** Buffers returned with the old world *before* the branch would be reused after it. That is harmless, since an exact-size buffer is fully overwritten (investigation, k9). The tests only return buffers after the branch.
- **n4. Test 5 also passes if zero-tick reports are skipped instead of trimmed in `report`.** The window is still bounded in practice, because a running host calls `status()` every 16 ms.
- **n5. Test 3 still also accepts "achieved = 0 whenever paused" in place of a settling frame** (m7 of round 1). That is user-visibly fine.
- **n6. Test 2 requires `iterate` to post after `seek`/`viewScenario` even though the handler already posted.** That is a redundant frame by design. It is spec'd, and the mutant "a handler post clears dirty" fails test 2 as intended, so this is acceptable.
- **n8. Implementation guidance for Gold, tied to the frozen diagnostics_panel_toggle.**
  - My first prototype re-rendered the panel from an *independent* 500 ms `setInterval`. It passed alone, but failed once in the full e2e run at load ~16: panel median vs hook median differed by 33.3 against a tolerance of 12.5.
  - The cause: the panel can lag the hook's render-stats cache by up to 500 ms, and under load the quantized median jumps.
  - Re-rendering whenever the rAF refreshes the cache (`App.tsx:661`) keeps the panel equal to the hook. diagnostics_panel_toggle and test 8 then passed 6/6 at load 14–16.
  - The Output's wording "from the UI's own timer" should be read, or reworded, as "whenever the render-stats cache refreshes". This is not a test conflict.
- **n7. The tests and spec cannot express "a justified lightweight heartbeat".** The user's §2 allowed one, but tests 1 and 8 forbid any idle post. That is a ward-level design choice and it is spec'd consistently.

## Commands and results (load in parentheses)
| Command | Result |
|---|---|
| `pnpm -C web exec vitest run tests/motion001.test.ts` (10.4) | 6 failed, 1 passed (test 4 pins). The reasons are right: 75 paused frames (1); no `iterate` frame after a command (2); 75 frames between pause and settle (3); `windowSize` is not a function (5); 2 < 10 frames (6); `world` undefined (7) |
| `pnpm -C web test` (10.5) | 6 failed (motion001 only), 128 passed, 3 skipped (G4, G4b, G8) |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web exec playwright test e2e/motion001.spec.ts` (9.2) | failed: `framesReceived` is undefined (the right reason) |
| Prototype: motion001 vitest | 7/7 passed |
| Prototype: full vitest (8.5) | 28 files, 134 passed, 3 skipped. All frozen tests are green, including polish005 6/7/7b, polish006 4/4b, compare 9, timeline 2/4/8, host F3/F6 and review3 G10 |
| Prototype: e2e motion001 + city.e2e diagnostics_panel_toggle (6.5) | 2 passed |
| Prototype: full e2e, independent-timer variant (load 9.7 → 16.4) | 125 passed, 1 skipped, 1 failed: diagnostics_panel_toggle (n8, timer lag) |
| Prototype, panel refreshed on cache refresh: diagnostics_panel_toggle + test 8, `--repeat-each=3` (load 14–16) | 6/6 passed |
| Vitest mutants | clear-on-post → T6 fails; FIFO → T6; drop newest → T6 (+ polish005 7); cap 3 / cap 5 → T6; world ignored → T7; noquiet → T1, 2, 3, 6, 7; a handler post clears dirty → T2; client "latest world per side" → T7 (`[B,1,8]`); no discard bump → all pass (n2) |
| e2e mutant: no Diagnostics timer (7.3–10.3) | test 8 fails 4/4 (gap 33.4–50.1 > ~29.2); diagnostics_panel_toggle fails |
