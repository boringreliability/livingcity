# Review: core-003 — Gold gate (round 1)

## Reviewer
Adversarial implementation reviewer (Claude subagent, independent of the author), acting as the Gold quality gate, 2026-10-06.

**Inputs read**
- `livingcity.md` context, `.wdd/epics/core.md` (binding contract), `.wdd/wards/core/ward-003.md`
- `crates/sim-core/src/{world.rs,cities.rs,command.rs,routing.rs}`, `examples/bridge.rs`
- `.wdd/reviews/core-003-red-7.md`, `core-003-red-7-auto.md`
- Reference implementation `/tmp/ref003` (`MUT` unset)

**Revisions**
- Tests approved at `12d383b`.
- Implementation at HEAD `ffb5ee3`.

## Verdict
APPROVED

## Test tampering check
```
$ git diff 12d383b HEAD -- crates/sim-core/tests | wc -c
       0
$ git diff --stat 12d383b HEAD
 .wdd/wards/core/ward-003.md        |   2 +-   (status: approved → gold)
 crates/sim-core/examples/bridge.rs |  44 ++++
 crates/sim-core/src/cities.rs      |  85 ++++++-
 crates/sim-core/src/world.rs       | 503 +++++++++++++++++++++++++++++++++----
```
- The test diff is empty: **no tampering**.
- The worktree was clean at the start of the review. During the review, `.wdd/PROJECT.md` and `.wdd/wards/core/ward-004.md` were modified by another process, not by this reviewer. They are not part of the reviewed implementation.
- The test files are byte-identical to the Red-approved ones. Against `/tmp/ref003`, the only differences are test 36 and the test-35 `route_switches` assert; both were added under the auto-approval.

## Commands + results
| Command | Result |
|---|---|
| `cargo test -p sim-core` | core_001 **20/20**, core_002 **24/24**, core_003 **36/36** (5.1 s); 80 green |
| `cargo clippy -p sim-core --all-targets -- -D warnings` | clean |
| `cargo build -p sim-core --examples --release` | ok |
| `cargo run -p sim-core --release --example bridge` ×2 + `diff` | identical (0.57 s wall per run) |

## Smoke test result
**Pass**, with one honest qualification on criterion 4 (queue growth); see the last item below and finding M3.

- **Before the closure**, the central bridge carries the most west→east exits per minute: 17–35/min, against 0–8 for north and 0–4 for south.
- **After the closure** (20:00):
  - central exits are 4 in minute 21 (vehicles already on the bridge), then **0** from 22:00 on;
  - north rises to 14–28/min and south to 3–30/min;
  - `unreachable` stays 0 throughout, and `stranded` stays 0.
- **Determinism:** two runs are byte-identical.
- **"queued rises near the alternative crossings":**
  - The example prints only network-wide `queued`. That column rises only weakly: about 2.4 on average before the closure (max 5), about 3.5 after (max 8 at 22:00).
  - I measured the approach links into W(0,2)/W(2,2) plus the north and south bridges (`/tmp/gold003/imp/tests/zz_smoke.rs`):

    | Measure | Before | After |
    |---|---|---|
    | Queued near the alternatives, mean | 0.02 | **1.44** |
    | Queued near the alternatives, max | 2 | **16** |
    | Vehicles near the alternatives, mean | 6.5 | 47.8 |

    So a local queue does form and dissolve.
  - The small size is a **demand-calibration property of the fixed test city**, not an implementation bug:
    - west→east demand is 3 × 660 = 1980 veh/h;
    - the two 1-lane alternative bridges have 2 × 1800 veh/h of saturation capacity, so utilisation after the closure is about 55–60 %;
    - the reference implementation produces the identical output.
  - The criterion is met in substance, but it is not directly visible in the example output (M3).

## Exact-value / differential check
**Key values.** I instrumented a copy of the test file with the Red reviewer's probe script, retargeted to the implementation (`/tmp/gold003/imp/tests/zz_probe.rs`). Every key value equals the Red-7 reference table:

