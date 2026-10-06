//! Model constants. The single place for tunable numbers; see the model
//! contract in `.wdd/epics/core.md`.

/// Fixed tick length in seconds. Sim time = tick × DT.
pub const DT: f64 = 0.5;
/// Road length one stopped vehicle occupies in a lane (m).
pub const JAM_SPACING: f64 = 7.5;
/// Intersection discharge capacity per lane (veh/s), i.e. 1800 veh/h.
pub const SAT_FLOW_PER_LANE: f64 = 0.5;
/// Discharge credit a lane earns per tick.
pub const LANE_CREDIT_PER_TICK: f64 = SAT_FLOW_PER_LANE * DT;
/// Maximum banked discharge credit per lane.
pub const LANE_CREDIT_CAP: f64 = 1.0;
/// Maximum acceleration (m/s²). Deceleration is instantaneous.
pub const ACCEL: f64 = 2.0;
/// Vehicles on the network slower than this (m/s) count as queued.
pub const QUEUED_SPEED: f64 = 2.0;
/// Max vehicles an origin injects per tick.
pub const ORIGIN_ADMIT_PER_TICK: usize = 2;
/// Shortest allowed link (m). Guarantees a vehicle cannot cross a link in one tick.
pub const MIN_LINK_LENGTH: f64 = 10.0;
/// Longest allowed link (m). Keeps lane/link capacities far inside `u32`.
pub const MAX_LINK_LENGTH: f64 = 50_000.0;
/// Link-cost update interval (ticks) = 30 s.
pub const COST_EPOCH_TICKS: u64 = 60;
/// Link-cost smoothing weight of the new observation.
pub const COST_EMA_ALPHA: f64 = 0.5;
/// Max lanes per link.
pub const MAX_LANES: u8 = 8;
