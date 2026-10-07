//! Ward city-001: per-link saturation flow and gridlock relief.
//! Contract: `.wdd/epics/city.md` § C1, § C2 (the core contract `.wdd/epics/core.md` stays in force).
#![allow(clippy::needless_range_loop, clippy::manual_is_multiple_of, clippy::type_complexity)]

use std::collections::{BTreeMap, BTreeSet};

use sim_core::cities::three_bridges;
use sim_core::frame::{metrics_to_array, metrics_to_extended_array, EXTENDED_METRIC_NAMES, METRIC_NAMES};
use sim_core::params::{
    COST_EPOCH_TICKS, GRIDLOCK_REMOVE_TICKS, GRIDLOCK_REROUTE_TICKS, MAX_SAT_FLOW_PER_LANE, QUEUED_SPEED, REROUTE_PERIOD_TICKS,
    SAT_FLOW_PER_LANE,
};
use sim_core::{
    Command, CommandKind, DemandModel, LinkId, NetworkBuilder, NetworkError, OdFlow, Profile, Scenario, VehicleId,
    VehicleInfo, VehicleState, World,
};

/// Step once and check the invariants plus the C2 conservation and metric identities.
fn step_checked(w: &mut World) {
    w.step();
    if let Err(e) = w.check_invariants() {
        panic!("invariant violated at tick {}: {e}", w.tick());
    }
    let c = w.counts();
    let m = w.metrics();
    let t = w.tick();
    assert_eq!(c.spawned, c.active + c.completed + m.removed_unreachable + m.removed_gridlock, "conservation at {t}");
    assert_eq!(c.removed, m.removed_unreachable + m.removed_gridlock, "removed split at {t}");
    assert_eq!(m.unreachable, m.no_route + m.stranded + m.removed_unreachable, "unreachable at {t}");
    assert_eq!(m.unserved, m.unreachable + m.removed_gridlock, "unserved at {t}");
}

fn close(l: LinkId, tick: u64) -> Command {
    Command { tick, kind: CommandKind::CloseLink(l) }
}

fn open(l: LinkId, tick: u64) -> Command {
    Command { tick, kind: CommandKind::OpenLink(l) }
}

fn infos(w: &World) -> Vec<VehicleInfo> {
    w.vehicle_ids().into_iter().map(|id| w.vehicle(id).unwrap()).collect()
}

fn on_final_link(i: &VehicleInfo) -> bool {
    matches!(i.state, VehicleState::OnLink(_)) && i.route_pos + 1 == i.route.len()
}

// ─── constructions ────────────────────────────────────────────────────────

/// Ring: junctions n0..n3 on a 75 m square, one-lane ring links n_i → n_{i+1}
/// (lane capacity 10), a zone feeding each junction, and an exit from each
/// junction to a dead-end sink. 40 vehicles per zone circle once and leave
/// at their own junction. Probed on the core implementation: it deadlocks at
/// tick 346 with all four ring links full and nothing moves afterwards.
struct Ring {
    w: World,
    ring: Vec<LinkId>,
}

fn ring() -> Ring {
    let mut b = NetworkBuilder::new();
    let side = 75.0;
    let n = [b.node(0.0, 0.0), b.node(side, 0.0), b.node(side, side), b.node(0.0, side)];
    let ring: Vec<LinkId> = (0..4).map(|i| b.link(n[i], n[(i + 1) % 4], 10.0, 1)).collect();
    let zpos = [(-150.0, 0.0), (side + 150.0, 0.0), (side + 150.0, side), (-150.0, side)];
    let conn: Vec<LinkId> = (0..4)
        .map(|i| {
            let z = b.zone(zpos[i].0, zpos[i].1);
            b.link(z, n[i], 10.0, 1)
        })
        .collect();
    let spos = [(0.0, -150.0), (side, -150.0), (side, side + 150.0), (0.0, side + 150.0)];
    let exit: Vec<LinkId> = (0..4)
        .map(|i| {
            let s = b.node(spos[i].0, spos[i].1);
            b.link(n[i], s, 10.0, 1)
        })
        .collect();
    let mut w = World::new(b.build().unwrap());
    for _ in 0..40 {
        for i in 0..4 {
            let mut r = vec![conn[i]];
            r.extend((0..4).map(|j| ring[(i + j) % 4]));
            r.push(exit[i]);
            w.spawn_with_route(r).unwrap();
        }
    }
    Ring { w, ring }
}

#[derive(Clone, Copy, PartialEq)]
enum Q {
    /// No alternative at A.
    None,
    /// Alternative A→E→B, free.
    Free,
    /// Alternative A→E→B, its first link held by stranded blocker b2.
    Blocked,
}

/// Fork: zone Z ─L1(200 m)─▶ A ─P(10 m, lane cap 1)─▶ B ─R(200 m)─▶ D, with
/// optionally Q1 = A→E (10 m) and Q2 = E→B (10 m). CX = B→X and CY = E→Y are
/// closed at tick 0. Blocker b1 (L1,P,CX) strands on P, b2 (L1,Q1,CY) on Q1;
/// probe vehicle v (L1,P,R) then reaches A's stop line with P full.
/// Probed on the core implementation: v stops at A's stop line at tick ≈ 51–56,
/// and the stranded blockers are removed (unreachable) at ticks ≈ 648–653.
struct Fork {
    w: World,
    l1: LinkId,
    p: LinkId,
    q1: Option<LinkId>,
    q2: Option<LinkId>,
    r: LinkId,
    b1: VehicleId,
    b2: Option<VehicleId>,
    v: VehicleId,
    #[allow(dead_code)] // the extra vehicles queue behind v; tests read them through the world
    extra: Vec<VehicleId>,
}

fn fork(q: Q, extra: usize, l1_sat: Option<f64>) -> Fork {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-200.0, 0.0);
    let a = b.node(0.0, 0.0);
    let bb = b.node(10.0, 0.0);
    let d = b.node(210.0, 0.0);
    let x = b.node(10.0, -200.0);
    let l1 = b.link(z, a, 10.0, 1);
    let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
    let r = b.link(bb, d, 10.0, 1);
    let cx = b.link(bb, x, 10.0, 1);
    let (q1, q2, cy) = if q == Q::None {
        (None, None, None)
    } else {
        let e = b.node(5.0, 9.0);
        let y = b.node(5.0, 209.0);
        let q1 = b.link_with_length(a, e, 10.0, 10.0, 1);
        let q2 = b.link_with_length(e, bb, 10.0, 10.0, 1);
        let cy = b.link(e, y, 10.0, 1);
        (Some(q1), Some(q2), Some(cy))
    };
    if let Some(s) = l1_sat {
        b.set_sat_flow(l1, s);
    }
    let mut w = World::new(b.build().unwrap());
    w.schedule(close(cx, 0)).unwrap();
    if let Some(cy) = cy {
        w.schedule(close(cy, 0)).unwrap();
    }
    step_checked(&mut w); // closures applied before anyone exists: nobody is rerouted
    let b1 = w.spawn_with_route(vec![l1, p, cx]).unwrap();
    let b2 = (q == Q::Blocked).then(|| w.spawn_with_route(vec![l1, q1.unwrap(), cy.unwrap()]).unwrap());
    let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
    let extra = (0..extra).map(|_| w.spawn_with_route(vec![l1, p, r]).unwrap()).collect();
    Fork { w, l1, p, q1, q2, r, b1, b2, v, extra }
}

