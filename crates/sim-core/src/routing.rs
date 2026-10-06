//! Link costs and the deterministic shortest-path router.

use crate::network::Link;

/// length / vmax + 1 / (lanes × SAT_FLOW_PER_LANE), in seconds.
pub fn free_flow_cost(_link: &Link) -> f64 {
    todo!()
}

/// Integer-millisecond Dijkstra key: `(cost × 1000).round()`.
pub fn cost_key(_cost_s: f64) -> u64 {
    todo!()
}
