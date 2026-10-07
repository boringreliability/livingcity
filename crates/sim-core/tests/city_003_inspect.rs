//! Ward city-003: inspection queries (read-only; contract `.wdd/epics/city.md` § C4).
#![allow(clippy::needless_range_loop)]

use std::collections::{BTreeMap, BTreeSet};

use sim_core::cities::{river_city, three_bridges};
use sim_core::frame::write_vehicle_records;
use sim_core::params::{DT, QUEUED_SPEED};
use sim_core::{Command, CommandKind, LinkId, NetworkBuilder, TripOutcome, World};

fn world_rc() -> World {
    World::from_scenario(river_city(2026, 7).scenario).unwrap()
}

fn live_trips(w: &World) -> BTreeSet<u64> {
    w.vehicle_ids().into_iter().map(|id| w.vehicle(id).unwrap().trip_id).collect()
}

/// Ring deadlock from city_001 (relieved by a gridlock removal after 10 min).
fn ring() -> World {
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
    w
}

// ─── 1 ────────────────────────────────────────────────────────────────────
#[test]
fn vehicle_at_matches_frame_order() {
    let mut w = world_rc();
    for _ in 0..1200 {
        w.step();
    }
    let mut words = Vec::new();
    let n = write_vehicle_records(&w, &mut words) as usize;
    assert!(n > 500, "precondition: a busy city ({n} on network)");
    // Walk the records in frame order: links → lanes → front first
    let mut index_in_lane: BTreeMap<(u32, u8), usize> = BTreeMap::new();
    for i in 0..n {
        let link = LinkId(words[4 * i]);
        let s = f32::from_bits(words[4 * i + 1]);
        let lane = ((words[4 * i + 3] >> 8) & 0xff) as u8;
        let k = index_in_lane.entry((link.0, lane)).or_insert(0);
        let trip = w.vehicle_at(link, lane, *k).expect("a vehicle at every record");
        // Then it is the k-th vehicle from the front of that lane, at the record's position
        let mut lane_views: Vec<_> = w.link_vehicles(link).into_iter().filter(|v| v.lane == lane).collect();
        lane_views.sort_by(|a, b| b.s.partial_cmp(&a.s).unwrap());
        assert_eq!(lane_views[*k].trip_id, trip, "record {i}");
        assert_eq!(lane_views[*k].s as f32, s, "record {i}");
        *k += 1;
    }
    // Out of range → None
    let some_link = LinkId(words[0]);
    let lanes = w.network().link(some_link).lanes;
    assert_eq!(w.vehicle_at(some_link, lanes, 0), None);
    assert_eq!(w.vehicle_at(some_link, 0, 10_000), None);
}

// ─── 2 ────────────────────────────────────────────────────────────────────
#[test]
fn vehicle_by_trip_reports_live_vehicles() {
    let mut w = world_rc();
    for _ in 0..2400 {
        w.step();
    }
    let gen: BTreeMap<u64, _> = w.generated_trips().iter().map(|g| (g.trip_id, (g.origin, g.dest))).collect();
    let live = live_trips(&w);
    assert!(live.len() > 500);
    for &t in &live {
        let i = w.vehicle_by_trip(t).expect("live trip");
        assert_eq!(i.trip_id, t);
        assert_eq!((i.origin, i.dest), gen[&t], "trip {t} endpoints");
    }
    // completed trips are not live
    let done: Vec<u64> = w.completed_log().iter().map(|c| c.trip_id).take(50).collect();
    assert!(!done.is_empty());
    for t in done {
        assert!(w.vehicle_by_trip(t).is_none(), "completed trip {t}");
    }
    assert!(w.vehicle_by_trip(u64::MAX).is_none());
    assert!(w.vehicle_by_trip(w.counts().spawned).is_none(), "never spawned");
}

