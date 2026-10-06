//! Simulation state and the fixed-step tick. Implements the model contract
//! in `.wdd/epics/core.md` (tick order steps 4–7).

use std::collections::VecDeque;

use crate::demand::{trips_at, DemandError, DemandModel};
use crate::network::{LinkId, Network, NodeId};
use crate::params::{
    ACCEL, COST_EMA_ALPHA, COST_EPOCH_TICKS, DT, JAM_SPACING, LANE_CREDIT_CAP, LANE_CREDIT_PER_TICK,
    ORIGIN_ADMIT_PER_TICK, QUEUED_SPEED, SAT_FLOW_PER_LANE,
};
use crate::rng::BehaviorRng;
use crate::routing::{cost_key, free_flow_cost, RouterCache, Tree};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct VehicleId(pub u32);

/// Read-only view of a vehicle on a link.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VehicleView {
    pub id: VehicleId,
    pub trip_id: u64,
    pub lane: u8,
    pub s: f64,
    pub v: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub spawned: u64,
    pub active: u64,
    pub on_network: u64,
    pub waiting_at_origin: u64,
    pub no_route: u64,
    pub completed: u64,
    pub removed: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompletedTrip {
    pub trip_id: u64,
    pub created_tick: u64,
    pub completed_tick: u64,
}

/// A demand-generated trip (explicit spawns are not demand).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GeneratedTrip {
    pub trip_id: u64,
    pub flow_index: usize,
    pub origin: NodeId,
    pub dest: NodeId,
    pub created_tick: u64,
}

/// Everything needed to build a world that runs by itself.
#[derive(Clone, Debug)]
pub struct Scenario {
    pub network: Network,
    pub demand: DemandModel,
    pub demand_seed: u64,
    pub behavior_seed: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VehicleState {
    WaitingAtOrigin,
    OnLink(LinkId),
    NoRoute,
}

#[derive(Clone, Debug, PartialEq)]
pub struct VehicleInfo {
    pub trip_id: u64,
    pub route: Vec<LinkId>,
    pub route_pos: usize,
    pub state: VehicleState,
    pub speed_factor: f64,
    pub lane: u8,
    pub s: f64,
    pub v: f64,
    pub created_tick: u64,
}

/// The metric set shown in the UI; definitions in the model contract.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Metrics {
    pub tick: u64,
    pub sim_time_s: f64,
    pub trips_generated: u64,
    pub spawned: u64,
    pub active: u64,
    pub on_network: u64,
    pub waiting_at_origin: u64,
    pub no_route: u64,
    pub queued: u64,
    pub completed: u64,
    pub removed_unreachable: u64,
    pub unreachable: u64,
    pub mean_travel_time_s: Option<f64>,
    pub incomplete: u64,
    pub mean_incomplete_age_s: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SpawnError {
    EmptyRoute,
    UnknownLink(LinkId),
    NonContiguousRoute { at: usize },
    /// The origin has in-links and is not a zone: admission there would
    /// compete unfairly with through traffic.
    OriginHasThroughTraffic(NodeId),
    /// `route[at].from` is a zone in the middle of the route.
    RouteThroughZone { at: usize },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    WaitingAtOrigin,
    OnLink,
    /// No route exists; waits in place (retry/removal: core-003).
    NoRoute,
}

#[derive(Clone, Debug)]
struct Vehicle {
    trip_id: u64,
    route: Vec<LinkId>,
    route_pos: usize,
    state: Phase,
    lane: u8,
    s: f64,
    v: f64,
    speed_factor: f64,
    created_tick: u64,
    link_enter_tick: u64,
    /// Tick in which the vehicle crossed or was admitted; such a vehicle does
    /// not move again (movement step) or cross again in that tick.
    moved_tick: u64,
}

impl Vehicle {
    fn current_link(&self) -> LinkId {
        self.route[self.route_pos]
    }
}

#[derive(Clone, Debug)]
pub struct World {
    network: Network,
    tick: u64,
    /// Slot table; `None` = free slot. Freed slots are reused LIFO.
    slots: Vec<Option<Vehicle>>,
    free: Vec<u32>,
    /// `lanes[link][lane]`: vehicle slots, front (nearest stop line) first.
    lanes: Vec<Vec<VecDeque<u32>>>,
    credit: Vec<Vec<f64>>,
    rr_next: Vec<u32>,
    origin_buffers: Vec<VecDeque<u32>>,
    exit_count: Vec<u64>,
    next_trip_id: u64,
    spawned: u64,
    completed: u64,
    removed: u64,
    completed_log: Vec<CompletedTrip>,
    demand: DemandModel,
    demand_seed: u64,
    behavior_rng: BehaviorRng,
    generated: Vec<GeneratedTrip>,
    free_flow: Vec<f64>,
    /// Current link cost (s), ≥ free flow; changes only at epoch boundaries.
    smoothed: Vec<f64>,
    cost_keys: Vec<u64>,
    exit_time_sum: Vec<f64>,
    exit_time_n: Vec<u64>,
    cost_epoch: u64,
    /// Derived from costs + epoch (+ closures); rebuildable, not sim state.
    router: RouterCache,
}

const NOT_MOVED: u64 = u64::MAX;

impl World {
    pub fn new(network: Network) -> Self {
        Self::from_parts(network, DemandModel::default(), 0, 0)
    }

