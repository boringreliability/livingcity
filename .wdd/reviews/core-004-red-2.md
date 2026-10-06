# Review core-004 RED 2

**Reviewer:** adversarial test reviewer (automated quality gate in place of the human approver), 2026-10-06
**Verdict:** REJECTED

Scope: `livingcity.md`, `.wdd/epics/core.md` § Frame / boundary format, `.wdd/wards/core/ward-004.md` (updated), `crates/sim-core/tests/core_004_frame.rs` (5 tests), `crates/sim-wasm/src/lib.rs`, `web/src/sim/*`, `web/tests/{clock,frame,sim,host}.test.ts` (17 tests), `git diff 3483a08 HEAD`.

RED state confirmed in the worktree: 5/5 Rust tests fail on `todo!()`/stub output, 17/17 Vitest tests fail (16 × `not implemented`, 1 × wasm `RuntimeError: unreachable` from `todo!()`), no compile/setup errors; `tsc --noEmit` is clean.

Reference and harness: `/tmp/ref004/repo` (updated to the current spec this round), `mutate_rust.py`, `mutate_wasm.py`, `mutate_ts2.sh` (new), `patch_r2_host.py`. Verified fix tests: `/tmp/ref004/fixes2_tail.ts` (G1–G8). No Rust fix tests are needed this round (no Rust MAJOR).

## Prior findings status (round 1)

| # | Round-1 finding | Status |
|---|---|---|
| 1 | BLOCKER test 7 window quantization | **Resolved.** Tolerance is `max(10 %, 1 tick/s)` and the spec fixes the window as `(now − 1 s, now]`. Passes under that convention. |
| 2 | BLOCKER SoA views over an AoS buffer | **Resolved** (option A). Accessors plus `words`/`floats`, an idempotency check and a buffer-unchanged check. |
| 3 | MAJOR behind can lie (cap snapshot) | **Resolved** for the original mutants: F2 and F2b catch C2b, C2c, C10 and C11. The new spec text introduces new problems: see M1–M3. |
| 4 | MAJOR pause untested in host | **Resolved** (F3). See B1: F3 has a hidden ordering assumption. |
| 5 | MAJOR frame rate limit | **Resolved** (F4). See B1. |
| 6 | MAJOR transfer | **Resolved** (F5). |
| 7 | MAJOR pooling | **Partly resolved.** F6 catches `pool-any`. The "others are dropped" half is untested (M5). |
| 8 | MAJOR frame consistency | **Resolved** (F7). |
| 9 | MAJOR reopen | **Resolved** (F8). |
| 10 | MAJOR ready values | **Resolved** (F9). |
| 11 | MINOR error semantics | **Resolved** in the spec. F10 covers unknown links and `createSim` failure. Commands before init are untested (m2). |
| 12 | MINOR frames while paused | Specified, but it can't be delivered as written (M4) and it is untested (M4). |
| 13 | MINOR backlogTicks / setSpeed validation | Specified. setSpeed validation is untested (m1). |
| 14 | MINOR C5 | Unchanged. Survives (m5). |
| 15 | MINOR R2 / R8 | Unchanged. "Saturating" is still in the spec, and R8 is unreachable (m6). |
| 16 | MINOR client/worker untested | Unchanged (m7). |
| 17 | MINOR Rust empty world | **Resolved** (test 12). It catches R6 and R9. |

## Findings

### B1. BLOCKER, spec defect: the tests assume a frame cadence and order that the spec does not state
The spec says only that the host "posts **at most** one frame per 16 ms" and "runs `iterate()` loops". The tests also need two more things. First, a frame on **every** iteration where ≥ 16 ms have passed. Second, the frame is posted **after** that iteration's ticks. Two implementations meet the spec as written and still fail:
- `H14`, `now − lastPost > 16` (strict). At a 16 ms loop it posts every 32 ms, which still satisfies "at most one per 16 ms". It fails test 11 (`fs.length > 200`), F4 (lower bound), F6 (`compared > 300`) and F3. F3 fails because `pausedAt` is taken from the last frame *before* the pause, which may predate the last step: "expected 191 to be 190".
- `H17`, post-then-step in each iteration. Each frame is internally consistent and lags by at most one iteration. It fails test 10, because the first frame after the command comes before the step that applies it, and F3, for the same stale-`pausedAt` reason.

**Fix (spec, one sentence; tests stay as they are):** "`iterate()` = `plan()` → `step(n)` → `report()` → post a frame iff `now − lastPost ≥ FRAME_INTERVAL_MS` (also when n = 0), so every frame reflects the state after the iteration's ticks and frames come at about 60/s." With this sentence, H14 and H17 become ordinary mutants, and they are caught. An optional extra hardening for F3: take `pausedAt` from the first frame with `clock.running === false`.

