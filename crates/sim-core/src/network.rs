//! Directed road network. Node coordinates are world meters (simulation
//! data); nothing here knows about screens or drawing.

use crate::params::{JAM_SPACING, MAX_LANES, MAX_LINK_LENGTH, MIN_LINK_LENGTH};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct NodeId(pub u32);

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct LinkId(pub u32);

impl NodeId {
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

impl LinkId {
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Node {
    pub id: NodeId,
    pub x_m: f64,
    pub y_m: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Link {
    pub id: LinkId,
    pub from: NodeId,
    pub to: NodeId,
    pub length_m: f64,
    pub speed_limit_mps: f64,
    pub lanes: u8,
}

#[derive(Clone, Debug, PartialEq)]
pub enum NetworkError {
    UnknownNode(NodeId),
    SelfLoop(NodeId),
    TooShort { from: NodeId, to: NodeId, length_m: f64 },
    TooLong { from: NodeId, to: NodeId, length_m: f64 },
    InvalidSpeed { from: NodeId, to: NodeId },
    InvalidLanes { from: NodeId, to: NodeId, lanes: u8 },
}

#[derive(Clone, Debug)]
struct PendingLink {
    from: NodeId,
    to: NodeId,
    /// `None` = Euclidean distance between the nodes.
    length_m: Option<f64>,
    speed_limit_mps: f64,
    lanes: u8,
}

/// Collects nodes and links; all validation happens in [`NetworkBuilder::build`],
/// so the builder itself never panics.
#[derive(Clone, Debug, Default)]
pub struct NetworkBuilder {
    nodes: Vec<Node>,
    zones: Vec<bool>,
    links: Vec<PendingLink>,
}

impl NetworkBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn node(&mut self, x_m: f64, y_m: f64) -> NodeId {
        self.push_node(x_m, y_m, false)
    }

    /// Zone centroid: trips may start and end here, but no route passes through it.
    pub fn zone(&mut self, x_m: f64, y_m: f64) -> NodeId {
        self.push_node(x_m, y_m, true)
    }

    fn push_node(&mut self, x_m: f64, y_m: f64, zone: bool) -> NodeId {
        let id = NodeId(self.nodes.len() as u32);
        self.nodes.push(Node { id, x_m, y_m });
        self.zones.push(zone);
        id
    }

    /// Link whose length is the Euclidean distance between its nodes.
    pub fn link(&mut self, from: NodeId, to: NodeId, speed_limit_mps: f64, lanes: u8) -> LinkId {
        self.push_link(from, to, None, speed_limit_mps, lanes)
    }

    pub fn link_with_length(
        &mut self,
        from: NodeId,
        to: NodeId,
        length_m: f64,
        speed_limit_mps: f64,
        lanes: u8,
    ) -> LinkId {
        self.push_link(from, to, Some(length_m), speed_limit_mps, lanes)
    }

    /// Two opposite links; returns (a→b, b→a).
    pub fn two_way(&mut self, a: NodeId, b: NodeId, speed_limit_mps: f64, lanes: u8) -> (LinkId, LinkId) {
        (self.link(a, b, speed_limit_mps, lanes), self.link(b, a, speed_limit_mps, lanes))
    }

    fn push_link(&mut self, from: NodeId, to: NodeId, length_m: Option<f64>, speed_limit_mps: f64, lanes: u8) -> LinkId {
        let id = LinkId(self.links.len() as u32);
        self.links.push(PendingLink { from, to, length_m, speed_limit_mps, lanes });
        id
    }

    pub fn build(self) -> Result<Network, NetworkError> {
        let n_nodes = self.nodes.len();
        let mut links = Vec::with_capacity(self.links.len());
        for (i, p) in self.links.iter().enumerate() {
            for node in [p.from, p.to] {
                if node.index() >= n_nodes {
                    return Err(NetworkError::UnknownNode(node));
                }
            }
            if p.from == p.to {
                return Err(NetworkError::SelfLoop(p.from));
            }
            let length_m = p.length_m.unwrap_or_else(|| {
                let (a, b) = (&self.nodes[p.from.index()], &self.nodes[p.to.index()]);
                let (dx, dy) = (b.x_m - a.x_m, b.y_m - a.y_m);
                (dx * dx + dy * dy).sqrt()
            });
            if !(length_m.is_finite() && length_m >= MIN_LINK_LENGTH) {
                return Err(NetworkError::TooShort { from: p.from, to: p.to, length_m });
            }
            if length_m > MAX_LINK_LENGTH {
                return Err(NetworkError::TooLong { from: p.from, to: p.to, length_m });
            }
            if !(p.speed_limit_mps.is_finite() && p.speed_limit_mps > 0.0) {
                return Err(NetworkError::InvalidSpeed { from: p.from, to: p.to });
            }
            if p.lanes == 0 || p.lanes > MAX_LANES {
                return Err(NetworkError::InvalidLanes { from: p.from, to: p.to, lanes: p.lanes });
            }
            links.push(Link {
                id: LinkId(i as u32),
                from: p.from,
                to: p.to,
                length_m,
                speed_limit_mps: p.speed_limit_mps,
                lanes: p.lanes,
            });
        }

        // Links are pushed in id order, so adjacency lists come out ascending.
        let mut out_links = vec![Vec::new(); n_nodes];
        let mut in_links = vec![Vec::new(); n_nodes];
        for l in &links {
            out_links[l.from.index()].push(l.id);
            in_links[l.to.index()].push(l.id);
        }
        let in_lanes = in_links
            .iter()
            .map(|ls: &Vec<LinkId>| {
                ls.iter()
                    .flat_map(|&l| (0..links[l.index()].lanes).map(move |lane| (l, lane)))
                    .collect()
            })
            .collect();
        let lane_capacity = links
            .iter()
            .map(|l| ((l.length_m / JAM_SPACING).floor() as u32).max(1))
            .collect();

        Ok(Network { nodes: self.nodes, zones: self.zones, links, out_links, in_links, in_lanes, lane_capacity })
    }
}

#[derive(Clone, Debug)]
pub struct Network {
    nodes: Vec<Node>,
    zones: Vec<bool>,
    links: Vec<Link>,
    out_links: Vec<Vec<LinkId>>,
    in_links: Vec<Vec<LinkId>>,
    /// Per node: incoming (link, lane) pairs, links ascending then lanes ascending.
    in_lanes: Vec<Vec<(LinkId, u8)>>,
    lane_capacity: Vec<u32>,
}

impl Network {
    pub fn nodes(&self) -> &[Node] {
        &self.nodes
    }

