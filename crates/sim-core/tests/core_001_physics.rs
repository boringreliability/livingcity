//! Ward core-001: road network, vehicles, queues and discharge.
//! Model contract: `.wdd/epics/core.md`.

use std::collections::BTreeMap;

use sim_core::params::{DT, JAM_SPACING, SAT_FLOW_PER_LANE};
use sim_core::{LinkId, NetworkBuilder, NetworkError, NodeId, VehicleId, World};

const EPS: f64 = 1e-6;

fn step_checked(w: &mut World) {
    w.step();
    if let Err(e) = w.check_invariants() {
        panic!("invariant violated at tick {}: {e}", w.tick());
    }
}

/// o ─L1(300 m, `l1_lanes`)─▶ a ─L2(`l2_len`, 1 lane)─▶ b ─L3(500 m, 3 lanes)─▶ c
/// Node ids ascend along the chain, so `a` is discharged before `b` each tick.
fn bottleneck_chain(l1_lanes: u8, l2_len: f64) -> (World, [LinkId; 3], NodeId) {
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(300.0, 0.0);
    let bb = b.node(300.0 + l2_len, 0.0);
    let c = b.node(800.0 + l2_len, 0.0);
    let l1 = b.link(o, a, 13.9, l1_lanes);
    let l2 = b.link(a, bb, 13.9, 1);
    let l3 = b.link(bb, c, 13.9, 3);
    (World::new(b.build().unwrap()), [l1, l2, l3], o)
}

// ─── 1 ────────────────────────────────────────────────────────────────────
#[test]
fn builder_computes_length_and_capacity() {
    // Given a small network with a 3-4-5 triangle link and short links
    let mut b = NetworkBuilder::new();
    let a = b.node(0.0, 0.0);
    let c = b.node(300.0, 400.0);
    let d = b.node(0.0, 100.0);
    let l_ac = b.link(a, c, 13.9, 2);
    let l_ad = b.link(a, d, 10.0, 1);
    let l_dc = b.link_with_length(d, c, 12.0, 10.0, 1);
    let (l_cd, l_dc2) = b.two_way(c, d, 8.0, 1);

    // When it is built
    let net = b.build().expect("valid network");

    // Then lengths are Euclidean unless overridden
    assert!((net.link(l_ac).length_m - 500.0).abs() < EPS);
    assert!((net.link(l_ad).length_m - 100.0).abs() < EPS);
    assert!((net.link(l_dc).length_m - 12.0).abs() < EPS);
    assert!((net.link(l_cd).length_m - net.link(l_dc2).length_m).abs() < EPS);
    assert_eq!(net.link(l_cd).from, c);
    assert_eq!(net.link(l_dc2).from, d);

    // And lane capacity = max(1, floor(len / 7.5)), capacity = lanes × lane capacity
    assert_eq!(net.lane_capacity(l_ac), 66);
    assert_eq!(net.capacity(l_ac), 132);
    assert_eq!(net.lane_capacity(l_ad), 13);
    assert_eq!(net.capacity(l_ad), 13);
    assert_eq!(net.lane_capacity(l_dc), 1);

    // And adjacency is sorted ascending by link id
    assert_eq!(net.out_links(a), &[l_ac, l_ad]);
    assert_eq!(net.in_links(c), &[l_ac, l_dc, l_dc2]);
    assert_eq!(net.out_links(c), &[l_cd]);
    assert_eq!(net.nodes().len(), 3);
    assert_eq!(net.links().len(), 5);
}

