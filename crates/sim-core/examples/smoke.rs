//! Two-zone smoke run: demand, routing and metrics every 60 s of sim time.
//!
//! `cargo run -p sim-core --example smoke`

use sim_core::params::DT;
use sim_core::{DemandModel, NetworkBuilder, OdFlow, Profile, Scenario, World};

fn main() {
    // West zone ⇄ 1 km two-lane main road ⇄ east zone, plus a slower parallel street.
    let mut b = NetworkBuilder::new();
    let west = b.zone(0.0, 0.0);
    let a = b.node(100.0, 0.0);
    let c = b.node(1100.0, 0.0);
    let east = b.zone(1200.0, 0.0);
    let n1 = b.node(100.0, 300.0);
    let n2 = b.node(1100.0, 300.0);
    b.two_way(west, a, 13.9, 2);
    b.two_way(a, c, 13.9, 2);
    b.two_way(c, east, 13.9, 2);
    b.two_way(a, n1, 8.3, 1);
    b.two_way(n1, n2, 8.3, 1);
    b.two_way(n2, c, 8.3, 1);
    let network = b.build().expect("valid network");
    let flow = |origin, dest, veh_per_hour| OdFlow { origin, dest, veh_per_hour };
    let demand = DemandModel {
        flows: vec![flow(west, east, 1500.0), flow(east, west, 900.0)],
        // morning ramp: half demand, rising to 1.5× after 10 min
        profile: Profile { points: vec![(0.0, 0.5), (600.0, 1.5)] },
    };
    let mut w = World::from_scenario(Scenario { network, demand, demand_seed: 2026, behavior_seed: 10 })
        .expect("valid scenario");

    println!("{:>6} {:>9} {:>7} {:>7} {:>9} {:>8} {:>8}", "sim_s", "generated", "active", "queued", "completed", "removed", "mean_tt");
    for _ in 0..(30 * 60 * 2) {
        w.step();
        if w.tick().is_multiple_of(120) {
            let m = w.metrics();
            assert_eq!(m.spawned, m.active + m.completed + m.removed_unreachable, "conservation");
            println!(
                "{:>6.0} {:>9} {:>7} {:>7} {:>9} {:>8} {:>8}",
                w.tick() as f64 * DT,
                m.trips_generated,
                m.active,
                m.queued,
                m.completed,
                m.removed_unreachable,
                m.mean_travel_time_s.map_or("-".to_string(), |t| format!("{t:.1}")),
            );
        }
    }
    w.check_invariants().expect("invariants hold");
}
