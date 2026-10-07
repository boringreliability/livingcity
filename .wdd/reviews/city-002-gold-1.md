# city-002 Gold review, round 1

**Verdict: APPROVED**

Reviewer: fresh Gold-gate subagent (adversarial). Artifacts: ward-002 spec, epic city C1–C3, the calibration decision, the diff `3efa19a..HEAD` (3a2abd8), and the test files.

## Test freeze
`git diff 3efa19a -- crates/sim-core/tests web/tests web/e2e` shows only one **new** file, `web/e2e/gold_city002.spec.ts` (+18). No approved test changed.

## Commands run and results
| Command | Result |
|---|---|
| `cargo test --workspace --release` | all green. city_002_river **12/12 in 3.00 s**; city_001 28, core_001 20, core_002 24, core_003 36, core_004 5 |
| `cargo test -p sim-core` (debug) | green; city_002_river 4 pass + 8 ignored (calibration, `cfg_attr(debug_assertions, ignore)`) |
| `cargo clippy -p sim-core -p sim-wasm --all-targets -- -D warnings` | exit 0 |
| `cargo test -p sim-core --release --test city_002_river` (timed) | 12 pass, wall 2.95 s (budget < 120 s) |
| `./target/release/examples/river` (80 sim min) | wall 0.26 s (budget < 10 s); two runs byte-identical (`cmp`) |
| `pnpm -C web build:wasm` / `typecheck` / `test` / `build` | ok / ok / 11 files 47 tests pass / built |
| `pnpm -C web e2e` (port 5190) | **20/20 pass** (59 s), incl. core city.spec, review1–3, gold5, river.spec 15–16, gold_city002 |
| three_bridges bit-identity: `git archive 3efa19a` → scratch build; examples `bridge`, `smoke`, `gridlock`, `bottleneck` old vs new | all 4 outputs byte-identical (separate binaries, different md5) |
| Mutation check of the S1 regression: scratch copy of HEAD `web/` with `c.setSpeed(speedRef.current)` → `c.setSpeed(DEFAULT_SPEED)` | `gold_city002.spec.ts` **fails 3/3** (rate 40 ticks/s, expected > 90). Unmutated it passes. The test is meaningful |

## Manual smoke test
**River example (seeds 2026, 7).**
- **Baseline, min 10–20:** active 1,640–1,800; Main 31–55 exits/min against North 0–5 and Old 2–10. The Main Bridge has the most exits. The west→east trip is ≈ 440 s.
- **Closure at 20:00:** Main goes to 0 exits from minute 22. North saturates at 30/min (1,800 veh/h) and Old at 15/min (900 veh/h, its sat flow). Queued climbs from ≈ 70 to 150–380. The fullest approach links are link 8 (west Old Bridge approach, 100 % at min 31–36), link 140 (North approach column, 99–100 % at min 40–42) and link 68 (west North Bridge approach row, 98–100 % at min 43–57). The trip time rises from 442 s to 810 s. Active climbs to ≈ 2,180.
- **Reopen at 50:00:** the Main Bridge resumes at min 52–55 and reaches its 60/min cap (3,600 veh/h) while the backlog drains. Active falls back to 1,700–1,850, queued to 46–120 and the trip time to ≈ 470 s by min 70–80.

The numbers tell the story.

**Calibration at 8 seed pairs** (scratch crate that copies the frozen test helpers and runs every C3 check per seed). **All 8 PASS:**

| seeds | base active | Main share | queued ×closure | WE trip ratio | gridlock | backlog | active after reopen | Main share after | queued after/closure |
|---|---|---|---|---|---|---|---|---|---|
| 2026,7 | 1716 | 0.79 | 3.47 | 1.64 | 0/21805 | 1.21 | 1.06 | 0.81 | 0.40 |
| 11,3 | 1689 | 0.79 | 5.10 | 1.81 | 0/21846 | 1.25 | 0.99 | 0.73 | 0.17 |
| 42,1 | 1676 | 0.79 | 3.83 | 1.73 | 0/21450 | 1.19 | 1.02 | 0.80 | 0.28 |
| 1,1 | **1602** | 0.79 | 4.45 | 1.64 | 0/21455 | 1.22 | 1.08 | 0.79 | 0.63 |
| 99,5 | 1627 | 0.82 | 4.44 | 1.65 | 0/21478 | 1.21 | 1.04 | 0.79 | 0.34 |
| 123,456 | 1693 | 0.78 | 6.01 | 1.84 | 0/21692 | 1.29 | 1.01 | 0.71 | 0.24 |
| 7,2026 | 1675 | 0.80 | 4.83 | 1.69 | 0/21904 | 1.27 | 1.03 | 0.79 | 0.39 |
| 5,8 | 1662 | 0.81 | 4.82 | 1.75 | 0/21739 | 1.21 | 1.00 | 0.77 | 0.25 |

