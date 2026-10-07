//! Ward city-002: River City network and calibrated demand.
//! Contract: `.wdd/epics/city.md` § C3 (with C1/C2 and the core contract in force).
//!
//! The calibration tests simulate hours of a ~2,000-vehicle city. Run them in release:
//! `cargo test -p sim-core --release --test city_002_river` (debug builds skip them).
#![allow(clippy::needless_range_loop, clippy::manual_is_multiple_of, clippy::type_complexity)]

use std::collections::BTreeMap;

use sim_core::cities::{river_city, three_bridges};
use sim_core::params::DT;
use sim_core::{City, Command, CommandKind, LinkId, NodeId, World, ZoneKind};

const MIN: u64 = 120; // ticks per sim minute
const CLOSE_AT: u64 = 20 * MIN;

fn world(c: &City) -> World {
    World::from_scenario(c.scenario.clone()).expect("valid city")
}

fn close(l: LinkId, tick: u64) -> Command {
    Command { tick, kind: CommandKind::CloseLink(l) }
}

fn open(l: LinkId, tick: u64) -> Command {
    Command { tick, kind: CommandKind::OpenLink(l) }
}

fn x_of(c: &City, n: NodeId) -> f64 {
    c.scenario.network.node(n).x_m
}

/// Link pairs that cross the river corridor (from one bank to the other).
fn crossing_links(c: &City) -> Vec<LinkId> {
    let (west, east) = c.river;
    let net = &c.scenario.network;
    net.links()
        .iter()
        .filter(|l| {
            let (a, b) = (net.node(l.from).x_m, net.node(l.to).x_m);
            (a < west && b > east) || (a > east && b < west)
        })
        .map(|l| l.id)
        .collect()
}

fn bridges(c: &City) -> [[LinkId; 2]; 3] {
    let l = c.landmarks;
    [l.central_bridge, l.north_bridge, l.south_bridge]
}

/// Link ids of zone connectors (links leaving a zone).
fn is_connector(c: &City, l: LinkId) -> bool {
    let net = &c.scenario.network;
    net.is_zone(net.link(l).from) || net.is_zone(net.link(l).to)
}

/// Per-minute samples of a run, plus the world at its end.
struct Run {
    w: World,
    active: Vec<u64>,
    queued: Vec<u64>,
    /// Max consecutive ticks any one link stayed ≥ 95 % full.
    longest_full_ticks: u64,
    /// Ticks (within the closure window) where an approach to the North or Old Bridge
    /// showed spillback through two consecutive non-connector links.
    spillback_ticks: u64,
    /// West→east exits per bridge (central, north, south) per minute.
    we_exits: Vec<[u64; 3]>,
}

/// Simulate `minutes` minutes, applying `commands` up front; sample every minute.
fn run(c: &City, commands: &[Command], minutes: u64, spill_window: Option<(u64, u64)>) -> Run {
    let mut w = world(c);
    for &cmd in commands {
        w.schedule(cmd).unwrap();
    }
    let net = c.scenario.network.clone();
    let n_links = net.links().len();
    let mut full_run = vec![0u64; n_links];
    let mut longest = 0;
    let b = bridges(c);
    // Approaches: (bridge entry link L1 feeding the bridge's start node, its upstream feeder L2)
    let mut chains: Vec<(LinkId, LinkId)> = Vec::new();
    for pair in [b[1], b[2]] {
        for bl in pair {
            let start = net.link(bl).from;
            for &l1 in net.in_links(start) {
                if b.iter().flatten().any(|&x| x == l1) || is_connector(c, l1) {
                    continue;
                }
                for &l2 in net.in_links(net.link(l1).from) {
                    if is_connector(c, l2) || net.link(l2).from == start {
                        continue;
                    }
                    chains.push((l1, l2));
                }
            }
        }
    }
    let full80 = |w: &World, l: LinkId| w.link_count(l) as f64 >= 0.8 * net.capacity(l) as f64;
    let mut r = Run { w, active: vec![], queued: vec![], longest_full_ticks: 0, spillback_ticks: 0, we_exits: vec![] };
    let mut last: [u64; 3] = [0; 3];
    for t in 0..minutes * MIN {
        r.w.step();
        for l in 0..n_links {
            let id = LinkId(l as u32);
            if r.w.link_count(id) as f64 >= 0.95 * net.capacity(id) as f64 {
                full_run[l] += 1;
                longest = longest.max(full_run[l]);
            } else {
                full_run[l] = 0;
            }
        }
        if let Some((a, z)) = spill_window {
            if t >= a && t < z && chains.iter().any(|&(l1, l2)| full80(&r.w, l1) && full80(&r.w, l2)) {
                r.spillback_ticks += 1;
            }
        }
        if (t + 1) % MIN == 0 {
            let m = r.w.metrics();
            r.active.push(m.active);
            r.queued.push(m.queued);
            let now = [b[0][0], b[1][0], b[2][0]].map(|l| r.w.link_exit_count(l));
            r.we_exits.push([now[0] - last[0], now[1] - last[1], now[2] - last[2]]);
            last = now;
        }
    }
    r.longest_full_ticks = longest;
    r
}

