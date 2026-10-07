//! wasm-bindgen adapter: batched steps, commands, and compact buffers.
//! All simulation logic lives in `sim-core`; nothing here knows the clock.

use wasm_bindgen::prelude::*;

use sim_core::cities::{river_city, three_bridges, City, Landmarks, Zone, ZoneKind};
use sim_core::frame::{
    metrics_to_extended_array, write_link_stats, write_vehicle_records, NetworkExport, EXTENDED_METRIC_NAMES,
};
use sim_core::{Command, CommandKind, LinkId, World};

#[wasm_bindgen]
pub struct Sim {
    world: World,
    frame: Vec<u32>,
    export: NetworkExport,
    link_counts: Vec<u16>,
    link_queued: Vec<u16>,
    landmarks: Landmarks,
    zones: Vec<Zone>,
    city_name: &'static str,
    river: (f64, f64),
}

impl Sim {
    fn from_city(city: City) -> Sim {
        let export = NetworkExport::new(&city.scenario.network);
        let world = World::from_scenario(city.scenario).expect("built-in cities are valid");
        Sim {
            world,
            frame: Vec::new(),
            export,
            link_counts: Vec::new(),
            link_queued: Vec::new(),
            landmarks: city.landmarks,
            zones: city.zones,
            city_name: city.name,
            river: city.river,
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

    pub fn city_name(&self) -> String {
        self.city_name.to_string()
    }

    /// The river corridor `[west_x, east_x]` in metres (simulation data).
    pub fn river(&self) -> Vec<f64> {
        vec![self.river.0, self.river.1]
    }

    pub fn step(&mut self, n: u32) {
        for _ in 0..n {
            self.world.step();
        }
    }

    pub fn tick(&self) -> f64 {
        self.world.tick() as f64
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
            && self.world.schedule(Command { tick: self.world.tick(), kind }).is_ok()
    }

    /// Encode the vehicle records and the per-link stats (one pass each);
    /// returns the record count. `link_counts`/`link_queued` return the stats
    /// of the last encoded frame.
    pub fn encode_frame(&mut self) -> u32 {
        write_link_stats(&self.world, &mut self.link_counts, &mut self.link_queued);
        write_vehicle_records(&self.world, &mut self.frame)
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

    pub fn link_queued(&self) -> Vec<u16> {
        self.link_queued.clone()
    }

    pub fn metrics(&self) -> Vec<f64> {
        metrics_to_extended_array(&self.world.metrics())
    }

    pub fn metric_names(&self) -> Vec<String> {
        EXTENDED_METRIC_NAMES.iter().map(|s| s.to_string()).collect()
    }

    pub fn closed_links(&self) -> Vec<u32> {
        self.world.closed_links().into_iter().map(|l| l.0).collect()
    }

    pub fn state_hash_hex(&self) -> String {
        format!("{:016x}", self.world.state_hash())
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
                format!(r#"{{"name":{},"node":{},"kind":"{}"}}"#, json_string(&z.name), z.node.0, kind)
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