// ─── 1 ────────────────────────────────────────────────────────────────────
#[test]
fn default_sat_flow_is_core_value() {
    // Given the same heavily loaded bottleneck chain, built once with defaults and
    // once with every link explicitly set to the core value
    let build = |explicit: bool| {
        let mut b = NetworkBuilder::new();
        let o = b.node(0.0, 0.0);
        let a = b.node(500.0, 0.0);
        let c = b.node(800.0, 0.0);
        let d = b.node(1800.0, 0.0);
        let links = [b.link(o, a, 13.9, 4), b.link(a, c, 13.9, 1), b.link(c, d, 13.9, 3)];
        if explicit {
            for &l in &links {
                b.set_sat_flow(l, SAT_FLOW_PER_LANE);
            }
        }
        let net = b.build().unwrap();
        if !explicit {
            for &l in &links {
                assert_eq!(net.link(l).sat_flow_per_lane, SAT_FLOW_PER_LANE, "default sat flow");
            }
        }
        let mut w = World::new(net);
        for _ in 0..1500 {
            w.spawn_with_route(links.to_vec()).unwrap();
        }
        w
    };
    let mut a = build(false);
    let mut b = build(true);
    // When both run for 30 min
    for _ in 0..3600 {
        step_checked(&mut a);
        step_checked(&mut b);
        // Then they are bit-identical every tick
        assert_eq!(a.state_hash(), b.state_hash(), "tick {}", a.tick());
    }
    assert!(a.counts().completed > 100);
}

// ─── 2 ────────────────────────────────────────────────────────────────────
#[test]
fn set_sat_flow_last_call_wins() {
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(100.0, 0.0);
    let c = b.node(200.0, 0.0);
    let l0 = b.link(o, a, 10.0, 1);
    let l1 = b.link(a, c, 10.0, 2);
    b.set_sat_flow(l1, 0.3);
    b.set_sat_flow(l1, 0.2);
    let net = b.build().unwrap();
    assert_eq!(net.link(l1).sat_flow_per_lane, 0.2);
    assert_eq!(net.link(l0).sat_flow_per_lane, SAT_FLOW_PER_LANE);
}

// ─── 3 ────────────────────────────────────────────────────────────────────
#[test]
fn invalid_sat_flow_rejected() {
    fn one(value: f64) -> Result<(), NetworkError> {
        let mut b = NetworkBuilder::new();
        let o = b.node(0.0, 0.0);
        let a = b.node(100.0, 0.0);
        let l = b.link(o, a, 10.0, 1);
        b.set_sat_flow(l, value);
        b.build().map(|_| ())
    }
    let (o, a) = (sim_core::NodeId(0), sim_core::NodeId(1));
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -0.1, MAX_SAT_FLOW_PER_LANE + 1e-9] {
        assert_eq!(one(bad), Err(NetworkError::InvalidSatFlow { from: o, to: a }), "value {bad}");
    }
    assert_eq!(MAX_SAT_FLOW_PER_LANE, 2.0);
    for good in [2.0, 1e-6, 0.25, 0.5] {
        assert_eq!(one(good), Ok(()), "value {good}");
    }

    // Same link: InvalidLanes is reported before InvalidSatFlow
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(100.0, 0.0);
    let l = b.link(o, a, 10.0, 0);
    b.set_sat_flow(l, f64::NAN);
    assert_eq!(b.build().map(|_| ()), Err(NetworkError::InvalidLanes { from: o, to: a, lanes: 0 }));

    // An earlier link's error comes before a later link's sat-flow error
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(5.0, 0.0);
    let c = b.node(200.0, 0.0);
    b.link(o, a, 10.0, 1); // 5 m: TooShort
    let l1 = b.link(a, c, 10.0, 1);
    b.set_sat_flow(l1, -1.0);
    assert!(matches!(b.build(), Err(NetworkError::TooShort { .. })));

    // And an earlier link's sat-flow error comes before a later link's TooShort
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(200.0, 0.0);
    let c = b.node(205.0, 0.0);
    let l0 = b.link(o, a, 10.0, 1);
    b.link(a, c, 10.0, 1); // 5 m: TooShort
    b.set_sat_flow(l0, 0.0);
    assert_eq!(b.build().map(|_| ()), Err(NetworkError::InvalidSatFlow { from: o, to: a }));
}

// ─── 4 ────────────────────────────────────────────────────────────────────
#[test]
fn unknown_link_override_rejected() {
    let base = || {
        let mut b = NetworkBuilder::new();
        let o = b.node(0.0, 0.0);
        let a = b.node(100.0, 0.0);
        let c = b.node(200.0, 0.0);
        b.link(o, a, 10.0, 1);
        b.link(a, c, 10.0, 1);
        (b, o, a)
    };
    // Overrides for ids 7 and 5 on a 2-link network → the lowest unknown id
    let (mut b, _, _) = base();
    b.set_sat_flow(LinkId(7), 0.3);
    b.set_sat_flow(LinkId(5), 0.3);
    assert_eq!(b.build().map(|_| ()), Err(NetworkError::UnknownLink(LinkId(5))));

    // A link error takes precedence over an unknown override
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(100.0, 0.0);
    b.link(o, a, -3.0, 1);
    b.set_sat_flow(LinkId(9), 0.3);
    assert_eq!(b.build().map(|_| ()), Err(NetworkError::InvalidSpeed { from: o, to: a }));

    // And the known part of a valid network builds
    let (mut b, _, _) = base();
    b.set_sat_flow(LinkId(1), 0.3);
    assert!(b.build().is_ok());
}

// ─── 5 ────────────────────────────────────────────────────────────────────
#[test]
fn reduced_sat_flow_discharge_headway() {
    for (sat, headway) in [(0.25, 8u64), (0.125, 16u64)] {
        // Given o ─L0(500 m, 4 lanes)─▶ a ─L1(300 m, 1 lane, sat)─▶ b ─L2(1000 m, 3 lanes)─▶ c
        // with demand far above L1's capacity
        let mut b = NetworkBuilder::new();
        let o = b.node(0.0, 0.0);
        let a = b.node(500.0, 0.0);
        let bb = b.node(800.0, 0.0);
        let c = b.node(1800.0, 0.0);
        let l0 = b.link(o, a, 13.9, 4);
        let l1 = b.link(a, bb, 13.9, 1);
        let l2 = b.link(bb, c, 13.9, 3);
        b.set_sat_flow(l1, sat);
        let mut w = World::new(b.build().unwrap());
        for _ in 0..1500 {
            w.spawn_with_route(vec![l0, l1, l2]).unwrap();
        }
        // When we record the ticks of L1's exits over 600 ticks after a 1200-tick warm-up
        for _ in 0..1200 {
            step_checked(&mut w);
        }
        let mut exit_ticks = Vec::new();
        let mut last = w.link_exit_count(l1);
        for _ in 0..600 {
            let t = w.tick();
            step_checked(&mut w);
            let e = w.link_exit_count(l1);
            assert!(e - last <= 1, "sat {sat}: two exits in one tick");
            if e > last {
                exit_ticks.push(t);
            }
            last = e;
            // (precondition: a standing queue on L1 throughout)
            assert!(w.link_count(l1) >= 5, "sat {sat}: no standing queue on L1 at tick {t}");
        }
        // Then consecutive exits are exactly `headway` ticks apart
        assert!(exit_ticks.len() >= 600 / headway as usize - 1, "sat {sat}: {} exits", exit_ticks.len());
        for pair in exit_ticks.windows(2) {
            assert_eq!(pair[1] - pair[0], headway, "sat {sat}: exits at {pair:?}");
        }
    }
}

