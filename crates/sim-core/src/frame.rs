//! Compact, renderer-facing encodings of world state (the worker boundary).
//! No screen coordinates: vehicles are (link, offset along it, lane).

use crate::network::Network;
use crate::params::QUEUED_SPEED;
use crate::world::{Metrics, World};

/// u32 words per vehicle record: link, s (f32 bits), v (f32 bits), flags.
pub const VEHICLE_RECORD_WORDS: usize = 4;
pub const FLAG_QUEUED: u32 = 1 << 0;
pub const FLAG_ON_CLOSED_LINK: u32 = 1 << 1;
pub const FLAG_STRANDED: u32 = 1 << 2;
pub const FLAG_LANE_SHIFT: u32 = 8;

/// Clears `out` and appends one record per on-network vehicle (links
/// ascending → lanes ascending → front first). Returns the record count.
pub fn write_vehicle_records(world: &World, out: &mut Vec<u32>) -> u32 {
    out.clear();
    world.for_each_on_network(|link, lane, s, v, stranded| {
        let mut flags = (lane as u32) << FLAG_LANE_SHIFT;
        if v < QUEUED_SPEED {
            flags |= FLAG_QUEUED;
        }
        if world.is_closed(link) {
            flags |= FLAG_ON_CLOSED_LINK;
        }
        if stranded {
            flags |= FLAG_STRANDED;
        }
        out.extend_from_slice(&[link.0, (s as f32).to_bits(), (v as f32).to_bits(), flags]);
    });
    (out.len() / VEHICLE_RECORD_WORDS) as u32
}

/// Per link (id order): vehicles and queued vehicles, saturating at u16::MAX.
pub fn write_link_stats(world: &World, counts: &mut Vec<u16>, queued: &mut Vec<u16>) {
    let n = world.network().links().len();
    counts.clear();
    counts.resize(n, 0);
    queued.clear();
    queued.resize(n, 0);
    world.for_each_on_network(|link, _, _, v, _| {
        let i = link.index();
        counts[i] = counts[i].saturating_add(1);
        if v < QUEUED_SPEED {
            queued[i] = queued[i].saturating_add(1);
        }
    });
}

/// The static network as flat typed arrays (sent once).
#[derive(Clone, Debug, PartialEq)]
pub struct NetworkExport {
    pub node_xy: Vec<f32>,
    pub node_is_zone: Vec<u8>,
    pub link_from: Vec<u32>,
    pub link_to: Vec<u32>,
    pub link_lanes: Vec<u8>,
    pub link_length: Vec<f32>,
    pub link_speed: Vec<f32>,
}

impl NetworkExport {
    pub fn new(network: &Network) -> Self {
        let nodes = network.nodes();
        let links = network.links();
        NetworkExport {
            node_xy: nodes.iter().flat_map(|n| [n.x_m as f32, n.y_m as f32]).collect(),
            node_is_zone: nodes.iter().map(|n| network.is_zone(n.id) as u8).collect(),
            link_from: links.iter().map(|l| l.from.0).collect(),
            link_to: links.iter().map(|l| l.to.0).collect(),
            link_lanes: links.iter().map(|l| l.lanes).collect(),
            link_length: links.iter().map(|l| l.length_m as f32).collect(),
            link_speed: links.iter().map(|l| l.speed_limit_mps as f32).collect(),
        }
    }
}

/// Order of `metrics_to_array` (the `Metrics` field order).
pub const METRIC_NAMES: &[&str] = &[
    "tick",
    "sim_time_s",
    "trips_generated",
    "spawned",
    "active",
    "on_network",
    "waiting_at_origin",
    "no_route",
    "stranded",
    "queued",
    "completed",
    "removed_unreachable",
    "unreachable",
    "mean_travel_time_s",
    "incomplete",
    "mean_incomplete_age_s",
];

/// `Metrics` as numbers in `METRIC_NAMES` order; `None` → NaN.
pub fn metrics_to_array(m: &Metrics) -> Vec<f64> {
    vec![
        m.tick as f64,
        m.sim_time_s,
        m.trips_generated as f64,
        m.spawned as f64,
        m.active as f64,
        m.on_network as f64,
        m.waiting_at_origin as f64,
        m.no_route as f64,
        m.stranded as f64,
        m.queued as f64,
        m.completed as f64,
        m.removed_unreachable as f64,
        m.unreachable as f64,
        m.mean_travel_time_s.unwrap_or(f64::NAN),
        m.incomplete as f64,
        m.mean_incomplete_age_s.unwrap_or(f64::NAN),
    ]
}

/// `METRIC_NAMES` (unchanged since core) followed by the epic-city metrics.
pub const EXTENDED_METRIC_NAMES: &[&str] = &[
    "tick",
    "sim_time_s",
    "trips_generated",
    "spawned",
    "active",
    "on_network",
    "waiting_at_origin",
    "no_route",
    "stranded",
    "queued",
    "completed",
    "removed_unreachable",
    "unreachable",
    "mean_travel_time_s",
    "incomplete",
    "mean_incomplete_age_s",
    "removed_gridlock",
    "unserved",
];

/// `Metrics` as numbers in `EXTENDED_METRIC_NAMES` order; `None` → NaN.
pub fn metrics_to_extended_array(m: &Metrics) -> Vec<f64> {
    let mut out = metrics_to_array(m);
    out.push(m.removed_gridlock as f64);
    out.push(m.unserved as f64);
    out
}
