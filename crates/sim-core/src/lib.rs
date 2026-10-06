//! Living City simulation core.
//!
//! Authoritative, deterministic traffic simulation. Pure Rust: no browser,
//! WASM, wall-clock or rendering concepts. The model contract lives in
//! `.wdd/epics/core.md`.

pub mod network;
pub mod params;
pub mod world;

pub use network::{Link, LinkId, Network, NetworkBuilder, NetworkError, Node, NodeId};
pub use world::{CompletedTrip, Counts, SpawnError, VehicleId, VehicleView, World};