// ─── 2 ────────────────────────────────────────────────────────────────────
#[test]
fn builder_rejects_invalid_links() {
    fn build_with(f: impl FnOnce(&mut NetworkBuilder, NodeId, NodeId)) -> Result<(), NetworkError> {
        let mut b = NetworkBuilder::new();
        let a = b.node(0.0, 0.0);
        let c = b.node(100.0, 0.0);
        f(&mut b, a, c);
        b.build().map(|_| ())
    }

    // Given/When a link to an unknown node, Then UnknownNode
    assert_eq!(
        build_with(|b, a, _| {
            b.link(a, NodeId(99), 10.0, 1);
        }),
        Err(NetworkError::UnknownNode(NodeId(99)))
    );
    // Self-loop
    assert_eq!(
        build_with(|b, a, _| {
            b.link_with_length(a, a, 50.0, 10.0, 1);
        }),
        Err(NetworkError::SelfLoop(NodeId(0)))
    );
    // Shorter than MIN_LINK_LENGTH (10 m)
    assert!(matches!(
        build_with(|b, a, c| {
            b.link_with_length(a, c, 9.9, 10.0, 1);
        }),
        Err(NetworkError::TooShort { .. })
    ));
    // Zero speed
    assert!(matches!(
        build_with(|b, a, c| {
            b.link(a, c, 0.0, 1);
        }),
        Err(NetworkError::InvalidSpeed { .. })
    ));
    // Negative speed and NaN length
    assert!(matches!(
        build_with(|b, a, c| {
            b.link(a, c, -5.0, 1);
        }),
        Err(NetworkError::InvalidSpeed { .. })
    ));
    assert!(matches!(
        build_with(|b, a, c| {
            b.link_with_length(a, c, f64::NAN, 10.0, 1);
        }),
        Err(NetworkError::TooShort { .. })
    ));
    // Zero lanes and too many lanes
    assert!(matches!(
        build_with(|b, a, c| {
            b.link(a, c, 10.0, 0);
        }),
        Err(NetworkError::InvalidLanes { lanes: 0, .. })
    ));
    assert!(matches!(
        build_with(|b, a, c| {
            b.link(a, c, 10.0, 9);
        }),
        Err(NetworkError::InvalidLanes { lanes: 9, .. })
    ));
    // A valid one still builds
    assert_eq!(
        build_with(|b, a, c| {
            b.link(a, c, 10.0, 8);
        }),
        Ok(())
    );
}

// ─── 3 ────────────────────────────────────────────────────────────────────
#[test]
fn spawn_rejects_invalid_routes() {
    // Given a network a→c and a→d
    let mut b = NetworkBuilder::new();
    let a = b.node(0.0, 0.0);
    let c = b.node(100.0, 0.0);
    let d = b.node(0.0, 100.0);
    let l_ac = b.link(a, c, 10.0, 1);
    let l_ad = b.link(a, d, 10.0, 1);
    let mut w = World::new(b.build().unwrap());

    // When spawning invalid routes, Then each is rejected
    use sim_core::SpawnError::*;
    assert_eq!(w.spawn_with_route(vec![]), Err(EmptyRoute));
    assert_eq!(w.spawn_with_route(vec![LinkId(42)]), Err(UnknownLink(LinkId(42))));
    assert_eq!(w.spawn_with_route(vec![l_ac, l_ad]), Err(NonContiguousRoute { at: 1 }));

    // And nothing is counted as spawned
    assert_eq!(w.counts().spawned, 0);
    assert_eq!(w.origin_buffer_len(a), 0);

    // And a valid route is accepted into the origin buffer
    let id = w.spawn_with_route(vec![l_ac]).unwrap();
    assert_eq!(id, VehicleId(0));
    assert_eq!(w.counts().spawned, 1);
    assert_eq!(w.counts().waiting_at_origin, 1);
    assert_eq!(w.origin_buffer_len(a), 1);
}