### M1. MAJOR, spec defect: a literal implementation of the spec shows `behind` while paused
Clause (b) says: "at least 1 s since the last resume or speed change and achieved < 90 % of target". While paused, achieved drops to 0 and the target is still `multiplier / DT`. After 1 s of pause the spec therefore *requires* `behind = true`. Because the host posts frames while paused, the readout says "cannot keep up" on every pause. That is a false claim, and the brief (§ performance) says this flag must be honest. Mutant C17 (no `running` gate) survives all 17 tests.
**Fix:** in the spec, add "`behind` is false while paused". Add test **G3** (verified).

### M2. MAJOR, test gap: the sticky cap event is never shown to expire
C12 latches the cap event forever: `behind` stays true after the first cap hit. It survives all 17 tests. F2 shows the event fires, but nothing shows it clears after 1 s. A plausible bug, and a visible one: one GC pause or background-tab stall, or one stretch at 60× followed by a switch back to 1×, leaves "behind" on for the rest of the session.
**Fix:** **G1**. Run smoothly at 60×, stall 1.5 s, check behind is true at once, then check behind is false throughout 2 s once the clock has kept up for more than 1 s.

### M3. MAJOR, test gap: the 1 s grace after start, speed change and resume is untested
C13 (no grace) and C14 (grace only on resume, not on speed change) survive all 17 tests. With C13, "behind" shows for about 1 s after every start, speed change and resume. With C14 it shows after every speed change: switching from 1× to 60× judges the old 2 ticks/s window against 120. That is a false "cannot keep up" on every click of the speed selector, which is exactly what the spec's grace clause exists to prevent.
**Fix:** **G2**. A fresh 1× clock, then a switch to 60×, then a pause and resume: behind is false at every iteration.

### M4. MAJOR, spec defect plus test gap: frames while paused can't make commands "visible immediately", and frames while paused are untested
- **Spec defect:** `World::schedule` only queues the command. `apply_commands` runs inside `step()` (`world.rs:434,640,877`), and the adapter schedules at the current tick. While paused, no step runs, so `closed` and flag bit1 cannot change. The spec's stated reason for frames while paused ("so commands are visible immediately") doesn't hold. In the reference, my first version of G4 ("close while paused → the next frame lists it") failed with `expected [] to … contain [50, 51]`. The user-visible effect: pause, click "Close central bridge", and nothing changes until resume. Pick one: (a) the frame carries pending commands (from `command_log()` entries with `tick ≥ tick()`, e.g. a `pending: Uint32Array` of `[kind, link]` pairs) so the UI can show "closing…"; or (b) the spec states that commands issued while paused apply at the first tick after resume and drops the "visible immediately" claim. Do **not** apply commands outside `step()`: that would break the core-003 determinism contract.
- **Test gap:** H7b (no frames while `running === false`) survives all 17 tests. F3's loop over paused frames is vacuous when none are posted. With H7b the UI never receives `clock.running = false`: the last frame was posted while running, so the readout shows a running, stale state while paused. Any fix (a) would also be invisible.
**Fix:** **G4** (verified). Paused for 100 iterations gives ≥ 95 frames, all at the paused tick with no error. A close issued while paused appears in the first frame after resume, ≤ 4 ticks later. If you choose (a), also assert the pending field in the paused frames.

### M5. MAJOR, test gap: returned buffers that don't fit are never shown to be dropped (unbounded pool)
The spec says "reuses a returned buffer only if its byteLength equals the next frame's exact size (**others are dropped**)". The direct implementation is `pool.push` on return plus an exact-size `findIndex` per frame. Without the dropping half (H15), it survives all 17 tests and grows without bound. The vehicle count changes almost every frame, so nearly every returned buffer is a mismatch. That is about 60 buffers/s × `count × 16` bytes, roughly 3 MB/s at 3 000 vehicles, retained in the worker. F6 checks only size and content.
**Fix:** **G8** (verified). Use an unpooled twin to learn future frame sizes. After frame i, return a buffer sized for a *later* frame but not for frame i + 1. No frame may ever carry such a buffer. This catches H15, the bounded-retention variant H16, and `pool-any`.

### Minor
- **m1 (test gap):** `setSpeed` ignoring invalid input (C15) is untested. NaN poisons the backlog permanently and the sim stops for good. The shipped selector can't produce NaN, hence MINOR. Test **G5** (verified).
- **m2 (test gap):** the "never throws" behavior for commands before init (H8 throws, H9 silently ignores) and for `iterate()` before init (H10) is untested. Test **G6** (verified).
- **m3 (test gap):** the lane mask is under-tested. With mask `0x3` (D5) all tests pass because the test lanes are only 0 and 2. Test **G7** (lane `0xAB` with higher bits set, verified).
- **m4 (spec note):** a `[now − 1 s, now)` window (C16) passes all 17 tests but fails G2. At 1×, with the status read right after `report()`, it flickers `behind` in about 1.6–3 % of iterations (probe: 16 ms / 16.7 ms loop, 1× and 2×). The spec's `(now − 1 s, now]` gives 0 % flicker across 1/2/5/10/60× and 1–34 ms jittered loops. Keep the window convention exactly as written. The Gold reviewer should check it.
- **m5:** C5 (a speed change bills the elapsed time at the new speed) still survives. Its effect is limited to one loop interval. The spec is also silent on whether clamping the backlog on a speed *decrease* counts as a cap event.
- **m6:** R2 (equivalent) and R8 (saturation is unreachable) still survive. "Saturating" is still in the spec; mark it defensive or drop it.
- **m7:** `client.ts` and `worker.ts` are covered only by the smoke and Playwright runs. The client must send `returnBuffer` with a transfer list.
- **m8 (cosmetic):** Tests table rows are out of order (11 after 20), row 20 bundles three tests, and the test names (`F2`…`F10`) don't match the ward numbers (13–20). In `host.test.ts`, F2b sits outside its `describe`.

