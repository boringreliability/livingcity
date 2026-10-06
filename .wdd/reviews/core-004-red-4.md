# Review core-004 RED 4

**Reviewer:** adversarial test reviewer (automated quality gate in place of the human approver), 2026-10-06
**Verdict:** REJECTED

Scope: `livingcity.md`, `.wdd/epics/core.md` § Frame / boundary format, `.wdd/wards/core/ward-004.md`, `crates/sim-core/tests/core_004_frame.rs` (5), `crates/sim-wasm/src/lib.rs` (stub), `web/src/sim/*` (stubs), `web/tests/{clock,frame,sim,host,review2,review3}.test.ts` (30 Vitest), and `git diff 64de856 HEAD`. The ward changes in this round: `lastPost = now`, paused-frame purpose, grace only for (b), the speed-lowering clamp is not a cap event, `setSpeed` credits elapsed time at the old speed, and the first-start grace counts from `setRunning(true)`.

`web/tests/review3.test.ts` is byte-identical to the round-3 verified fix tail (`/tmp/ref004/fixes3_tail.ts`: G9, G10, G2b, G4b, G6b), apart from its header comment. The Rust tests, `sim-wasm` and the web stubs have not changed since round 3.

RED state confirmed in the worktree:
- **Rust:** 5/5 tests fail. Four fail on `todo!()` panics. `metrics_array_matches_names` fails its assertion against the stub's empty `METRIC_NAMES`.
- **Vitest:** 30/30 tests fail. 29 fail with `Error: not implemented` and 1 with wasm `RuntimeError: unreachable`.
- No compile or setup errors, and `tsc --noEmit` is clean.

## Prior findings status (round 3)

| # | Round-3 finding | Status |
|---|---|---|
| M1 | MAJOR: frame spacing tested only with a uniform loop (H20) | **Resolved.** The spec now says `lastPost = now`, never `+= 16`. G10 is in the suite and catches H20, H14, H7 and post-every. |
| m1 | sticky expiry too early | **Resolved** (G9 catches C20, C25, C26, C11, C12, C19). |
| m2 | first-start grace | **Resolved.** The spec sentence is added and G2b catches C21. |
| m3 | leftover "commands visible immediately" sentence | **Resolved.** The bullet now reads "so the UI stays live and keeps receiving clock status". |
| m4 | paused frames show the unchanged state | **Resolved** (G4b catches H21). |
| m5 | pre-init iterate posts | **Resolved** (G6b catches H22). |
| m6 | C5 / C22 / C23 undecided | **Spec resolved, tests not added.** The spec now decides all three, but no test pins any of them: C5, C22 and C23 all survive the 30 tests. The new sentences also have their own problems; see M1, M2, m1 and m2. |
| m7 | R2 / R8, "saturating" | **Open** (m6 below). |
| m8 | client/worker untested | **Open** (m7). |
| m9 | table order and naming | **Open** (m8). Row 11 is still last, rows 20 and 27 still bundle tests, and test names (F*/G*) still don't match the ward numbers. |

## Findings

### M1. MAJOR, test gap: lowering the speed is untested, so the old backlog can be worked off at the new speed
Every speed change in the suite raises the speed (test 9 goes 1× → 10×, and G2 goes 1× → 60×), apart from G2's change *after* a resume. No test lowers the speed while a backlog is owed. With DT = 0.5 s, the cap is 120 ticks at 60× and only 2 ticks at 1×.

Mutant **C35** clamps only new accruals (`if (backlog < cap) backlog = min(cap, backlog + add)`) and never clamps an existing backlog down. It **survives all 30 tests**. This is a natural shape for overflow detection ("room = cap − backlog"), and the new spec sentence invites it: it tells the implementer the speed-lowering clamp is special.

The consequence is measurable and visible. Take 60× while behind (smoke step 4 expects this case): the backlog sits at about 87–120 ticks. When the user selects 1×, the clock keeps planning budget-limited batches until it has worked off all of them. That is up to 60 s of sim time, run at full speed, for about 1 s of wall time after the user asked for real time. During that second `status().backlogTicks` is far above the 1 s cap, which breaks the invariant of test 8 ("backlog never above the 1 s cap") and test 9 ("a speed change takes effect on the next plan").

**Fix:** add **G11** (verified, `/tmp/ref004/fixes4_tail.ts`):
- **Part A:** 60× with 10 ms ticks until behind, then `setSpeed(1)`. From then on the backlog is ≤ the 1× cap after every plan, and at most cap + 2 s × 2 + 1 ticks run in the next 2 s.
- **Part B:** 60× keeping up, a 100 ms hiccup, then `setSpeed(1)`. `behind` is false at the instant of the switch (the lowering clamp is not a cap event), and the 12 owed ticks are not executed.

G11 catches C35, C22, C3 and C9. It passes for both eager clamping (in `setSpeed`) and lazy clamping (at the next plan).

