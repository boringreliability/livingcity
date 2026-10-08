//! Ward timeline-001: snapshots, restore and seek (contract `.wdd/epics/timeline.md` § T1).
//! The River City tests simulate hours with a hash per tick: run them in release
//! (`cargo test -p sim-core --release --test timeline_001_snapshots`); debug builds skip them.
#![allow(clippy::needless_range_loop)]

use sim_core::cities::{river_city, three_bridges};
use sim_core::{
    Command, CommandError, CommandKind, LinkId, NetworkBuilder, Scenario, Timeline, TimelineError, VehicleInfo, World,
    SNAPSHOT_INTERVAL_TICKS,
};

const UNLIMITED: usize = usize::MAX;

fn close(l: LinkId, tick: u64) -> Command {
    Command { tick, kind: CommandKind::CloseLink(l) }
}

fn open(l: LinkId, tick: u64) -> Command {
    Command { tick, kind: CommandKind::OpenLink(l) }
}

fn world(s: &Scenario, cmds: &[Command]) -> World {
    let mut w = World::from_scenario(s.clone()).expect("valid scenario");
    for c in cmds {
        w.schedule(*c).expect("valid command");
    }
    w
}

/// Everything a seek must reproduce, captured from a world at its tick.
#[derive(Debug, PartialEq)]
struct Observed {
    tick: u64,
    hash: u64,
    generated: usize,
    completed: usize,
    completed_tail: Vec<(u64, u64)>,
    metrics: String,
    reroute: String,
}

fn observe(w: &World) -> Observed {
    let c = w.completed_log();
    Observed {
        tick: w.tick(),
        hash: w.state_hash(),
        generated: w.generated_trips().len(),
        completed: c.len(),
        completed_tail: c.iter().rev().take(20).map(|t| (t.trip_id, t.completed_tick)).collect(),
        metrics: format!("{:?}", w.metrics()),
        reroute: format!("{:?}", w.reroute_stats()),
    }
}

/// Uninterrupted reference: observations at ticks 0..=ticks (index = tick).
fn reference(w: World, ticks: u64) -> Vec<Observed> {
    let mut w = w;
    let mut out = vec![observe(&w)];
    for _ in 0..ticks {
        w.step();
        out.push(observe(&w));
    }
    out
}

fn river() -> (Scenario, [LinkId; 2]) {
    let c = river_city(2026, 7);
    (c.scenario.clone(), c.landmarks.central_bridge)
}

// ─── 1 ───────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "long: run with --release")]
fn seek_equals_uninterrupted_river_city() {
    let (s, main) = river();
    let cmds = [close(main[0], 1800), close(main[1], 1800), open(main[0], 2700), open(main[1], 2700)];
    let r = reference(world(&s, &cmds), 3600);
    let mut tl = Timeline::new(world(&s, &cmds), UNLIMITED);
    tl.step_n(3600);
    assert_eq!(tl.head_tick(), 3600);
    for t in [1830, 0, 3600, 121, 2700, 1, 3599, 1800, 119, 3000, 1799, 2699, 120, 1801] {
        tl.seek(t).expect("inside the window");
        assert_eq!(tl.position_tick(), t);
        assert_eq!(tl.head_tick(), 3600, "a seek never moves the head");
        assert_eq!(observe(tl.world()), r[t as usize], "seek({t})");
    }
}

// ─── 2 ───────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "long: run with --release")]
fn replay_after_seek_continues_identically() {
    let (s, main) = river();
    let cmds = [close(main[0], 1800), close(main[1], 1800)];
    let r = reference(world(&s, &cmds), 4800);
    let mut tl = Timeline::new(world(&s, &cmds), UNLIMITED);
    tl.step_n(3600);
    tl.seek(1830).unwrap();
    for t in 1831..=4800u64 {
        tl.step();
        assert_eq!(tl.world().state_hash(), r[t as usize].hash, "tick {t}");
        assert_eq!(tl.position_tick(), t);
        assert_eq!(tl.head_tick(), t.max(3600));
    }
    assert_eq!(observe(tl.world()), r[4800]);
}

