# polish-006 Red gate, review 3

**Verdict: APPROVED**

Reviewed at HEAD `612c33d`.
- sha256 `web/e2e/integration_polish.spec.ts` = `b9b5fdc47ac59262535a4a463dc1882cf75b2b047606cd93c08a78d891fa9719`
- sha256 `web/tests/polish006.test.ts` = `8621b611bba81748bb13e395f2d2763f72cc98f0ff76a0ef02322edfc8fce44c`

Convergence rule applied: only MAJOR findings justify REJECTED. None found.

## Earlier MAJOR findings: status
| Review | Finding | Status |
|---|---|---|
| r1 #1 | Test 4 did not start the replace with B viewed | Fixed (unchanged since r2). Fails on HEAD with `frames come from A: expected 1 to be +0`. |
| r1 #2a/#2b | k3 alert timing vacuous; bridge disabled for the compare reason | Fixed (unchanged since r2). Probe on HEAD: `alertGone` 230 ms < `firstFrame` 298 ms, so the timing check fails on HEAD. All three controls are enabled with no title on HEAD. |
| r1 #3 / r2 MAJOR 1 | k2 tracked vehicle and Follow checks vacuous | **Fixed.** The rewind now comes before tracking (`integration_polish.spec.ts:173-198`), and the preconditions are asserted right before the trap (`:203-206`). Probe on HEAD: before the trap `{"sel":38,"tr":4474,"f":true}`, after Restart `{"sel":38,"tr":4474,"f":true}`, with the confirm still open and guide steps `[true,false,true,true,false]`. So selection, tracking, Follow, confirm and guide progress all fail on HEAD for the right reason. `trackedTrip` and `following` come from App refs (`App.tsx:819,822`), not from the worker, so a fresh worker cannot satisfy them by itself. |
| r1 #4 | Test 1 compare timing could be gamed | Fixed (unchanged since r2). Polling starts in the next rAF and requires `renderFrames` to advance and `drawnCameras` to be set or cleared. The render loop draws every rAF (`App.tsx:532-577`), so the requirement can be met. |
| r1 #5 | k5 had no test | Fixed. Test 4b's init half now uses a warmed-up frame. Probe: first frame after init is `tick 1200, count 165, 2640 bytes`, and with the compare half softened, HEAD fails on `pools cleared on init` (reuse `true`). r2 MINOR 1 is resolved. |

## Findings

### MAJOR
None.

### MINOR 1: j2 and k4 still have no test (carried from r1/r2)
The "**?** (Guide) button" wording (docs and tooltip) and `index` listed as derived in `timeline.rs` have no test. The Gold reviewer must verify both by reading.

### MINOR 2: test 3's closure check is still vacuous; pending seek not set up (r2 MINOR 5)
`closed` is `[]` before the trap (probe `pre.closed: []`), so `expect(s.closed).toEqual([])` at `:213` says nothing. k2's "pending seek" is never set up. The Gold reviewer should check both.

### MINOR 3: test 9 checks only that `frame-cost.json` exists, and the before/after regex is loose (r2 MINOR 3)
`polish006.test.ts:200,204`. The Gold reviewer should confirm that `frame_cost_probe` was re-run (check the file's content or date) and that the stress before/after is real.

### MINOR 4: test 7's escape hatches (r2 MINOR 4)
There is no check for `rustfmt::skip`, for `ignore =` in the config, or for crate-level `rustfmt.toml`. None exists today; the Gold reviewer should grep the diff for them.

### MINOR 5: test 6 accepts any 1 px geometry change (r2 MINOR 6)
The Gold reviewer should check by eye that the ring is clearly visible.

### MINOR 6: B's pool across init is not covered in 4b
The init half returns only an A buffer (`scenario 0`). An implementation that clears only A's pool on init would pass. k5 says "both frame pools". The Gold reviewer should read the init path.

## Frozen-test conflicts
None found.
- `restart.spec.ts:31` waits up to 60 s for the alert to go, which is compatible with k3.
- `polish005.test.ts:73-110` (per-side pools while comparing) never leaves compare, so clearing B's pool on leaving compare does not conflict with it.
- `a11y.spec.ts` Esc from confirm: the confirm autofocuses inside the panel, which agrees with test 5's third case (as r2 found).

## Commands run (with load)
1. `uptime`: load 17.65 / 12.86 / 10.65 at the start.
2. `shasum -a 256` on both test files (above).
3. `pnpm -C web exec vitest run tests/polish006.test.ts` (load 16.30): 5 failed, all for the right reasons:
   - **4:** `frames come from A: expected 1 to be +0`.
   - **4b:** `B pool cleared when compare was left: expected true to be false`.
   - **7:** 8 `Diff in .../cities.rs` lines.
   - **8:** ENOENT on `docs/known-issues.md`.
   - **9:** `baseline-1x.json` is dated 2026-10-08.
4. `pnpm -C web typecheck`: clean.
5. Probe copy of 4b with the compare assertion softened (deleted afterwards). Compare reuse is `true`; the init frame is `1200/165/2640 B`; it fails on `pools cleared on init`.
6. `pnpm -C web exec playwright test e2e/integration_polish.spec.ts --reporter=line` (load 13.3 at the start, 13.6 at the end): 4 failed, 1 passed.
   - **1:** medians were pause 168, play 113, seek 104, compareOn 255 and compareOff 802 ms. It fails on compareOff, which is the right reason; r2 measured compareOn 368 and compareOff 814.
   - **2:** passes, as a pin.
   - **3:** fails at the k3 check `toBeDisabled` (Play is enabled while halted). This is after the new preconditions, which therefore hold on HEAD.
   - **5:** fails because focus is not on the body after Esc.
   - **6:** fails because Guide shows `solid|2px|-2px|none` both focused and unfocused.
7. Probe copy of test 3 with the k3 checks softened and the state logged (deleted afterwards; load 11.96 to 12.39). The results are in the table above: every k2 field survives Restart on HEAD, and the test fails on `selectedLink` (38).
8. `git status`: clean apart from this file.