// ─── 6 ────────────────────────────────────────────────────────────────────
#[test]
fn sat_flow_scales_costs() {
    // Given the fork without an alternative, L1 (200 m, 10 m/s, 1 lane) at sat 0.25,
    // and 4 extra vehicles queueing behind v on L1
    let mut f = fork(Q::None, 4, Some(0.25));
    let ff = 200.0 / 10.0 + 1.0 / (1.0 * 0.25);
    // Then the initial cost is the free-flow cost with lanes × sat
    assert_eq!(f.w.link_cost(f.l1), ff);
    assert_eq!(f.w.link_cost(f.p), 10.0 / 10.0 + 1.0 / (1.0 * SAT_FLOW_PER_LANE));

    // When the epoch at tick 300 updates costs (queue settled, no exits from L1 since 240)
    while f.w.tick() < 240 {
        step_checked(&mut f.w);
    }
    let exits_240 = f.w.link_exit_count(f.l1);
    while f.w.tick() < 300 {
        step_checked(&mut f.w);
    }
    assert_eq!(f.w.link_exit_count(f.l1), exits_240, "precondition: no exits from L1 in the epoch");
    let before = f.w.link_cost(f.l1);
    let q = f.w.link_vehicles(f.l1).iter().filter(|v| v.v < QUEUED_SPEED).count() as f64;
    assert_eq!(q, 5.0, "precondition: v and the 4 extras are queued on L1");
    step_checked(&mut f.w); // tick 300: epoch boundary

    // Then the new cost uses queue_term with lanes × sat
    let observed = 200.0 / 10.0 + q / (1.0 * 0.25);
    let expected = f64::max(ff, 0.5 * observed + 0.5 * before);
    assert!((f.w.link_cost(f.l1) - expected).abs() < 1e-9, "{} vs {expected}", f.w.link_cost(f.l1));
    assert!(f.w.link_cost(f.l1) > ff, "the queue raised the cost");
}

// ─── 7 ────────────────────────────────────────────────────────────────────
#[test]
fn blocked_counter_counts_downstream_full_only() {
    // Given the fork without an alternative: b1 strands on P (lane cap 1), v reaches A's stop line
    let mut f = fork(Q::None, 0, None);
    let route_v = f.w.vehicle(f.v).unwrap().route;
    let mut prev: Option<u32> = None;
    let mut b1_gone_at = None;
    let mut crossed_at = None;
    for _ in 0..800 {
        let t = f.w.tick();
        step_checked(&mut f.w);
        if b1_gone_at.is_none() && f.w.vehicle(f.b1).is_none() {
            b1_gone_at = Some(t);
            assert_eq!(f.w.metrics().removed_unreachable, 1, "b1 is removed as unreachable");
        }
        let Some(i) = f.w.vehicle(f.v) else { break };
        match i.state {
            VehicleState::OnLink(l) if l == f.l1 => {
                // Then the counter starts at 1 and rises by exactly 1 per tick (never reset:
                // no path exists at 120, 240, …)
                match prev {
                    None => assert!(i.blocked_ticks <= 1, "tick {t}: starts at 1, got {}", i.blocked_ticks),
                    Some(0) => assert!(i.blocked_ticks <= 1),
                    Some(p) => assert_eq!(i.blocked_ticks, p + 1, "tick {t}"),
                }
                assert_eq!(i.route, route_v, "no path around P: the route is kept");
                prev = Some(i.blocked_ticks);
            }
            VehicleState::OnLink(l) if l == f.p && crossed_at.is_none() => {
                crossed_at = Some(t);
                // And on the new link the counter is 0
                assert_eq!(i.blocked_ticks, 0);
            }
            _ => {}
        }
    }
    let prev = prev.unwrap();
    assert!(prev > 3 * GRIDLOCK_REROUTE_TICKS as u32, "v counted past several reroute points: {prev}");
    assert!(prev < GRIDLOCK_REMOVE_TICKS as u32);
    // And v crossed in the same tick b1 was removed (removal in step 3, crossing in step 4)
    assert!(b1_gone_at.is_some() && b1_gone_at == crossed_at, "{b1_gone_at:?} vs {crossed_at:?}");
    assert_eq!(f.w.reroute_stats().gridlock_reroutes, 0);
    assert_eq!(f.w.metrics().removed_gridlock, 0);
}

// ─── 8 ────────────────────────────────────────────────────────────────────
#[test]
fn credit_limited_front_is_not_blocked() {
    // Given o ─L1(300 m, 1 lane, sat 0.125)─▶ a ─L2(2000 m, 2 lanes)─▶ c, demand above L1's capacity
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(300.0, 0.0);
    let c = b.node(2300.0, 0.0);
    let l1 = b.link(o, a, 13.9, 1);
    let l2 = b.link(a, c, 13.9, 2);
    b.set_sat_flow(l1, 0.125);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..200 {
        w.spawn_with_route(vec![l1, l2]).unwrap();
    }
    let mut waited_for_credit = false;
    for _ in 0..1200 {
        step_checked(&mut w);
        for i in infos(&w) {
            // Then nobody is ever counted as blocked
            assert_eq!(i.blocked_ticks, 0, "tick {}: trip {}", w.tick(), i.trip_id);
            if i.state == VehicleState::OnLink(l1) && i.s >= 300.0 - 1e-9 && i.v == 0.0 {
                waited_for_credit = true;
            }
        }
    }
    assert!(waited_for_credit, "precondition: a front waited at the stop line for credit");
}

// ─── 9 ────────────────────────────────────────────────────────────────────
#[test]
fn stranded_and_final_link_fronts_are_never_blocked() {
    let check = |w: &World, saw_stranded: &mut bool, saw_final: &mut bool| {
        for i in infos(w) {
            if i.stranded {
                *saw_stranded = true;
                assert_eq!(i.blocked_ticks, 0, "stranded trip {} at {}", i.trip_id, w.tick());
            }
            if on_final_link(&i) {
                *saw_final = true;
                assert_eq!(i.blocked_ticks, 0, "final-link trip {} at {}", i.trip_id, w.tick());
            }
        }
    };
    let (mut s, mut fl) = (false, false);
    let mut f = fork(Q::Blocked, 2, None);
    for _ in 0..900 {
        step_checked(&mut f.w);
        check(&f.w, &mut s, &mut fl);
    }
    let mut r = ring();
    for _ in 0..2500 {
        step_checked(&mut r.w);
        check(&r.w, &mut s, &mut fl);
    }
    assert!(s && fl, "preconditions: stranded and final-link vehicles were observed");
}

// ─── 10 ───────────────────────────────────────────────────────────────────
#[test]
fn gridlock_reroute_after_60s_crosses_when_free() {
    // Given the fork with a free alternative Q1, Q2 and v blocked by b1 on P
    let mut f = fork(Q::Free, 0, None);
    let (q1, q2) = (f.q1.unwrap(), f.q2.unwrap());
    let mut relief_seen = false;
    for _ in 0..400 {
        let before = f.w.vehicle(f.v).unwrap();
        let stats_before = f.w.reroute_stats();
        let t = f.w.tick();
        step_checked(&mut f.w);
        let stats = f.w.reroute_stats();
        if stats.gridlock_reroutes == stats_before.gridlock_reroutes {
            continue;
        }
        // When the gridlock reroute happens
        assert_eq!(stats.gridlock_reroutes, 1, "tick {t}");
        // Then it is the step where v's count reaches 120
        assert_eq!(before.state, VehicleState::OnLink(f.l1));
        assert_eq!(before.blocked_ticks, GRIDLOCK_REROUTE_TICKS as u32 - 1, "tick {t}");
        // And v switched to the alternative from A, keeping the driven prefix, and crossed
        let after = f.w.vehicle(f.v).unwrap();
        assert_eq!(after.route, vec![f.l1, q1, q2, f.r]);
        assert_eq!(after.state, VehicleState::OnLink(q1), "crossed in the same evaluation");
        assert_eq!(after.blocked_ticks, 0);
        assert_eq!(after.route_switches, 1);
        assert_eq!(stats.switches_total, stats_before.switches_total + 1);
        relief_seen = true;
        break;
    }
    assert!(relief_seen, "v was never relieved");
    assert!(f.w.vehicle(f.b1).is_some(), "relief happened long before b1's removal");
    // And v completes over the alternative
    for _ in 0..400 {
        step_checked(&mut f.w);
    }
    assert!(f.w.vehicle(f.v).is_none());
    assert_eq!(f.w.counts().completed, 1);
}

