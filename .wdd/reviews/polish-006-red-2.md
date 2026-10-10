# polish-006 Red gate, review 2

**Verdict: REJECTED**

Reviewed at HEAD `bf72c2d`.
- sha256 `web/e2e/integration_polish.spec.ts` = `a3e669285849ecc3bb78449e7c07050130bb257fd610cdc174b36c00ce84f28f`
- sha256 `web/tests/polish006.test.ts` = `f0432076693eec40e7f9f34637549bbf38e20da9ea8ce4b9e4ebeb055e1de6bd`

Convergence rule applied: only MAJOR findings justify REJECTED. There is one MAJOR finding, and it is a round-1 MAJOR (#3) that is only partly fixed.

## Round-1 MAJOR findings: status
| # | Round-1 finding | Status |
|---|---|---|
| 1 | Test 4 did not start the replace with B viewed | **Fixed.** The replace starts with `viewed === 1` (`polish006.test.ts:70-75`). It fails on HEAD for the right reason: `frames come from A: expected 1 to be +0`. Errors are counted from `errorsBefore`. |
| 2a | The k3 alert-timing check was vacuous | **Fixed.** An in-page rAF recorder starts before the click (`integration_polish.spec.ts:131-154`), and the first frame is detected as `tick !== deadTick`. `frameRef` is never cleared on restart (`App.tsx:436` is the only writer), so the check holds. Probe on HEAD: `alertGone` 250 ms vs `firstFrame` 321 ms (phase 1) and 596 vs 678 ms (phase 2), so HEAD fails the check. |
| 2b | The bridge was disabled for the compare reason | **Fixed.** All three controls must have a title matching `/stopped\|halted\|restart/i`. On HEAD, phase 2's bridge title is "Exit comparison to change roads", so it fails. |
| 3 | The k2 selection and tracking checks were vacuous | **Partly fixed. See MAJOR 1.** Selection and the confirm dialog now survive to the trap (probe: `sel: 39`, confirm count 1), and HEAD fails on `selectedLink`. Tracked vehicle and Follow are still vacuous. |
| 4 | Test 1's compare timing could be gamed | **Fixed.** Polling starts in the next rAF. It requires `renderFrames` to advance and `drawnCameras` to be set (on) or cleared (off). `running` and `positionTick` come from the worker frame (`App.tsx:811`), not optimistic UI state. |
| 5 | k5 had no test | **Fixed.** Test 4b was added. On HEAD both halves fail: the compare reuse and the init reuse are both `true`. I checked the init half with a probe that soft-passed the compare half. |

## Findings

### MAJOR 1: test 3's tracked-vehicle and Follow checks are still vacuous (`integration_polish.spec.ts:193-206`)
The test tracks a vehicle and switches Follow on (193-196). Then it calls `stepBack(page)` and presses `b` (197-198). The seek is a jump: the host's `afterJump` sets `trackedTrip = null` (`host.ts:371`), and the UI drops Follow. When `debugTrap()` runs, neither is set any more.

A probe copy (deleted afterwards) logged the state just before the trap:

```
PROBE before trap {"sel":39,"tr":null,"f":false,"c":1,"closed":[],"br":1736,"sc":"A"}
```

So `expect(s.trackedTrip).toBeNull()` and `expect(s.following).toBe(false)` at 205-206 are true whatever Restart does. An implementation that leaves `followingRef` or `following` set across a restart would pass, although k2 names "tracked vehicle, Follow" explicitly. `closed` at 207 is also `[]` before the trap, because A is viewed before its closure tick (see MINOR 5).

**Fix:**
- Do the second `stepBack` first, then select the road, track the car and switch Follow on, and then press `b`. Opening the confirm dialog is not a jump.
- Or open the confirm dialog after tracking by some path that does not seek.
- Either way, assert the preconditions right before `trapAndRestart`: `selectedLink !== null`, `trackedTrip !== null`, `following === true` and confirm visible. Then no future reordering can make the assertions vacuous again.

### MINOR 1: test 4b's init half uses an empty frame (`polish006.test.ts:130-141`)
The re-init frame has `count 0` and `tick 0` (probe), so `staleA` is a 0-byte buffer. An implementation that never pools empty buffers (`bytes > 0 ? find(...) : undefined`) passes without clearing pools on init. A natural implementation still fails on HEAD, so this is MINOR.
- Use a frame with vehicles, for example after a fixed `iterate(k)` with `setRunning` at a fixed fake-clock speed, which is deterministic.
- Also cover B's pool across init, for example `returnBuffer` with `scenario: 1` before the re-init.

### MINOR 2: j2 and k4 still have no test
These are stated Outputs: the "**?** (Guide) button" wording in the docs and the tooltip, and `index` listed as derived in `timeline.rs`. Round 1 rated this MINOR, and I keep that rating because both are doc and comment wording that the Gold reviewer can verify by reading. Cheap static checks would close the gap.

### MINOR 3: test 9 checks only that `frame-cost.json` exists (`polish006.test.ts:198`)
The file already exists from polish-005, so the test cannot detect whether the `frame_cost_probe` re-run (k1) happened. The before/after regex at 202 matches any line that contains "stress", "before" and "after" (round-1 #8, still open).

### MINOR 4: test 7's escape hatches (`polish006.test.ts:144-162`)
- The config check covers the root only, not `crates/*/rustfmt.toml`. None exists today.
- An `ignore = [...]` key is not checked.
- `#![rustfmt::skip]` or `#[rustfmt::skip]` in a source file would silence the check. `grep` finds none today.

Asserting that `crates/**/src` has no `rustfmt::skip` closes this.

### MINOR 5: test 3's closure check is vacuous, and pending seek is not covered
- `closed` is `[]` before the trap (see the probe above), so the "no closure" check at 207 says nothing.
- k2's "pending seek" is never set up.

### MINOR 6: test 6 accepts a 1 px offset change
Any change in outline offset or width passes test 6 (`integration_polish.spec.ts:278-295`). A visibly negligible change, such as `-2px` to `-3px`, would satisfy it. The Gold reviewer should check by eye.

### MINOR 7: the first-frame detector in test 3 can be delayed
The detector `tick !== deadTick` (`integration_polish.spec.ts:141`) is delayed if the new world's first frame happens to equal `deadTick`. That would make a correct implementation fail, not pass. This is a flake risk only; `deadTick` was 1616 and 1704 here.

## Frozen-test conflicts
None found.
- **`restart.spec.ts`:** it waits up to 60 s for the alert to go after Restart (`:31`), which is compatible with k3 keeping the alert until the worker is ready. Space on the slider while halted is unaffected when Play is disabled.
- **`a11y.spec.ts`, Esc from confirm:** the confirm `autoFocus`es inside the panel, so the slider still gets focus, which agrees with test 5's third case.
- **The rustfmt gate:** it touches only `crates/*/src` and `crates/sim-core/examples`. No frozen file is involved.
- **Backlog accounting:** the backlog has 67 `- **<id>` leads, which is consistent with test 8's regex and the `> 60` guard.

## Commands run (with load)
1. `uptime`: load 7.95 / 6.94 / 8.48 at the start.
2. `pnpm -C web exec vitest run tests/polish006.test.ts` (load 7.65). Five tests, all failing for the right reasons:
   - **4:** scenario 1 after the failed replace.
   - **4b:** B pool reuse.
   - **7:** `Diff in cities.rs` (8 lines shown).
   - **8:** ENOENT on `docs/known-issues.md`.
   - **9:** `baseline-1x.json` is dated 2026-10-08.
3. A probe copy of 4b with the compare assertion soft (deleted). Both reuses are `true` on HEAD, and the init half fails with `pools cleared on init`. The init frame is `count 0, tick 0`.
4. `pnpm -C web typecheck`: clean.
5. `pnpm -C web exec playwright test e2e/integration_polish.spec.ts --reporter=line` (load 7.36 at the start, 11.84 at the end): 4 failed and 1 passed.
   - **1:** medians were pause 107, play 153, seek 102, compareOn 368 and compareOff 814 ms. It fails on compareOn, which is the right reason. Pause, play and seek already pass and act as pins.
   - **2:** passes, as a pin, which is acceptable.
   - **3:** fails on the Play button being enabled while halted (k3).
   - **5:** fails because focus is not on the body after Esc.
   - **6:** fails because Guide shows `solid|2px|-2px|none` both focused and unfocused.
6. Probe copies of test 3 (deleted; load 10.75 to 11.35, then 10.88). I logged the state before and after the trap with the k3 checks softened.
   - **Phase 1:** tracking and Follow were already cleared before the trap (MAJOR 1). HEAD fails on `selectedLink` (39 survives the restart) and would also fail on the guide steps (`[true,false,true,true,false]` survive).
   - **Phase 2:** compare, the panel and canvas B are already cleared on HEAD, so these checks act as pins. The alert timing fails on HEAD in both phases.
7. A probe copy of tests 5 and 6 (deleted; load up to 17.5).
   - **Test 5:** body-focus fails, the Live button exists and is enabled, and Live loses focus on HEAD. Both are correct failures.
   - **Test 6:** all three toggles are reached by Tab with `:focus-visible` true, and all three show identical ring geometry on HEAD. All are correct failures.
8. `git status --short`: clean apart from this file.
