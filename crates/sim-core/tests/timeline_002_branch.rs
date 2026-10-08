//! Ward timeline-002: branches and window metrics (contract `.wdd/epics/timeline.md` § T2).
#![allow(clippy::needless_range_loop)]

use sim_core::cities::{river_city, three_bridges};
use sim_core::params::DT;
use sim_core::{
    Command, CommandKind, LinkId, NetworkBuilder, Scenario, Timeline, TimelineError, TripOutcome, WindowMetrics, World,
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

fn stepped(s: &Scenario, cmds: &[Command], ticks: u64) -> World {
    let mut w = world(s, cmds);
    for _ in 0..ticks {
        w.step();
    }
    w
}

/// What a branch / timeline must equal at its tick.
#[derive(Debug, PartialEq)]
struct Observed {
    tick: u64,
    hash: u64,
    generated: Vec<(u64, usize, u64)>,
    completed: Vec<(u64, u64)>,
    metrics: String,
}

fn observe(w: &World) -> Observed {
    Observed {
        tick: w.tick(),
        hash: w.state_hash(),
        generated: w.generated_trips().iter().map(|t| (t.trip_id, t.flow_index, t.created_tick)).collect(),
        completed: w.completed_log().iter().map(|c| (c.trip_id, c.completed_tick)).collect(),
        metrics: format!("{:?}", w.metrics()),
    }
}

/// Everything about a timeline that `branch` must leave untouched.
fn fingerprint(t: &Timeline) -> (u64, u64, u64, Vec<u64>, Vec<Command>, usize, usize) {
    let w = t.world();
    (
        w.state_hash(),
        t.position_tick(),
        t.head_tick(),
        t.snapshot_ticks(),
        w.command_log().to_vec(),
        w.generated_trips().len(),
        w.completed_log().len(),
    )
}

fn river() -> (Scenario, sim_core::Landmarks) {
    let c = river_city(2026, 7);
    (c.scenario.clone(), c.landmarks)
}

// ─── 1 ───────────────────────────────────────────────────────────────────
#[test]
fn branch_equals_original_at_tick() {
    let (s, lm) = river();
    let cmds = [close(lm.central_bridge[0], 1800), close(lm.central_bridge[1], 1800)];
    let mut a = Timeline::new(world(&s, &cmds), UNLIMITED);
    a.step_n(3600);
    a.seek(2222).unwrap(); // the position is behind the head: branch must not care
    let before = fingerprint(&a);
    for at in [0u64, 120, 1799, 1800, 1801, 2500, 3600] {
        let b = a.branch(at, UNLIMITED).expect("inside the window");
        let inherited: Vec<Command> = cmds.iter().copied().filter(|c| c.tick < at).collect();
        assert_eq!(observe(b.world()), observe(&stepped(&s, &inherited, at)), "branch({at})");
        assert_eq!((b.position_tick(), b.head_tick()), (at, at));
        assert_eq!(fingerprint(&a), before, "branch({at}) changed the original");
    }
}

// ─── 2 ───────────────────────────────────────────────────────────────────
#[test]
fn branch_takes_commands_before_the_tick() {
    let c = three_bridges(2026, 7);
    let main = c.landmarks.central_bridge;
    let mut a = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    a.schedule(close(main[0], 1800)).unwrap();
    a.schedule(open(main[0], 2400)).unwrap();
    a.step_n(3000);
    assert!(a.branch(1800, UNLIMITED).unwrap().world().command_log().is_empty(), "a command at `at` is not inherited");
    assert_eq!(a.branch(1801, UNLIMITED).unwrap().world().command_log(), &[close(main[0], 1800)]);
    assert_eq!(a.branch(2000, UNLIMITED).unwrap().world().command_log(), &[close(main[0], 1800)]);
    assert_eq!(a.branch(2401, UNLIMITED).unwrap().world().command_log(), &[close(main[0], 1800), open(main[0], 2400)]);
    // the branch at 1800 never closes the bridge
    let mut b = a.branch(1800, UNLIMITED).unwrap();
    b.step_n(100);
    assert!(!b.world().is_closed(main[0]));
}

// ─── 3 ───────────────────────────────────────────────────────────────────
#[test]
fn branches_are_independent() {
    let (s, lm) = river();
    let a_cmds = [close(lm.central_bridge[0], 1800), close(lm.central_bridge[1], 1800), open(lm.central_bridge[0], 3000)];
    let mut ra = world(&s, &a_cmds);
    let mut a = Timeline::new(world(&s, &a_cmds), UNLIMITED);
    a.step_n(1800);
    for _ in 0..1800 {
        ra.step();
    }
    let mut b = a.branch(1800, UNLIMITED).unwrap();
    let b_own = [close(lm.south_bridge[0], 1800), close(lm.south_bridge[1], 1800)];
    for c in b_own {
        b.schedule(c).unwrap();
    }
    let mut rb = stepped(&s, &b_own, 1800);
    for t in 1801..=4200u64 {
        // interleave: B steps first, then A (no shared state may leak either way)
        b.step();
        a.step();
        ra.step();
        rb.step();
        assert_eq!(a.world().state_hash(), ra.state_hash(), "A at {t}");
        assert_eq!(b.world().state_hash(), rb.state_hash(), "B at {t}");
    }
    assert!(a.world().is_closed(lm.central_bridge[1]) && !b.world().is_closed(lm.central_bridge[1]));
    assert!(b.world().is_closed(lm.south_bridge[0]) && !a.world().is_closed(lm.south_bridge[0]));
}

// ─── 4 ───────────────────────────────────────────────────────────────────
#[test]
fn identical_demand_across_branches() {
    let (s, lm) = river();
    let mut a = Timeline::new(world(&s, &[close(lm.central_bridge[0], 1800), close(lm.central_bridge[1], 1800)]), UNLIMITED);
    a.step_n(1800);
    let mut b = a.branch(1800, UNLIMITED).unwrap(); // B keeps the bridge open
    a.step_n(3600);
    b.step_n(3600);
    assert_eq!((a.position_tick(), b.position_tick()), (5400, 5400));
    assert_eq!(a.world().generated_trips(), b.world().generated_trips(), "identical external demand");
    assert_ne!(a.world().completed_log(), b.world().completed_log(), "precondition: the scenarios differ");
}

// ─── 5 ───────────────────────────────────────────────────────────────────
#[test]
fn branch_snapshots_and_history() {
    let c = three_bridges(2026, 7);
    let main = c.landmarks.central_bridge;
    let mut a = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    a.schedule(close(main[0], 300)).unwrap();
    a.step_n(2400);
    for at in [1000u64, 1080] {
        let mut b = a.branch(at, UNLIMITED).unwrap();
        let mut want: Vec<u64> = a.snapshot_ticks().into_iter().filter(|&t| t < at).collect();
        want.push(at);
        assert_eq!(b.snapshot_ticks(), want, "branch({at})");
        // history before `at` is A's
        for t in [0u64, 299, 300, 777, at - 1] {
            b.seek(t).unwrap();
            a.seek(t).unwrap();
            assert_eq!(observe(b.world()), observe(a.world()), "seek({t}) in branch({at})");
        }
        // and B's own snapshots continue at the multiples of 120
        b.seek(at).unwrap();
        b.step_n(400);
        let next: Vec<u64> = b.snapshot_ticks().into_iter().filter(|&t| t > at).collect();
        let expect: Vec<u64> = ((at / SNAPSHOT_INTERVAL_TICKS + 1)..)
            .map(|k| k * SNAPSHOT_INTERVAL_TICKS)
            .take_while(|&t| t <= at + 400)
            .collect();
        assert_eq!(next, expect);
    }
}

// ─── 6 ───────────────────────────────────────────────────────────────────
#[test]
fn branch_budget() {
    let c = three_bridges(2026, 7);
    let mut a = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    a.step_n(2400);
    let one = a.world().snapshot().bytes();
    let small = a.branch(1500, 3 * one).unwrap();
    assert!(small.window().snapshot_bytes <= 3 * one);
    assert_eq!(small.window().budget_bytes, 3 * one);
    assert_eq!(small.snapshot_ticks().last(), Some(&1500), "the branch point is the newest snapshot");
    assert!(small.snapshot_ticks().len() >= 2);
    let full = a.branch(1500, UNLIMITED).unwrap();
    assert_eq!(full.snapshot_ticks().len(), a.snapshot_ticks().iter().filter(|&&t| t < 1500).count() + 1);
}

// ─── 7 ───────────────────────────────────────────────────────────────────
#[test]
fn branch_outside_window_is_refused() {
    let c = three_bridges(2026, 7);
    let mut sizer = World::from_scenario(c.scenario.clone()).unwrap();
    for _ in 0..600 {
        sizer.step();
    }
    let mut a = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), 4 * sizer.snapshot().bytes());
    a.step_n(2400);
    let start = a.window().window_start;
    assert!(start > 0, "precondition: eviction happened");
    let before = fingerprint(&a);
    for at in [start - 1, 2401] {
        assert_eq!(
            a.branch(at, UNLIMITED).err(),
            Some(TimelineError::OutsideWindow { tick: at, window_start: start, head_tick: 2400 })
        );
        assert_eq!(fingerprint(&a), before);
    }
}

