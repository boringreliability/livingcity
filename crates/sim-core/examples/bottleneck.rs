//! Spillback demo: 3-lane L1 → 1-lane 150 m bottleneck L2 → free L3,
//! demand 0.67 veh/s (above the bottleneck's 0.5 veh/s).
//!
//! `cargo run -p sim-core --example bottleneck`

use sim_core::params::DT;
use sim_core::{NetworkBuilder, World};

fn main() {
    let mut b = NetworkBuilder::new();
    let o = b.node(0.0, 0.0);
    let a = b.node(300.0, 0.0);
    let c = b.node(450.0, 0.0);
    let d = b.node(950.0, 0.0);
    let l1 = b.link(o, a, 13.9, 3);
    let l2 = b.link(a, c, 13.9, 1);
    let l3 = b.link(c, d, 13.9, 3);
    let mut w = World::new(b.build().expect("valid network"));
    let (cap1, cap2) = (w.network().capacity(l1), w.network().capacity(l2));

    println!("bottleneck L2 capacity {cap2}, upstream L1 capacity {cap1}, demand 0.67 veh/s");
    println!("{:>8} {:>10} {:>10} {:>10} {:>14}", "sim_s", "L2", "L1", "origin", "L2 out/min");
    let mut last_exits = 0;
    for t in 0..3600u64 {
        if t % 3 == 0 {
            w.spawn_with_route(vec![l1, l2, l3]).expect("valid route");
        }
        w.step();
        if w.tick() % 60 == 0 {
            let exits = w.link_exit_count(l2);
            println!(
                "{:>8.0} {:>4}/{:<5} {:>4}/{:<5} {:>10} {:>14}",
                w.tick() as f64 * DT,
                w.link_count(l2),
                cap2,
                w.link_count(l1),
                cap1,
                w.origin_buffer_len(o),
                // printed every 30 s; ×2 for a per-minute rate
                (exits - last_exits) * 2,
            );
            last_exits = exits;
        }
    }
    w.check_invariants().expect("invariants hold");
}
