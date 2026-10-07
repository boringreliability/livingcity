# city-001 Gold review, round 2

**Verdict: APPROVED** (no BLOCKER, no MAJOR; two nits)

Reviewed: HEAD a0fd78c (round-1 fix commit, diff vs c3e32fc) and the whole implementation diff vs the Red snapshot 61c93d6. Reviewer: fresh Gold subagent. Only artifacts were used: ward spec, `.wdd/epics/city.md` § C1/C2, `.wdd/epics/core.md`, the round-1 review, the diff, and the commands below.

## Test freeze
`git diff 61c93d6 -- crates/sim-core/tests web/tests web/e2e` is empty (0 lines). Test expectations are unchanged since Red approval.

## Round-1 findings: status
| Finding | Status | Evidence |
|---|---|---|
| M1 clippy `manual_div_ceil` in examples/gridlock.rs | **Fixed** | now `let s = w.tick() / 2;` (time read from the sim). `cargo clippy --all-targets -- -D warnings` in crates/sim-core is clean after `touch src/lib.rs examples/gridlock.rs` (forced recheck, exit 0) |
| m1 example lacks a blocked-front count | **Fixed** | new column `blocked fronts` = count of vehicles with `blocked_ticks > 0`. `max blocked` is kept alongside |
| m2 `check_invariants` lacks the counter guard | **Fixed** | `removed_gridlock > removed` → Err. Also new: "only lane fronts can have `blocked_ticks > 0`" |
| m3 `EXTENDED_METRIC_NAMES` literal duplicates `METRIC_NAMES` | Not addressed (nit, see n1) | test 13 pins the prefix |

## Are the new invariants sound? (could they reject a valid state?)
- `removed_gridlock <= removed`: both counters are only incremented together in `remove_gridlocked`. `removed_unreachable` is incremented alone. Always true.
- "only lane fronts are blocked": `blocked_ticks` is only incremented in `discharge_lane` for the lane front. A vehicle only leaves the front by crossing (reset to 0 before `place_on_link`), completion, or gridlock removal (slot freed). `place_on_link` only `push_back`s, so nothing can be inserted ahead of a blocked front. A new front was never a front before, so it has 0. A gridlock reroute only changes the route, not the lane position. Stranding by a budgeted priority reroute in step 3 leaves the count until the same tick's step-4 evaluation, which resets it (stranded branch). `check_invariants` runs only between steps, so it never sees that intermediate state.
- Empirical probe (scratch crate, path dependency on this worktree, release with debug-assertions and overflow-checks): `check_invariants` plus extra checks every tick (`unserved == unreachable + removed_gridlock`, `Counts.removed == removed_unreachable + removed_gridlock`, `unreachable == no_route + stranded + removed_unreachable`, conservation, every `blocked_ticks > 0` vehicle is OnLink, not stranded, not on its final link, and `< 1200`):
  - ring A/B from the example (6,000 ticks): A gives 1 removal, all others complete. B gives 1 gridlock reroute, all 160 complete.
  - three_bridges, seeds 2026/1/99, 3 h, {central+north}, {central+south}, {all three} bridges closed 10:00–75:00: up to 9 gridlock reroutes per run (with route assignment), max count 122 (reroute without space keeps counting). A clone taken at tick 4000 matched the original's `state_hash` every tick to 3 h.
  - three_bridges, 6 seeds, 60 random link closures/reopens each over 3 h (stranding, forced decisions, retries, removals): all held.
  - **No invariant violation in any run.**

