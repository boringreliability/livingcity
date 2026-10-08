//! Living City simulation core.
//!
//! Authoritative, deterministic traffic simulation. Pure Rust: no browser,
//! WASM, wall-clock or rendering concepts. The model contract lives in
//! `.wdd/epics/core.md`.

pub mod cities;
pub mod command;
pub mod demand;
pub mod frame;
pub mod network;
pub mod params;
pub mod rng;
pub mod routing;
pub mod timeline;
pub mod world;

pub use cities::{City, Landmarks, Zone, ZoneKind};
pub use command::{Command, CommandError, CommandKind};
pub use demand::{DemandError, DemandModel, OdFlow, Profile, TripRequest};
pub use network::{Link, LinkId, Network, NetworkBuilder, NetworkError, Node, NodeId};
pub use timeline::{Snapshot, Timeline, TimelineError, WindowInfo, SNAPSHOT_INTERVAL_TICKS};
pub use world::{
    CompletedTrip, Counts, GeneratedTrip, LinkStats, Metrics, RerouteStats, Scenario, SpawnError, TripOutcome, VehicleId,
    VehicleInfo, VehicleState, VehicleView, WindowMetrics, World,
};