    pub fn from_scenario(scenario: Scenario) -> Result<World, DemandError> {
        scenario.demand.validate(&scenario.network)?;
        Ok(Self::from_parts(scenario.network, scenario.demand, scenario.demand_seed, scenario.behavior_seed))
    }

    fn from_parts(network: Network, demand: DemandModel, demand_seed: u64, behavior_seed: u64) -> Self {
        let free_flow: Vec<f64> = network.links().iter().map(free_flow_cost).collect();
        let cost_keys = free_flow.iter().map(|&c| cost_key(c)).collect();
        let lanes = network
            .links()
            .iter()
            .map(|l| vec![VecDeque::new(); l.lanes as usize])
            .collect();
        let credit = network.links().iter().map(|l| vec![0.0; l.lanes as usize]).collect();
        let n_nodes = network.nodes().len();
        let n_links = network.links().len();
        World {
            network,
            tick: 0,
            slots: Vec::new(),
            free: Vec::new(),
            lanes,
            credit,
            rr_next: vec![0; n_nodes],
            origin_buffers: vec![VecDeque::new(); n_nodes],
            exit_count: vec![0; n_links],
            next_trip_id: 0,
            spawned: 0,
            completed: 0,
            removed: 0,
            completed_log: Vec::new(),
            demand,
            demand_seed,
            behavior_rng: BehaviorRng::new(behavior_seed),
            generated: Vec::new(),
            smoothed: free_flow.clone(),
            free_flow,
            cost_keys,
            exit_time_sum: vec![0.0; n_links],
            exit_time_n: vec![0; n_links],
            cost_epoch: 0,
            router: RouterCache::default(),
        }
    }

    pub fn network(&self) -> &Network {
        &self.network
    }

    pub fn generated_trips(&self) -> &[GeneratedTrip] {
        &self.generated
    }

    /// Current smoothed cost of a link (s); changes only at epoch boundaries.
    pub fn link_cost(&self, link: LinkId) -> f64 {
        self.smoothed[link.index()]
    }

    pub fn cost_epoch(&self) -> u64 {
        self.cost_epoch
    }

    /// Best route under current costs and its cost (s), or None if unreachable.
    pub fn shortest_route(&self, from: NodeId, to: NodeId) -> Option<(Vec<LinkId>, f64)> {
        let n = self.network.nodes().len();
        if from.index() >= n || to.index() >= n {
            return None;
        }
        Tree::build(&self.network, &self.cost_keys, |_| true, to).route(&self.network, from)
    }

    /// Route via the per-epoch cache (same result as `shortest_route`).
    fn route_for(&mut self, from: NodeId, to: NodeId) -> Option<(Vec<LinkId>, f64)> {
        let (net, keys) = (&self.network, &self.cost_keys);
        self.router.tree(net, keys, |_| true, self.cost_epoch, to).route(net, from)
    }

