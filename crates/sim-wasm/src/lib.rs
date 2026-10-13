//! wasm-bindgen adapter: batched steps, commands, and compact buffers.
//! All simulation logic lives in `sim-core`; nothing here knows the clock.

use std::collections::VecDeque;

use wasm_bindgen::prelude::*;

use sim_core::cities::{
    river_city, river_city_scaled, three_bridges, City, Landmarks, Zone, ZoneKind,
};
use sim_core::frame::{
    metrics_to_extended_array, write_link_stats, write_next_links, write_vehicle_records,
    NetworkExport, EXTENDED_METRIC_NAMES,
};
use sim_core::params::{DT, QUEUED_SPEED};
use sim_core::{Command, CommandKind, LinkId, Timeline, TripOutcome, VehicleState, World};

/// Encoded frames whose record → trip tables are kept for picking (contract C4).
const RETAINED_FRAMES: usize = 8;

/// Replay memory per scenario (snapshot budget, ward timeline-003); mirrored in protocol.ts.
const REPLAY_BUDGET_BYTES: usize = 48 * 1024 * 1024;

#[wasm_bindgen]
pub struct Sim {
    /// The scenario: its position world, snapshots and command log (sim-core T1/T2).
    timeline: Timeline,
    frame: Vec<u32>,
    /// Per record of `frame`: the vehicle's next link or `NO_NEXT_LINK` (ward polish-003).
    next_links: Vec<u16>,
    export: NetworkExport,
    link_counts: Vec<u16>,
    link_queued: Vec<u16>,
    landmarks: Landmarks,
    zones: Vec<Zone>,
    city_name: &'static str,
    river: (f64, f64),
    /// (tick, trip id per record) of the last encoded frames, oldest first.
    frame_trips: VecDeque<(u64, Vec<u64>)>,
}

impl Sim {
    fn from_city(city: City) -> Sim {
        let export = NetworkExport::new(&city.scenario.network);
        let world = World::from_scenario(city.scenario).expect("built-in cities are valid");
        Sim {
            timeline: Timeline::new(world, REPLAY_BUDGET_BYTES),
            frame: Vec::new(),
            next_links: Vec::new(),
            export,
            link_counts: Vec::new(),
            link_queued: Vec::new(),
            landmarks: city.landmarks,
            zones: city.zones,
            city_name: city.name,
            river: city.river,
            frame_trips: VecDeque::with_capacity(RETAINED_FRAMES),
        }
    }
}

#[wasm_bindgen]
impl Sim {
    /// The core-epic test city.
    pub fn three_bridges(demand_seed: u32, behavior_seed: u32) -> Sim {
        Sim::from_city(three_bridges(demand_seed as u64, behavior_seed as u64))
    }

    /// The demo city (epic city).
    pub fn river_city(demand_seed: u32, behavior_seed: u32) -> Sim {
        Sim::from_city(river_city(demand_seed as u64, behavior_seed as u64))
    }