| # | Implementation | Red-7 reference |
|---|---|---|
| 1 | central 727 / all 876 | 727 / 876 ✓ |
| 2 | 13 at closure | 13 ✓ |
| 4 | dc 635 / db 112 | 635 / 112 ✓ |
| 5 | 87 switches | 87 ✓ |
| 6 | tracked 654, stranded 80, removed 417 | ✓ |
| 7 | 241 done / 241; marks [212, 212, 282, 813] | ✓ |
| 8 | rs (3382, 0, 0, 3000, 200) | ✓ |
| 9 | 0 switches; [1038, 754] | ✓ |
| 11 | completed 5061 | ✓ |
| 13 | completed 1050, removed 1310, no_route 201 | ✓ |
| 17 | z0 on B1 at tick **33**, forced 2 | ✓ |
| 18 | no_route 50 | ✓ |
| 19 | 11 removed | ✓ |
| 22 | 346 @ 1830 | ✓ |
| 24 | n = 11, forced 0 | ✓ |
| 25 | 204 waiting / 258 switches | ✓ |
| 26 | 3000 − 200·(t − 9), drained at t = 24 | ✓ |
| 27 | 20 switches / 21 budgeted | ✓ |
| 28 | r0 = [56, 4, 6, 50, 28, 30, 63], r1 = [56, 4, 6, 21, 48, 36, 28, 30, 63] | ✓ |
| 29 | 0 switches / 21 budgeted in both cases | ✓ |
| 30 | 11 → 22, budgeted 12 | ✓ |
| 31, 35, 36 | exact ticks are asserted in the tests themselves (633; ct 47, forced 60, on B1 at 60) | pass ✓ |

**Differential.** The harness `/tmp/gold003/diffbin` compares the implementation with the reference `/tmp/ref003`, `MUT` unset, crate renamed to `sim-core-ref`.
- **Static check:** `three_bridges` network, demand, landmarks and zones are identical (Debug equality). The construction order follows the ward exactly: verticals column-major, connectors zone → junction in zone-id order.
- **What is compared, after every step:**
  - `metrics()` and `reroute_stats()`;
  - closed set and cost epoch;
  - every link's cost bits, exit count and full `link_vehicles` (id, trip, lane, s, v bits);
  - every origin buffer length;
  - full `VehicleInfo` of every live vehicle;
  - generated and completed counts.

**three_bridges, 14 400 ticks (2 h), full comparison every tick:**

| Scenario | Result |
|---|---|
| bridge example (central closed at 2400) | identical; 5171 completed, 84 switches |
| mixed: central close/reopen; north close; all six closed at 6000 and reopened at 6480; same-tick close/open/close at 9001 | identical; 1652 retries, 360 switches |
| all six bridges closed for good at 1200 | identical; 4723 removed, 48 120 retries |
| 6 × random stress, 80 commands each on non-connector links | identical; 1668–4419 removals per seed |

**Grid, 20×20 with 80 zones, 4800 ticks** (column cut at 3600, row cut at 4200; full link-vehicle comparison every 50 ticks and for 20 ticks after each burst, otherwise metrics and stats):
- identical at rate 250 (14 forced decisions, budget saturated at 200);
- identical at rate 400 (33 forced, 116 985 switches, 9796 removals).

**First divergence: none.** The implementation is observationally identical to the independent reference in every tested scenario.

## Contract deviations
None found. Line-by-line check:

**Step 1, commands** (`world.rs:434-454`, `640-671`)
- `schedule` returns `InPast` iff `tick < world.tick`, then `UnknownLink`.
- The log keeps acceptance order, and commands are applied in that order.
- Closing an already closed link and opening an open one are no-ops that are still logged.
- `close_link`:
  - sets the closed flag and invalidates the cache;
  - enqueues in ascending slot order every live, non-NoRoute, non-stranded vehicle whose `remaining()` contains `l` (OnLink: `route[pos+1..]`; waiting: the whole route);
  - deduplicates against the priority queue.
- `OpenLink` invalidates the cache and forces nothing.

**Step 3 order** (`world.rs:876-889`): (a) epoch update, then (b) `enqueue_periodic`, then (c) `run_retries`, then (d) `process_reroute_queues`. Exactly as specified.