// ─── 4 ────────────────────────────────────────────────────────────────────
#[test]
fn free_flow_vehicle_travel_time_matches_kinematics() {
    // Given a lone vehicle on a 1000 m, 10 m/s link
    let mut b = NetworkBuilder::new();
    let a = b.node(0.0, 0.0);
    let c = b.node(1000.0, 0.0);
    let l = b.link(a, c, 10.0, 1);
    let mut w = World::new(b.build().unwrap());
    w.spawn_with_route(vec![l]).unwrap();

    // When the sim runs until it completes
    let mut prev_s: Option<f64> = None;
    for _ in 0..1000 {
        step_checked(&mut w);
        if let Some(v) = w.link_vehicles(l).first() {
            // Then speed never exceeds the limit and displacement per tick ≤ vmax·DT
            assert!(v.v <= 10.0 + EPS, "speed {} above limit", v.v);
            if let Some(p) = prev_s {
                assert!(v.s - p <= 10.0 * DT + EPS, "teleport: {} → {}", p, v.s);
                assert!(v.s + EPS >= p, "moved backwards");
            }
            prev_s = Some(v.s);
        }
        if w.counts().completed == 1 {
            break;
        }
    }
    assert_eq!(w.counts().completed, 1);

    // And travel time matches kinematics: admission tick, then 10 ticks of
    // acceleration (1 m/s per tick, 27.5 m), then cruise at 5 m/tick.
    let expected_ticks = 1.0 + 10.0 + (1000.0 - 27.5) / (10.0 * DT);
    let trip = w.completed_log()[0];
    let travel = (trip.completed_tick - trip.created_tick) as f64;
    assert!(
        (travel - expected_ticks).abs() <= 2.0,
        "travel {travel} ticks, expected ≈ {expected_ticks}"
    );
}

// ─── 5 ────────────────────────────────────────────────────────────────────
#[test]
fn vehicles_never_overlap_or_reorder() {
    // Given a 3-lane → 1-lane → 3-lane chain under heavy load
    let (mut w, links, _) = bottleneck_chain(3, 300.0);
    let mut last_pos: BTreeMap<(VehicleId, u64), (LinkId, f64)> = BTreeMap::new();

    for t in 0..1500 {
        if t < 300 {
            w.spawn_with_route(links.to_vec()).unwrap();
            w.spawn_with_route(links.to_vec()).unwrap();
        }
        // When the sim steps
        step_checked(&mut w);

        // Then within each lane vehicles are front-first with ≥ JAM_SPACING gaps
        for &l in &links {
            let len = w.network().link(l).length_m;
            let vs = w.link_vehicles(l);
            for pair in vs.windows(2) {
                if pair[0].lane == pair[1].lane {
                    let gap = pair[0].s - pair[1].s;
                    assert!(gap >= JAM_SPACING - 1e-3, "overlap on {l:?} lane {}: gap {gap}", pair[0].lane);
                }
            }
            for v in &vs {
                assert!(v.s >= -EPS && v.s <= len + EPS, "s {} outside [0,{len}]", v.s);
                // And s never decreases while a vehicle stays on a link
                let key = (v.id, v.trip_id);
                if let Some((pl, ps)) = last_pos.get(&key) {
                    if *pl == l {
                        assert!(v.s + EPS >= *ps, "vehicle moved backwards on {l:?}");
                    }
                }
                last_pos.insert(key, (l, v.s));
            }
            // lanes are reported ascending
            assert!(vs.windows(2).all(|p| p[0].lane <= p[1].lane));
        }
    }
}

// ─── 6 ────────────────────────────────────────────────────────────────────
#[test]
fn storage_capacity_never_exceeded() {
    // Given saturating demand into a 1-lane bottleneck
    let (mut w, links, _) = bottleneck_chain(3, 150.0);
    let mut bottleneck_reached_capacity = false;
    for t in 0..2400 {
        if t % 2 == 0 {
            w.spawn_with_route(links.to_vec()).unwrap();
        }
        step_checked(&mut w);
        // Then no link ever holds more than its capacity
        for &l in &links {
            let cap = w.network().capacity(l);
            let n = w.link_count(l);
            assert!(n <= cap, "{l:?} holds {n} > cap {cap}");
            assert_eq!(n as usize, w.link_vehicles(l).len());
        }
        if w.link_count(links[1]) == w.network().capacity(links[1]) {
            bottleneck_reached_capacity = true;
        }
    }
    // And the scenario actually saturated the bottleneck
    assert!(bottleneck_reached_capacity);
}

