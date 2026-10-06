# Review core-004 RED 1

**Reviewer:** adversarial test reviewer (automated quality gate in place of the human approver), 2026-10-06
**Verdict:** REJECTED

Scope reviewed: `livingcity.md` (brief), `.wdd/epics/core.md` § Frame / boundary format, `.wdd/wards/core/ward-004.md`, `crates/sim-core/src/frame.rs` + `crates/sim-core/tests/core_004_frame.rs` (4 tests), `crates/sim-wasm/src/lib.rs`, `web/src/sim/*`, `web/tests/{clock,frame,sim}.test.ts` + `helpers.ts` (7 tests).
RED state confirmed in the worktree: 4/4 Rust and 7/7 Vitest tests fail on `todo!()` / `not implemented`, not on compile or setup errors.

Reference and mutation harness: `/tmp/ref004/` (repo copy `repo/`, `mutate_rust.py`, `mutate_ts.sh`, `mutate_wasm.py`, `variants/`, `probe*.mjs`). Verified fix tests: `/tmp/ref004/fixes_tail.ts`, `/tmp/ref004/fixes_decoder.ts`, `/tmp/ref004/fixes_tail.rs`.

## Findings

1. **BLOCKER, test defect plus spec defect.** `web/tests/clock.test.ts:26` (test 7) fails for a spec-correct clock. The spec defines `achievedTicksPerS` only as "rolling 1 s". At 1× the target is 2 ticks/s, so one tick is already 50 % of the target. With a 16 ms loop the tick events land at 9008, 9504 and 10000 ms, and the test reads the status at exactly t = 10000. A window `(now − 1 s, now]` counts 3 ticks and gives |3 − 2| = 1 > 0.2, so the test fails. A window `[now − 1 s, now)` counts 2 ticks and passes only because of that phase alignment (`/tmp/ref004/probe.mjs`, `probe2.mjs`). My reference fails with the first convention (`WINDOW_CONV=closed-right`) and passes with the second. **Fix:** change the tolerance to `Math.max(0.1 * target, 1)` (one tick of quantization per 1 s window). See F1 in `fixes_tail.ts`; it passes with both window conventions. Also have the spec state the window convention, or define achieved over a window that holds ≥ N ticks.

2. **BLOCKER, test asserts behavior the spec and layout cannot give without a destructive implementation.** At `web/tests/frame.test.ts:25-33` (test 6) and in the `DecodedVehicles` stub (`web/src/sim/frame.ts`), `link`, `s`, `v` and `flags` are typed arrays indexed by record (`d.link[1] === 7`). They must also share the input buffer (`d.link.buffer === words.buffer`). The wire format (`protocol.ts`, contract § Frame) is AoS: 4 interleaved words per record. A typed array has no stride, so no non-mutating view can meet both conditions. The natural zero-copy reading of "typed views" (`variants/frame_strided.ts`) fails tests 5, 6 and 10. The tests pass only with an in-place AoS→SoA transpose (my reference, `variants/frame_transpose.ts`) or a Proxy. The transpose destroys the documented layout inside the buffer and makes `decodeVehicles` non-idempotent. Decoding the same frame twice returns `[3, 0]` instead of `[3, 7]`, verified in `/tmp/ref004/dec/tests/idem.test.ts`. In core-005, if the readout and the renderer both decode, one of them gets garbage. **Fix, option A (recommended, verified):** keep AoS, which is GPU-friendly with a 16-byte stride. Expose `words: Uint32Array`, `floats: Float32Array` and accessors `link(i)`, `s(i)`, `v(i)`, `flags(i)`, `lane(i)`. Replace test 6 with `fixes_decoder.ts`, which adds idempotency and a buffer-unchanged check, and change call sites to `d.link(i)`. **Option B:** make the contract SoA (same 16 B per vehicle: `link[count]`, `s[count]`, `v[count]`, `flags[count]`). Then plain subarray views work. This changes Rust test 1 and `protocol.ts`.

