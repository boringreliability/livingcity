# Review city-001 RED 4

**Reviewer:** adversarial test reviewer (fresh subagent, round 4), 2026-10-07
**Verdict:** REJECTED (1 MAJOR, 0 BLOCKER)

Scope: `.wdd/wards/city/ward-001.md`, `.wdd/epics/city.md` § C1/C2, `.wdd/epics/core.md` (in force), `crates/sim-core/tests/city_001_relief.rs` at commit 31d74ed (26 tests, sha256 `38b1ed60…f749`), and `.wdd/reviews/city-001-red-{1,2,3}.md`.

## What I ran

- I copied the reference `tmp/proto3` to `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/proto4`. Its `tests/*.rs` are byte-identical to the worktree's: `cmp` passed for all 5 files.
- I diffed the reference `src` against the worktree `src` (`proto4/ref4.diff`) and checked it against C1/C2 myself:
  - Per-link validation runs after the existing checks, then `UnknownLink` with the lowest id. Last call wins.
  - The credit increment is `sat * DT`. `free_flow` and `queue_term` use `lanes × sat`.
  - The blocked check comes after reach, completion, stranded and forced decision, and uses the crossing's `entry_s`.
  - The order is count → removal at 1200 → relief at multiples of 120. The relief is a fresh `Tree::build` on `cost_keys` with closures plus the excluded link, and it is not cached. It does not use hysteresis or budget.
  - With space but credit < 1, the count is unchanged. "Credit-limited with space" resets it.
  - Removal is not an exit, does not touch `rr_next`, and frees the slot.
  - The `Metrics` split and the hash coverage are correct.

  The reference conforms.
- `cargo test -p sim-core --no-fail-fast` on the reference: core 20 + 24 + 36 + 5 = **85 pass**, city_001 **26/26 pass**.
- `cargo clippy -p sim-core --all-targets -- -D warnings`: **clean**, so r3 M2 is fixed.
- Mutants (`MUT=…`, runner `tmp/r4_all.sh`) against the 26 tests:

| Mutant | Killed by |
|---|---|
| A (credit before blocked check) | 17, 23 |
| B / B2 (search reads / writes RouterCache) | 12, 18, 19 / 18 |
| C (reroute at 1200) | 19 |
| E (removal records exit time) | 21 |
| F (search ignores closures) | 19, 25 |
| G2 (credit-limited with space does not reset) | 23 |
| G3 / G3b (no reset when stranded) | 20 |
| COST (search uses free-flow keys) | 22 |
| FD (forced decision into full link resets) | 25 |
| U (relief with space + low credit resets) | 23 |
| PR (budgeted reroute resets count) | 24 |
| NR (approaching front counted) | 26 |
| ONCE (new, r4: relief only at exactly 120) | 11 |
| STOP (new, r4: blocked only once `s ≥ length`, not `reach ≥ length`) | 17, 25, 26 |
| **UNR** (new, r4: `unreachable` keeps the core line `no_route + stranded + removed`, `unserved = unreachable + removed_gridlock`) | **survives, see M1** |
| G1 | equivalent (as in r2/r3) |
| G3a, ENTRY, RR | survive. These are handed to Gold code review in the ward (G3a: see m1) |
| REMCR (removal deferred while credit < 1) | survives. Not plausible on its own: deferring the relief as well is killed by 23 |

## Earlier findings: status

| Finding | Status |
|---|---|
| r1 B1, B2, M1–M4 | Still fixed. The mutants above are killed. |
| r2 M1, M2, m1, m4, m5 | Still fixed. |
| r2 m2/m3, r3 m3 | **Fixed.** The ward's Tests section names the Gold code-review items: `entry_s` reuse, removal does not touch `rr_next`, and `state_hash` coverage. |
| r3 M1 (NR) | **Fixed.** Test 26 kills NR, and the r4 STOP variant as well. |
| r3 M2 (clippy) | **Fixed.** Line 396 is now `Some(0) =>`, and clippy is clean for all targets. |
| r3 m1 (U, G2) | **Fixed.** Test 23. |
| r3 m2 (PR, FD) | **Fixed.** Tests 24 and 25. |
| r3 m4 (G3a) | Not addressed. It is still MINOR (m1 below). |
| r3 m5 (`step_checked` in 20–22) | **Fixed.** |

## Findings

### MAJOR

**M1: the core `unreachable` definition is unpinned once gridlock removals exist. Mutant UNR passes all 111 tests. Classification (a): a test gap, verified fixable.**

- **What the contract requires.**
  - Core (`core.md` l.100/112): `unreachable = no_route + stranded + removed_unreachable`.
  - C2: `unserved = unreachable + removed_gridlock`, and `Counts.removed = removed_unreachable + removed_gridlock`.