// ─── 7 ────────────────────────────────────────────────────────────────────
#[test]
fn discharge_rate_bounded_by_saturation_flow() {
    for lanes in [1u8, 2u8] {
        // Given o ─L0(500 m, 4 lanes)─▶ a ─L1(300 m, `lanes`)─▶ b ─L2(1000 m, 3 lanes)─▶ c
        // fed faster than L1 can discharge, so L1 holds a standing queue
        let mut b = NetworkBuilder::new();
        let o = b.node(0.0, 0.0);
        let a = b.node(500.0, 0.0);
        let bb = b.node(800.0, 0.0);
        let c = b.node(1800.0, 0.0);
        let l0 = b.link(o, a, 13.9, 4);
        let l1 = b.link(a, bb, 13.9, lanes);
        let l2 = b.link(bb, c, 13.9, 3);
        let mut w = World::new(b.build().unwrap());
        for _ in 0..1500 {
            w.spawn_with_route(vec![l0, l1, l2]).unwrap();
        }

        // When we measure exits from L1 over T = 300 s after a 300 s warm-up
        for _ in 0..600 {
            step_checked(&mut w);
        }
        let start = w.link_exit_count(l1);
        let window_ticks = 600;
        for _ in 0..window_ticks {
            step_checked(&mut w);
        }
        let passed = (w.link_exit_count(l1) - start) as f64;

        // Then the flow is bounded by lanes × 0.5 veh/s and reaches ≥ 90 % of it
        let t_s = window_ticks as f64 * DT;
        let max = lanes as f64 * SAT_FLOW_PER_LANE * t_s;
        assert!(passed <= max + lanes as f64, "lanes={lanes}: {passed} > {max}");
        assert!(passed >= 0.9 * max, "lanes={lanes}: {passed} < 90% of {max}");
        // And L1 was still queued at the end (the window was saturated)
        assert!(w.origin_buffer_len(o) > 0);
    }
}

// ─── 8 ────────────────────────────────────────────────────────────────────
#[test]
fn queue_spills_back_through_two_links() {
    // Given 3-lane L1 → 1-lane 150 m bottleneck L2 → free L3, demand 0.67 veh/s
    // (above L2's 0.5 veh/s, below the origin's injection rate)
    let (mut w, [l1, l2, l3], o) = bottleneck_chain(3, 150.0);
    let full = |w: &World, l: LinkId| w.link_count(l) as f64 >= 0.95 * w.network().capacity(l) as f64;

    let (mut t_l2_full, mut t_l1_full, mut t_origin) = (None, None, None);
    let mut l1_front_stopped_when_full = false;
    let (mut ticks_after_l2_full, mut l2_full_ticks) = (0u32, 0u32);
    for t in 0..6000u64 {
        if t % 3 == 0 {
            w.spawn_with_route(vec![l1, l2, l3]).unwrap();
        }
        // When the sim runs
        step_checked(&mut w);
        if t_l2_full.is_none() && full(&w, l2) {
            t_l2_full = Some(t);
        }
        if t_l2_full.is_some() {
            ticks_after_l2_full += 1;
            if w.link_count(l2) as f64 >= 0.9 * w.network().capacity(l2) as f64 {
                l2_full_ticks += 1;
            }
        }
        if t_l1_full.is_none() && full(&w, l1) {
            t_l1_full = Some(t);
            let len = w.network().link(l1).length_m;
            l1_front_stopped_when_full = w
                .link_vehicles(l1)
                .iter()
                .any(|v| v.s >= len - 1e-3 && v.v < 0.1);
        }
        if t_origin.is_none() && w.origin_buffer_len(o) >= 5 {
            t_origin = Some(t);
        }
    }

    // Then the bottleneck fills first, then the upstream link, then the origin buffer grows
    let (a, b, c) = (
        t_l2_full.expect("bottleneck never filled"),
        t_l1_full.expect("upstream link never filled"),
        t_origin.expect("origin buffer never grew"),
    );
    assert!(a < b && b <= c, "spillback order wrong: L2 {a}, L1 {b}, origin {c}");
    // And the upstream front was stopped at its stop line (blocked, not free-flowing)
    assert!(l1_front_stopped_when_full);
    // And the bottleneck stayed full (it is the binding constraint, not a start-up transient)
    let frac = l2_full_ticks as f64 / ticks_after_l2_full as f64;
    assert!(frac >= 0.9, "bottleneck only ≥90% full in {:.0}% of ticks", frac * 100.0);
}

