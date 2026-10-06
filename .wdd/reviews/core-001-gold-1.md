# Review: core-001 — Gold gate (round 1)

## Reviewer
Adversarial implementation reviewer (Claude subagent, independent of the implementer), 2026-10-06.
Toolchain: rustc 1.93.0, cargo 1.93.0, Apple M4 Pro.
Inputs read: `livingcity.md`, `.wdd/epics/core.md` (model contract), `.wdd/wards/core/ward-001.md`,
`.wdd/reviews/core-001-red-8.md`, `crates/sim-core/src/{lib,params,network,world}.rs` (line by line),
`crates/sim-core/tests/core_001_physics.rs`, `crates/sim-core/examples/bottleneck.rs`, `git diff ca8ad82 HEAD`.
Tests approved at `ca8ad82`; implementation reviewed at `bce61b8` (HEAD).
All probes ran on copies in `/tmp/gold1` and `/tmp/gold1bench` (outside the repo). No repo source or test file was modified.
(Unrelated: `git status` shows `.wdd/wards/core/ward-002.md` modified in the worktree; this reviewer did not touch it.)

## Verdict
APPROVED

## Test tampering check
`git diff ca8ad82 HEAD -- crates/sim-core/tests` → **empty** (no output).
`git diff ca8ad82 HEAD --stat` touches only: `ward-001.md` (status `approved` → `gold`), `Cargo.toml` (clippy lint table),
`crates/sim-core/Cargo.toml` (`[lints] workspace = true`), `examples/bottleneck.rs` (new), `src/network.rs`, `src/world.rs`.
No test expectation changed.

## Commands run + results
| Command | Result |
|---|---|
| `cargo test -p sim-core` | **20 passed**, 0 failed (0.30 s, test profile opt-level 2) |
| `cargo clippy -p sim-core --all-targets -- -D warnings` | clean |
| `cargo clippy -p sim-core -- -D warnings` (ward pass criterion) | clean |
| `cargo clippy -p sim-core --lib -- -D warnings -W clippy::manual_is_multiple_of` | clean (src never needs the allow) |
| copy with the workspace allow removed: `cargo clippy --all-targets --keep-going -- -D warnings` | 1 error, **only** `examples/bottleneck.rs:29` (`w.tick() % 60 == 0`); tests and src do not trigger it |
| `cargo run -p sim-core --example bottleneck` | runs, invariants hold at the end (table below) |
| instrumented copy of the tests (`eprintln!` only) | every exact value from red-8 "Notes for Gold reviewer" reproduced (below) |

Exact values vs. the Red-8 reference (all identical):
T4 travel 205 · T7 150 (buffer 954) / 300 (buffer 619) · T8 203 / 1362 / 1494, frac 1.0 · T9 734 blocked ticks ·
T10 1015 spawned, 1015 completed · T12 150/150 · T13 first L2 exit at loop tick 122 · T16 325 completed, max L1 40 ·
T20 zone 224 / through 226 (total 450), jz exits 1, trip 2 at tick 67. T3/T11/T14/T15/T17/T18/T19 are asserted exactly by the tests and pass.

### Workspace clippy allow (`manual_is_multiple_of = "allow"`)
Acceptable but unnecessary (finding 2). It is a pure style lint, so it hides no correctness issue, but it is workspace-wide
(covers future `src` code of all crates) and exists only to keep one line of the implementer's own example compiling under
`--all-targets`. The approved tests do not need it.

## Smoke test result
**PASS.** `bottleneck` output (every 30 s):
- L2 (bottleneck, cap 20): 4 → 12 → 17 → 19 by 120 s and stays at 19/20 at every sample.
- L1 (upstream, cap 120): flat at 16 until L2 is full, then +5 per 30 s, reaches 119–120/120 at 720–750 s.
- Origin buffer: 0 until 750 s, then grows +5 per 30 s (4, 10, 14, … 180 at 1800 s).
- L2 out/min: 24 (start-up), then **exactly 30** every interval = 0.5 veh/s saturation flow.

Order bottleneck → upstream → origin holds. A per-tick tracker of the same scenario (`/tmp/gold1bench/src/smoke.rs`)
confirms L2 first hits 20/20 at tick 215, L1 first hits 120/120 at tick 1434, origin first non-empty at tick 1440.
After tick 600 L2 holds 19 on 2249 ticks and 20 on 750 ticks (one tick in four, the 4-tick discharge headway); the printed
table samples every 60 ticks, which is phase-locked to the "19" tick, so the table never literally shows 20/20 (finding 5).