**Queues**
- Entries are `(slot, trip)`. A trip mismatch counts as gone (slot reuse).
- Periodic dedup checks both flags. Each flag is cleared exactly when its live entry is popped, so the flags mirror queue membership.
- Gone, NoRoute and stranded entries are dropped at cost 0.
- A vehicle on its final link is dropped at cost 0.
- Every other pop costs 1. Priority is served before periodic. At 200 the loop stops and the rest waits in order.
- `budgeted_total` and `max_budgeted_in_a_tick` are updated per tick.

**Hysteresis** (`794`): `new < 0.85·current && current − new ≥ 20`. `current` is Σ `cost_key / 1000` over the remaining links, or ∞ if any of them is closed.

**`assign_route`**
- On a link it keeps the prefix `route[..=pos]` plus the path; at the origin or when NoRoute, it uses the path alone.
- A switch is counted only if the route vector changed.

**Forced decision** (`1001-1016`)
- Order of checks:
  1. completion first;
  2. stranded fronts return (they take no forced decision);
  3. then the next-link-closed check, before the credit check.
- The reroute starts from `link.to`, through `decision_point`.
- On failure the vehicle is stranded (count 0, `next_retry_tick = tick + 60`) and does not cross.
- `forced_total` is counted; no budget is spent.

**Admission** (`1071`): a closed first link is treated as blocked, which also blocks later vehicles with the same first link.

**NoRoute vs. stranded**
- NoRoute clears the route and sets `route_pos = 0`. Stranded keeps the route.
- Retries:
  - ascending slot, outside the budget;
  - `retries` counts the failed retries of the current episode and is reset on entry and on success;
  - removal happens on the 10th failure, at T + 600;
  - removal is not an exit and not a completion, and frees the slot.
- A NoRoute vehicle created at spawn retries at T + 60 (`Vehicle::new`).

**Routing and hashing**
- `shortest_route` and `route_for` both use `usable = !closed`. The cache is invalidated on close, open and epoch.
- `state_hash` covers every `World` field except `network`, `demand`, `free_flow` (static or derived) and `router`. That includes every vehicle field (flags, origin and dest, `moved_tick`), the queues, the stats, the closed set and the command log.

**Physical model**: `World: Clone`, no `Rc`, no globals.

## Findings

### M1. MINOR: per-tick O(slots) and O(command log) scans
- **Where:** `world.rs:641-642` (`apply_commands` filters the whole command log every tick, plus a `Vec` allocation), `674-676` (`enqueue_periodic`) and `696-699` (`run_retries`).
- **Evidence:**
  - With 200 000 pending commands, an empty world costs 0.06 ms/tick.
  - The slot scans are the same order as movement (O(N)), and they appear in the performance numbers below as negligible.
- **Contract:** the route computations themselves are bounded as the contract requires (budget, due-only retries, forced only at stop lines). So this is not a "Must NOT" violation.
- **Fix (optional, core-004/timeline):**
  - keep a cursor into the command log, or a `BTreeMap<tick, Vec<idx>>`, for pending commands;
  - keep due-tick buckets for periodic due and retries.

### M2. MINOR: `remove_unreachable` locates a buffered vehicle by scanning every origin buffer
- **Where:** `world.rs:838`, `find(|b| b.contains(&slot))`.
- **Correctness:** fine. A slot is in exactly one buffer (checked by invariant), and the scan cannot pick the wrong buffer.
- **Cost:** O(total buffered) per removal. The vehicle already stores `origin`, so `self.origin_buffers[v.origin.index()]` would be O(buffer).
- **Measured:** no spikes. The worst tick in the grid run (9796 removals) was the closure tick, not a removal tick.

### M3. MINOR: the bridge example does not show the smoke criterion "queued rises near the alternative crossings"
- **Where:** `examples/bridge.rs:21-37` prints only network-wide `queued`. In this lightly loaded city that column barely moves (≈ 2.4 → ≈ 3.5).
- **Evidence:** local queues near the alternatives rise from a mean of 0.02 to a mean of 1.44 (max 16), as measured above.
- **Fix:** add a "queued near N/S bridges" column (approach links into W(0,2)/W(2,2) plus those bridges), or the queue on each bridge approach. The core-005 demo needs the same signal.

