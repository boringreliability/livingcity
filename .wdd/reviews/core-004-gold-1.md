# core-004 Gold review 1

Reviewer: Gold gate (adversarial implementation reviewer, Claude Opus 5.5). This is a full rerun; the earlier attempt was cut off by a network error.
Verdict: REJECTED

One MAJOR finding (F1: invalid link ids silently close a real link) blocks approval. Everything else is MINOR. The fix for F1 is a few lines in `host.ts` plus one test. Tests, clippy, builds and the browser smoke test all pass.

## Test tampering check
`git diff 9b246a2 HEAD -- crates/sim-core/tests web/tests` → **empty**. Outside the implementation files, the gold commit changes only `ward-004.md` (`status: approved → gold`).

## Commands + results
| Command | Result |
|---|---|
| `cargo test --workspace` | green (36 + 5 tests, rest 0), EXIT 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | green, EXIT 0 |
| `pnpm -C web build:wasm` | green (wasm-pack 0.13.1) |
| `pnpm -C web test` | 7 files, **34 tests passed** |
| `pnpm -C web build` | green (tsc --noEmit + vite build; wasm 118.9 kB, gzip 47.5 kB) |

## Smoke test result (Playwright MCP, Chromium, own vite on :5182)
On the first try, a stale vite from the interrupted attempt was still listening on :5182, serving this worktree. I killed it, started a fresh server, and stopped that one at the end. The `.playwright-mcp` directory was deleted.
- **Readout updates live:** tick, sim time, active, on network/queued, frame bytes, ms/tick median/p95, achieved/target, and frames/s (50–52) all update.
- **Frame bytes = 16 × on-network:** 0 mismatches in more than 800 sampled readouts (e.g. 3248 B for 203 vehicles, 3344 B for 209).
- **Close central bridge at 5×:** the closed-flag count went 0 → **11** (80 ms after the click, tick 19535), then 10, 9, …, 1 → **0** at +2.69 s (tick 19561). The button switches to "Reopen central bridge". Reopen works: the button goes back and `closed` is empty.
- **Speed:**
  - 20× (default): 19–20× achieved.
  - 300×: **300.0–301.5× achieved / 300×**, never BEHIND. The population is only about 200 vehicles, so the honest-behind path cannot be exercised in the browser at natural demand.
  - 5×: 5.0×.
  - 1×: 1.0–1.5×, **0 BEHIND frames over 44 s**.
- **Console:** no errors, apart from the favicon 404 on first load and ERR_CONNECTION_REFUSED from my own navigation racing the server restart (not the app).
- **StrictMode double mount:** after a reload, `page.workers()` shows exactly **1** worker, so no leak.
- **Pass criteria:** all tests green ✓, live readout + close/reopen ✓, achieved vs target ✓.

## Spec conformance (line by line)
- **frame.rs:**
  - Record order is links → lanes → front first, via `World::for_each_on_network`, which walks `lanes[link][lane]` queue order.
  - Each record is `[link, s as f32 bits, v as f32 bits, flags]`. Flags: bit0 is `v < QUEUED_SPEED` on f64, bit1 is `is_closed(link)`, bit2 is stranded, lane is in bits 8..15.
  - The count is `len/4`. ✓
  - `write_link_stats` clears and resizes, then saturating-adds. ✓
  - `NetworkExport` fields and types match the spec. ✓
  - `METRIC_NAMES` has the exact list and order; `metrics_to_array` maps None → NaN. ✓
  - No wasm or browser dependencies, no wall clock (no Instant/SystemTime/Date/js_sys in sim-core). ✓
- **sim-wasm:**
  - It is a thin adapter: commands are scheduled at `world.tick()`, and an id `>= link count` returns false.
  - `encode_frame`, `frame_ptr` and `frame_words` give a zero-copy view.
  - JSON is used only in `landmarks_json`/`zones_json`, which run at init only.
  - Unknown u32 ids never panic. ✓
  - See F1: wasm-bindgen's u32 coercion happens before the check.
