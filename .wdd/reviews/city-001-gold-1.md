# city-001 Gold review, round 1

**Verdict: REJECTED** (one MAJOR: the ward's own pass criterion "clippy clean (`cargo clippy --all-targets -- -D warnings`)" fails on the new example)

Reviewed: commit c3e32fc (diff against the Red snapshot 61c93d6). Reviewer: fresh Gold subagent. Only artifacts were used: the ward spec, contracts `.wdd/epics/city.md` § C1/C2 and `.wdd/epics/core.md`, the diff, and the commands below.

## Test freeze
- `git diff 61c93d6 -- crates/sim-core/tests web/tests web/e2e` is empty, so `city_001_relief.rs` is byte-identical to the Red snapshot.
- `git diff --stat 1e8497e HEAD -- crates/sim-core/tests web/tests web/e2e` (the commit before city-001 Red) shows only `city_001_relief.rs` added, so the 85 core tests are unchanged.

## Findings

### MAJOR

**M1. `cargo clippy --all-targets -- -D warnings` fails in crates/sim-core (the ward's Pass criteria and Verification).**
Evidence:
```
error: manually reimplementing `div_ceil`
  --> crates/sim-core/examples/gridlock.rs:59:25
59 |                 let s = (t + 1) / 2;
   = note: `-D clippy::manual-div-ceil` implied by `-D warnings`
error: could not compile `sim-core` (example "gridlock") due to 1 previous error
```
Fix: compute sim seconds from the world, e.g. `let s = w.tick() / 2;` (after `step()`, `w.tick() == t + 1`, so the value is the same and the time is read from the sim), or use `t.div_ceil(2)`, which equals `(t + 1) / 2`. Then rerun clippy until it is clean.

### MINOR

**m1. The gridlock example does not print what the ward's Outputs specify.** The ward requires "printing per 30 s: blocked fronts, gridlock reroutes, gridlock removals, completed". The example instead prints `max blocked` as a duration in seconds, not the **number** of blocked fronts. Fix: add a column with the count of vehicles with `blocked_ticks > 0`. Keeping the max-duration column alongside it is fine.

**m2. `check_invariants` does not guard the new counter split.** Conservation holds through `removed = removed_unreachable + removed_gridlock`, and `metrics()` computes `c.removed - self.removed_gridlock`. The code keeps `removed >= removed_gridlock` true today, because both counters are incremented together in `remove_gridlocked`, but nothing asserts it. Fix: add `if self.removed_gridlock > self.removed { return Err(..) }` (and optionally "every vehicle with `blocked_ticks > 0` is an OnLink, non-stranded lane front") to `check_invariants`.

**m3. `EXTENDED_METRIC_NAMES` repeats the 16 core names as a literal** instead of deriving them from `METRIC_NAMES`, so there is a drift risk. Test 13 currently pins the prefix, so this is a nit. Optionally add a `const` assertion or a unit test that the prefix equals `METRIC_NAMES`.

## Code review against C1/C2 and the ward's explicit Gold items

| Item | Result |
|---|---|
| C1 `Link.sat_flow_per_lane`, default `SAT_FLOW_PER_LANE` | OK (network.rs) |
| `set_sat_flow` last call wins, never panics | OK (`retain` + `push`). `LinkId(u32::MAX)` only compared via `index()`, no indexing |
| Validation order: after the link's existing checks (InvalidLanes first), per link in id order; UnknownLink(lowest) after all links | OK |
| Range `(0, 2.0]`, finite | OK (`!(is_finite && > 0 && <= MAX)` also rejects NaN) |
| Credit increment `sat_flow_per_lane * DT`, capped | OK. 0.5 × 0.5 = 0.25 exactly |
| `free_flow_cost` and `queue_term` use `lanes × sat_flow_per_lane` | OK (routing.rs:10, world.rs:648). No remaining uses of `SAT_FLOW_PER_LANE` / `LANE_CREDIT_PER_TICK` in sim logic |
| Blocked check uses the crossing's own `entry_s` expression | OK: `(reach - length).min(next.length_m)`, same as before, and reused for the crossing (world.rs:1048, 1067) |
| Blocked check after the forced-decision block; next link open | OK. A closed next always goes through the forced decision first |
| Credit ignored for "blocked"; credit-limited with space resets to 0 | OK (1050–1078) |
| Resets: no reach, stranded, forced decision without route, transfer | OK (1018, 1029, 1041, 1087). Completion frees the slot. A newly placed vehicle starts at 0 (place_on_link does not touch it, and the crossing reset precedes it) |
| One increment per evaluation; removal at `== 1200` before any reroute | OK. `==` is safe because the increment is exactly 1 with resets |
| Relief 1 at positive multiples of 120, below 1200 | OK (the removal branch returns first) |
| Gridlock search: same `Tree::build` as the router, closures + excluded link, current `cost_keys`, **no RouterCache read/write** | OK: `gridlock_path(&self, …)` takes `&self` and builds a fresh `Tree`, so it cannot touch `self.router` |
| Gridlock reroute spends no budget | OK: neither `budgeted_total`/`used` nor `forced_total` is touched. The switch is counted via `assign_route` |
| After reroute: new next with space and credit crosses; no space keeps the count; space without credit keeps the count unchanged | OK (1064–1074) |
| Removal: pops the lane front, frees the slot, `removed += 1`, `removed_gridlock += 1`; no `record_exit`, no exit time, not completed; returns `Crossing::None`, so `rr_next` is untouched | OK (1104–1111, 1057–1059) |
| `state_hash` covers `blocked_ticks`, `removed_gridlock`, `gridlock_reroutes` | OK (world.rs:504, 527, 581) |
| `Metrics.removed_gridlock`, `unserved = unreachable + removed_gridlock`, `removed_unreachable = removed - removed_gridlock` (no underflow possible) | OK |
| `check_invariants` consistent with the new conservation | OK (`Counts.removed` includes gridlock), see m2 |
| sim-wasm exposes `EXTENDED_METRIC_NAMES` / `metrics_to_extended_array` | OK (lib.rs). The web reads metrics by name (App.tsx:100) |
| `METRIC_NAMES` / `metrics_to_array` unchanged | OK |
| Determinism: no HashMap/HashSet, wall clock or transcendental functions | OK (grep plus clippy.toml rules; the lib target is clippy-clean) |
| `World: Clone` | OK. The new fields are plain data |
| Documented simplification in core.md | OK |

Edge cases probed with throwaway programs (scratch dir, not committed):
- **From == dest decision point** (a custom route through its destination): `Tree::route` returns `None` for distance 0, so `gridlock_path` cannot return an empty path. The `route[route_pos + 1]` index after the reroute is safe.
- **Queue entries of a removed vehicle**: priority/periodic entries are validated by `trip_id`, so slot reuse after a gridlock removal is safe.
- **Oversaturation stress**: three_bridges with central **and** north bridges closed at 10 min and north reopened at 75 min, run for 3 h. Every tick: `check_invariants`, `unserved == unreachable + removed_gridlock`, `Counts.removed == removed_unreachable + removed_gridlock`, conservation, "non-front, stranded and not-on-link vehicles have `blocked_ticks == 0`", and no count ≥ 1200. All held. 8 gridlock reroutes, 0 removals. A clone taken at tick 4562 (fronts blocked ≥ 51) had a `state_hash` equal to the original every tick to the end of the run.
- **Bit-identity for normal scenarios**: a per-tick FNV over every on-network vehicle's (link, lane, s bits, v bits, stranded) plus counts. three_bridges was run at seeds (2026,7) and (1,2) for 2 h, with central closed at 10 min and reopened at 50 min, on both 61c93d6 (git-archive export) and HEAD. The output is **identical**.
- Example ring A (pure deadlock) and ring B (detour), with `check_invariants` every tick: both held. In ring B, the last vehicle needing 2.5 min is the rerouted one, which drives the ~1 km detour. That is expected.

## Manual Smoke Test (executed)
1. `cargo test -p sim-core` (debug): core 20+24+36+5 = 85 + city_001 28 = **113 pass**.
2. `cargo run -p sim-core --release --example gridlock`: ring A shows blocked fronts, no reroute possible, the first removal at 10:30–11:00 sim (count 1200 = 10 min after blocking at ~1:00), then the ring drains (159 completed + 1 removed). Ring B shows 1 gridlock reroute at ~1:00–2:00 and all 160 complete. **Pass.**
3. Run twice + `diff`: **identical.**
4. Bridge example HEAD vs 61c93d6 (`git archive` into the scratch dir, separate target dir): `diff` **identical** (42 lines).
5. Pass criterion "clippy clean (`--all-targets`)": **FAIL**, see M1.

## Commands run
| Command | Result |
|---|---|
| `git diff 61c93d6 -- crates/sim-core/tests web/tests web/e2e` | empty |
| `cargo test --workspace --release` | 28 + 20 + 24 + 36 + 5 pass, 0 fail |
| `cargo test -p sim-core` | 113 pass |
| `cargo clippy --all-targets -- -D warnings` (crates/sim-core) | **FAIL**: `manual_div_ceil` in examples/gridlock.rs:59 |
| `cargo clippy --all-targets -- -D warnings` (crates/sim-wasm) | clean |
| `cargo clippy --target wasm32-unknown-unknown -- -D warnings` (crates/sim-wasm) | clean |
| `pnpm -C web build:wasm` | ok |
| `pnpm -C web test` | 10 files, 45 tests pass |
| `pnpm -C web build` | ok |
| `pnpm -C web e2e` | 17 pass |
| gridlock example ×2 + diff | identical |
| bridge example HEAD vs 61c93d6 | identical |
| scratch probes (stress, clone, bit-identity) | all pass |

## To get APPROVED
Fix M1 (and preferably m1 and m2), make sure `cargo clippy --all-targets -- -D warnings` is clean in both crates, and resubmit to a new Gold reviewer. No test expectations need to change.
