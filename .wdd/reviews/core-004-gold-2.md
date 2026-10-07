# core-004 Gold review 2

Reviewer: Gold gate (adversarial implementation reviewer, Claude Opus 5.5), round 2. Fixes reviewed: `git diff b58f545 HEAD` (commit 014383f).
Verdict: APPROVED

The round-1 MAJOR (F1) is fixed and proven with the round-1 probe. F2, F3, F4 and F7 are fixed, and F8 is partly fixed. This review found no BLOCKER and no MAJOR. Four new MINORs are listed below; none of them blocks approval.

## Tampering check
- `git diff 9b246a2 HEAD -- crates/sim-core/tests web/tests/{clock,frame,sim,host,review2,review3,review4}.test.ts web/tests/helpers.ts` is **empty**.
- `git diff b58f545 HEAD` touches only:
  - implementation files: `crates/sim-wasm/src/lib.rs`, `web/src/App.tsx`, `web/src/sim/{client,clock,host}.ts`
  - the round-1 review
  - one new file, `web/tests/gold_fixes.test.ts`
- **`gold_fixes.test.ts` is acceptable.** It only adds tests. It does not modify, skip or loosen any approved Red test, and it does not replace any approved assertion. It cannot weaken the gate.
  - The F1 and F3 tests are real regression tests: both fail on the pre-fix code.
  - The F2 test is vacuous (see N1).
- The working tree is clean after all runs.

## Commands + results
| Command | Result |
|---|---|
| `cargo test --workspace` | green (20 + 24 + 36 + 5 tests), EXIT 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | EXIT 0 |
| `pnpm -C web build:wasm` | green (wasm-pack 0.13.1) |
| `pnpm -C web test` | **8 files, 37 tests passed** (34 approved + 3 gold_fixes) |
| `pnpm -C web build` | green (tsc + vite; wasm 118.8 kB, gzip 47.4 kB) |

**Differential re-run** (`/tmp/gold4probe/diff2.ts`, reference with `SPEC_II=1`): the result is identical to round 1.
- 1072/1072 frames, ticks differ by at most ±1.
- 622 frames with the same tick, 0 content differences among them.
- `behind` differs on 0 frames.
- The close lands at the same tick (841), and the paused tick is the same (1259).

## Round-1 findings status
| # | Status | Evidence |
|---|---|---|
| F1 MAJOR (link-id coercion) | **FIXED** | Re-ran `/tmp/gold4probe/hostprobe.ts` on the real wasm. NaN, 1.7, -1, 2^32+2, Infinity, `'3'` and `undefined` each give exactly one `unknown link …` error, and `closed` stays `[]`. An unknown kind (`'shut'`) gives `unknown command kind shut`. The check uses `Number.isInteger(link) && 0 <= link < linkCount`, with `linkCount` taken from `link_from().length` at init. |
| F2 MINOR (double lowering) | **FIXED** | Old clock: 300× → 300 ms hiccup → 60 → 20 (5 ms apart) gives **62** behind frames. New clock gives **0**. `/tmp/gold4probe/lower2.ts` now shows 0 in every case, the same as the reference with `SPEC_II=1`. `lower3.ts` matches the reference. The regression test, however, does not exercise this (N1). |
| F3 MINOR (backwards time) | **FIXED** | `plan()` returns 0, not −8, and `executedTicks` stays at 10 instead of dropping to 2. `report` also clamps ticks to `floor(max(0, ·))`. A remaining edge case is N2. |
| F4 MINOR (panic error flood) | **FIXED** | When `step` throws over 1 s of 4 ms iterations, **1** error (`simulation halted: …`) is posted, down from 126. The host then stops stepping and posting. Leftovers are in N3. |
| F5 MINOR (ms/tick readout) | Comment corrected only | The readout still shows `0.000 / 0.100` at 20× in the browser; at 300× it shows `0.008 / 0.017`. Acceptable for a debug HUD; see the notes for core-005. |
| F6 MINOR (unbudgeted first plan) | **Not addressed** | `clockprobe.ts`: the first plan after a 2 s stall at 300× is still **600** ticks, and so is a later stall when the estimate is 0. Severity stays MINOR: at natural demand a tick costs about 3.5 µs, so 600 ticks take about 2 ms, and the case only arises with an unmeasured or 0-ms estimate (startup, or ticks below timer resolution, which are cheap by definition). It becomes relevant with core-005/city-scale demand. |
| F7 MINOR (link stats twice) | **FIXED** | `encode_frame` now runs `write_link_stats` once into cached Vecs. The only caller (`host.postFrame`) calls `link_counts`/`link_queued` right after `encode_frame`, with no `step` in between, so the stats, vehicle records, `closed_links` and `metrics` all describe the same tick. The approved assertions that link stats match the decoded records (`host.test.ts:173-180`) and the occupancy check (`sim.test.ts:103,129`) pass. The new "stats of the last encoded frame" semantics are a contract trap (N4). |
| F8 MINOR (client hardening) | Partly fixed | `worker.onerror` now forwards to `onError`, and App uses `DT`. There is still no `onmessageerror` handler. |
| F9 MINOR (redundant id check) | Not addressed | Harmless. |

