---
ward: 2
revision: null
name: "River City network and calibrated demand"
epic: "city"
status: "red"
dependencies: ["city-001"]
layer: "rust"
estimated_tests: 16
created: "2026-10-07"
completed: null
---
# Ward city-002: River City network and calibrated demand

## Scope
The final, hand-designed demo city (`.wdd/epics/city.md` § C3), as simulation data: nodes in metres, links, zones and a constant OD demand. It is calibrated so the baseline is a living ≈ 2,000-vehicle city without gridlock, and closing the Main Bridge produces visible spillback and emergent rerouting over the North and Old Bridges. The calibration is checked by tests that measure outcomes. Nothing is scripted. The app switches to River City in this ward. It keeps the generic river decor until city-004 draws the real look.

## Inputs
- city-001: `set_sat_flow`, gridlock relief, `Metrics.{removed_gridlock, unserved}`.
- core: `NetworkBuilder` (`node`, `zone`, `two_way`, `link`), `DemandModel`, `City`, `Landmarks`, `Zone`, `ZoneKind`, `frame::NetworkExport`, `sim-wasm::Sim`, `web/src/App.tsx`, `decor.ts`.

## Outputs
- `sim_core::cities::river_city(demand_seed, behavior_seed) -> City`. `City` gains `name: &'static str` (`"river_city"` / `"three_bridges"`) and `river: (f64, f64)` (the corridor's west and east x).
- Example `river`: river_city, 20 min baseline, then the Main Bridge closed for 30 min, then reopened for 30 min. Per minute it prints `active`, `queued`, `unserved`, `removed_gridlock`, exits per bridge, the mean west→east trip time of the last 5 min, and the fullest approach links.
- `sim-wasm`: `Sim::river_city(demand_seed, behavior_seed)`, `Sim::river() -> Vec<f64>` (`[west_x, east_x]`), `Sim::city_name() -> String`.
- **Protocol and host:**
  - `ToWorker` `init` gains an optional `city?: CityName` (`'river_city' | 'three_bridges'`), default `river_city`.
  - `HostDeps.createSim(demandSeed, behaviorSeed, city)` gets a third argument.
  - `SimLike` gains the **optional** `city_name?()` and `river?()`, so existing fakes keep working.
  - `ReadyMessage` gains `city: string` and `river: [number, number]`, read from the sim, with `'unknown'` / `[0, 0]` when absent.
  - The worker passes the city through.
- **App and hook:**
  - The app reads `?city=` (unknown → `river_city`) and sends it in `init`.
  - `LivingCitySnapshot` gains `city: string | null`.
- `decor.ts`: `riverDecor(network, bounds, river)` draws the corridor as water (generic) and replaces `threeBridgesDecor` in the app. The core e2e tests that need three_bridges ids keep working: they read landmarks, never hard-coded ids. If a core e2e test depends on three_bridges geometry, the app accepts `?city=three_bridges` and that test's harness keeps the default. **Approved test files are not edited.** If one needs editing, escalate.

## Specification
- **Layout guidance** (the implementer chooses exact coordinates and documents them in `cities.rs`):
  - The city is ~5–7 km wide and ~4–5 km tall. The river corridor is ~150 m wide near x = 0.
  - Each bank has a street grid with 2-lane arterials and 1-lane local streets. Junction spacing is 300–700 m.
  - Main Bridge in the middle, North Bridge ~1.5–2 km north, Old Bridge ~1.5–2 km south.
  - Residential districts mostly west. Workplaces (e.g. Harbor Works, Tech Park, Downtown) and St. Mary's Hospital east.
  - Some workplace or retail on the west too, so traffic runs in both directions.
  - Zones attach to junctions via connectors, as in the core contract.
- **Construction order** is fixed and documented in `cities.rs`: nodes, then links, then flows. Landmark and zone ids are then stable, and no test hard-codes ids. Tests use `landmarks`, `zones` and geometry.
- **Calibration targets**: exactly § C3. If a target proves unreachable without scripting, **escalate** with measurements. Do not relax a target unilaterally.
- **Performance budget**: the river example in release mode runs 80 sim minutes in < 10 s wall time on the dev machine (measured, reported).
- **Test runtime**: the calibration tests run many sim hours. `cargo test -p sim-core --release --test city_002_river` must finish in < 120 s. Debug mode may be slower and is not required for these tests. Mark them `#[cfg_attr(debug_assertions, ignore)]` so `cargo test` in debug skips them, and say so in the run commands.

## Tests

Rust tests 1–12 are in `crates/sim-core/tests/city_002_river.rs`. Vitest tests 13–14 are in `web/tests/river.test.ts`, and Playwright tests 15–16 are in `web/e2e/river.spec.ts`. "Baseline" means seeds (2026, 7) without interventions. "Closure" means both Main Bridge links closed at 20 min. Windows are measured in sim minutes.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `river_city_is_valid` | the scenario validates. `name == "river_city"`. Exactly three link pairs cross the corridor (from x < west_x to x > east_x or back), and they are the three landmarks. Every zone reaches every zone (in both directions) through the router |
| 2 | `river_city_districts` | ≥ 4 residential zones on the west, ≥ 3 workplaces with ≥ 2 east, exactly 1 hospital east, all names unique |
| 3 | `crossing_attributes` | Main: 2 lanes each way. North: 1 lane each way. Old: 1 lane each way, `sat_flow_per_lane ≤ 0.25`, speed ≤ 30 km/h |
| 4 | `baseline_is_a_living_city` | mean `active` over min 30–60 in [1600, 2600]. `unserved == 0` and `removed_gridlock == 0` through 60 min. No link ≥ 95 % full for 10 consecutive minutes |
| 5 | `main_bridge_carries_most_crossings` | baseline min 30–60: Main Bridge exits > 50 % of west→east bridge exits |
| 6 | `closure_queues_double` | closure: mean `queued` over 10–40 min after it ≥ 2 × baseline mean over the same window |
| 7 | `closure_spills_back` | closure: at some tick in 10–40 min after it, on an approach to the North or Old Bridge, ≥ 2 consecutive upstream links (each feeding the next) are each ≥ 80 % full |
| 8 | `closure_slows_cross_river_trips` | mean travel time of west→east trips completed 10–40 min after the closure ≥ 1.25 × the baseline same window |
| 9 | `closure_reroutes_to_alternatives` | North + Old Bridge west→east exits in the window exceed baseline. `removed_gridlock ≤ 1 %` of trips generated by the end of the window |
| 10 | `reopen_recovers` | reopened 30 min after the closure: mean `queued` over minutes 25–30 after the reopen ≤ 1.5 × baseline over the same minutes |
| 11 | `calibration_holds_for_another_seed` | tests 4 and 6 hold for seeds (11, 3) too |
| 12 | `river_city_is_deterministic` | two builds with the same seeds and the closure command have equal `state_hash` at every minute for 60 min. A different `demand_seed` gives different `generated_trips` |
| 13 | `river city runs through wasm with the extended metrics` (vitest) | `Sim.river_city` names itself, exposes its corridor, uses the extended metric list (ending `removed_gridlock`, `unserved`), its Main Bridge crosses the corridor, and after 20 min it has > 500 active vehicles with frame count = on_network |
| 14 | `the host reports the city and its river in ready` (vitest) | init without a city creates River City (`createSim` receives `'river_city'`). `ready.city`, `ready.river` and `metricNames` include `unserved`, with ≥ 8 zones. Frames carry the extended metrics. An explicit `city: 'three_bridges'` is honoured |
| 15 | `the app opens on River City and closes its Main Bridge` (e2e) | the hook shows `city == 'river_city'`, there is traffic, and the metrics include `unserved`. The button closes both River City Main Bridge links (confirmed by a frame), and both are on screen |
| 16 | `?city=three_bridges opens the core test city` (e2e) | `?city=three_bridges` opens the core city, and an unknown name falls back to River City |

## Must NOT
- Script outcomes: no time-varying capacities, no demand that reacts to closures, no special cases for landmarks in the model.
- Put visual data (meanders, buildings, label styling) in Rust. `river` is only the corridor the simulation needs for "crossing" semantics.
- Edit approved earlier tests.

## Must DO
- `three_bridges` is unchanged, so core tests keep passing bit-identically.
- The app shows River City by default. Vehicles move, and "Close the main bridge" closes the River City Main Bridge (`landmarks.central_bridge`).

## Manual Smoke Test
### Setup
```
cargo build -p sim-core --release --examples
pnpm -C web build:wasm && pnpm -C web dev
```
### Steps
1. Run: `cargo test -p sim-core --release --test city_002_river`
   Expected: 12 pass in < 120 s.
2. Run: `cargo run -p sim-core --release --example river`
   Verify:
   - Baseline: active ≈ 2,000, and the Main Bridge has the most exits.
   - After the closure: queued climbs, the fullest approach links are on the Old/North Bridge approaches, and the trip time rises.
   - After the reopen: it recovers.
3. Open the app.
   Verify: River City with water in the corridor. Vehicles cross three bridges. Close the main bridge: hatching appears, and queues build on the alternatives within a few sim minutes at 20×.
### Pass criteria
- [ ] All Rust tests green (debug, plus the release calibration test), clippy clean
- [ ] Measured calibration numbers reported in the review (baseline active, queued ratio, trip-time ratio, gridlock removals)
- [ ] App shows River City, and the full e2e suite stays green

## Verification
The Gold reviewer reproduces the calibration numbers with the example, at two seeds, and runs the full test suites.
