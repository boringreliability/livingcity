//! Ward polish-005, tests 1–5: optimizations that change no result (golden hashes), incremental metrics,
//! schedules instead of full scans, shared snapshots.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)] // the wall clock only times calls from outside

use std::time::Instant;

use sim_core::cities::{river_city_scaled, three_bridges};
use sim_core::frame::metrics_to_extended_array;
use sim_core::{Command, CommandKind, Timeline, World};

const GIB: usize = 1024 * 1024 * 1024;

/// metrics() and the full-scan reference agree bit for bit.
fn same_metrics(w: &World, label: &str) {
    let a = metrics_to_extended_array(&w.metrics());
    let b = metrics_to_extended_array(&w.metrics_full_scan());
    assert_eq!(a.len(), b.len());
    for (i, (x, y)) in a.iter().zip(&b).enumerate() {
        assert_eq!(x.to_bits(), y.to_bits(), "{label}: metric {i} ({x} vs {y}) at tick {}", w.tick());
    }
}

fn river_timeline(scale: f64) -> (Timeline, Vec<sim_core::LinkId>) {
    let c = river_city_scaled(2026, 7, scale).unwrap();
    let bridge = c.landmarks.central_bridge.to_vec();
    (Timeline::new(World::from_scenario(c.scenario).unwrap(), GIB), bridge)
}

// 1
#[test]
fn golden_hashes_hold() {
    for (scale, tl_hash, b_hash) in [(1.0, 0x9cecb987d7f6b878u64, 0x236e8fa588763c38u64), (5.0, 0x7a5c02da65edf9cd, 0x95424bbf906870d9)] {
        let (mut tl, bridge) = river_timeline(scale);
        tl.step_n(3000);
        tl.seek(2000).unwrap();
        for l in bridge {
            tl.schedule(Command { tick: 2000, kind: CommandKind::CloseLink(l) }).unwrap();
        }
        tl.step_n(2000);
        let b = tl.branch(3000, GIB).unwrap();
        assert_eq!(tl.world().state_hash(), tl_hash, "×{scale} timeline");
        assert_eq!(b.world().state_hash(), b_hash, "×{scale} branch");
    }
    let c = three_bridges(17, 23);
    let mut w = World::from_scenario(c.scenario).unwrap();
    for b in [c.landmarks.north_bridge, c.landmarks.central_bridge, c.landmarks.south_bridge] {
        for l in b {
            w.schedule(Command { tick: 1190, kind: CommandKind::CloseLink(l) }).unwrap();
            w.schedule(Command { tick: 3000, kind: CommandKind::OpenLink(l) }).unwrap();
        }
    }
    for (t, h) in [(1200u64, 0xe972d745444936ecu64), (2400, 0x7c827e8fede308ff), (3600, 0xa7f1442ffcdac256)] {
        while w.tick() < t {
            w.step();
        }
        assert_eq!(w.state_hash(), h, "three_bridges at {t}");
    }
}

// 2
#[test]
fn incremental_metrics_equal_full_scan() {
    // River City ×3: closure, reopen, seeks both ways, a branch
    let (mut tl, bridge) = river_timeline(3.0);
    for l in &bridge {
        tl.schedule(Command { tick: 1200, kind: CommandKind::CloseLink(*l) }).unwrap();
        tl.schedule(Command { tick: 2400, kind: CommandKind::OpenLink(*l) }).unwrap();
    }
    for k in 0..60 {
        tl.step_n(60);
        same_metrics(tl.world(), &format!("×3 step {k}"));
    }
    for target in [1800u64, 600, 3000, 2401, 1201] {
        tl.seek(target).unwrap();
        same_metrics(tl.world(), &format!("×3 after seek {target}"));
        tl.step_n(37);
        same_metrics(tl.world(), &format!("×3 after seek {target} + 37"));
    }
    let mut b = tl.branch(tl.position_tick(), GIB).unwrap();
    same_metrics(b.world(), "×3 branch");
    for k in 0..10 {
        b.step_n(60);
        same_metrics(b.world(), &format!("×3 branch step {k}"));
    }
    // three_bridges with every bridge closed: stranded vehicles, unreachable removals
    let c = three_bridges(17, 23);
    let mut w = World::from_scenario(c.scenario).unwrap();
    for br in [c.landmarks.north_bridge, c.landmarks.central_bridge, c.landmarks.south_bridge] {
        for l in br {
            w.schedule(Command { tick: 1190, kind: CommandKind::CloseLink(l) }).unwrap();
        }
    }
    let mut saw_stranded = false;
    let mut saw_unreachable = false;
    for k in 0..60 {
        for _ in 0..60 {
            w.step();
        }
        let m = w.metrics_full_scan();
        saw_stranded |= m.stranded > 0;
        saw_unreachable |= m.removed_unreachable > 0;
        same_metrics(&w, &format!("three_bridges closed step {k}"));
    }
    assert!(saw_stranded && saw_unreachable, "the closed case is exercised");
}

// 3
#[test]
#[cfg_attr(debug_assertions, ignore = "timing: release only")]
fn metrics_is_cheap() {
    let (mut tl, _) = river_timeline(5.0);
    tl.step_n(7200);
    let w = tl.world();
    let time = |f: &dyn Fn() -> f64| {
        let t0 = Instant::now();
        let mut acc = 0.0;
        for _ in 0..500 {
            acc += f();
        }
        assert!(acc.is_finite());
        t0.elapsed().as_secs_f64() / 500.0
    };
    // warm both
    let _ = (w.metrics(), w.metrics_full_scan());
    let full = time(&|| w.metrics_full_scan().active as f64);
    let fast = time(&|| w.metrics().active as f64);
    assert!(fast <= 0.25 * full, "metrics() {:.4} ms vs full scan {:.4} ms", fast * 1e3, full * 1e3);
}

// 4
#[test]
fn schedules_visit_only_due_slots() {
    let (mut tl, _) = river_timeline(5.0);
    tl.step_n(7200);
    let live = tl.world().metrics_full_scan().active as f64;
    for _ in 0..240 {
        tl.step();
        let (periodic, retries) = tl.world().last_step_visits();
        assert!((periodic as f64) <= 1.2 * live / 240.0 + 10.0, "periodic visited {periodic} slots of {live} live");
        // retries: only due slots (none are without a route in this open city)
        assert_eq!(retries, 0, "retry step visited {retries} slots with no retry due");
    }
}

// 5
#[test]
fn branch_shares_snapshots() {
    let (mut tl, _) = river_timeline(1.0);
    tl.step_n(3 * 7200);
    let at = tl.position_tick() - 1000;
    let below = tl.snapshot_ticks().into_iter().filter(|&t| t < at).count();
    let b = tl.branch(at, GIB).unwrap();
    assert_eq!(tl.shared_snapshots(&b), below, "a big B shares every snapshot below at");
    // a small B budget: it keeps (and shares) only what fits
    let small = tl.branch(at, 8 * 1024 * 1024).unwrap();
    let kept_below = small.snapshot_ticks().into_iter().filter(|&t| t < at).count();
    assert!(kept_below < below);
    assert_eq!(tl.shared_snapshots(&small), kept_below);
    assert!(small.window().snapshot_bytes <= 8 * 1024 * 1024);
    // still independent
    let mut b = b;
    let a_hash = tl.world().state_hash();
    b.step_n(500);
    assert_eq!(tl.world().state_hash(), a_hash, "stepping B does not change A");
    let b_hash = b.world().state_hash();
    tl.seek(at - 300).unwrap();
    tl.step_n(10);
    assert_eq!(b.world().state_hash(), b_hash, "a seek in A does not change B");
}
