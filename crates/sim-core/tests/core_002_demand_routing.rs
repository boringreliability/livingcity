//! Ward core-002: demand, routing and metrics.
//! Model contract: `.wdd/epics/core.md` (Demand, Routing, Metrics).

use std::collections::BTreeMap;

use sim_core::demand::trips_at;
use sim_core::params::{COST_EMA_ALPHA, COST_EPOCH_TICKS, DT, QUEUED_SPEED, SAT_FLOW_PER_LANE};
use sim_core::routing::{cost_key, free_flow_cost};
use sim_core::{
    DemandModel, LinkId, Network, NetworkBuilder, NodeId, OdFlow, Profile, Scenario, TripRequest, VehicleState, World,
};

fn step_checked(w: &mut World) {
    w.step();
    if let Err(e) = w.check_invariants() {
        panic!("invariant violated at tick {}: {e}", w.tick());
    }
}

fn flows(list: &[(NodeId, NodeId, f64)]) -> Vec<OdFlow> {
    list.iter().map(|&(origin, dest, veh_per_hour)| OdFlow { origin, dest, veh_per_hour }).collect()
}

/// z1 ⇄ j1 ═ j2 ⇄ z2: two zones joined by a 1 km 2-lane two-way road.
fn corridor(rate: f64, demand_seed: u64, behavior_seed: u64) -> (Scenario, [NodeId; 2], [LinkId; 3]) {
    let mut b = NetworkBuilder::new();
    let z1 = b.zone(0.0, 0.0);
    let j1 = b.node(100.0, 0.0);
    let j2 = b.node(1100.0, 0.0);
    let z2 = b.zone(1200.0, 0.0);
    let (c1, _) = b.two_way(z1, j1, 13.9, 2);
    let (main, _) = b.two_way(j1, j2, 13.9, 2);
    let (c2, _) = b.two_way(j2, z2, 13.9, 2);
    let network = b.build().unwrap();
    let demand = DemandModel { flows: flows(&[(z1, z2, rate), (z2, z1, rate)]), profile: Profile::default() };
    (Scenario { network, demand, demand_seed, behavior_seed }, [z1, z2], [c1, main, c2])
}

fn demand_tuples(w: &World) -> Vec<(usize, NodeId, NodeId, u64)> {
    w.generated_trips().iter().map(|g| (g.flow_index, g.origin, g.dest, g.created_tick)).collect()
}

fn count_trips(model: &DemandModel, seed: u64, ticks: std::ops::Range<u64>) -> usize {
    ticks.map(|t| trips_at(model, seed, t).len()).sum()
}

// ─── 1 ────────────────────────────────────────────────────────────────────
#[test]
fn demand_is_pure_function_of_seed_and_tick() {
    // Given a two-zone scenario
    let (sc, _, _) = corridor(900.0, 7, 1);
    let model = sc.demand.clone();

    // When trips_at is evaluated forwards and backwards
    let fwd: Vec<Vec<TripRequest>> = (0..2000).map(|t| trips_at(&model, 7, t)).collect();
    let mut bwd: Vec<Vec<TripRequest>> = (0..2000).rev().map(|t| trips_at(&model, 7, t)).collect();
    bwd.reverse();

    // Then the results are identical (no hidden state) and non-trivial
    assert_eq!(fwd, bwd);
    let total: usize = fwd.iter().map(|v| v.len()).sum();
    assert!(total > 100, "too few trips to be meaningful: {total}");

    // And the world's demand log is exactly trips_at, in order, with sequential ids
    let mut w = World::from_scenario(sc).unwrap();
    for _ in 0..2000 {
        step_checked(&mut w);
    }
    let expected: Vec<(usize, NodeId, NodeId, u64)> = fwd
        .iter()
        .enumerate()
        .flat_map(|(t, reqs)| reqs.iter().map(move |r| (r.flow_index, r.origin, r.dest, t as u64)))
        .collect();
    assert_eq!(demand_tuples(&w), expected);
    let ids: Vec<u64> = w.generated_trips().iter().map(|g| g.trip_id).collect();
    assert_eq!(ids, (0..ids.len() as u64).collect::<Vec<_>>());
    assert_eq!(w.metrics().trips_generated, ids.len() as u64);
}