// ─── 8 ───────────────────────────────────────────────────────────────────
#[test]
fn branch_edits_never_touch_the_original() {
    let c = three_bridges(2026, 7);
    let lm = c.landmarks;
    let mut a = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    a.schedule(close(lm.central_bridge[0], 400)).unwrap();
    let mut ra = world(&c.scenario, &[close(lm.central_bridge[0], 400)]);
    a.step_n(1200);
    for _ in 0..1200 {
        ra.step();
    }
    let mut b = a.branch(1000, UNLIMITED).unwrap();
    b.step_n(800);
    b.seek(1300).unwrap();
    b.schedule(close(lm.north_bridge[1], 1300)).unwrap();
    b.step_n(500);
    b.seek(1100).unwrap();
    b.schedule(open(lm.central_bridge[0], 1100)).unwrap();
    b.step_n(300);
    let snaps = a.snapshot_ticks();
    let log = a.world().command_log().to_vec();
    for _ in 0..1200 {
        a.step();
        ra.step();
        assert_eq!(a.world().state_hash(), ra.state_hash(), "A at {}", ra.tick());
    }
    assert_eq!(a.world().command_log(), &log[..]);
    assert!(a.snapshot_ticks().starts_with(&snaps));
}

// ─── 9 ───────────────────────────────────────────────────────────────────
#[test]
fn branch_of_a_branch_and_at_head() {
    let c = three_bridges(2026, 7);
    let lm = c.landmarks;
    let mut a = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), UNLIMITED);
    a.schedule(close(lm.central_bridge[0], 500)).unwrap();
    a.step_n(1500);
    let at_head = a.branch(1500, UNLIMITED).unwrap();
    assert_eq!(observe(at_head.world()), observe(a.world()));
    let at_start = a.branch(0, UNLIMITED).unwrap();
    assert_eq!(observe(at_start.world()), observe(&World::from_scenario(c.scenario.clone()).unwrap()));
    assert_eq!(at_start.snapshot_ticks(), vec![0]);
    let at_snap = a.branch(960, UNLIMITED).unwrap();
    let ticks = at_snap.snapshot_ticks();
    assert_eq!(ticks.iter().filter(|&&t| t == 960).count(), 1, "no duplicate snapshot at a snapshot tick");
    // a branch of a branch
    let mut b = a.branch(1200, UNLIMITED).unwrap();
    b.schedule(close(lm.north_bridge[0], 1200)).unwrap();
    b.step_n(300);
    let bb = b.branch(1350, UNLIMITED).unwrap();
    let r = stepped(&c.scenario, &[close(lm.central_bridge[0], 500), close(lm.north_bridge[0], 1200)], 1350);
    assert_eq!(observe(bb.world()), observe(&r));
}

