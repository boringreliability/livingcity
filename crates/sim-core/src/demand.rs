//! Seeded, reproducible trip demand: a pure function of (model, seed, tick).

use crate::network::{Network, NodeId};
use crate::params::DT;
use crate::rng::{mix3, splitmix64, unit_f64};

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
    pub fn at(&self, sim_s: f64) -> f64 {
        let pts = &self.points;
        let (Some(&(t0, m0)), Some(&(tn, mn))) = (pts.first(), pts.last()) else {
            return 1.0;
        };
        if sim_s <= t0 {
            return m0;
        }
        if sim_s >= tn {
            return mn;
        }
        // First segment whose end is past `sim_s` (points are few).
        let i = pts.iter().position(|&(t, _)| t > sim_s).expect("sim_s < last time");
        let ((ta, ma), (tb, mb)) = (pts[i - 1], pts[i]);
        ma + (mb - ma) * (sim_s - ta) / (tb - ta)
    }

    fn is_valid(&self) -> bool {
        self.points.iter().all(|&(t, m)| t.is_finite() && m.is_finite() && m >= 0.0)
            && self.points.windows(2).all(|w| w[0].0 < w[1].0)
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DemandModel {
    pub flows: Vec<OdFlow>,
    pub profile: Profile,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DemandError {
    /// Origin or destination is not a node of the network.
    UnknownNode(NodeId),
    /// Origin is neither a zone nor a source node.
    BadOrigin(NodeId),
    SameOriginDest(usize),
    BadRate(usize),
    BadProfile,
}

impl DemandModel {
    /// Flow-major: each flow fully, in order, then the profile.
    pub fn validate(&self, network: &Network) -> Result<(), DemandError> {
        let n_nodes = network.nodes().len();
        for (i, f) in self.flows.iter().enumerate() {
            for node in [f.origin, f.dest] {
                if node.index() >= n_nodes {
                    return Err(DemandError::UnknownNode(node));
                }
            }
            if !network.is_zone(f.origin) && !network.in_links(f.origin).is_empty() {
                return Err(DemandError::BadOrigin(f.origin));
            }
            if f.origin == f.dest {
                return Err(DemandError::SameOriginDest(i));
            }
            if !(f.veh_per_hour.is_finite() && f.veh_per_hour >= 0.0) {
                return Err(DemandError::BadRate(i));
            }
        }
        if !self.profile.is_valid() {
            return Err(DemandError::BadProfile);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TripRequest {
    pub flow_index: usize,
    pub origin: NodeId,
    pub dest: NodeId,
}

/// Trips generated in `tick`: flow order, then copy index. Pure: depends on
/// nothing but its arguments, so interventions cannot change demand.
pub fn trips_at(model: &DemandModel, demand_seed: u64, tick: u64) -> Vec<TripRequest> {
    let multiplier = model.profile.at(tick as f64 * DT);
    let mut out = Vec::new();
    for (i, f) in model.flows.iter().enumerate() {
        let expected = f.veh_per_hour / 3600.0 * DT * multiplier;
        let whole = expected.floor();
        let extra = unit_f64(splitmix64(mix3(demand_seed, tick, i as u64))) < expected - whole;
        let count = whole as usize + usize::from(extra);
        out.extend(std::iter::repeat_n(TripRequest { flow_index: i, origin: f.origin, dest: f.dest }, count));
    }
    out
}
