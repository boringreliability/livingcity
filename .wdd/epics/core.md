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
| core-001 | Road network, vehicles, queues and discharge | complete |
| core-002 | Demand, routing and metrics | complete |
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
- Directed graph. `Node { id, x_m, y_m }` holds world coordinates in **meters** (simulation data, not screen coordinates). `Link { id, from, to, length_m, speed_limit_mps, lanes }`, where length defaults to the Euclidean node distance. Valid links: finite length ≥ `MIN_LINK_LENGTH` = 10 m (else `TooShort`), finite speed > 0 (else `InvalidSpeed`), 1 ≤ lanes ≤ 8 (`MAX_LANES`), no self-loops. The builder never panics; errors surface in `build()`.
- Each link has `lanes` **independent lane queues**. Lane capacity `lane_cap = max(1, floor(length_m / JAM_SPACING))`, link capacity `cap = lanes × lane_cap`. Min gap between consecutive vehicles in a lane: `JAM_SPACING`.
- **Zones (centroids)**: `NetworkBuilder::zone()` marks a node where trips may start/end. **No route passes through a zone.** Zones connect to junctions via connector links, so zone traffic merges with through traffic in the normal round-robin discharge. A trip origin must be a zone or a node without in-links. This rules out unfair origin-vs-through competition at the same node: an origin entering at rest needs 7.5 m, while a moving front needs `entry_s + 7.5`, so origins would always win and starve through traffic (found by the core-001 Red review r6). The router (core-002) never relaxes through zones. **Destinations may be any node** (zone or junction); trips complete at the end of their last link. A dead-end node with in-links is not a valid origin (use a zone). A zone's share at a merge is per connector **lane** (round robin is per incoming lane), so connector lane counts set its priority. Spawn validation order: `EmptyRoute` → `UnknownLink` → `NonContiguousRoute` → `OriginHasThroughTraffic` → `RouteThroughZone`. Each rule is checked over the whole route before the next rule (rule-major), reporting the first offending index. Rejected spawns consume no trip id.
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
   - otherwise transfer to the next link iff lane credit ≥ 1, next link **open**, and a lane with space exists for `entry_s = min(reach − length, length_next)` (lane-choice rule). The vehicle is placed at `entry_s` with `v = min(v', vmax_next × speed_factor)`, credit −= 1, and marked *moved this tick*;
   - otherwise it stays (movement step 6 will stop it at the stop line). The front blocks its lane, so there is no passing through a blocked intersection.
   - A vehicle that crossed this tick is not eligible again this tick. With ACCEL = 2 m/s² a standing lane queue discharges with exactly 4-tick (2 s) headways, i.e. at saturation flow.
5. **Origin admission** (origins are zones or source nodes, never junctions with through traffic; entering at rest needs `tail_guaranteed ≥ 7.5`, not the tail's current `s`, so one origin lane admits at most ≈ 0.4 veh/s; `ORIGIN_ADMIT_PER_TICK` binds only with ≥ 3 lanes): origin nodes ascending. Walk the buffer in FIFO order, skipping `NoRoute` vehicles, and admit up to `ORIGIN_ADMIT_PER_TICK` per origin per tick whose first link is open with a lane with space at `entry_s = 0`. A vehicle that cannot be admitted **blocks later vehicles with the same first link** (no overtaking within a link's queue), while vehicles for other first links may proceed. Admitted vehicles enter with `v = 0` and are marked moved.
6. **Movement**: links ascending, lanes ascending, vehicles front→back, skipping vehicles marked moved: `v' = min(v + ACCEL×DT, vmax × speed_factor)`, `limit = length` (front) or `leader.s − JAM_SPACING`, `s' = max(s, min(s + v'×DT, limit))` (written exactly so; not `f64::clamp`, which panics when rounding makes `limit < s` by one ulp), `v = (s' − s)/DT`. Vehicles never move backwards or overlap.
7. **Bookkeeping**: metrics, `tick += 1`.

Queue spillback emerges from rule 4: a full downstream link stops the front vehicle, followers stack at `JAM_SPACING`, the link fills, and its upstream feeder then cannot discharge.