// ─── 9 ────────────────────────────────────────────────────────────────────
#[test]
fn blocked_front_vehicle_holds_followers() {
    // Given the bottleneck chain under heavy demand
    let (mut w, [l1, l2, l3], _) = bottleneck_chain(3, 100.0);
    let cap_l2 = w.network().capacity(l2);
    let len_l1 = w.network().link(l1).length_m;
    let mut blocked_ticks = 0;
    let mut saw_waiting_front = false;

    for t in 0..3000u64 {
        if t % 2 == 0 {
            w.spawn_with_route(vec![l1, l2, l3]).unwrap();
        }
        let l2_full_before = w.link_count(l2) == cap_l2;
        let exits_before = w.link_exit_count(l1);

        // When a tick runs while L2 (downstream of node a) is full
        step_checked(&mut w);

        // Then nothing crosses from L1 into L2 during that tick
        if l2_full_before {
            blocked_ticks += 1;
            assert_eq!(w.link_exit_count(l1), exits_before, "vehicle passed a blocked intersection at tick {t}");
        }
        // And an L1 lane front waits at the stop line, stopped
        if w.link_vehicles(l1).iter().any(|v| (v.s - len_l1).abs() < 1e-6 && v.v == 0.0) {
            saw_waiting_front = true;
        }
    }
    assert!(blocked_ticks > 50, "scenario never blocked L2 ({blocked_ticks} ticks)");
    assert!(saw_waiting_front);
}

// ─── 10 ───────────────────────────────────────────────────────────────────
#[test]
fn conservation_holds_every_tick() {
    // Given a network with a merge and a diverge and three route patterns
    let mut b = NetworkBuilder::new();
    let o1 = b.node(0.0, 0.0);
    let o2 = b.node(0.0, 200.0);
    let a = b.node(200.0, 0.0);
    let bn = b.node(400.0, 100.0);
    let cn = b.node(400.0, -100.0);
    let d = b.node(600.0, 0.0);
    let o1a = b.link(o1, a, 13.9, 2);
    let o2a = b.link(o2, a, 13.9, 1);
    let ab = b.link(a, bn, 13.9, 1);
    let ac = b.link(a, cn, 13.9, 1);
    let bd = b.link(bn, d, 13.9, 1);
    let cd = b.link(cn, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());

    let mut clone_check: Option<World> = None;
    for t in 0..8000u64 {
        if t == 1000 {
            clone_check = Some(w.clone());
        }
        if t < 1500 {
            if t % 3 == 0 {
                w.spawn_with_route(vec![o1a, ab, bd]).unwrap();
            }
            if t % 5 == 0 {
                w.spawn_with_route(vec![o1a, ac, cd]).unwrap();
            }
            if t % 7 == 0 {
                w.spawn_with_route(vec![o2a, ab, bd]).unwrap();
            }
        }
        // When the sim steps
        step_checked(&mut w);

        // Then every spawned vehicle is accounted for
        let c = w.counts();
        assert_eq!(c.spawned, c.active + c.completed + c.removed, "tick {t}: {c:?}");
        assert_eq!(c.active, c.on_network + c.waiting_at_origin, "tick {t}: {c:?}");
        let on_links: u64 = w.network().links().iter().map(|l| w.link_count(l.id) as u64).sum();
        assert_eq!(c.on_network, on_links);
    }
    // And eventually everyone arrives, each exactly once in the completion log
    let c = w.counts();
    assert!(c.spawned > 0);
    assert_eq!(c.completed, c.spawned);
    assert_eq!(c.active, 0);
    let mut ids: Vec<u64> = w.completed_log().iter().map(|c| c.trip_id).collect();
    assert_eq!(ids.len() as u64, c.completed);
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len() as u64, c.completed, "a trip completed twice");
    assert_eq!(ids, (0..c.spawned).collect::<Vec<_>>());

    // And a clone taken mid-run continues identically under the same inputs
    let mut copy = clone_check.unwrap();
    for t in 1000..8000u64 {
        if t < 1500 {
            if t % 3 == 0 {
                copy.spawn_with_route(vec![o1a, ab, bd]).unwrap();
            }
            if t % 5 == 0 {
                copy.spawn_with_route(vec![o1a, ac, cd]).unwrap();
            }
            if t % 7 == 0 {
                copy.spawn_with_route(vec![o2a, ab, bd]).unwrap();
            }
        }
        copy.step();
    }
    assert_eq!(copy.completed_log(), w.completed_log());
    assert_eq!(copy.counts(), w.counts());
}

