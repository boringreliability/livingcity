# Traffic model

Living City uses a deliberately simple *mesoscopic* model. It aims for queues that are visible and believable, at a cost that can run thousands of vehicles per tick in the browser. It is not a calibrated traffic engineering tool. Each simplification below states why it was made. The constants live in `crates/sim-core/src/params.rs` and the cities in `crates/sim-core/src/cities.rs`.

## Time
- **Fixed step:** one tick is 0.5 s of sim time.
- **Fixed order** within each tick:
  1. commands;
  2. new demand;
  3. a cost update, every 60 ticks;
  4. reroutes (periodic and closure-triggered, budgeted);
  5. NoRoute retries;
  6. intersection discharge;
  7. origin admission;
  8. vehicle movement.

## Links, lanes, storage and queues
- **Links.** A link is directed. It has a length (the distance between its nodes, in metres), a speed limit, 1–8 lanes, and a saturation flow per lane.
- **Storage.**
  - A stopped vehicle occupies 7.5 m (jam spacing).
  - Lane capacity = ⌊length / 7.5⌋, at least 1.
  - Link capacity = lanes × lane capacity.
- **Movement.** Movement is a "car-following-lite" model, not a point queue. Each lane is a FIFO.
  - A vehicle accelerates at 2 m/s² towards its desired speed: the speed limit × a personal factor in [0.9, 1.1) drawn at spawn.
  - It never closes within 7.5 m of its leader.
  - Deceleration is instantaneous.
  - Vehicles therefore pile up behind each other at jam spacing. A queue is simply a line of slow vehicles, and it grows back upstream along the link.
- **Spillback.**
  - A lane's front vehicle may only cross the stop line if a lane on its next link has room at the tail.
  - If none has, it waits, and the queue propagates upstream link by link.
  - Vehicles never overlap.
  - *Why:* storage-limited links make spillback emerge from the network itself, with no scripting.
- **Lane choice.** On entry, a vehicle takes the feasible lane whose tail is furthest ahead; ties go to the lowest lane index. There are no lane changes along a link. *Why:* lane changing adds a lot of cost and little visible behaviour at this scale.

## Intersections: discharge and saturation flow
- **Saturation flow.**
  - Each lane earns discharge credit at its link's saturation flow. The default is 0.5 veh/s per lane, i.e. 1,800 veh/h per lane. Credit is capped at 1 vehicle.
  - A crossing costs one credit, so a lane passes at most one vehicle per tick.
  - Individual links may have a lower saturation flow. River City's Old Bridge has 0.25 veh/s (900 veh/h).
- **Competing approaches.**
  - At a node, the approaches are served **round-robin** in a stable order (link id, then lane), starting after the last lane that discharged.
  - Nodes are processed in id order.
- **No signals and no turn restrictions.** There are no signal phases, no conflict geometry inside the junction, and no turn restrictions. *Why:* the round-robin with saturation flow gives fair and bounded discharge, and it keeps the cost linear in the number of lanes. Signals are a v2+ sandbox feature.
- **Arrival.** Arriving at the destination is not capacity-limited. A vehicle on the last link of its route completes at the stop line.

## Routing
- **Link cost** is a travel-time estimate in seconds.
  - Free flow: length / speed limit + 1 / (lanes × saturation flow).
  - Every 60 ticks (30 s), each link's observed cost becomes the larger of two values:
    - the mean time of the vehicles that left it in that period;
    - its queue term (free travel time + queued vehicles / discharge rate).
  - The observed cost is then smoothed with an **exponential moving average** (α = 0.5) and never drops below free flow.
  - *Why:* EMA smoothing and the 30 s update interval damp oscillation between routes.
- **Shortest paths.** They come from a reverse Dijkstra tree per destination, over integer millisecond costs. Ties go to the lowest link id, which keeps routing deterministic. The trees are cached and rebuilt after a cost update, a closure, a reopening or a restore.
- **Budgeted, staggered rerouting.**
  - A vehicle reconsiders its route every 240 ticks (2 min), at a phase offset given by its trip id.
  - At most 200 reroute evaluations run per tick. Closure-triggered reroutes are served first.
  - *Why:* a closure must not trigger a single-tick spike that recomputes every route at once.
- **Hysteresis.**
  - A periodic reroute switches only if the new route is at least 15 % *and* 20 s cheaper than the remaining current route.
  - A route through a closed link always counts as infinitely expensive.
  - *Why:* without hysteresis, vehicles flap between two nearly equal routes.