// ─── 11 ───────────────────────────────────────────────────────────────────
#[test]
fn gridlock_reroute_without_space_keeps_counting() {
    // Given the fork with both P (b1) and Q1 (b2) held by stranded blockers
    let mut f = fork(Q::Blocked, 0, None);
    let q1 = f.q1.unwrap();
    let mut prev: Option<VehicleInfo> = None;
    let mut reroutes = 0u64;
    let mut crossed = false;
    for _ in 0..900 {
        let t = f.w.tick();
        let g0 = f.w.reroute_stats().gridlock_reroutes;
        step_checked(&mut f.w);
        let g = f.w.reroute_stats().gridlock_reroutes;
        let Some(i) = f.w.vehicle(f.v) else { break };
        if i.state == VehicleState::WaitingAtOrigin {
            continue;
        }
        if i.state != VehicleState::OnLink(f.l1) {
            // Then once the blockers are removed v crosses and its count resets
            assert!(f.w.vehicle(f.b1).is_none() || f.w.vehicle(f.b2.unwrap()).is_none(), "tick {t}");
            assert_eq!(i.blocked_ticks, 0);
            crossed = true;
            break;
        }
        if let Some(p) = &prev {
            if p.blocked_ticks > 0 {
                // Then the count is never reset while v waits, reroute or not
                assert_eq!(i.blocked_ticks, p.blocked_ticks + 1, "tick {t}");
            }
        }
        if g > g0 {
            // When a gridlock reroute finds a path (alternately via Q1 and via P)
            assert_eq!(g, g0 + 1);
            reroutes += 1;
            assert_eq!(i.blocked_ticks as u64, reroutes * GRIDLOCK_REROUTE_TICKS, "tick {t}");
            let next = i.route[i.route_pos + 1];
            let expect = if reroutes % 2 == 1 { q1 } else { f.p };
            assert_eq!(next, expect, "reroute {reroutes} at tick {t}");
            assert_eq!(&i.route[..=i.route_pos], &[f.l1][..], "driven prefix kept");
        } else if let Some(p) = &prev {
            assert_eq!(i.route, p.route, "routes change only at gridlock reroutes (tick {t})");
        }
        prev = Some(i);
    }
    assert!(reroutes >= 3, "only {reroutes} gridlock reroutes before the blockers left");
    assert!(crossed, "v never crossed");
    assert_eq!(f.w.metrics().removed_gridlock, 0);
    let _ = f.q2;
}

// ─── 12 ───────────────────────────────────────────────────────────────────
#[test]
fn gridlock_removal_after_10_minutes() {
    // Given the pure deadlock ring (no alternative anywhere)
    let mut r = ring();
    let mut first_removal = None;
    let mut removals = 0u64;
    for _ in 0..10_000 {
        let t = r.w.tick();
        let before: BTreeMap<u64, VehicleInfo> = infos(&r.w).into_iter().map(|i| (i.trip_id, i)).collect();
        let fronts: BTreeSet<u64> = r
            .ring
            .iter()
            .flat_map(|&l| {
                let vs = r.w.link_vehicles(l);
                let mut by_lane: BTreeMap<u8, (f64, u64)> = BTreeMap::new();
                for v in vs {
                    let e = by_lane.entry(v.lane).or_insert((f64::NEG_INFINITY, 0));
                    if v.s > e.0 {
                        *e = (v.s, v.trip_id);
                    }
                }
                by_lane.into_values().map(|(_, id)| id).collect::<Vec<_>>()
            })
            .collect();
        let exits_before: Vec<u64> = r.ring.iter().map(|&l| r.w.link_exit_count(l)).collect();
        let completed_before = r.w.completed_log().len();
        let gridlock_before = r.w.metrics().removed_gridlock;
        step_checked(&mut r.w);

        let after: BTreeSet<u64> = infos(&r.w).into_iter().map(|i| i.trip_id).collect();
        let completed: BTreeSet<u64> = r.w.completed_log()[completed_before..].iter().map(|c| c.trip_id).collect();
        let removed: Vec<&VehicleInfo> =
            before.values().filter(|i| !after.contains(&i.trip_id) && !completed.contains(&i.trip_id)).collect();
        // Then removals are exactly the gridlock removals, of fronts at count 1199
        assert_eq!(r.w.metrics().removed_gridlock - gridlock_before, removed.len() as u64, "tick {t}");
        assert_eq!(r.w.metrics().removed_unreachable, 0);
        for i in &removed {
            assert_eq!(i.blocked_ticks, GRIDLOCK_REMOVE_TICKS as u32 - 1, "tick {t}: trip {}", i.trip_id);
            assert!(fronts.contains(&i.trip_id), "tick {t}: removed trip {} was not a front", i.trip_id);
            // And the removal is not an exit of its link
            let VehicleState::OnLink(l) = i.state else { panic!("removed vehicle was not on a link") };
            let k = r.ring.iter().position(|&x| x == l).expect("on a ring link");
            assert_eq!(r.w.link_exit_count(l), exits_before[k], "tick {t}: removal counted as an exit");
            first_removal.get_or_insert(t);
        }
        removals += removed.len() as u64;
        if t == 400 {
            // (premise: the ring is deadlocked: every ring link full, nothing moved for 50 ticks)
            for &l in &r.ring {
                assert_eq!(r.w.link_count(l), r.w.network().capacity(l), "ring link {l:?} not full at 400");
            }
            assert!(infos(&r.w).iter().any(|i| i.blocked_ticks >= 50), "fronts not blocked at 400");
        }
        // And no count ever reaches 1200, and no gridlock reroute ever finds a path
        for i in infos(&r.w) {
            assert!(i.blocked_ticks < GRIDLOCK_REMOVE_TICKS as u32);
        }
        assert_eq!(r.w.reroute_stats().gridlock_reroutes, 0);
        if r.w.counts().active == 0 {
            break;
        }
    }
    // And the ring drains within 30 min after the first removal
    let first = first_removal.expect("the deadlock was relieved by removal");
    assert!(removals >= 1);
    assert_eq!(r.w.counts().active, 0, "ring still holds vehicles at tick {}", r.w.tick());
    assert!(r.w.tick() <= first + 3600, "drained only at tick {} (first removal {first})", r.w.tick());
    assert_eq!(r.w.counts().completed + removals, 160);
}