// ─── 3 ────────────────────────────────────────────────────────────────────
#[test]
fn trip_outcome_explains_disappearance() {
    // Completed: exact travel time
    let mut w = World::from_scenario(three_bridges(17, 23).scenario).unwrap();
    for _ in 0..1200 {
        w.step();
    }
    let c = w.completed_log()[0];
    assert_eq!(w.trip_outcome(c.trip_id), TripOutcome::Completed { travel_time_s: (c.completed_tick - c.created_tick) as f64 * DT });
    let some_live = *live_trips(&w).iter().next().unwrap();
    assert_eq!(w.trip_outcome(some_live), TripOutcome::Live);
    assert_eq!(w.trip_outcome(w.counts().spawned), TripOutcome::Unknown);
    assert_eq!(w.trip_outcome(u64::MAX), TripOutcome::Unknown);

    // RemovedUnreachable: close every bridge; cross-river vehicles are removed after their retries
    let city = three_bridges(17, 23);
    let mut w = World::from_scenario(city.scenario.clone()).unwrap();
    let lm = city.landmarks;
    for l in [lm.north_bridge, lm.central_bridge, lm.south_bridge].iter().flatten() {
        w.schedule(Command { tick: 1200, kind: CommandKind::CloseLink(*l) }).unwrap();
    }
    for _ in 0..(1200 + 700) {
        w.step();
    }
    let removed_unreachable = w.metrics().removed_unreachable;
    assert!(removed_unreachable > 0, "precondition: removals happened");
    let completed: BTreeSet<u64> = w.completed_log().iter().map(|c| c.trip_id).collect();
    let live = live_trips(&w);
    let gone: Vec<u64> = (0..w.counts().spawned).filter(|t| !completed.contains(t) && !live.contains(t)).collect();
    assert_eq!(gone.len() as u64, removed_unreachable);
    for t in gone {
        assert_eq!(w.trip_outcome(t), TripOutcome::RemovedUnreachable, "trip {t}");
    }

    // RemovedGridlock: the deadlocked ring
    let mut w = ring();
    let mut seen_live: BTreeSet<u64> = live_trips(&w);
    let mut removed = Vec::new();
    for _ in 0..3000 {
        let before = seen_live.clone();
        let done_before = w.completed_log().len();
        w.step();
        let now = live_trips(&w);
        let done: BTreeSet<u64> = w.completed_log()[done_before..].iter().map(|c| c.trip_id).collect();
        removed.extend(before.iter().filter(|t| !now.contains(t) && !done.contains(t)).copied());
        seen_live = now;
    }
    assert!(!removed.is_empty(), "precondition: gridlock removals");
    assert_eq!(removed.len() as u64, w.metrics().removed_gridlock);
    for t in removed {
        assert_eq!(w.trip_outcome(t), TripOutcome::RemovedGridlock, "trip {t}");
    }
}

// ─── 4 ────────────────────────────────────────────────────────────────────
#[test]
fn link_stats_match_world() {
    let mut w = world_rc();
    let net = w.network().clone();
    for round in 0..4 {
        for _ in 0..900 {
            w.step();
        }
        for l in net.links() {
            let st = w.link_stats(l.id);
            assert_eq!(st.vehicles, w.link_count(l.id), "round {round} link {:?}", l.id);
            let q = w.link_vehicles(l.id).iter().filter(|v| v.v < QUEUED_SPEED).count() as u32;
            assert_eq!(st.queued, q);
            assert_eq!(st.cost_s, w.link_cost(l.id));
            let ff = l.length_m / l.speed_limit_mps + 1.0 / (l.lanes as f64 * l.sat_flow_per_lane);
            assert_eq!(st.free_flow_s, ff);
            assert!(st.cost_s >= st.free_flow_s);
            assert_eq!(st.exits, w.link_exit_count(l.id));
        }
    }
}

// ─── 5 ────────────────────────────────────────────────────────────────────
#[test]
fn inspection_does_not_change_state() {
    let mut a = world_rc();
    let mut b = world_rc();
    let net = a.network().clone();
    for t in 0..2400u64 {
        a.step();
        b.step();
        // query everything on b
        for l in net.links() {
            let _ = b.link_stats(l.id);
            for lane in 0..l.lanes {
                let _ = b.vehicle_at(l.id, lane, 0);
            }
        }
        for trip in [0, t, t * 3, u64::MAX] {
            let _ = b.vehicle_by_trip(trip);
            let _ = b.trip_outcome(trip);
        }
        assert_eq!(a.state_hash(), b.state_hash(), "tick {t}");
    }
}