    pub fn links(&self) -> &[Link] {
        &self.links
    }

    pub fn node(&self, id: NodeId) -> &Node {
        &self.nodes[id.index()]
    }

    pub fn link(&self, id: LinkId) -> &Link {
        &self.links[id.index()]
    }

    /// Outgoing links, ascending by id.
    pub fn out_links(&self, node: NodeId) -> &[LinkId] {
        &self.out_links[node.index()]
    }

    /// Incoming links, ascending by id.
    pub fn in_links(&self, node: NodeId) -> &[LinkId] {
        &self.in_links[node.index()]
    }

    /// Incoming lanes in round-robin scan order (link id, then lane).
    pub fn in_lanes(&self, node: NodeId) -> &[(LinkId, u8)] {
        &self.in_lanes[node.index()]
    }

    pub fn is_zone(&self, node: NodeId) -> bool {
        self.zones[node.index()]
    }

    /// Vehicles one lane can store: max(1, floor(length / JAM_SPACING)).
    pub fn lane_capacity(&self, link: LinkId) -> u32 {
        self.lane_capacity[link.index()]
    }

    /// lanes × lane_capacity.
    pub fn capacity(&self, link: LinkId) -> u32 {
        self.links[link.index()].lanes as u32 * self.lane_capacity[link.index()]
    }
}