// ─── 13 ───────────────────────────────────────────────────────────────────
#[test]
fn gridlock_metrics_and_conservation() {
    // step_checked asserts the C2 identities every tick; run both constructions through
    // the states that exercise each removal kind
    let mut f = fork(Q::None, 2, None);
    for _ in 0..900 {
        step_checked(&mut f.w);
    }
    assert!(f.w.metrics().removed_unreachable >= 1, "precondition: an unreachable removal");
    let mut r = ring();
    for _ in 0..3000 {
        step_checked(&mut r.w);
    }
    let m = r.w.metrics();
    assert!(m.removed_gridlock >= 1, "precondition: a gridlock removal");

    // And the core list is unchanged; the extended list is the core list + the new fields,
    // aligned by index with its array (core_004 pins the core list)
    let n = METRIC_NAMES.len();
    assert_eq!(&EXTENDED_METRIC_NAMES[..n], METRIC_NAMES);
    assert_eq!(&EXTENDED_METRIC_NAMES[n..], &["removed_gridlock", "unserved"]);
    let core = metrics_to_array(&m);
    let arr = metrics_to_extended_array(&m);
    assert_eq!(core.len(), n);
    assert_eq!(arr.len(), n + 2);
    for k in 0..n {
        assert!(arr[k] == core[k] || (arr[k].is_nan() && core[k].is_nan()), "index {k}");
    }
    assert_eq!(arr[n], m.removed_gridlock as f64);
    assert_eq!(arr[n + 1], m.unserved as f64);
    let idx = |name: &str| EXTENDED_METRIC_NAMES.iter().position(|&x| x == name).unwrap();
    assert_eq!(arr[idx("unreachable")], m.unreachable as f64);
    assert_eq!(arr[idx("completed")], m.completed as f64);
}

// ─── 14 ───────────────────────────────────────────────────────────────────
#[test]
fn gridlock_reroute_spends_no_budget() {
    let mut f = fork(Q::Free, 0, None);
    for _ in 0..400 {
        let s0 = f.w.reroute_stats();
        let t = f.w.tick();
        step_checked(&mut f.w);
        let s = f.w.reroute_stats();
        if s.gridlock_reroutes > s0.gridlock_reroutes {
            // (precondition: no periodic reconsideration is due in this tick)
            for i in infos(&f.w) {
                assert_ne!((t + i.trip_id) % REROUTE_PERIOD_TICKS, 0, "periodic due at {t}");
            }
            // Then the relief step spent no budget and is not a forced decision
            assert_eq!(s.budgeted_total, s0.budgeted_total, "tick {t}");
            assert_eq!(s.forced_total, s0.forced_total, "tick {t}");
            assert_eq!(s.max_budgeted_in_a_tick, s0.max_budgeted_in_a_tick);
            return;
        }
    }
    panic!("no gridlock reroute happened");
}

// ─── 15 ───────────────────────────────────────────────────────────────────
#[test]
fn relief_is_deterministic_and_clone_safe() {
    let blocked = |w: &World| -> Vec<(u64, u32)> { infos(w).iter().map(|i| (i.trip_id, i.blocked_ticks)).collect() };
    let mut a = ring();
    let mut b = ring();
    let mut c: Option<World> = None;
    let mut saw_blocked_at_clone = false;
    for _ in 0..4000 {
        if a.w.tick() == 700 {
            let snap = a.w.clone();
            saw_blocked_at_clone = blocked(&snap).iter().any(|&(_, n)| n > 0);
            c = Some(snap);
        }
        step_checked(&mut a.w);
        step_checked(&mut b.w);
        assert_eq!(a.w.state_hash(), b.w.state_hash(), "tick {}", a.w.tick());
        assert_eq!(blocked(&a.w), blocked(&b.w), "tick {}", a.w.tick());
        if let Some(cw) = c.as_mut() {
            step_checked(cw);
            assert_eq!(cw.state_hash(), a.w.state_hash(), "clone diverged at tick {}", a.w.tick());
            assert_eq!(blocked(cw), blocked(&a.w));
            assert_eq!(cw.reroute_stats(), a.w.reroute_stats());
            assert_eq!(cw.metrics().removed_gridlock, a.w.metrics().removed_gridlock);
        }
    }
    assert!(saw_blocked_at_clone, "precondition: fronts were blocked at the clone tick");
    assert!(a.w.metrics().removed_gridlock >= 1, "precondition: relief happened after the clone");
}

// ─── 16 ───────────────────────────────────────────────────────────────────
#[test]
fn normal_traffic_untouched_by_relief() {
    for closure in [false, true] {
        let city = three_bridges(2026, 7);
        let mut w = World::from_scenario(city.scenario.clone()).unwrap();
        if closure {
            for l in city.landmarks.central_bridge {
                w.schedule(close(l, 1200)).unwrap();
            }
        }
        let mut max_blocked = 0u32;
        for t in 0..7200u64 {
            w.step();
            if t % 60 == 0 {
                for i in infos(&w) {
                    max_blocked = max_blocked.max(i.blocked_ticks);
                }
            }
        }
        assert!(w.counts().completed > 1000, "closure={closure}: the city was busy");
        assert_eq!(w.reroute_stats().gridlock_reroutes, 0, "closure={closure}");
        assert_eq!(w.metrics().removed_gridlock, 0, "closure={closure}");
        assert!(max_blocked < GRIDLOCK_REROUTE_TICKS as u32, "closure={closure}: max blocked {max_blocked}");
    }
}

// ─── 17–19: added after Red review r1 (reviewer-verified against a reference) ──

/// Fork variant with an optional single demand trip Z→D generated in a given tick.
struct F {
    w: World,
    l1: LinkId,
    p: LinkId,
    q1: LinkId,
    q2: LinkId,
    r: LinkId,
    v: sim_core::VehicleId,
    b1: sim_core::VehicleId,
}

/// Same as the ward's fork(Q::Free / Q::None), optionally with demand Z→D and an L1 sat override.
fn fork_d(with_q: bool, demand_tick: Option<u64>, l1_sat: Option<f64>) -> F {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-200.0, 0.0);
    let a = b.node(0.0, 0.0);
    let bb = b.node(10.0, 0.0);
    let d = b.node(210.0, 0.0);
    let x = b.node(10.0, -200.0);
    let l1 = b.link(z, a, 10.0, 1);
    let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
    let r = b.link(bb, d, 10.0, 1);
    let cx = b.link(bb, x, 10.0, 1);
    let (mut q1, mut q2) = (LinkId(0), LinkId(0));
    if with_q {
        let e = b.node(5.0, 9.0);
        let y = b.node(5.0, 209.0);
        q1 = b.link_with_length(a, e, 10.0, 10.0, 1);
        q2 = b.link_with_length(e, bb, 10.0, 10.0, 1);
        b.link(e, y, 10.0, 1);
    }
    if let Some(s) = l1_sat {
        b.set_sat_flow(l1, s);
    }
    let net = b.build().unwrap();
    let mut demand = DemandModel::default();
    if let Some(t) = demand_tick {
        // exactly one trip Z→D, generated in tick t
        demand.flows.push(OdFlow { origin: z, dest: d, veh_per_hour: 7200.0 });
        let s = |k: u64| k as f64 * 0.5;
        demand.profile = Profile { points: vec![(s(t - 1), 0.0), (s(t), 1.0), (s(t + 1), 0.0)] };
    }
    let mut w = World::from_scenario(Scenario { network: net, demand, demand_seed: 1, behavior_seed: 1 }).unwrap();
    w.schedule(close(cx, 0)).unwrap();
    w.step();
    let b1 = w.spawn_with_route(vec![l1, p, cx]).unwrap();
    let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
    F { w, l1, p, q1, q2, r, v, b1 }
}