// ─── 3 ───────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "long: run with --release")]
fn seek_mid_epoch_and_mid_reroute() {
    let (s, main) = river();
    let cmds = [close(main[0], 1800), close(main[1], 1800)];
    let r = reference(world(&s, &cmds), 2100);
    // precondition: the closure makes the reroute machinery busy right after 1800
    assert_ne!(r[1840].reroute, r[1800].reroute, "precondition: rerouting happens after the closure");
    let mut tl = Timeline::new(world(&s, &cmds), UNLIMITED);
    tl.step_n(2100);
    for t in (1801..=1840u64).rev() {
        tl.seek(t).unwrap();
        assert_eq!(observe(tl.world()), r[t as usize], "seek({t})");
        // and it continues identically from there for a while
        let mut probe = Timeline::new(tl.world().clone(), UNLIMITED);
        for k in 1..=60u64 {
            probe.step();
            assert_eq!(probe.world().state_hash(), r[(t + k) as usize].hash, "after seek({t}) + {k}");
        }
    }
}

// ─── 4 ───────────────────────────────────────────────────────────────────

/// The city-001 ring (copied construction, `city_001_relief.rs`): it deadlocks at tick ≈ 346;
/// gridlock relief then reroutes and finally removes vehicles.
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

fn blocked(w: &World) -> Vec<(u64, u32)> {
    let infos: Vec<VehicleInfo> = w.vehicle_ids().into_iter().filter_map(|id| w.vehicle(id)).collect();
    infos.iter().map(|i| (i.trip_id, i.blocked_ticks)).collect()
}

#[test]
fn gridlock_state_survives_restore() {
    // reference: hash, blocked counters and removals at every tick
    let mut rw = ring();
    let mut r = vec![(rw.state_hash(), blocked(&rw), rw.metrics().removed_gridlock)];
    for _ in 0..4000 {
        rw.step();
        r.push((rw.state_hash(), blocked(&rw), rw.metrics().removed_gridlock));
    }
    let first_removal = r.iter().position(|x| x.2 > 0).expect("precondition: a gridlock removal happens") as u64;
    assert!(r[700].1.iter().any(|&(_, b)| b > 0), "precondition: fronts are blocked at tick 700");
    let mut tl = Timeline::new(ring(), UNLIMITED);
    tl.step_n(4000);
    for t in [700, first_removal + 5] {
        tl.seek(t).unwrap();
        for k in t..=4000 {
            if k > t {
                tl.step();
            }
            let w = tl.world();
            assert_eq!((w.state_hash(), blocked(w), w.metrics().removed_gridlock), r[k as usize], "seek({t}) then tick {k}");
        }
    }
}

// ─── 5 ───────────────────────────────────────────────────────────────────
#[test]
fn three_bridges_with_future_commands() {
    let c = three_bridges(2026, 7);
    let main = c.landmarks.central_bridge;
    let north = c.landmarks.north_bridge;
    let cmds = [close(main[0], 300), close(main[1], 300), open(main[0], 900), close(north[1], 1500), open(main[1], 1700)];
    let r = reference(world(&c.scenario, &cmds), 2400);
    // the commands are scheduled before running (all in the future)
    let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    for cmd in cmds {
        tl.schedule(cmd).unwrap();
    }
    tl.step_n(2400);
    assert_eq!(observe(tl.world()), r[2400]);
    tl.seek(1000).unwrap();
    assert_eq!(tl.world().command_log().len(), cmds.len(), "later commands are kept by a seek");
    assert_eq!(observe(tl.world()), r[1000]);
    for t in 1001..=2400u64 {
        tl.step();
        assert_eq!(tl.world().state_hash(), r[t as usize].hash, "replay applies later commands: tick {t}");
    }
    assert!(tl.world().is_closed(north[1]));
}

// ─── 6 ───────────────────────────────────────────────────────────────────
#[test]
fn snapshot_cadence() {
    let c = three_bridges(2026, 7);
    let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    tl.step_n(3600);
    let want: Vec<u64> = (0..=30).map(|k| k * SNAPSHOT_INTERVAL_TICKS).collect();
    assert_eq!(SNAPSHOT_INTERVAL_TICKS, 120);
    assert_eq!(tl.snapshot_ticks(), want);
    assert_eq!(tl.window().snapshots, 31);
    // seeking back and replaying to the head adds nothing
    tl.seek(500).unwrap();
    tl.step_n(3100);
    assert_eq!(tl.position_tick(), 3600);
    assert_eq!(tl.snapshot_ticks(), want);
    // a timeline created at a tick that is not a multiple of 120 snapshots it, then the multiples
    let mut w = World::from_scenario(c.scenario.clone()).unwrap();
    for _ in 0..50 {
        w.step();
    }
    let mut tl2 = Timeline::new(w, UNLIMITED);
    tl2.step_n(250);
    assert_eq!(tl2.snapshot_ticks(), vec![50, 120, 240]);
}

