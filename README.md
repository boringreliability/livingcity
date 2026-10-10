# Living City

An interactive traffic simulation of a small river town. You can close a bridge and watch the traffic adapt. You can rewind to before the closure, try another decision, and compare the two outcomes side by side at the same sim time.

- **Simulation core:** Rust, compiled to WebAssembly, running in a Web Worker.
- **Interface:** a TypeScript/React UI on top of a WebGL2 renderer.
- **Product brief:** [`livingcity.md`](livingcity.md).

## Prerequisites

| Tool | Tested with | Notes |
|------|-------------|-------|
| Rust (`rustc`, `cargo`) | 1.93 | plus the wasm target: `rustup target add wasm32-unknown-unknown` |
| wasm-pack | 0.13 | builds `crates/sim-wasm` into `web/src/wasm/` (generated, not committed) |
| Node | 24 | |
| pnpm | 11 | |

## Setup and run

Run all commands from the repository root.

```bash
pnpm -C web install                      # web dependencies
pnpm -C web build:wasm                   # build the wasm simulation (again after any Rust change)
pnpm -C web dev                          # dev server; open the printed URL (http://localhost:5173)
```

The app opens on River City after a 15-minute (sim time) warm-up, so traffic is already flowing. It is laid out for desktop windows at least 768 px wide; narrower windows are not supported in v1. The production build is `pnpm -C web build`, which typechecks and writes `web/dist/`.

### URL parameters
- `?city=three_bridges`: the small core test city instead of River City.
- `?demand=<0.25–6>`: a stress demand scale, for measurement only. A badge shows it.

### Keys
| Key | Action |
|-----|--------|
| Space | play / pause |
| B | close or reopen the main bridge (in the past of the original, this creates the branch) |
| D | diagnostics panel (perf counters) |
| + / − | faster / slower (1×, 5×, 20×, 60×) |
| Esc | clear the selection |
| ← / → / Home / End | on the focused timeline: one sim minute back / forward, window start / live |

A **demo guide** in the app (top right) walks through the demo on a first visit and ticks off each step as you do it; hide it with ×, and the **?** (Guide) button shows it again. [`docs/demo.md`](docs/demo.md) walks through the same demo in five minutes.

## Tests

```bash
cargo test --workspace                                       # Rust (calibration tests are skipped in debug builds)
cargo test -p sim-core --release --test city_002_river       # one Rust test file, in release
cargo test -p sim-core --test timeline_002_branch            # the branch / identical-demand tests
cargo clippy --workspace --all-targets -- -D warnings
pnpm -C web test                                             # Vitest (Node, real wasm)
pnpm -C web exec playwright install chromium                 # once, for the browser tests
pnpm -C web e2e                                              # Playwright, all browser tests except @perf (about 13 min)
pnpm -C web e2e:perf                                         # the performance harness, which writes web/perf-results/*.json
cargo run -p sim-core --release --example timeline_probe     # native snapshot / seek / branch costs
```

- The web tests use the built wasm, so run `pnpm -C web build:wasm` first.
- The acceptance flow from the brief is `web/e2e/acceptance.spec.ts`: close the bridge, see the consequences, rewind, branch and compare.

## Documentation
- [`docs/architecture.md`](docs/architecture.md): layers, data flow, determinism, the timeline, the sim/render boundary, and deviations from the brief.
- [`docs/traffic-model.md`](docs/traffic-model.md): the deliberately simplified traffic model and what the metrics mean.
- [`docs/demo.md`](docs/demo.md): the demo walkthrough.
- [`docs/performance.md`](docs/performance.md): measured performance (sim tick and render reported separately), including the timeline costs.
- [`docs/known-issues.md`](docs/known-issues.md): known limitations and deviations, with every backlog item's status.
