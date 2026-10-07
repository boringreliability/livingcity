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

/// Links that cross the river corridor (from one bank to the other).
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

/// Zone connectors (links leaving or entering a zone).
fn is_connector(c: &City, l: LinkId) -> bool {
    let net = &c.scenario.network;
    net.is_zone(net.link(l).from) || net.is_zone(net.link(l).to)
}

/// Per-minute samples of a run, plus the world at its end.
struct Run {
    w: World,
    /// Per-minute means over all ticks of that minute.
    active: Vec<f64>,
    queued: Vec<f64>,
    /// Per-minute end-of-minute values.
    unserved: Vec<u64>,
    removed_gridlock: Vec<u64>,
    /// Max consecutive ticks any one link stayed ≥ 95 % full.
    longest_full_ticks: u64,
    /// Ticks (within the spillback window) where an approach to the North or Old Bridge
    /// showed spillback through two consecutive non-connector links.
    spillback_ticks: u64,
    /// West→east exits per bridge (central, north, south) per minute.
    we_exits: Vec<[u64; 3]>,
    /// Ticks after which a closed Main Bridge link gained a vehicle (must stay 0).
    main_entries_while_closed: u64,
}

/// Simulate `minutes` minutes with `commands`; `main_closed` = tick range in which the
/// Main Bridge is closed (entries are counted there).
fn run(c: &City, commands: &[Command], minutes: u64, spill_window: Option<(u64, u64)>, main_closed: Option<(u64, u64)>) -> Run {
    let mut w = world(c);
    for &cmd in commands {
        w.schedule(cmd).unwrap();
    }
    let net = c.scenario.network.clone();
    let n_links = net.links().len();
    let mut full_run = vec![0u64; n_links];
    let mut longest = 0;
    let b = bridges(c);
    // Approaches: (link L1 into the bridge's start node, its upstream feeder L2), both streets.
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
                    // real streets, not stubs at the bridge head (Red r2 m2)
                    if net.link(l1).length_m + net.link(l2).length_m < 300.0 {
                        continue;
                    }
                    chains.push((l1, l2));
                }
            }
        }
    }
    let full80 = |w: &World, l: LinkId| w.link_count(l) as f64 >= 0.8 * net.capacity(l) as f64;
    let mut r = Run {
        w,
        active: vec![],
        queued: vec![],
        unserved: vec![],
        removed_gridlock: vec![],
        longest_full_ticks: 0,
        spillback_ticks: 0,
        we_exits: vec![],
        main_entries_while_closed: 0,
    };
    let mut last: [u64; 3] = [0; 3];
    let (mut sum_active, mut sum_queued) = (0u64, 0u64);
    for t in 0..minutes * MIN {
        let main_before = [b[0][0], b[0][1]].map(|l| r.w.link_count(l));
        r.w.step();
        if main_closed.is_some_and(|(a, z)| t >= a && t < z) {
            for (i, l) in [b[0][0], b[0][1]].into_iter().enumerate() {
                if r.w.link_count(l) > main_before[i] {
                    r.main_entries_while_closed += 1;
                }
            }
        }
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
        let m = r.w.metrics();
        sum_active += m.active;
        sum_queued += m.queued;
        if (t + 1) % MIN == 0 {
            r.active.push(sum_active as f64 / MIN as f64);
            r.queued.push(sum_queued as f64 / MIN as f64);
            (sum_active, sum_queued) = (0, 0);
            r.unserved.push(m.unserved);
            r.removed_gridlock.push(m.removed_gridlock);
            let now = [b[0][0], b[1][0], b[2][0]].map(|l| r.w.link_exit_count(l));
            r.we_exits.push([now[0] - last[0], now[1] - last[1], now[2] - last[2]]);
            last = now;
        }
    }
    r.longest_full_ticks = longest;
    r
}

fn mean(xs: &[f64]) -> f64 {
    xs.iter().sum::<f64>() / xs.len() as f64
}

/// Mean travel time (s) of west→east trips completed in ticks [from, to), and their count.
fn west_east_tt(c: &City, w: &World, from: u64, to: u64) -> (f64, usize) {
    let (west, east) = c.river;
    let trips: BTreeMap<u64, (NodeId, NodeId)> =
        w.generated_trips().iter().map(|g| (g.trip_id, (g.origin, g.dest))).collect();
    let tts: Vec<f64> = w
        .completed_log()
        .iter()
        .filter(|t| t.completed_tick >= from && t.completed_tick < to)
        .filter(|t| trips.get(&t.trip_id).is_some_and(|&(o, d)| x_of(c, o) < west && x_of(c, d) > east))
        .map(|t| (t.completed_tick - t.created_tick) as f64 * DT)
        .collect();
    (tts.iter().sum::<f64>() / tts.len().max(1) as f64, tts.len())
}

