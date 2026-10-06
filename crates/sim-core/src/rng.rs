//! Deterministic random primitives. No transcendental functions, so results
//! are bit-identical natively and in WASM. See the contract (Demand).

const GOLDEN_GAMMA: u64 = 0x9E37_79B9_7F4A_7C15;

/// The standard SplitMix64 finalizer applied to `x + γ`.
pub fn splitmix64(x: u64) -> u64 {
    let mut z = x.wrapping_add(GOLDEN_GAMMA);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Counter-based key for (seed, tick, flow): `splitmix64(splitmix64(splitmix64(a) ^ b) ^ c)`.
pub fn mix3(a: u64, b: u64, c: u64) -> u64 {
    splitmix64(splitmix64(splitmix64(a) ^ b) ^ c)
}

/// Uniform in [0, 1) from the top 53 bits.
pub fn unit_f64(x: u64) -> f64 {
    (x >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
}

/// Stateful generator for behavioral randomness only (never demand).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BehaviorRng {
    state: u64,
}

impl BehaviorRng {
    pub fn new(seed: u64) -> Self {
        BehaviorRng { state: seed }
    }

    /// Returns `splitmix64(state)`, then advances the state by γ, which is
    /// the canonical SplitMix64 stream.
    pub fn next_u64(&mut self) -> u64 {
        let out = splitmix64(self.state);
        self.state = self.state.wrapping_add(GOLDEN_GAMMA);
        out
    }

    pub fn next_f64(&mut self) -> f64 {
        unit_f64(self.next_u64())
    }

    /// Raw state (for state hashing and snapshots).
    pub fn state(&self) -> u64 {
        self.state
    }
}
