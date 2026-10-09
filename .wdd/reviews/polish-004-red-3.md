# polish-004 Red review #3

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 6 MINOR)

Reviewed files at HEAD `c4c0579`:
- `web/e2e/guide.spec.ts`, sha256 `84d9651218c0643745753717b5930919c9778973a9004aa8c4aeab9d154c4456`
- `web/tests/guide_static.test.ts`, sha256 `e68e439e560418a6dfffa8997b39ad9060d54027ef6f7e9fb9535b85e12eb9ce`

## What I ran
All probes are in `scratchpad/red-p004-r3/`.

**1. A reference guide that is correct per P4, run against the real e2e spec.**
- `inject.js` is a DOM-only guide, injected through a Vite config (`vite.inject.config.mjs`, port 5311). It reads `window.__livingcity.snapshot()` every 50 ms and implements P4 literally:
  - `section.panel[aria-label="Demo guide"]` at the top of `.side`, ≤ 100 px tall;
  - step rules from frame ticks, with step 2 at `tick − firstSeenClosedTick ≥ 360`;
  - the hint, ×, Esc → focus "Guide", a "Guide" toggle with `aria-pressed`, and `localStorage` in try/catch.
- The spec ran as a byte-identical copy of `guide.spec.ts`, with only two changes:
  - the `GUIDE_STEPS` import was inlined as the 5 titles;
  - two `console.log` probes were added.
- **Result: 7/7 passed (2.3 min).**
- Measured timings:
  - **Test 2:** paused at `closedAt + 282` (and 281 and 280 in later runs). The limit is < 360, so the margin is about 78 ticks, or 2 s at 20×.
  - **Test 3:** 1× for 12 s gave **24 ticks**, with `running = true` and Speed value `"1"`.
- This answers the timing questions:
  - `SPEEDS = [1, 5, 20, 60]`, so `selectOption('1')` works;
  - DT = 0.5 s, so 1× is 2 ticks/s;
  - pausing at about 280 with 50 ms polling stays far below 360;
  - Space resumes correctly after `pause()`, because `pause()` blurs, so focus is on `body` and the global handler toggles.

**2. Deliberately wrong guides (`window.__W` variants), each run against the relevant tests.**

| Variant | Rule | Result |
|---|---|---|
| `walltime` | step 2 = closed ∧ running for ≥ 5 s `performance.now()` | **fails** test 3 at `:187` (the 1× block) |
| `frames` | step 2 = ≥ 100 frames while running and closed | **fails** test 3 at `:187` |
| `thresh60` | step 2 at 60 ticks | **fails** test 2 at `:90` |
| `s3nos1` | step 3 without the step-1 precondition | **fails** test 7 at `:276` |
| `wall20` | step 2 = closed ∧ running for ≥ 20 s wall time | passes tests 2 and 3 (MINOR 1) |
| `wallxspeed` | step 2 = Σ wall × speed × 2 ≥ 360 while running | passes tests 2 and 3 (MINOR 1) |

**3. Static test 4 against a plausible correct `DemoGuide.tsx`** (`scratchpad/red-p004-r3/DemoGuide.tsx`, copied into `web/src/ui/` only while running, then deleted).
- The implementation has:
  - a `readonly` props interface with data members and `readonly onHide: () => void`;
  - `import type` from `../sim/protocol`;
  - hint and JSX text containing "to branch (an intervention…".
- **Test 4 passes.** Test 9 fails as expected, because `docs/demo.md` is not yet updated.
- A variant with an extra `readonly setSpeed: Dispatch<number>` prop **also passes** (MINOR 2).

