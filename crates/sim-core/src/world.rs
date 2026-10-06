//! Simulation state and the fixed-step tick.

use crate::network::{LinkId, Network, NodeId};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct VehicleId(pub u32);

/// Read-only view of a vehicle on a link.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VehicleView {
    pub id: VehicleId,
    pub trip_id: u64,
    pub lane: u8,
    pub s: f64,
    pub v: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub spawned: u64,
    pub active: u64,
    pub on_network: u64,
    pub waiting_at_origin: u64,
    pub completed: u64,
    pub removed: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompletedTrip {
    pub trip_id: u64,
    pub created_tick: u64,
    pub completed_tick: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SpawnError {
    EmptyRoute,
    UnknownLink(LinkId),
    NonContiguousRoute { at: usize },
    /// The origin has in-links and is not a zone: admission there would
    /// compete unfairly with through traffic.
    OriginHasThroughTraffic(NodeId),
    /// `route[at].from` is a zone in the middle of the route.
    RouteThroughZone { at: usize },
}

#[derive(Clone, Debug)]
pub struct World {
    _private: (),
}

impl World {
    pub fn new(_network: Network) -> Self {
        todo!()
    }

    pub fn network(&self) -> &Network {
        todo!()
    }

    pub fn tick(&self) -> u64 {
        todo!()
    }

    /// Enqueue a vehicle with an explicit route in the origin buffer of
    /// `route[0].from`.
    pub fn spawn_with_route(&mut self, _route: Vec<LinkId>) -> Result<VehicleId, SpawnError> {
        todo!()
    }

    /// Advance one fixed tick.
    pub fn step(&mut self) {
        todo!()
    }

    pub fn counts(&self) -> Counts {
        todo!()
    }

    /// Vehicles on a link, lane ascending, front (nearest stop line) first.
    pub fn link_vehicles(&self, _link: LinkId) -> Vec<VehicleView> {
        todo!()
    }

    pub fn link_count(&self, _link: LinkId) -> u32 {
        todo!()
    }

    /// Cumulative vehicles that left the link (transfer or completion).
    pub fn link_exit_count(&self, _link: LinkId) -> u64 {
        todo!()
    }

    pub fn origin_buffer_len(&self, _node: NodeId) -> usize {
        todo!()
    }

    pub fn completed_log(&self) -> &[CompletedTrip] {
        todo!()
    }

    /// Conservation, lane ordering/spacing, capacity, finite values.
    pub fn check_invariants(&self) -> Result<(), String> {
        todo!()
    }
}