3. **MAJOR, spec defect plus test gap: the behind flag can lie about dropped wall time.** `ward-004.md` says "behind = backlog hit the cap". The obvious snapshot `backlogTicks >= cap` inside `status()` can never be true after `report()`, because the backlog is then cap − n. Only the "achieved < 90 %" path ever fires. Test 8 (`clock.test.ts:36-62`) also satisfies the < 90 % criterion, so these mutants survive: C11 (cap snapshot), C2b (behind only on slow), C2c (behind only on cap) and C10 (achieved reports the target unless capped). At 91–99 % of target the clock silently discards owed wall time while showing "not behind". The brief forbids exactly this. **Fix:** in the spec, state that "hit the cap" is an event that stays sticky for 1 s and that both criteria are independent. Add F2 (cap hit at about 95 % achieved ⇒ behind) and F2b (80 % achieved, backlog still below cap after 2.5 s ⇒ behind, honest achieved), both in `fixes_tail.ts`.

4. **MAJOR, test gap: pause is never tested in the host.** Nothing calls `setRunning(false)` on `createSimHost`, and test 9 covers only the bare clock. Mutant `ignore-pause` (the host drops `setRunning(false)`) survives. Pause/resume is a brief requirement. **Fix:** F3 (paused tick is frozen across 200 iterations; resume does not catch up).

5. **MAJOR, test gap: the frame rate limit is not tested.** Test 11 iterates in exact 16 ms steps, so "post every iteration" cannot be told apart from "at most one frame per 16 ms". Mutant `post-every` survives. A real worker loop iterates every 1–4 ms and would flood the UI thread with 250+ frames/s. **Fix:** F4 (2 ms iterations; frames ≤ 2000/16 + 1).

6. **MAJOR, test gap: transferability is never checked.** The fake `post` ignores the transfer list. Mutant `no-transfer` (posts with `[]`, so every frame is structured-cloned) survives, against the brief's "transferable buffers". **Fix:** F5 (`transfer` contains `msg.vehicles`).

7. **MAJOR, spec defect plus test gap: buffer pooling is unexercised and contradicts the payload rule.** No test sends `returnBuffer`. The spec says the host "pools vehicle buffers" while test 11 requires `vehicles.byteLength == count × 16`. A capacity-based pool, the usual way to pool, breaks that rule, and an exact-size pool almost never hits. Mutant `pool-any` (reuses any buffer ≥ the needed size) survives. Untested pooling can also post a buffer the UI still reads, or throw `RangeError` on undersized buffers. **Fix:** in the spec, reuse a buffer only when `byteLength === count × 16` (or use a resizable `ArrayBuffer`) and ignore others. Add F6: two lockstep hosts; one gets exact, larger and smaller buffers back; every frame must match the unpooled frame byte for byte and be exactly count × 16 on receipt.

8. **MAJOR, test gap: frame internal consistency.** These mutants survive: `stale-counts` (link stats read before `step`), W1 (`link_counts()` returns the queued counts) and W12 (`metrics()` order differs from `metric_names()`, active ↔ on_network). Test 10 only checks that the central-bridge occupancy is monotone, and test 5 only checks `on_network`, which equals `active` when nobody waits. **Fix:** F7. In every frame, per-link records = `linkCounts`, queued-flag records = `linkQueued`, `metrics.on_network == count`, `metrics.tick == tick`, `active == on_network + waiting + no_route` (plus a non-vacuity check that waiting > 0 occurs), `tick == clock.executedTicks` and `simTimeS == tick × DT`.

9. **MAJOR, test gap: reopen is not tested.** Mutant W13 (`open_link` schedules a close) survives. Smoke step 3 ("Reopen restores it") is manual only. **Fix:** F8 (after reopen, `closed` excludes both links and traffic returns to the bridge).