- **Decoder:** keeps the AoS layout. `words`/`floats` are views over the same buffer. Accessors do no copying, no mutation and no per-record objects. ✓
- **SimClock:**
  - Target is `multiplier/DT`; the backlog cap is 1 s; the budget is 8 ms using an EMA (0.2) estimate. ✓
  - The achieved window is `(now−1 s, now]` (entries with `t <= now−1000` are dropped). ✓
  - `behind` is `running && (capRecent || shortfall)`, so it is false while paused. ✓
  - The cap event is sticky for 1 s. ✓
  - The grace period resets on first start, resume and speed change, and applies only to (b). ✓
  - `setSpeed` credits time at the old speed, counting a clamp as an event, then clamps to the new cap with suppression on (option ii). ✓ Exception: see F2.
  - Invalid multipliers are ignored. ✓
  - `setRunning(true)` while running is a no-op. ✓
  - `simTimeS = executed × DT`. ✓
- **Host:**
  - Iteration order is plan → step if n>0 → report → post if `now−lastPost ≥ 16`, then `lastPost = now`. ✓
  - Frames keep coming while paused. ✓ The first frame comes on the first iteration after init. ✓
  - `vehicles` is in the transfer list. ✓
  - Pooling reuses only an exact-size buffer and drops all others every frame. ✓
  - Before init: nothing is posted and nothing throws. ✓ Errors carry the cause. ✓
  - The frame is copied right after `encode_frame`, before any allocating wasm call, and `memory.buffer` is re-read on every frame. This avoids a detached or stale buffer after memory growth. ✓
- **Worker/client:**
  - Messages that arrive before wasm is ready are queued and replayed in order. ✓
  - The loop runs every 4 ms via setTimeout. ✓
  - wasm load failure → `error`. ✓
  - The client transfers returned buffers. ✓
  - `dispose` terminates the worker. ✓
- **Must NOT:**
  - No per-vehicle JS↔WASM calls: there is one encode plus one bulk copy per frame. ✓
  - No per-frame JSON (`JSON.parse` is only in `init`). ✓
  - No SharedArrayBuffer or Atomics. ✓
  - No wall clock in Rust. ✓
- **Differential check against /tmp/ref004** (same 3000-iteration fake-time script with jittered 4–10 ms loop, 60×, close at k=1000, pause/300×/resume, reopen):
  - Both produce 1072 frames.
  - Ticks differ by at most ±1 (phase only: impl uses `floor(backlog+1e-9)`).
  - All 622 frames with the same tick have **byte-identical** vehicle buffers and `closed` lists.
  - The close lands at the same tick (841) and the paused tick is the same (1259).
  - `behind` agrees on every frame.

## Findings

### F1 — MAJOR — Non-integer, NaN, undefined or ≥2³² link ids silently close a *real* link with no error
- **Where:** `web/src/sim/host.ts:102-109` (`command`), plus the u32 coercion in wasm-bindgen glue in front of `crates/sim-wasm/src/lib.rs:40-51`.
- **Contract violated:**
  - Spec: "never throws: an **unknown link in a command** … posts `error{message}`".
  - Adapter: "`false` for unknown ids".
  - wasm-bindgen converts JS numbers to u32 with `>>> 0` semantics before the Rust bounds check runs.
- **Evidence** (`/tmp/gold4probe/hostprobe.ts`, real wasm, real host):

  | `close link` value sent | Errors posted | Links closed afterwards |
  |---|---|---|
  | NaN | `[]` | `[0]` |
  | 1.7 | `[]` | `[1]` |
  | 4294967298 | `[]` | `[2]` |
  | Infinity | `[]` | `[0]` |
  | undefined | `[]` | `[0]` |
  | -1 | `["unknown link -1"]` | — |