    pub fn vehicle(&self, id: VehicleId) -> Option<VehicleInfo> {
        let v = self.slots.get(id.0 as usize)?.as_ref()?;
        let state = match v.state {
            Phase::WaitingAtOrigin => VehicleState::WaitingAtOrigin,
            Phase::OnLink => VehicleState::OnLink(v.current_link()),
            Phase::NoRoute => VehicleState::NoRoute,
        };
        Some(VehicleInfo {
            trip_id: v.trip_id,
            route: v.route.clone(),
            route_pos: v.route_pos,
            state,
            speed_factor: v.speed_factor,
            lane: v.lane,
            s: v.s,
            v: v.v,
            created_tick: v.created_tick,
        })
    }

    /// Live vehicles, ascending.
    pub fn vehicle_ids(&self) -> Vec<VehicleId> {
        (0..self.slots.len() as u32).filter(|&s| self.slots[s as usize].is_some()).map(VehicleId).collect()
    }

    pub fn metrics(&self) -> Metrics {
        let c = self.counts();
        let queued = self
            .lanes
            .iter()
            .flatten()
            .flatten()
            .filter(|&&slot| self.veh(slot).v < QUEUED_SPEED)
            .count() as u64;
        let ages: Vec<f64> = self
            .slots
            .iter()
            .flatten()
            .map(|v| (self.tick - v.created_tick) as f64 * DT)
            .collect();
        let mean_incomplete_age_s = (!ages.is_empty()).then(|| ages.iter().sum::<f64>() / ages.len() as f64);
        Metrics {
            tick: self.tick,
            sim_time_s: self.tick as f64 * DT,
            trips_generated: self.generated.len() as u64,
            spawned: c.spawned,
            active: c.active,
            on_network: c.on_network,
            waiting_at_origin: c.waiting_at_origin,
            no_route: c.no_route,
            queued,
            completed: c.completed,
            removed_unreachable: c.removed,
            unreachable: c.no_route + c.removed,
            mean_travel_time_s: mean_travel_time(self.completed_log.iter()),
            incomplete: c.active,
            mean_incomplete_age_s,
        }
    }

    /// Mean travel time (s) of trips with `completed_tick` in `[from_tick, to_tick)`.
    pub fn mean_travel_time_s_between(&self, from_tick: u64, to_tick: u64) -> Option<f64> {
        mean_travel_time(
            self.completed_log.iter().filter(|c| c.completed_tick >= from_tick && c.completed_tick < to_tick),
        )
    }

    pub fn tick(&self) -> u64 {
        self.tick
    }

    /// Enqueue a vehicle with an explicit route in the origin buffer of
    /// `route[0].from`. Validation is rule-major (see the contract).
    pub fn spawn_with_route(&mut self, route: Vec<LinkId>) -> Result<VehicleId, SpawnError> {
        self.validate_route(&route)?;
        let origin = self.network.link(route[0]).from;
        let vehicle = Vehicle {
            trip_id: self.next_trip_id,
            route,
            route_pos: 0,
            state: Phase::WaitingAtOrigin,
            lane: 0,
            s: 0.0,
            v: 0.0,
            speed_factor: 1.0,
            created_tick: self.tick,
            link_enter_tick: self.tick,
            moved_tick: NOT_MOVED,
        };
        Ok(self.enqueue_at_origin(origin, vehicle))
    }

    /// Takes the next trip id, stores the vehicle (LIFO slot reuse) and
    /// appends it to its origin buffer.
    fn enqueue_at_origin(&mut self, origin: NodeId, vehicle: Vehicle) -> VehicleId {
        debug_assert_eq!(vehicle.trip_id, self.next_trip_id);
        self.next_trip_id += 1;
        self.spawned += 1;
        let slot = match self.free.pop() {
            Some(slot) => {
                self.slots[slot as usize] = Some(vehicle);
                slot
            }
            None => {
                self.slots.push(Some(vehicle));
                (self.slots.len() - 1) as u32
            }
        };
        self.origin_buffers[origin.index()].push_back(slot);
        VehicleId(slot)
    }