fn close_main(c: &City, at: u64) -> Vec<Command> {
    c.landmarks.central_bridge.iter().map(|&l| close(l, at)).collect()
}

// ─── calibration checks (each run for both seed pairs) ─────────────────────

/// Test 4: a living ≈ 2,000-vehicle baseline without gridlock or unserved trips.
fn check_living_baseline(c: &City) {
    let r = run(c, &[], 60, None, None);
    let active = mean(&r.active[30..60]);
    assert!((1600.0..=2600.0).contains(&active), "mean active over min 30–60 = {active}");
    assert!(r.unserved.iter().all(|&u| u == 0), "baseline unserved per minute: {:?}", r.unserved);
    assert!(r.removed_gridlock.iter().all(|&g| g == 0), "baseline gridlock removals");
    assert!(r.longest_full_ticks < 10 * MIN, "a link stayed ≥ 95 % full for {} ticks", r.longest_full_ticks);
}

/// Test 5: the Main Bridge carries most west→east crossings in the baseline.
fn check_main_share(c: &City) {
    let r = run(c, &[], 60, None, None);
    let sum: [u64; 3] = r.we_exits[30..60].iter().fold([0; 3], |a, e| [a[0] + e[0], a[1] + e[1], a[2] + e[2]]);
    let total = sum.iter().sum::<u64>() as f64;
    assert!(total > 0.0);
    assert!(sum[0] as f64 > 0.5 * total, "Main Bridge share {} of {total}", sum[0]);
}

/// Test 6: the closure at least doubles the mean queued over 10–40 min after it.
fn check_queues_double(c: &City) {
    let base = run(c, &[], 60, None, None);
    let closed = run(c, &close_main(c, CLOSE_AT), 60, None, None);
    let (qb, qc) = (mean(&base.queued[30..60]), mean(&closed.queued[30..60]));
    assert!(qb > 0.0, "baseline has some queueing");
    assert!(qc >= 2.0 * qb, "closure queued {qc} vs baseline {qb}");
}

/// Test 7: spillback through two consecutive street links on a North/Old Bridge approach.
fn check_spillback(c: &City) {
    let window = (CLOSE_AT + 10 * MIN, CLOSE_AT + 40 * MIN);
    let closed = run(c, &close_main(c, CLOSE_AT), 60, Some(window), None);
    assert!(closed.spillback_ticks > 0, "no two-link spillback on a North/Old Bridge approach");
    let base = run(c, &[], 60, Some(window), None);
    assert!(closed.spillback_ticks > base.spillback_ticks, "{} vs {}", closed.spillback_ticks, base.spillback_ticks);
}

/// Test 8: west→east trips are ≥ 25 % slower 10–40 min after the closure.
fn check_trip_time(c: &City) {
    let (a, z) = (CLOSE_AT + 10 * MIN, CLOSE_AT + 40 * MIN);
    let base = run(c, &[], 60, None, None);
    let closed = run(c, &close_main(c, CLOSE_AT), 60, None, None);
    let (tb, nb) = west_east_tt(c, &base.w, a, z);
    let (tc, nc) = west_east_tt(c, &closed.w, a, z);
    assert!(nb >= 100 && nc >= 100, "enough completed west→east trips ({nb}, {nc})");
    assert!(tc >= 1.25 * tb, "west→east mean trip {tc:.0} s vs baseline {tb:.0} s");
}

/// Test 9: traffic reroutes over the alternatives; nobody enters the closed bridge; few removals.
fn check_reroutes(c: &City) {
    let base = run(c, &[], 60, None, None);
    let closed = run(c, &close_main(c, CLOSE_AT), 60, None, Some((CLOSE_AT, 60 * MIN)));
    let alt = |r: &Run| r.we_exits[30..60].iter().map(|e| e[1] + e[2]).sum::<u64>();
    assert!(alt(&closed) > alt(&base), "North + Old exits {} vs baseline {}", alt(&closed), alt(&base));
    assert_eq!(closed.main_entries_while_closed, 0, "vehicles entered the closed Main Bridge");
    let central_late: u64 = closed.we_exits[30..60].iter().map(|e| e[0]).sum();
    assert_eq!(central_late, 0, "Main Bridge still discharging 10 min after the closure");
    let m = closed.w.metrics();
    assert!(
        m.removed_gridlock as f64 <= 0.01 * m.trips_generated as f64,
        "gridlock removals {} of {} trips",
        m.removed_gridlock,
        m.trips_generated
    );
}

