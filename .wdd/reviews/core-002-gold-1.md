# Review: core-002 — Gold gate (round 1)

## Reviewer
Adversarial implementation reviewer (Claude subagent, independent of the author), 2026-10-06. Acting as the Gold quality gate.

**Inputs read**
- `livingcity.md` (performance goals)
- `.wdd/epics/core.md` (model contract: Demand, Routing, Metrics)
- `.wdd/wards/core/ward-002.md`
- `.wdd/reviews/core-002-red-4.md` (Gold notes)
- `crates/sim-core/src/{rng,demand,routing,world}.rs`, `examples/smoke.rs`, `clippy.toml`
- Tests at `2738759`; the implementation at `9b97584` (HEAD)

**Method**
- All probes ran in a throwaway copy, `/tmp/gold002` (`git archive HEAD`):
  - Instrumented copies of the approved tests
  - `tests/gold_probe.rs`
  - `examples/gold_perf.rs`
- The worktree is unchanged except for this file.

## Verdict
APPROVED

## Test tampering check
- `git diff 2738759 HEAD -- crates/sim-core/tests` → **empty** (0 bytes)
- `git diff ca8ad82 HEAD -- crates/sim-core/tests/core_001_physics.rs` → **empty** (0 bytes)
- `git diff --stat 2738759 HEAD` touches only:
  - `src/{demand,rng,routing,world}.rs`
  - `examples/smoke.rs`
  - `ward-002.md` (status `approved` → `gold`)
- `network.rs`, `params.rs` and `clippy.toml` are untouched.

## Commands + results
| Command | Result |
|---|---|
| `cargo test -p sim-core` | core_001 **20/20**, core_002 **24/24** pass |
| `cargo test -p sim-core --release` | 20/20, 24/24 |
| `cargo clippy -p sim-core --all-targets -- -D warnings` | rc = 0, no warnings |
| grep `src/` for HashMap/HashSet/Instant/SystemTime/transcendentals | only `network.rs:133` `sqrt`, which is allowed (correctly rounded) |
| `demand.rs` imports | `network::{Network, NodeId}`, `params::DT`, `rng::*` only; no `World` |

## Smoke test result
- `cargo build -p sim-core --examples` succeeds.
- Two runs of `--example smoke`, diffed: **`identical`**.

**Plausibility**
- Expected trips: 2400 veh/h on a 0.5 → 1.5 ramp over 600 s gives ≈ 400 trips at 600 s (printed 410), then 60/min gives ≈ 1600 at 1800 s (printed 1607).
- Completions start before 120 s.
- `mean_tt` is 90.8–95.0 s, against a free-flow time of ≈ 86 s for 1.2 km at 13.9 m/s plus intersection discharge.
- Queues stay small, which fits a 2-lane road below capacity.

**Conservation**
- The example asserts `spawned == active + completed + removed_unreachable` on every printed line.
- Visually, `generated == active + completed + removed` on all 30 lines (there are no explicit spawns). Example: 1607 = 77 + 1530 + 0.

## Red-4 Gold-notes check (instrumented `/tmp` copy of the approved tests)
| Note | Expected | Measured |
|---|---|---|
| Test 1 total | 532 | **532** |
| Test 8 no_route / removed / completed / waiting | 303 / 0 / 221 / 66 | **303 / 0 / 221 / 66** |
| Test 10 final costs, epoch | `[77.6667, 239.5000, 14.6550, 37.8202, 23.5827]`, 59 | `[77.66666654573544, 239.499999847946, 14.655049501069616, 37.820221137480985, 23.58273381294964]`, **59** |
| Test 13 @3000: generated / completed / active / no_route / removed / queued / mean_tt | 2964 / 2703 / 261 / 45 / 0 / 8 / 111.906 | **2964 / 2703 / 261 / 45 / 0 / 8 / 111.90584535701073** |
| Test 16 `differs_from_ff` | 863 | **863** |
| Test 24 | 95 / 95 within 1e-9, 0 exceeded | **n = 95, reached = 95, exceeded = 0** |
| Profile time check per point `!t.is_finite()` | required | `demand.rs:39`: `t.is_finite() && m.is_finite() && m >= 0.0` per point, plus strict `<` pairwise. Red N1 mutants are not present. |
| `smoke` example exists, conserves, byte-identical | required | yes (above) |
| Epoch test uses `is_multiple_of` | required | `world.rs:462` |

## Contract deviations
None found. Line-by-line:

**rng**
- `rng.rs:7-12`: `splitmix64` is exact, with wrapping ops.
- `rng.rs:15-17`: `mix3` is exact.
- `rng.rs:20-22`: `unit_f64 = (x>>11) as f64 × 2⁻⁵³`, exact.
- `rng.rs:37-41`: `BehaviorRng::next_u64` returns `splitmix64(old)`, which equals the contract's "mix of state+γ". The state then advances by γ, so it is equivalent to the contract.