    /// Step 2: this tick's demand, routed under the costs in force now.
    fn spawn_demand(&mut self) {
        for req in trips_at(&self.demand, self.demand_seed, self.tick) {
            let speed_factor = 0.9 + 0.2 * self.behavior_rng.next_f64();
            let (route, state) = match self.route_for(req.origin, req.dest) {
                Some((route, _)) => (route, Phase::WaitingAtOrigin),
                None => (Vec::new(), Phase::NoRoute),
            };
            let trip_id = self.next_trip_id;
            self.generated.push(GeneratedTrip {
                trip_id,
                flow_index: req.flow_index,
                origin: req.origin,
                dest: req.dest,
                created_tick: self.tick,
            });
            let vehicle = Vehicle {
                trip_id,
                route,
                route_pos: 0,
                state,
                lane: 0,
                s: 0.0,
                v: 0.0,
                speed_factor,
                created_tick: self.tick,
                link_enter_tick: self.tick,
                moved_tick: NOT_MOVED,
            };
            self.enqueue_at_origin(req.origin, vehicle);
        }
    }

    /// Step 3 at epoch boundaries: EMA link-cost update (see the contract).
    fn update_costs(&mut self) {
        for (l, link) in self.network.links().iter().enumerate() {
            let queued = self.lanes[l].iter().flatten().filter(|&&s| self.veh(s).v < QUEUED_SPEED).count();
            let queue_term = link.length_m / link.speed_limit_mps
                + queued as f64 / (link.lanes as f64 * SAT_FLOW_PER_LANE);
            let observed = if self.exit_time_n[l] > 0 {
                (self.exit_time_sum[l] / self.exit_time_n[l] as f64).max(queue_term)
            } else {
                queue_term
            };
            self.smoothed[l] =
                self.free_flow[l].max(COST_EMA_ALPHA * observed + (1.0 - COST_EMA_ALPHA) * self.smoothed[l]);
            self.cost_keys[l] = cost_key(self.smoothed[l]);
            self.exit_time_sum[l] = 0.0;
            self.exit_time_n[l] = 0;
        }
        self.cost_epoch += 1;
        self.router.invalidate();
    }

    fn record_exit(&mut self, link: LinkId, slot: u32) {
        let enter = self.veh(slot).link_enter_tick;
        self.exit_count[link.index()] += 1;
        self.exit_time_sum[link.index()] += (self.tick - enter) as f64 * DT;
        self.exit_time_n[link.index()] += 1;
    }

    fn validate_route(&self, route: &[LinkId]) -> Result<(), SpawnError> {
        let net = &self.network;
        if route.is_empty() {
            return Err(SpawnError::EmptyRoute);
        }
        if let Some(&bad) = route.iter().find(|l| l.index() >= net.links().len()) {
            return Err(SpawnError::UnknownLink(bad));
        }
        if let Some(i) = (1..route.len()).find(|&i| net.link(route[i - 1]).to != net.link(route[i]).from) {
            return Err(SpawnError::NonContiguousRoute { at: i });
        }
        let origin = net.link(route[0]).from;
        if !net.is_zone(origin) && !net.in_links(origin).is_empty() {
            return Err(SpawnError::OriginHasThroughTraffic(origin));
        }
        if let Some(i) = (1..route.len()).find(|&i| net.is_zone(net.link(route[i]).from)) {
            return Err(SpawnError::RouteThroughZone { at: i });
        }
        Ok(())
    }

    /// Advance one fixed tick.
    pub fn step(&mut self) {
        self.spawn_demand();
        if self.tick > 0 && self.tick.is_multiple_of(COST_EPOCH_TICKS) {
            self.update_costs();
        }
        self.discharge_nodes();
        self.admit_origins();
        self.move_vehicles();
        self.tick += 1;
    }

    fn veh(&self, slot: u32) -> &Vehicle {
        self.slots[slot as usize].as_ref().expect("live vehicle slot")
    }

