//! River City: 20 min baseline, the Main Bridge closed for 30 min, then reopened for 30 min.
//!
//! `cargo run -p sim-core --release --example river`
//!
//! Per minute: active, queued, unserved, gridlock removals, west→east exits per bridge,
//! the mean west→east trip time of the last 5 min, and the fullest street link near a bridge.

use std::collections::BTreeMap;

use sim_core::cities::river_city;
use sim_core::params::DT;
use sim_core::{Command, CommandKind, LinkId, NodeId, World};

const MIN: u64 = 120;

fn main() {
    let city = river_city(2026, 7);
    let (west, east) = city.river;
    let net = city.scenario.network.clone();
    let lm = city.landmarks;
    let mut w = World::from_scenario(city.scenario.clone()).expect("valid city");
    let (close_at, reopen_at) = (20 * MIN, 50 * MIN);
    for l in lm.central_bridge {
        w.schedule(Command {
            tick: close_at,
            kind: CommandKind::CloseLink(l),
        })
        .expect("valid");
        w.schedule(Command {
            tick: reopen_at,
            kind: CommandKind::OpenLink(l),
        })
        .expect("valid");
    }
    let bridges = [lm.central_bridge[0], lm.north_bridge[0], lm.south_bridge[0]];
    // street links ending at a bridge's west end (the approaches)
    let approaches: Vec<LinkId> = bridges
        .iter()
        .flat_map(|&b| net.in_links(net.link(b).from).to_vec())
        .filter(|&l| !bridges.contains(&l) && !net.is_zone(net.link(l).from))
        .collect();
    let x = |n: NodeId| net.node(n).x_m;

    println!("River City: Main Bridge closed 20:00–50:00 (sim time)");
    println!(
        "{:>5} {:>6} {:>6} {:>8} {:>8} {:>5} {:>5} {:>5} {:>9}  fullest approach",
        "sim", "active", "queued", "unserved", "gridlock", "main", "north", "old", "WE trip"
    );
    let mut last = bridges.map(|l| w.link_exit_count(l));
    for t in 0..80 * MIN {
        w.step();
        if (t + 1) % MIN != 0 {
            continue;
        }
        let m = w.metrics();
        let now = bridges.map(|l| w.link_exit_count(l));
        let ex = [now[0] - last[0], now[1] - last[1], now[2] - last[2]];
        last = now;
        let trips: BTreeMap<u64, (NodeId, NodeId)> = w
            .generated_trips()
            .iter()
            .map(|g| (g.trip_id, (g.origin, g.dest)))
            .collect();
        let from = (t + 1).saturating_sub(5 * MIN);
        let tts: Vec<f64> = w
            .completed_log()
            .iter()
            .filter(|c| c.completed_tick >= from)
            .filter(|c| {
                trips
                    .get(&c.trip_id)
                    .is_some_and(|&(o, d)| x(o) < west && x(d) > east)
            })
            .map(|c| (c.completed_tick - c.created_tick) as f64 * DT)
            .collect();
        let tt = if tts.is_empty() {
            f64::NAN
        } else {
            tts.iter().sum::<f64>() / tts.len() as f64
        };
        let (fill, link) = approaches
            .iter()
            .map(|&l| (w.link_count(l) as f64 / net.capacity(l) as f64, l))
            .fold((0.0, LinkId(0)), |a, b| if b.0 > a.0 { b } else { a });
        let s = w.tick() / 2; // sim seconds (DT = 0.5 s)
        println!(
            "{:>2}:{:02} {:>6} {:>6} {:>8} {:>8} {:>5} {:>5} {:>5} {:>7.0} s  link {} {:>3.0} % full",
            s / 60,
            s % 60,
            m.active,
            m.queued,
            m.unserved,
            m.removed_gridlock,
            ex[0],
            ex[1],
            ex[2],
            tt,
            link.0,
            fill * 100.0
        );
    }
}