**4. Cleanup.**
- I deleted the temporary spec, config and `DemoGuide.tsx`, plus `web/test-results/`, which is gitignored output.
- Port 4243 and port 5297 (another session's Vite) were untouched, and no probe server is left running.
- `git status` is clean apart from this file.

## Round-2 findings: status
| R2 | Status |
|---|---|
| MAJOR 1: step 2 by running wall time or frames | **Resolved for plausible rules.** The 1× 12 s block (`guide.spec.ts:178-187`) catches a 5 s running-wall rule and a frame-count rule (probe evidence above). A residual narrow gap remains, see MINOR 1. |
| MINOR 1: no lower bound on the 3-min threshold | **Resolved** (`:85-91`). The 60-tick variant fails; the pause lands at +280–282. |
| MINOR 2: step 3 needs step 1 | **Resolved** (`:276`). The variant fails. |
| MINOR 3: brittle static regexes | **Resolved for the reported cases** (`guide_static.test.ts:18-23`). `readonly`, `extends`, `VoidFunction`/`*Handler` and "branch (" in strings all pass with a correct implementation. See MINOR 3 for one remaining form. |
| MINOR 4: Tab focus by name construction | **Resolved** (`:255-260`, element identity). |
| MINOR 5: discard stickiness, Esc remembered, "offers to hide itself" | Still untested (MINOR 4 below). |
| MINOR 6: hint "below A's head" | Still untested (MINOR 5 below). |
| MINOR 7: size limits not asserted directly | Unchanged. Covered indirectly; the reference guide at ≤ 100 px passes test 1. |

## Findings

### MINOR 1: some wall-time step-2 rules still pass (`guide.spec.ts:93-94`)
Two rules pass all of tests 2, 3 and 7. Both were verified by the probes above.
- **A running-wall-time rule with a threshold of about 12–39 s.** Test 3 at 1× catches thresholds below 12 s. Test 2 never pauses after 380 ticks, though: the poll at `:94` keeps the sim running for up to 30 s more, so a 20 s rule ticks inside the poll window.
- **A wall × speed accumulator.** It equals sim ticks whenever the engine keeps up, so no test at a sustainable speed can tell it apart. It is wrong only when the engine is behind.

The first rule needs a contrived threshold, and the second only diverges under engine lag. That is why this is MINOR.

**Cheap fix** (optional; it closes the whole running-wall and frame-count class, because 9.5 s < 12 s):
- In test 2, replace `:93-94` with: poll `tick > closedAt + 380`, then `await pause(page)`, then `expect.poll(done[1]).toBe(true)` while paused.
- The `pause()` at `:97` then becomes a no-op.

**Gold reviewer:** check in code that step 2 derives from frame ticks (`frame.clock`/tick), not from `performance.now()` or speed × wall time.

### MINOR 2: test 4's "one function-typed prop" check misses generic callback types (`guide_static.test.ts:23`)
A `setSpeed: Dispatch<number>` (or `SetStateAction`, or a type alias for `() => void`) prop is not counted. A bare `setSpeed(60)` call is not caught either: `:19` matches member calls only, and `:18` covers only `postMessage`/`createSimClient`.

A guide wired to drive the speed through such a prop passes test 4 (verified). This is MINOR because the e2e tests would likely expose visible driving: for example, the hint test checks Speed = 20 before the hint. The Gold reviewer also reads `DemoGuide.tsx`.

**Optional fix:** also add `Dispatch|SetStateAction` to the function-type alternatives. **Gold reviewer:** confirm that `App.tsx` passes no setter or client into `DemoGuide`.

### MINOR 3: `type DemoGuideProps = Readonly<{ … }>` is rejected (`guide_static.test.ts:21`)
That form is a "type" per the spec, but the regex requires `= {`. A correct implementation written that way fails test 4.

**Fix:** either accept `(?:Readonly<)?` before the `{`, or note "plain `interface`/`type X = {`" in the ward spec. The implementer can simply avoid the form, hence MINOR.

### MINOR 4 (carried): some requirements have no test
- stickiness after **Discard branch**;
- Esc-hide being remembered across a reload;
- "Demo complete … offers to hide itself".

**Fix:** at the end of test 2, click "Discard branch" and expect `[true×5]`. The Gold smoke test should cover the rest.

### MINOR 5 (carried): the hint's "below A's head" condition is untested
A hint shown whenever B is viewed below 60× passes test 7. This is cosmetic (d1); I note it for the Gold smoke test.

### MINOR 6: test 2's lower bound is about 280 ticks, not 360
A threshold of about 290–359 ticks still passes, because the pause measured at +280–282. Tightening the bound would trade it for flakiness, so the current bound is a reasonable compromise. No change needed.

## Verified sound
- **A literal, correct P4 guide passes all 7 e2e tests and static test 4** (probe 1 and probe 3). So the tests do not over-constrain a correct implementation:
  - right-column placement;
  - the paused-at-280 window;
  - the 1× block;
  - Esc/Tab;
  - storage-blocked;
  - warm-up `toHaveCount(0)`.
- **Every round-2 rule the tests were changed to catch now fails as intended:**
  - `walltime` and `frames` fail at `:187`;
  - `thresh60` fails at `:90`;
  - `s3nos1` fails at `:276`.
- **The test-3 setup is sound:**
  - `selectOption('1')`/`('60')` match `SPEEDS` option values;
  - `selectOption` fires no pointerdown, so `blur(page)` is needed and present;
  - the reopen at `:195` while paused and the subsequent Space work.
