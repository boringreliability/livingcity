---
epic: "core"
name: "Simulation core and first closure"
status: "active"
created: "2026-10-06"
---
# Epic: Simulation core and first closure

## Goal
Build the authoritative Rust traffic simulation (native-tested) and carry it all the way into the browser as a walking skeleton: WASM in a Web Worker → WebGL2 renderer → a React shell where the user can **close a bridge and watch rerouting emerge**. This is the first complete interaction (the brief: "spawn traffic → close a road → observe rerouting"). Visual polish, the final city and time travel come in later epics, but everything here must be designed so they fit without rewrites.

## Wards
| Ward | Name | Status |
|------|------|--------|
| core-001 | Road network, vehicles, queues and discharge | planned |
| core-002 | Demand, routing and metrics | planned |
| core-003 | Closures, rerouting, commands and determinism | planned |
| core-004 | WASM worker bridge | planned |
| core-005 | First closure in the browser (integration ward) | planned |

## Model contract (binding for all wards; reviewers check against this)

This is a deliberately simplified, coherent mesoscopic/microscopic hybrid. It is **not** a validated transport model. Every simplification is listed in "Documented simplifications".

### Units and constants (`sim_core::params`)
| Name | Value | Meaning |
|---|---|---|
| `DT` | 0.5 s | fixed tick length; sim time = tick × DT |
| `JAM_SPACING` | 7.5 m | road length one stopped vehicle occupies per lane |
| `SAT_FLOW_PER_LANE` | 0.5 veh/s | intersection discharge capacity per lane (1800 veh/h) |
| `ACCEL` | 2.0 m/s² | max acceleration; deceleration is instantaneous |
| `QUEUED_SPEED` | 2.0 m/s | "queued" threshold (see metrics) |
| `ORIGIN_ADMIT_PER_TICK` | 2 | max vehicles an origin injects per tick |
| `COST_EPOCH_TICKS` | 60 (30 s) | link-cost update interval |
| `COST_EMA_ALPHA` | 0.5 | link-cost smoothing |
| `REROUTE_PERIOD_TICKS` | 240 (120 s) | periodic route reconsideration interval, staggered |
| `REROUTE_BUDGET_PER_TICK` | 200 | max route computations per tick (excluding forced decisions) |
| `SWITCH_RATIO` / `SWITCH_MIN_GAIN_S` | 0.85 / 20 s | hysteresis: switch only if new < 0.85 × current **and** saves ≥ 20 s |
| `NO_ROUTE_RETRY_TICKS` / `NO_ROUTE_MAX_RETRIES` | 60 (30 s) / 10 | bounded retry before explicit removal |

### Network
- Directed graph. `Node { id, x_m, y_m }` holds world coordinates in **meters** (simulation data, not screen coordinates). `Link { id, from, to, length_m, speed_limit_mps, lanes }`, where length defaults to the Euclidean node distance.
- Each link has `lanes` **independent lane queues**. Lane capacity `lane_cap = max(1, floor(length_m / JAM_SPACING))`, link capacity `cap = lanes × lane_cap`. Min gap between consecutive vehicles in a lane: `JAM_SPACING`.
- IDs are dense `u32` indices, and all iteration is in ascending ID order. Adjacency lists (`out_links`, `in_links`) are sorted by link ID.
- **No `HashMap`/`HashSet` iteration in sim logic** (nondeterministic order). Use `Vec`/`BTreeMap`.