// ─── 10 ──────────────────────────────────────────────────────────────────

/// Independent window metrics: the cohort is the demand trips created at or after `from`.
fn brute(w: &World, from: u64) -> WindowMetrics {
    let mut m = WindowMetrics {
        from_tick: from,
        to_tick: w.tick(),
        generated: 0,
        completed: 0,
        removed_unreachable: 0,
        removed_gridlock: 0,
        incomplete: 0,
        mean_travel_time_s: None,
        p95_travel_time_s: None,
    };
    let mut tts = Vec::new();
    for t in w.generated_trips().iter().filter(|t| t.created_tick >= from) {
        m.generated += 1;
        match w.trip_outcome(t.trip_id) {
            TripOutcome::Live => m.incomplete += 1,
            TripOutcome::Completed { travel_time_s } => {
                m.completed += 1;
                tts.push(travel_time_s);
            }
            TripOutcome::RemovedUnreachable => m.removed_unreachable += 1,
            TripOutcome::RemovedGridlock => m.removed_gridlock += 1,
            TripOutcome::Unknown => panic!("a generated trip is never unknown"),
        }
    }
    if !tts.is_empty() {
        m.mean_travel_time_s = Some(tts.iter().sum::<f64>() / tts.len() as f64);
        tts.sort_by(f64::total_cmp);
        let rank = ((0.95 * tts.len() as f64).ceil() as usize).max(1);
        m.p95_travel_time_s = Some(tts[rank - 1]);
    }
    m
}

fn assert_metrics_eq(got: &WindowMetrics, want: &WindowMetrics, what: &str) {
    let close = |a: Option<f64>, b: Option<f64>| match (a, b) {
        (Some(x), Some(y)) => (x - y).abs() <= 1e-9 * y.abs().max(1.0),
        (None, None) => true,
        _ => false,
    };
    assert_eq!(
        (got.from_tick, got.to_tick, got.generated, got.completed, got.removed_unreachable, got.removed_gridlock, got.incomplete),
        (want.from_tick, want.to_tick, want.generated, want.completed, want.removed_unreachable, want.removed_gridlock, want.incomplete),
        "{what}"
    );
    assert!(close(got.mean_travel_time_s, want.mean_travel_time_s), "{what}: mean {got:?} vs {want:?}");
    assert!(close(got.p95_travel_time_s, want.p95_travel_time_s), "{what}: p95 {got:?} vs {want:?}");
}

