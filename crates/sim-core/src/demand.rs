//! Seeded, reproducible trip demand: a pure function of (model, seed, tick).

use crate::network::{Network, NodeId};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OdFlow {
    pub origin: NodeId,
    pub dest: NodeId,
    pub veh_per_hour: f64,
}

/// Piecewise-linear multiplier over sim seconds. Empty = constant 1.0.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Profile {
    pub points: Vec<(f64, f64)>,
}

impl Profile {
    pub fn at(&self, _sim_s: f64) -> f64 {
        todo!()
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DemandModel {
    pub flows: Vec<OdFlow>,
    pub profile: Profile,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DemandError {
    /// Origin is neither a zone nor a source node (or unknown).
    BadOrigin(NodeId),
    SameOriginDest(usize),
    BadRate(usize),
    BadProfile,
}

impl DemandModel {
    pub fn validate(&self, _network: &Network) -> Result<(), DemandError> {
        todo!()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TripRequest {
    pub flow_index: usize,
    pub origin: NodeId,
    pub dest: NodeId,
}

/// Trips generated in `tick`: flow order, then copy index. Pure.
pub fn trips_at(_model: &DemandModel, _demand_seed: u64, _tick: u64) -> Vec<TripRequest> {
    todo!()
}