- **Decision points.** A vehicle on a link reroutes from the link's downstream node, keeping the link it is on. A vehicle waiting at its origin reroutes from the origin.

## Closures, reopening and NoRoute
- **Closing a link.**
  - New vehicles can no longer enter it.
  - Vehicles already on it may still drive off it.
  - Every vehicle whose remaining route uses the link is queued for a priority reroute.
  - A vehicle that reaches the stop line in front of a closed link is forced to decide at once.
  - Closed links are drawn hatched with barriers.
- **Reopening a link.** Reopening clears the closure and the route cache. Vehicles take the reopened link through their next periodic reroute; nothing is forced.
- **When no route exists.**
  - A vehicle at its origin becomes *NoRoute*. A vehicle on a link becomes *stranded*: it waits at the stop line, blocking its lane.
  - Both retry every 60 ticks (30 s). After 10 failed retries (about 5 minutes) the trip is **removed as unreachable**.
  - *Why:* this is a bounded schedule. A disconnected destination then cannot hold vehicles forever, and it is still counted.

## Gridlock relief
- **The problem.** Oversaturated meshes with round-robin discharge can deadlock in a cycle: every lane front waits for a full downstream lane.
- **Reroute.** A front that has been blocked for 60 s (by lack of space, not lack of credit) searches for a new path that avoids its blocked next link. It does this again every further 60 s.
- **Removal.** If a front is still blocked after 10 minutes, it is **removed as gridlocked** and counted separately.
- *Why:* gridlock otherwise freezes the city for good, which is unrealistic (drivers turn around). Removals are counted, never hidden.

## Demand
- **OD flows.** Demand is a fixed list of OD flows in vehicles per hour between zones.
  - River City has 22 zones: residential districts on both banks, workplaces, and St. Mary's Hospital.
  - There is a time-of-day profile, but the built-in cities use it flat.
- **Trip counts.** Each tick, each flow emits ⌊expected⌋ trips, plus one more with probability equal to the fractional part.
- **Counter-based randomness.** The random number is a counter-based hash of (demand seed, tick, flow index), with no stored generator state. *Why:* the future trip population is a pure function of time. A closure or a branch can never change who travels when, so A and B share identical demand.
- **Origins.** A trip waits in its origin's FIFO buffer until its first link has room. At most 2 vehicles are admitted per origin per tick.
- **Behaviour randomness.** The personal speed factor uses a separate seeded stream, so demand never depends on it.

## River City
- A river splits the town, and three bridges cross it:
  - the **Main Bridge**: 2 lanes, 3,600 veh/h;
  - the **North Bridge**: 1 lane, 1,800 veh/h;
  - the **Old Bridge**: 1 lane at 30 km/h, 900 veh/h. This is the limited-capacity alternative.
- Together the alternatives carry 2,700 veh/h, below the roughly 3,000 veh/h of west→east cross-river demand. Closing the Main Bridge therefore oversaturates them visibly, and the city still recovers after a reopening.
- The calibration rationale is in `.wdd/memory/decisions/river-city-calibration.md`. Outcomes are never scripted.

## Metrics: what the numbers mean
- **queued** means an on-network vehicle moving slower than 2 m/s (7.2 km/h). It is stopped or crawling in a queue, and it is drawn as a square car with a brake band.
- **active** is the vehicles on the network plus the trips waiting at their origin (including NoRoute ones).
- **completed** is the trips that reached their destination.
- **mean travel time** is measured from the trip's creation to its arrival, so time spent waiting at the origin counts.
- **unserved** means trips the network failed to serve. It sums those currently without any route (NoRoute at the origin, stranded on a link) and those removed as unreachable or gridlocked.
- **incomplete**, in a comparison, means trips from the compared cohort that are still on their way or waiting. Neither scenario has completed them yet, and they have not been removed.
  - The cohort is the trips generated since the branch tick, which are the same trips in A and B. For each scenario, the comparison reports generated, completed, removed as unreachable, removed as gridlocked, incomplete, and the mean and p95 travel time of the completed trips (p95 by nearest rank).
  - Incomplete trips are always shown, so a scenario does not look better just because its slowest trips have not arrived yet.
- **Conservation.** Every spawned vehicle is active, completed or removed: spawned = active + completed + removed. `World::check_invariants` checks this in the tests.