- **Impact:** a UI bug in core-005, such as a hit test that misses and yields `undefined`/NaN or `Number(attr)` on a bad attribute, closes link 0 silently. It mutates deterministic sim state and records it in the command log. This is exactly the silent failure the error contract exists to prevent. F10 only exercised `99_999`.
- **Fix:**
  - In `command()`, before calling wasm: `if (!Number.isInteger(link) || link < 0 || link >= linkCount) { error(\`unknown link ${link}\`); return; }`. Store `linkCount` from `link_from().length` at init.
  - Also reject a `kind` other than `'close'`/`'open'`. Today any other string is treated as `open`.
  - Add a test for NaN, 1.5, undefined and 2³²+k.

### F2 — MINOR — `setSpeed`'s old-speed credit ignores the option-(ii) suppression
- **Where:** `web/src/sim/clock.ts:56` (`this.credit(t, true)`).
- **The problem:** after a lowering has clamped (with `suppressCapEvents` set), a second `setSpeed` records a cap event in either of these cases, while the reference does not:
  - before any plan has run, or
  - while the engine still lags at the intermediate speed (budget limited to 1 tick, ≥ 8 ms/tick).
- **Spec:** "**no clamp** is a cap event until a plan has left the backlog below the new cap".
- **Evidence** (`/tmp/gold4probe/lower2.ts`, 300× with a 300 ms hiccup, i.e. backlog ~180 which is below the 300× cap and above the 60× cap):
  - 300→60 alone: impl 0 behind frames, ref 0.
  - 300→60→20 (5 ms apart, no plan between): **impl behind for 62 frames over ~1 s**, ref 0.
  - 300→60→20→5 (30 ms apart): impl 60 frames, ref 0.
- **Why only MINOR:** with a realistic 4 ms loop and cheap ticks, plans run between messages and clear the suppression (`lower3.ts`: impl and ref are identical). The effect is limited to queued messages or a lagging engine, where behind is mostly true anyway.
- **Fix:** `this.credit(t, !this.suppressCapEvents)` in `setSpeed`, and a test for the double lowering.

### F3 — MINOR — The host reports negative tick counts if `now()` steps backwards
- **Where:** `host.ts:178-188` and `clock.ts:76`.
- **Evidence:** in the probe, `plan()` returned **−12** after `now` went back 300 ms. The host then calls `report(-12)`, so `executedTicks` dropped from 20 to 8 while the sim stayed at tick 20. That breaks `simTimeS == tick × DT`. The reference host reports 0 for n ≤ 0, but its clock has the same negative plan.
- **Why only MINOR:** `performance.now()` is monotonic.
- **Fix:** clamp in `credit` (`Math.max(0, t − creditedUntil)`) or in `plan` (`Math.max(0, …)`).

### F4 — MINOR — Error flood when `step` throws
- **Where:** `host.ts:194-196`.
- **Evidence:** with `step` throwing (e.g. a wasm panic), 1 s of 4 ms iterations posted **126 error messages**. Frames kept coming from a poisoned instance.
- **Fix:** after a step failure, mark the host failed: post once, then stop stepping (keep posting frames, or none). For a wasm panic, re-init is the only recovery.

### F5 — MINOR — The ms/tick readout shows 0.000 at normal speeds in the browser
- **Where:** `host.ts:63-67` and `126-130`.
- **Evidence:**
  - Observed readouts: `0.000 / 0.400` at 20× and `0.000 / 0.100` at 5×.
  - Native ticks cost about 3.5 µs, below the ~0.1 ms timer resolution, and each frame holds about 1 tick. The per-frame `sum(ms)/sum(ticks)` is therefore mostly exactly 0.
  - The comment says summing per frame fixes the coarse timer; it does not at these rates.
- **Fix:** take percentiles over windowed aggregates, e.g. `Σms/Σticks` per 250 ms, or over ≥ N ticks.