// ─── 7 ───────────────────────────────────────────────────────────────────
#[test]
fn seek_cost_bounded() {
    let c = three_bridges(2026, 7);
    let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    tl.step_n(1500);
    for t in [0u64, 1, 119, 120, 121, 359, 360, 777, 1439, 1440, 1499, 1500] {
        tl.seek(t).unwrap();
        let snap = tl.snapshot_ticks().into_iter().filter(|&s| s <= t).max().unwrap();
        assert_eq!(tl.last_seek_replayed_ticks(), t - snap, "seek({t})");
        assert!(tl.last_seek_replayed_ticks() < SNAPSHOT_INTERVAL_TICKS);
    }
}

// ─── 8 ───────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "long: run with --release")]
fn snapshot_bytes_exclude_logs() {
    let (s, _) = river();
    let mut w = World::from_scenario(s).unwrap();
    for _ in 0..1800 {
        w.step();
    }
    let (b1800, logs1800) = (w.snapshot().bytes(), w.generated_trips().len() + w.completed_log().len());
    assert_eq!(w.snapshot().tick(), 1800);
    for _ in 1800..7200 {
        w.step();
    }
    let (b7200, logs7200) = (w.snapshot().bytes(), w.generated_trips().len() + w.completed_log().len());
    assert!(logs7200 > 3 * logs1800, "precondition: the logs grew ({logs1800} → {logs7200})");
    for b in [b1800, b7200] {
        assert!((150_000..=1_500_000).contains(&b), "snapshot bytes {b}");
    }
    assert!((b7200 as f64) < 1.5 * b1800 as f64, "snapshots must not grow with the logs: {b1800} → {b7200}");
}

// ─── 9 ───────────────────────────────────────────────────────────────────
#[test]
#[cfg_attr(debug_assertions, ignore = "long: run with --release")]
fn budget_evicts_oldest() {
    let (s, _) = river();
    let mut probe = World::from_scenario(s.clone()).unwrap();
    for _ in 0..1800 {
        probe.step();
    }
    let one = probe.snapshot().bytes();
    let budget = 5 * one;
    let mut tl = Timeline::new(World::from_scenario(s.clone()).unwrap(), budget);
    let mut last_start = 0;
    for _ in 0..7200 {
        tl.step();
        let win = tl.window();
        assert!(win.snapshot_bytes <= budget, "{} > {budget}", win.snapshot_bytes);
        assert_eq!(win.budget_bytes, budget);
        assert!(win.window_start >= last_start, "the window start never moves back");
        assert_eq!(win.window_start, tl.snapshot_ticks()[0]);
        assert_eq!(win.snapshots, tl.snapshot_ticks().len());
        assert_eq!((win.head_tick, win.position_tick), (tl.head_tick(), tl.position_tick()));
        last_start = win.window_start;
    }
    assert!(last_start > 0, "precondition: the budget evicted snapshots");
    assert!(tl.window().snapshots >= 2);
    // a budget below one snapshot keeps exactly the newest one
    let mut tiny = Timeline::new(World::from_scenario(s).unwrap(), one / 2);
    tiny.step_n(1000);
    assert_eq!(tiny.snapshot_ticks(), vec![960]);
}

// ─── 10 ──────────────────────────────────────────────────────────────────
#[test]
fn seek_outside_window_is_refused() {
    let c = three_bridges(2026, 7);
    let mut sizer = World::from_scenario(c.scenario.clone()).unwrap();
    for _ in 0..600 {
        sizer.step();
    }
    let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), 4 * sizer.snapshot().bytes());
    tl.step_n(2400);
    let start = tl.window().window_start;
    assert!(start > 0, "precondition: eviction happened");
    tl.seek(1500).unwrap();
    let before = (tl.world().state_hash(), tl.position_tick(), tl.head_tick(), tl.snapshot_ticks());
    for t in [start - 1, 2401, u64::MAX] {
        match tl.seek(t) {
            Err(TimelineError::OutsideWindow { tick, window_start, head_tick }) => {
                assert_eq!((tick, window_start, head_tick), (t, start, 2400));
            }
            other => panic!("seek({t}) must be refused, got {other:?}"),
        }
        assert_eq!((tl.world().state_hash(), tl.position_tick(), tl.head_tick(), tl.snapshot_ticks()), before);
    }
    assert!(tl.seek(start).is_ok());
}