// ─── 2 ────────────────────────────────────────────────────────────────────
#[test]
fn demand_differs_across_seeds() {
    // Given the same model under two seeds
    let (sc, _, _) = corridor(900.0, 0, 0);
    let per_tick = |seed| (0..7200).map(|t| trips_at(&sc.demand, seed, t).len()).collect::<Vec<_>>();
    // When generating an hour of demand
    let (a, b) = (per_tick(1), per_tick(2));
    // Then the sequences differ, but the totals agree within 5 %
    assert_ne!(a, b);
    let (ta, tb) = (a.iter().sum::<usize>() as f64, b.iter().sum::<usize>() as f64);
    assert!((ta - tb).abs() <= 0.05 * ta.max(tb), "totals {ta} vs {tb}");
}

// ─── 3 ────────────────────────────────────────────────────────────────────
#[test]
fn demand_mean_rate_matches_model() {
    let (o, d) = (NodeId(0), NodeId(1));
    // Given 600 veh/h (0.083 per tick) for 4 h
    let low = DemandModel { flows: flows(&[(o, d, 600.0)]), profile: Profile::default() };
    let n = count_trips(&low, 42, 0..28_800) as f64;
    // Then 2400 ± 5 %
    assert!((n - 2400.0).abs() <= 0.05 * 2400.0, "low rate: {n}");

    // Given 9000 veh/h = 1.25 per tick (floor 1 + Bernoulli 0.25) for 1 h
    let high = DemandModel { flows: flows(&[(o, d, 9000.0)]), profile: Profile::default() };
    let per_tick: Vec<usize> = (0..7200).map(|t| trips_at(&high, 42, t).len()).collect();
    let n: usize = per_tick.iter().sum();
    // Then 9000 ± 3 %, and every tick yields 1 or 2 trips
    assert!((n as f64 - 9000.0).abs() <= 0.03 * 9000.0, "high rate: {n}");
    assert!(per_tick.iter().all(|&k| k == 1 || k == 2));
    assert!(trips_at(&high, 42, 5).iter().all(|r| r.flow_index == 0 && r.origin == o && r.dest == d));
}

// ─── 4 ────────────────────────────────────────────────────────────────────
#[test]
fn profile_interpolates_in_sim_seconds() {
    // Given a ramp from 0 at t=0 s to 2 at t=3600 s
    let ramp = Profile { points: vec![(0.0, 0.0), (3600.0, 2.0)] };
    // Then it interpolates linearly and clamps outside
    assert_eq!(ramp.at(-5.0), 0.0);
    assert_eq!(ramp.at(0.0), 0.0);
    assert_eq!(ramp.at(900.0), 0.5);
    assert_eq!(ramp.at(1800.0), 1.0);
    assert_eq!(ramp.at(3600.0), 2.0);
    assert_eq!(ramp.at(99_999.0), 2.0);
    assert_eq!(Profile::default().at(123.0), 1.0);

    let (o, d) = (NodeId(0), NodeId(1));
    // When a 3600 veh/h flow uses the ramp (evaluated at tick × DT seconds)
    let model = DemandModel { flows: flows(&[(o, d, 3600.0)]), profile: ramp };
    let hour1 = count_trips(&model, 9, 0..7200) as f64;
    let hour2 = count_trips(&model, 9, 7200..14_400) as f64;
    // Then hour 1 averages multiplier 1 and hour 2 multiplier 2
    assert!((hour1 - 3600.0).abs() <= 0.03 * 3600.0, "hour 1: {hour1}");
    assert!((hour2 - 7200.0).abs() <= 0.03 * 7200.0, "hour 2: {hour2}");

    // And a zero multiplier gives exactly zero trips
    let zero = DemandModel { flows: flows(&[(o, d, 3600.0)]), profile: Profile { points: vec![(0.0, 0.0)] } };
    assert_eq!(count_trips(&zero, 9, 0..7200), 0);
}