    fn veh_mut(&mut self, slot: u32) -> &mut Vehicle {
        self.slots[slot as usize].as_mut().expect("live vehicle slot")
    }

    fn vmax(&self, link: LinkId, v: &Vehicle) -> f64 {
        self.network.link(link).speed_limit_mps * v.speed_factor
    }

    /// Lower bound of a lane tail's position after this tick's movement.
    fn tail_guaranteed(&self, link: LinkId, lane: usize) -> Option<f64> {
        let q = &self.lanes[link.index()][lane];
        let &tail = q.back()?;
        let t = self.veh(tail);
        if t.moved_tick == self.tick {
            return Some(t.s);
        }
        let v_next = (t.v + ACCEL * DT).min(self.vmax(link, t));
        let limit = if q.len() == 1 {
            self.network.link(link).length_m
        } else {
            self.veh(q[q.len() - 2]).s - JAM_SPACING
        };
        Some((t.s + v_next * DT).min(limit))
    }

    /// Lane-choice rule: among feasible lanes, the one whose guaranteed tail
    /// is furthest ahead (empty = best), ties → lowest lane index.
    fn choose_lane(&self, link: LinkId, entry_s: f64) -> Option<u8> {
        let cap = self.network.lane_capacity(link) as usize;
        let mut best: Option<(u8, f64)> = None;
        for lane in 0..self.lanes[link.index()].len() {
            if self.lanes[link.index()][lane].len() >= cap {
                continue;
            }
            let room = match self.tail_guaranteed(link, lane) {
                None => f64::INFINITY,
                Some(tg) if tg >= entry_s + JAM_SPACING => tg,
                Some(_) => continue,
            };
            if best.is_none_or(|(_, r)| room > r) {
                best = Some((lane as u8, room));
            }
        }
        best.map(|(lane, _)| lane)
    }

    fn place_on_link(&mut self, slot: u32, link: LinkId, lane: u8, s: f64, v: f64) {
        let tick = self.tick;
        let veh = self.veh_mut(slot);
        veh.state = Phase::OnLink;
        veh.lane = lane;
        veh.s = s;
        veh.v = v;
        veh.link_enter_tick = tick;
        veh.moved_tick = tick;
        self.lanes[link.index()][lane as usize].push_back(slot);
    }

    /// Step 4: round-robin discharge of each node's incoming lanes.
    fn discharge_nodes(&mut self) {
        for n in 0..self.network.nodes().len() {
            let node = NodeId(n as u32);
            let k = self.network.in_lanes(node).len();
            if k == 0 {
                continue;
            }
            let start = self.rr_next[n] as usize % k;
            let mut new_rr = None;
            for j in 0..k {
                let idx = (start + j) % k;
                let (link, lane) = self.network.in_lanes(node)[idx];
                if self.discharge_lane(link, lane as usize) == Crossing::Transferred {
                    new_rr = Some(((idx + 1) % k) as u32);
                }
            }
            if let Some(r) = new_rr {
                self.rr_next[n] = r;
            }
        }
    }

    fn discharge_lane(&mut self, link: LinkId, lane: usize) -> Crossing {
        let credit = &mut self.credit[link.index()][lane];
        *credit = (*credit + LANE_CREDIT_PER_TICK).min(LANE_CREDIT_CAP);

        let Some(&slot) = self.lanes[link.index()][lane].front() else {
            return Crossing::None;
        };
        let veh = self.veh(slot);
        if veh.moved_tick == self.tick {
            return Crossing::None;
        }
        let length = self.network.link(link).length_m;
        let v_next = (veh.v + ACCEL * DT).min(self.vmax(link, veh));
        let reach = veh.s + v_next * DT;
        // Contract: crossing iff `s + v' * DT >= length` (all values finite).
        if reach < length {
            return Crossing::None;
        }

        if veh.route_pos + 1 == veh.route.len() {
            self.lanes[link.index()][lane].pop_front();
            self.record_exit(link, slot);
            self.complete(slot);
            return Crossing::Completed;
        }

        if self.credit[link.index()][lane] < 1.0 {
            return Crossing::None;
        }
        let next = veh.route[veh.route_pos + 1];
        let next_len = self.network.link(next).length_m;
        let entry_s = (reach - length).min(next_len);
        let Some(next_lane) = self.choose_lane(next, entry_s) else {
            return Crossing::None;
        };
        let v_entry = v_next.min(self.network.link(next).speed_limit_mps * veh.speed_factor);

        self.credit[link.index()][lane] -= 1.0;
        self.lanes[link.index()][lane].pop_front();
        self.record_exit(link, slot);
        self.veh_mut(slot).route_pos += 1;
        self.place_on_link(slot, next, next_lane, entry_s, v_entry);
        Crossing::Transferred
    }

