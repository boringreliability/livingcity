//! Ward core-003: closures, rerouting, commands and determinism.
//! Model contract: `.wdd/epics/core.md` (Closures and rerouting, Commands and determinism).
#![allow(clippy::needless_range_loop, clippy::manual_is_multiple_of, clippy::type_complexity)]

use std::collections::{BTreeMap, BTreeSet};

use sim_core::cities::three_bridges;
use sim_core::params::{NO_ROUTE_MAX_RETRIES, NO_ROUTE_RETRY_TICKS, REROUTE_BUDGET_PER_TICK};
use sim_core::rng::{splitmix64, unit_f64};
use sim_core::{
    City, Command, CommandError, CommandKind, DemandModel, LinkId, NetworkBuilder, NodeId, OdFlow, Profile, Scenario,
    VehicleInfo, VehicleState, World, ZoneKind,
};

const T: u64 = 1200; // closure tick (10 min)

fn step_checked(w: &mut World) {
    w.step();
    if let Err(e) = w.check_invariants() {
        panic!("invariant violated at tick {}: {e}", w.tick());
    }
    let c = w.counts();
    assert_eq!(c.spawned, c.active + c.completed + c.removed, "conservation at tick {}", w.tick());
    assert_eq!(c.active, c.on_network + c.waiting_at_origin + c.no_route, "active split at tick {}", w.tick());
}

fn city() -> City {
    three_bridges(17, 23)
}