// ─── 11 ───────────────────────────────────────────────────────────────────
#[test]
fn completion_logs_travel_time() {
    // Given a two-link route and vehicles spawned at ticks 0, 10 and 20
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(200.0, 0.0);
    let d = b.node(400.0, 0.0);
    let l1 = b.link(o, a, 13.9, 1);
    let l2 = b.link(a, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());

    for t in 0..400u64 {
        if t % 10 == 0 && t <= 20 {
            w.spawn_with_route(vec![l1, l2]).unwrap();
        }
        step_checked(&mut w);
    }

    // Then all three completed and are logged with their creation ticks
    let log = w.completed_log();
    assert_eq!(log.len(), 3);
    let mut by_trip = log.to_vec();
    by_trip.sort_by_key(|c| c.trip_id);
    assert_eq!(by_trip.iter().map(|c| c.trip_id).collect::<Vec<_>>(), vec![0, 1, 2]);
    assert_eq!(by_trip.iter().map(|c| c.created_tick).collect::<Vec<_>>(), vec![0, 10, 20]);
    // And travel time is at least the free-flow time (400 m at 13.9 m/s ≈ 58 ticks)
    for c in &by_trip {
        let travel_s = (c.completed_tick - c.created_tick) as f64 * DT;
        assert!(travel_s >= 400.0 / 13.9, "{c:?} faster than free flow");
        // free-flow time + acceleration loss v/(2a) + 2 s discretization slack
        let upper = 400.0 / 13.9 + 13.9 / (2.0 * 2.0) + 2.0;
        assert!(travel_s <= upper, "{c:?} slower than {upper:.1} s on an empty road");
    }
    // And they left the network
    assert_eq!(w.counts().on_network, 0);
    assert!(w.link_vehicles(l1).is_empty() && w.link_vehicles(l2).is_empty());
    assert_eq!(w.link_exit_count(l2), 3);
}

