//! Built-in cities (simulation data: network, zones, demand). Purely visual
//! data (river shape, buildings, labels' styling) lives in the renderer.

use crate::network::{LinkId, NodeId};
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

/// The core-epic test city: a river with three bridges (see ward core-003).
pub fn three_bridges(_demand_seed: u64, _behavior_seed: u64) -> City {
    todo!()
}