## Reference results
I updated the reference to the current spec: the AoS accessor decoder (`variants/frame_accessor.ts`), achieved over `(now − 1 s, now]`, the sticky cap event (1 s), a slow criterion with 1 s grace after resume or speed change and a running gate, `setSpeed` ignoring invalid values, a host that posts while paused, transfers `vehicles`, reuses only exact-size buffers and clears the pool at each frame, and `error{message}` for unknown links, commands before init and `createSim` failure, with the cause included.
- Rust `cargo test -p sim-core --test core_004_frame`: **5/5 pass** (about 2 s incremental build, tests 0.00 s).
- Vitest: **17/17 pass** (about 0.4 s). With `fixes2_tail.ts`: **25/25 pass** (about 0.41 s). `tsc --noEmit` is clean for the reference plus fixes, and for the worktree.
- In the worktree stubs: 5/5 Rust and 17/17 Vitest fail, all for RED reasons.

## Mutation table
"17" = the current RED suite. "+G" = with `fixes2_tail.ts` added.

| # | Mutation | 17 | +G |
|---|---|---|---|
| R1, R3–R7, R9–R14 | Rust frame mutants (round 1) | caught | caught |
| R2 | queued `v <= 2` | survives (equivalent) | survives |
| R8 | wrap instead of saturate | survives (unreachable) | survives |
| W1–W13 | wasm adapter mutants (round 1, rebuilt with wasm-pack) | **all 13 caught** (5, 10, F7, F8, F9, F10) | caught |
| C1, C3, C4, C6–C9 | clock (round 1) | caught | caught |
| C2, C2b, C2c, C10, C11 | behind/achieved honesty (round 1) | caught (8, F2, F2b) | caught |
| C5 | speed change billed retroactively | survives (m5) | survives |
| C12 | cap event latched forever | **survives** (M2) | caught (G1) |
| C13 | no 1 s grace | **survives** (M3) | caught (G1, G2) |
| C14 | grace only on resume | **survives** (M3) | caught (G2) |
| C15 | setSpeed accepts NaN/0/−1/∞ | survives (m1) | caught (G5) |
| C16 | window `[now − 1 s, now)` | survives (m4) | caught (G2) |
| C17 | behind while paused (literal spec) | **survives** (M1) | caught (G3) |
| ignore-pause, defer-commands, post-every, no-transfer, stale-counts, pool-any | host (round 1) | caught | caught |
| H7 | no frame when n = 0 | caught (F4, incidentally) | caught (F4, G4) |
| H7b | no frames while paused | **survives** (M4) | caught (G4) |
| H8 / H9 / H10 | command before init throws / silent; iterate before init throws | survive (m2) | caught (G6) |
| H11 / H12 / H13 | init error without cause; unknown link silent; unknown link throws | caught (F10) | caught |
| H14 | strict `>` frame interval (spec-legal today) | **fails 11, F3, F4, F6** (B1) | fails (B1 spec fix makes it a mutant) |
| H15 | pool never drops mismatched buffers (unbounded) | **survives** (M5) | caught (G8) |
| H16 | pool keeps 4 mismatched buffers | survives | caught (G8) |
| H17 | post before step (spec-legal today) | **fails 10, F3** (B1) | fails (B1 spec fix makes it a mutant) |
| D3 / D4 | decoder copies; s offset wrong | caught (6) | caught |
| D5 | lane mask 0x3 | survives (m3) | caught (G7) |

## Notes for Gold reviewer
- After B1 is fixed, check in the browser that frames arrive at about 60/s at every speed and keep arriving while paused, and that `clock.running` in the readout becomes false on pause.
- Check `behind` in Playwright: 1× steady gives no flicker (m4). Switching 1× → 60× → 1× gives no false flash on the switch, and "behind" clears within about 1 s after load drops (M2, M3). Paused never shows behind (M1).
- Check M4 against the chosen semantics: pause, close the central bridge, and confirm the pending state (option a) or the application at the first resumed tick (option b).
- Harness: do **not** run `pnpm` in `/tmp/ref004/repo/web` (its `node_modules` is a symlink to the worktree's). Use `node_modules/.bin/vitest` directly. Mutants are selected via `MUT=<name>` (see `mutate_ts2.sh`). `mutate_wasm.py` rebuilds the wasm per mutant and restores it at the end.