// ─── 17 ───────────────────────────────────────────────────────────────────
/// X1 (kills "credit checked before the blocked check"): the blocked check is a pure read made
/// even when credit < 1. With L1 at sat 0.125 the lane needs 16 ticks to re-earn a credit after
/// b1's crossing, and v reaches the stop line (P full) inside that window.
#[test]
fn blocked_counts_while_credit_is_low() {
    let mut f = fork_d(false, None, Some(0.125));
    let mut b1_crossed_at = None;
    let mut first_at_line = None;
    let mut prev_at_line: Option<u32> = None;
    for _ in 0..400 {
        let t = f.w.tick();
        let e0 = f.w.link_exit_count(f.l1);
        f.w.step();
        if f.w.link_exit_count(f.l1) > e0 {
            b1_crossed_at.get_or_insert(t);
        }
        let i = f.w.vehicle(f.v).unwrap();
        if i.state == VehicleState::OnLink(f.l1) && i.s >= 200.0 - 1e-9 {
            first_at_line.get_or_insert(t);
            // Then a front standing at the stop line with P full is counted from its first such tick
            assert!(i.blocked_ticks >= 1, "tick {t}: at the stop line with P full but count 0");
            if let Some(p) = prev_at_line {
                assert_eq!(i.blocked_ticks, p + 1, "tick {t}");
            }
            prev_at_line = Some(i.blocked_ticks);
        }
    }
    let (c, a) = (b1_crossed_at.unwrap(), first_at_line.unwrap());
    // precondition: v stood at the line while the lane was still re-earning credit
    assert!(a < c + 16, "v reached the line at {a}, b1 crossed at {c}");
}


// ─── 18 ───────────────────────────────────────────────────────────────────
/// X2 (kills "gridlock search reads/writes RouterCache"): a demand trip Z→D generated in the
/// tick right after v's gridlock reroute is routed by the cached router; it must get the normal
/// shortest route via P, not one built with P excluded.
#[test]
fn gridlock_search_does_not_touch_router_cache() {
    // find the relief tick r
    let mut probe = fork_d(true, None, None);
    let mut r = None;
    for _ in 0..400 {
        let t = probe.w.tick();
        probe.w.step();
        if probe.w.reroute_stats().gridlock_reroutes == 1 {
            r = Some(t);
            break;
        }
    }
    let r = r.expect("relief happened");
    assert_ne!((r + 1) % COST_EPOCH_TICKS, 0, "precondition: r+1 not an epoch tick");
    let mut f = fork_d(true, Some(r + 1), None);
    while f.w.tick() <= r + 1 {
        f.w.step();
    }
    assert_eq!(f.w.reroute_stats().gridlock_reroutes, 1);
    let g = f.w.generated_trips();
    assert_eq!(g.len(), 1, "exactly one demand trip");
    let trip = g[0].trip_id;
    let dv = infos(&f.w).into_iter().find(|i| i.trip_id == trip).unwrap();
    assert_eq!(f.w.shortest_route(f.w.network().link(f.l1).from, f.w.network().link(f.r).to).unwrap().0, vec![f.l1, f.p, f.r]);
    assert_eq!(dv.route, vec![f.l1, f.p, f.r], "the demand trip was routed by a polluted cache");
    let _ = (f.q1, f.q2, f.v, f.b1);
}


// ─── 19 ───────────────────────────────────────────────────────────────────
/// X3b (kills "reroute attempted at 1200"): P is held for good by a credit-starved vehicle
/// (P's sat is 1e-6), the only alternative Q1 is closed until v's count is 1190. At 1200 v must
/// be removed, although a gridlock search would now find the free Q route.
#[test]
fn removal_at_1200_makes_no_reroute_attempt() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-200.0, 0.0);
    let a = b.node(0.0, 0.0);
    let bb = b.node(10.0, 0.0);
    let d = b.node(210.0, 0.0);
    let e = b.node(5.0, 9.0);
    let l1 = b.link(z, a, 10.0, 1);
    let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
    let r = b.link(bb, d, 10.0, 1);
    let q1 = b.link_with_length(a, e, 10.0, 10.0, 1);
    let _q2 = b.link_with_length(e, bb, 10.0, 10.0, 1);
    b.set_sat_flow(p, 1e-6);
    let mut w = World::new(b.build().unwrap());
    w.schedule(close(q1, 0)).unwrap();
    w.step();
    let b1 = w.spawn_with_route(vec![l1, p, r]).unwrap();
    let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
    let trip_v = w.vehicle(v).unwrap().trip_id;
    let mut opened_at = None;
    let mut removed_at = None;
    for _ in 0..3000 {
        let t = w.tick();
        let before = w.vehicle(v);
        w.step();
        assert!(w.vehicle(b1).is_some(), "b1 holds P for good");
        match w.vehicle(v) {
            Some(i) => {
                if i.blocked_ticks == 1190 && opened_at.is_none() {
                    w.schedule(Command { tick: t + 1, kind: CommandKind::OpenLink(q1) }).unwrap();
                    opened_at = Some(t + 1);
                }
                assert!(
                    i.state == VehicleState::OnLink(l1) || i.state == VehicleState::WaitingAtOrigin,
                    "tick {t}: v left L1 ({:?}) instead of being removed",
                    i.state
                );
            }
            None => {
                assert_eq!(before.unwrap().blocked_ticks, GRIDLOCK_REMOVE_TICKS as u32 - 1);
                removed_at = Some(t);
                break;
            }
        }
    }
    let (o, rm) = (opened_at.unwrap(), removed_at.expect("v removed"));
    assert!((o..=rm).all(|t| (t + trip_v) % REROUTE_PERIOD_TICKS != 0), "precondition: periodic in window");
    assert_eq!(w.shortest_route(a, d).map(|r| r.0), Some(vec![q1, _q2, r]), "precondition: the free Q route is the best route at removal");
    assert_eq!(w.metrics().removed_gridlock, 1);
    assert_eq!(w.reroute_stats().gridlock_reroutes, 0, "earlier searches found no path; none at 1200");
}

// ─── 20–22: added after Red review r2 (reviewer-verified against a reference) ──

// ─── 20 ───────────────────────────────────────────────────────────────────
/// R2-1 (kills G3: stranding does not reset the count). Fork without Q: v is blocked
/// behind stranded b1 on P. At count 200, P is closed; v has no route and strands, so its
/// count must drop to 0. P reopens; v's retry succeeds and, P still full, v is blocked
/// again: the count restarts at 1, not at 201.
#[test]
fn stranding_resets_a_blocked_count() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-200.0, 0.0);
    let a = b.node(0.0, 0.0);
    let bb = b.node(10.0, 0.0);
    let d = b.node(210.0, 0.0);
    let x = b.node(10.0, -200.0);
    let l1 = b.link(z, a, 10.0, 1);
    let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
    let r = b.link(bb, d, 10.0, 1);
    let cx = b.link(bb, x, 10.0, 1);
    let mut w = World::new(b.build().unwrap());
    w.schedule(close(cx, 0)).unwrap();
    step_checked(&mut w);
    let b1 = w.spawn_with_route(vec![l1, p, cx]).unwrap();
    let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
    while w.vehicle(v).unwrap().blocked_ticks < 200 {
        step_checked(&mut w);
        assert!(w.tick() < 2000);
    }
    let tc = w.tick();
    w.schedule(close(p, tc)).unwrap();
    w.schedule(open(p, tc + 30)).unwrap();
    let (mut stranded_seen, mut resumed) = (false, false);
    for _ in 0..200 {
        let t = w.tick();
        step_checked(&mut w);
        assert!(w.vehicle(b1).is_some(), "precondition: b1 still holds P at {t}");
        let i = w.vehicle(v).unwrap();
        assert_eq!(i.state, VehicleState::OnLink(l1));
        if i.stranded {
            stranded_seen = true;
            assert_eq!(i.blocked_ticks, 0, "tick {t}: stranded but count kept");
        } else if stranded_seen {
            // first evaluation after the successful retry: blocked again, count restarts
            assert_eq!(i.blocked_ticks, 1, "tick {t}: count resumed from a stale value");
            resumed = true;
            break;
        }
    }
    assert!(stranded_seen && resumed, "preconditions: v stranded, then resumed");
}