### M4. MINOR (edge case; identical in the reference): a vehicle on a non-final link that ends at its own destination node cannot be rerouted
- **Where:** `routing.rs:83` returns `None` when `dist == 0` (from == dest). This is core-002 behaviour.
- **Proof:** `/tmp/gold003/imp/tests/zz_gold.rs::loop_through_destination_then_continuation_closes`.
  - An explicit route `[o→x, x→d, d→y, y→d]` is spawned, and `d→y` is closed while the vehicle is on `x→d`.
  - The vehicle is stranded at tick 47 and **removed** at 647 instead of completing at `d`. The reference does the same.
  - Contract-wise, `path(d → d)` is the empty path, so the reroute should give `route[..=pos]` and the trip should complete at the end of the current link.
- **Reachability:** only through `spawn_with_route` with a route that revisits its destination. Router-built routes stop at the first arrival at `dest` (next hop of `dest` is `None`), so demand traffic can never reach this state.
- **Fix (optional):** `decision_point`/reroute treats `from == dest` as `Some(([], 0.0))`, or `spawn_with_route` rejects routes that visit their destination before the end.

### M5. MINOR: the forced-decision success path can leave the vehicle's priority entry queued
- **Where:** the forced success path at `world.rs:1006-1010`.
- **Effect:** after a successful forced reroute, the vehicle's priority entry is still queued. It is popped later and costs 1 budget for a recomputation that normally changes nothing.
- **Contract:** this conforms (only gone, NoRoute and stranded entries are free), and the reference behaves the same.
- **Note for core-004/005:** under a large backlog, roughly `forced_total` budget units are spent twice.

No BLOCKER or MAJOR findings.

## Performance
Release build, Apple Silicon, harness `/tmp/gold003/diffbin/src/perf.rs`.
- **Grid:** 20×20, 200 m spacing, 13.9 m/s, every fifth row and column 2-lane; 80 zones on 3-lane connectors, 3 flows per zone.
- **Bursts:**
  - at tick 3600, close all 40 links between columns 9 and 10 (a full cut);
  - at tick 4200, close all 40 links between rows 9 and 10.
- **Timed window:** ticks 3000–4800.

| Rate (veh/h per flow) | Active vehicles | Median | p95 | Closure tick | 2nd burst | Max |
|---|---|---|---|---|---|---|
| 250 | 5 000 → 7 150 | 0.075 ms | 0.151 ms | 1.45 ms | 1.46 ms | 1.46 ms |
| 400 | 25 000 → 32 000 (20 k on network) | 0.195 ms | 0.364 ms | 8.7 ms | 7.9 ms | 8.7 ms |
| reference, 400 | same | 0.488 ms | 0.644 ms | 16.9 ms | 20.1 ms | 20.1 ms |

- The rate-400 run saturates the budget (`max_budgeted_in_a_tick` = 200) and removes 9796 vehicles.
- Even at about 3× the requested 10 k vehicles, the closure burst stays under 10 ms. That is two orders of magnitude inside a 500 ms real-time tick, and comfortable for fast-forward in a worker.

## Notes for core-004/005 and epic city
- **Hash and snapshots:** `state_hash` hashes the queue flags (`in_priority`/`in_periodic`) and the queues. A snapshot/restore (timeline) must carry both, or the hash diverges.
- **Command log (core-004):** the log is also the replay log. Pending commands live only there, so the worker bridge must serialise it whole.
- **Frame flags:** "bit1 on closed link" can be computed from `is_closed(current link)`. "Stranded" has no bit in the frame format. Consider using a free bit so the UI can mark stranded vehicles; `VehicleInfo.stranded` exists.
- **core-005:**
  - for the demo, the example/UI should show queues on the bridge approaches (M3);
  - the city epic should calibrate demand so that closing the main bridge visibly saturates the alternatives: west→east demand of at least ~0.8 × the alternatives' capacity, or 1-lane bridges with more residential demand.
- **City epic:** the M4 edge case cannot occur with router-built routes. If the final city ever injects scripted or explicit routes, validate that they do not revisit their destination.
- **Test harness:** the throwaway harness (`/tmp/gold003`, diff/perf/probe) can be reused for core-004 parity checks between native and WASM.