// ─── 5 ────────────────────────────────────────────────────────────────────
#[test]
fn demand_ignores_world_state() {
    // Given two worlds from the same scenario, one clogged with explicit spawns
    let (sc, _, [c1, main, c2]) = corridor(900.0, 11, 3);
    let mut calm = World::from_scenario(sc.clone()).unwrap();
    let mut clogged = World::from_scenario(sc).unwrap();
    for t in 0..2400u64 {
        if t < 2000 {
            for _ in 0..3 {
                clogged.spawn_with_route(vec![c1, main, c2]).unwrap();
            }
        }
        // When both run
        step_checked(&mut calm);
        step_checked(&mut clogged);
    }
    // Then the clogged world really was congested (its origin backlog is huge)
    assert!(clogged.metrics().waiting_at_origin > 1000, "clogged world not congested");
    // And the demand (flow, origin, dest, tick) is identical
    assert_eq!(demand_tuples(&calm), demand_tuples(&clogged));
    assert!(!calm.generated_trips().is_empty());
}

// ─── 6 ────────────────────────────────────────────────────────────────────
/// Minimum over all simple paths that do not pass *through* a zone, in
/// integer-millisecond keys of free-flow cost. Independent oracle.
fn brute_force_ms(net: &Network, from: NodeId, to: NodeId) -> Option<u64> {
    fn dfs(net: &Network, u: NodeId, to: NodeId, seen: &mut Vec<bool>, acc: u64, best: &mut Option<u64>) {
        if u == to {
            *best = Some(best.map_or(acc, |b| b.min(acc)));
            return;
        }
        for &l in net.out_links(u) {
            let v = net.link(l).to;
            if seen[v.index()] || (net.is_zone(v) && v != to) {
                continue;
            }
            seen[v.index()] = true;
            dfs(net, v, to, seen, acc + cost_key(free_flow_cost(net.link(l))), best);
            seen[v.index()] = false;
        }
    }
    let mut seen = vec![false; net.nodes().len()];
    seen[from.index()] = true;
    let mut best = None;
    dfs(net, from, to, &mut seen, 0, &mut best);
    best
}

#[test]
fn router_matches_brute_force_and_avoids_zones() {
    // Given a 3×3 grid (200 m) with varied speeds, plus a zone wired as a
    // very fast shortcut between two far corners
    let mut b = NetworkBuilder::new();
    let g: Vec<NodeId> = (0..9).map(|i| b.node((i % 3) as f64 * 200.0, (i / 3) as f64 * 200.0)).collect();
    let mut k = 0;
    for i in 0..9 {
        for j in [i + 1, i + 3] {
            if j < 9 && (j == i + 3 || i % 3 != 2) {
                let speed = 6.0 + ((k * 7) % 11) as f64;
                b.link(g[i], g[j], speed, 1);
                b.link(g[j], g[i], 6.0 + ((k * 5) % 13) as f64, 1 + (k % 2) as u8);
                k += 1;
            }
        }
    }
    let z = b.zone(200.0, -300.0);
    b.two_way(z, g[0], 60.0, 2);
    b.two_way(z, g[8], 60.0, 2);
    let net = b.build().unwrap();
    let w = World::new(net.clone());

    let mut checked = 0;
    for u in 0..net.nodes().len() {
        for v in 0..net.nodes().len() {
            if u == v {
                continue;
            }
            let (from, to) = (NodeId(u as u32), NodeId(v as u32));
            // When asking the router
            let got = w.shortest_route(from, to);
            let oracle = brute_force_ms(&net, from, to);
            // Then it exists iff the oracle finds a path, with the same cost
            match (got, oracle) {
                (None, None) => {}
                (Some((route, cost)), Some(ms)) => {
                    assert_eq!(cost, ms as f64 / 1000.0, "{from:?}→{to:?}");
                    // And the route is valid, sums to that cost, and never passes through a zone
                    assert_eq!(net.link(route[0]).from, from);
                    assert_eq!(net.link(*route.last().unwrap()).to, to);
                    let mut sum = 0;
                    for (i, l) in route.iter().enumerate() {
                        if i > 0 {
                            assert_eq!(net.link(route[i - 1]).to, net.link(*l).from);
                            assert!(!net.is_zone(net.link(*l).from), "{from:?}→{to:?} passes through a zone");
                        }
                        sum += cost_key(free_flow_cost(net.link(*l)));
                    }
                    assert_eq!(sum, ms);
                    checked += 1;
                }
                (g, o) => panic!("{from:?}→{to:?}: router {g:?} vs oracle {o:?}"),
            }
        }
    }
    assert_eq!(checked, 90);
    // And the shortcut really would have been cheaper for g0 → g8
    let via_zone = cost_key(free_flow_cost(net.link(net.in_links(z)[0]))) + cost_key(free_flow_cost(net.link(net.out_links(z)[1])));
    assert!(via_zone < brute_force_ms(&net, g[0], g[8]).unwrap(), "test premise: zone shortcut is cheaper");
}

