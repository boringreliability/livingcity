# polish-005 Gold review 1

**Verdict: APPROVED** (0 BLOCKER, 0 MAJOR, 6 MINOR)

Reviewed: `git diff fe8a692..HEAD` (d74ce2c, a2017e0) against ward spec `.wdd/wards/polish/ward-005.md`, epic P5/P6, brief invariants.

## Frozen tests
Hashes are unchanged:
- `crates/sim-core/tests/polish_005_perf.rs`: `e51fce84…448c`
- `web/tests/polish005.test.ts`: `8577307d…7723`
- `web/e2e/restart.spec.ts`: `cd55c4eb…1e78`

No test file appears in `fe8a692..HEAD`. `web/src/ui/testHook.ts` is the app-side hook, not a test.

## What I ran (load = `uptime` 1-min average)
| Command | Load | Result |
|---|---|---|
| `cargo test --workspace --release` | 9.4 → 7.0 | all green; polish_005_perf 5/5; core/city/timeline suites 0 failures |
| `cargo clippy --workspace --all-targets -- -D warnings` | 7.2 | exit 0 |
| `pnpm -C web build:wasm`, `pnpm -C web typecheck` | 7.2 | ok, tsc exit 0 |
| `pnpm -C web test` | 7.2 → 6.9 | 25 files, 124 passed |
| `pnpm -C web e2e` | 6.3 → 22 (shared machine) | 115 passed, 1 skipped (review1 G4, pre-existing), 18.3 min; `trap_offers_restart` passed |
| `cargo run -p sim-core --release --example frame_cost_probe` | 20.6 | ×5 after: step 0.0885 ms, metrics 0.0092 ms (committed: 0.0762 / 0.0088); before (full scan): 0.3707; branch 1.597 ms (committed 1.328). Same conclusions under 1.5× the load. The JSON was restored with `git checkout`. |
| Independent baseline: the probe in `baseline` mode on a `git archive 4e5d5c1` copy | 17.2 | ×5 step 0.2955 ms, metrics 0.3503, branch 11.7 ms. This confirms the committed baseline (0.3306 / 0.3824 / 15.3) within load noise. |
| Same probe pair, warm-up 2600 ticks (the browser stress state) | 9.4 | ×3: step 0.0861 → 0.0394 ms; ×5: 0.1515 → 0.0629 ms; metrics ×5 0.1589 → 0.0093 ms |

## Determinism audit
**Code read:** `SlotIndex` (`crates/sim-core/src/world.rs:290-352`) and every transition that can change `live`, `created_sum`, `no_route`, `stranded`, a periodic bucket or a retry entry:
- spawn: `enqueue_at_origin` is the single path for `spawn_demand` (WaitingAtOrigin and NoRoute) and `spawn_with_route`;
- admission: no indexed field changes;
- `enter_without_route` from priority reroutes, forced decisions and the stranded path: it unschedules the old retry when the vehicle was already without a route;
- `run_retries`: on success the counters drop; on failure it reschedules; at the last attempt `remove_unreachable` → `index.remove`;
- `remove_gridlocked`, `complete`;
- `restored` rebuilds the index, and `snapshot` stores `SlotIndex::default()`.

`assign_route` touches none of the indexed fields. The periodic bucket `(P − tick%P)%P` is exactly the set where `(tick+trip_id)%P==0`, and the in-loop check is kept. The `BTreeSet` keeps the ascending slot order. With DT = 0.5 the age sum is exact, so the u128 formula is bit-identical to the float sum.

**Differential probe** (scratch copies of 4e5d5c1 and HEAD, same source, release):
- **Scenarios:**
  - the city-001 ring for 4000 ticks, with random `spawn_with_route` and random close/open of any link;
  - three_bridges with 5 seed pairs × 7200 ticks: random all-bridge closures and reopenings and random single-link closures. This produced NoRoute (1,489 samples) and stranded vehicles (2,356);
  - River City ×1 (1 GiB and 6 MiB), ×3 (48 MiB) and ×5 (24 MiB) timelines: 14 rounds of random commands, random seeks inside the window, edits below the head, up to 5 branches each (some with ¼ budget, so eviction happens), and stepping, editing and seeking in the branches.
- **Hashes and metrics:** 5,869 lines of `state_hash` + metrics bits + `counts()` are **byte-identical** between pre-ward and HEAD.
- **Index checks:** on HEAD, at every tick and after every seek and branch, I checked three things: `metrics()` == `metrics_full_scan()` bit for bit, `counts()` == the full-scan counts, and the live index == `SlotIndex::build(slots)`, which also rules out stale retry entries. That is **112,997 checks with 0 mismatches**.
- **Arc sharing:** a branch, then edits below the head in A, then eviction in B. The hashes and windows are identical to the deep-clone code, apart from the byte accounting (m5).

## Web audit
- **Per-side pools.** `postFrame(s,t,side)` reuses from and clears only `pools[side]` (`host.ts:509-516`). `returnBuffer` without a side goes to `viewed`, so F2/G8 still hold.
- **The side in App calls.** All 6 `returnBuffer` calls in `App.tsx` pass the frame's own `scenario` (`f.scenario`, `a.scenario`, `pendingPairA.current.scenario`). The correct side is used, so Red m1 is not realized.
- **Clock.** `init` → `clock.reset()` (all fields) → `resetExecuted`. The client re-sends speed and running after init.
- **Fatal errors.** These are fatal: a trap in `iterate`, an `init` failure, `worker.onerror` and `onmessageerror`. `fatal` is cleared only by `restart()`, and the banner has no Dismiss button.
- **Restart.** `generation` re-runs the client effect: the cleanup calls `c.dispose()` (`worker.terminate()`) and `renderer.dispose()`, which does not call `loseContext`, so the canvas is reusable. A new worker and renderer are created.

