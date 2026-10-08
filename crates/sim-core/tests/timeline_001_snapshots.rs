//! Ward timeline-001: snapshots, restore and seek (contract `.wdd/epics/timeline.md` § T1).
//! Runs in the default test profile (opt-level 2): the River City tests take a few seconds.
#![allow(clippy::needless_range_loop)]

use sim_core::cities::{river_city, three_bridges};
use sim_core::params::REROUTE_BUDGET_PER_TICK;
use sim_core::{
    Command, CommandError, CommandKind, LinkId, NetworkBuilder, OdFlow, Scenario, Timeline, TimelineError, VehicleInfo,
    World, SNAPSHOT_INTERVAL_TICKS,
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
    // snapshots continue past the old head, and history beyond it can be sought
    let want: Vec<u64> = (0..=40).map(|k| k * SNAPSHOT_INTERVAL_TICKS).collect();
    assert_eq!(tl.snapshot_ticks(), want);
    tl.seek(4500).unwrap();
    assert_eq!(observe(tl.world()), r[4500]);
}

// ─── 3 ───────────────────────────────────────────────────────────────────
#[test]
fn seek_mid_epoch_and_mid_reroute() {
    let (s, main) = river();
    let cmds = [close(main[0], 1800), close(main[1], 1800)];
    let r = reference(world(&s, &cmds), 2100);
    // precondition: the closure makes vehicles switch routes right after 1800 (switches only follow a closure here)
    let switches = |t: u64| {
        let mut w = world(&s, &cmds);
        for _ in 0..t {
            w.step();
        }
        w.reroute_stats().switches_total
    };
    assert!(switches(1840) > switches(1800), "precondition: rerouting switches happen after the closure");
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
    assert!(tl.window().snapshots >= 4, "the budget (5 snapshots) must not over-evict: {}", tl.window().snapshots);
    let target = tl.window().window_start + 7;
    tl.seek(target).unwrap();
    assert_eq!(tl.window().position_tick, target);
    assert_eq!(tl.window().head_tick, 7200);
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
    let r = reference(World::from_scenario(c.scenario.clone()).unwrap(), 2400);
    let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), 4 * sizer.snapshot().bytes());
    tl.step_n(2400);
    let start = tl.window().window_start;
    assert!(start > 0, "precondition: eviction happened");
    // inside the window after eviction: equal to the reference
    for t in [start, start + 37] {
        tl.seek(t).unwrap();
        assert_eq!(observe(tl.world()), r[t as usize], "seek({t}) after eviction");
    }
    tl.seek(start + 37).unwrap();
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
    let before = (tl.head_tick(), tl.snapshot_ticks(), tl.world().command_log().to_vec(), tl.world().state_hash());
    // invalid commands are refused before anything is cut
    assert_eq!(tl.schedule(close(north[0], 1199)), Err(CommandError::InPast));
    assert_eq!(tl.schedule(close(LinkId(u32::MAX), 1200)), Err(CommandError::UnknownLink(LinkId(u32::MAX))));
    assert_eq!((tl.head_tick(), tl.snapshot_ticks(), tl.world().command_log().to_vec(), tl.world().state_hash()), before);
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
    // and snapshots are taken again after the edit
    let want: Vec<u64> = (0..=20).map(|k| k * SNAPSHOT_INTERVAL_TICKS).collect();
    assert_eq!(tl.snapshot_ticks(), want);
    // and the edited history can be sought (the timeline's command log and logs, not stale copies)
    for t in [1800u64, 1201, 700, 1200, 2400, 1500] {
        tl.seek(t).unwrap();
        assert_eq!(observe(tl.world()), r[t as usize], "seek({t}) after the edit");
    }
    // and a command before the position is still refused
    assert_eq!(tl.schedule(close(main[1], 10)), Err(CommandError::InPast));
}