### M2. MAJOR, spec defect: "a speed-lowering clamp is not a cap event" is defeated one plan later
After the lowering clamp, the backlog sits exactly at the new cap. The very next `plan()` adds the wall time since the switch (16 ms × 2 ticks/s = 0.032 ticks), so the backlog exceeds the cap and is clamped again. That second clamp drops real wall time, so by criterion (a), and by "a cap clamp is always reported", it **is** a cap event. `behind` then turns true for 1 s: the very flash the new sentence was meant to prevent.

The reference, built literally to the spec, does exactly this. It reports `behind: true` from +16 ms after `60× → 1×` with 12 ticks owed. Mutant C22b (no clamp in `setSpeed`, the next plan's accrual clamps and records a cap event) is therefore equivalent to the literal spec.

When it happens: with DT = 0.5 s, it occurs on 60× → 1× whenever more than 2 ticks are owed at the switch. That is about 17 ms of lag at 60×. If the Gold worker paces its loop at about 16 ms, the time credited since the last plan alone reaches about 1.9 ticks, so the flash would follow most such switches, even when the sim is keeping up.

The spec therefore leaves Green two choices, each of which breaks one of the spec's statements:
- show the false 1 s "behind" the sentence wants to prevent, or
- suppress real clamps, which breaks "a cap clamp is always reported".

**Fix:** pick one of these and state it.
- **(i) Accept the flash.** Delete the sentence, or say "the lowering clamp itself is not a cap event, but later overflow at the new cap is, as usual". Then nothing more is needed: G11 already pins the instant.
- **(ii) Suppress the flash.** For example: "after a speed-lowering clamp, overflow is not a cap event until a plan leaves the backlog below the new cap". The reference variant `SPEC_II=1` implements this. Add **G11b** (verified, `/tmp/ref004/fixes4_option_ii.ts`: `behind` stays false during the second after `60× → 1×` with a backlog). G11b passes with `SPEC_II=1` and fails on the literal reference at +16 ms.

### Minor
- **m1 (test gap): grace only for (b), and the credit clamp in `setSpeed`.** C23 (grace masks cap events) and C32 (the credit clamp at the old speed inside `setSpeed` is never a cap event, an overcorrection of the new sentence) both survive. The effect is a stall that ends with a queued speed change, for example a click while the worker is busy: it goes unreported, or is reported up to 1 s late. Optional **G12** (verified) catches C23, C32, C5, C34, C20 and C26. G12 asserts `behind` at the instant of `setSpeed`, which assumes that crediting at the old speed is capped at the old cap inside `setSpeed`. If you disagree, drop that one line: G12 still catches C23.
- **m2 (test gap + wording): crediting at the old speed.** C5 (elapsed time billed at the new speed) and C34 (elapsed time dropped on a speed change) survive. Their effect is ≤ 1 loop interval per switch: about 1 s of sim time at 60×, more if a stall precedes the switch. "Credits the wall time elapsed **since the last plan**" also reads as allowing a double credit, where the baseline is not moved and the next plan bills the same interval again at the new speed. Say "since the last plan or speed change". Optional **G13** (verified: 1× → 60× after 200 ms plans ≤ 1 tick, and 60× → 1× plans exactly the 2-tick cap) catches C5, C34, C35, C9 and the double credit.
- **m3 (spec gap): `setRunning(true)` while already running.** Is it a "start"? C27 (a redundant start resets the grace) and C28 (a redundant start resets the accrual baseline and drops elapsed time) survive. If `client.ts` or the UI re-sends play, for example from a React effect, C27 hides (b) indefinitely, and C28 silently loses wall time. Say "`setRunning` with the current state is a no-op".
- **m4 (test gap): H24, frame spacing measured at iteration start.** H24 reads `now` once at the top of `iterate()` and uses it for both the check and `lastPost`. Actual post times can then fall about 16 − (step time) ms apart, down to about 8 ms. There is no burst and the average rate stays ≤ 62.5/s, so this is MINOR. G10 doesn't catch it, because its fake `sim.step` takes no time. A test would advance the fake time inside `step`.
- **m5 (carried over): C18** (cap event re-armed only after expiry, one-iteration flicker per second under sustained clamping) and **H19** (the first frame after init waits one interval) survive. Both are notes only.
- **m6 (carried over):** R2 (equivalent) and R8 (saturation is unreachable) survive. "Saturating" is still in the spec.
- **m7 (carried over):** `client.ts` and `worker.ts` are covered only by the smoke and Playwright runs.
- **m8 (cosmetic, carried over):** Row 11 is last in the Tests table, and test names and table numbers diverge. `estimated_tests: 35` = 5 Rust + 30 Vitest is correct.

No BLOCKER: a reference built to the current spec passes all 35 tests. The new spec sentences contradict none of the existing tests (all of them raise the speed, or keep it constant).

## Reference results
- The reference is `/tmp/ref004/repo`, matching the current spec. It credits at the old speed in `setSpeed`, applies the grace only to (b), does not treat the eager lowering clamp as a cap event, and counts grace from `setRunning(true)`.
- Mutant hooks are added via `/tmp/ref004/r3/patch_r3.py`, `/tmp/ref004/r4/patch_r4.py` and `/tmp/ref004/r4/patch_r4b.py`. They are inert with `MUT` unset. `SPEC_II=1` switches on option (ii) of M2.
- **Rust** (`cargo test -p sim-core --test core_004_frame`): **5/5 pass**. The tests take 0.00 s; a warm build takes about 2.4 s wall.
- **Vitest** (the worktree's 30 tests): **30/30 pass**, in about 0.45 s.
  - With `fixes4_tail.ts` (G11, G12, G13): **33/33 pass**. `tsc --noEmit` is clean.
  - `fixes4_option_ii.ts` (G11b) passes with `SPEC_II=1` and fails on the literal reference (M2).
- **Worktree stubs:** all 35 tests fail, for RED reasons (above).

## Mutation table
"30" = the current RED suite. "+F" = with `/tmp/ref004/fixes4_tail.ts`. The Rust mutants were rerun this round. The wasm mutants (W1–W13) were not rebuilt, because the adapter and tests are byte-identical to round 3, where all 13 were caught.

| # | Mutation | 30 | +F |
|---|---|---|---|
| R1, R3–R7, R9–R14 | Rust frame mutants (rerun) | caught | caught |
| R2 / R8 | `v <= 2` / wrap instead of saturate | survive (equivalent / unreachable, m6) | survive |
| W1–W13 | wasm adapter (round 3) | caught | caught |
| C1, C3, C4, C6–C9, C10, C11, C2, C2b, C2c | clock basics / honesty | caught | caught |
| C12, C19, C20, C25, C26 | sticky duration | caught (G1, G9, F2) | caught |
| C13, C14, C16, C21 | grace window / first start | caught (G1, G2, G2b) | caught |
| C15, C17 | invalid speed / behind while paused | caught (G5, G3) | caught |
| **C35** | an existing backlog is never clamped down when the speed is lowered | **survives (M1)** | caught (G11, G13) |
| C22 | eager speed-lowering clamp counts as a cap event | survives | caught (G11) |
| C22b | lazy speed-lowering clamp (at the next plan) counts as a cap event | survives | survives (= literal spec, M2) |
| C23 | grace also masks cap events | survives (m1) | caught (G12) |
| C32 | credit clamp inside `setSpeed` is never a cap event | survives (m1) | caught (G12) |
| C5 | elapsed time billed at the new speed | survives (m2) | caught (G12, G13) |
| C34 | speed change drops elapsed time | survives (m2) | caught (G12, G13) |
| C36 | double credit (`setSpeed` credits without moving the baseline) | survives (m2) | caught (G13) |
| C27 / C28 | redundant `setRunning(true)` resets the grace / the baseline | survive (m3) | survive |
| C18 | cap event re-armed only after expiry | survives (m5) | survives |
| D3 / D4 / D5 | decoder | caught | caught |
| H7, H7b, H8–H18, H20–H23 | host (rounds 1–3) | caught (incl. G10 → H20, G4b → H21, G6b → H22) | caught |
| H19 | first frame waits one interval | survives (m5) | survives |
| **H24** | frame spacing measured at iteration start | survives (m4) | survives |
| ignore-pause, defer-commands, post-every, no-transfer, pool-any, stale-counts | host (round 1) | caught | caught |

## Notes for Gold reviewer
- **Key values:** DT = 0.5 s, so 1× = 2 ticks/s and 60× = 120 ticks/s. The cap is 1 s of target ticks (2 ticks at 1×, 120 at 60×). Grace is 1 s, for (b) only. The sticky cap event lasts 1 s. The frame interval is 16 ms with `lastPost = now`.
- **Speed changes:**
  - After 60× → 1× while behind, tick and sim time must slow to about 2 ticks/s at once. There must be no run of tens of ticks after the switch (M1).
  - Whether "behind" flashes for 1 s right after the switch depends on how M2 is resolved. Check it against the chosen wording.
  - 1× → 60× must not jump by more than about 1 tick at the switch (m2).
- **Frames:** in Playwright, check `onmessage` gaps. They must be ≥ about 16 ms with no bursts after a stall: switch the tab away and back. If the step runs long, gaps around 8 ms point to H24.
- **Play:** if the UI re-sends play (`setRunning(true)`) while already running, check that "behind" can still appear under sustained overload (m3).
- **Harness:** `/tmp/ref004/repo`. Never run `pnpm` there. Use `node_modules/.bin/vitest --root /tmp/ref004/repo/web`, with `MUT=<name>` via `bash /tmp/ref004/mutate_ts2.sh <names…>`, and `SPEC_II=1` for M2 option (ii).