### Vehicles
- Stored in a slot `Vec` with a LIFO free list (deterministic reuse). Each vehicle has `trip_id`, `route: Vec<LinkId>` + `route_pos`, `state`, `s` (m along current link), `v` (m/s), `speed_factor` (behavior RNG, [0.9, 1.1]), `link_enter_tick`.
- States: `WaitingAtOrigin` (in the origin's FIFO buffer, not on a link) · `OnLink` · `NoRoute { retries, next_retry_tick }` (waiting, either in the buffer or at a stop line). Completed/removed vehicles leave the slot table. Counters and the trip log keep the record.
- Each lane holds an ordered queue of vehicle IDs, **front (nearest stop line) first**. A vehicle keeps its lane until it leaves the link.
- **Lane choice on entry** (discharge or origin): among lanes with `count < lane_cap` and (empty or `tail_guaranteed ≥ entry_s + JAM_SPACING`), take the lane whose `tail_guaranteed` is furthest ahead (empty = best). Ties → lowest lane index.
- **`tail_guaranteed`** (the lane's last vehicle's position *after this tick's movement*, which is lower-bounded): if the tail is already marked moved this tick, `tail.s`; else `min(tail.s + v'_tail × DT, limit_now)` where `v'_tail = min(tail.v + ACCEL×DT, vmax×speed_factor)` and `limit_now` = link length (tail is the lane front) or `leader.s − JAM_SPACING` using the leader's **current** position. Movement can only move the tail at least this far (leaders never move backwards), so the gap after movement is ≥ JAM_SPACING. This removes a time-level mismatch: the entering vehicle's position is its post-tick position, so the tail must be compared at post-tick too. Found by the core-001 Red review.

### Tick order (stable, single-threaded)
1. **Commands** scheduled for this tick, in log order (`CloseLink`, `OpenLink`).
2. **Demand**: generate this tick's trips (pure function of `(demand_seed, tick)`) and append them to origin buffers in trip ID order.
3. **Routing maintenance**: on an epoch boundary, update link costs. Then process due reroutes up to the budget (priority queue first, then periodic).
4. **Node discharge**: nodes ascending. Each node's incoming **lanes** (in-links ascending × lane index) in **round-robin order**: the scan starts at the node's `rr_next` index and wraps around once. After a successful **transfer** (not a completion) from incoming lane `i`, `rr_next = (i + 1) mod n_in_lanes`. The scan order of the current tick is fixed at scan start; updates take effect next tick. `rr_next` is world state (snapshotted). Not `tick mod n`: downstream space often frees with a fixed period, which would always favor the same feeder. Each lane earns `SAT_FLOW_PER_LANE × DT` = 0.25 credit per tick (capped at 1.0), **every tick, including empty lanes**, and initial credit is 0. Several transfers per node per tick are allowed (at most one per incoming lane). Only the lane's **front** vehicle is considered. With `v' = min(v + ACCEL×DT, vmax×speed_factor)` and `reach = s + v'×DT`, the front can cross only if `reach ≥ length` ("reaches the stop line this tick"):
   - route finished → **completes** (no credit used; `completed_tick` = the tick value during which it completes, before the increment);
   - otherwise transfer to the next link iff lane credit ≥ 1, next link **open**, and a lane with space exists for `entry_s = min(reach − length, length_next)` (lane-choice rule). The vehicle is placed at `entry_s` with `v = min(v', vmax_next)`, credit −= 1, and marked *moved this tick*;
   - otherwise it stays (movement step 6 will stop it at the stop line). The front blocks its lane, so there is no passing through a blocked intersection.
   - A vehicle that crossed this tick is not eligible again this tick. With ACCEL = 2 m/s² a standing lane queue discharges with exactly 4-tick (2 s) headways, i.e. at saturation flow.
5. **Origin admission**: origin nodes ascending. Walk the buffer in FIFO order, skipping `NoRoute` vehicles, and admit up to `ORIGIN_ADMIT_PER_TICK` per origin per tick whose first link is open with a lane with space at `entry_s = 0`. A vehicle that cannot be admitted **blocks later vehicles with the same first link** (no overtaking within a link's queue), while vehicles for other first links may proceed. Admitted vehicles enter with `v = 0` and are marked moved.
6. **Movement**: links ascending, lanes ascending, vehicles front→back, skipping vehicles marked moved: `v' = min(v + ACCEL×DT, vmax × speed_factor)`, `limit = length` (front) or `leader.s − JAM_SPACING`, `s' = clamp(s + v'×DT, s, limit)`, `v = (s' − s)/DT`. Vehicles never move backwards or overlap.
7. **Bookkeeping**: metrics, `tick += 1`.

Queue spillback emerges from rule 4: a full downstream link stops the front vehicle, followers stack at `JAM_SPACING`, the link fills, and its upstream feeder then cannot discharge.

### Demand (`sim_core::demand`)
- `DemandModel { flows: Vec<OdFlow { origin, dest, veh_per_hour }>, profile: piecewise-linear multiplier over sim seconds }`.
- For tick `t`, flow `i`: `expected = veh_per_hour/3600 × DT × profile(t)`. Count = `floor(expected)` + Bernoulli(`frac(expected)`), with the uniform drawn from a **counter-based** generator `splitmix64(mix(demand_seed, t, i))`. No transcendental functions, so it is bit-identical native vs. WASM.
- Demand is therefore a pure function of `(model, demand_seed, tick)` and **cannot be affected by world state or interventions**. Trip IDs are assigned in generation order, so they are identical across branches.
- Behavior randomness (`speed_factor`, etc.) comes from a separate stateful `behavior_rng` stored in `World`.

### Routing (`sim_core::routing`)
- Link cost (seconds) = `max(free_flow, smoothed)`, where `free_flow = length / vmax + 1 / (lanes × SAT_FLOW_PER_LANE)`. At each epoch: `observed = max(mean traversal time of vehicles that left the link this epoch (if any), queue_term)`, with `queue_term = vehicles on link / (lanes × SAT_FLOW_PER_LANE) + length / vmax`. `smoothed ← α × observed + (1 − α) × smoothed`. A closed link has infinite cost (excluded).
- Router: reverse Dijkstra from each destination over current costs, with integer-millisecond keys and tie-break on lower link ID. Shortest-path trees are cached per `(dest, cost_epoch)`. The cache is a **pure function of snapshot state** (costs + closure set + epoch), so restore can drop it and rebuild deterministically.
- A route is computed at spawn (from the origin), at periodic reconsideration and when forced. A vehicle is always committed to its current link: new routes start at the current link's `to` node (a **valid decision point**). A waiting origin vehicle routes from its origin.

### Closures and rerouting
- `CloseLink(l)`: no vehicle may enter `l` (discharge and origin admission). Vehicles already on `l` continue and may leave. Every vehicle whose **remaining** route (after its current link) contains `l` is pushed onto the priority reroute queue.
- A front vehicle at a stop line whose next link is closed and which has not been rerouted yet is rerouted **immediately** (a forced decision, outside the budget).
- No route → `NoRoute`: the vehicle waits in place, retries every `NO_ROUTE_RETRY_TICKS`, and after `NO_ROUTE_MAX_RETRIES` it is **explicitly removed** (`removed_unreachable += 1`, vacates its link).
- `OpenLink(l)`: link enterable again. Vehicles pick it up through periodic reconsideration and NoRoute retries (no global forced recompute).
- Periodic reconsideration: due at `(tick + trip_id) mod REROUTE_PERIOD_TICKS == 0`, enqueued FIFO, processed within budget (overflow carries over). The hysteresis rule (above) prevents flapping.

### Commands and determinism
- `Command { tick, kind }` is applied at the start of `tick`. The command log is part of the scenario.
- `World::state_hash()` = FNV-1a over all state (float bits included), used for determinism tests.
- `World` is plain data: `Clone`, no `Rc`, no globals, no wall clock. This prepares snapshots (epic `timeline`).

### Metrics (definitions shown in UI later)
- **Active** = on network + waiting at origin + NoRoute (spawned, not yet finished).
- **Queued** = vehicles **on the network** with `v < QUEUED_SPEED` (2 m/s ≈ 7 km/h), i.e. stopped or crawling.
- **Completed**, plus a trip log `(trip_id, created_tick, completed_tick)`. **Mean travel time** = mean of `(completed − created) × DT` over a chosen window (default: since start). Waiting at the origin counts as travel time.
- **Unreachable** = `removed_unreachable` + currently `NoRoute`.
- **Incomplete** = active trips with their current age (for fair comparisons).
- Conservation: `trips_generated == active + completed + removed` **at every tick**.

### Frame / boundary format (core-004)
- Per vehicle, 16 bytes: `link_id: u32`, `s: f32` (m), `v: f32` (m/s), `flags: u32` (bit0 queued, bit1 on closed link, bit2 NoRoute, bits 8..15 lane index). There are **no x/y or screen coordinates from Rust**. The renderer maps link + s → world → screen.
- The network is exported once: node coordinates (m), link from/to/lanes/length/speed.

### Float comparisons
The threshold comparisons are exact, with no epsilon, in exactly this form: crossing iff `s + v' * DT >= length`; lane feasible iff `tail_guaranteed >= entry_s + JAM_SPACING`; `v'` = `min(v + ACCEL * DT, vmax * speed_factor)`. Same expression, same order of operations everywhere (determinism and test reproducibility).

### Documented simplifications
Independent lanes without lane changes (lane picked on entry) · instantaneous deceleration · no traffic signals (rotating-priority intersections) · no turn restrictions or turn delays beyond saturation flow · instant completion at the end of the final link · origins/destinations are nodes · Bernoulli-approximated Poisson demand · possible gridlock in cycles is not resolved in this epic (see epic `city`).

## Integration Points
- `city` builds the final river city on `sim_core::network` + `demand`, and extends the renderer from core-005.
- `timeline` requires `World: Clone` + the command log + pure demand from this epic.
- Rust crate public API lives in `crates/sim-core/src/lib.rs`. Check it before adding new helpers.

## Completion Criteria
- `cargo test` (all core wards) green. `pnpm test` (vitest) green. Playwright e2e green.
- In the browser: the city is visible, vehicles move, "Close the main bridge" closes it with a physical marker, no new vehicles enter, traffic finds the other crossings, and queues visibly form, all from the simulation.
- Human epic gate: demo + commands + review log.
