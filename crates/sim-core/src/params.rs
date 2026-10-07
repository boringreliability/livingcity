//! Model constants. The single place for tunable numbers; see the model
//! contract in `.wdd/epics/core.md`.

/// Fixed tick length in seconds. Sim time = tick × DT.
pub const DT: f64 = 0.5;
/// Road length one stopped vehicle occupies in a lane (m).
pub const JAM_SPACING: f64 = 7.5;
/// Intersection discharge capacity per lane (veh/s), i.e. 1800 veh/h.
pub const SAT_FLOW_PER_LANE: f64 = 0.5;
/// Discharge credit a lane earns per tick.
/// The credit increment of a default link. Links use `sat_flow_per_lane * DT` (contract C1).
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
/// Highest accepted demand rate per OD flow (veh/h); keeps `trips_at` bounded.
pub const MAX_FLOW_VEH_PER_HOUR: f64 = 100_000.0;
/// Link-cost update interval (ticks) = 30 s.
pub const COST_EPOCH_TICKS: u64 = 60;
/// Link-cost smoothing weight of the new observation.
pub const COST_EMA_ALPHA: f64 = 0.5;
/// Periodic route reconsideration interval (ticks) = 120 s, staggered by trip id.
pub const REROUTE_PERIOD_TICKS: u64 = 240;
/// Max budgeted route computations per tick (forced decisions and retries excluded).
pub const REROUTE_BUDGET_PER_TICK: u32 = 200;
/// Hysteresis: a periodic reroute switches only if new < SWITCH_RATIO × current …
pub const SWITCH_RATIO: f64 = 0.85;
/// … and saves at least this many seconds.
pub const SWITCH_MIN_GAIN_S: f64 = 20.0;
/// NoRoute/stranded retry interval (ticks) = 30 s.
pub const NO_ROUTE_RETRY_TICKS: u64 = 60;
/// Failed retries before a NoRoute/stranded vehicle is removed.
pub const NO_ROUTE_MAX_RETRIES: u32 = 10;
/// Max lanes per link.
pub const MAX_LANES: u8 = 8;

/// Highest accepted per-link saturation flow (veh/s per lane): one credit per tick.
pub const MAX_SAT_FLOW_PER_LANE: f64 = 2.0;
/// Gridlock relief: a front blocked by a full downstream link reroutes at every
/// positive multiple of this many blocked ticks (60 s), below the removal threshold.
pub const GRIDLOCK_REROUTE_TICKS: u64 = 120;
/// Gridlock relief: a front blocked this many ticks (10 min) is removed.
pub const GRIDLOCK_REMOVE_TICKS: u64 = 1200;