### Demand (`sim_core::demand`)
- `DemandModel { flows: Vec<OdFlow { origin, dest, veh_per_hour }>, profile: Profile }`. A flow's origin must be a zone or a source node, `origin != dest`, and `veh_per_hour` is finite and in `[0, MAX_FLOW_VEH_PER_HOUR = 100 000]` (`DemandModel::validate`). Validation is flow-major: for each flow in order, `UnknownNode` (origin, then dest) → `BadOrigin` → `SameOriginDest` → `BadRate`, then the profile → `BadProfile`.
- `Profile`: points `(sim_s, multiplier)` with **finite**, strictly increasing times and finite multipliers ≥ 0 (∞ or NaN anywhere → `BadProfile`; a rate of ∞ would make `floor(expected)` saturate to `usize::MAX`). Empty means constant 1.0. Before the first point it takes the first multiplier, after the last the last, and in between `m0 + (m1 − m0) × (t − t0) / (t1 − t0)`. It is evaluated at **sim seconds** `t = tick × DT`.
- For tick `t`, flow `i`: `expected = veh_per_hour / 3600.0 * DT * profile(t × DT)`. Count = `floor(expected)` + (1 if `unit_f64(splitmix64(mix3(demand_seed, t, i))) < expected − floor(expected)`). The requests come out in flow order, then copy index.
- RNG primitives (`sim_core::rng`): `splitmix64(x)` (standard: `z = x + 0x9E3779B97F4A7C15; z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9; z = (z ^ (z >> 27)) * 0x94D049BB133111EB; z ^ (z >> 31)`, wrapping), `mix3(a, b, c) = splitmix64(splitmix64(splitmix64(a) ^ b) ^ c)`, `unit_f64(x) = (x >> 11) as f64 × 2⁻⁵³`. `BehaviorRng { state }`: `next_u64` does `state += 0x9E3779B97F4A7C15` and returns the splitmix64 output mix of the new state. No transcendental functions anywhere, so native ≡ WASM bit for bit.
- Demand is therefore a pure function of `(model, demand_seed, tick)` and **cannot be affected by world state or interventions**. Trip IDs are assigned in generation order, so they are identical across branches.
- Behavior randomness comes from a separate stateful `BehaviorRng` stored in `World`, seeded by `behavior_seed`. Each demand vehicle (NoRoute ones included) draws `speed_factor = 0.9 + 0.2 × next_f64()` at spawn, in `trips_at` order, giving a range of [0.9, 1.1] (1.1 is reachable only through float rounding). Explicit `spawn_with_route` vehicles keep `speed_factor = 1.0` and draw nothing.

### Routing (`sim_core::routing`)
- Link cost (seconds) = `max(free_flow, smoothed)`, where `free_flow = length / vmax + 1.0 / (lanes × SAT_FLOW_PER_LANE)` and `smoothed` starts at `free_flow`.
- Every exit from a link (transfer or completion) adds `(tick − link_enter_tick) × DT` to that link's epoch accumulator (sum + count).
- In tick step 3, when `tick > 0 && tick % COST_EPOCH_TICKS == 0`, for every link: `queue_term = length / vmax + queued_on_link / (lanes × SAT_FLOW_PER_LANE)`, where `queued_on_link` counts vehicles on the link with `v < QUEUED_SPEED` (state as left by the previous tick). `observed = max(sum / count, queue_term)` if count > 0, else `queue_term`. Then `smoothed = max(free_flow, COST_EMA_ALPHA * observed + (1.0 - COST_EMA_ALPHA) * smoothed)` and cost = `smoothed`. The clamp keeps idle links from drifting below free flow, which would delay their response when congestion starts. The accumulators reset, and after all links `cost_epoch += 1`.
- **Only queued vehicles count in `queue_term`.** Counting all vehicles would make a busy free-flowing road look congested (a 100 s road at 0.5 veh/s holds ≈ 50 moving vehicles, which would double its cost), and routing would shun main roads for no reason.
- A closed link is **excluded** from routing (core-003). It is never given a key, since `cost_key(inf)` would saturate and overflow sums.
- **Router**: for destination `d`, Dijkstra over **reversed** links on integer keys `key(l) = (cost(l) × 1000).round() as u64` gives `dist_ms[u]`. Node `u ≠ d` is only expanded (its in-links relaxed) if `u` is not a zone, so no path passes through a zone (origin and destination may be zones). Next hop of `u` = the out-link `l` (ascending id; skip links whose `to` is a non-destination zone) minimizing `key(l) + dist_ms[l.to]`, where strictly smaller wins, so ties go to the lower link id. The route is built by following next hops. Its reported cost is `dist_ms[origin] as f64 / 1000.0`.
- Trees (`dist_ms`, `next_hop`) are cached per destination and dropped when `cost_epoch` changes (and on closure changes). The cache is a **pure function of snapshot state** (costs + closure set + epoch), so restore can drop it and rebuild deterministically. It is excluded from `state_hash`.
- A route is computed at spawn (from the origin), at periodic reconsideration and when forced. A vehicle is always committed to its current link: new routes start at the current link's `to` node (a **valid decision point**). A waiting origin vehicle routes from its origin.