## Manual smoke test (Playwright MCP, dev server :5291, stopped afterwards)
1. `?demand=5`, diagnostics:
   - at 20×: sim tick mean 0.238 ms, ~27.7k active / 5.9k on the network, frame encode 0.20 ms;
   - at 5×: 0.299 ms, 42.8k active (load ~10–17).
   - The browser is not comparable to the doc's 0.248 ms (27k active) without a pre-ward build (see m1). The native probe shows the gain.
2. Pause: the tick stays at 4347, and 360 frames were drawn in 3 s. Rendering continues (e2 pinned).
3. I rewound 1 min, closed the main bridge (B branch), compared side by side and played for 60 s at 5×. The main-thread JS heap ranged 17–47 MB with GC sawtooth and no growth.
4. `debugTrap()` during compare:
   - The alert reads "The simulation stopped: simulation halted: unreachable", with only "Restart simulation".
   - Esc and B did not clear it.
   - Restart brought back a single-view living city (sim time 00:15:04, advancing, speed kept at 5×).
   - I repeated it with a selected road: it worked.
   - There were no page errors; the console's only error is the favicon 404.

Pass criteria:
- [x] The numbers improved and are documented. Native: yes. Browser: deferred (m1).
- [x] Compare memory is steady.
- [x] Restart works.
- [x] All suites are green, and the golden hashes hold.

## Findings
**m1 MINOR: the "Must DO" `e2e:perf` re-run and the docs baseline update are deferred** (`docs/performance.md` §baseline tables, `web/perf-results/*-5x.json` still dated 2026-10-08).
- **Problem:** The ward's Must DO is unmet as written. The smoke run cannot show a browser-side improvement without it.
- **Why this is not a blocker:** The epic's P6 contract explicitly requires "The perf harness is re-run and `docs/performance.md` is updated from the JSON". The P5 required outcomes (metrics ≤ 25 %, e4 re-measured, cause documented) are met by the native probe, which I independently reproduced.
- **Fix:** Record the deferral in the ward (Must DO) and CONTEXT. polish-006 must cite the before/after stress-5x tick mean from the harness.

**m2 MINOR: Restart does not give a clean UI state** (`web/src/App.tsx:130-136`). `restart()` clears only `fatal`, `error`, `ready` and `frame`.
- **Observed:**
  - The guide keeps ✓4 ✓5 earned in the dead world.
  - The selected road (`selectedLink: 0`) carries over.
  - By code reading, `tracked`/`trackedRef`/`following`, `pendingSeek`, `pendingPairA`, `comparison`, `mainPending` and `confirmReplace` are not reset either. A stale tracked vehicle the new worker does not know about is possible (not exercised).
- **Fix:** In `restart()`, reset the guide progress, `clearVehicle()`, the selection, `pendingSeek`, `pendingPairA`, the B refs, `comparison` and `confirmReplace`. Alternatively, key the stateful subtree on `generation`.

**m3 MINOR: the banner disappears on click, not "when the new worker is ready" as the spec says** (`App.tsx:131`, `setFatal(null)`). If the re-init fails, it reappears, so nothing is hidden. Align the spec or clear it in `onReady`.

**m4 MINOR: halted-state UX.**
- The fatal text is technical ("simulation halted: unreachable").
- While halted, the controls still read "Pause" and "5.0× of 5×" and stay enabled (Compare, Discard, bridge).
- Suggest a plainer message and disabled sim controls while `fatal` is set.

**m5 MINOR: snapshot accounting and docs.**
- `Snapshot::bytes()` grew by 112 B per snapshot, because `size_of::<World>()` now includes the inline `SlotIndex`. The probe saw 337,274 → 337,610 B for 3 snapshots. Eviction boundaries can shift marginally relative to the pre-ward code; sim results are unchanged.
- The field classification comment on `Snapshot` (`crates/sim-core/src/timeline.rs` ~l.46-56, "derived (empty in the snapshot): router") does not list `index`.
- **Fix:** Add `index` to the derived list. Optionally, mention the per-snapshot delta.

**m6 MINOR: pool lifetime** (`web/src/sim/host.ts:143,565`).
- `pools[1]` is never cleared after compare ends: buffers returned with side 1 stay until the next compare. This is bounded to a few buffers of about 100 KB each.
- `init` does not clear the pools.
- **Fix:** Clear both pools on `init` and when leaving compare.

## Notes for the epic gate
- e2 (paused frames) and e3 (allocation per frame) remain pinned deviations, as recorded.
- Backlog accounting:

  | Item | Status |
  |---|---|
  | e1 | done |
  | e4 | done (native: 11.7–15.3 → 1.3–1.6 ms) |
  | f1 | done |
  | f2 | done |
  | g7 | done |
  | e2 | pinned |
  | e3 | partial (per-side pools) |

  CONTEXT/backlog updates are still to do at `wdd complete`.
