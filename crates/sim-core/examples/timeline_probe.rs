//! Snapshot size, retained window and seek cost on River City (ward timeline-001).
//! `cargo run -p sim-core --release --example timeline_probe`
// A measurement tool, not simulation logic: the wall clock only times the timeline from outside.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::time::Instant;

use sim_core::cities::river_city;
use sim_core::{Command, CommandKind, Timeline, World};

const MIB: usize = 1024 * 1024;

fn pct(v: &mut [f64], p: f64) -> f64 {
    v.sort_by(f64::total_cmp);
    v[((p * v.len() as f64).ceil() as usize).clamp(1, v.len()) - 1]
}

fn main() {
    let budget = 48 * MIB;
    let c = river_city(2026, 7);
    let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), budget);
    let hours = 3;
    let t0 = Instant::now();
    tl.step_n(hours * 7200);
    let run_s = t0.elapsed().as_secs_f64();
    let w = tl.window();
    let per = w.snapshot_bytes as f64 / w.snapshots as f64;
    println!("River City 2026/7, {hours} sim h stepped in {run_s:.2} s (with snapshots)");
    println!(
        "snapshots: {} held, {:.2} MiB of {:.0} MiB budget, {:.0} KB each on average",
        w.snapshots,
        w.snapshot_bytes as f64 / MIB as f64,
        budget as f64 / MIB as f64,
        per / 1000.0
    );
    println!(
        "window: ticks {}..={} ({:.2} sim h retained)",
        w.window_start,
        w.head_tick,
        (w.head_tick - w.window_start) as f64 / 7200.0
    );
    // seek cost over targets spread across the window (deterministic spread)
    let mut ms = Vec::new();
    let mut replayed = Vec::new();
    let span = w.head_tick - w.window_start;
    for k in 0..200u64 {
        let target = w.window_start + (k * 7919) % (span + 1);
        let t = Instant::now();
        tl.seek(target).unwrap();
        ms.push(t.elapsed().as_secs_f64() * 1000.0);
        replayed.push(tl.last_seek_replayed_ticks() as f64);
    }
    println!(
        "seek: median {:.2} ms, p95 {:.2} ms, max {:.2} ms; replayed ticks median {:.0}, max {:.0} (n = 200)",
        pct(&mut ms.clone(), 0.5),
        pct(&mut ms.clone(), 0.95),
        pct(&mut ms, 1.0),
        pct(&mut replayed.clone(), 0.5),
        pct(&mut replayed, 1.0)
    );

    // branch cost across the window, and A vs B (main bridge closed in B) over the same window
    let mut bms = Vec::new();
    for k in 0..50u64 {
        let at = w.window_start + (k * 104_729) % (span + 1);
        let t = Instant::now();
        let b = tl.branch(at, budget).unwrap();
        bms.push(t.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(b.position_tick(), at);
    }
    println!(
        "branch: median {:.2} ms, p95 {:.2} ms, max {:.2} ms (n = 50)",
        pct(&mut bms.clone(), 0.5),
        pct(&mut bms.clone(), 0.95),
        pct(&mut bms, 1.0)
    );
    let at = 7200;
    tl.seek(at).unwrap();
    let mut a = tl.branch(at, budget).unwrap();
    let mut b = tl.branch(at, budget).unwrap();
    for l in c.landmarks.central_bridge {
        b.schedule(Command {
            tick: at,
            kind: CommandKind::CloseLink(l),
        })
        .unwrap();
    }
    a.step_n(2400);
    b.step_n(2400);
    let (ma, mb) = (a.world().window_metrics(at), b.world().window_metrics(at));
    let show = |m: &sim_core::WindowMetrics| {
        format!(
            "generated {}, completed {}, incomplete {}, removed {}, mean {:.0} s, p95 {:.0} s",
            m.generated,
            m.completed,
            m.incomplete,
            m.removed_unreachable + m.removed_gridlock,
            m.mean_travel_time_s.unwrap_or(f64::NAN),
            m.p95_travel_time_s.unwrap_or(f64::NAN)
        )
    };
    println!(
        "window {}..{} (20 sim min after the branch):",
        at,
        at + 2400
    );
    println!("  A (open):   {}", show(&ma));
    println!("  B (closed): {}", show(&mb));
}
