# Review core-004 RED 3

**Reviewer:** adversarial test reviewer (automated quality gate in place of the human approver), 2026-10-06
**Verdict:** REJECTED

Scope: `livingcity.md`, `.wdd/epics/core.md` § Frame / boundary format, `.wdd/wards/core/ward-004.md` (updated: `iterate()` order, behind false while paused, 1 s grace, sticky cap expiry, paused-command semantics, pre-init safety), `crates/sim-core/tests/core_004_frame.rs` (5), `crates/sim-wasm/src/lib.rs` (stub), `web/src/sim/*` (stubs), `web/tests/{clock,frame,sim,host,review2}.test.ts` (25 Vitest), `git diff 6bb3e74 HEAD`.

`web/tests/review2.test.ts` is byte-identical to the round-2 verified fix tail (G1–G8), apart from its header comment.

RED state confirmed in the worktree: 5/5 Rust tests fail on `todo!()` panics. 25/25 Vitest tests fail: 24 with `Error: not implemented` and 1 with wasm `RuntimeError: unreachable`. There are no compile or setup errors, and `tsc --noEmit` is clean.

## Prior findings status (round 2)

| # | Round-2 finding | Status |
|---|---|---|
| B1 | BLOCKER: frame cadence and order unstated | **Resolved.** The spec now fixes `plan → step → report → post iff now − lastPost ≥ 16`, including at `n = 0` and on the first iteration. H14 (strict `>`) and H17 (post before step) are now ordinary mutants, and both are caught. |
| M1 | MAJOR: behind while paused | **Resolved.** The spec says "always false while paused", and G3 catches C17. |
| M2 | MAJOR: sticky cap never shown to expire | **Resolved.** G1 catches C12 (latched forever) and C19 (2 s). Expiry that is *too early* is still loosely tested: see m1. |
| M3 | MAJOR: grace untested | **Resolved.** G2 catches C13, C14 and C16. Grace on the *first* start is not distinguished from construction: see m2. |
| M4 | MAJOR: paused commands / frames while paused | **Resolved** with option (b): applied at the first resumed tick. G4 catches H7b, H18 (paused commands dropped) and H23 (applied one tick late). One leftover contradictory sentence: see m3. "Paused frames show the unchanged state" is not asserted: see m4. |
| M5 | MAJOR: pool never drops | **Resolved.** G8 catches H15, H16 and `pool-any`. |
| m1 | setSpeed validation | **Resolved** (G5 catches C15). |
| m2 | pre-init safety | **Resolved** (G6 catches H8, H9, H10). One gap remains: iterating before init may post (H22), see m5. |
| m3 | lane mask | **Resolved** (G7 catches D5). |
| m4 | window convention | **Resolved** (G2 catches C16). |
| m5 | C5, plus speed-down clamp as a cap event | **Open** (m6). |
| m6 | R2 / R8, "saturating" | **Open** (m7). |
| m7 | client/worker untested | **Open** (m8). |
| m8 | table order and naming | **Open** (m9). |

## Findings

### M1. MAJOR, test gap: the "at most one frame per 16 ms" limit is only tested with a perfectly uniform loop
F4 uses a constant 2 ms loop. A uniform loop cannot tell `lastPost = now` apart from the drift-free accumulator `lastPost += FRAME_INTERVAL_MS`. Mutant H20 (the accumulator) **survives all 25 tests**, and it violates the spec in two ways:
- **Jitter:** with irregular iterations (for example 20 ms, then 30 ms, then 34 ms) it posts frames 14 ms apart.
- **Stall:** after any stall of S ms (GC, a slow batch, a backgrounded tab), `lastPost` lags by S, so the host posts a frame on **every** iteration until it catches up. That is about S/16 frames back to back, each with a fresh `ArrayBuffer`, because the pool cannot keep up. On the UI thread this is a burst of messages and React updates at loop speed: a 1 s stall gives about 62 frames in tens of ms.

The mistake is plausible, and the spec invites it. With `now − lastPost ≥ 16` and a loop period p, frames arrive every `ceil(16/p)·p` ms. A 10 ms loop gives 20 ms, so the readout shows 50 fps instead of 60. The textbook "fix" for that drift is the accumulator, which is exactly H20.