// ─── 21 ───────────────────────────────────────────────────────────────────
/// R2-2 (kills E: a gridlock removal records an exit-time sample). Test 19's construction:
/// after v's removal L1 is empty, so the next epoch has no exits on L1 and its cost must
/// follow the queue_term-only formula.
#[test]
fn gridlock_removal_records_no_exit_time() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-200.0, 0.0);
    let a = b.node(0.0, 0.0);
    let bb = b.node(10.0, 0.0);
    let d = b.node(210.0, 0.0);
    let l1 = b.link(z, a, 10.0, 1);
    let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
    let r = b.link(bb, d, 10.0, 1);
    b.set_sat_flow(p, 1e-6);
    let mut w = World::new(b.build().unwrap());
    step_checked(&mut w);
    let b1 = w.spawn_with_route(vec![l1, p, r]).unwrap();
    let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
    let mut removed_at = None;
    for _ in 0..3000 {
        let t = w.tick();
        step_checked(&mut w);
        if w.vehicle(v).is_none() {
            removed_at = Some(t);
            break;
        }
    }
    let rm = removed_at.expect("v removed");
    assert_eq!(w.metrics().removed_gridlock, 1);
    assert!(w.vehicle(b1).is_some());
    assert_ne!(rm % COST_EPOCH_TICKS, 0, "precondition: removal not on an epoch tick");
    // When the epoch after the removal updates L1 (empty, no real exits since b1's ~tick 25)
    while w.tick() % COST_EPOCH_TICKS != 0 {
        step_checked(&mut w);
    }
    assert!(w.link_vehicles(l1).is_empty());
    let prev = w.link_cost(l1);
    step_checked(&mut w); // epoch boundary
    // Then the cost has no exit-time sample: observed = queue_term = 200/10 + 0
    let ff = 200.0 / 10.0 + 1.0 / 0.5;
    let expected = f64::max(ff, 0.5 * (200.0 / 10.0) + 0.5 * prev);
    assert_eq!(w.link_cost(l1), expected, "a gridlock removal produced an exit-time sample");
}


// ─── 22 ───────────────────────────────────────────────────────────────────
/// R2-3 (kills COST: the gridlock search uses free-flow instead of current costs).
/// Two alternatives around the blocked P: Q (A→E→B, cheaper at free flow) and S (A→F→B).
/// Stranded vehicles queue on Q2 so Q's current cost exceeds S's. The relief must take S.
#[test]
fn gridlock_search_uses_current_costs() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-200.0, 0.0);
    let a = b.node(0.0, 0.0);
    let bb = b.node(10.0, 0.0);
    let d = b.node(210.0, 0.0);
    let x = b.node(10.0, -200.0);
    let e = b.node(5.0, 9.0);
    let f = b.node(5.0, -9.0);
    let ze = b.zone(5.0, 300.0);
    let l1 = b.link(z, a, 10.0, 1);
    let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
    let r = b.link(bb, d, 10.0, 1);
    let cx = b.link(bb, x, 10.0, 1);
    let q1 = b.link_with_length(a, e, 10.0, 10.0, 1);
    let q2 = b.link_with_length(e, bb, 100.0, 10.0, 1); // ff 10 + 2 = 12
    let s1 = b.link_with_length(a, f, 10.0, 10.0, 1);
    let s2 = b.link_with_length(f, bb, 110.0, 10.0, 1); // ff 11 + 2 = 13
    let ce = b.link_with_length(ze, e, 50.0, 10.0, 1);
    let mut w = World::new(b.build().unwrap());
    w.schedule(close(cx, 0)).unwrap();
    step_checked(&mut w);
    let b1 = w.spawn_with_route(vec![l1, p, cx]).unwrap();
    let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
    for _ in 0..6 {
        w.spawn_with_route(vec![ce, q2, cx]).unwrap();
    }
    let ffq = 3.0 + 12.0;
    let ffs = 3.0 + 13.0;
    assert!(ffq < ffs);
    for _ in 0..400 {
        let t = w.tick();
        let g0 = w.reroute_stats().gridlock_reroutes;
        step_checked(&mut w);
        if w.reroute_stats().gridlock_reroutes > g0 {
            // precondition: by current costs S is cheaper than Q
            let cq = w.link_cost(q1) + w.link_cost(q2);
            let cs = w.link_cost(s1) + w.link_cost(s2);
            assert!(cs < cq, "precondition at {t}: S {cs} vs Q {cq}");
            let i = w.vehicle(v).unwrap();
            assert_eq!(i.route, vec![l1, s1, s2, r], "tick {t}: relief ignored current costs");
            assert!(w.vehicle(b1).is_some());
            return;
        }
    }
    panic!("no gridlock reroute");
}

// ─── 23–26: added after Red review r3 (reviewer-verified against a reference) ──

// ─── 23 ───────────────────────────────────────────────────────────────────
/// R3-1 (kills U and G2). L1 earns credit slowly (sat 0.005: 400 ticks per credit). v is blocked
/// behind stranded b1 on P while L1 re-earns credit. At count 120 the gridlock reroute finds the
/// free Q route, but credit < 1: v stays with its count unchanged (120). From the next evaluation
/// on it is credit-limited with space, so the count is 0 until it crosses onto Q1.
#[test]
fn relief_with_space_but_low_credit() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-200.0, 0.0);
    let a = b.node(0.0, 0.0);
    let bb = b.node(10.0, 0.0);
    let d = b.node(210.0, 0.0);
    let x = b.node(10.0, -200.0);
    let e = b.node(5.0, 9.0);
    let y = b.node(5.0, 209.0);
    let l1 = b.link(z, a, 10.0, 1);
    let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
    let r = b.link(bb, d, 10.0, 1);
    let cx = b.link(bb, x, 10.0, 1);
    let q1 = b.link_with_length(a, e, 10.0, 10.0, 1);
    let q2 = b.link_with_length(e, bb, 10.0, 10.0, 1);
    let _cy = b.link(e, y, 10.0, 1);
    b.set_sat_flow(l1, 0.005);
    let mut w = World::new(b.build().unwrap());
    w.schedule(close(cx, 0)).unwrap();
    step_checked(&mut w);
    let b1 = w.spawn_with_route(vec![l1, p, cx]).unwrap();
    let v = w.spawn_with_route(vec![l1, p, r]).unwrap();

    let mut relief_at = None;
    let mut waited = 0;
    for _ in 0..2000 {
        let t = w.tick();
        let g0 = w.reroute_stats().gridlock_reroutes;
        let before = w.vehicle(v).unwrap();
        step_checked(&mut w);
        let i = w.vehicle(v).unwrap();
        if w.reroute_stats().gridlock_reroutes > g0 {
            assert_eq!(before.blocked_ticks, GRIDLOCK_REROUTE_TICKS as u32 - 1, "tick {t}");
            assert_eq!(i.route, vec![l1, q1, q2, r], "tick {t}");
            assert_eq!(i.state, VehicleState::OnLink(l1), "tick {t}: crossed without credit");
            assert_eq!(i.blocked_ticks, GRIDLOCK_REROUTE_TICKS as u32, "tick {t}: count must stay unchanged");
            relief_at = Some(t);
            continue;
        }
        if relief_at.is_some() {
            if i.state == VehicleState::OnLink(l1) {
                assert_eq!(i.route, vec![l1, q1, q2, r], "tick {t}");
                assert_eq!(i.blocked_ticks, 0, "tick {t}: credit-limited with space must reset");
                waited += 1;
            } else {
                assert_eq!(i.state, VehicleState::OnLink(q1));
                assert!(w.vehicle(b1).is_some());
                assert!(waited >= 10, "precondition: v waited for credit after the relief ({waited})");
                return;
            }
        }
    }
    panic!("no relief / no crossing");
}


