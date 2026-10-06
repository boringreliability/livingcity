//! Link costs and the deterministic shortest-path router.

use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap};

use crate::network::{Link, LinkId, Network, NodeId};
use crate::params::SAT_FLOW_PER_LANE;

/// length / vmax + 1 / (lanes × SAT_FLOW_PER_LANE), in seconds.
pub fn free_flow_cost(link: &Link) -> f64 {
    link.length_m / link.speed_limit_mps + 1.0 / (link.lanes as f64 * SAT_FLOW_PER_LANE)
}

/// Integer-millisecond Dijkstra key: `(cost × 1000).round()`.
pub fn cost_key(cost_s: f64) -> u64 {
    (cost_s * 1000.0).round() as u64
}

const UNREACHABLE: u64 = u64::MAX;

/// Shortest-path tree towards one destination.
#[derive(Clone, Debug)]
pub(crate) struct Tree {
    dist_ms: Vec<u64>,
    next_hop: Vec<Option<LinkId>>,
}

impl Tree {
    /// Reverse Dijkstra over integer keys. Zones other than `dest` are never
    /// expanded, so no path passes through a zone. `usable(l)` excludes links
    /// (closures, core-003).
    pub(crate) fn build(net: &Network, keys: &[u64], usable: impl Fn(LinkId) -> bool, dest: NodeId) -> Tree {
        let n = net.nodes().len();
        let mut dist_ms = vec![UNREACHABLE; n];
        let mut heap = BinaryHeap::new();
        dist_ms[dest.index()] = 0;
        heap.push(Reverse((0u64, dest.0)));
        while let Some(Reverse((d, u))) = heap.pop() {
            let u = NodeId(u);
            if d > dist_ms[u.index()] || (u != dest && net.is_zone(u)) {
                continue;
            }
            for &l in net.in_links(u) {
                if !usable(l) {
                    continue;
                }
                let p = net.link(l).from;
                let nd = d.saturating_add(keys[l.index()]);
                if nd < dist_ms[p.index()] {
                    dist_ms[p.index()] = nd;
                    heap.push(Reverse((nd, p.0)));
                }
            }
        }

        // Next hop: lowest total, ties → lowest link id (strict < while scanning ascending).
        let next_hop = (0..n)
            .map(|u| {
                let u = NodeId(u as u32);
                if u == dest || dist_ms[u.index()] == UNREACHABLE {
                    return None;
                }
                let mut best: Option<(u64, LinkId)> = None;
                for &l in net.out_links(u) {
                    let v = net.link(l).to;
                    if !usable(l) || dist_ms[v.index()] == UNREACHABLE || (v != dest && net.is_zone(v)) {
                        continue;
                    }
                    let total = keys[l.index()].saturating_add(dist_ms[v.index()]);
                    if best.is_none_or(|(b, _)| total < b) {
                        best = Some((total, l));
                    }
                }
                best.map(|(_, l)| l)
            })
            .collect();
        Tree { dist_ms, next_hop }
    }

    /// Route from `from` to the tree's destination and its cost (s).
    pub(crate) fn route(&self, net: &Network, from: NodeId) -> Option<(Vec<LinkId>, f64)> {
        let dist = self.dist_ms[from.index()];
        if dist == UNREACHABLE || dist == 0 {
            return None;
        }
        let mut route = Vec::new();
        let mut u = from;
        while let Some(l) = self.next_hop[u.index()] {
            route.push(l);
            u = net.link(l).to;
            debug_assert!(route.len() <= net.nodes().len(), "next-hop cycle");
        }
        Some((route, dist as f64 / 1000.0))
    }
}

/// Derived cache of trees. Not part of the simulation state: it is rebuilt
/// deterministically on demand. The owner must call `invalidate` whenever the
/// keys or the usable-link set change (epoch update, closures, restore).
#[derive(Clone, Debug, Default)]
pub(crate) struct RouterCache {
    trees: BTreeMap<NodeId, Tree>,
}

impl RouterCache {
    pub(crate) fn invalidate(&mut self) {
        self.trees.clear();
    }

    /// The cached tree for `dest`, built from `keys`/`usable` on a miss.
    pub(crate) fn tree(&mut self, net: &Network, keys: &[u64], usable: impl Fn(LinkId) -> bool, dest: NodeId) -> &Tree {
        self.trees.entry(dest).or_insert_with(|| Tree::build(net, keys, usable, dest))
    }
}