## Smoke result (Playwright MCP, Chromium, own vite on :5183, stopped afterwards; `.playwright-mcp` removed; :4243 untouched)
- **Readout is live:**
  - Tick, sim time, active, on network/queued and frame bytes all update. Frame bytes equal 16 × on-network: 1568 = 16 × 98, 3184 = 16 × 199.
  - frames/s is 51.
  - Speed: 20.0× / 20×, 300× gives 301.0× / 300× (never BEHIND), and 5× gives 5.0× / 5×.
- **Close/reopen central bridge works:**
  - At 5×, the vehicles-on-closed-links count goes 0 → 3 → 2 → 1 → 0 over about 2.6 s.
  - The button toggles to "Reopen central bridge" and back.
  - No error alert appears.
- **Console:** only the favicon 404.

## Findings (round 2)

### N1 — MINOR — The F2 regression test is vacuous
- **Where:** `web/tests/gold_fixes.test.ts:38-58`.
- **The problem:** with a 100 ms hiccup at 300×, the backlog is about 30–60 ticks, below the 60× cap of 120. `setSpeed(60)` never clamps, so `suppressCapEvents` is never set. The test passes on the pre-fix clock: 0 behind frames on the old code (`/tmp/gold5scripts.ts`).
- **Proof that the fix itself works:** with `t += 300`, the old clock gives 62 behind frames and the new one gives 0 (`/tmp/gold5f2.ts`).
- **Fix:** use a hiccup of at least 250 ms (as round-1 `lower2.ts` did).

### N2 — MINOR — A backwards step in wall time is credited twice when time moves forward again
- **Where:** `clock.ts` `credit()`.
- **The problem:** `creditedUntil = t` is set even when `t` went backwards.
- **Evidence:** 10×, credited up to t=1500, then t drops to 1100 (plan 0, as intended), then t returns to 1500. That gives a plan of **8** extra ticks for an interval already credited (`/tmp/gold5scripts.ts`, F3b).
- **Fix:** `this.creditedUntil = Math.max(this.creditedUntil, t)`.
- **Why only MINOR:** `performance.now()` is monotonic.

### N3 — MINOR — Halt leftovers (F4)
- After a halt, `sim = undefined`, so every later command reports `command before init: close N`. That message is misleading; something like "simulation halted" would be clearer.
- A panic inside `close_link`/`open_link` (the `handle` path) is caught but does not halt.
- `init` after a halt reuses the same wasm instance, whose allocator may be poisoned after a trap.
- Mostly relevant once core-005 adds recovery UI.

### N4 — MINOR — `link_counts()`/`link_queued()` are no longer live accessors
- They now return the stats cached at the last `encode_frame`:
  - an **empty Vec** before the first `encode_frame`, not one of length `link count`;
  - **stale** values after `step` without a new `encode_frame`.
- The ward spec lists them next to `metrics()` and `closed_links()`, which are live, and does not mention this coupling. The doc comment in `lib.rs` documents it, and the only caller is consistent, so there is no correctness consequence today.
- **Fix:** record the semantics in the contract (`.wdd/epics/core.md` § Frame / boundary), or have the accessors compute lazily if nothing is cached.

## Notes for core-005
- Any new caller of `link_counts`/`link_queued` (e.g. a renderer that wants stats between frames) must call `encode_frame` first (N4).
- F6: give unmeasured batches a conservative default budget before raising demand to city scale.
- F7/perf from round 1 still applies: `World::metrics()` dominates per-frame cost at high demand. Make it incremental, or sample it at about 10 Hz.
- F5: if the perf HUD stays, aggregate ms/tick over a time window (e.g. Σms/Σticks per 250 ms).
- Halt/recovery UX (N3): re-instantiate the wasm module, not just `Sim`, after a trap.
- Throwaway proofs: `/tmp/gold4probe/*` (refreshed via `setup.sh`; run the reference with `SPEC_II=1`), `/tmp/gold5scripts.ts`, `/tmp/gold5f2.ts`, `/tmp/gold5old/`.