fn mean(xs: &[u64]) -> f64 {
    xs.iter().sum::<u64>() as f64 / xs.len() as f64
}

/// Mean travel time (s) of west→east trips completed in ticks [from, to).
fn west_east_tt(c: &City, w: &World, from: u64, to: u64) -> (f64, usize) {
    let (west, east) = c.river;
    let trips: BTreeMap<u64, (NodeId, NodeId)> =
        w.generated_trips().iter().map(|g| (g.trip_id, (g.origin, g.dest))).collect();
    let tts: Vec<f64> = w
        .completed_log()
        .iter()
        .filter(|t| t.completed_tick >= from && t.completed_tick < to)
        .filter(|t| {
            trips.get(&t.trip_id).is_some_and(|&(o, d)| x_of(c, o) < west && x_of(c, d) > east)
        })
        .map(|t| (t.completed_tick - t.created_tick) as f64 * DT)
        .collect();
    (tts.iter().sum::<f64>() / tts.len().max(1) as f64, tts.len())
}

fn close_main(c: &City, at: u64) -> Vec<Command> {
    c.landmarks.central_bridge.iter().map(|&l| close(l, at)).collect()
}

// ─── 1 ────────────────────────────────────────────────────────────────────
#[test]
fn river_city_is_valid() {
    let c = river_city(2026, 7);
    assert_eq!(c.name, "river_city");
    assert_eq!(three_bridges(1, 1).name, "three_bridges");
    let (west, east) = c.river;
    assert!(west < east && west.is_finite() && east.is_finite());
    let w = world(&c); // validates network + demand
    // Exactly three two-way crossings, and they are the landmarks
    let mut crossing = crossing_links(&c);
    crossing.sort();
    let mut lm: Vec<LinkId> = bridges(&c).iter().flatten().copied().collect();
    lm.sort();
    assert_eq!(crossing, lm, "crossings must be exactly the three landmark bridges");
    let net = &c.scenario.network;
    for pair in bridges(&c) {
        let (a, b) = (net.link(pair[0]), net.link(pair[1]));
        assert!(net.node(a.from).x_m < west && net.node(a.to).x_m > east, "[0] is west→east");
        assert_eq!((a.from, a.to), (b.to, b.from), "[1] is the reverse of [0]");
    }
    // No node lies inside the corridor
    for n in net.nodes() {
        assert!(n.x_m < west || n.x_m > east, "node {:?} inside the river", n.id);
    }
    // Every zone reaches every other zone through the router
    for o in &c.zones {
        for d in &c.zones {
            if o.node != d.node {
                assert!(w.shortest_route(o.node, d.node).is_some(), "{} → {} unreachable", o.name, d.name);
            }
        }
    }
}