### F6 — MINOR — The per-iteration budget is off while the estimate is undefined or 0
- **Where:** `clock.ts:78-81`.
- **Evidence:** `/tmp/gold4probe/clockprobe.ts`:
  - The first plan after a 2 s stall at 300× returns **600** ticks, unbudgeted.
  - With coarse-timer samples of 0 ms the estimate stays 0, and a later stall again gives a 600-tick batch.
  - At the scale-25 native cost of 0.43 ms/tick, that is a single iteration of about 260 ms. Commands and frames are delayed by that much.
  - The reference behaves the same.
- **Why only MINOR:** it is realistic mainly at startup, when the world is empty.
- **Fix:** use a conservative default estimate (e.g. cap an unmeasured batch at 1 frame's worth, or 8 ticks), and treat 0-ms samples as `resolution/ticks`.

### F7 — MINOR — Per-frame cost is dominated by `World::metrics()`; link stats are computed twice
- **Where:** `crates/sim-wasm/src/lib.rs:66-78` (`link_counts` and `link_queued` each run the full `write_link_stats`), plus `metrics()` once per frame.
- **Evidence:** see Performance below. At scale 25, `metrics()` costs 1.0 ms native per frame against 4.5 µs for encode.
- **Fix:** one call that returns both stats, or cached stats. In core-005/city, make `metrics()` incremental: no `ages` Vec and no full pass over all slots.

### F8 — MINOR — Client hardening
- **Where:** `client.ts:24`.
- No `worker.onerror`/`onmessageerror`, so if the worker module fails to load, the UI stays on "starting…" forever.
- `App.tsx:79` hard-codes `0.5` instead of importing `DT`.

### F9 — MINOR — Redundant id check in sim-wasm
- **Where:** `lib.rs:49`.
- The id check duplicates `World::schedule`'s `UnknownLink` check. It is harmless; keep one.

## Performance
**Native (release), `/tmp/gold4bench`, three_bridges with demand scaled ×k, measured after 3 sim-hours:**

| Demand | On network | `step` | `encode` | `write_link_stats` (×2 per frame) | `metrics()` |
|---|---|---|---|---|---|
| ×1 | 188 (peak 225) | 0.004 ms | 0.3 µs | 0.3 µs | 0.8 µs |
| ×10 | 2118 | 0.196 ms (max 3.3) | 5.2 µs | 5.8 µs | 0.25 ms |
| ×25 | 2296 | 0.428 ms | 4.5 µs | 4.0 µs | **1.01 ms** |
| ×50 | 1946 (peak 2451) | 1.28 ms (max 12.7) | 3.6 µs | 3.6 µs | **3.24 ms** |

At ×50, `metrics` grows with all slots, including vehicles waiting at origin.

- The network saturates at about 2.4k on-network vehicles, so a 10k on-network frame cannot be produced with this city.
- The encode, copy and link-stat path is negligible: below 0.1 ms per frame even extrapolated to 10k vehicles (16 B each, 160 kB copy).
- The frame-cost risk is `metrics()`: at 60 frames/s and ×25 demand it takes about 60 ms of worker time per second natively, likely 1.5–2× that in wasm. This competes with the 300× target of 600 ticks/s × 0.43 ms ≈ 258 ms/s.

**wasm in node (natural scale, tick 16200, 225 on network):**
- `encode` 0.9 µs, copy 0.8 µs, both link stats 1.4 µs, `metrics` 1.1 µs, `step` 3.5 µs.

## Notes for core-005
- Validate link ids in the host (F1) before the UI starts sending hit-test results.
- The UI should not keep `FrameMessage.vehicles` after `returnBuffer`: it is detached. App does this correctly (it reads `byteLength` first).
- Make `metrics()` cheap or less frequent (e.g. at 10 Hz) before demand grows (F7).
- Fix the ms/tick readout statistics (F5) if the perf HUD stays.
- `three_bridges` at natural demand peaks at about 225 on-network vehicles. A visible-queues demo or the "behind" path at 300× needs higher demand.
- Throwaway proof scripts: `/tmp/gold4probe/{clockprobe,lower2,lower3,hostprobe,diff2}.ts`, `/tmp/gold4bench`.
