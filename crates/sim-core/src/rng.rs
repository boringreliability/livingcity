//! Deterministic random primitives. No transcendental functions, so results
//! are bit-identical natively and in WASM. See the contract (Demand).

pub fn splitmix64(_x: u64) -> u64 {
    todo!()
}

pub fn mix3(_a: u64, _b: u64, _c: u64) -> u64 {
    todo!()
}

/// Uniform in [0, 1) from the top 53 bits.
pub fn unit_f64(_x: u64) -> f64 {
    todo!()
}

/// Stateful generator for behavioral randomness only (never demand).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BehaviorRng {
    state: u64,
}

impl BehaviorRng {
    pub fn new(_seed: u64) -> Self {
        todo!()
    }

    pub fn next_u64(&mut self) -> u64 {
        todo!()
    }

    pub fn next_f64(&mut self) -> f64 {
        let _ = self.state;
        todo!()
    }
}