- **The broken implementation.** The most natural shortcut is to leave the core line `unreachable: c.no_route + c.stranded + c.removed` untouched, now that `c.removed` includes gridlock removals, and to add `unserved = unreachable + removed_gridlock`.
- **Why it passes.**
  - `removed_unreachable` is split correctly, so conservation holds.
  - `step_checked`'s `unserved == unreachable + removed_gridlock` holds by construction.
  - Test 13 only compares the array with the struct.
  - No core test has a gridlock removal.
- **Effect.**
  - After any gridlock removal, the UI's `unreachable` counts gridlock removals as unreachable trips.
  - `unserved` counts each one twice.
  - Comparisons are distorted exactly in the closure scenario this epic is built for. The brief requires real metric values, and metric correctness is a required verification area.
- **Verified run.** `MUT=UNR` passed city_001 26/26 and core 85/85 (`proto4/sim-core/src/world.rs`, `mutant("UNR")` in `metrics()`).
- **Fix: one line in `step_checked`**, so every test that runs gridlock removals checks it:
  ```rust
      assert_eq!(m.unserved, m.unreachable + m.removed_gridlock, "unserved at {t}");
  +    assert_eq!(m.unreachable, m.no_route + m.stranded + m.removed_unreachable, "unreachable at {t}");
  }
  ```
- **Verification of the fix** (already applied in `proto4/sim-core/tests/city_001_relief.rs`):
  - Reference: 26/26 pass, core 85 pass, and clippy is clean.
  - `MUT=UNR`: fails 9, 12, 13, 15 and 21.
  - Commands:
    - `zsh /Users/Z6DEC/.claude/jobs/e54ac286/tmp/r4_all.sh none UNR`
    - `cargo clippy -p sim-core --all-targets -- -D warnings`, run in `proto4` with `CARGO_TARGET_DIR=proto4/target`.

### MINOR

- **m1: G3a still survives (carried over from r3 m4).** If the forced-decision-without-route path does not reset the count, a newly stranded front shows its old count for exactly one tick. The stranded branch then resets it. The impact is negligible. Leave it to Gold code review, and add it to the ward's Gold list: "forced decision without route resets `blocked_ticks`".
- **m2: the `sim-wasm` switch to `EXTENDED_METRIC_NAMES`/`metrics_to_extended_array` is an Output without a test.**
  - Nothing in the 26 tests, or in the web tests, fails if `sim-wasm` keeps the core list.
  - Existing Vitest reads metrics by name (`web/tests/sim.test.ts`, `host.test.ts`), so the switch is compatible.
  - The Gold reviewer should check the wiring in code, or Gold should add a by-name check of `removed_gridlock`/`unserved` from `metric_names()`. Adding that check does not change Red tests.
- **m3: two C1 builder edge cases are untested.** Both are cheap to add, and both pass on the reference (`proto4/sim-core/tests/r4_extra.rs`, 2/2):
  - `set_sat_flow(LinkId(u32::MAX), 0.3)` → `UnknownLink(LinkId(u32::MAX))`. This catches a dense `Vec`-indexed override store that would abort on allocation, which breaks "the builder never panics".
  - `NaN` then `0.3` on the same link → OK with 0.3, and `0.3` then `0.0` → `InvalidSatFlow`. This catches "validate every stored override" instead of "last call wins".

  The impact is low, because networks are code-defined and there is no road editor in v1. Optional.
- **m4 (contract note, no action needed for this ward): tiny positive sat values are accepted.** For example, `1e-300` passes C1 validation, but `1 / (lanes × sat)` overflows to `inf`, so the link's key saturates to `u64::MAX` and the link becomes unroutable. This causes no panic and no NaN. If River City ever needs it, consider a lower bound, for example `≥ 1e-6`, in C1.

## Not findings (checked)

- **The premises hold on the reference.**
  - The ring is full at tick 400.
  - b1 is removed at T+600, and v crosses in the same tick: core step 3 happens before step 4.
  - P and Q alternate in test 11.
  - In test 19, no periodic reroute is due in the window, and the Q route is shortest at removal.
  - In test 25, the forced decision is observed before any periodic switch.
  - In test 21, L1 is empty at the epoch.
- **Test 12's "no exit in the removal step" follows from the core contract.** Core step 4 says "only the lane's front … at most one per incoming lane", and the scan wraps once, so a re-evaluation of the new front in the same tick is not allowed.
- **Test 16 cannot leak relief into core reference values.** It stays below 120 with and without the closure.
- **Tie rules of the relief search are not pinned by a tie test.** The ward and C2 mandate reuse of the router algorithm (`Tree::build`), and I could not construct a *plausible* implementation that reuses it but breaks ties differently. Not a finding.
- **The test file itself is clean.** It is clippy-clean, uses no HashMap/HashSet, and uses no wall clock.

## Required for re-review

1. Add the M1 line to `step_checked` in `city_001_relief.rs`.
2. Recommended: add "forced decision without route resets `blocked_ticks`" to the ward's Gold code-review sentence (m1), and add the `sim-wasm` extended-metrics wiring as a Gold check (m2). Optionally add the r4_extra tests (m3).
