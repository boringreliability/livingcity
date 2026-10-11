# motion-001 Red gate, round 1

**Verdict: REJECTED**

Reviewer: fresh adversarial Red-gate subagent, 2026-10-12. Worktree HEAD 6f35b8b.

## Files under review (sha256)
- `web/tests/motion001.test.ts`: `1e03a02181303d3455599eac2c643d575b1ff3ded6da33769e8ba5d5465d6fa7`
- `web/e2e/motion001.spec.ts`: `c56fcea0165848353935a25f660ff8b4fe025c4a602aa8a8594a6e6099e1adb2`

## Supersession check
- `git diff 19e9fbf..HEAD -- web/tests web/e2e crates/*/tests` touches only `motion001.test.ts`, `motion001.spec.ts` (new) and `review2.test.ts` / `review3.test.ts`. The changes in those two are only `test(` → `test.skip(` plus a SUPERSEDED comment, for G4, G8 (review2) and G4b (review3). Nothing else changed.
- The hashes at 19e9fbf match the log: review2 `f3856bebe4ff66eb7fd3d46dbc29e18d980e986625af114faed576284d496c0a`, review3 `499373ef9bd76ca20e783b2e1768f9e0ce714f0acbda52911d8b385fb8297c7e`. The log records them only in abbreviated form (see m6).
- G4 and G4b intent (paused tick unchanged, no paused frame shows the closure, the closure is in the first resumed frame ≤ 4 ticks later, no error) is carried in full by test 4, which passes as a pin today.
- G8 intent ("no unbounded pool", no wrong-size reuse) is carried by test 6 (a mutant without the cap fails it). **The point of S3, though, is to allow bounded reuse, and nothing pins that (M1).**

## Method
- I ran the tests against the current code to check that they fail for the right reasons.
- I wrote a throw-away prototype implementation in an untracked copy (`.probe-web/`, since deleted) to check two things:
  - (a) that the new tests and all frozen tests can pass together;
  - (b) mutants that take shortcuts.
- Prototype design:
  - a dirty flag;
  - a settling frame at pause + 1016 ms;
  - LIFO pools capped at 4;
  - a world per side;
  - `report` trims the window;
  - client: a `createWorker` option and a buffer→{world, scenario} WeakMap.
- I also ran the full e2e suite against the prototype.

## MAJOR findings

### M1. Test 6 passes with the superseded "drop the whole pool on every post" behaviour
`web/tests/motion001.test.ts:192-218`
- **Mutant:** the prototype plus `pools[side] = []` after every take, i.e. LIFO but the pool is cleared on each post. That is exactly G8's pinned behaviour with the order reversed. Result: **all 28 tests in motion001/polish005/polish006/host pass.**
- **Why:** test 6 asserts only that:
  - `fs[0]` is `returned[9]`;
  - `used.length > 0`;
  - `used.length ≤ 4`.

  With a cleared pool, `used.length === 1` satisfies all three.