    fn complete(&mut self, slot: u32) {
        let veh = self.slots[slot as usize].take().expect("live vehicle slot");
        self.completed_log.push(CompletedTrip {
            trip_id: veh.trip_id,
            created_tick: veh.created_tick,
            completed_tick: self.tick,
        });
        self.completed += 1;
        self.free.push(slot);
    }

    /// Step 5: FIFO admission per origin, at most ORIGIN_ADMIT_PER_TICK, a
    /// blocked first link blocks only later vehicles for that same link.
    fn admit_origins(&mut self) {
        for n in 0..self.origin_buffers.len() {
            if self.origin_buffers[n].is_empty() {
                continue;
            }
            let mut admitted = 0;
            let mut blocked: Vec<LinkId> = Vec::new();
            let mut i = 0;
            while i < self.origin_buffers[n].len() && admitted < ORIGIN_ADMIT_PER_TICK {
                let slot = self.origin_buffers[n][i];
                if self.veh(slot).state == Phase::NoRoute {
                    i += 1;
                    continue;
                }
                let first = self.veh(slot).route[0];
                if blocked.contains(&first) {
                    i += 1;
                    continue;
                }
                match self.choose_lane(first, 0.0) {
                    Some(lane) => {
                        self.origin_buffers[n].remove(i);
                        self.place_on_link(slot, first, lane, 0.0, 0.0);
                        admitted += 1;
                    }
                    None => {
                        blocked.push(first);
                        i += 1;
                        // Every way out is blocked: nobody else can be admitted.
                        if blocked.len() == self.network.out_links(NodeId(n as u32)).len() {
                            break;
                        }
                    }
                }
            }
        }
    }

    /// Step 6: car-following-lite movement, front → back per lane.
    fn move_vehicles(&mut self) {
        let tick = self.tick;
        for li in 0..self.lanes.len() {
            let link = LinkId(li as u32);
            let (length, vlim) = {
                let l = self.network.link(link);
                (l.length_m, l.speed_limit_mps)
            };
            for lane in 0..self.lanes[li].len() {
                let mut leader_s: Option<f64> = None;
                for k in 0..self.lanes[li][lane].len() {
                    let slot = self.lanes[li][lane][k];
                    let veh = self.slots[slot as usize].as_mut().expect("live vehicle slot");
                    if veh.moved_tick == tick {
                        leader_s = Some(veh.s);
                        continue;
                    }
                    let v_next = (veh.v + ACCEL * DT).min(vlim * veh.speed_factor);
                    let limit = leader_s.map_or(length, |ls| ls - JAM_SPACING);
                    let s_new = veh.s.max((veh.s + v_next * DT).min(limit));
                    veh.v = (s_new - veh.s) / DT;
                    veh.s = s_new;
                    leader_s = Some(s_new);
                }
            }
        }
    }

    pub fn counts(&self) -> Counts {
        let on_network: u64 = self.lanes.iter().flatten().map(|q| q.len() as u64).sum();
        let buffered: u64 = self.origin_buffers.iter().map(|b| b.len() as u64).sum();
        let no_route = self
            .origin_buffers
            .iter()
            .flatten()
            .filter(|&&slot| self.veh(slot).state == Phase::NoRoute)
            .count() as u64;
        Counts {
            spawned: self.spawned,
            active: on_network + buffered,
            on_network,
            waiting_at_origin: buffered - no_route,
            no_route,
            completed: self.completed,
            removed: self.removed,
        }
    }

