//! Living City simulation core.
//!
//! Authoritative, deterministic traffic simulation. Pure Rust: no browser,
//! WASM, wall-clock or rendering concepts. The model contract lives in
//! `.wdd/epics/core.md`.

pub mod demand;
pub mod network;
pub mod params;
pub mod rng;
pub mod routing;
pub mod world;

pub use demand::{DemandError, DemandModel, OdFlow, Profile, TripRequest};
pub use network::{Link, LinkId, Network, NetworkBuilder, NetworkError, Node, NodeId};
pub use world::{
    CompletedTrip, Counts, GeneratedTrip, Metrics, Scenario, SpawnError, VehicleId, VehicleInfo, VehicleState,
    VehicleView, World,
};