## Independent code review vs C1/C2 and the ward's Gold items
| Item | Result |
|---|---|
| C1 `Link.sat_flow_per_lane`, default `SAT_FLOW_PER_LANE`; `set_sat_flow` last call wins (`retain` + `push`), never panics (ids compared via `index()` only) | OK |
| Validation `(0, 2.0]`, finite (NaN rejected by the negated conjunction); per link after `InvalidLanes` in id order; `UnknownLink(min id)` after all links validate | OK |
| Credit increment `sat_flow_per_lane * DT` (0.5 × 0.5 = 0.25 exactly); `free_flow_cost` and the EMA `queue_term` use `lanes × sat_flow_per_lane` | OK. No sim-logic uses of `SAT_FLOW_PER_LANE` / `LANE_CREDIT_PER_TICK` remain |
| Blocked check after the forced-decision block, with the crossing's own `entry_s = (reach - length).min(next.length_m)`, reused for the crossing | OK |
| Credit ignored for "blocked"; credit-limited with space resets to 0; after a reroute with space but no credit the count is unchanged | OK |
| Resets: no reach, stranded, forced decision without route (`enter_without_route` then reset), crossing | OK |
| Removal at `== GRIDLOCK_REMOVE_TICKS` before any reroute attempt; reroute at positive multiples of 120 below 1200 | OK (increments are exactly 1 with resets, so `==` is safe) |
| Gridlock search: `gridlock_path(&self, …)` builds a fresh `Tree` with closures + excluded link and the current `cost_keys`; zone through-routing is excluded inside `Tree::build` as for the normal router; no `RouterCache` access possible (`&self`) | OK |
| No budget spent (`budgeted_total`, `forced_total` untouched); the switch is counted via `assign_route` | OK |
| `remove_gridlocked`: pops the front, frees the slot, `removed` and `removed_gridlock` +1, no `record_exit`, returns `Crossing::None`, so `rr_next` is untouched. Stale queue entries are filtered by `trip_id` | OK |
| `state_hash` covers `blocked_ticks`, `removed_gridlock`, `gridlock_reroutes` | OK |
| Metrics: `removed_unreachable = removed - removed_gridlock` (no underflow, now also asserted), `unserved` | OK |
| `METRIC_NAMES` / `metrics_to_array` unchanged; sim-wasm exposes the extended list/array | OK |
| `World: Clone`, no HashMap/HashSet/wall clock/transcendentals | OK |
| Documented simplification in core.md | OK |

## Findings

### BLOCKER
None.

### MAJOR
None.

### MINOR
None.

### NIT
**n1. `EXTENDED_METRIC_NAMES` still repeats the 16 core names as a literal** (round-1 m3). There is a drift risk if `METRIC_NAMES` ever changes, but test 13 pins the prefix today. Optionally add a unit/const check that `EXTENDED_METRIC_NAMES[..METRIC_NAMES.len()] == METRIC_NAMES`.

**n2. `.wdd/epics/core.md` (Tick order, line ~122) still says `credit = min(1.0, credit + 0.25)`**, and `params::LANE_CREDIT_PER_TICK` is now unused by sim logic. Both are correct for default links, but a reader of core.md alone would miss C1. Optionally add "(`sat_flow_per_lane * DT`, see city C1)" to the core.md sentence, and either drop the constant or doc-comment it as the default value.

## Manual Smoke Test (executed)
1. `cargo test -p sim-core` (debug): 20 + 24 + 36 + 5 = 85 core + 28 city_001 = **113 pass**.
2. `cargo run -p sim-core --release --example gridlock`: ring A has 8 blocked fronts, then 4 (pure deadlock from ~2:30, 40 active), `max blocked` climbs to 575.5 s, the first removal comes between 10:30 and 11:00, then the ring drains (159 completed + 1 removed by 12:30). Ring B: 1 gridlock reroute between 1:30 and 2:00, all 160 complete by 6:00 (the last one drives the ~1 km detour). **Pass**: reroute, removal and recovery are all visible.
3. Ran it twice + `diff`: **identical** (43 lines).
4. Bridge example: HEAD vs a `git archive 61c93d6` export built in the scratch dir (its own target dir): `diff` is **identical** (42 lines).
5. Clippy clean in both crates: **pass**.

## Commands run
| Command | Result |
|---|---|
| `git diff 61c93d6 -- crates/sim-core/tests web/tests web/e2e` | empty |
| `cargo test --workspace --release` | 28 + 20 + 24 + 36 + 5 pass, 0 fail |
| `cargo test -p sim-core` (debug) | 113 pass |
| `cargo clippy --all-targets -- -D warnings` (crates/sim-core, forced recheck) | clean |
| `cargo clippy --all-targets -- -D warnings` (crates/sim-wasm) | clean |
| `cargo clippy --target wasm32-unknown-unknown -- -D warnings` (crates/sim-wasm) | clean |
| `pnpm -C web build:wasm` | ok |
| `pnpm -C web test` | 10 files, 45 tests pass |
| `pnpm -C web build` | ok |
| `pnpm -C web e2e` (port 5190) | 17 pass |
| gridlock example ×2 + diff | identical |
| bridge example HEAD vs 61c93d6 | identical |
| scratch invariant/stress/clone probe | all pass |