    /// Vehicles on a link, lane ascending, front (nearest stop line) first.
    pub fn link_vehicles(&self, link: LinkId) -> Vec<VehicleView> {
        let mut out = Vec::with_capacity(self.link_count(link) as usize);
        for q in &self.lanes[link.index()] {
            for &slot in q {
                let v = self.veh(slot);
                out.push(VehicleView { id: VehicleId(slot), trip_id: v.trip_id, lane: v.lane, s: v.s, v: v.v });
            }
        }
        out
    }

    pub fn link_count(&self, link: LinkId) -> u32 {
        self.lanes[link.index()].iter().map(|q| q.len() as u32).sum()
    }

    /// Cumulative vehicles that left the link (transfer or completion).
    pub fn link_exit_count(&self, link: LinkId) -> u64 {
        self.exit_count[link.index()]
    }

    pub fn origin_buffer_len(&self, node: NodeId) -> usize {
        self.origin_buffers[node.index()].len()
    }

    pub fn completed_log(&self) -> &[CompletedTrip] {
        &self.completed_log
    }

    /// Conservation, lane ordering/spacing, capacity, finite values.
    pub fn check_invariants(&self) -> Result<(), String> {
        let c = self.counts();
        if c.spawned != c.active + c.completed + c.removed {
            return Err(format!("conservation: {c:?}"));
        }
        let live = self.slots.iter().filter(|s| s.is_some()).count() as u64;
        if live != c.active {
            return Err(format!("slot table holds {live} vehicles, active = {}", c.active));
        }
        for link in self.network.links() {
            let cap = self.network.lane_capacity(link.id) as usize;
            for (lane, q) in self.lanes[link.id.index()].iter().enumerate() {
                if q.len() > cap {
                    return Err(format!("{:?} lane {lane}: {} > lane capacity {cap}", link.id, q.len()));
                }
                let mut leader: Option<f64> = None;
                for &slot in q {
                    let v = self.slots[slot as usize]
                        .as_ref()
                        .ok_or_else(|| format!("{:?} lane {lane} holds freed slot {slot}", link.id))?;
                    if v.state != Phase::OnLink || v.current_link() != link.id || v.lane as usize != lane {
                        return Err(format!("slot {slot} misplaced on {:?} lane {lane}", link.id));
                    }
                    if !(v.s.is_finite() && v.v.is_finite()) {
                        return Err(format!("slot {slot}: non-finite s/v"));
                    }
                    if v.s < 0.0 || v.s > link.length_m {
                        return Err(format!("slot {slot}: s = {} outside link", v.s));
                    }
                    if v.v < 0.0 || v.v > link.speed_limit_mps * v.speed_factor + 1e-9 {
                        return Err(format!("slot {slot}: v = {} outside [0, vmax]", v.v));
                    }
                    if let Some(ls) = leader {
                        if ls - v.s < JAM_SPACING - 1e-9 {
                            return Err(format!("{:?} lane {lane}: gap {} < jam spacing", link.id, ls - v.s));
                        }
                    }
                    leader = Some(v.s);
                }
            }
        }
        for (n, buf) in self.origin_buffers.iter().enumerate() {
            for &slot in buf {
                let v = self.slots[slot as usize]
                    .as_ref()
                    .ok_or_else(|| format!("origin {n} holds freed slot {slot}"))?;
                if v.state == Phase::OnLink {
                    return Err(format!("slot {slot} in origin buffer but on a link"));
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Crossing {
    None,
    Completed,
    Transferred,
}

/// Mean of `(completed − created) × DT`, summed in iteration order.
fn mean_travel_time<'a>(trips: impl Iterator<Item = &'a CompletedTrip>) -> Option<f64> {
    let times: Vec<f64> = trips.map(|c| (c.completed_tick - c.created_tick) as f64 * DT).collect();
    (!times.is_empty()).then(|| times.iter().sum::<f64>() / times.len() as f64)
}
