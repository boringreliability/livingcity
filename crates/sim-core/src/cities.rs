//! Built-in cities (simulation data: network, zones, demand). Purely visual
//! data (river shape, buildings, labels' styling) lives in the renderer.

use crate::demand::{DemandModel, OdFlow, Profile};
use crate::network::{LinkId, NetworkBuilder, NodeId};
use crate::world::Scenario;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ZoneKind {
    Residential,
    Workplace,
    Hospital,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Zone {
    pub name: String,
    pub node: NodeId,
    pub kind: ZoneKind,
}

/// Each bridge as `[west→east, east→west]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Landmarks {
    pub north_bridge: [LinkId; 2],
    pub central_bridge: [LinkId; 2],
    pub south_bridge: [LinkId; 2],
}

#[derive(Clone, Debug)]
pub struct City {
    pub scenario: Scenario,
    pub landmarks: Landmarks,
    pub zones: Vec<Zone>,
}

const STREET_SPEED: f64 = 11.1;
const ARTERIAL_SPEED: f64 = 13.9;

/// The core-epic test city: a river along x ∈ [−60, 60] m with three bridges.
/// Construction order is fixed by ward core-003 (it determines every id).
pub fn three_bridges(demand_seed: u64, behavior_seed: u64) -> City {
    const XS_WEST: [f64; 3] = [-1000.0, -550.0, -100.0];
    const XS_EAST: [f64; 3] = [100.0, 550.0, 1000.0];
    const YS: [f64; 3] = [-700.0, 0.0, 700.0];
    let mut b = NetworkBuilder::new();

    // Nodes: W(r,c) = 3r + c, E(r,c) = 9 + 3r + c, then zones 18–23.
    let west: Vec<Vec<NodeId>> = YS.iter().map(|&y| XS_WEST.iter().map(|&x| b.node(x, y)).collect()).collect();
    let east: Vec<Vec<NodeId>> = YS.iter().map(|&y| XS_EAST.iter().map(|&x| b.node(x, y)).collect()).collect();
    let zone_specs = [
        ("Riverside", -1150.0, YS[0], ZoneKind::Residential),
        ("Old Town", -1150.0, YS[1], ZoneKind::Residential),
        ("Westbrook", -1150.0, YS[2], ZoneKind::Residential),
        ("St. Mary's Hospital", 1150.0, YS[0], ZoneKind::Hospital),
        ("Harbor Works", 1150.0, YS[1], ZoneKind::Workplace),
        ("Tech Park", 1150.0, YS[2], ZoneKind::Workplace),
    ];
    let zones: Vec<Zone> = zone_specs
        .iter()
        .map(|&(name, x, y, kind)| Zone { name: name.to_string(), node: b.zone(x, y), kind })
        .collect();

    // The center row (r = 1) is a 2-lane arterial; other streets are 1-lane.
    let street = |r: usize| if r == 1 { (ARTERIAL_SPEED, 2) } else { (STREET_SPEED, 1) };
    for bank in [&west, &east] {
        for (r, row) in bank.iter().enumerate() {
            for c in 0..2 {
                let (speed, lanes) = street(r);
                b.two_way(row[c], row[c + 1], speed, lanes);
            }
        }
        // verticals: column-major (c, then r), as the construction order requires
        #[allow(clippy::needless_range_loop)]
        for c in 0..3 {
            for r in 0..2 {
                b.two_way(bank[r][c], bank[r + 1][c], STREET_SPEED, 1);
            }
        }
    }

    let south_bridge = b.two_way(west[0][2], east[0][0], STREET_SPEED, 1);
    let central_bridge = b.two_way(west[1][2], east[1][0], ARTERIAL_SPEED, 2);
    let north_bridge = b.two_way(west[2][2], east[2][0], STREET_SPEED, 1);

    for (i, z) in zones.iter().enumerate() {
        let junction = if i < 3 { west[i][0] } else { east[i - 3][2] };
        b.two_way(z.node, junction, STREET_SPEED, 2);
    }
    let network = b.build().expect("three_bridges is a valid network");

    let flow = |o: &Zone, d: &Zone, veh_per_hour| OdFlow { origin: o.node, dest: d.node, veh_per_hour };
    let (west_zones, east_zones) = zones.split_at(3);
    let mut flows = Vec::new();
    for w in west_zones {
        flows.push(flow(w, &east_zones[0], 60.0));
        flows.push(flow(w, &east_zones[1], 300.0));
        flows.push(flow(w, &east_zones[2], 300.0));
    }
    for e in east_zones {
        for w in west_zones {
            flows.push(flow(e, w, 80.0));
        }
    }
    let demand = DemandModel { flows, profile: Profile::default() };

    City {
        scenario: Scenario { network, demand, demand_seed, behavior_seed },
        landmarks: Landmarks {
            north_bridge: [north_bridge.0, north_bridge.1],
            central_bridge: [central_bridge.0, central_bridge.1],
            south_bridge: [south_bridge.0, south_bridge.1],
        },
        zones,
    }
}