**demand**
- `Profile::at` (`demand.rs:21-36`):
  - Empty → 1.0
  - At or before the first point → m0
  - At or after the last point → mn
  - Otherwise `ma + (mb − ma) × (t − ta) / (tb − ta)`, in the same operation order as the contract
- `validate` (`demand.rs:63-85`) is flow-major:
  - `UnknownNode` (origin, then dest)
  - `BadOrigin` (not a zone and has in-links)
  - `SameOriginDest`
  - `BadRate` (`!(finite && ≥ 0)`, NaN-safe)
  - then `BadProfile`
- `trips_at` (`demand.rs:97-107`):
  - `expected = vph / 3600 × DT × mult`, left to right
  - `floor` + Bernoulli using the **outer** `splitmix64(mix3(seed, t, i))`
  - Requests come out flow-major, then by copy
  - It reads only its arguments

**world: tick and demand**
- `step` (`world.rs:460-469`): demand (step 2) runs **before** the epoch update (step 3), so spawn routes use pre-update costs.
  - Proven by test 16, and independently by the probe below on a 7×7 grid.
- `spawn_demand` (`world.rs:378-408`):
  - `speed_factor = 0.9 + 0.2 × next_f64()` is drawn per request in `trips_at` order, **before** routing, so NoRoute trips draw too.
  - `spawn_with_route` keeps 1.0 and draws nothing (`world.rs:349`).
- `GeneratedTrip` is pushed with the trip id taken from the shared counter.

**world: costs**
- `update_costs` (`world.rs:411-429`):
  - `queued` counts `v < QUEUED_SPEED` on the link, in the state left by the previous tick (demand does not move vehicles).
  - `queue_term` and `observed = max(mean, queue_term)` (or `queue_term` when count = 0) match the contract.
  - EMA, then `free_flow.max(...)`, then keys; accumulators reset per link.
  - `cost_epoch += 1` after all links, then `router.invalidate()`.
- `record_exit` (`world.rs:431-436`) is called on completion (`:577`) and on transfer (`:595`), both before the vehicle leaves its slot or link.

**router**
- `Tree::build` (`routing.rs:32-78`):
  - Reverse Dijkstra over `u64` keys.
  - A zone `u ≠ dest` is popped but never expanded.
  - Next hop scans `out_links` in ascending order with strict `<`, skipping non-dest zones, unusable links and unreachable heads.
- Route cost = `dist_ms / 1000` (`:93`).
- `cost_key` = `(c × 1000).round() as u64`.
- `free_flow_cost` matches the contract.

**router cache**
- Trees are cleared on every epoch change, both through `invalidate()` and through the epoch comparison in `tree()`.
- `shortest_route` builds a fresh tree from the same keys, so it equals `route_for`.

**metrics and admission**
- NoRoute vehicles are skipped in admission (`world.rs:624-627`).
- Metrics (`world.rs:290-330`):
  - `queued` counts on-network vehicles only.
  - `unreachable = no_route + removed`; `incomplete = active`.
  - `mean_travel_time` sums over the log in log order.
  - The window is `[from, to)` on `completed_tick`.
  - `mean_incomplete_age` is computed over slots, in `vehicle_ids` order.
- `Counts`: NoRoute vehicles in buffers count as `no_route`, not waiting.

**core-001 compatibility**
- `World::new` uses empty demand and seeds 0.
- The physics path is unchanged, and core_001 passes 20/20 unchanged. The only behavioural addition is the epoch cost update, which does not touch vehicles.

## Findings

No BLOCKER. No MAJOR.

### 1. MINOR: `u64` overflow in the Dijkstra sums for absurd-but-valid link speeds (`routing.rs:48`, `routing.rs:69`)
- **Evidence** (`gold_probe::tiny_speed_overflow`): `z → a →(1e-14 m/s)→ c →(1e-14 m/s)→ d`. The network builder accepts it ("finite speed > 0").
- `cost_key` = 10000000000000002048, so two such keys sum past `u64::MAX`:
  - Debug build: `panicked at routing.rs:48:26: attempt to add with overflow`.
  - Release build: the sum silently wraps, and `shortest_route` returns `Some(cost = 1553255926290464.5 s)`, which is wrong.
- With speed 1e-17 the key saturates to `u64::MAX`, and the `<` comparison happens to treat the link as unreachable.
- Not reachable with sane inputs. Keys are ≥ 250 ms, and observed costs are bounded by run time plus link capacity.
- **Fix:** use `saturating_add` in both sums, treating `u64::MAX` as unreachable. Or add a minimum speed to the network contract (e.g. ≥ 0.1 m/s → `InvalidSpeed`). The second option is a contract change for core-001.