**Fix:**
- **Spec**, one clause: "`lastPost` is the wall time of the previous post (`lastPost = now`), so frames are never closer than 16 ms, even after a stall."
- **Test:** add **G10** (verified, `/tmp/ref004/fixes3_tail.ts`). It runs a jittered 1–12 ms loop, then a 1 s stall, then a 2 ms loop. Every gap between frame posts must be ≥ 16 ms, and after the stall there must be about 1200/16 frames (no burst and no gap). G10 catches H20 and H14.

### Minor
- **m1 (test gap): sticky cap expiry that is too early.** G1 checks behind only on the clamp iteration, then after 1.1 s. F2 reads status about 7.8 ms after the clamp, so it does catch the plausible ms/s unit slip `now − lastCap < MAX_BACKLOG_S` (C26). Any expiry between about 8 ms and 1 s still passes all 25 tests: C20 (250 ms) survives, and C25 (1100 ms) survives as a near-equivalent. I found no plausible mistake in that range beyond C26, so this is MINOR. Optional **G9** (verified) asserts behind on every status strictly within 1 s of a single clamp, then false after it. It catches C11, C12, C20, C25 and C26.
- **m2 (test gap): grace on the first start.** G2 builds and starts the clock at the same instant, so "grace from construction" is never told apart from "grace from start". C21 (the grace window is reset only on a *resume*, not on the first start; for example, implemented through a `pausedAt` that is unset before the first start) survives. The effect: if the app starts paused and the user presses play later, there is a false 1 s "behind" flash. Optional **G2b** (verified).
- **m3 (spec defect): a leftover contradiction.** The host bullet still says frames while paused are posted "so commands are visible immediately". The new bullet says the opposite: a command issued while paused applies at the first resumed tick, and paused frames show the unchanged state. A Green implementer who satisfies the old sentence would put pending closures into `closed` (H21). Replace it with "…so the paused state and clock status stay current".
- **m4 (test gap): "paused frames show the unchanged state" is not asserted.** G4 checks only the tick of paused frames. H21 lists the pending closure in `closed` while paused, and it survives. In the readout, a closure shows while it is not yet in effect, and the frame disagrees with its own records: no bit1 flags and unchanged link counts. Optional **G4b** (verified).
- **m5 (test gap): nothing is posted before init.** G6 checks for "some error" and "no frames". H22 posts `error` on every pre-init `iterate()`: an error spam at loop rate until `init`. It survives. Optional **G6b** (verified): pre-init iterations post nothing.
- **m6 (spec ambiguity, carried over):** C5 (a speed change billed at the new speed) still survives, with its effect limited to one loop interval. The spec now says a cap event is "the backlog was clamped at the cap". A literal reading includes the clamp in `setSpeed` when the speed *decreases*. C22 (speed-down clamp counts as a cap event: a 1 s "behind" after switching 60× → 1× while already behind) passes every test, and so does the reference that does not count it. Say which is intended. C23 (grace also masks the cap event) also survives. It only matters when a stall falls in the first second after a speed change.
- **m7 (carried over):** R2 (equivalent) and R8 (saturation is unreachable) survive. "Saturating" is still in the spec.
- **m8 (carried over):** `client.ts` and `worker.ts` are covered only by the smoke and Playwright runs.
- **m9 (cosmetic, carried over):** Tests table rows are out of order (11 is last), rows 20 and 27 bundle several tests, and the test names (F*/G*) don't match the ward numbers. Small new ones: G4 sits before G5 in the table but after it in the file. H19 (the first frame after init waits one interval) survives. Its effect is ≤ 16 ms, so this is a note only.

No BLOCKER: none of the 30 tests contradicts the current spec. A reference built to the spec as written passes all of them (see below). I re-checked the timing-sensitive assertions (G1, G2 at 1×, G4 ≤ 4 ticks, G8 sizes) against alternative correct implementations: an integer-accumulation backlog, and a pool that holds a single buffer. They do not depend on reference-specific choices.

## Reference results
The reference is `/tmp/ref004/repo`, matching the current spec. Round-3 mutant hooks are added via `/tmp/ref004/r3/patch_r3.py`; with `MUT` unset they are inert.
- Rust `cargo test -p sim-core --test core_004_frame`: **5/5 pass**. A cold build takes about 1–2 min; the tests take 0.00 s.
- Vitest: **25/25 pass** (about 0.47 s). With `fixes3_tail.ts` added: **30/30 pass**. `tsc --noEmit` is clean for the reference plus fixes, and for the worktree.
- In the worktree stubs: 5/5 Rust and 25/25 Vitest fail, all for RED reasons.