// ─── 2 ────────────────────────────────────────────────────────────────────
#[test]
fn river_city_districts() {
    let c = river_city(2026, 7);
    let (west, east) = c.river;
    let west_of = |n: NodeId| x_of(&c, n) < west;
    let east_of = |n: NodeId| x_of(&c, n) > east;
    let count = |k: ZoneKind, side: &dyn Fn(NodeId) -> bool| c.zones.iter().filter(|z| z.kind == k && side(z.node)).count();
    assert!(count(ZoneKind::Residential, &west_of) >= 4);
    assert!(c.zones.iter().filter(|z| z.kind == ZoneKind::Workplace).count() >= 3);
    assert!(count(ZoneKind::Workplace, &east_of) >= 2);
    assert_eq!(c.zones.iter().filter(|z| z.kind == ZoneKind::Hospital).count(), 1);
    assert_eq!(count(ZoneKind::Hospital, &east_of), 1);
    let mut names: Vec<&str> = c.zones.iter().map(|z| z.name.as_str()).collect();
    names.sort();
    let n = names.len();
    names.dedup();
    assert_eq!(names.len(), n, "zone names must be unique");
    for z in &c.zones {
        assert!(c.scenario.network.is_zone(z.node));
    }
}

// ─── 3 ────────────────────────────────────────────────────────────────────
#[test]
fn crossing_attributes() {
    let c = river_city(2026, 7);
    let net = &c.scenario.network;
    let lm = c.landmarks;
    for &l in &lm.central_bridge {
        assert_eq!(net.link(l).lanes, 2, "Main Bridge: 2 lanes each way");
    }
    for &l in &lm.north_bridge {
        assert_eq!(net.link(l).lanes, 1, "North Bridge: 1 lane each way");
    }
    for &l in &lm.south_bridge {
        let link = net.link(l);
        assert_eq!(link.lanes, 1, "Old Bridge: 1 lane each way");
        assert!(link.sat_flow_per_lane <= 0.25, "Old Bridge: ≤ 900 veh/h");
        assert!(link.speed_limit_mps <= 30.0 / 3.6 + 1e-9, "Old Bridge: ≤ 30 km/h");
    }
    // The Main Bridge is the arterial: faster than the Old Bridge
    assert!(net.link(lm.central_bridge[0]).speed_limit_mps > net.link(lm.south_bridge[0]).speed_limit_mps);
}

// ─── 4 ────────────────────────────────────────────────────────────────────
fn assert_living_baseline(c: &City) -> Run {
    let r = run(c, &[], 60, None);
    let active = mean(&r.active[30..60]);
    assert!((1600.0..=2600.0).contains(&active), "mean active over min 30–60 = {active}");
    let m = r.w.metrics();
    assert_eq!(m.unserved, 0, "baseline unserved");
    assert_eq!(m.removed_gridlock, 0, "baseline gridlock removals");
    assert!(r.longest_full_ticks < 10 * MIN, "a link stayed ≥ 95 % full for {} ticks", r.longest_full_ticks);
    r
}

#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn baseline_is_a_living_city() {
    assert_living_baseline(&river_city(2026, 7));
}

// ─── 5 ────────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn main_bridge_carries_most_crossings() {
    let c = river_city(2026, 7);
    let r = run(&c, &[], 60, None);
    let sum: [u64; 3] = r.we_exits[30..60].iter().fold([0; 3], |a, e| [a[0] + e[0], a[1] + e[1], a[2] + e[2]]);
    let total = sum.iter().sum::<u64>() as f64;
    assert!(total > 0.0);
    assert!(sum[0] as f64 > 0.5 * total, "Main Bridge share {} of {total}", sum[0]);
}

// ─── 6 ────────────────────────────────────────────────────────────────────
fn assert_queues_double(c: &City) {
    let base = run(c, &[], 60, None);
    let closed = run(c, &close_main(c, CLOSE_AT), 60, None);
    // window: 10–40 min after the closure = minutes 30..60
    let (qb, qc) = (mean(&base.queued[30..60]), mean(&closed.queued[30..60]));
    assert!(qb > 0.0, "baseline has some queueing");
    assert!(qc >= 2.0 * qb, "closure queued {qc} vs baseline {qb}");
}

#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn closure_queues_double() {
    assert_queues_double(&river_city(2026, 7));
}

