//! Ward city-005, test 1: scaled River City demand (for measurement only).
//! Contract: `.wdd/wards/city/ward-005.md` § Red-phase contract details (Rust).

use sim_core::cities::{river_city, river_city_scaled, InvalidDemandScale, DEMAND_SCALE_MAX};
use sim_core::World;

const MIN: u64 = 120; // ticks per sim minute

fn run_hash(c: &sim_core::City, ticks: u64) -> u64 {
    let mut w = World::from_scenario(c.scenario.clone()).expect("valid city");
    for _ in 0..ticks {
        w.step();
    }
    w.state_hash()
}

#[test]
fn scaled_demand_multiplies_flows() {
    let base = river_city(2026, 7);
    for scale in [0.25, 0.5, 1.0, 2.5, DEMAND_SCALE_MAX] {
        // Given River City scaled by `scale`
        let c = river_city_scaled(2026, 7, scale).expect("valid scale");
        // Then the network, zones, landmarks and river are those of River City
        assert_eq!(c.name, base.name);
        assert_eq!(c.river, base.river);
        assert_eq!(c.landmarks, base.landmarks);
        assert_eq!(c.zones, base.zones);
        assert_eq!(c.scenario.network.links().len(), base.scenario.network.links().len());
        assert_eq!(c.scenario.network.nodes().len(), base.scenario.network.nodes().len());
        assert_eq!((c.scenario.demand_seed, c.scenario.behavior_seed), (2026, 7));
        assert_eq!(c.scenario.demand.profile, base.scenario.demand.profile);
        // and every flow is the same flow (same order) with its rate × scale
        let (fs, bs) = (&c.scenario.demand.flows, &base.scenario.demand.flows);
        assert_eq!(fs.len(), bs.len());
        for (f, b) in fs.iter().zip(bs) {
            assert_eq!((f.origin, f.dest), (b.origin, b.dest));
            let want = b.veh_per_hour * scale;
            assert!((f.veh_per_hour - want).abs() <= 1e-9 * want.max(1.0), "{} vs {want}", f.veh_per_hour);
        }
    }
}

#[test]
fn scale_one_is_river_city() {
    // Given River City and River City at scale 1 with the same seeds
    let a = river_city(17, 23);
    let b = river_city_scaled(17, 23, 1.0).expect("scale 1 is valid");
    // When both run for 10 sim minutes
    // Then their states are identical
    assert_eq!(run_hash(&a, 10 * MIN), run_hash(&b, 10 * MIN));
}

#[test]
fn scaled_demand_generates_more_trips() {
    // Given scale 3 vs scale 1 (same seeds)
    let count = |scale: f64| {
        let c = river_city_scaled(1, 2, scale).expect("valid");
        let mut w = World::from_scenario(c.scenario.clone()).expect("valid city");
        for _ in 0..5 * MIN {
            w.step();
        }
        let m = w.metrics();
        m.active + m.completed
    };
    // Then after 5 sim minutes clearly more trips exist (behaviour, not just the numbers in the table)
    let (one, three) = (count(1.0), count(3.0));
    assert!(three as f64 > 2.0 * one as f64, "scale 3: {three} trips vs scale 1: {one}");
}

#[test]
fn invalid_scales_are_rejected() {
    for bad in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY, DEMAND_SCALE_MAX + 1e-9, 7.0] {
        match river_city_scaled(2026, 7, bad) {
            Err(InvalidDemandScale(v)) => assert!(v.is_nan() && bad.is_nan() || v == bad),
            Ok(_) => panic!("scale {bad} must be rejected"),
        }
    }
    // and the boundaries of the valid range are accepted
    assert!(river_city_scaled(2026, 7, f64::MIN_POSITIVE).is_ok());
    assert!(river_city_scaled(2026, 7, DEMAND_SCALE_MAX).is_ok());
}