### 2. MINOR: huge finite rates pass validation (`demand.rs:77`, `demand.rs:102-105`)
- **Evidence:** `veh_per_hour = 1e30` → `validate` returns `Ok(())`.
- `trips_at` would then compute `floor(expected) as usize` ≈ 4e25 → saturating cast → `repeat_n(.., usize::MAX)`, which means a hang or out-of-memory.
- The contract only requires "finite", so the code conforms. This is the same class of problem as the r3 ∞-rate finding, one step further out.
- **Fix:** have the contract add an upper bound (e.g. `veh_per_hour ≤ 1e6` and multiplier ≤ 1e3 → `BadRate` / `BadProfile`) before user-editable demand exists (city/UI epics).

### 3. MINOR: `metrics()` is O(history) per call (`world.rs:319`, `world.rs:794-797`)
- `mean_travel_time` collects the **whole** `completed_log` into a fresh `Vec<f64>` on every call, and `mean_incomplete_age_s` allocates as well.
- **Measured** (release):
  - `metrics()` median 0.054 ms at 30k completed trips, which is about half of a 10k-vehicle `step()` (0.108 ms).
  - With 90k active it is 0.27 ms at p95.
- It grows linearly with run length (≈ 0.4 ms after a ~4 h run at the 10k target). The UI will poll it every frame or tick.
- **Fix:** keep a running `(sum_s, n)` updated in `complete()`. Sequential accumulation in log order gives a bit-identical result. Drop the temporary Vecs.

### 4. MINOR (design hazard, no current bug): `RouterCache::tree` ignores `usable` on cache hits (`routing.rs:110-123`)
- Correctness relies on every caller calling `invalidate()` whenever the link set or keys change.
- Its `epoch` field is redundant with `invalidate()`. It is initialised to 0 and only compared for equality, so a restored world whose `cost_epoch` equals the cached epoch but whose costs differ (a branch) would reuse stale trees unless restore calls `invalidate()`.
- **No stale path exists today:**
  - Costs change only in `update_costs`, which invalidates.
  - `Clone` copies keys and cache together.
  - Proven by `gold_probe::cached_routes_equal_fresh_and_are_valid`: 7×7 grid, 49 zones, 1800 ticks. All **5016** spawned routes equal a fresh uncached tree under the pre-step costs, **472** of them differ from free flow, and the reported cost equals the sum of keys.
- **Fix in core-003:** keep the closure set inside the cache key, or document that `invalidate()` is mandatory on Close/Open/restore. Consider dropping the `usable` parameter from `tree()` in favour of a closure bitmap stored in `World`.

### 5. MINOR: `World::shortest_route` rebuilds a full tree per call (`world.rs:251-257`)
- That is O(E log V) per call. It is fine as a test and inspection API.
- core-003 and the UI must use the cached path (`route_for`) for per-vehicle reroutes and must not call this in loops.

### 6. MINOR: smoke output does not print `spawned` (`examples/smoke.rs:33-48`)
- Conservation is asserted rather than shown. The ward asks to "verify `spawned == active + completed + removed` on every line".
- It is visually checkable only because the example has no explicit spawns.
- **Fix (cosmetic):** add a `spawned` column.

Other checks found no bugs:
- **Next-hop cycles are impossible.** Every key is ≥ 250, since free flow ≥ 1 / (8 × 0.5) s and `smoothed ≥ free_flow`. So each hop strictly decreases `dist`, and the release-mode route loop terminates. `routing.rs:91` is only a `debug_assert`, but it is not needed for termination.
- **Empty routes occur only for NoRoute.** This was checked for every live vehicle on every tick in the probe.

## Determinism
`gold_probe::determinism_and_clone_continuation`:
- Setup: two worlds from the same 6×6 scenario (heavy all-pairs demand), 2400 ticks.
- Every 7 ticks the probe compared:
  - `generated_trips`
  - `completed_log`
  - all link-cost bits
  - every `VehicleInfo`
  - `Metrics`
  - `cost_epoch`
- Result: identical throughout. A clone taken at tick 1000 also stayed identical to the original through tick 2400.
- Invariants held every tick: 6205 generated, 5484 completed, epoch 39.

## Performance
Release build on the development machine. Workload: grid of n×n junctions at 250 m, 2-lane two-way links with mixed speeds, and zones on the perimeter plus some inner nodes. Demand is all-pairs, run for 3600 ticks (30 min sim). `step` excludes epoch ticks, which are listed separately. Routing is included: lazy per-destination trees after each epoch.

