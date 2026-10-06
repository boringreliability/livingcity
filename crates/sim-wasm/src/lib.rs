//! wasm-bindgen adapter: batched steps, commands, and compact buffers.
//! All simulation logic lives in `sim-core`; nothing here knows the clock.

use wasm_bindgen::prelude::*;

use sim_core::World;

#[wasm_bindgen]
pub struct Sim {
    world: World,
    frame: Vec<u32>,
}

#[wasm_bindgen]
impl Sim {
    /// The core-epic test city.
    pub fn three_bridges(_demand_seed: u32, _behavior_seed: u32) -> Sim {
        todo!()
    }

    pub fn step(&mut self, _n: u32) {
        todo!()
    }

    pub fn tick(&self) -> f64 {
        todo!()
    }

    /// Close a link at the current tick; `false` for unknown ids.
    pub fn close_link(&mut self, _id: u32) -> bool {
        todo!()
    }

    pub fn open_link(&mut self, _id: u32) -> bool {
        todo!()
    }

    /// Encode the vehicle records; returns the record count.
    pub fn encode_frame(&mut self) -> u32 {
        let _ = (&self.world, &self.frame);
        todo!()
    }

    pub fn frame_ptr(&self) -> u32 {
        todo!()
    }

    pub fn frame_words(&self) -> u32 {
        todo!()
    }

    pub fn link_counts(&self) -> Vec<u16> {
        todo!()
    }

    pub fn link_queued(&self) -> Vec<u16> {
        todo!()
    }

    pub fn metrics(&self) -> Vec<f64> {
        todo!()
    }

    pub fn metric_names(&self) -> Vec<String> {
        todo!()
    }

    pub fn closed_links(&self) -> Vec<u32> {
        todo!()
    }

    pub fn state_hash_hex(&self) -> String {
        todo!()
    }

    pub fn node_xy(&self) -> Vec<f32> {
        todo!()
    }

    pub fn node_is_zone(&self) -> Vec<u8> {
        todo!()
    }

    pub fn link_from(&self) -> Vec<u32> {
        todo!()
    }

    pub fn link_to(&self) -> Vec<u32> {
        todo!()
    }

    pub fn link_lanes(&self) -> Vec<u8> {
        todo!()
    }

    pub fn link_length(&self) -> Vec<f32> {
        todo!()
    }

    pub fn link_speed(&self) -> Vec<f32> {
        todo!()
    }

    /// `{"north_bridge":[we,ew],"central_bridge":[..],"south_bridge":[..]}` (init only).
    pub fn landmarks_json(&self) -> String {
        todo!()
    }

    /// `[{"name":..,"node":..,"kind":"residential"|"workplace"|"hospital"}]` (init only).
    pub fn zones_json(&self) -> String {
        todo!()
    }
}