// ─── 12 ───────────────────────────────────────────────────────────────────
#[test]
fn merge_shares_capacity_round_robin() {
    // Given two saturated 1-lane feeders merging into a congested 1-lane link
    let mut b = NetworkBuilder::new();
    let o1 = b.node(0.0, 0.0);
    let m = b.node(300.0, 0.0);
    let o2 = b.node(300.0, 300.0);
    let x = b.node(400.0, 0.0);
    let y = b.node(1400.0, 0.0);
    let l1 = b.link(o1, m, 13.9, 1);
    let l2 = b.link(o2, m, 13.9, 1);
    let l3 = b.link(m, x, 13.9, 1);
    let l4 = b.link(x, y, 13.9, 1);
    let mut w = World::new(b.build().unwrap());

    let mut window_start = (0, 0);
    for t in 0..1800u64 {
        if t % 2 == 0 {
            w.spawn_with_route(vec![l1, l3, l4]).unwrap();
            w.spawn_with_route(vec![l2, l3, l4]).unwrap();
        }
        if t == 600 {
            window_start = (w.link_exit_count(l1), w.link_exit_count(l2));
        }
        step_checked(&mut w);
    }

    // When we compare their throughput over 10 minutes
    let f1 = (w.link_exit_count(l1) - window_start.0) as f64;
    let f2 = (w.link_exit_count(l2) - window_start.1) as f64;
    let total = f1 + f2;

    // Then the merge was saturated (≈ 0.5 veh/s × 600 s) and shared fairly
    assert!(total >= 250.0, "merge not saturated: {total}");
    let share = f1 / total;
    assert!((0.4..=0.6).contains(&share), "unfair merge: share {share:.2} ({f1} vs {f2})");
}

// ─── 13 ───────────────────────────────────────────────────────────────────
#[test]
fn lane_credit_limits_moving_platoon() {
    // Given free-flowing 3-lane traffic feeding a long 1-lane link L2, so
    // vehicles reach L2's stop line *moving* and denser than 0.5 veh/s
    // (start-up kinematics alone would not bind; only the credit can)
    let (mut w, [l1, l2, l3], _) = bottleneck_chain(3, 500.0);
    let mut exits_from_first: Vec<u64> = Vec::new();
    for t in 0..1200u64 {
        if t < 600 {
            w.spawn_with_route(vec![l1, l2, l3]).unwrap();
        }
        step_checked(&mut w);
        let e = w.link_exit_count(l2);
        if !exits_from_first.is_empty() || e > 0 {
            exits_from_first.push(e);
        }
    }
    // When we look at L2's exits from its first exit onwards
    assert!(exits_from_first.len() > 400, "L2 never discharged");
    let base = exits_from_first[0] - 1; // exits before the first-exit tick
    for (n, e) in exits_from_first.iter().enumerate() {
        // Then at most the banked credit (1) plus 0.25 per tick ever crosses
        let crossed = (e - base) as f64;
        assert!(crossed <= 1.0 + 0.25 * n as f64 + 1e-9, "tick +{n}: {crossed} crossings exceed credit");
    }
    // And demand really exceeded the credit: L2 (cap 66) built a queue
    assert!(w.link_count(l2) >= 10, "no queue formed on L2: {}", w.link_count(l2));
}

// ─── 14 ───────────────────────────────────────────────────────────────────
#[test]
fn lane_choice_prefers_most_room_and_vehicles_keep_lane() {
    // Given four vehicles waiting to enter an empty 2-lane link
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(500.0, 0.0);
    let d = b.node(1000.0, 0.0);
    let l1 = b.link(o, a, 13.9, 2);
    let l2 = b.link(a, d, 13.9, 2);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..4 {
        w.spawn_with_route(vec![l1, l2]).unwrap();
    }
    // When they are admitted and drive
    let mut lane_of: BTreeMap<(u64, LinkId), u8> = BTreeMap::new();
    for _ in 0..200 {
        step_checked(&mut w);
        for l in [l1, l2] {
            for v in w.link_vehicles(l) {
                // Then a vehicle never changes lane while on a link
                if let Some(prev) = lane_of.insert((v.trip_id, l), v.lane) {
                    assert_eq!(prev, v.lane, "trip {} changed lane on {l:?}", v.trip_id);
                }
            }
        }
    }
    // And entry alternates: empty lanes tie → lane 0, then the empty lane 1,
    // then the lane whose tail is furthest ahead (tie → lowest)
    let lanes: Vec<u8> = (0..4).map(|trip| lane_of[&(trip, l1)]).collect();
    assert_eq!(lanes, vec![0, 1, 0, 1]);
}