// ─── 7 ────────────────────────────────────────────────────────────────────
#[test]
fn router_ties_broken_by_lowest_link_id() {
    for a_first in [true, false] {
        // Given a symmetric diamond o → {a, b} → d with identical costs
        let mut b = NetworkBuilder::new();
        let o = b.node(0.0, 0.0);
        let a = b.node(100.0, 100.0);
        let bn = b.node(100.0, -100.0);
        let d = b.node(200.0, 0.0);
        let (oa, ob) = if a_first {
            let oa = b.link(o, a, 10.0, 1);
            (oa, b.link(o, bn, 10.0, 1))
        } else {
            let ob = b.link(o, bn, 10.0, 1);
            (b.link(o, a, 10.0, 1), ob)
        };
        b.link(a, d, 10.0, 1);
        b.link(bn, d, 10.0, 1);
        let w = World::new(b.build().unwrap());
        // When routing o → d
        let (route, _) = w.shortest_route(o, d).unwrap();
        // Then the first link is the lower id of the tied pair
        assert_eq!(route[0], oa.min(ob), "a_first={a_first}");
        assert_eq!(route.len(), 2);
    }
}

// ─── 8 ────────────────────────────────────────────────────────────────────
#[test]
fn unreachable_destination_yields_no_route_state() {
    // Given zone z1 ⇄ j1 → j2, and zone z2 that only has an outgoing link
    let mut b = NetworkBuilder::new();
    let z1 = b.zone(0.0, 0.0);
    let j1 = b.node(100.0, 0.0);
    let j2 = b.node(400.0, 0.0);
    let z2 = b.zone(400.0, 100.0);
    b.two_way(z1, j1, 13.9, 1);
    b.link(j1, j2, 13.9, 1);
    b.link(z2, j1, 13.9, 1);
    let network = b.build().unwrap();
    // And demand z1 → z2 (unreachable) plus z1 → j2 (reachable)
    let demand = DemandModel { flows: flows(&[(z1, z2, 1800.0), (z1, j2, 1800.0)]), profile: Profile::default() };
    let mut w = World::from_scenario(Scenario { network, demand, demand_seed: 5, behavior_seed: 5 }).unwrap();

    // Then the router reports no route
    assert!(w.shortest_route(z1, z2).is_none());
    assert!(w.shortest_route(z1, j2).is_some());

    // When the sim runs
    for _ in 0..1200 {
        step_checked(&mut w);
        let c = w.counts();
        assert_eq!(c.active, c.on_network + c.waiting_at_origin + c.no_route);
    }
    // Then every z1 → z2 trip is a NoRoute vehicle that was never admitted
    let unreachable: Vec<u64> = w.generated_trips().iter().filter(|g| g.dest == z2).map(|g| g.trip_id).collect();
    assert!(!unreachable.is_empty());
    let mut no_route = 0;
    for id in w.vehicle_ids() {
        let info = w.vehicle(id).unwrap();
        if unreachable.contains(&info.trip_id) {
            assert_eq!(info.state, VehicleState::NoRoute);
            no_route += 1;
        }
    }
    assert_eq!(no_route, unreachable.len() as u64);
    let m = w.metrics();
    assert_eq!(m.no_route, no_route);
    assert_eq!(m.unreachable, no_route);
    // And they do not block reachable trips from the same zone
    assert!(m.completed > 100, "reachable trips blocked: {}", m.completed);
}

