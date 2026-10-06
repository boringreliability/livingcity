//! Directed road network. Node coordinates are world meters (simulation
//! data); nothing here knows about screens or drawing.

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
    InvalidSpeed { from: NodeId, to: NodeId },
    InvalidLanes { from: NodeId, to: NodeId, lanes: u8 },
}

#[derive(Clone, Debug, Default)]
pub struct NetworkBuilder {
    _private: (),
}

impl NetworkBuilder {
    pub fn new() -> Self {
        todo!()
    }

    pub fn node(&mut self, _x_m: f64, _y_m: f64) -> NodeId {
        todo!()
    }

    /// Link whose length is the Euclidean distance between its nodes.
    pub fn link(&mut self, _from: NodeId, _to: NodeId, _speed_limit_mps: f64, _lanes: u8) -> LinkId {
        todo!()
    }

    pub fn link_with_length(
        &mut self,
        _from: NodeId,
        _to: NodeId,
        _length_m: f64,
        _speed_limit_mps: f64,
        _lanes: u8,
    ) -> LinkId {
        todo!()
    }

    /// Two opposite links; returns (a→b, b→a).
    pub fn two_way(&mut self, _a: NodeId, _b: NodeId, _speed_limit_mps: f64, _lanes: u8) -> (LinkId, LinkId) {
        todo!()
    }

    pub fn build(self) -> Result<Network, NetworkError> {
        todo!()
    }
}

#[derive(Clone, Debug)]
pub struct Network {
    _private: (),
}

impl Network {
    pub fn nodes(&self) -> &[Node] {
        todo!()
    }

    pub fn links(&self) -> &[Link] {
        todo!()
    }

    pub fn node(&self, _id: NodeId) -> &Node {
        todo!()
    }

    pub fn link(&self, _id: LinkId) -> &Link {
        todo!()
    }

    /// Outgoing links, ascending by id.
    pub fn out_links(&self, _node: NodeId) -> &[LinkId] {
        todo!()
    }

    /// Incoming links, ascending by id.
    pub fn in_links(&self, _node: NodeId) -> &[LinkId] {
        todo!()
    }

    /// Vehicles one lane can store: max(1, floor(length / JAM_SPACING)).
    pub fn lane_capacity(&self, _link: LinkId) -> u32 {
        todo!()
    }

    /// lanes × lane_capacity.
    pub fn capacity(&self, _link: LinkId) -> u32 {
        todo!()
    }
}