## Contract deviations
None found. Checked line by line:

| Contract item | Implementation | Status |
|---|---|---|
| Step order 4 → 5 → 6 → tick += 1 | `world.rs:196-201` | OK |
| Nodes ascending, zones included; in-lanes = in-links ascending × lane | `world.rs:267`; `network.rs:160-167` | OK |
| RR: scan starts at `rr_next`, wraps once; order fixed at scan start; `rr_next = (i+1) mod n` after a **transfer**, applied after the scan (last transfer in scan order wins = sequential application) | `world.rs:273-284` | OK |
| Completion does not advance `rr_next` | only `Crossing::Transferred` sets `new_rr` (`:278`) | OK |
| Credit `min(1.0, credit + 0.25)` at the start of each lane's evaluation, every tick, including empty lanes and moved fronts; initial 0 | `:289-290` before the `front()` check; `World::new` `:111` | OK |
| Only the front is considered; moved front not eligible | `:292-298` | OK |
| `v' = min(v + ACCEL*DT, vmax*speed_factor)`; crossing iff `s + v'*DT >= length` (exact form, negated as `reach < length`) | `:300-305`, `vmax` `:211-213` | OK |
| Route finished → complete, no credit, `completed_tick` = tick before increment | `:307-312`, `complete` `:333-342` | OK |
| Transfer iff credit ≥ 1 and feasible lane at `entry_s = min(reach − length, length_next)`; `v = min(v', vmax_next × speed_factor)`; credit −= 1; marked moved | `:314-330`, `place_on_link` `:253-263` | OK |
| `tail_guaranteed`: moved tail → `tail.s`; else `min(tail.s + v'_tail*DT, limit_now)`, limit = length (tail is front) or leader's **current** `s − 7.5` | `:216-230` | OK |
| Lane choice: `count < lane_cap` and (empty or `tg >= entry_s + JAM_SPACING`), furthest tail, empty = +∞, ties → lowest index (strict `>`) | `:234-251` | OK |
| Admission: origins ascending; FIFO; per-origin budget 2; skipped/blocked vehicles don't consume budget; blocked first link blocks only later vehicles for that link; enter at s = 0, v = 0, marked moved; same lane-choice function with `entry_s = 0` | `:346-374` | OK |
| Movement: links/lanes ascending, front→back, skip moved; `s' = max(s, min(s + v'*DT, limit))`; `v = (s' − s)/DT`; limit uses leader's post-move `s` | `:377-403` | OK |
| Spawn validation rule-major: Empty → UnknownLink → NonContiguous → OriginHasThroughTraffic → RouteThroughZone, first offending index; `is_zone(o) || in_links(o).is_empty()`; `route[i].from` for i ≥ 1 | `:174-193` | OK |
| Rejected spawns consume no trip id; trip id from a dedicated counter (not slot) | validation before any mutation `:143`, `next_trip_id` `:146,158` | OK |
| Slot table with LIFO free list | `:160-169`, `:341` | OK |
| Network validation + never-panicking builder; lane_cap = max(1, floor(len/7.5)); sorted adjacency | `network.rs:117-174` | OK (see finding 1 for absurd lengths) |
| `World`, `Network`: `Clone + Debug`, no `Rc` | derives `world.rs:82`, `network.rs:177` | OK |

## Must NOT check
- `HashMap`/`HashSet`: none in `src` (grep). State is `Vec`/`VecDeque`. ✔
- `std::time`: none in `src`. ✔
- `unsafe`: none. ✔
- RNG: none; `speed_factor = 1.0` (`world.rs:153`). ✔
- Screen/drawing concepts: none; coordinates are meters. No dependencies at all in `sim-core`. ✔
- Thresholds not weakened: test diff empty. ✔

## Findings

No BLOCKER. No MAJOR.