// ─── 9 ────────────────────────────────────────────────────────────────────
/// z ⇒ j0 ─L1(300 m, 3 lanes)→ j1 ─L2(150 m, 1 lane)→ j2 ⇒ zd, plus an unused side link j0 → s.
fn bottleneck_scenario(rate: f64) -> (Scenario, [LinkId; 3], LinkId) {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-100.0, 0.0);
    let j0 = b.node(0.0, 0.0);
    let j1 = b.node(300.0, 0.0);
    let j2 = b.node(450.0, 0.0);
    let zd = b.zone(950.0, 0.0);
    let s = b.node(0.0, 300.0);
    b.link(z, j0, 13.9, 3);
    let l1 = b.link(j0, j1, 13.9, 3);
    let l2 = b.link(j1, j2, 13.9, 1);
    let l3 = b.link(j2, zd, 13.9, 3);
    let side = b.link(j0, s, 13.9, 1);
    let network = b.build().unwrap();
    let demand = DemandModel { flows: flows(&[(z, zd, rate)]), profile: Profile::default() };
    (Scenario { network, demand, demand_seed: 3, behavior_seed: 3 }, [l1, l2, l3], side)
}

#[test]
fn congestion_raises_link_cost() {
    // Given demand of 2400 veh/h into a 1800 veh/h bottleneck
    let (sc, [l1, _, _], side) = bottleneck_scenario(2400.0);
    let ff_l1 = free_flow_cost(sc.network.link(l1));
    let ff_side = free_flow_cost(sc.network.link(side));
    let mut w = World::from_scenario(sc).unwrap();
    // When 10 minutes pass
    for _ in 0..1200 {
        step_checked(&mut w);
    }
    // Then the link upstream of the bottleneck looks expensive
    assert!(w.link_cost(l1) > 1.5 * ff_l1, "L1 cost {} vs free flow {ff_l1}", w.link_cost(l1));
    // And an unused link is exactly at free flow
    assert_eq!(w.link_cost(side), ff_side);
}