10. **MAJOR, test gap: the init/ready payload values are never checked.** Test 11 checks only array lengths. These mutants survive: W6 (node x/y swapped), W7 (`link_length` returns speeds), W10 (`link_from`/`link_to` swapped), W9 (zone kinds) and W8 (central and north landmarks swapped). With W8, test 10 and the "Close central bridge" button close the north bridge. The renderer in core-005 builds geometry from these arrays. **Fix:** F9. Node 0 is at (−1000, −700); the zones are nodes 18–23; every `linkLength` equals the Euclidean distance between its `from`/`to` coordinates; speeds are in {11.1, 13.9}; the central bridge runs (−100, 0) ↔ (100, 0) with 2 lanes; zone kinds are 3 residential, 2 workplace, 1 hospital.

11. MINOR, spec defect: error semantics are unspecified. `error{message}` exists, but the spec doesn't say when it is posted (unknown link, init failure, commands before init). Panics on unknown ids are already caught by test 5 (W3). F10 proposes: the host never throws, posts `error` for unknown links, and includes the cause on init failure. Add it once the spec states this.
12. MINOR, spec gap: frames while paused. The spec doesn't say whether the host posts frames when 0 ticks run. If it doesn't, a close command issued while paused is invisible in the UI (`closed`, bit1) until resume. Suggest: post when ticks > 0 or a command was applied, at most every 16 ms.
13. MINOR: `ClockStatus.backlogTicks` is in `protocol.ts` and used by test 8 but missing from the `status()` field list in the ward. `setSpeed` input validation (≤ 0, NaN) is unspecified.
14. MINOR: C5 (setSpeed bills the time since the last `plan()` at the new speed) survives. The effect is limited to one loop interval, so no fix is needed beyond saying in the spec that the elapsed time is accrued at the old speed first.
15. MINOR: R2 (`v <= 2` instead of `< 2`) survives. It is effectively an equivalent mutant: movement speed is `(s' − s)/DT` and is never exactly 2.0 in the busy world. R8 (u16 wrap instead of saturate) survives, and saturation is unreachable: max 50 km × 8 lanes / 7.5 m ≈ 53 333 < 65 535. Drop "saturating" from the spec or note that it is defensive only.
16. MINOR: `client.ts`/`worker.ts` wiring and the `perf` statistics (median/p95, framesPerS) are covered only by the manual smoke test and the Gold Playwright run. Optional: a client unit test with a fake `Worker` (message routing, `returnBuffer` sent with a transfer list).
17. MINOR (Rust, optional): `fixes_tail.rs` adds `empty_world_encodes_nothing_and_clears_buffers`, which checks that dirty `out`/`counts`/`queued` are cleared on a fresh world.

## Reference results
Reference written exactly to spec in `/tmp/ref004/repo`: `frame.rs`, the sim-wasm adapter, `clock.ts`, `host.ts` and an in-place-transpose `frame.ts`.
- Rust: `cargo test -p sim-core --test core_004_frame`: 4/4 pass (5/5 with `fixes_tail.rs`).
- wasm-pack build OK. Vitest: 7/7 pass only with the `[now − 1 s, now)` window convention and the transposing decoder. With the `(now − 1 s, now]` convention test 7 fails (finding 1). With a strided, non-mutating decoder tests 5, 6 and 10 fail (finding 2).
- With the fixes (`fixes_tail.ts`, 11 extra tests) the reference passes 18/18. `fixes_decoder.ts` passes against `variants/frame_accessor.ts`.
- Fixing the reference for F2 needed a sticky cap-hit event (finding 3). The snapshot form is what the spec literally suggests.