/// Test 10: reopened 30 min after the closure, the city recovers within 30 min: over minutes
/// 20–30 after the reopen the backlog is gone (active ≤ 1.1 × baseline), the Main Bridge carries
/// most west→east crossings again, and queued has fallen by at least a quarter from its closure level.
/// (A queued ratio against the baseline over a 5-min window proved to be noise: route choice
/// oscillates for a while after a reopen, so that ratio swung between 1.4 and 3.0 with ±2 %
/// demand changes; see ward-002 § Specification.)
fn check_reopen(c: &City) {
    let reopen_at = CLOSE_AT + 30 * MIN;
    let mut cmds = close_main(c, CLOSE_AT);
    cmds.extend(c.landmarks.central_bridge.iter().map(|&l| open(l, reopen_at)));
    let minutes = 50 + 30;
    let base = run(c, &[], 60, None, None);
    let r = run(c, &cmds, minutes, None, None);
    let (a_base, a_after) = (mean(&base.active[30..60]), mean(&r.active[70..80]));
    assert!(a_after <= 1.1 * a_base, "active 20–30 min after the reopen {a_after} vs baseline {a_base}");
    let sum: [u64; 3] = r.we_exits[70..80].iter().fold([0; 3], |a, e| [a[0] + e[0], a[1] + e[1], a[2] + e[2]]);
    let total = sum.iter().sum::<u64>() as f64;
    assert!(sum[0] as f64 > 0.5 * total, "Main Bridge share after the reopen {} of {total}", sum[0]);
    let (q_closed, q_after) = (mean(&r.queued[30..50]), mean(&r.queued[70..80]));
    assert!(q_after <= 0.75 * q_closed, "queued after the reopen {q_after} vs during the closure {q_closed}");
    assert!(q_closed > 1.5 * mean(&base.queued[30..50]), "the closure had raised queued");
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
    // Geography: North Bridge north of the Main Bridge, Old Bridge south, each 1–2.5 km apart
    let lmk = c.landmarks;
    let y_mid = |l: LinkId| (net.node(net.link(l).from).y_m + net.node(net.link(l).to).y_m) / 2.0;
    let (n, m, s) = (y_mid(lmk.north_bridge[0]), y_mid(lmk.central_bridge[0]), y_mid(lmk.south_bridge[0]));
    assert!((1000.0..=2500.0).contains(&(n - m)), "North Bridge {n} vs Main {m}");
    assert!((1000.0..=2500.0).contains(&(m - s)), "Main {m} vs Old Bridge {s}");
    // Extent: a town of ~5–7 km by ~4–5 km (tolerant: 4–8 km by 3–6 km)
    let xs = net.nodes().iter().map(|n| n.x_m);
    let ys = net.nodes().iter().map(|n| n.y_m);
    let span = |it: &mut dyn Iterator<Item = f64>| {
        let v: Vec<f64> = it.collect();
        v.iter().cloned().fold(f64::NEG_INFINITY, f64::max) - v.iter().cloned().fold(f64::INFINITY, f64::min)
    };
    let (sx, sy) = (span(&mut xs.into_iter()), span(&mut ys.into_iter()));
    assert!((4000.0..=8000.0).contains(&sx), "x extent {sx} m");
    assert!((3000.0..=6000.0).contains(&sy), "y extent {sy} m");
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
    let count =
        |k: ZoneKind, side: &dyn Fn(NodeId) -> bool| c.zones.iter().filter(|z| z.kind == k && side(z.node)).count();
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
    let fastest = net.links().iter().filter(|l| !is_connector(&c, l.id)).map(|l| l.speed_limit_mps).fold(0.0, f64::max);
    for &l in &lm.central_bridge {
        assert_eq!(net.link(l).lanes, 2, "Main Bridge: 2 lanes each way");
        assert_eq!(net.link(l).speed_limit_mps, fastest, "Main Bridge at arterial speed");
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
}

// ─── 4–10 (seeds 2026, 7) ─────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn baseline_is_a_living_city() {
    check_living_baseline(&river_city(2026, 7));
}

#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn main_bridge_carries_most_crossings() {
    check_main_share(&river_city(2026, 7));
}

#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn closure_queues_double() {
    check_queues_double(&river_city(2026, 7));
}

#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn closure_spills_back() {
    check_spillback(&river_city(2026, 7));
}

#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn closure_slows_cross_river_trips() {
    check_trip_time(&river_city(2026, 7));
}

#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn closure_reroutes_to_alternatives() {
    check_reroutes(&river_city(2026, 7));
}

#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn reopen_recovers() {
    check_reopen(&river_city(2026, 7));
}

// ─── 11 ───────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn calibration_holds_for_another_seed() {
    let c = river_city(11, 3);
    check_living_baseline(&c);
    check_main_share(&c);
    check_queues_double(&c);
    check_spillback(&c);
    check_trip_time(&c);
    check_reroutes(&c);
    check_reopen(&c);
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
    let trips = |w: &World| w.generated_trips().iter().map(|g| (g.origin, g.dest, g.created_tick)).collect::<Vec<_>>();
    let mut a10 = world(&c);
    let mut other = world(&river_city(2027, 7));
    for _ in 0..10 * MIN {
        a10.step();
        other.step();
    }
    assert_ne!(trips(&a10), trips(&other), "a different demand seed gives different trips");
}
