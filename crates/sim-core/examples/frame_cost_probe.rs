//! Per-tick and per-frame costs on River City (ward polish-005).
//! `cargo run -p sim-core --release --example frame_cost_probe [-- baseline]`
//!
//! `baseline` writes `web/perf-results/frame-cost-baseline.json` (run on the code before the
//! optimizations); the default run writes `web/perf-results/frame-cost.json` with the baseline as
//! "before" (step; metrics before = `metrics_full_scan()`) and the current code as "after".
// A measurement tool, not simulation logic: the wall clock only times calls from outside.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::fs;
use std::process::Command as Proc;
use std::time::Instant;

use sim_core::cities::river_city_scaled;
use sim_core::{Timeline, World};

const WARM_TICKS: u64 = 7200;
const MEASURE_TICKS: u64 = 2000;
const MIB: usize = 1024 * 1024;

fn mean(v: &[f64]) -> f64 {
    v.iter().sum::<f64>() / v.len() as f64
}

fn load() -> String {
    Proc::new("sysctl").args(["-n", "vm.loadavg"]).output().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
}

struct Scale {
    step_ms: f64,
    metrics_ms: f64,
    full_scan_ms: Option<f64>,
    active: u64,
    on_network: u64,
}

fn measure(scale: f64, full_scan: bool) -> Scale {
    let c = river_city_scaled(2026, 7, scale).unwrap();
    let mut w = World::from_scenario(c.scenario).unwrap();
    for _ in 0..WARM_TICKS {
        w.step();
    }
    let (mut step, mut met, mut full) = (Vec::new(), Vec::new(), Vec::new());
    for _ in 0..MEASURE_TICKS {
        let t = Instant::now();
        w.step();
        step.push(t.elapsed().as_secs_f64() * 1e3);
        let t = Instant::now();
        let m = w.metrics();
        met.push(t.elapsed().as_secs_f64() * 1e3);
        std::hint::black_box(m);
        if full_scan {
            full.push(full_scan_ms(&w));
        }
    }
    let m = w.metrics();
    Scale { step_ms: mean(&step), metrics_ms: mean(&met), full_scan_ms: full_scan.then(|| mean(&full)), active: m.active, on_network: m.on_network }
}


fn full_scan_ms(w: &World) -> f64 {
    let t = Instant::now();
    std::hint::black_box(w.metrics_full_scan());
    t.elapsed().as_secs_f64() * 1e3
}

/// Median of 5 branches at 48 MiB, 1000 ticks below the head of a 3 sim h River City timeline.
fn branch_ms() -> f64 {
    let c = river_city_scaled(2026, 7, 1.0).unwrap();
    let mut tl = Timeline::new(World::from_scenario(c.scenario).unwrap(), 48 * MIB);
    tl.step_n(3 * 7200);
    let at = tl.position_tick() - 1000;
    let mut v: Vec<f64> = (0..5)
        .map(|_| {
            let t = Instant::now();
            std::hint::black_box(tl.branch(at, 48 * MIB).unwrap());
            t.elapsed().as_secs_f64() * 1e3
        })
        .collect();
    v.sort_by(f64::total_cmp);
    v[2]
}

fn json(s: &Scale) -> String {
    format!(
        "{{\"stepMs\": {:.4}, \"metricsMs\": {:.4}, \"active\": {}, \"onNetwork\": {}}}",
        s.step_ms, s.metrics_ms, s.active, s.on_network
    )
}

fn main() {
    let baseline = std::env::args().any(|a| a == "baseline");
    let out = concat!(env!("CARGO_MANIFEST_DIR"), "/../../web/perf-results/");
    let load_before = load();
    let scales = [("x1", 1.0), ("x3", 3.0), ("x5", 5.0)];
    if baseline {
        let rows: Vec<String> = scales.iter().map(|(k, s)| format!("    \"{k}\": {}", json(&measure(*s, false)))).collect();
        let b = branch_ms();
        let text = format!(
            "{{\n  \"note\": \"code before polish-005 (sim-core as at commit 4e5d5c1); native release; River City seed 2026/7, after 1 sim h, mean of {MEASURE_TICKS} ticks\",\n  \"loadAvg\": \"{load_before} / {}\",\n{},\n  \"branchMs\": {b:.3}\n}}\n",
            load(),
            rows.join(",\n")
        );
        fs::write(format!("{out}frame-cost-baseline.json"), &text).unwrap();
        print!("{text}");
        return;
    }
    let base = fs::read_to_string(format!("{out}frame-cost-baseline.json")).expect("run with `baseline` on the old code first");
    let pick = |key: &str, field: &str| -> f64 {
        let i = base.find(&format!("\"{key}\"")).unwrap();
        let j = base[i..].find(&format!("\"{field}\": ")).unwrap() + i + field.len() + 4;
        base[j..].split([',', '}']).next().unwrap().trim().parse().unwrap()
    };
    let mut before = Vec::new();
    let mut after = Vec::new();
    let mut baseline_rows = Vec::new();
    for (k, s) in scales {
        let m = measure(s, true);
        before.push(format!("    \"{k}\": {{\"stepMs\": {:.4}, \"metricsMs\": {:.4}}}", pick(k, "stepMs"), m.full_scan_ms.unwrap()));
        after.push(format!("    \"{k}\": {}", json(&m)));
        baseline_rows.push(format!("    \"{k}\": {{\"stepMs\": {:.4}, \"metricsMs\": {:.4}}}", pick(k, "stepMs"), pick(k, "metricsMs")));
    }
    let b_after = branch_ms();
    let b_before: f64 = base.split("\"branchMs\": ").nth(1).unwrap().split(['\n', '}']).next().unwrap().trim().parse().unwrap();
    let text = format!(
        "{{\n  \"note\": \"native release; River City seed 2026/7, after 1 sim h, mean of {MEASURE_TICKS} ticks. before.metricsMs = metrics_full_scan() now; before.stepMs = baseline (code at 4e5d5c1)\",\n  \"loadAvg\": \"{load_before} / {}\",\n  \"baseline\": {{\n{}\n  }},\n  \"before\": {{\n{}\n  }},\n  \"after\": {{\n{}\n  }},\n  \"branchMs\": {{\"before\": {b_before:.3}, \"after\": {b_after:.3}}}\n}}\n",
        load(),
        baseline_rows.join(",\n"),
        before.join(",\n"),
        after.join(",\n")
    );
    fs::write(format!("{out}frame-cost.json"), &text).unwrap();
    print!("{text}");
}