### Closures and rerouting
- `CloseLink(l)` (tick step 1): `l` becomes closed. No vehicle may enter it (discharge and origin admission refuse it). Vehicles already on `l` continue and may leave. The router excludes closed links (`usable = !closed`) and its cache is invalidated. Every vehicle whose **remaining** route contains `l` is pushed onto the **priority reroute queue** in ascending slot order (skipping duplicates). For a vehicle on a link, remaining means `route[route_pos+1..]`; for a vehicle waiting at its origin, the whole route.
- `OpenLink(l)`: `l` is enterable and usable again, and the cache is invalidated. Nothing is forced. Vehicles pick it up through periodic reconsideration, and stranded/NoRoute vehicles on their next retry.
- **Valid decision point**: an on-link vehicle reroutes from its current link's `to` node and keeps `route[..=route_pos]` (the current link is never replaced); new route = `route[..=route_pos] ++ path(to → dest)`. A waiting origin vehicle reroutes from its origin (new route = path(origin → dest)). A vehicle on its final link never needs a reroute.
- **Step 3 order**, exactly: (a) epoch cost update (on boundaries); (b) enqueue periodic candidates due this tick; (c) NoRoute/stranded **retries** due this tick (ascending slot, outside the budget); (d) the **priority queue** first, then the **periodic FIFO**, spending at most `REROUTE_BUDGET_PER_TICK` route computations this tick. The rest waits for the next tick, order kept. Queue entries whose vehicle is gone (completed/removed) or is NoRoute/stranded are dropped without spending budget. Every other entry popped costs 1, whether it switches or not. A vehicle on its final link has nothing to reroute: it is dropped from the queue at a cost of 0. Priority reroutes always take the best route. Periodic reroutes switch only if `new < SWITCH_RATIO × current_remaining` **and** `current_remaining − new ≥ SWITCH_MIN_GAIN_S`, where `current_remaining = Σ cost_key(link_cost) / 1000` over the current remaining links (∞ if any is closed) and `new` is the router's reported cost.
- Periodic due rule: at step 3 of tick `t`, each live, non-stranded vehicle that is `WaitingAtOrigin` or on-link-not-final with `(t + trip_id) % REROUTE_PERIOD_TICKS == 0` is appended to the periodic FIFO (ascending slot order) unless it is already in **either** queue.
- Queue entries are `(slot, trip_id)`. An entry whose slot now holds a different trip (slot reuse) counts as gone.
- Stats: `budgeted_total` = budget-consuming pops; `forced_total` = forced decisions; `retries_total` = retry attempts (successful or not); `switches_total` = route changes after spawn from any cause (priority, periodic switch, forced, successful retry), counted **only when the route vector actually changes**. Each vehicle's `route_switches` is the same per-vehicle count.
- `World::shortest_route` uses the current costs **and** current closures.
- **Forced decision** (step 4): a **non-stranded** lane front that reaches the stop line, has a next link, and whose next link is closed is rerouted on the spot from the link's `to` node (counted in `forced_total`, not in the budget). If a route is found, the normal crossing rules then apply to the new next link in the same evaluation.
- Admission (step 5) treats a closed first link as blocked: the vehicle waits (it is in the priority queue), and later vehicles for that link are blocked too (FIFO-per-first-link).
- **No route**: a waiting origin vehicle without a route becomes `NoRoute` (stays in its buffer, counted in `no_route`). An on-link vehicle without a route becomes **stranded**: it stays on its lane (a stranded front blocks its lane) and is counted in `stranded`. Both retry every `NO_ROUTE_RETRY_TICKS` (step 3, outside the budget; `next_retry_tick = tick + NO_ROUTE_RETRY_TICKS`). A **stranded** vehicle keeps its old route unchanged while stranded. A NoRoute vehicle at its origin has an empty route. A successful retry restores normal state. Stranded/NoRoute vehicles act **only** on their retry schedule: a reopening does not resume them before their next retry, and they take no forced decisions. After `NO_ROUTE_MAX_RETRIES` failed retries the vehicle is **removed**: it leaves its buffer/lane, `removed_unreachable += 1`, it is not logged as completed, it is **not** an exit (no `link_exit_count`, no exit-time sample), and its slot is freed. A vehicle entering NoRoute/stranded at tick `T` is therefore retried at `T+60, …, T+600` and, if none succeeds, removed at tick `T + 600` exactly.
- Counting: `on_network` includes stranded vehicles. `waiting_at_origin` excludes NoRoute. `active = on_network + waiting_at_origin + no_route`. `unreachable = no_route + stranded + removed_unreachable`.