// ─── 10 ───────────────────────────────────────────────────────────────────
#[test]
fn epoch_cost_update_is_exact() {
    // Given the bottleneck scenario and an independent bookkeeping of
    // per-link enter/exit ticks and queued counts
    let (sc, _, _) = bottleneck_scenario(2400.0);
    let net = sc.network.clone();
    let n_links = net.links().len();
    let ff: Vec<f64> = net.links().iter().map(free_flow_cost).collect();
    let mut w = World::from_scenario(sc).unwrap();
    let mut smoothed = ff.clone();
    let mut acc_sum = vec![0.0f64; n_links];
    let mut acc_n = vec![0u64; n_links];
    let mut on_link: BTreeMap<u64, (usize, u64)> = BTreeMap::new(); // trip → (link, enter tick)
    let mut queued_prev = vec![0u64; n_links];
    let (mut epochs_with_exits, mut epochs_with_queue) = (0, 0);

    for l in 0..n_links {
        assert_eq!(w.link_cost(LinkId(l as u32)), ff[l], "initial cost must be free flow");
    }
    for _ in 0..3600 {
        let k = w.tick(); // tick value during this step
        let before: Vec<f64> = (0..n_links).map(|l| w.link_cost(LinkId(l as u32))).collect();
        // Epoch update in step 3 uses exits of earlier ticks and the queue left by tick k-1
        if k > 0 && k % COST_EPOCH_TICKS == 0 {
            if acc_n.iter().any(|&n| n > 0) {
                epochs_with_exits += 1;
            }
            if queued_prev.iter().any(|&q| q > 0) {
                epochs_with_queue += 1;
            }
            for l in 0..n_links {
                let link = net.link(LinkId(l as u32));
                let queue_term = link.length_m / link.speed_limit_mps
                    + queued_prev[l] as f64 / (link.lanes as f64 * SAT_FLOW_PER_LANE);
                let observed = if acc_n[l] > 0 { (acc_sum[l] / acc_n[l] as f64).max(queue_term) } else { queue_term };
                smoothed[l] = COST_EMA_ALPHA * observed + (1.0 - COST_EMA_ALPHA) * smoothed[l];
                acc_sum[l] = 0.0;
                acc_n[l] = 0;
            }
        }
        // When the world steps
        step_checked(&mut w);

        // Then its costs match the independent recomputation
        for l in 0..n_links {
            let got = w.link_cost(LinkId(l as u32));
            if k > 0 && k % COST_EPOCH_TICKS == 0 {
                let want = ff[l].max(smoothed[l]);
                assert!((got - want).abs() <= 1e-9, "tick {k} link {l}: cost {got} vs {want}");
            } else {
                assert_eq!(got, before[l], "cost changed between epochs at tick {k}");
            }
            assert!(got >= ff[l]);
        }
        assert_eq!(w.cost_epoch(), k / COST_EPOCH_TICKS);

        // Bookkeeping of this tick's exits (step 4 of tick k) and the queue it leaves
        let mut now: BTreeMap<u64, usize> = BTreeMap::new();
        for l in 0..n_links {
            for v in w.link_vehicles(LinkId(l as u32)) {
                now.insert(v.trip_id, l);
            }
        }
        on_link.retain(|trip, (l, enter)| {
            if now.get(trip) == Some(l) {
                true
            } else {
                acc_sum[*l] += (k - *enter) as f64 * DT;
                acc_n[*l] += 1;
                false
            }
        });
        for (trip, l) in now {
            on_link.entry(trip).or_insert((l, k));
        }
        for (l, q) in queued_prev.iter_mut().enumerate() {
            *q = w.link_vehicles(LinkId(l as u32)).iter().filter(|v| v.v < QUEUED_SPEED).count() as u64;
        }
    }
    // And the run exercised both the exit and the queue terms
    assert!(epochs_with_exits > 10 && epochs_with_queue > 10);
}

// ─── 11 ───────────────────────────────────────────────────────────────────
/// 4×4 grid (300 m, two-way, 1 lane) with zones at the four corners.
fn grid_with_corner_zones(rate: f64, seed: u64) -> (Scenario, Vec<NodeId>) {
    let mut b = NetworkBuilder::new();
    let g: Vec<NodeId> = (0..16).map(|i| b.node((i % 4) as f64 * 300.0, (i / 4) as f64 * 300.0)).collect();
    for i in 0..16 {
        if i % 4 != 3 {
            b.two_way(g[i], g[i + 1], 13.9, 1);
        }
        if i < 12 {
            b.two_way(g[i], g[i + 4], 13.9, 1);
        }
    }
    let corners = [(0, -60.0, -60.0), (3, 960.0, -60.0), (12, -60.0, 960.0), (15, 960.0, 960.0)];
    let zones: Vec<NodeId> = corners
        .iter()
        .map(|&(c, x, y)| {
            let z = b.zone(x, y);
            b.two_way(z, g[c], 13.9, 2);
            z
        })
        .collect();
    let network = b.build().unwrap();
    let mut list = Vec::new();
    for &o in &zones {
        for &d in &zones {
            if o != d {
                list.push((o, d, rate));
            }
        }
    }
    let demand = DemandModel { flows: flows(&list), profile: Profile::default() };
    (Scenario { network, demand, demand_seed: seed, behavior_seed: seed + 1 }, zones)
}