#[test]
fn schedule_in_past_edits_future_off_grid() {
    let c = three_bridges(2026, 7);
    let main = c.landmarks.central_bridge;
    let north = c.landmarks.north_bridge;
    let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    tl.schedule(close(main[0], 600)).unwrap();
    tl.schedule(open(main[0], 1280)).unwrap(); // after the edit point: dropped
    tl.step_n(3000);
    tl.seek(1250).unwrap();
    tl.schedule(close(north[1], 1300)).unwrap();
    assert_eq!((tl.position_tick(), tl.head_tick()), (1250, 1250));
    assert_eq!(tl.snapshot_ticks().last(), Some(&1200));
    let r = reference(world(&c.scenario, &[close(main[0], 600), close(north[1], 1300)]), 2400);
    for t in 1251..=2400u64 {
        tl.step();
        assert_eq!(tl.world().state_hash(), r[t as usize].hash, "tick {t}");
    }
    for t in [1260u64, 1300, 1299, 2000, 1250] {
        tl.seek(t).unwrap();
        assert_eq!(observe(tl.world()), r[t as usize], "seek({t})");
    }
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
    // a much larger demand model (2,000 more profile points and flows) does not change the bytes
    // of a snapshot: demand is shared data, not snapshotted
    let mut big = c.scenario.clone();
    let last = big.demand.profile.points.last().copied().unwrap_or((0.0, 1.0));
    for k in 1..=2000 {
        big.demand.profile.points.push((last.0 + k as f64, last.1));
    }
    let f0 = big.demand.flows[0];
    for _ in 0..2000 {
        big.demand.flows.push(OdFlow { origin: f0.origin, dest: f0.dest, veh_per_hour: 0.001 });
    }
    let big_world = World::from_scenario(big).expect("valid larger demand");
    assert_eq!(big_world.snapshot().bytes(), keep.snapshot().bytes(), "demand must not be in snapshot bytes");
    // and the demand model itself is shared by clones and restored worlds
    assert!(std::ptr::eq(tl.world().demand(), keep.demand()), "a restored world shares the demand model");
    let again = keep.clone();
    assert!(std::ptr::eq(again.demand(), keep.demand()), "a clone shares the demand model");
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

// ─── 15 ──────────────────────────────────────────────────────────────────
#[test]
fn snapshot_holds_reroute_backlog() {
    let (s, main) = river();
    let cmds = [close(main[0], 1919), close(main[1], 1919)];
    // reference with reroute stats per tick
    let mut rw = world(&s, &cmds);
    let mut r = vec![observe(&rw)];
    let mut stats = vec![rw.reroute_stats()];
    for _ in 0..2200 {
        rw.step();
        r.push(observe(&rw));
        stats.push(rw.reroute_stats());
    }
    // precondition: the snapshot tick 1920 holds a budget-limited backlog that step 1920 → 1921 works on
    assert_eq!(stats[1920].max_budgeted_in_a_tick, REROUTE_BUDGET_PER_TICK, "precondition: the budget was hit");
    assert!(stats[1921].switches_total > stats[1920].switches_total, "precondition: the backlog is processed after 1920");
    let mut tl = Timeline::new(world(&s, &cmds), UNLIMITED);
    tl.step_n(2200);
    assert!(tl.snapshot_ticks().contains(&1920));
    for t in [1920u64, 1921, 1927, 2039] {
        tl.seek(t).unwrap();
        assert_eq!(observe(tl.world()), r[t as usize], "seek({t})");
        let mut probe = Timeline::new(tl.world().clone(), UNLIMITED);
        for k in 1..=120u64.min(2200 - t) {
            probe.step();
            assert_eq!(probe.world().state_hash(), r[(t + k) as usize].hash, "seek({t}) + {k}");
        }
    }
}

// ─── 16 ──────────────────────────────────────────────────────────────────
#[test]
fn snapshot_holds_noroute_and_stranded() {
    let c = three_bridges(2026, 7);
    let lm = c.landmarks;
    let bridges = [lm.north_bridge, lm.central_bridge, lm.south_bridge];
    let mut cmds = Vec::new();
    for b in bridges {
        for l in b {
            cmds.push(close(l, 500));
            cmds.push(open(l, 1100));
        }
    }
    let mut rw = world(&c.scenario, &cmds);
    let mut r = vec![observe(&rw)];
    let mut m = vec![(rw.metrics().no_route, rw.metrics().stranded)];
    for _ in 0..2400 {
        rw.step();
        r.push(observe(&rw));
        m.push((rw.metrics().no_route, rw.metrics().stranded));
    }
    // precondition: snapshots between 600 and 1080 hold no-route and stranded vehicles, and retries ran
    for snap in (600..=1080).step_by(SNAPSHOT_INTERVAL_TICKS as usize) {
        assert!(m[snap].0 > 0 && m[snap].1 > 0, "precondition at snapshot {snap}: {:?}", m[snap]);
    }
    assert!(rw.reroute_stats().retries_total > 0, "precondition: NoRoute retries happened");
    let mut tl = Timeline::new(world(&c.scenario, &cmds), UNLIMITED);
    tl.step_n(2400);
    for t in [700u64, 1150, 1500] {
        tl.seek(t).unwrap();
        assert_eq!(observe(tl.world()), r[t as usize], "seek({t})");
    }
    tl.seek(700).unwrap();
    for t in 701..=2400u64 {
        tl.step();
        assert_eq!(tl.world().state_hash(), r[t as usize].hash, "replay from 700: tick {t}");
    }
}

// ─── 17 ──────────────────────────────────────────────────────────────────
#[test]
fn schedule_in_past_keeps_commands_at_the_position() {
    let c = three_bridges(2026, 7);
    let (main, north, south) = (c.landmarks.central_bridge, c.landmarks.north_bridge, c.landmarks.south_bridge);
    let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    tl.schedule(close(main[0], 600)).unwrap();
    tl.schedule(close(south[0], 1200)).unwrap(); // pending exactly at the edit position: kept
    tl.schedule(open(main[0], 2000)).unwrap(); // after it: dropped
    tl.step_n(3600);
    tl.seek(1200).unwrap();
    tl.schedule(close(north[0], 1200)).unwrap();
    assert_eq!(tl.world().command_log().len(), 3, "the command at the position tick is kept");
    let r = reference(world(&c.scenario, &[close(main[0], 600), close(south[0], 1200), close(north[0], 1200)]), 2400);
    for t in 1201..=2400u64 {
        tl.step();
        assert_eq!(tl.world().state_hash(), r[t as usize].hash, "tick {t}");
    }
}