// ─── 7 ────────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn closure_spills_back() {
    let c = river_city(2026, 7);
    let window = (CLOSE_AT + 10 * MIN, CLOSE_AT + 40 * MIN);
    let closed = run(&c, &close_main(&c, CLOSE_AT), 60, Some(window));
    assert!(closed.spillback_ticks > 0, "no two-link spillback on a North/Old Bridge approach");
    // And it is a consequence of the closure: the baseline never shows it in the same window
    let base = run(&c, &[], 60, Some(window));
    assert!(closed.spillback_ticks > base.spillback_ticks, "{} vs {}", closed.spillback_ticks, base.spillback_ticks);
}

// ─── 8 ────────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn closure_slows_cross_river_trips() {
    let c = river_city(2026, 7);
    let (a, z) = (CLOSE_AT + 10 * MIN, CLOSE_AT + 40 * MIN);
    let base = run(&c, &[], 60, None);
    let closed = run(&c, &close_main(&c, CLOSE_AT), 60, None);
    let (tb, nb) = west_east_tt(&c, &base.w, a, z);
    let (tc, nc) = west_east_tt(&c, &closed.w, a, z);
    assert!(nb >= 100 && nc >= 100, "enough completed west→east trips ({nb}, {nc})");
    assert!(tc >= 1.25 * tb, "west→east mean trip {tc:.0} s vs baseline {tb:.0} s");
}

// ─── 9 ────────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn closure_reroutes_to_alternatives() {
    let c = river_city(2026, 7);
    let base = run(&c, &[], 60, None);
    let closed = run(&c, &close_main(&c, CLOSE_AT), 60, None);
    let alt = |r: &Run| r.we_exits[30..60].iter().map(|e| e[1] + e[2]).sum::<u64>();
    assert!(alt(&closed) > alt(&base), "North + Old exits {} vs baseline {}", alt(&closed), alt(&base));
    let central: u64 = closed.we_exits[22..60].iter().map(|e| e[0]).sum();
    assert_eq!(central, 0, "no Main Bridge exits 2 min after the closure");
    let m = closed.w.metrics();
    assert!(
        m.removed_gridlock as f64 <= 0.01 * m.trips_generated as f64,
        "gridlock removals {} of {} trips",
        m.removed_gridlock,
        m.trips_generated
    );
}

// ─── 10 ───────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn reopen_recovers() {
    let c = river_city(2026, 7);
    let reopen_at = CLOSE_AT + 30 * MIN;
    let mut cmds = close_main(&c, CLOSE_AT);
    cmds.extend(c.landmarks.central_bridge.iter().map(|&l| open(l, reopen_at)));
    let minutes = 50 + 30;
    let base = run(&c, &[], minutes, None);
    let r = run(&c, &cmds, minutes, None);
    // minutes 25–30 after the reopen = minutes 75..80
    let (qb, qr) = (mean(&base.queued[75..80]), mean(&r.queued[75..80]));
    assert!(qr <= 1.5 * qb, "after reopen queued {qr} vs baseline {qb}");
    // and the closure really had raised it
    assert!(mean(&r.queued[40..50]) > 1.5 * mean(&base.queued[40..50]));
}

// ─── 11 ───────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn calibration_holds_for_another_seed() {
    let c = river_city(11, 3);
    assert_living_baseline(&c);
    assert_queues_double(&c);
}

// ─── 12 ───────────────────────────────────────────────────────────────────
#[test]
fn river_city_is_deterministic() {
    let c = river_city(2026, 7);
    let mut a = world(&c);
    let mut b = world(&river_city(2026, 7));
    for cmd in close_main(&c, CLOSE_AT) {
        a.schedule(cmd).unwrap();
        b.schedule(cmd).unwrap();
    }
    for t in 0..60 * MIN {
        a.step();
        b.step();
        if (t + 1) % MIN == 0 {
            assert_eq!(a.state_hash(), b.state_hash(), "minute {}", (t + 1) / MIN);
        }
    }
    let mut other = world(&river_city(2027, 7));
    for _ in 0..10 * MIN {
        other.step();
    }
    let trips = |w: &World| w.generated_trips().iter().map(|g| (g.origin, g.dest, g.created_tick)).collect::<Vec<_>>();
    let mut a10 = world(&c);
    for _ in 0..10 * MIN {
        a10.step();
    }
    assert_ne!(trips(&a10), trips(&other), "a different demand seed gives different trips");
}