| Grid | nodes / links / zones / flows | Active (on network) at end | `step` median / p95 / max | epoch tick median / max | `metrics()` median / p95 |
|---|---|---|---|---|---|
| 4×4, 60 vph | — | 134 | 0.006 / 0.013 / 0.124 ms | 0.009 / 0.023 ms | 0.005 / 0.008 ms |
| 10×10, 30 vph | 141 / 442 / 41 / 1640 | **2881** (2876) | 0.029 / 0.051 / 0.113 ms | 0.041 / 0.072 ms | 0.021 / 0.030 ms |
| 20×20, 3 vph | 501 / 1722 / 101 / 10100 | 2761 | 0.080 / 0.146 / 0.272 ms | 0.090 / 0.320 ms | 0.024 / 0.031 ms |
| 20×20, 8 vph | same | **10176** (10173) | 0.108 / 0.245 / 0.475 ms | 0.139 / 0.230 ms | 0.054 / 0.073 ms |
| 10×10, 120 vph (gridlock) | same as 10×10 | 90682 (9198, 81484 waiting) | 0.040 / 0.065 / 0.441 ms | 0.055 / 0.073 ms | 0.128 / 0.273 ms |

- The 2k and 10k targets are met with orders of magnitude to spare natively. WASM is expected to be 1.5–3× slower, which is still far inside a 16 ms frame.
- Router cost:
  - One `route_for` per spawn: a cache hit plus an O(route length) walk and Vec allocation.
  - Tree rebuilds are bounded by the number of distinct destinations per epoch (101 at most here) and are amortised over the ticks after each epoch.
  - There are no per-spawn tree rebuilds.
- The only cost that grows over a run is `metrics()` (Finding 3).

## Notes for core-003 (risks, not findings)
During this review the worktree gained an **uncommitted** edit to `.wdd/epics/core.md`. I did not make it.
- It is a core-003 draft: closure semantics, a "stranded" state, and counting rules.
- It does not alter any core-002 rule this review checked, but it does change the Metrics line `unreachable`, adding `stranded`.
- This review was made against the committed contract.
- The draft settles notes 3 and 4 in principle: stranded vehicles count in `on_network`, and removal is not logged as completed.
- It does not settle whether removal calls `record_exit`.


1. **Closures in the router.**
   - `route_for` passes `|_| true` (`world.rs:262`). Close/Open must pass a closed-set filter **and** call `router.invalidate()`, because the cache ignores `usable` on hits (Finding 4).
   - Never give a closed link a key.
2. **Restore and branching.** The cache key is only the `cost_epoch` number, and two branches can reach the same epoch with different costs. Restore must drop the cache explicitly. Keep `RouterCache` out of `state_hash`.
3. **NoRoute on links is not representable yet.**
   - `Phase::NoRoute` is currently only used in origin buffers, with an empty `route`.
   - `check_invariants` requires every lane vehicle to be `Phase::OnLink` (`world.rs:751`).
   - `Counts.no_route` scans only origin buffers (`world.rs:684-689`).
   - `VehicleState::NoRoute` carries no `LinkId`, but the frame format needs `link_id` plus the NoRoute flag bit.
   - core-003 must decide, and pin in the contract, whether a NoRoute vehicle at a stop line counts as `on_network` or `no_route`. The contract says Active = on network + waiting + NoRoute, so it must not count in both.
   - A NoRoute vehicle on a link must keep `route[route_pos]` equal to its current link. Today's NoRoute vehicles have an empty route with `route_pos = 0`, and `current_link()` would panic on them.
4. **Removal is not an exit.** `record_exit` feeds the cost accumulator, so an explicit `removed_unreachable` should vacate the lane **without** `record_exit`, unless the contract says otherwise. Pin this in the contract.
5. **Admission early exit.** `blocked.len() == out_links.len()` (`world.rs:643`) counts blocked first links. Once closed links refuse admission, a closed first link must be counted as blocked so FIFO-per-link semantics hold, and NoRoute vehicles must stay skipped.
6. **Test 16 guard (Red r3 F6, still latent).** Once periodic and forced reroutes change `route`, test 16's per-tick route equality applies only to just-spawned trips. Confirm it still holds or guard it in core-003 Red.
7. **Model observation.** At high all-pairs load the grid gridlocks: in the 10×10, 120 vph run every on-network vehicle was queued by tick 1800 and completions froze at 7588. This is a documented simplification (cycles), but the demo city's demand and topology must be tuned so that closing the bridge produces rerouting rather than gridlock.
8. **Input bounds** (Findings 1 and 2). Add a minimum link speed and maximum rate/multiplier to the contract before the UI exposes editable inputs.
