//! Gridlock relief (contract C2) on two small rings.
//!
//! `cargo run -p sim-core --release --example gridlock`
//!
//! Ring A is a pure deadlock: four full one-lane links, every front waiting for the
//! next one. Nothing can be rerouted, so after 10 min blocked the fronts are removed
//! and the ring drains. Ring B is the same ring plus a long detour from junction 0
//! to junction 1: after 60 s blocked, the front at junction 0 reroutes over it.

use sim_core::{LinkId, NetworkBuilder, World};

fn ring(detour: bool) -> World {
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
    if detour {
        let e = b.node(side / 2.0, -1000.0);
        b.link(n[0], e, 10.0, 1);
        b.link(e, n[1], 10.0, 1);
    }
    let mut w = World::new(b.build().expect("valid ring"));
    for _ in 0..40 {
        for i in 0..4 {
            let mut r = vec![conn[i]];
            r.extend((0..4).map(|j| ring[(i + j) % 4]));
            r.push(exit[i]);
            w.spawn_with_route(r).expect("valid route");
        }
    }
    w
}

fn main() {
    for (name, detour) in [("A (pure deadlock)", false), ("B (with detour)", true)] {
        let mut w = ring(detour);
        println!("ring {name}");
        println!(
            "{:>6} {:>8} {:>15} {:>11} {:>16} {:>18} {:>10}",
            "sim", "active", "blocked fronts", "max blocked", "gridlock reroutes", "gridlock removals", "completed"
        );
        for t in 0..(40 * 60 * 2u64) {
            w.step();
            if (t + 1) % 60 == 0 {
                let blocked: Vec<u32> =
                    w.vehicle_ids().into_iter().map(|id| w.vehicle(id).unwrap().blocked_ticks).collect();
                let blocked_fronts = blocked.iter().filter(|&&b| b > 0).count();
                let max_blocked = blocked.iter().copied().max().unwrap_or(0);
                let m = w.metrics();
                let s = w.tick() / 2; // sim seconds (DT = 0.5 s)
                println!(
                    "{:>3}:{:02} {:>8} {:>15} {:>9.1} s {:>16} {:>18} {:>10}",
                    s / 60,
                    s % 60,
                    m.active,
                    blocked_fronts,
                    max_blocked as f64 * 0.5,
                    w.reroute_stats().gridlock_reroutes,
                    m.removed_gridlock,
                    m.completed
                );
                if m.active == 0 {
                    break;
                }
            }
        }
        println!();
    }
}