#[test]
fn demand_vehicles_follow_valid_routes_and_complete() {
    // Given grid demand between all corner zones
    let (sc, _) = grid_with_corner_zones(150.0, 21);
    let net = sc.network.clone();
    let mut w = World::from_scenario(sc).unwrap();
    for _ in 0..2400 {
        // When the sim steps
        step_checked(&mut w);
        let trips: BTreeMap<u64, (NodeId, NodeId)> =
            w.generated_trips().iter().map(|g| (g.trip_id, (g.origin, g.dest))).collect();
        // Then every live vehicle has a valid route from its origin to its dest
        for id in w.vehicle_ids() {
            let info = w.vehicle(id).unwrap();
            let (o, d) = trips[&info.trip_id];
            assert_eq!(net.link(info.route[0]).from, o);
            assert_eq!(net.link(*info.route.last().unwrap()).to, d);
            for i in 1..info.route.len() {
                assert_eq!(net.link(info.route[i - 1]).to, net.link(info.route[i]).from);
                assert!(!net.is_zone(net.link(info.route[i]).from));
            }
            match info.state {
                VehicleState::OnLink(l) => assert_eq!(l, info.route[info.route_pos]),
                VehicleState::WaitingAtOrigin => assert_eq!(info.route_pos, 0),
                VehicleState::NoRoute => panic!("connected grid produced a NoRoute vehicle"),
            }
        }
    }
    // And trips complete
    assert!(w.metrics().completed > 300, "completed {}", w.metrics().completed);
}

// ─── 12 ───────────────────────────────────────────────────────────────────
fn speed_factors(demand_seed: u64, behavior_seed: u64) -> (Vec<(usize, NodeId, NodeId, u64, u64)>, BTreeMap<u64, f64>) {
    let (sc, _, _) = corridor(1800.0, demand_seed, behavior_seed);
    let mut w = World::from_scenario(sc).unwrap();
    let mut factors = BTreeMap::new();
    for _ in 0..600 {
        step_checked(&mut w);
        for id in w.vehicle_ids() {
            let info = w.vehicle(id).unwrap();
            factors.entry(info.trip_id).or_insert(info.speed_factor);
        }
    }
    let demand = w
        .generated_trips()
        .iter()
        .map(|g| (g.flow_index, g.origin, g.dest, g.created_tick, g.trip_id))
        .collect();
    (demand, factors)
}

#[test]
fn behavior_rng_is_separate_from_demand() {
    // Given the same demand seed with behavior seeds 1, 1 and 2
    let (d1, f1) = speed_factors(7, 1);
    let (d1b, f1b) = speed_factors(7, 1);
    let (d2, f2) = speed_factors(7, 2);
    // Then demand (incl. trip ids) is identical across behavior seeds
    assert_eq!(d1, d2);
    assert_eq!(d1, d1b);
    // And speed factors are reproducible for the same behavior seed
    assert_eq!(f1, f1b);
    // And lie in [0.9, 1.1), vary between vehicles, and change with the behavior seed
    assert!(f1.len() > 50);
    assert!(f1.values().all(|&f| (0.9..1.1).contains(&f)));
    let first = *f1.values().next().unwrap();
    assert!(f1.values().any(|&f| f != first), "speed factor is constant");
    let differing = f1.iter().filter(|(t, f)| f2.get(t).is_some_and(|g| g != *f)).count();
    assert!(differing > f1.len() / 2, "behavior seed barely matters: {differing}/{}", f1.len());
}