    /// The demo city with every flow × `demand_scale` (0 < scale ≤ 6): measurement only.
    pub fn river_city_scaled(
        demand_seed: u32,
        behavior_seed: u32,
        demand_scale: f64,
    ) -> Result<Sim, JsError> {
        river_city_scaled(demand_seed as u64, behavior_seed as u64, demand_scale)
            .map(Sim::from_city)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    pub fn city_name(&self) -> String {
        self.city_name.to_string()
    }

    /// The river corridor `[west_x, east_x]` in metres (simulation data).
    pub fn river(&self) -> Vec<f64> {
        vec![self.river.0, self.river.1]
    }

    pub fn step(&mut self, n: u32) {
        self.timeline.step_n(n as u64);
    }

    /// Restore + replay to `tick` within the retained window; `false` (nothing changed) outside it.
    pub fn seek(&mut self, tick: u32) -> bool {
        let ok = self.timeline.seek(tick as u64).is_ok();
        if ok {
            // picks refer to frames of the old timeline position
            self.frame_trips.clear();
        }
        ok
    }

    /// Forget the retained record → trip tables (picks from before a view switch resolve nothing).
    pub fn forget_frames(&mut self) {
        self.frame_trips.clear();
    }

    /// `[window_start, head_tick, position_tick, snapshot_bytes, budget_bytes, snapshots]`.
    pub fn timeline_info(&self) -> Vec<f64> {
        let w = self.timeline.window();
        vec![
            w.window_start as f64,
            w.head_tick as f64,
            w.position_tick as f64,
            w.snapshot_bytes as f64,
            w.budget_bytes as f64,
            w.snapshots as f64,
        ]
    }

    /// An independent scenario from `at` (sim-core T2): same city, own timeline and frame state.
    pub fn branch(&self, at: u32) -> Result<Sim, JsError> {
        let timeline = self
            .timeline
            .branch(at as u64, REPLAY_BUDGET_BYTES)
            .map_err(|e| JsError::new(&format!("{e:?}")))?;
        Ok(Sim {
            export: NetworkExport::new(timeline.world().network()),
            timeline,
            frame: Vec::new(),
            next_links: Vec::new(),
            link_counts: Vec::new(),
            link_queued: Vec::new(),
            landmarks: self.landmarks,
            zones: self.zones.clone(),
            city_name: self.city_name,
            river: self.river,
            frame_trips: VecDeque::with_capacity(RETAINED_FRAMES),
        })
    }

    /// `[from, to, generated, completed, removed_unreachable, removed_gridlock, incomplete,
    /// mean_s | NaN, p95_s | NaN]` over the cohort created at or after `from` (sim-core T2).
    pub fn window_metrics(&self, from: u32) -> Vec<f64> {
        let m = self.timeline.world().window_metrics(from as u64);
        vec![
            m.from_tick as f64,
            m.to_tick as f64,
            m.generated as f64,
            m.completed as f64,
            m.removed_unreachable as f64,
            m.removed_gridlock as f64,
            m.incomplete as f64,
            m.mean_travel_time_s.unwrap_or(f64::NAN),
            m.p95_travel_time_s.unwrap_or(f64::NAN),
        ]
    }

    pub fn tick(&self) -> f64 {
        self.timeline.world().tick() as f64
    }

    /// Close a link at the current tick; `false` for unknown ids.
    pub fn close_link(&mut self, id: u32) -> bool {
        self.command(id, CommandKind::CloseLink(LinkId(id)))
    }

    pub fn open_link(&mut self, id: u32) -> bool {
        self.command(id, CommandKind::OpenLink(LinkId(id)))
    }

    fn command(&mut self, id: u32, kind: CommandKind) -> bool {
        (id as usize) < self.export.link_from.len()
            && self
                .timeline
                .schedule(Command {
                    tick: self.timeline.world().tick(),
                    kind,
                })
                .is_ok()
    }

    /// Encode the vehicle records and the per-link stats (one pass each);
    /// returns the record count. `link_counts`/`link_queued` return the stats
    /// of the last encoded frame.
    pub fn encode_frame(&mut self) -> u32 {
        write_link_stats(
            self.timeline.world(),
            &mut self.link_counts,
            &mut self.link_queued,
        );
        let count = write_vehicle_records(self.timeline.world(), &mut self.frame);
        write_next_links(self.timeline.world(), &mut self.next_links);
        // Record → trip table of this frame (same order as the records), reusing the oldest table.
        let mut trips = if self.frame_trips.len() == RETAINED_FRAMES {
            self.frame_trips
                .pop_front()
                .map(|(_, v)| v)
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        trips.clear();
        self.timeline
            .world()
            .for_each_on_network_trip(|t| trips.push(t));
        let tick = self.timeline.world().tick();
        self.frame_trips.retain(|&(t, _)| t != tick);
        self.frame_trips.push_back((tick, trips));
        count
    }

    /// Trip id of record `record` of the retained frame encoded at `frame_tick`, or −1.
    pub fn trip_at_record(&self, frame_tick: f64, record: u32) -> f64 {
        self.frame_trips
            .iter()
            .find(|&&(t, _)| t as f64 == frame_tick)
            .and_then(|(_, trips)| trips.get(record as usize))
            .map_or(-1.0, |&t| t as f64)
    }

    /// Trip ids of the last encoded frame, in record order (the table `trip_at_record` reads; ward
    /// motion-002: the renderer matches cars across frames by trip, never by record index).
    pub fn trip_ids(&self) -> Vec<u32> {
        self.frame_trips
            .back()
            .map(|(_, trips)| trips.iter().map(|&t| t as u32).collect())
            .unwrap_or_default()
    }

    /// `VEHICLE_DETAIL` layout (protocol.ts): `[found, trip_id, origin, dest, state, link, lane, s, v,
    /// age_s, route_switches, blocked_ticks, route_len, …remaining route (current link first)]`.
    pub fn vehicle_detail(&self, trip_id: f64) -> Vec<f64> {
        let header = 13;
        let not_found = || vec![0.0; header];
        let Some(trip) = as_trip_id(trip_id) else {
            return not_found();
        };
        let Some(i) = self.timeline.world().vehicle_by_trip(trip) else {
            return not_found();
        };
        let (state, link, route): (f64, f64, &[LinkId]) = match i.state {
            VehicleState::WaitingAtOrigin => (0.0, -1.0, &[]),
            VehicleState::NoRoute => (4.0, -1.0, &[]),
            VehicleState::OnLink(l) => {
                let code = if i.stranded {
                    3.0
                } else if i.v < QUEUED_SPEED {
                    2.0
                } else {
                    1.0
                };
                (code, l.0 as f64, &i.route[i.route_pos..])
            }
        };
        let mut out = vec![
            1.0,
            i.trip_id as f64,
            i.origin.0 as f64,
            i.dest.0 as f64,
            state,
            link,
            i.lane as f64,
            i.s,
            i.v,
            (self.timeline.world().tick() - i.created_tick) as f64 * DT,
            i.route_switches as f64,
            i.blocked_ticks as f64,
            route.len() as f64,
        ];
        out.extend(route.iter().map(|l| l.0 as f64));
        out
    }

    /// `[code, travel_time_s]`: 0 live, 1 completed, 2 removed unreachable, 3 removed gridlock,
    /// 4 unknown; `travel_time_s` is NaN unless completed.
    pub fn trip_outcome(&self, trip_id: f64) -> Vec<f64> {
        let Some(trip) = as_trip_id(trip_id) else {
            return vec![4.0, f64::NAN];
        };
        match self.timeline.world().trip_outcome(trip) {
            TripOutcome::Live => vec![0.0, f64::NAN],
            TripOutcome::Completed { travel_time_s } => vec![1.0, travel_time_s],
            TripOutcome::RemovedUnreachable => vec![2.0, f64::NAN],
            TripOutcome::RemovedGridlock => vec![3.0, f64::NAN],
            TripOutcome::Unknown => vec![4.0, f64::NAN],
        }
    }

    /// `[vehicles, queued, cost_s, free_flow_s, exits, capacity_vph]`; empty for an unknown link.
    pub fn link_detail(&self, link: u32) -> Vec<f64> {
        if link as usize >= self.export.link_from.len() {
            return Vec::new();
        }
        let l = self.timeline.world().network().link(LinkId(link));
        let st = self.timeline.world().link_stats(LinkId(link));
        vec![
            st.vehicles as f64,
            st.queued as f64,
            st.cost_s,
            st.free_flow_s,
            st.exits as f64,
            l.lanes as f64 * l.sat_flow_per_lane * 3600.0,
        ]
    }

    pub fn link_sat_flow(&self) -> Vec<f32> {
        self.export.link_sat_flow.clone()
    }

    pub fn frame_ptr(&self) -> u32 {
        self.frame.as_ptr() as u32
    }

    pub fn frame_words(&self) -> u32 {
        self.frame.len() as u32
    }

    pub fn link_counts(&self) -> Vec<u16> {
        self.link_counts.clone()
    }

    /// Test hook (ward polish-005): a deliberate panic, so the host's trap path can be exercised.
    pub fn debug_trap(&self) {
        panic!("debug trap (test hook)");
    }

    /// Per record of the last encoded frame: the next link, or 65535 (none). A copy (2 bytes per vehicle).
    pub fn next_links(&self) -> Vec<u16> {
        self.next_links.clone()
    }

    pub fn link_queued(&self) -> Vec<u16> {
        self.link_queued.clone()
    }

    pub fn metrics(&self) -> Vec<f64> {
        metrics_to_extended_array(&self.timeline.world().metrics())
    }

    pub fn metric_names(&self) -> Vec<String> {
        EXTENDED_METRIC_NAMES
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    pub fn closed_links(&self) -> Vec<u32> {
        self.timeline
            .world()
            .closed_links()
            .into_iter()
            .map(|l| l.0)
            .collect()
    }

    /// The command log as `[tick, kind (0 = close, 1 = open), link]` triples, in log order (ward motion-003,
    /// read-only).
    pub fn command_log(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.timeline.world().command_log().len() * 3);
        for c in self.timeline.world().command_log() {
            let (kind, link) = match c.kind {
                CommandKind::CloseLink(l) => (0.0, l.0),
                CommandKind::OpenLink(l) => (1.0, l.0),
            };
            out.extend([c.tick as f64, kind, link as f64]);
        }
        out
    }

    /// `[baseTick, cumulative exits per link…]` at `tick` (`Timeline::exits_at`); baseTick NaN when no
    /// retained snapshot is that old (ward motion-003, read-only).
    pub fn exits_at(&self, tick: f64, links: &[u32]) -> Vec<f64> {
        let known = links
            .iter()
            .all(|&l| (l as usize) < self.export.link_from.len());
        let ids: Vec<LinkId> = links.iter().map(|&l| LinkId(l)).collect();
        // an unknown link or a tick that cannot be a sim tick: no reading
        let found = if known && tick.is_finite() && tick >= 0.0 {
            self.timeline.exits_at(tick as u64, &ids)
        } else {
            None
        };
        match found {
            Some((base, counts)) => std::iter::once(base as f64)
                .chain(counts.into_iter().map(|c| c as f64))
                .collect(),
            None => vec![f64::NAN; links.len() + 1],
        }
    }

    pub fn state_hash_hex(&self) -> String {
        format!("{:016x}", self.timeline.world().state_hash())
    }

    pub fn node_xy(&self) -> Vec<f32> {
        self.export.node_xy.clone()
    }

    pub fn node_is_zone(&self) -> Vec<u8> {
        self.export.node_is_zone.clone()
    }

    pub fn link_from(&self) -> Vec<u32> {
        self.export.link_from.clone()
    }

    pub fn link_to(&self) -> Vec<u32> {
        self.export.link_to.clone()
    }

    pub fn link_lanes(&self) -> Vec<u8> {
        self.export.link_lanes.clone()
    }

    pub fn link_length(&self) -> Vec<f32> {
        self.export.link_length.clone()
    }

    pub fn link_speed(&self) -> Vec<f32> {
        self.export.link_speed.clone()
    }

    /// `{"north_bridge":[we,ew],"central_bridge":[..],"south_bridge":[..]}` (init only).
    pub fn landmarks_json(&self) -> String {
        let pair = |b: [LinkId; 2]| format!("[{},{}]", b[0].0, b[1].0);
        let l = &self.landmarks;
        format!(
            r#"{{"north_bridge":{},"central_bridge":{},"south_bridge":{}}}"#,
            pair(l.north_bridge),
            pair(l.central_bridge),
            pair(l.south_bridge)
        )
    }

    /// `[{"name":..,"node":..,"kind":"residential"|"workplace"|"hospital"}]` (init only).
    pub fn zones_json(&self) -> String {
        let items: Vec<String> = self
            .zones
            .iter()
            .map(|z| {
                let kind = match z.kind {
                    ZoneKind::Residential => "residential",
                    ZoneKind::Workplace => "workplace",
                    ZoneKind::Hospital => "hospital",
                };
                format!(
                    r#"{{"name":{},"node":{},"kind":"{}"}}"#,
                    json_string(&z.name),
                    z.node.0,
                    kind
                )
            })
            .collect();
        format!("[{}]", items.join(","))
    }
}

/// Minimal JSON string escaping (names are plain text).
fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A JS number → trip id, if it is a non-negative integer.
fn as_trip_id(x: f64) -> Option<u64> {
    (x.is_finite() && x >= 0.0 && x.fract() == 0.0 && x < 9.0e15).then_some(x as u64)
}