## Mutation table
"25" = the current RED suite. "+F" = with `/tmp/ref004/fixes3_tail.ts` (G9, G10, G2b, G4b, G6b).

| # | Mutation | 25 | +F |
|---|---|---|---|
| R1, R3–R7, R9–R14 | Rust frame mutants (rerun) | caught | caught |
| R2 | queued `v <= 2` | survives (equivalent) | survives |
| R8 | wrap instead of saturate | survives (unreachable, m7) | survives |
| W1–W13 | wasm adapter mutants (rebuilt with wasm-pack, rerun) | **all 13 caught** (5, 10, F7–F10, G4) | caught |
| C1, C3, C4, C6–C9 | clock basics | caught | caught |
| C2, C2b, C2c, C10, C11 | behind/achieved honesty | caught (8, F2, F2b, G1) | caught |
| C12 | cap event latched forever | caught (G1) | caught (G1, G9) |
| C13 / C14 / C16 | no grace / grace only on resume / window `[now − 1 s, now)` | caught (G1, G2) | caught |
| C15 | setSpeed accepts NaN/0/−1/∞ | caught (G5) | caught |
| C17 | behind while paused | caught (G3) | caught |
| C19 | sticky 2 s | caught (G1) | caught |
| C26 | sticky compared against `MAX_BACKLOG_S` (1 ms, unit slip) | caught (F2) | caught (F2, G9) |
| C20 | sticky 250 ms | survives (m1) | caught (G9) |
| C25 | sticky 1100 ms | survives (near-equivalent) | caught (G9) |
| C18 | cap event re-armed only after expiry (one-iteration flicker per second under sustained clamping) | survives (MINOR) | survives |
| C21 | grace not applied to the first start | survives (m2) | caught (G2b) |
| C22 | speed-down clamp counts as a cap event | survives (m6, spec-ambiguous) | survives |
| C23 | grace also masks the cap event | survives (m6) | survives |
| C5 | speed change billed retroactively | survives (m6) | survives |
| D3 / D4 / D5 | decoder copies / s offset / lane mask | caught (6, G7) | caught |
| H7 / H7b | no frame when n = 0 / no frames while paused | caught (F4, G4) | caught |
| H8 / H9 / H10 | pre-init throws / silent / iterate throws | caught (G6) | caught |
| H11 / H12 / H13 | init error without cause; unknown link silent / throws | caught (F10) | caught |
| H14 | strict `>` frame interval | caught (11, F3, F4, F6, G4) | caught (+G10, G4b) |
| H15 / H16 / pool-any | pool never drops / keeps 4 / any size ≥ | caught (F6, G8) | caught |
| H17 | post before step | caught (10, F3) | caught |
| H18 | commands while paused dropped | caught (G4) | caught |
| H23 | paused commands applied one tick after resume | caught (G4) | caught |
| **H20** | `lastPost += 16` (accumulator: bursts after a stall, < 16 ms gaps under jitter) | **survives (M1)** | caught (G10) |
| H21 | pending closure shown in `closed` while paused | survives (m4) | caught (G4b) |
| H22 | `iterate()` before init posts an error per iteration | survives (m5) | caught (G6b) |
| H19 | first frame after init waits one interval | survives (note) | survives |
| ignore-pause, defer-commands, post-every, no-transfer, stale-counts | host (round 1) | caught | caught |

## Notes for Gold reviewer
- In Playwright, look at frame arrival times (`perf.framesPerS`, plus the timestamps of `onmessage`). Check them while the sim runs at 60× with expensive ticks, and right after a forced stall: for example, switch the tab away and back, or block the worker with a slow batch. Look for a burst of frames (M1) and for gaps under 16 ms.
- Check `behind`. At 1× steady it must never flicker. Switching 1× → 60× → 1× must not flash it on the switch, unless the clock was already behind; that case is m6, and the answer depends on the chosen semantics. A single stall must show "behind" for about 1 s, then clear it (m1). If the app starts paused, pressing play the first time must not flash it (m2).
- Pause, then click "Close central bridge". The readout must not report the closure until resume (m3, m4). After resume it must appear within a few ticks.
- Harness: `/tmp/ref004/repo`. Never run `pnpm` there. Use `node_modules/.bin/vitest --root /tmp/ref004/repo/web`, with `MUT=<name>` via `mutate_ts2.sh`. `mutate_rust.py` and `mutate_wasm.py` restore their sources at the end.