// ─── 11 ──────────────────────────────────────────────────────────────────
#[test]
fn seek_forward_within_window() {
    let c = three_bridges(2026, 7);
    let main = c.landmarks.central_bridge;
    let cmds = [close(main[0], 400), close(main[1], 400)];
    let r = reference(world(&c.scenario, &cmds), 3600);
    let mut tl = Timeline::new(world(&c.scenario, &cmds), UNLIMITED);
    tl.step_n(3600);
    for t in [600u64, 3000, 3600, 100, 2999] {
        tl.seek(t).unwrap();
        assert_eq!((tl.position_tick(), tl.head_tick()), (t, 3600));
        assert_eq!(observe(tl.world()), r[t as usize], "seek({t})");
    }
}

// ─── 12 ──────────────────────────────────────────────────────────────────
#[test]
fn schedule_in_past_edits_future() {
    let c = three_bridges(2026, 7);
    let main = c.landmarks.central_bridge;
    let north = c.landmarks.north_bridge;
    let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    tl.schedule(close(main[0], 600)).unwrap();
    tl.schedule(open(main[0], 2000)).unwrap(); // later than the edit point: dropped by the edit
    tl.step_n(3600);
    tl.seek(1200).unwrap();
    // When a command is scheduled at the position, below the head
    tl.schedule(close(north[0], 1200)).unwrap();
    // Then the future is cut at the position
    assert_eq!(tl.head_tick(), 1200);
    assert_eq!(tl.position_tick(), 1200);
    assert!(tl.snapshot_ticks().iter().all(|&s| s <= 1200));
    assert_eq!(tl.snapshot_ticks().last(), Some(&1200));
    assert!(tl.world().command_log().iter().all(|c| c.tick <= 1200));
    // and the new future equals a fresh run with the commands ≤ 1200 plus the new one
    let r = reference(world(&c.scenario, &[close(main[0], 600), close(north[0], 1200)]), 2400);
    assert_eq!(observe(tl.world()), r[1200]);
    for t in 1201..=2400u64 {
        tl.step();
        assert_eq!(tl.world().state_hash(), r[t as usize].hash, "tick {t}");
    }
    assert!(tl.world().is_closed(main[0]), "the dropped reopen at 2000 never happened");
    // and a command before the position is still refused
    assert_eq!(tl.schedule(close(main[1], 10)), Err(CommandError::InPast));
}

// ─── 13 ──────────────────────────────────────────────────────────────────
#[test]
fn shared_data_not_copied() {
    let c = three_bridges(2026, 7);
    let w = World::from_scenario(c.scenario.clone()).unwrap();
    let keep = w.clone();
    assert!(std::ptr::eq(w.network(), keep.network()), "a clone shares the network");
    let mut tl = Timeline::new(w, UNLIMITED);
    tl.step_n(500);
    tl.seek(130).unwrap();
    assert!(std::ptr::eq(tl.world().network(), keep.network()), "a restored world shares the network");
    // the snapshot of an empty world (tick 0) holds no network-sized data: it is far below
    // the network plus the per-link state of a running city
    let empty = keep.snapshot().bytes();
    let mut running = keep.clone();
    for _ in 0..1200 {
        running.step();
    }
    assert!(empty < running.snapshot().bytes(), "snapshot bytes grow with vehicles, not with shared data");
}

// ─── 14 ──────────────────────────────────────────────────────────────────
#[test]
fn schedule_at_head_is_plain() {
    let c = three_bridges(2026, 7);
    let main = c.landmarks.central_bridge;
    let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    tl.step_n(700);
    let snaps = tl.snapshot_ticks();
    assert_eq!(tl.schedule(close(main[0], 699)), Err(CommandError::InPast));
    tl.schedule(close(main[0], 700)).unwrap();
    tl.schedule(open(main[0], 900)).unwrap();
    assert_eq!((tl.position_tick(), tl.head_tick()), (700, 700));
    assert_eq!(tl.snapshot_ticks(), snaps);
    assert_eq!(tl.world().command_log().len(), 2);
    let mut r = world(&c.scenario, &[]);
    for _ in 0..700 {
        r.step();
    }
    r.schedule(close(main[0], 700)).unwrap();
    r.schedule(open(main[0], 900)).unwrap();
    for _ in 0..400 {
        r.step();
        tl.step();
        assert_eq!(tl.world().state_hash(), r.state_hash());
    }
}