// ─── 24 ───────────────────────────────────────────────────────────────────
/// R3-2 (kills PR). A budgeted (priority) reroute that changes a blocked front's route
/// downstream of its next link does not reset its count.
#[test]
fn priority_reroute_keeps_blocked_count() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-200.0, 0.0);
    let a = b.node(0.0, 0.0);
    let bb = b.node(10.0, 0.0);
    let d = b.node(210.0, 0.0);
    let x = b.node(10.0, -200.0);
    let m = b.node(110.0, 100.0);
    let l1 = b.link(z, a, 10.0, 1);
    let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
    let r = b.link(bb, d, 10.0, 1);
    let cx = b.link(bb, x, 10.0, 1);
    let r2a = b.link(bb, m, 10.0, 1);
    let r2b = b.link(m, d, 10.0, 1);
    let mut w = World::new(b.build().unwrap());
    w.schedule(close(cx, 0)).unwrap();
    step_checked(&mut w);
    let _b1 = w.spawn_with_route(vec![l1, p, cx]).unwrap();
    let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
    while w.vehicle(v).unwrap().blocked_ticks < 200 {
        step_checked(&mut w);
        assert!(w.tick() < 2000);
    }
    let tc = w.tick();
    w.schedule(close(r, tc)).unwrap();
    step_checked(&mut w);
    let i = w.vehicle(v).unwrap();
    assert_eq!(i.route, vec![l1, p, r2a, r2b], "precondition: priority reroute around R");
    assert_eq!(i.blocked_ticks, 201, "a budgeted reroute reset the blocked count");
}


// ─── 25 ───────────────────────────────────────────────────────────────────
/// R3-3 (kills FD). A forced decision whose new next link is full is a blocked evaluation:
/// the count is 1 in that evaluation and keeps rising.
#[test]
fn forced_decision_into_full_link_counts() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-200.0, 0.0);
    let a = b.node(0.0, 0.0);
    let bb = b.node(10.0, 0.0);
    let d = b.node(210.0, 0.0);
    let e = b.node(5.0, 9.0);
    let y = b.node(5.0, 209.0);
    let l1 = b.link(z, a, 10.0, 1);
    let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
    let r = b.link(bb, d, 10.0, 1);
    let q1 = b.link_with_length(a, e, 10.0, 10.0, 1);
    let q2 = b.link_with_length(e, bb, 10.0, 10.0, 1);
    let cy = b.link(e, y, 10.0, 1);
    let mut w = World::new(b.build().unwrap());
    w.schedule(close(cy, 0)).unwrap();
    w.schedule(close(p, 0)).unwrap();
    step_checked(&mut w);
    let b2 = w.spawn_with_route(vec![l1, q1, cy]).unwrap();
    let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
    let mut forced_seen = false;
    let mut prev = 0u32;
    for _ in 0..300 {
        let t = w.tick();
        let f0 = w.reroute_stats().forced_total;
        step_checked(&mut w);
        let i = w.vehicle(v).unwrap();
        if w.reroute_stats().forced_total > f0 && i.route == vec![l1, q1, q2, r] && !forced_seen {
            assert!(w.vehicle(b2).unwrap().stranded, "precondition: b2 holds Q1");
            assert_eq!(i.blocked_ticks, 1, "tick {t}: forced decision into a full link not counted");
            forced_seen = true;
        } else if forced_seen {
            assert_eq!(i.blocked_ticks, prev + 1, "tick {t}");
        }
        prev = i.blocked_ticks;
    }
    assert!(forced_seen, "precondition: forced decision observed");
}


// ─── 26 ───────────────────────────────────────────────────────────────────
/// R3-4 (kills NR). "Blocked" requires the evaluation to reach the stop line. v drives the
/// 200 m L1 alone toward P, which b1 already holds for good: during the approach v is a lane
/// front with a full next link, but it does not reach the line, so its count stays 0. It is 1
/// in its first evaluation at the line.
#[test]
fn approaching_front_is_not_blocked() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-200.0, 0.0);
    let a = b.node(0.0, 0.0);
    let bb = b.node(10.0, 0.0);
    let d = b.node(210.0, 0.0);
    let x = b.node(10.0, -200.0);
    let l1 = b.link(z, a, 10.0, 1);
    let p = b.link_with_length(a, bb, 10.0, 10.0, 1);
    let r = b.link(bb, d, 10.0, 1);
    let cx = b.link(bb, x, 10.0, 1);
    let mut w = World::new(b.build().unwrap());
    w.schedule(close(cx, 0)).unwrap();
    step_checked(&mut w);
    let b1 = w.spawn_with_route(vec![l1, p, cx]).unwrap();
    while !w.vehicle(b1).unwrap().stranded {
        step_checked(&mut w);
        assert!(w.tick() < 200);
    }
    assert_eq!(w.link_count(p), w.network().capacity(p), "precondition: P full");
    let v = w.spawn_with_route(vec![l1, p, r]).unwrap();
    let mut approach_ticks = 0;
    for _ in 0..200 {
        let t = w.tick();
        step_checked(&mut w);
        assert!(w.vehicle(b1).is_some());
        let i = w.vehicle(v).unwrap();
        if i.state != VehicleState::OnLink(l1) {
            continue;
        }
        if i.s < 200.0 - 1e-9 {
            // still short of the line: not a blocked evaluation
            assert_eq!(i.blocked_ticks, 0, "tick {t}: counted at s = {} before reaching the line", i.s);
            approach_ticks += 1;
        } else {
            assert!(approach_ticks >= 20, "precondition: a long approach ({approach_ticks} ticks)");
            assert_eq!(i.blocked_ticks, 1, "tick {t}: first evaluation at the line");
            return;
        }
    }
    panic!("v never reached the line");
}

// ─── 27–28: added after Red review r4 (MINOR, reviewer-verified) ──

// ─── 27 ───────────────────────────────────────────────────────────────────
#[test]
fn huge_unknown_id_does_not_panic() {
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(100.0, 0.0);
    b.link(o, a, 10.0, 1);
    b.set_sat_flow(LinkId(u32::MAX), 0.3);
    assert_eq!(b.build().map(|_| ()), Err(NetworkError::UnknownLink(LinkId(u32::MAX))));
}

// ─── 28 ───────────────────────────────────────────────────────────────────
#[test]
fn invalid_then_valid_override_last_wins() {
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(100.0, 0.0);
    let l = b.link(o, a, 10.0, 1);
    b.set_sat_flow(l, f64::NAN);
    b.set_sat_flow(l, 0.3);
    let net = b.build().unwrap();
    assert_eq!(net.link(l).sat_flow_per_lane, 0.3);
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(100.0, 0.0);
    let l = b.link(o, a, 10.0, 1);
    b.set_sat_flow(l, 0.3);
    b.set_sat_flow(l, 0.0);
    assert_eq!(b.build().map(|_| ()), Err(NetworkError::InvalidSatFlow { from: o, to: a }));
}