At every seed: baseline unserved 0, removed_gridlock 0 and no link ≥ 95 % full at all. Spillback ticks under closure are 902–2,364 against 0 in the baseline. No vehicle entered the closed bridge.

**Browser** (Playwright MCP, headless, vite on 5191; screenshots `.playwright-mcp/g002-gold1-{baseline,closed,three-bridges}.png`):
- River City loads with `hook.city == 'river_city'`, the water corridor between the banks, and 22 labelled zones. At 4 sim min vehicles are on all three bridges (Main 11/2, North 3/0, Old 2/0).
- "Close the main bridge" closes landmark links 284/285 (`closed == [284, 285]`), and yellow/black hatching appears on the bridge. About 15 sim min later at 20× (≈ 20.0× achieved), the North and Old Bridges hold 23 and 53 vehicles, queue markings show on the Old Bridge approach, and queued is 166 against 34 before.
- `?city=three_bridges` loads the core city (66 links, own landmarks).
- The only console error is the favicon 404.

## Gold checks
- **No environment input.** There is no `std::env`, `env!`, `option_env!`, `SystemTime`/`Instant` or file IO in `crates/sim-core/src`. ✔
- **Calibration hard-coded and documented.** `INTRA_BANK_SCALE = 2.3` and `CROSS_RIVER_SCALE = 0.9` carry a rationale and point to the decision file. ✔
- **Construction order documented** (nodes → streets → bridges → zones/connectors → flows) in the `river_city` doc comment. The arterial rows and columns in the comment match the code. ✔
- **No visual data in Rust** beyond the corridor. Zone names are core-contract sim data. ✔
- **No scripting.** The only change in `sim-core/src` is `cities.rs`, which is pure data: constant demand (`Profile::default()`) and a static per-link `set_sat_flow` on the Old Bridge, which C3 requires. No model code changed, there is no time-varying capacity, and nothing special-cases landmarks. ✔
- **three_bridges unchanged:** byte-identical example outputs, and the core tests pass. ✔

## Integration
- The worker passes `city` through: the `three_bridges` string selects `Sim.three_bridges` and anything else `Sim.river_city`. The host defaults to `DEFAULT_CITY`.
- The host falls back to `'unknown'` / `[0, 0]` for a sim without `city_name`/`river` (vitest 14 covers it), and `riverDecor` draws no water for `[0, 0]`.
- `hook.city = readyRef.current?.city` comes from ready, not from the URL.
- `threeBridgesDecor` and `RIVER_HALF_WIDTH_M` are gone with no references left.
- The new exports are all used: `riverDecor`, `parseCityName`, `DEFAULT_CITY`, `CityName`, `Sim.river_city/city_name/river`.
- **S1:** `speedRef` holds the latest user choice and `ready` sends it. The regression test fails when the fix is reverted (see above).

## Findings
No BLOCKER and no MAJOR findings.

**MINOR**
1. **Baseline sits low in the band, and the docs overstate it.** At 8 seeds the baseline mean active is 1,602–1,716, and seed (1,1) is 2 vehicles above the 1,600 floor. The decision file says "Baseline active 1,700–1,900" (prototype), and the `river_city` doc and the brief say "≈ 2,000". C3 only names two seed pairs, both of which have margin (1,716 and 1,689), so this is not a contract failure. It does mean a small model change could tip the baseline test at other seeds.
   *Fix:* record the shipped measurements in `river-city-calibration.md` and in CONTEXT, replacing the prototype numbers. Optionally note that the plateau's lower edge is close.
2. **`RIVER_WEST_X` / `RIVER_EAST_X` are `pub`** but only used inside `cities.rs`. Consumers read `City.river`. This is harmless.
   *Fix (optional):* make them private, or document them as the canonical corridor.
3. **Cosmetic, for city-004.** At fit zoom the control panel overlaps the top-left zone label ("Westbrook Heights" is clipped). The Old and North Bridges look like ordinary streets. city-004 owns the visual design, so this is noted for it rather than for this ward.
4. **`cargo fmt --check` reports diffs**, including in pre-existing examples. The project has no rustfmt gate, so this is noted only.