### Commands and determinism
- `Command { tick, kind: CloseLink(l) | OpenLink(l) }`. `World::schedule(cmd)` accepts it iff `cmd.tick >= world.tick()` (else `InPast`) and the link exists (else `UnknownLink`). Accepted commands are applied in step 1 of their tick, in acceptance order (stable for equal ticks). Closing a closed link or opening an open one is a no-op that is still logged. `command_log()` lists every accepted command in acceptance order (applied or pending). The command log is what replay records.
- A NoRoute vehicle created by demand spawn in tick `T` (step 2) gets `next_retry_tick = T + NO_ROUTE_RETRY_TICKS`, like any other NoRoute/stranded transition.
- `World::state_hash()` = 64-bit FNV-1a over **all simulation state** in a fixed order: tick; every slot (incl. `None` markers) with every vehicle field (float bits); free list; lane queues; credits (bits); `rr_next`; origin buffers; exit counts; counters; completed log and running sums; demand seed and behavior RNG state; generated trips; costs (smoothed bits, keys, accumulators), cost epoch; closed set; pending and logged commands; reroute queues and stats. It excludes only the static network/demand model and the derived router cache. Two worlds with equal hashes at tick `t` are (with overwhelming probability) in identical state.
- `World` is plain data: `Clone`, no `Rc`, no globals, no wall clock. This prepares snapshots (epic `timeline`).

### Metrics (definitions shown in UI later)
- **Active** = on network + waiting at origin + NoRoute (spawned, not yet finished). A NoRoute vehicle in an origin buffer counts as NoRoute, not as waiting.
- **Queued** = vehicles **on the network** with `v < QUEUED_SPEED` (2 m/s ≈ 7 km/h), i.e. stopped or crawling.
- **Completed**, plus a trip log `(trip_id, created_tick, completed_tick)`. **Mean travel time** = mean of `(completed − created) × DT` over a chosen window (default: since start). Waiting at the origin counts as travel time.
- **Unreachable** = `removed_unreachable` + `no_route` (at origins) + `stranded` (on links without a route).
- **Incomplete** = active trips with their current age (for fair comparisons).
- Conservation: `spawned == active + completed + removed` **at every tick** (`spawned` = demand trips + explicit spawns; `trips_generated` = demand trips only).

### Frame / boundary format (core-004)
- Per vehicle, 16 bytes: `link_id: u32`, `s: f32` (m), `v: f32` (m/s), `flags: u32` (bit0 queued, bit1 on closed link, bit2 NoRoute, bits 8..15 lane index). There are **no x/y or screen coordinates from Rust**. The renderer maps link + s → world → screen.
- The network is exported once: node coordinates (m), link from/to/lanes/length/speed.

### Float comparisons
The threshold comparisons are exact, with no epsilon, in exactly this form: crossing iff `s + v' * DT >= length`; lane feasible iff `tail_guaranteed >= entry_s + JAM_SPACING`; `v'` = `min(v + ACCEL * DT, vmax * speed_factor)`. Same expression, same order of operations everywhere (determinism and test reproducibility). Movement speed is `v = (s' - s) / DT`, which may exceed `vmax × speed_factor` by float rounding, so invariant checks allow 1e-9 m/s, and lane spacing checks allow 1e-9 m. Lane credit is added (`credit = min(1.0, credit + 0.25)`) at the start of that lane's evaluation, before the crossing decision.

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