- **What is not verified:** the Output "the rest stay, up to the cap, and the oldest are dropped first". That is the very behaviour S3 supersedes G8 to allow (the user's §2 bullets "buffer-pool behavior that prevents sensible bounded reuse" and "reuse suitable buffers where practical").
- **Fix:**
  - Return the 0-length and wrong-size buffers *first* (so they cannot take cap slots, whose accounting the spec leaves open), then the 10 fitting ones.
  - Assert that the first four message-driven frames carry exactly `returned[9], returned[8], returned[7], returned[6]` in that order, and that frames 5–10 carry none of `returned`.
  - That pins the cap (4), LIFO order, oldest-dropped-first and retention.
  - Also update the Tests table row ("At most 4" → "exactly the 4 most recent, newest first").

### M2. A frozen e2e test depends on paused frames and the ward neither lists it nor gives the implementer an Output for it
`web/e2e/city.e2e.spec.ts:126-135` (diagnostics_panel_toggle, frozen since city-005)
- After `pause(page)`, the test requires the Diagnostics panel's render row to follow the hook's live `render.intervalMedianMs` ("rAFs continue while paused: the render row follows the hook loosely").
- Today that panel is refreshed by the ~60/s paused frames.
- With a quiet host (the prototype), the test fails reproducibly:
  - full run: 33.2 vs ≤ 12.47;
  - `--repeat-each=2`: 16.8 and 33.3 vs ≤ 12.5;
  - 2/2 failed.
- Against the current code it passes 2/2.
- The intent is valid ("controls responsive while paused" in user §2), so it is not a supersession candidate. The ward must:
  - add it to "Kept frozen, and must stay green";
  - add an Output such as "while paused, the Diagnostics panel's render statistics refresh from the UI's own timer, independent of worker frames";
  - ideally extend test 8 to assert that the panel's render row changes or keeps tracking while paused and quiet.

  Without this, a Gold implementer following the spec literally breaks a frozen test.
- Other full-e2e failures in the probe were environment-only:
  - `fonts.spec`: Vite fs allow for the symlinked node_modules;
  - `city.spec`: 403 on the font files.

  The other 123 passed with the quiet host.

## MINOR findings
- **m1. Spec wording vs frozen tests ("stepped" vs "running").** The Output says `iterate` posts "when the sim stepped (as before, at most every 16 ms)". Implemented literally (post only when `n > 0`), it breaks three frozen tests that run at low speed:
  - `polish005` 6: "frames while running" got 4, needs ≥ 10;
  - `polish005` 7: 28 frames seen, needs > 100;
  - `review3` G10: 24, needs > 70.

  With "while the clock is running, at most every 16 ms" everything passes. The motion-001 tests themselves are compatible with both readings. Reword the Output to "while running".
- **m2. Test 2 does not check the "a post inside a handler does not clear dirty" rule** (`motion001.test.ts:103-111`). For `seek` and `viewScenario` the handler posts itself, so `frames > n` holds even if `iterate` adds nothing. Fine as behaviour, but that clause of the spec is untested. Either drop the clause or count only the frames posted by `iterate`.
- **m3. Test 7's discard leg asserts nothing that discriminates** (`:249-253`). It only checks that the last frame is scenario 0, and B's late returns can never reach A's pool anyway. Mutant "no world bump on discard" passes everything. Not a safety hole (the next branch bumps and clears), but the table claims "increments … on discard". Either assert `world` on the next B after a re-branch, or that a re-branch's frames never carry the late buffers. B returns before a re-init are not exercised either.
- **m4. Test 7's client leg uses one frame and passes the same scenario as the frame.** It cannot tell "per-buffer world/scenario" (the spec) from "latest world per side" or "echo the passed scenario". Add a second frame (another world) and return the first buffer; also return with the other side as the argument. In practice App returns synchronously, so the risk is low, except for the held `pendingPairA`.
- **m5. polish005 7b's regex constrains the client.** It requires the literal `returnBuffer: (buffer, scenario) => send({ type: 'returnBuffer', buffer, scenario }`. `world` (and the frame's scenario) can therefore only be added inside `send` or a wrapper, not in that object literal. It can be satisfied, but say so in the ward so Gold does not trip on it.
- **m6. Hashes and probe file.**
  - `supersessions.md` gives abbreviated hashes (`f3856beb…c0a`); record the full sha256.
  - `paused_probe.mjs` is not in the repo (no `web/scripts/`), so "after, same probe" cannot be reproduced by the Gold reviewer. Check it in now.
- **m7. Test 3 can be satisfied by reporting `achievedTicksPerS = 0` while paused** with no settling frame at all. That is acceptable user-visibly; note it as allowed or forbid it explicitly.
- **m8.** Test 2 checks `w.errors()` but never `c.errors()` for the comparing host (`:127`).
- **m9.** Not covered by any automated test, only by the manual smoke:
  - a vehicle click while paused (the vehicle panel fills);
  - "(pending)" while paused.

## Results (load in parentheses)
| Command | Result |
|---|---|
| `pnpm -C web exec vitest run tests/motion001.test.ts` (load 6.7) | 6 failed, 1 passed (test 4 pins). Failure reasons are right: 75 paused frames (1); no frame within 4 ms after a message (2); 75 frames between pause and settle (3); `windowSize` missing (5); 2 frames < 10 (6, no dirty frames); `world` undefined (7) |
| `pnpm -C web test` (load ~7) | 6 failed (motion001 only), 128 passed, 3 skipped (G4, G4b, G8) |
| `pnpm -C web typecheck` | clean |
| `pnpm -C web exec playwright test e2e/motion001.spec.ts` (load 9.2) | failed at `framesReceived` undefined (right reason) |
| Prototype: full vitest | all green except two environment-only probe failures (fonts build, missing e2e dir) once posting while running is kept (m1) |
| Prototype: motion001 e2e | passed (11.2 s), so test 8 can be satisfied |
| Prototype: full e2e (load 9–20) | 123 passed, 3 failed: diagnostics_panel_toggle (M2, reproducible), plus fonts and a city font 403 (environment) |
| Mutants | no cap → test 6 fails; world ignored → test 7 fails; cap at the wrong end → test 6 fails; **clear on post → all pass (M1)**; no discard bump → all pass (m3) |
