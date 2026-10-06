//! Close the central bridge after 20 min and watch traffic adapt.
//!
//! `cargo run -p sim-core --release --example bridge`

use sim_core::cities::three_bridges;
use sim_core::params::DT;
use sim_core::{Command, CommandKind, World};

fn main() {
    let city = three_bridges(2026, 7);
    let lm = city.landmarks;
    let mut w = World::from_scenario(city.scenario).expect("valid city");
    let close_at = 20 * 60 * 2; // 20 min in ticks
    for l in lm.central_bridge {
        w.schedule(Command { tick: close_at, kind: CommandKind::CloseLink(l) }).expect("valid command");
    }
    let bridges = [("north", lm.north_bridge[0]), ("central", lm.central_bridge[0]), ("south", lm.south_bridge[0])];

    println!("west→east bridge exits per minute; central bridge closes at 20:00 (sim time)");
    println!("{:>6} {:>6} {:>8} {:>6} {:>7} {:>9} {:>11} {:>8}", "sim", "north", "central", "south", "queued", "stranded", "unreachable", "mean_tt");
    let mut last: Vec<u64> = bridges.iter().map(|&(_, l)| w.link_exit_count(l)).collect();
    for _ in 0..(40 * 60 * 2) {
        w.step();
        if w.tick().is_multiple_of(120) {
            let now: Vec<u64> = bridges.iter().map(|&(_, l)| w.link_exit_count(l)).collect();
            let m = w.metrics();
            let s = w.tick() as f64 * DT;
            println!(
                "{:>3}:{:02} {:>6} {:>8} {:>6} {:>7} {:>9} {:>11} {:>8}",
                (s / 60.0) as u64,
                (s % 60.0) as u64,
                now[0] - last[0],
                now[1] - last[1],
                now[2] - last[2],
                m.queued,
                m.stranded,
                m.unreachable,
                m.mean_travel_time_s.map_or("-".into(), |t| format!("{t:.0}s")),
            );
            last = now;
        }
    }
    w.check_invariants().expect("invariants hold");
}
