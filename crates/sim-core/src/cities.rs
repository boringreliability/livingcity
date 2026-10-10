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
    pub name: &'static str,
    /// River corridor `(west_x, east_x)` in metres; only bridge links cross it.
    pub river: (f64, f64),
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
    let west: Vec<Vec<NodeId>> = YS
        .iter()
        .map(|&y| XS_WEST.iter().map(|&x| b.node(x, y)).collect())
        .collect();
    let east: Vec<Vec<NodeId>> = YS
        .iter()
        .map(|&y| XS_EAST.iter().map(|&x| b.node(x, y)).collect())
        .collect();
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
        .map(|&(name, x, y, kind)| Zone {
            name: name.to_string(),
            node: b.zone(x, y),
            kind,
        })
        .collect();

    // The center row (r = 1) is a 2-lane arterial; other streets are 1-lane.
    let street = |r: usize| {
        if r == 1 {
            (ARTERIAL_SPEED, 2)
        } else {
            (STREET_SPEED, 1)
        }
    };
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

    let flow = |o: &Zone, d: &Zone, veh_per_hour| OdFlow {
        origin: o.node,
        dest: d.node,
        veh_per_hour,
    };
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
    let demand = DemandModel {
        flows,
        profile: Profile::default(),
    };

    City {
        name: "three_bridges",
        river: (-60.0, 60.0),
        scenario: Scenario {
            network,
            demand,
            demand_seed,
            behavior_seed,
        },
        landmarks: Landmarks {
            north_bridge: [north_bridge.0, north_bridge.1],
            central_bridge: [central_bridge.0, central_bridge.1],
            south_bridge: [south_bridge.0, south_bridge.1],
        },
        zones,
    }
}

// ───────────────────────────────── River City ─────────────────────────────────

/// River corridor (simulation data: only bridge links cross it).
pub const RIVER_WEST_X: f64 = -75.0;
pub const RIVER_EAST_X: f64 = 75.0;
const OLD_BRIDGE_SPEED: f64 = 8.3;
const OLD_BRIDGE_SAT_FLOW: f64 = 0.25;

/// A River City district: its zones as (name, row, column) on its bank.
struct District {
    key: &'static str,
    kind: ZoneKind,
    west_bank: bool,
    zones: &'static [(&'static str, usize, usize)],
}

/// Calibration (ward city-002, `.wdd/memory/decisions/river-city-calibration.md`): the
/// district rates below are scaled by these factors. Cross-river demand (≈ 3,000 veh/h
/// west→east) must exceed the North + Old Bridges' 2,700 veh/h, so closing the Main Bridge
/// oversaturates them, yet stay well under the Main Bridge's 3,600 veh/h so the backlog
/// clears after a reopen. Intra-bank traffic carries most of the ≈ 2,000 active vehicles.
/// Both sit in the middle of a plateau where every calibration target holds.
const INTRA_BANK_SCALE: f64 = 2.3;
const CROSS_RIVER_SCALE: f64 = 0.9;

/// The demo city: a river splits the town; three crossings, residential districts mostly
/// west, workplaces and St. Mary's Hospital east. The construction order (nodes → streets →
/// bridges → zones and connectors → flows) is fixed: it determines every id.
///
/// Layout (metres): 6 junction columns per bank (west x = −3000 … −200, the column 300 m from
/// the river makes the bridge approaches short blocks), 7 rows y = −1800 … 1800. Rows
/// y = −1200, 0, 1200 and two avenues per bank are 2-lane arterials; other streets 1 lane.
/// Main Bridge at y = 0 (2 lanes, arterial speed), North Bridge at y = 1800 (1 lane),
/// Old Bridge at y = −1800 (1 lane, 30 km/h, 900 veh/h: the limited-capacity alternative).
pub fn river_city(demand_seed: u64, behavior_seed: u64) -> City {
    river_city_scaled(demand_seed, behavior_seed, 1.0).expect("scale 1 is valid")
}

/// Largest accepted demand scale for [`river_city_scaled`].
pub const DEMAND_SCALE_MAX: f64 = 6.0;

/// A demand scale outside `0 < scale ≤ DEMAND_SCALE_MAX` (or NaN).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct InvalidDemandScale(pub f64);