// ─── 15 ───────────────────────────────────────────────────────────────────
#[test]
fn origin_admission_is_rate_limited_fifo_and_starts_at_rest() {
    // Given an origin with a 4-lane link and ten waiting vehicles
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(500.0, 0.0);
    let wide = b.link(o, a, 13.9, 4);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..10 {
        w.spawn_with_route(vec![wide]).unwrap(); // trips 0..9
    }

    // When one tick runs, Then at most 2 are admitted, in FIFO order, at rest at s = 0
    step_checked(&mut w);
    let on = w.link_vehicles(wide);
    assert_eq!(on.len(), 2);
    let mut trips: Vec<u64> = on.iter().map(|v| v.trip_id).collect();
    trips.sort_unstable();
    assert_eq!(trips, vec![0, 1]);
    assert!(on.iter().all(|v| v.s == 0.0 && v.v == 0.0));
    assert_eq!(w.origin_buffer_len(o), 8);

    // And never more than 2 per tick afterwards, always the oldest waiting trips
    let mut prev = 2u64;
    for _ in 0..60 {
        step_checked(&mut w);
        let admitted = 10 - w.origin_buffer_len(o) as u64;
        assert!(admitted - prev <= 2);
        prev = admitted;
        let mut seen: Vec<u64> = w.link_vehicles(wide).iter().map(|v| v.trip_id).collect();
        seen.extend(w.completed_log().iter().map(|c| c.trip_id));
        seen.sort_unstable();
        assert_eq!(seen, (0..admitted).collect::<Vec<_>>(), "admission not FIFO");
    }

    // Given a blocked first link: X and Y want `short` (lane capacity 1), Z wants `wide`
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(500.0, 0.0);
    let s = b.node(0.0, 10.0);
    let wide = b.link(o, a, 13.9, 4);
    let short = b.link(o, s, 13.9, 1);
    let mut w2 = World::new(b.build().unwrap());
    w2.spawn_with_route(vec![short]).unwrap(); // X, trip 0
    w2.spawn_with_route(vec![short]).unwrap(); // Y, trip 1
    w2.spawn_with_route(vec![wide]).unwrap(); // Z, trip 2
    step_checked(&mut w2);
    // Then X enters, Y waits (blocked behind X), and Z is not blocked by Y
    assert_eq!(w2.link_vehicles(short).iter().map(|v| v.trip_id).collect::<Vec<_>>(), vec![0]);
    assert_eq!(w2.link_vehicles(wide).iter().map(|v| v.trip_id).collect::<Vec<_>>(), vec![2]);
    assert_eq!(w2.origin_buffer_len(o), 1);
}

// ─── 16 ───────────────────────────────────────────────────────────────────
#[test]
fn sink_completion_does_not_consume_credit() {
    // Given free-flowing 3-lane traffic into a 1-lane *final* link
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(500.0, 0.0);
    let d = b.node(1000.0, 0.0);
    let l1 = b.link(o, a, 13.9, 3);
    let l2 = b.link(a, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());
    let mut start = 0;
    for t in 0..1000u64 {
        if t < 800 {
            w.spawn_with_route(vec![l1, l2]).unwrap();
        }
        if t == 300 {
            start = w.counts().completed;
        }
        step_checked(&mut w);
    }
    // When we count completions at the end of L2 over ticks 300..1000 (350 s)
    let done = (w.counts().completed - start) as f64;
    // Then they exceed what a credit-limited (0.5 veh/s) exit would allow
    let credit_limited = SAT_FLOW_PER_LANE * 700.0 * DT;
    assert!(done > 1.3 * credit_limited, "completions {done} look credit-limited (≤ {credit_limited})");
}