fn world(c: &City) -> World {
    World::from_scenario(c.scenario.clone()).expect("valid city")
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

/// Links still to be driven: after the current one (on a link) or all (waiting).
fn remaining(i: &VehicleInfo) -> Vec<LinkId> {
    match i.state {
        VehicleState::OnLink(_) => i.route[i.route_pos + 1..].to_vec(),
        VehicleState::WaitingAtOrigin => i.route.clone(),
        VehicleState::NoRoute => Vec::new(),
    }
}

fn trips_on(w: &World, links: &[LinkId]) -> BTreeSet<u64> {
    links.iter().flat_map(|&l| w.link_vehicles(l)).map(|v| v.trip_id).collect()
}

// ─── 1 ────────────────────────────────────────────────────────────────────
#[test]
fn three_bridges_city_is_valid() {
    // Given the test city
    let c = city();
    let net = &c.scenario.network;
    let x = |n: NodeId| net.node(n).x_m;
    let bridges = [c.landmarks.north_bridge, c.landmarks.central_bridge, c.landmarks.south_bridge];

    // Then each bridge pair crosses the river west→east and east→west
    for [we, ew] in bridges {
        assert!(x(net.link(we).from) < 0.0 && x(net.link(we).to) > 0.0);
        assert!(x(net.link(ew).from) > 0.0 && x(net.link(ew).to) < 0.0);
    }
    // And bridges are the only river crossings
    let crossing: BTreeSet<LinkId> =
        net.links().iter().filter(|l| x(l.from) * x(l.to) < 0.0).map(|l| l.id).collect();
    let expected: BTreeSet<LinkId> = bridges.iter().flatten().copied().collect();
    assert_eq!(crossing, expected);

    // And zones are named, distinct, on the right banks
    assert_eq!(c.zones.len(), 6);
    let names: BTreeSet<&str> = c.zones.iter().map(|z| z.name.as_str()).collect();
    assert_eq!(names.len(), 6);
    for z in &c.zones {
        assert!(net.is_zone(z.node));
        match z.kind {
            ZoneKind::Residential => assert!(x(z.node) < 0.0, "{} not west", z.name),
            ZoneKind::Workplace | ZoneKind::Hospital => assert!(x(z.node) > 0.0, "{} not east", z.name),
        }
    }
    assert_eq!(c.zones.iter().filter(|z| z.kind == ZoneKind::Hospital).count(), 1);

    // And every west zone reaches every east zone and back
    let mut w = world(&c);
    let (west, east): (Vec<_>, Vec<_>) = c.zones.iter().partition(|z| x(z.node) < 0.0);
    for a in &west {
        for b in &east {
            assert!(w.shortest_route(a.node, b.node).is_some(), "{} → {}", a.name, b.name);
            assert!(w.shortest_route(b.node, a.node).is_some(), "{} → {}", b.name, a.name);
        }
    }

    // When 30 min of baseline traffic run
    for _ in 0..3600 {
        step_checked(&mut w);
    }
    // Then the central bridge carries more than half the west→east crossings
    let central = w.link_exit_count(c.landmarks.central_bridge[0]) as f64;
    let all: f64 = bridges.iter().map(|b| w.link_exit_count(b[0]) as f64).sum();
    assert!(all > 500.0, "too little crossing traffic: {all}");
    assert!(central > 0.5 * all, "central {central} of {all}");
}

// ─── 2 ────────────────────────────────────────────────────────────────────
#[test]
fn closed_link_admits_no_new_vehicles() {
    // Given the city with the central bridge closing at T
    let c = city();
    let bridge = c.landmarks.central_bridge;
    let mut w = world(&c);
    for l in bridge {
        w.schedule(close(l, T)).unwrap();
    }
    for _ in 0..T {
        step_checked(&mut w);
    }
    // (state before tick T = the vehicles on the bridge at closure)
    let at_closure = trips_on(&w, &bridge);
    assert!(!at_closure.is_empty(), "premise: traffic on the bridge at closure");
    let mut prev_count: Vec<u32> = bridge.iter().map(|&l| w.link_count(l)).collect();

    // When the sim continues for 20 min
    for _ in 0..2400 {
        step_checked(&mut w);
        // Then nobody new is on the bridge, and its occupancy never grows
        for trip in trips_on(&w, &bridge) {
            assert!(at_closure.contains(&trip), "trip {trip} entered a closed bridge at tick {}", w.tick() - 1);
        }
        for (i, &l) in bridge.iter().enumerate() {
            assert!(w.is_closed(l));
            assert!(w.link_count(l) <= prev_count[i]);
            prev_count[i] = w.link_count(l);
        }
    }
}

// ─── 3 ────────────────────────────────────────────────────────────────────
#[test]
fn vehicles_on_closed_link_may_leave() {
    // Given vehicles on the central bridge when it closes
    let c = city();
    let bridge = c.landmarks.central_bridge;
    let mut w = world(&c);
    for l in bridge {
        w.schedule(close(l, T)).unwrap();
    }
    for _ in 0..T {
        step_checked(&mut w);
    }
    let at_closure = trips_on(&w, &bridge);
    assert!(!at_closure.is_empty());
    // When 150 s pass
    for _ in 0..300 {
        step_checked(&mut w);
    }
    // Then they have all left the bridge, none removed
    assert!(trips_on(&w, &bridge).is_empty(), "vehicles stuck on the closed bridge");
    assert_eq!(w.metrics().removed_unreachable, 0);
    let still_live: BTreeSet<u64> = infos(&w).iter().map(|i| i.trip_id).collect();
    let completed: BTreeSet<u64> = w.completed_log().iter().map(|c| c.trip_id).collect();
    for trip in at_closure {
        assert!(still_live.contains(&trip) || completed.contains(&trip), "trip {trip} vanished");
    }
}

// ─── 4 ────────────────────────────────────────────────────────────────────
#[test]
fn affected_vehicles_reroute_around_closure() {
    let c = city();
    let bridge = c.landmarks.central_bridge;
    let alt = [c.landmarks.north_bridge[0], c.landmarks.south_bridge[0]];
    let mut closed = world(&c);
    let mut baseline = world(&c);
    for l in bridge {
        closed.schedule(close(l, T)).unwrap();
    }
    let alt_exits = |w: &World| alt.iter().map(|&l| w.link_exit_count(l)).sum::<u64>();
    let (mut win_closed, mut win_base) = ((0, 0), (0, 0));
    for t in 0..T + 3000 {
        // When the closed world and a baseline run side by side
        step_checked(&mut closed);
        step_checked(&mut baseline);
        if t == T + 120 {
            // Then 60 s after closure no remaining route uses a closed link
            for i in infos(&closed) {
                assert!(!i.stranded, "unexpected stranded vehicle (alternatives exist)");
                assert!(remaining(&i).iter().all(|l| !closed.is_closed(*l)), "trip {} still routed over the closure", i.trip_id);
            }
        }
        if t == T + 600 {
            win_closed.0 = alt_exits(&closed);
            win_base.0 = alt_exits(&baseline);
        }
    }
    win_closed.1 = alt_exits(&closed);
    win_base.1 = alt_exits(&baseline);
    // And the alternative bridges carry more west→east traffic than in the baseline
    let (dc, db) = (win_closed.1 - win_closed.0, win_base.1 - win_base.0);
    assert!(dc > db, "alternatives: closed {dc} vs baseline {db}");
    assert_eq!(closed.metrics().unreachable, 0);
}

// ─── 5 ────────────────────────────────────────────────────────────────────
#[test]
fn routes_change_only_at_valid_decision_points() {
    // Given closures, a reopening and periodic reroutes over 40 min
    let c = city();
    let net = c.scenario.network.clone();
    let lm = c.landmarks;
    let mut w = world(&c);
    for (l, tick, is_close) in [
        (lm.central_bridge[0], 1200, true),
        (lm.central_bridge[1], 1200, true),
        (lm.central_bridge[0], 2400, false),
        (lm.central_bridge[1], 2400, false),
        (lm.north_bridge[0], 3000, true),
        (lm.north_bridge[0], 4200, false),
    ] {
        w.schedule(if is_close { close(l, tick) } else { open(l, tick) }).unwrap();
    }
    let mut prev: BTreeMap<u64, VehicleInfo> = BTreeMap::new();
    let mut switches_seen = 0;
    for _ in 0..4800 {
        step_checked(&mut w);
        let trips: BTreeMap<u64, (NodeId, NodeId)> =
            w.generated_trips().iter().map(|g| (g.trip_id, (g.origin, g.dest))).collect();
        let mut now = BTreeMap::new();
        for i in infos(&w) {
            if i.state == VehicleState::NoRoute {
                continue;
            }
            // Then the route is contiguous from origin to dest
            let (o, d) = trips[&i.trip_id];
            assert_eq!(net.link(i.route[0]).from, o);
            assert_eq!(net.link(*i.route.last().unwrap()).to, d);
            for k in 1..i.route.len() {
                assert_eq!(net.link(i.route[k - 1]).to, net.link(i.route[k]).from);
            }
            // And an on-link vehicle is on route[route_pos]
            if let VehicleState::OnLink(l) = i.state {
                assert_eq!(l, i.route[i.route_pos]);
            }
            // And the driven prefix (incl. the current link) is never rewritten
            if let Some(p) = prev.get(&i.trip_id) {
                assert!(i.route_pos >= p.route_pos);
                if let VehicleState::OnLink(_) = p.state {
                    assert_eq!(i.route[..=p.route_pos], p.route[..=p.route_pos], "trip {} rewrote its past", i.trip_id);
                }
                if i.route != p.route {
                    switches_seen += 1;
                }
            }
            now.insert(i.trip_id, i);
        }
        prev = now;
    }
    // (premise: routes really changed during the run)
    assert!(switches_seen > 50, "only {switches_seen} route changes observed");
}

// ─── 6 ────────────────────────────────────────────────────────────────────
#[test]
fn no_route_retries_then_removed_on_schedule() {
    // Given all six bridge links closing at T
    let c = city();
    let lm = c.landmarks;
    let mut w = world(&c);
    for b in [lm.north_bridge, lm.central_bridge, lm.south_bridge] {
        for l in b {
            w.schedule(close(l, T)).unwrap();
        }
    }
    for _ in 0..T {
        step_checked(&mut w);
    }
    // trip → (entry tick, link while stranded or None for NoRoute)
    let mut tracked: BTreeMap<u64, (u64, Option<LinkId>)> = BTreeMap::new();
    let mut removed_seen = 0u64;
    let (mut saw_stranded, mut saw_noroute) = (false, false);
    let completed_before: usize = w.completed_log().len();

    for _ in 0..1600 {
        // When the sim runs
        step_checked(&mut w);
        let t = w.tick() - 1; // tick just stepped
        let live: BTreeMap<u64, VehicleInfo> = infos(&w).into_iter().map(|i| (i.trip_id, i)).collect();
        for i in live.values() {
            let unreachable = i.state == VehicleState::NoRoute || i.stranded;
            if unreachable && !tracked.contains_key(&i.trip_id) {
                let link = match i.state {
                    VehicleState::OnLink(l) => Some(l),
                    _ => None,
                };
                assert_eq!(i.no_route_retries, 0, "trip {} entered with retries", i.trip_id);
                tracked.insert(i.trip_id, (t, link));
                saw_stranded |= link.is_some();
                saw_noroute |= link.is_none();
            }
        }
        // Then each tracked vehicle retries exactly every 60 ticks and is removed at entry + 600
        let removal_after = NO_ROUTE_RETRY_TICKS * NO_ROUTE_MAX_RETRIES as u64;
        for (&trip, &(entry, link)) in &tracked {
            let age = t - entry;
            if age < removal_after {
                let i = live.get(&trip).unwrap_or_else(|| panic!("trip {trip} vanished early at age {age}"));
                assert!(i.state == VehicleState::NoRoute || i.stranded, "trip {trip} recovered with all bridges closed");
                assert_eq!(i.no_route_retries as u64, age / NO_ROUTE_RETRY_TICKS, "trip {trip} retries at age {age}");
                if let Some(l) = link {
                    assert_eq!(i.state, VehicleState::OnLink(l), "stranded trip {trip} left its link");
                    assert!(w.link_vehicles(l).iter().any(|v| v.trip_id == trip));
                }
            } else if age == removal_after {
                assert!(!live.contains_key(&trip), "trip {trip} not removed at age {age}");
                removed_seen += 1;
            } else {
                assert!(!live.contains_key(&trip));
            }
        }
        assert_eq!(w.metrics().removed_unreachable, removed_seen);
        let m = w.metrics();
        assert_eq!(m.unreachable, m.no_route + m.stranded + m.removed_unreachable);
    }
    // And removed trips were never completed, and both kinds occurred
    let completed: BTreeSet<u64> = w.completed_log()[completed_before..].iter().map(|c| c.trip_id).collect();
    assert!(tracked.keys().all(|t| !completed.contains(t)));
    assert!(removed_seen > 50, "only {removed_seen} removals");
    assert!(saw_stranded && saw_noroute, "stranded {saw_stranded}, noroute {saw_noroute}");
}

// ─── 7 ────────────────────────────────────────────────────────────────────
#[test]
fn reopen_restores_access() {
    let c = city();
    let lm = c.landmarks;
    let all = [lm.north_bridge, lm.central_bridge, lm.south_bridge];
    // Given all bridges closing at T and reopening 240 s later (before any removal)
    let mut w = world(&c);
    for b in all {
        for l in b {
            w.schedule(close(l, T)).unwrap();
            w.schedule(open(l, T + 480)).unwrap();
        }
    }
    let mut unreachable_trips: BTreeSet<u64> = BTreeSet::new();
    for _ in 0..T + 480 + 3600 {
        step_checked(&mut w);
        for i in infos(&w) {
            if i.state == VehicleState::NoRoute || i.stranded {
                unreachable_trips.insert(i.trip_id);
            }
        }
    }
    // Then the stuck vehicles resumed and completed, none removed
    assert!(unreachable_trips.len() > 50, "premise: {} unreachable", unreachable_trips.len());
    assert_eq!(w.metrics().removed_unreachable, 0);
    let completed: BTreeSet<u64> = w.completed_log().iter().map(|c| c.trip_id).collect();
    let done = unreachable_trips.iter().filter(|t| completed.contains(t)).count();
    assert!(done as f64 >= 0.95 * unreachable_trips.len() as f64, "{done}/{}", unreachable_trips.len());
    assert!(infos(&w).iter().all(|i| i.state != VehicleState::NoRoute && !i.stranded));

    // Given a single central closure from T, reopened 10 min later
    let central = lm.central_bridge;
    let mut w = world(&c);
    for l in central {
        w.schedule(close(l, T)).unwrap();
        w.schedule(open(l, T + 1200)).unwrap();
    }
    let mut marks = Vec::new();
    for t in 0..T + 1200 + 3000 {
        step_checked(&mut w);
        if [T + 600, T + 1200, T + 1200 + 600, T + 1200 + 3000 - 1].contains(&t) {
            marks.push(w.link_exit_count(central[0]));
        }
    }
    // Then nothing crosses while it is closed (after the stragglers left) and traffic returns after
    assert_eq!(marks[1] - marks[0], 0, "central bridge used while closed");
    assert!(marks[3] - marks[2] > 100, "central bridge not used after reopening: {}", marks[3] - marks[2]);
}

// ─── 8 ────────────────────────────────────────────────────────────────────
#[test]
fn reroute_budget_respected() {
    // Given 3000 vehicles waiting at a zone, all routed over road A
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let k = b.node(500.0, 600.0);
    let d = b.node(1000.0, 0.0);
    let zj = b.link(z, j, 11.1, 2);
    let a = b.link(j, d, 13.9, 2);
    let b1 = b.link(j, k, 13.9, 1);
    let b2 = b.link(k, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..3000 {
        w.spawn_with_route(vec![zj, a]).unwrap();
    }
    w.schedule(close(a, 10)).unwrap();
    for _ in 0..10 {
        step_checked(&mut w);
    }
    let uses_a = |w: &World| infos(w).iter().filter(|i| remaining(i).contains(&a)).count();
    assert!(uses_a(&w) > 2900);
    let mut budget_ticks = 0;
    let mut prev_total = w.reroute_stats().budgeted_total;
    // When road A closes
    for t in 10..40u64 {
        step_checked(&mut w);
        let s = w.reroute_stats();
        if s.budgeted_total > prev_total {
            budget_ticks += 1;
        }
        prev_total = s.budgeted_total;
        if t == 15 {
            // Then the backlog is still being worked off, not done in one tick
            assert!(uses_a(&w) > 1000, "rerouted too fast: {}", uses_a(&w));
        }
    }
    // And the budget was respected and saturated, and the backlog drained
    let s = w.reroute_stats();
    assert!(s.max_budgeted_in_a_tick <= REROUTE_BUDGET_PER_TICK);
    assert_eq!(s.max_budgeted_in_a_tick, REROUTE_BUDGET_PER_TICK);
    assert!(budget_ticks >= 15, "backlog drained over only {budget_ticks} ticks");
    assert_eq!(uses_a(&w), 0);
    assert!(infos(&w).iter().filter(|i| i.state == VehicleState::WaitingAtOrigin).all(|i| i.route == vec![zj, b1, b2]));
}

// ─── 9 ────────────────────────────────────────────────────────────────────
#[test]
fn hysteresis_limits_route_switching() {
    // Given two near-equal parallel 1-lane roads and demand above one road's capacity
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let n = b.node(500.0, 200.0);
    let s = b.node(500.0, -200.0);
    let d = b.node(1000.0, 0.0);
    let dz = b.zone(1150.0, 0.0);
    b.link(z, j, 11.1, 3);
    b.link(j, n, 13.9, 1);
    b.link(n, d, 13.9, 1);
    b.link(j, s, 13.0, 1);
    b.link(s, d, 13.0, 1);
    b.link(d, dz, 13.9, 3);
    let network = b.build().unwrap();
    let demand = DemandModel { flows: vec![OdFlow { origin: z, dest: dz, veh_per_hour: 2400.0 }], profile: Profile::default() };
    let mut w = World::from_scenario(Scenario { network, demand, demand_seed: 8, behavior_seed: 9 }).unwrap();
    let mut switches: BTreeMap<u64, u32> = BTreeMap::new();
    // When an hour passes
    for _ in 0..7200 {
        step_checked(&mut w);
        for i in infos(&w) {
            switches.insert(i.trip_id, i.route_switches);
        }
    }
    // Then few vehicles switch, and none flap
    let trips = w.generated_trips().len();
    assert!(trips > 2000);
    let at_most_one = switches.values().filter(|&&k| k <= 1).count();
    assert!(at_most_one as f64 >= 0.95 * switches.len() as f64, "{at_most_one}/{}", switches.len());
    let total = w.reroute_stats().switches_total;
    assert!((total as f64) <= 0.10 * trips as f64, "{total} switches for {trips} trips");
    // (premise: both roads were used)
    let net = w.network();
    let used: Vec<u64> = net.out_links(j).iter().map(|&l| w.link_exit_count(l)).collect();
    assert!(used.iter().all(|&e| e > 300), "one road unused: {used:?}");
}

// ─── 10 ───────────────────────────────────────────────────────────────────
#[test]
fn commands_take_effect_at_their_tick() {
    let c = city();
    let l = c.landmarks.central_bridge[0];
    let mut with = world(&c);
    let mut without = world(&c);
    with.schedule(close(l, T)).unwrap();
    let all_links: Vec<LinkId> = c.scenario.network.links().iter().map(|k| k.id).collect();
    for t in 0..=T {
        step_checked(&mut with);
        step_checked(&mut without);
        if t < T {
            // Then until tick T−1 everything observable is identical
            for &k in &all_links {
                assert_eq!(with.link_vehicles(k), without.link_vehicles(k), "tick {t} link {k:?}");
                assert_eq!(with.link_cost(k), without.link_cost(k));
            }
            assert_eq!(with.metrics(), without.metrics());
            assert!(with.closed_links().is_empty());
        }
    }
    // And at T the link is closed and the states diverge
    assert_eq!(with.closed_links(), vec![l]);
    assert!(!without.is_closed(l));
    assert_ne!(with.state_hash(), without.state_hash());

    // And invalid commands are rejected
    assert_eq!(with.schedule(close(l, T)), Err(CommandError::InPast));
    assert_eq!(with.schedule(close(LinkId(9999), T + 5)), Err(CommandError::UnknownLink(LinkId(9999))));
    // And the log keeps acceptance order; same-tick commands apply in that order
    let x = c.landmarks.north_bridge[0];
    let now = with.tick();
    with.schedule(open(x, now + 10)).unwrap();
    with.schedule(close(x, now + 5)).unwrap();
    with.schedule(close(x, now + 20)).unwrap();
    with.schedule(open(x, now + 20)).unwrap();
    let log = with.command_log();
    assert_eq!(log[0], close(l, T));
    assert_eq!(&log[1..], &[open(x, now + 10), close(x, now + 5), close(x, now + 20), open(x, now + 20)]);
    for _ in 0..6 {
        step_checked(&mut with);
    }
    assert!(with.is_closed(x));
    for _ in 0..5 {
        step_checked(&mut with);
    }
    assert!(!with.is_closed(x));
    for _ in 0..10 {
        step_checked(&mut with);
    }
    assert!(!with.is_closed(x), "close-then-open at the same tick must end open");
}

// ─── 11 ───────────────────────────────────────────────────────────────────
#[test]
fn same_seed_and_commands_give_identical_state() {
    // Given two worlds from the same scenario and command log
    let c = city();
    let b = c.landmarks.central_bridge;
    let mut w1 = world(&c);
    let mut w2 = world(&c);
    for w in [&mut w1, &mut w2] {
        for l in b {
            w.schedule(close(l, 1200)).unwrap();
            w.schedule(open(l, 3600)).unwrap();
        }
    }
    assert_eq!(w1.state_hash(), w2.state_hash());
    // When both run 2 h, Then their state hashes agree at every tick
    for t in 0..14_400u64 {
        w1.step();
        w2.step();
        assert_eq!(w1.state_hash(), w2.state_hash(), "diverged at tick {t}");
    }
    assert!(w1.metrics().completed > 1000);
}

// ─── 12 ───────────────────────────────────────────────────────────────────
#[test]
fn intervention_does_not_change_demand() {
    // Given the same scenario with and without closing the central bridge
    let c = city();
    let mut with = world(&c);
    let mut without = world(&c);
    for l in c.landmarks.central_bridge {
        with.schedule(close(l, T)).unwrap();
    }
    for _ in 0..3 * T {
        step_checked(&mut with);
        step_checked(&mut without);
    }
    // Then demand, including trip ids, is identical
    assert_eq!(with.generated_trips(), without.generated_trips());
    // And yet the worlds differ
    assert_ne!(with.state_hash(), without.state_hash());
    assert_ne!(with.metrics(), without.metrics());
}

// ─── 13 ───────────────────────────────────────────────────────────────────
#[test]
/// Never closes zone connectors (premise independent of link-id layout).
fn conservation_under_random_closure_stress() {
    let c = city();
    let net = c.scenario.network.clone();
    let candidates: Vec<LinkId> =
        net.links().iter().filter(|l| !net.is_zone(l.from) && !net.is_zone(l.to)).map(|l| l.id).collect();
    let mut w = world(&c);
    let mut x = 0x00C0_FFEE_u64;
    for _ in 0..50 {
        x = splitmix64(x);
        let tick = x % 7200;
        x = splitmix64(x);
        let l = candidates[(x % candidates.len() as u64) as usize];
        x = splitmix64(x);
        let cmd = if unit_f64(x) < 0.6 { close(l, tick) } else { open(l, tick) };
        w.schedule(cmd).unwrap();
    }
    let mut max_stranded = 0;
    for _ in 0..7200 {
        step_checked(&mut w);
        let m = w.metrics();
        assert_eq!(m.unreachable, m.no_route + m.stranded + m.removed_unreachable);
        assert_eq!(m.spawned, m.active + m.completed + m.removed_unreachable);
        max_stranded = max_stranded.max(m.stranded);
    }
    let m = w.metrics();
    // (premise: traffic kept flowing, and the stress reached stranded vehicles and removals)
    assert!(m.completed > 500, "{m:?}");
    assert!(max_stranded > 0 && m.removed_unreachable > 0, "stress too mild: {m:?}");
}

// ─── 14 ───────────────────────────────────────────────────────────────────
#[test]
fn clone_continues_identically() {
    // Given a world with pending future commands, cloned mid-run
    let c = city();
    let mut w = world(&c);
    for l in c.landmarks.central_bridge {
        w.schedule(close(l, 2400)).unwrap();
        w.schedule(open(l, 3000)).unwrap();
    }
    for _ in 0..1800 {
        w.step();
    }
    let mut copy = w.clone();
    assert_eq!(copy.state_hash(), w.state_hash());
    // When both continue 30 min, Then they agree every tick
    for t in 0..3600 {
        w.step();
        copy.step();
        assert_eq!(copy.state_hash(), w.state_hash(), "clone diverged after {t} ticks");
    }
    assert_eq!(copy.command_log(), w.command_log());
}

// ─── 15 ───────────────────────────────────────────────────────────────────
#[test]
fn state_hash_covers_state() {
    let c = city();
    // Given independently built identical worlds, Then their hashes agree
    let (mut a, mut b) = (world(&c), world(&c));
    assert_eq!(a.state_hash(), b.state_hash());
    for _ in 0..100 {
        a.step();
        b.step();
    }
    assert_eq!(a.state_hash(), b.state_hash());

    // When only the behavior seed differs (before any draw), Then the hashes differ
    let other = three_bridges(17, 24);
    assert_ne!(world(&c).state_hash(), world(&other).state_hash());

    // When only a pending future command differs
    let mut p = world(&c);
    p.schedule(close(c.landmarks.north_bridge[0], 99_999)).unwrap();
    assert_ne!(p.state_hash(), world(&c).state_hash());

    // When only an unused link's closed state differs (no demand at all)
    let net = c.scenario.network.clone();
    let mut e1 = World::new(net.clone());
    let mut e2 = World::new(net);
    e1.schedule(close(c.landmarks.south_bridge[1], 0)).unwrap();
    e2.schedule(open(c.landmarks.south_bridge[1], 0)).unwrap();
    e1.step();
    e2.step();
    assert!(e1.is_closed(c.landmarks.south_bridge[1]) && !e2.is_closed(c.landmarks.south_bridge[1]));
    assert_ne!(e1.state_hash(), e2.state_hash());

    // When one world is a single tick ahead
    let mut ahead = a.clone();
    ahead.step();
    assert_ne!(ahead.state_hash(), a.state_hash());
}

// ─── 16 ───────────────────────────────────────────────────────────────────
#[test]
fn stranded_vehicle_semantics() {
    // Given z ⇒ j ─L1(300 m)→ a ─L2(300 m)→ d, where L2 is the only way on
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let a = b.node(300.0, 0.0);
    let d = b.node(600.0, 0.0);
    let zj = b.link(z, j, 11.1, 1);
    let l1 = b.link(j, a, 13.9, 1);
    let l2 = b.link(a, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..12 {
        w.spawn_with_route(vec![zj, l1, l2]).unwrap();
    }
    for _ in 0..80 {
        step_checked(&mut w);
    }
    assert!(w.link_count(l1) >= 3, "premise: vehicles on L1");
    // When L2 closes at tick 80 and reopens at tick 80 + 90
    let close_tick = w.tick();
    w.schedule(close(l2, close_tick)).unwrap();
    w.schedule(open(l2, close_tick + 90)).unwrap();
    step_checked(&mut w);
    let exits_l1 = w.link_exit_count(l1);
    // Then every vehicle on the connector or L1 (its only way on is L2) is stranded where it is
    let stranded: Vec<VehicleInfo> = infos(&w).into_iter().filter(|i| i.stranded).collect();
    assert_eq!(stranded.len() as u32, w.link_count(zj) + w.link_count(l1));
    for i in &stranded {
        assert!(i.state == VehicleState::OnLink(l1) || i.state == VehicleState::OnLink(zj), "{:?}", i.state);
    }
    let m = w.metrics();
    assert_eq!(m.stranded, stranded.len() as u64);
    assert_eq!(m.unreachable, m.no_route + m.stranded);
    assert_eq!(m.on_network, w.link_count(zj) as u64 + w.link_count(l1) as u64 + w.link_count(l2) as u64);
    // And while stranded the front stops at the stop line and nobody leaves L1
    for _ in 0..80 {
        step_checked(&mut w);
        assert_eq!(w.link_exit_count(l1), exits_l1, "a stranded vehicle crossed");
        assert!(infos(&w)
            .iter()
            .filter(|i| matches!(i.state, VehicleState::OnLink(l) if l == l1 || l == zj))
            .all(|i| i.stranded));
    }
    let front = w.link_vehicles(l1)[0];
    assert_eq!((front.s, front.v), (w.network().link(l1).length_m, 0.0));
    // And after reopening they resume on the first retry (close + 120) and complete
    while w.tick() <= close_tick + 120 {
        step_checked(&mut w);
    }
    assert!(infos(&w).iter().all(|i| !i.stranded), "not resumed on the first retry after reopening");
    for _ in 0..600 {
        step_checked(&mut w);
    }
    assert_eq!(w.metrics().completed, 12);
    assert_eq!(w.metrics().removed_unreachable, 0);
}

// ─── 17–26 ────────────────────────────────────────────────────────────────
// Proposed and verified against an independent reference by the core-003
// Red reviewer, round 1.

/// z ⇒ j (zj, 150 m) and y ⇒ j (yj, 150 m); j → d directly over A, or j → k → d over B1, B2.
fn backlog_net() -> (sim_core::Network, [LinkId; 5]) {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let y = b.zone(0.0, -150.0);
    let j = b.node(0.0, 0.0);
    let k = b.node(500.0, 600.0);
    let d = b.node(1000.0, 0.0);
    let zj = b.link(z, j, 11.1, 1);
    let yj = b.link(y, j, 11.1, 1);
    let a = b.link(j, d, 13.9, 2);
    let b1 = b.link(j, k, 13.9, 1);
    let b2 = b.link(k, d, 13.9, 1);
    (b.build().unwrap(), [zj, yj, a, b1, b2])
}

// ─── 17 ──────────────────────────────────────────────────────────────────
#[test]
fn backlog_forced_decision_never_enters_closed_link() {
    let (net, [zj, yj, a, b1, _b2]) = backlog_net();
    let mut w = World::new(net);
    // 3000 backlog vehicles first (low slots, processed first) ...
    for _ in 0..3000 {
        w.spawn_with_route(vec![yj, a]).unwrap();
    }
    // ... then 10 vehicles from z (high slots: their priority turn comes 15 ticks after the closure)
    let zs: Vec<_> = (0..10).map(|_| w.spawn_with_route(vec![zj, a]).unwrap()).collect();
    let close_tick = 25;
    w.schedule(close(a, close_tick)).unwrap();
    for _ in 0..close_tick {
        step_checked(&mut w);
    }
    assert_eq!(w.link_count(a), 0, "premise: nobody on A at closure");
    let z_trip0 = w.vehicle(zs[0]).unwrap().trip_id;
    // When the backlog is worked off (3010 entries / 200 per tick ⇒ the z vehicles' turn is tick close+15)
    let mut first_z_on_b1: Option<u64> = None;
    for _ in 0..40 {
        step_checked(&mut w);
        // Then nobody ever enters the closed link
        assert_eq!(w.link_count(a), 0, "a vehicle entered closed A at tick {}", w.tick() - 1);
        if first_z_on_b1.is_none() && w.link_vehicles(b1).iter().any(|v| v.trip_id == z_trip0) {
            first_z_on_b1 = Some(w.tick() - 1);
        }
    }
    // And the first z vehicle, which reaches the stop line before its priority turn, was forced onto B
    let s = w.reroute_stats();
    assert!(s.forced_total >= 1, "no forced decision: {s:?}");
    let t = first_z_on_b1.expect("z vehicle reached B1");
    assert!(t < close_tick + 15, "waited at the closed stop line until its priority pass (tick {t})");
    // (exact under the contract; independent reference: tick 33)
    assert_eq!(t, 33);
    assert!(s.max_budgeted_in_a_tick <= REROUTE_BUDGET_PER_TICK);
}

// ─── 18 ──────────────────────────────────────────────────────────────────
#[test]
fn admission_refuses_closed_first_link_under_backlog() {
    let (net, [zj, yj, a, _b1, _b2]) = backlog_net();
    let mut w = World::new(net);
    for _ in 0..2000 {
        w.spawn_with_route(vec![yj, a]).unwrap();
    }
    for _ in 0..50 {
        w.spawn_with_route(vec![zj, a]).unwrap();
    }
    // Close A (2050 priority entries in slot order: the z vehicles' turn is tick 10) and the z
    // connector, before anybody left z
    w.schedule(close(a, 0)).unwrap();
    w.schedule(close(zj, 0)).unwrap();
    for _ in 0..30 {
        step_checked(&mut w);
        // Then no z vehicle is ever admitted onto the closed connector
        assert_eq!(w.link_count(zj), 0, "admitted onto closed zj at tick {}", w.tick() - 1);
    }
    // And once their turn came they are NoRoute (z has no other way out)
    let m = w.metrics();
    assert_eq!(m.no_route, 50, "{m:?}");
}

// ─── 19 ──────────────────────────────────────────────────────────────────
#[test]
fn removal_is_not_an_exit() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let a = b.node(300.0, 0.0);
    let d = b.node(600.0, 0.0);
    let zj = b.link(z, j, 11.1, 1);
    let l1 = b.link(j, a, 13.9, 1);
    let l2 = b.link(a, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..12 {
        w.spawn_with_route(vec![zj, l1, l2]).unwrap();
    }
    for _ in 0..80 {
        step_checked(&mut w);
    }
    w.schedule(close(l2, w.tick())).unwrap();
    step_checked(&mut w);
    let stuck = w.metrics().stranded + w.metrics().no_route;
    assert!(w.metrics().stranded >= 3, "premise");
    let exits = (w.link_exit_count(zj), w.link_exit_count(l1));
    for _ in 0..700 {
        step_checked(&mut w);
        assert_eq!((w.link_exit_count(zj), w.link_exit_count(l1)), exits, "a removal counted as an exit");
    }
    let m = w.metrics();
    assert_eq!(m.removed_unreachable, stuck);
    assert_eq!(m.stranded + m.no_route + m.active, 0);
}

// ─── 20 ──────────────────────────────────────────────────────────────────
#[test]
fn state_hash_covers_vehicle_state() {
    let (net, [zj, yj, a, b1, b2]) = backlog_net();
    let mut p = World::new(net.clone());
    let mut q = World::new(net);
    // Same log, tick and seeds; only the vehicles' routes differ
    p.spawn_with_route(vec![zj, a]).unwrap();
    q.spawn_with_route(vec![zj, b1, b2]).unwrap();
    assert_ne!(p.state_hash(), q.state_hash(), "route not hashed");
    // Same vehicles, different slot assignment
    let (net2, _) = backlog_net();
    let mut r = World::new(net2.clone());
    let mut s = World::new(net2);
    r.spawn_with_route(vec![zj, a]).unwrap();
    r.spawn_with_route(vec![yj, a]).unwrap();
    s.spawn_with_route(vec![yj, a]).unwrap();
    s.spawn_with_route(vec![zj, a]).unwrap();
    for _ in 0..20 {
        r.step();
        s.step();
        p.step();
        q.step();
        assert_ne!(r.state_hash(), s.state_hash());
        assert_ne!(p.state_hash(), q.state_hash());
    }
}

// ─── 21 ──────────────────────────────────────────────────────────────────
#[test]
fn same_seed_and_commands_give_identical_observables() {
    let c = city();
    let b = c.landmarks.central_bridge;
    let mut w1 = world(&c);
    let mut w2 = world(&c);
    for w in [&mut w1, &mut w2] {
        for l in b {
            w.schedule(close(l, 1200)).unwrap();
            w.schedule(open(l, 3600)).unwrap();
        }
    }
    let links: Vec<LinkId> = c.scenario.network.links().iter().map(|l| l.id).collect();
    for t in 0..5400u64 {
        w1.step();
        w2.step();
        if t % 300 == 0 {
            assert_eq!(w1.metrics(), w2.metrics(), "tick {t}");
            assert_eq!(w1.reroute_stats(), w2.reroute_stats(), "tick {t}");
            assert_eq!(infos(&w1), infos(&w2), "tick {t}");
            for &l in &links {
                assert_eq!(w1.link_vehicles(l), w2.link_vehicles(l), "tick {t}");
                assert_eq!(w1.link_cost(l), w2.link_cost(l));
            }
        }
    }
}

// ─── 22 ──────────────────────────────────────────────────────────────────
#[test]
fn reopen_off_epoch_is_routable_immediately() {
    let c = city();
    let lm = c.landmarks;
    let reopen = T + 510; // 1710: not a multiple of COST_EPOCH_TICKS
    let mut w = world(&c);
    for bdg in [lm.north_bridge, lm.central_bridge, lm.south_bridge] {
        for l in bdg {
            w.schedule(close(l, T)).unwrap();
            w.schedule(open(l, reopen)).unwrap();
        }
    }
    for _ in 0..reopen + 120 {
        step_checked(&mut w);
        if w.tick() > reopen {
            for i in infos(&w) {
                if i.created_tick >= reopen {
                    assert!(i.state != VehicleState::NoRoute, "trip {} spawned after reopening is NoRoute", i.trip_id);
                }
            }
        }
    }
    assert_eq!(w.metrics().removed_unreachable, 0);
}

// ─── 23 ──────────────────────────────────────────────────────────────────
#[test]
fn same_tick_open_then_close_ends_closed() {
    let c = city();
    let x = c.landmarks.north_bridge[0];
    let mut w = world(&c);
    w.schedule(open(x, 3)).unwrap();
    w.schedule(close(x, 3)).unwrap();
    for _ in 0..4 {
        step_checked(&mut w);
    }
    assert!(w.is_closed(x), "open-then-close at the same tick must end closed");
}

// ─── 24 ──────────────────────────────────────────────────────────────────
#[test]
fn stranded_not_resumed_before_retry() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let a = b.node(300.0, 0.0);
    let d = b.node(600.0, 0.0);
    let zj = b.link(z, j, 11.1, 1);
    let l1 = b.link(j, a, 13.9, 1);
    let l2 = b.link(a, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..12 {
        w.spawn_with_route(vec![zj, l1, l2]).unwrap();
    }
    for _ in 0..80 {
        step_checked(&mut w);
    }
    let ct = w.tick();
    w.schedule(close(l2, ct)).unwrap();
    w.schedule(open(l2, ct + 90)).unwrap();
    step_checked(&mut w);
    let forced0 = w.reroute_stats().forced_total;
    let n = w.metrics().stranded;
    while w.tick() < ct + 120 {
        step_checked(&mut w);
    }
    // after step ct+119: reopened 30 ticks ago, but the retry is due at ct+120
    assert_eq!(w.metrics().stranded, n, "resumed before the scheduled retry");
    assert_eq!(w.reroute_stats().forced_total, forced0, "stranded fronts must not take forced decisions");
    step_checked(&mut w);
    assert_eq!(w.metrics().stranded, 0);
}

// ─── 25 ──────────────────────────────────────────────────────────────────
#[test]
fn periodic_reconsideration_switches_when_clearly_better() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let k = b.node(500.0, 600.0);
    let d = b.node(1000.0, 0.0);
    let zj = b.link(z, j, 11.1, 2);
    let a = b.link(j, d, 13.9, 2);
    let b1 = b.link(j, k, 13.9, 1);
    let b2 = b.link(k, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..300 {
        w.spawn_with_route(vec![zj, b1, b2]).unwrap();
    }
    for _ in 0..240 {
        step_checked(&mut w);
    }
    // Then everyone still waiting was offered (and took) the clearly better route exactly once
    let waiting: Vec<VehicleInfo> =
        infos(&w).into_iter().filter(|i| i.state == VehicleState::WaitingAtOrigin).collect();
    assert!(waiting.len() > 100, "premise: {} still waiting", waiting.len());
    for i in &waiting {
        assert_eq!(i.route, vec![zj, a], "trip {} kept the slow route", i.trip_id);
        assert_eq!(i.route_switches, 1);
    }
    assert!(w.reroute_stats().switches_total >= waiting.len() as u64);
}

// ─── 26 ──────────────────────────────────────────────────────────────────
#[test]
fn priority_drains_exactly_at_budget() {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let k = b.node(500.0, 600.0);
    let d = b.node(1000.0, 0.0);
    let zj = b.link(z, j, 11.1, 2);
    let a = b.link(j, d, 13.9, 2);
    b.link(j, k, 13.9, 1);
    b.link(k, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..3000 {
        w.spawn_with_route(vec![zj, a]).unwrap();
    }
    w.schedule(close(a, 10)).unwrap();
    for _ in 0..10 {
        step_checked(&mut w);
    }
    let uses_a = |w: &World| infos(w).iter().filter(|i| remaining(i).contains(&a)).count();
    let n0 = uses_a(&w);
    for t in 10..25u64 {
        step_checked(&mut w);
        let expect = n0.saturating_sub(REROUTE_BUDGET_PER_TICK as usize * (t - 9) as usize);
        assert_eq!(uses_a(&w), expect, "tick {t}");
    }
}

// ─── 27–30 ────────────────────────────────────────────────────────────────
// Proposed and verified against an independent reference by the core-003
// Red reviewer, round 2. Append to core_003_closures.rs (uses its helpers).

/// zone z ─L0 (3000 m)→ p ─pj→ j, then j → m over A (direct) or B1, B2 (via k), then m ─Q→ d.
/// Returns (network, [l0, pj, a, b1, b2, q]).
fn split_net(a_len: f64, b_dy: f64, q_len: f64) -> (sim_core::Network, [LinkId; 6]) {
    let mut b = NetworkBuilder::new();
    let z = b.zone(-3150.0, 0.0);
    let p = b.node(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let k = b.node(a_len / 2.0, b_dy);
    let m = b.node(a_len, 0.0);
    let d = b.node(a_len + q_len, 0.0);
    let l0 = b.link(z, p, 11.1, 2);
    let pj = b.link(p, j, 11.1, 2);
    let a = b.link(j, m, 13.9, 2);
    let b1 = b.link(j, k, 13.9, 1);
    let b2 = b.link(k, m, 13.9, 1);
    let q = b.link(m, d, 11.1, 1);
    (b.build().unwrap(), [l0, pj, a, b1, b2, q])
}

// ─── 27 ──────────────────────────────────────────────────────────────────
#[test]
fn periodic_reconsideration_reaches_vehicles_on_links() {
    // Given 20 vehicles driving on L0 (270 s long) with routes over the slow B branch,
    // while A is clearly better (A ≈ 73 s vs B ≈ 116 s, Q short)
    let (net, [l0, pj, a, b1, b2, q]) = split_net(1000.0, 600.0, 100.0);
    let mut w = World::new(net);
    let ids: Vec<_> = (0..20).map(|_| w.spawn_with_route(vec![l0, pj, b1, b2, q]).unwrap()).collect();
    // When their periodic due ticks ((t + trip_id) % 240 == 0, i.e. 240 − trip_id, or 0 and 240 for trip 0) pass while they are on L0
    for _ in 0..260 {
        step_checked(&mut w);
    }
    // Then every one of them switched once, from L0's end, keeping L0 and pj
    for id in ids {
        let i = w.vehicle(id).unwrap();
        assert_eq!(i.state, VehicleState::OnLink(l0), "premise: still on L0");
        assert_eq!(i.route, vec![l0, pj, a, q], "trip {} not reconsidered en route", i.trip_id);
        assert_eq!(i.route_switches, 1);
    }
}

// ─── 28 ──────────────────────────────────────────────────────────────────
#[test]
fn shortest_route_respects_closures() {
    let c = city();
    let lm = c.landmarks;
    let (west, east) = (c.zones[1].node, c.zones[4].node); // Old Town → Harbor Works
    let mut w = world(&c);
    // Given the open city, the best Old Town → Harbor Works route uses the central bridge
    let (r0, _) = w.shortest_route(west, east).unwrap();
    assert!(r0.contains(&lm.central_bridge[0]));
    // When the central bridge closes, Then the route avoids it
    w.schedule(close(lm.central_bridge[0], 0)).unwrap();
    step_checked(&mut w);
    let (r1, _) = w.shortest_route(west, east).unwrap();
    assert!(!r1.contains(&lm.central_bridge[0]), "shortest_route ignores the closure: {r1:?}");
    // When every west→east bridge link is closed, Then there is no route
    let now = w.tick();
    w.schedule(close(lm.north_bridge[0], now)).unwrap();
    w.schedule(close(lm.south_bridge[0], now)).unwrap();
    step_checked(&mut w);
    assert!(w.shortest_route(west, east).is_none());
    // And the other direction is unaffected
    assert!(w.shortest_route(east, west).is_some());
}

// ─── 29 ──────────────────────────────────────────────────────────────────
#[test]
fn hysteresis_requires_both_conditions() {
    // Case 1: saves ≥ 20 s but new ≥ 0.85 × current (a long common tail Q after the split):
    // current ≈ 116.4 + 272.3, new ≈ 72.9 + 272.3 → ratio ≈ 0.89, gain ≈ 43 s ⇒ no switch
    // Case 2: ratio < 0.85 but saves < 20 s (a short split):
    // current ≈ 22.0 + 11.0, new ≈ 11.8 + 11.0 → ratio ≈ 0.69, gain ≈ 10 s ⇒ no switch
    for (a_len, b_dy, q_len) in [(1000.0, 600.0, 3000.0), (150.0, 100.0, 100.0)] {
        let (net, [l0, pj, _a, b1, b2, q]) = split_net(a_len, b_dy, q_len);
        let mut w = World::new(net);
        let ids: Vec<_> = (0..20).map(|_| w.spawn_with_route(vec![l0, pj, b1, b2, q]).unwrap()).collect();
        for _ in 0..260 {
            step_checked(&mut w);
        }
        for id in ids {
            let i = w.vehicle(id).unwrap();
            assert_eq!(i.state, VehicleState::OnLink(l0), "premise: still on L0");
            assert_eq!(i.route, vec![l0, pj, b1, b2, q], "case {a_len}: switched with only one condition met");
            assert_eq!(i.route_switches, 0);
        }
        assert_eq!(w.reroute_stats().switches_total, 0);
        assert!(w.reroute_stats().budgeted_total >= 20, "premise: all were reconsidered");
    }
}

// ─── 30 ──────────────────────────────────────────────────────────────────
#[test]
fn retry_stats_count_attempts_outside_the_budget() {
    // Given the test-16 corridor: L2 closes at ct and reopens at ct + 90
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let a = b.node(300.0, 0.0);
    let d = b.node(600.0, 0.0);
    let zj = b.link(z, j, 11.1, 1);
    let l1 = b.link(j, a, 13.9, 1);
    let l2 = b.link(a, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..12 {
        w.spawn_with_route(vec![zj, l1, l2]).unwrap();
    }
    for _ in 0..80 {
        step_checked(&mut w);
    }
    let ct = w.tick();
    w.schedule(close(l2, ct)).unwrap();
    w.schedule(open(l2, ct + 90)).unwrap();
    step_checked(&mut w);
    let n = w.metrics().stranded + w.metrics().no_route;
    assert!(n >= 3, "premise");
    while w.tick() < ct + 120 {
        step_checked(&mut w);
    }
    let before = w.reroute_stats();
    // When the successful retry happens (ct + 120; no periodic reroute is due at that tick)
    step_checked(&mut w);
    let after = w.reroute_stats();
    // Then retries_total counts attempts (failed at ct + 60, successful at ct + 120) ...
    assert_eq!(before.retries_total, n);
    assert_eq!(after.retries_total, 2 * n, "retries_total must count successful attempts too");
    // ... and retries spend no budget
    assert_eq!(after.budgeted_total, before.budgeted_total, "retries consumed reroute budget");
    assert_eq!(w.metrics().stranded + w.metrics().no_route, 0);
}


// ─── 31–32 ────────────────────────────────────────────────────────────────
// Proposed and verified against an independent reference by the core-003
// Red reviewer, round 3. Append to core_003_closures.rs (uses its helpers,
// including `split_net` from tests 27–30).

// ─── 31 ──────────────────────────────────────────────────────────────────
#[test]
fn reopen_is_picked_up_by_staggered_periodic_reconsideration() {
    // Given 20 vehicles driving on L0 (270 s long) towards the split, A clearly better than B
    let (net, [l0, pj, a, b1, b2, q]) = split_net(1000.0, 600.0, 100.0);
    let mut w = World::new(net);
    let ids: Vec<_> = (0..20).map(|_| w.spawn_with_route(vec![l0, pj, a, q]).unwrap()).collect();
    while w.vehicle_ids().iter().any(|&id| w.vehicle(id).unwrap().state == VehicleState::WaitingAtOrigin) {
        step_checked(&mut w);
    }
    assert!(w.tick() <= 50, "premise: admitted by tick 50 (tick {})", w.tick());
    // When A closes at tick 50 (priority reroute onto B) and reopens at tick 60
    w.schedule(close(a, 50)).unwrap();
    w.schedule(open(a, 60)).unwrap();
    let mut back_on_a: Vec<Option<u64>> = vec![None; ids.len()];
    let mut budgeted_before_open = 0;
    while w.tick() < 262 {
        let t = w.tick();
        if t == 60 {
            budgeted_before_open = w.reroute_stats().budgeted_total;
        }
        step_checked(&mut w);
        if t == 60 {
            // Then the reopening itself forces nothing: no reroute, no switch, no budget
            assert_eq!(w.reroute_stats().budgeted_total, budgeted_before_open, "OpenLink forced reroutes");
            assert_eq!(w.reroute_stats().switches_total, 20);
        }
        for (k, &id) in ids.iter().enumerate() {
            let i = w.vehicle(id).unwrap();
            assert_eq!(i.state, VehicleState::OnLink(l0), "premise: still on L0");
            if t == 55 {
                assert_eq!(i.route, vec![l0, pj, b1, b2, q], "premise: priority reroute onto B");
            }
            if i.route == vec![l0, pj, a, q] && t > 50 && back_on_a[k].is_none() {
                back_on_a[k] = Some(t);
            }
        }
    }
    // And each vehicle returns to A exactly at its own staggered due tick (t + trip_id) % 240 == 0
    for (k, &id) in ids.iter().enumerate() {
        let i = w.vehicle(id).unwrap();
        let t = back_on_a[k].unwrap_or_else(|| panic!("trip {} never returned to A", i.trip_id));
        assert_eq!((t + i.trip_id) % sim_core::params::REROUTE_PERIOD_TICKS, 0, "trip {} switched at tick {t}", i.trip_id);
        assert!(t > 60, "trip {} switched before the reopening (tick {t})", i.trip_id);
        assert_eq!(i.route_switches, 2);
    }
    // And the returns are spread over distinct ticks (staggered), not one wave
    let distinct: BTreeSet<u64> = back_on_a.iter().map(|t| t.unwrap()).collect();
    assert_eq!(distinct.len(), ids.len());
}

// ─── 32 ──────────────────────────────────────────────────────────────────
#[test]
fn stranded_keeps_route_and_noroute_route_is_empty() {
    // Given the test-16 corridor with 12 vehicles driving and 3 still waiting at the origin
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let a = b.node(300.0, 0.0);
    let d = b.node(600.0, 0.0);
    let zj = b.link(z, j, 11.1, 1);
    let l1 = b.link(j, a, 13.9, 1);
    let l2 = b.link(a, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..12 {
        w.spawn_with_route(vec![zj, l1, l2]).unwrap();
    }
    for _ in 0..80 {
        step_checked(&mut w);
    }
    let late: Vec<_> = (0..3).map(|_| w.spawn_with_route(vec![zj, l1, l2]).unwrap()).collect();
    // When L2 (the only way on) closes now and reopens 90 ticks later
    let ct = w.tick();
    w.schedule(close(l2, ct)).unwrap();
    w.schedule(open(l2, ct + 90)).unwrap();
    step_checked(&mut w);
    // Then stranded vehicles keep their old route, and NoRoute vehicles at the origin have an empty route
    let stranded: Vec<_> = w.vehicle_ids().into_iter().filter(|&id| w.vehicle(id).unwrap().stranded).collect();
    assert!(stranded.len() >= 3, "premise");
    for &id in &stranded {
        let i = w.vehicle(id).unwrap();
        assert_eq!(i.route, vec![zj, l1, l2], "stranded trip {} lost its route", i.trip_id);
    }
    for &id in &late {
        let i = w.vehicle(id).unwrap();
        assert_eq!(i.state, VehicleState::NoRoute);
        assert!(i.route.is_empty(), "NoRoute trip {} has route {:?}", i.trip_id, i.route);
    }
    // And after the successful retry (ct + 120) a switch is counted only where the route vector changed:
    // stranded vehicles resume the same route (0 switches), NoRoute vehicles go from [] to a route (1)
    while w.tick() <= ct + 120 {
        step_checked(&mut w);
    }
    for &id in &stranded {
        let i = w.vehicle(id).unwrap();
        assert!(!i.stranded);
        assert_eq!(i.route, vec![zj, l1, l2]);
        assert_eq!(i.route_switches, 0, "trip {}: unchanged route counted as a switch", i.trip_id);
    }
    for &id in &late {
        let i = w.vehicle(id).unwrap();
        assert!(!matches!(i.state, VehicleState::NoRoute), "not resumed on the successful retry");
        assert_eq!(i.route, vec![zj, l1, l2]);
        assert_eq!(i.route_switches, 1, "trip {}: [] → route not counted", i.trip_id);
    }
    assert_eq!(w.reroute_stats().switches_total, 3);
}



// ─── 33 ──────────────────────────────────────────────────────────────────
// Proposed and verified against an independent reference by the core-003
// Red reviewer, round 4. Append to core_003_closures.rs (uses its helpers).
#[test]
fn retry_count_restarts_for_each_stranding() {
    // Given a corridor with a long L1, vehicles driving on the connector and L1
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let a = b.node(1500.0, 0.0);
    let d = b.node(1800.0, 0.0);
    let zj = b.link(z, j, 11.1, 1);
    let l1 = b.link(j, a, 13.9, 1);
    let l2 = b.link(a, d, 13.9, 1);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..6 {
        w.spawn_with_route(vec![zj, l1, l2]).unwrap();
    }
    for _ in 0..40 {
        step_checked(&mut w);
    }
    // When L2 closes (stranding them), reopens (successful retry at ct + 120), and closes again at ct + 150
    let ct = w.tick();
    w.schedule(close(l2, ct)).unwrap();
    w.schedule(open(l2, ct + 90)).unwrap();
    w.schedule(close(l2, ct + 150)).unwrap();
    let ids = w.vehicle_ids();
    assert_eq!(ids.len(), 6, "premise");
    while w.tick() <= ct + 150 {
        step_checked(&mut w);
        let t = w.tick() - 1;
        for &id in &ids {
            let i = w.vehicle(id).unwrap();
            assert!(!matches!(i.state, VehicleState::OnLink(l) if l == l2), "premise: nobody reaches L2 (tick {t})");
            if t == ct + 60 {
                assert!(i.stranded);
                assert_eq!(i.no_route_retries, 1, "premise: first stranding, one failed retry");
            }
            if t == ct + 120 {
                assert!(!i.stranded, "premise: resumed on the retry after the reopening");
            }
        }
    }
    // Then the second stranding (S = ct + 150) starts a fresh count:
    // retried at S+60 … S+600 and removed exactly after step S+600
    let s = ct + 150;
    for &id in &ids {
        let i = w.vehicle(id).unwrap();
        assert!(i.stranded);
        assert_eq!(i.no_route_retries, 0, "trip {}: retry count carried over from the earlier stranding", i.trip_id);
    }
    while w.tick() < s + 600 {
        step_checked(&mut w);
        let t = w.tick() - 1;
        if t > s && (t - s) % NO_ROUTE_RETRY_TICKS == 0 {
            let k = ((t - s) / NO_ROUTE_RETRY_TICKS) as u32;
            for &id in &ids {
                let i = w.vehicle(id).unwrap_or_else(|| panic!("removed early at tick {t} (after {k} retries)"));
                assert_eq!(i.no_route_retries, k);
            }
        }
    }
    assert_eq!(w.metrics().removed_unreachable, 0);
    step_checked(&mut w);
    assert!(ids.iter().all(|&id| w.vehicle(id).is_none()));
    assert_eq!(w.metrics().removed_unreachable, 6);
    assert_eq!(NO_ROUTE_MAX_RETRIES, 10);
}



// ─── 34 ──────────────────────────────────────────────────────────────────
// Proposed and verified against an independent reference by the core-003
// Red reviewer, round 5. Append to core_003_closures.rs (uses its helpers).
#[test]
fn noroute_retry_count_restarts_and_ignores_unrelated_commands() {
    // Given a corridor with a spur at J, and 16 vehicles of which most still wait at the origin
    let mut b = NetworkBuilder::new();
    let z = b.zone(-150.0, 0.0);
    let j = b.node(0.0, 0.0);
    let a = b.node(1500.0, 0.0);
    let d = b.node(1800.0, 0.0);
    let e = b.node(0.0, 300.0);
    let zj = b.link(z, j, 11.1, 1);
    let l1 = b.link(j, a, 13.9, 1);
    let l2 = b.link(a, d, 13.9, 1);
    let spur = b.link(j, e, 13.9, 1);
    let mut w = World::new(b.build().unwrap());
    for _ in 0..16 {
        w.spawn_with_route(vec![zj, l1, l2]).unwrap();
    }
    for _ in 0..10 {
        step_checked(&mut w);
    }
    // When L2 closes (NoRoute at the origin, stranded on links), reopens (successful
    // retry at ct + 120) and closes again at S = ct + 150; during the second episode an
    // unrelated spur link is closed (S + 100) and reopened (S + 200)
    let ct = w.tick();
    let s = ct + 150;
    w.schedule(close(l2, ct)).unwrap();
    w.schedule(open(l2, ct + 90)).unwrap();
    w.schedule(close(l2, s)).unwrap();
    w.schedule(close(spur, s + 100)).unwrap();
    w.schedule(open(spur, s + 200)).unwrap();
    let ids = w.vehicle_ids();
    assert_eq!(ids.len(), 16, "premise");
    while w.tick() <= s {
        step_checked(&mut w);
        let t = w.tick() - 1;
        for &id in &ids {
            let i = w.vehicle(id).unwrap();
            assert!(!matches!(i.state, VehicleState::OnLink(l) if l == l2), "premise: nobody reaches L2 (tick {t})");
            if t == ct + 60 {
                assert!(i.stranded || i.state == VehicleState::NoRoute, "premise: first episode");
                assert_eq!(i.no_route_retries, 1, "premise: first episode, one failed retry");
            }
            if t == ct + 120 {
                assert!(!i.stranded && i.state != VehicleState::NoRoute, "premise: resumed on the retry after the reopening");
            }
        }
    }
    // Then every vehicle starts the second episode at S with a fresh count, NoRoute ones included
    let n_noroute = ids.iter().filter(|&&id| w.vehicle(id).unwrap().state == VehicleState::NoRoute).count();
    assert!(n_noroute >= 4, "premise: some vehicles re-enter NoRoute at the origin ({n_noroute})");
    for &id in &ids {
        let i = w.vehicle(id).unwrap();
        assert!(i.stranded || i.state == VehicleState::NoRoute);
        assert_eq!(i.no_route_retries, 0, "trip {}: retry count carried over from the earlier episode", i.trip_id);
    }
    // And the unrelated close/open does not touch the schedule: k failed retries after
    // step S + 60k, removal exactly after step S + 600
    while w.tick() < s + 600 {
        step_checked(&mut w);
        let t = w.tick() - 1;
        if t > s && (t - s) % NO_ROUTE_RETRY_TICKS == 0 {
            let k = ((t - s) / NO_ROUTE_RETRY_TICKS) as u32;
            for &id in &ids {
                let i = w.vehicle(id).unwrap_or_else(|| panic!("removed early at tick {t} (after {k} retries)"));
                assert_eq!(i.no_route_retries, k, "trip {} at tick {t}", i.trip_id);
            }
        }
    }
    assert_eq!(w.metrics().removed_unreachable, 0);
    step_checked(&mut w);
    assert!(ids.iter().all(|&id| w.vehicle(id).is_none()));
    assert_eq!(w.metrics().removed_unreachable, 16);
}



// ─── 35 ──────────────────────────────────────────────────────────────────
// Proposed and verified against an independent reference by the core-003
// Red reviewer, round 6. Append to core_003_closures.rs (uses its helpers,
// including backlog_net from tests 17–26).
#[test]
fn forced_decision_without_route_strands_at_the_stop_line() {
    // Given the backlog network with 3000 backlog vehicles from y and 10 vehicles from z,
    // and A and B1 closing at the same tick, so that no route leads from j to d
    let (net, [zj, yj, a, b1, b2]) = backlog_net();
    let mut w = World::new(net);
    for _ in 0..3000 {
        w.spawn_with_route(vec![yj, a]).unwrap();
    }
    let zs: Vec<_> = (0..10).map(|_| w.spawn_with_route(vec![zj, a]).unwrap()).collect();
    let ct = 25;
    w.schedule(close(a, ct)).unwrap();
    w.schedule(close(b1, ct)).unwrap();
    for _ in 0..ct {
        step_checked(&mut w);
    }
    assert_eq!(w.reroute_stats().forced_total, 0, "premise");
    let z0 = zs[0];
    let z0_trip = w.vehicle(z0).unwrap().trip_id;
    let exits_zj = w.link_exit_count(zj);
    // When the first z vehicle reaches the stop line before its priority turn (tick ct + 15)
    let mut forced_at: Option<u64> = None;
    while w.tick() < ct + 15 {
        step_checked(&mut w);
        if forced_at.is_none() && w.reroute_stats().forced_total > 0 {
            forced_at = Some(w.tick() - 1);
        }
    }
    let f = forced_at.expect("premise: a forced decision before the priority turn");
    // (exact under the contract; same approach as test 17; independent reference: tick 33)
    assert_eq!(f, 33);
    // Then the failed forced decision strands it at once on its lane, the closed links stay
    // empty, it takes no further forced decisions, and it retries on its own schedule from f:
    // k failed retries after step f + 60k, removal exactly after step f + 600
    let mut t = w.tick() - 1;
    loop {
        assert_eq!(w.link_count(a) + w.link_count(b1) + w.link_count(b2), 0, "a vehicle passed a closed link (tick {t})");
        assert_eq!(w.reroute_stats().forced_total, 1, "stranded fronts take no forced decisions (tick {t})");
        if t >= f + NO_ROUTE_RETRY_TICKS * NO_ROUTE_MAX_RETRIES as u64 {
            break;
        }
        let i = w.vehicle(z0).unwrap_or_else(|| panic!("removed early at tick {t}"));
        assert!(i.stranded, "not stranded at tick {t}");
        assert_eq!(i.state, VehicleState::OnLink(zj));
        assert_eq!(i.route, vec![zj, a], "a stranded vehicle keeps its route");
        assert_eq!(i.no_route_retries as u64, (t - f) / NO_ROUTE_RETRY_TICKS, "retry schedule at tick {t}");
        assert!(w.link_vehicles(zj).iter().any(|v| v.trip_id == z0_trip));
        step_checked(&mut w);
        t = w.tick() - 1;
    }
    assert_eq!(t, f + 600);
    assert!(w.vehicle(z0).is_none(), "not removed exactly at f + 600");
    assert!(w.link_vehicles(zj).iter().all(|v| v.trip_id != z0_trip));
    assert_eq!(w.link_exit_count(zj), exits_zj, "a removal is not an exit");
}