// ─── 13 ───────────────────────────────────────────────────────────────────
#[test]
fn metrics_match_definitions() {
    // Given heavy grid demand (origins back up) plus an unreachable flow into
    // a zone with no in-links
    let (mut sc, zones) = grid_with_corner_zones(600.0, 4);
    let mut b = NetworkBuilder::new();
    // rebuild the same grid with an extra isolated zone that only has an out-link
    let g: Vec<NodeId> = (0..16).map(|i| b.node((i % 4) as f64 * 300.0, (i / 4) as f64 * 300.0)).collect();
    for i in 0..16 {
        if i % 4 != 3 {
            b.two_way(g[i], g[i + 1], 13.9, 1);
        }
        if i < 12 {
            b.two_way(g[i], g[i + 4], 13.9, 1);
        }
    }
    for &(c, x, y) in &[(0usize, -60.0, -60.0), (3, 960.0, -60.0), (12, -60.0, 960.0), (15, 960.0, 960.0)] {
        let z = b.zone(x, y);
        b.two_way(z, g[c], 13.9, 2);
    }
    let iso = b.zone(450.0, -200.0);
    b.link(iso, g[1], 13.9, 1);
    sc.network = b.build().unwrap();
    sc.demand.flows.push(OdFlow { origin: zones[0], dest: iso, veh_per_hour: 120.0 });
    let mut w = World::from_scenario(sc).unwrap();

    let near = |a: f64, b: f64| (a - b).abs() <= 1e-9 * a.abs().max(1.0);
    let mut saw = (false, false, false);
    for step in 1..=3000u64 {
        step_checked(&mut w);
        if step % 50 != 0 {
            continue;
        }
        // When we recompute every metric by hand
        let m = w.metrics();
        let net = w.network();
        let tick = w.tick();
        let views: Vec<_> = net.links().iter().flat_map(|l| w.link_vehicles(l.id)).collect();
        let infos: Vec<_> = w.vehicle_ids().into_iter().map(|id| w.vehicle(id).unwrap()).collect();
        let waiting = infos.iter().filter(|i| i.state == VehicleState::WaitingAtOrigin).count() as u64;
        let no_route = infos.iter().filter(|i| i.state == VehicleState::NoRoute).count() as u64;
        let log = w.completed_log();
        let mean_tt = (!log.is_empty()).then(|| {
            log.iter().map(|c| (c.completed_tick - c.created_tick) as f64 * DT).sum::<f64>() / log.len() as f64
        });
        let mean_age = (!infos.is_empty())
            .then(|| infos.iter().map(|i| (tick - i.created_tick) as f64 * DT).sum::<f64>() / infos.len() as f64);

        // Then each field agrees with its definition
        assert_eq!(m.tick, tick);
        assert_eq!(m.sim_time_s, tick as f64 * DT);
        assert_eq!(m.trips_generated, w.generated_trips().len() as u64);
        assert_eq!(m.spawned, w.counts().spawned);
        assert_eq!(m.on_network, views.len() as u64);
        assert_eq!(m.queued, views.iter().filter(|v| v.v < QUEUED_SPEED).count() as u64);
        assert_eq!(m.waiting_at_origin, waiting);
        assert_eq!(m.no_route, no_route);
        assert_eq!(m.active, infos.len() as u64);
        assert_eq!(m.active, m.on_network + m.waiting_at_origin + m.no_route);
        assert_eq!(m.completed, log.len() as u64);
        assert_eq!(m.removed_unreachable, 0);
        assert_eq!(m.unreachable, m.no_route + m.removed_unreachable);
        assert_eq!(m.incomplete, m.active);
        assert_eq!(m.spawned, m.active + m.completed + m.removed_unreachable);
        match (m.mean_travel_time_s, mean_tt) {
            (None, None) => {}
            (Some(a), Some(b)) => assert!(near(a, b), "mean tt {a} vs {b}"),
            other => panic!("mean tt mismatch {other:?}"),
        }
        match (m.mean_incomplete_age_s, mean_age) {
            (None, None) => {}
            (Some(a), Some(b)) => assert!(near(a, b), "mean age {a} vs {b}"),
            other => panic!("mean age mismatch {other:?}"),
        }
        // And the windowed mean covers exactly completions in [from, to)
        let (from, to) = (tick.saturating_sub(600), tick - 100);
        let win: Vec<_> = log.iter().filter(|c| c.completed_tick >= from && c.completed_tick < to).collect();
        let want = (!win.is_empty())
            .then(|| win.iter().map(|c| (c.completed_tick - c.created_tick) as f64 * DT).sum::<f64>() / win.len() as f64);
        match (w.mean_travel_time_s_between(from, to), want) {
            (None, None) => {}
            (Some(a), Some(b)) => assert!(near(a, b), "window {a} vs {b}"),
            other => panic!("window mismatch {other:?}"),
        }
        saw.0 |= m.queued > 0;
        saw.1 |= m.no_route > 0;
        saw.2 |= m.completed > 0 && m.waiting_at_origin > 0;
    }
    // And the run exercised queues, NoRoute and waiting vehicles
    assert!(saw.0 && saw.1 && saw.2, "metrics test vacuous: {saw:?}");
}
