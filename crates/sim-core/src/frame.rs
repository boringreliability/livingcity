//! Compact, renderer-facing encodings of world state (the worker boundary).
//! No screen coordinates: vehicles are (link, offset along it, lane).

use crate::network::Network;
use crate::world::{Metrics, World};

/// u32 words per vehicle record: link, s (f32 bits), v (f32 bits), flags.
pub const VEHICLE_RECORD_WORDS: usize = 4;
pub const FLAG_QUEUED: u32 = 1 << 0;
pub const FLAG_ON_CLOSED_LINK: u32 = 1 << 1;
pub const FLAG_STRANDED: u32 = 1 << 2;
pub const FLAG_LANE_SHIFT: u32 = 8;

/// Clears `out` and appends one record per on-network vehicle (links
/// ascending → lanes ascending → front first). Returns the record count.
pub fn write_vehicle_records(_world: &World, _out: &mut Vec<u32>) -> u32 {
    todo!()
}

/// Per link (id order): vehicles and queued vehicles, saturating at u16::MAX.
pub fn write_link_stats(_world: &World, _counts: &mut Vec<u16>, _queued: &mut Vec<u16>) {
    todo!()
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
    pub fn new(_network: &Network) -> Self {
        todo!()
    }
}

/// Order of `metrics_to_array`.
pub const METRIC_NAMES: &[&str] = &[];

/// `Metrics` as numbers in `METRIC_NAMES` order; `None` → NaN.
pub fn metrics_to_array(_m: &Metrics) -> Vec<f64> {
    todo!()
}