impl std::fmt::Display for InvalidDemandScale {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "demand scale {} is outside (0, {DEMAND_SCALE_MAX}]",
            self.0
        )
    }
}

impl std::error::Error for InvalidDemandScale {}

/// River City with every flow multiplied by `demand_scale` (same network, zones and flow order).
/// For measurement only (stress tests); `river_city` is scale 1.
// Indexed loops mirror the documented (row, column) construction order.
#[allow(clippy::needless_range_loop)]
pub fn river_city_scaled(
    demand_seed: u64,
    behavior_seed: u64,
    demand_scale: f64,
) -> Result<City, InvalidDemandScale> {
    if !(demand_scale > 0.0 && demand_scale <= DEMAND_SCALE_MAX) {
        return Err(InvalidDemandScale(demand_scale));
    }
    const XW: [f64; 6] = [-3000.0, -2300.0, -1600.0, -900.0, -500.0, -200.0];
    const XE: [f64; 6] = [200.0, 500.0, 900.0, 1600.0, 2300.0, 3000.0];
    const YS: [f64; 7] = [-1800.0, -1200.0, -600.0, 0.0, 600.0, 1200.0, 1800.0];
    const MAIN_ROW: usize = 3;
    let arterial_rows = [1usize, 3, 5];
    let arterial_cols = [[1usize, 3], [2, 4]];
    let mut b = NetworkBuilder::new();
    let west: Vec<Vec<NodeId>> = YS
        .iter()
        .map(|&y| XW.iter().map(|&x| b.node(x, y)).collect())
        .collect();
    let east: Vec<Vec<NodeId>> = YS
        .iter()
        .map(|&y| XE.iter().map(|&x| b.node(x, y)).collect())
        .collect();
    for (k, bank) in [&west, &east].into_iter().enumerate() {
        for r in 0..YS.len() {
            for c in 0..5 {
                let (speed, lanes) = if arterial_rows.contains(&r) {
                    (ARTERIAL_SPEED, 2)
                } else {
                    (STREET_SPEED, 1)
                };
                b.two_way(bank[r][c], bank[r][c + 1], speed, lanes);
            }
        }
        for c in 0..6 {
            for r in 0..YS.len() - 1 {
                let (speed, lanes) = if arterial_cols[k].contains(&c) {
                    (ARTERIAL_SPEED, 2)
                } else {
                    (STREET_SPEED, 1)
                };
                b.two_way(bank[r][c], bank[r + 1][c], speed, lanes);
            }
        }
    }
    let main = b.two_way(west[MAIN_ROW][5], east[MAIN_ROW][0], ARTERIAL_SPEED, 2);
    let north = b.two_way(west[6][5], east[6][0], STREET_SPEED, 1);
    let old = b.two_way(west[0][5], east[0][0], OLD_BRIDGE_SPEED, 1);
    b.set_sat_flow(old.0, OLD_BRIDGE_SAT_FLOW);
    b.set_sat_flow(old.1, OLD_BRIDGE_SAT_FLOW);

    // Zones sit 140 m off their junction (row, column on their bank), on a 2-lane connector.
    let districts = [
        District {
            key: "westbrook",
            kind: ZoneKind::Residential,
            west_bank: true,
            zones: &[("Westbrook", 5, 1), ("Westbrook Heights", 6, 2)],
        },
        District {
            key: "hillside",
            kind: ZoneKind::Residential,
            west_bank: true,
            zones: &[("Hillside", 3, 0), ("Hillside Gardens", 4, 1)],
        },
        District {
            key: "oldtown",
            kind: ZoneKind::Residential,
            west_bank: true,
            zones: &[("Old Town", 3, 3), ("Cathedral Quarter", 2, 3)],
        },
        District {
            key: "riverside",
            kind: ZoneKind::Residential,
            west_bank: true,
            zones: &[("Riverside", 1, 3), ("Mill Lane", 1, 1)],
        },
        District {
            key: "millbrook",
            kind: ZoneKind::Residential,
            west_bank: true,
            zones: &[("Millbrook", 0, 2), ("Southfield", 2, 0)],
        },
        District {
            key: "market",
            kind: ZoneKind::Workplace,
            west_bank: true,
            zones: &[("Market Square", 4, 3), ("Old Exchange", 5, 3)],
        },
        District {
            key: "downtown",
            kind: ZoneKind::Workplace,
            west_bank: false,
            zones: &[("Downtown", 3, 3), ("City Hall", 4, 2), ("Station", 2, 2)],
        },
        District {
            key: "tech",
            kind: ZoneKind::Workplace,
            west_bank: false,
            zones: &[("Tech Park", 5, 4), ("Innovation Hub", 6, 3)],
        },
        District {
            key: "harbor",
            kind: ZoneKind::Workplace,
            west_bank: false,
            zones: &[("Harbor Works", 1, 2), ("Docks", 0, 3)],
        },
        District {
            key: "hospital",
            kind: ZoneKind::Hospital,
            west_bank: false,
            zones: &[("St. Mary's Hospital", 2, 4)],
        },
        District {
            key: "eastgate",
            kind: ZoneKind::Residential,
            west_bank: false,
            zones: &[("Eastgate", 4, 5), ("Eastgate Fields", 3, 5)],
        },
    ];
    let mut zones = Vec::new();
    let mut dz: Vec<Vec<NodeId>> = Vec::new();
    for d in &districts {
        let mut nodes = Vec::new();
        for &(name, r, c) in d.zones {
            let j = if d.west_bank { west[r][c] } else { east[r][c] };
            let x = if d.west_bank { XW[c] } else { XE[c] };
            let z = b.zone(x + 140.0, YS[r] + 140.0);
            b.two_way(z, j, STREET_SPEED, 2);
            zones.push(Zone {
                name: name.to_string(),
                node: z,
                kind: d.kind,
            });
            nodes.push(z);
        }
        dz.push(nodes);
    }
    let network = b.build().expect("river_city is a valid network");

    let (intra, cross) = (
        INTRA_BANK_SCALE * demand_scale,
        CROSS_RIVER_SCALE * demand_scale,
    );
    let idx = |key: &str| {
        districts
            .iter()
            .position(|d| d.key == key)
            .expect("district")
    };
    let mut flows = Vec::new();
    // district-to-district rate (veh/h), split evenly over zone pairs
    let mut f = |o: &str, d: &str, vph: f64, k: f64| {
        let (os, ds) = (&dz[idx(o)], &dz[idx(d)]);
        let each = vph * k / (os.len() * ds.len()) as f64;
        for &on in os {
            for &dn in ds {
                if on != dn {
                    flows.push(OdFlow {
                        origin: on,
                        dest: dn,
                        veh_per_hour: each,
                    });
                }
            }
        }
    };
    let west_res = ["westbrook", "hillside", "oldtown", "riverside", "millbrook"];
    for o in west_res {
        f(o, "downtown", 300.0, cross);
        f(o, "tech", 180.0, cross);
        f(o, "harbor", 160.0, cross);
        f(o, "hospital", 40.0, cross);
        f(o, "market", 500.0, intra);
        for d in west_res {
            if d != o {
                f(o, d, 120.0, intra);
            }
        }
    }
    for o in ["downtown", "tech", "harbor"] {
        for d in west_res {
            f(o, d, 50.0, cross);
        }
        f("eastgate", o, 400.0, intra);
        f(o, "eastgate", 150.0, intra);
    }
    f("eastgate", "market", 150.0, cross);
    f("eastgate", "hospital", 60.0, intra);
    f("downtown", "tech", 300.0, intra);
    f("tech", "downtown", 300.0, intra);
    f("harbor", "downtown", 250.0, intra);
    f("downtown", "harbor", 250.0, intra);
    f("market", "eastgate", 100.0, cross);
    let demand = DemandModel {
        flows,
        profile: Profile::default(),
    };

    Ok(City {
        name: "river_city",
        river: (RIVER_WEST_X, RIVER_EAST_X),
        scenario: Scenario {
            network,
            demand,
            demand_seed,
            behavior_seed,
        },
        landmarks: Landmarks {
            north_bridge: [north.0, north.1],
            central_bridge: [main.0, main.1],
            south_bridge: [old.0, old.1],
        },
        zones,
    })
}