## Mutation table
| # | Mutation | RED suite (11) | With proposed fixes |
|---|---|---|---|
| R1 | records: links iterated descending | caught (1) | caught |
| R2 | queued flag `v <= 2` | survives (equivalent, finding 15) | survives |
| R3 | s as truncated f64 bits | caught (1) | caught |
| R4 | stranded flag never set | caught (1) | caught |
| R5 | lane bits at 16 | caught (1) | caught |
| R6 | `out` not cleared | caught (1) | caught |
| R7 | count excludes closed links (count ≠ on_network) | caught (1) | caught |
| R8 | link stats wrap instead of saturate | survives (unreachable) | survives |
| R9 | link stats not cleared | caught (2) | caught |
| R10 | metrics active/on_network swapped (Rust) | caught (4) | caught |
| R11 | None → 0 | caught (4) | caught |
| R12 | node_is_zone all 0 | caught (3) | caught |
| R13 | link_speed = length | caught (3) | caught |
| R14 | closed flag from wrong link | caught (1) | caught |
| C1 | backlog uncapped | caught (8) | caught |
| C2 | never behind | caught (8) | caught (8, F2) |
| C2b | behind only from achieved < 90 % | **survives** | caught (F2) |
| C2c | behind only from cap (sticky) | **survives** (with a sticky-cap reference) | caught (F2b) |
| C3 | plan ignores budget | caught (8) | caught |
| C4 | resume catches up paused time | caught (9) | caught (9, F3) |
| C5 | speed change billed retroactively since last plan | survives (MINOR) | survives |
| C6 | simTimeS from wall time | caught (7, 8) | caught |
| C7 | no minimum of 1 tick under budget | caught (8) | caught |
| C8 | paused clock accrues backlog | caught (9) | caught |
| C9 | speed latched until resume | caught (9) | caught |
| C10 | achieved reports target unless capped | **survives** (with a sticky-cap reference) | caught (F2b) |
| C11 | cap detection as backlog snapshot | caught by 8 only through the < 90 % path; the cap criterion itself is dead | caught (F2) |
| H1 | host ignores setRunning(false) | **survives** | caught (F3) |
| H2 | commands deferred to later ticks | caught (10) | caught |
| H3 | post every iteration | **survives** | caught (F4) |
| H4 | no transfer list | **survives** | caught (F5) |
| H5 | link stats from stale (pre-step) state | **survives** | caught (F7) |
| H6 | pool reuses any buffer ≥ needed | **survives** | caught (F6) |
| W1 | wasm link_counts returns queued | **survives** | caught (F7, F8) |
| W2 | metric_names reversed | caught (5) | caught |
| W3 | unknown link panics | caught (5) | caught (5, F10) |
| W4 | command delayed 20 ticks | caught (10) | caught |
| W5 | step(n) runs n − 1 | caught (5, 10) | caught |
| W6 | node_xy x/y swapped | **survives** | caught (F9) |
| W7 | link_length returns speed | **survives** | caught (F9) |
| W8 | landmarks central ↔ north | **survives** | caught (F9) |
| W9 | zone kinds wrong | **survives** | caught (F9) |
| W10 | link_from/link_to swapped | **survives** | caught (F9) |
| W11 | closed_links empty | caught (10) | caught |
| W12 | metrics order ≠ metric_names | **survives** | caught (F7) |
| W13 | open_link closes | **survives** | caught (F8) |
| D1 | strided non-mutating decoder (spec-reasonable) | **fails 5, 6, 10** (finding 2) | passes under option A |
| D2 | `(now − 1 s, now]` achieved window (spec-correct) | **fails 7** (finding 1) | passes (F1) |

## Notes for Gold reviewer
- The Rust side is solid. The independent-walk oracle in test 1 is strong and the flag kinds are non-vacuous. Remaining Rust survivors are equivalent or unreachable.
- Pick option A or B for finding 2 before GREEN starts, because it changes the decoder API that core-005 will consume.
- After finding 3 is fixed in the spec, check that `behind` latches about 1 s after a cap event and clears afterwards. In the browser at 60×, verify "behind" appears whenever achieved < target for more than a second.
- In the Playwright smoke test, confirm frames come at about 60/s, not one per loop iteration (finding 5), that vehicles stay attached to the bridge (finding 10), and that reopen works (finding 9).
- When running the reference harness, do not run `pnpm` in `/tmp/ref004/repo/web`: its `node_modules` is a symlink to the worktree's, and pnpm tried to purge it (it aborted without a TTY). Call `node_modules/.bin/vitest` directly.