### 1. MINOR — `Network::capacity` overflows `u32` for absurdly long multi-lane links
- **Where:** `network.rs:232` (`lanes as u32 * lane_capacity`), with `network.rs:170` (`f64 as u32` saturating cast).
- **Evidence:** `/tmp/gold1bench/src/probes.rs` P1: `link_with_length(a, c, 1e10, 10.0, 8)` → debug build **panics** "attempt to multiply with overflow" at `network.rs:232`; release returns `(1333333333, 2076732072)` (wrapped; true value 10 666 666 664). Threshold ≈ 4.0e9 m for 8 lanes. `build()` accepts any finite length ≥ 10 m.
- **Consequence:** unreachable with real road data; violates "builder never panics / errors surface in build()" only in spirit (the panic is in a later accessor).
- **Fix:** add a `MAX_LINK_LENGTH` (e.g. 100 km) to `params` and reject in `build()`, or compute capacity in `u64`/`saturating_mul`.

### 2. MINOR — workspace-wide clippy allow to keep one example line
- **Where:** `Cargo.toml` `[workspace.lints.clippy] manual_is_multiple_of = "allow"`; only trigger is `examples/bottleneck.rs:29`.
- **Evidence:** with the allow removed in a copy, `cargo clippy -p sim-core --all-targets --keep-going -- -D warnings` reports exactly one error, at the example. Tests and `src` are clean.
- **Fix:** write `w.tick().is_multiple_of(60)` (stable since 1.87) and drop the workspace lint table (and the crate's `[lints] workspace = true` if nothing else uses it), or scope `#![allow(clippy::manual_is_multiple_of)]` to the example.

### 3. MINOR — origin admission walks the whole buffer every tick when the head is blocked
- **Where:** `world.rs:354-372`. Once the head's first link is blocked, the loop visits every remaining buffered vehicle (each `blocked.contains`), because it only stops at the budget or buffer end.
- **Evidence:** P2 (release): single blocked origin with 1 000 / 10 000 / 100 000 buffered → 0.001 / 0.026 / 0.127 ms per tick (linear). Debug: 4.7 ms/tick at 100 000.
- **Consequence:** negligible at expected buffer sizes; becomes measurable only with very long buffers (e.g. a closed connector under sustained demand in core-003). `VecDeque::remove(i)` is O(min(i, len−i)) but runs ≤ 2× per origin per tick.
- **Fix:** break once `blocked.len() == network.out_links(origin).len()` (all possible first links blocked).

### 4. MINOR — public accessors panic on unknown ids
- **Where:** `link_vehicles`, `link_count`, `link_exit_count`, `origin_buffer_len` (`world.rs:419-441`), `Network::node/link/out_links/in_links/lane_capacity/capacity`.
- **Consequence:** fine for native tests; at the WASM boundary (core-004) an out-of-range id from JS would abort the worker. `spawn_with_route` already returns `UnknownLink`.
- **Fix (core-004):** validate ids at the boundary, or add `Option`-returning accessors.

### 5. MINOR — bottleneck example never prints 20/20
- **Where:** `examples/bottleneck.rs:29-41`. Sampling every 60 ticks is phase-locked to the 4-tick discharge cycle; L2 is 20/20 on one tick in four but always 19/20 at the sample.
- **Consequence:** a human smoke tester reading "reaching its capacity" may be confused; 19/20 = 95 % is the tests' definition of "full", and the physics is correct (smoke.rs tracker above).
- **Fix:** print the window maximum of `link_count(l2)` (and L1), or note "≥ 95 %" in the header.

### 6. MINOR — `check_invariants` coverage gaps
- **Where:** `world.rs:448-500`.
- Not checked: credit ∈ [0, 1] and finite; `rr_next < n_in_lanes`; that every live slot is referenced by exactly one queue/buffer (the `live == active` count check can be balanced by a duplicate + orphan pair); `route_pos < route.len()`.
- **Fix:** add a per-slot reference counter pass and the two range checks. Cheap, and it will matter once core-003 adds removal and rerouting.

### 7. MINOR — notes with no current consequence
- `Option::is_none_or` (`world.rs:246`) needs Rust ≥ 1.82; no `rust-version` is declared. Declare one in the workspace before the WASM toolchain is pinned.
- `spawn_with_route` sets `link_enter_tick = tick` for a vehicle that is not on a link yet (`world.rs:155`); it is overwritten on admission, so harmless, but core-002's traversal-time metric must not read it before admission.

## Bug hunt (beyond the tests)
All on copies, release and debug (debug = overflow checks on):
- **Randomized fuzz** (`/tmp/gold1bench/src/fuzz.rs`): 60 random grids (3–7 × 3–7, lengths 10–200 m, speeds 2–40 m/s, 1–4 lanes, zone connectors 10–60 m with 1–3 lanes), random X-first/Y-first routes, random demand, 3 000 ticks each = 180 000 ticks, 194 361 completions. Every tick: `check_invariants()` + an independent ≥ 7.5 m lane-spacing check. At tick 1500 a `Clone` is taken and stepped in lock-step with identical spawns; per-tick bit-exact comparison of all `(id, lane, s, v)`. **No violation, no divergence, no panic** in either debug or release, and debug/release produce the same completion count.
- **NaN paths:** none reachable. Lengths/speeds are validated finite in `build()`; `v'`, `reach`, `entry_s`, `s'` are sums/mins of finite values; `v` is bounded by link length / DT. Huge speed (1e6 m/s) on a 10 m middle link (P3): `entry_s` clamp exercised, 200 vehicles complete, invariants hold every tick.
- **Front-at-stop-line and newly moved:** a transferred vehicle placed at `entry_s = length_next` (clamp) is skipped by step 4 at its downstream node in the same tick (`moved_tick` check before the crossing decision) and by step 6; it crosses on the next tick. Moved vehicles only ever sit at the back of a queue (insertions are `push_back`), so a non-moved tail never has a moved leader, which keeps `tail_guaranteed` a valid lower bound.
- **`expect("live vehicle slot")`:** only reachable through internal inconsistency; not triggered in 180 000 fuzz ticks.
- **`as` casts:** only finding 1 is reachable (u32 multiply). Id casts (`usize → u32`) would need > 4·10⁹ nodes/links/slots; `lane as u8` is ≤ 8.
- **Hot paths:** `counts()`, `link_count()` and `link_vehicles()` are O(lanes)/allocate but are not called from `step()`; `step()` is O(total lanes + vehicles) plus finding 3.
- **Determinism:** no hash iteration, no wall clock, single-threaded fixed order; the clone twin and debug-vs-release runs are bit-identical.

## Performance
Throwaway benchmark `/tmp/gold1bench/src/grid.rs` (release, `debug = 1`): n × n grid of junctions 150 m apart, two-way 2-lane links at 13.9 m/s, one zone per junction with 1-lane connectors, random Manhattan routes zone → zone; demand topped up every tick to keep `active` at the target. 200 warm-up ticks, then 1 000 measured ticks (`step()` only).

| Grid | Links | Target active | Mean ms/tick | Worst ms/tick |
|---|---|---|---|---|
| 30 × 30 | 5 280 | 10 000 | **0.174** | 0.299 |
| 50 × 50 | 14 800 | 10 000 | 0.345 | 0.627 |
| 50 × 50 | 14 800 | 30 000 | 0.568 | 0.998 |
| 12 × 12 (congested, 671 waiting) | 816 | 10 000 | 0.076 | 0.193 |

At 10 000 vehicles a tick costs well under 1 ms natively (≈ 3 000× faster than real time at DT = 0.5 s). Even with a 2–3× WASM penalty this leaves ample headroom for interactive play and fast-forward. Nothing in core-001 blocks the brief's 10k-vehicle target. Watch in later wards: per-frame export must not use `link_vehicles` (allocation per link), and `World::clone` for snapshots copies `Network` and the unbounded `completed_log` each time.

## Notes for future wards
- **core-002:** routing will replace `route[0]` assumptions; admission reads `route[0]` (`world.rs:356`), which must become `route[route_pos]` once waiting vehicles can be rerouted. Do not read `link_enter_tick` before admission.
- **core-003:** add `NoRoute` skipping and the `open` check to `choose_lane` callers; apply the finding-3 early exit before closures make long blocked buffers common; extend `check_invariants` per finding 6 before adding removal.
- **core-004:** validate ids at the boundary (finding 4); export frames without per-link `Vec` allocation.
- **timeline:** consider sharing the immutable `Network` (e.g. `Arc`, which the contract's "no `Rc`" does not forbid, but confirm) and bounding/segmenting `completed_log` so snapshots stay cheap.
- Drop the workspace-wide clippy allow (finding 2) before more crates join the workspace.