#[test]
fn window_metrics_match_brute_force() {
    let (s, lm) = river();
    let w = stepped(&s, &[close(lm.central_bridge[0], 1800), close(lm.central_bridge[1], 1800)], 4200);
    for from in [0u64, 1800, 3000, 4200] {
        let got = w.window_metrics(from);
        assert_metrics_eq(&got, &brute(&w, from), &format!("from {from}"));
    }
    let m = w.window_metrics(1800);
    assert!(m.completed > 0 && m.incomplete > 0, "precondition: a mixed cohort {m:?}");
    // travel times are whole ticks × DT
    let mean = m.mean_travel_time_s.unwrap();
    assert!(mean > DT && m.p95_travel_time_s.unwrap() >= mean);
}

// ─── 11 ──────────────────────────────────────────────────────────────────
#[test]
fn window_metrics_partition() {
    let c = three_bridges(2026, 7);
    let mut w = world(&c.scenario, &[close(c.landmarks.central_bridge[0], 600)]);
    for tick in 1..=2400u64 {
        w.step();
        if tick % 300 != 0 {
            continue;
        }
        for from in [0u64, 1, 299, 600, tick / 2, tick, tick + 1, tick + 1000] {
            let m = w.window_metrics(from);
            assert_eq!(m.generated, m.completed + m.removed_unreachable + m.removed_gridlock + m.incomplete, "from {from} at {tick}");
            let gen = w.generated_trips().iter().filter(|t| t.created_tick >= from).count() as u64;
            assert_eq!(m.generated, gen);
            assert_eq!((m.from_tick, m.to_tick), (from, tick));
            if from > tick {
                assert_eq!((m.generated, m.completed, m.incomplete), (0, 0, 0));
                assert_eq!((m.mean_travel_time_s, m.p95_travel_time_s), (None, None));
            }
        }
    }
}

// ─── 12 ──────────────────────────────────────────────────────────────────
#[test]
fn window_metrics_count_removals() {
    let c = three_bridges(2026, 7);
    let lm = c.landmarks;
    let cmds: Vec<Command> = [lm.north_bridge, lm.central_bridge, lm.south_bridge]
        .into_iter()
        .flatten()
        .map(|l| close(l, 500))
        .collect();
    let w = stepped(&c.scenario, &cmds, 3000);
    assert!(w.metrics().removed_unreachable > 0, "precondition: unreachable removals (probed: from tick 1101)");
    for from in [0u64, 400, 1000] {
        let got = w.window_metrics(from);
        assert_metrics_eq(&got, &brute(&w, from), &format!("from {from}"));
    }
    assert!(w.window_metrics(0).removed_unreachable > 0);
}

// ─── 13 ──────────────────────────────────────────────────────────────────

/// The city-001 ring (explicit spawns only, no demand): it deadlocks, then relief removes vehicles.
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

#[test]
fn window_metrics_exclude_explicit_spawns() {
    let mut w = ring();
    for _ in 0..4000 {
        w.step();
    }
    assert!(w.metrics().removed_gridlock > 0 || w.metrics().completed > 0, "precondition: spawned trips ended");
    let m = w.window_metrics(0);
    assert_eq!((m.generated, m.completed, m.removed_unreachable, m.removed_gridlock, m.incomplete), (0, 0, 0, 0, 0));
    assert_eq!((m.mean_travel_time_s, m.p95_travel_time_s), (None, None));
}

// ─── 14 ──────────────────────────────────────────────────────────────────
#[test]
fn same_window_compares_like_for_like() {
    let (s, lm) = river();
    let mut a = Timeline::new(World::from_scenario(s).unwrap(), UNLIMITED);
    a.step_n(1800);
    let mut b = a.branch(1800, UNLIMITED).unwrap();
    for l in lm.central_bridge {
        b.schedule(close(l, 1800)).unwrap();
    }
    a.step_n(2400);
    b.step_n(2400);
    let (ma, mb) = (a.world().window_metrics(1800), b.world().window_metrics(1800));
    assert_eq!(ma.generated, mb.generated, "identical cohorts");
    for m in [&ma, &mb] {
        assert_eq!(m.generated, m.completed + m.removed_unreachable + m.removed_gridlock + m.incomplete);
    }
    assert!(mb.incomplete > ma.incomplete, "closing the main bridge leaves more trips unfinished: {mb:?} vs {ma:?}");
    assert!(mb.completed < ma.completed);
}
