# Review city-002 RED 3

**Reviewer:** adversarial test reviewer (fresh subagent, round 3), 2026-10-07
**Verdict:** APPROVED (0 BLOCKER, 0 MAJOR, 3 MINOR)

Scope: `.wdd/wards/city/ward-002.md`, `.wdd/epics/city.md` § C1–C3 (C3 reopen target as changed in aafc431), `.wdd/epics/core.md`, `.wdd/memory/decisions/river-city-calibration.md`, and the tests at commit aafc431:
- `crates/sim-core/tests/city_002_river.rs` (tests 1–12)
- `web/tests/river.test.ts` (tests 13–14)
- `web/e2e/river.spec.ts` (tests 15–16)

Earlier rounds: `city-002-red-1.md`, `city-002-red-2.md`.

## What I ran

All runs used a copy of the calibration prototype at `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/r002c/rc`. The only worktree file touched is this one.

**The test file and its runs:**
- The prototype's `tests/city_002_river.rs` is byte-identical (`cmp`) to the worktree file at aafc431.
- Release, `RC_INTRA=2.3 RC_CROSS=0.9`: **12/12 pass in 2.99 s**, far under the 120 s budget.
- Release with the prototype defaults (1.0 / 1.0, active ≈ 1000): only test 4 and test 11 fail (active 1003 / 997). The living-city check rejects that city correctly.
- Debug: 4 pass and 8 are ignored with `calibration: run with --release`, in 0.30 s.
- `cargo clippy -p sim-core --release --test city_002_river`: no diagnostics in the test file. The only 3 warnings are in the prototype `cities.rs`.

**Scratch diagnostic test.** `tests/zz_r3.rs` is the test file plus two diagnostics (scripts in `r002c/scripts/`):
- `zz_r3_diag` prints every test-10 quantity, a null (an 80-min baseline treated as a fully recovered city), and a late-reopen variant.
- `zz_r3_allchecks` runs all seven `check_*` functions (tests 4–10) per seed pair.

**Knob added in scratch only.** `RC_MAIN_SAT` overrides the Main Bridge sat flow.

## Round-2 findings: are they fixed?
| r2 | Status |
|---|---|
| M1: noisy 5-min baseline denominator for the reopen check | **Superseded by a contract change** (judged below). The new check uses only the C3 baseline (min 30–60), 10-min windows, and the run's own closure level. No 5-min baseline window remains. |
| m2: spillback chain could be short stubs | **Fixed.** `length(l1) + length(l2) >= 300.0`, matching ward row 7. |
| m3: Proxy without `has` trap | **Fixed.** A `has` trap hides `city_name` / `river` from `in`. |
| m4: same-tick entry/exit masking on east→west Main | Accepted as covered by the core closure tests. I agree: core_003 pins no-entry semantics, and this is a calibration test. |

## Is the reopen contract change a legitimate fix or a relaxation?

**Verdict: it is a legitimate fix of a noisy measure. The new criteria still separate a recovered city from an unrecovered one.**

### 1. The old target is noise on this city
I treated a plain baseline as a "fully recovered city" and compared its queued in minutes 70–80 with its own 30–60 mean. Across 12 seed pairs that ratio is **0.65–2.26**:

| Seed pair | Null ratio |
|---|---|
| (1, 1) | 2.26 |
| (9, 2) | 1.12 |
| (2026, 7) | 1.13 |

The old "≤ 1.5 × baseline" check therefore fails a perfectly recovered city at seed (1, 1). The reopened run's ratio there (2.49) is indistinguishable from the null (2.26).

Queued is a small, bursty number in this city: about 50 against 1,700 active. Its 10-minute means move by a factor of 2 with no intervention at all.

### 2. The new criteria still discriminate recovery
The key test is the late-reopen experiment. Same city and seeds, but the bridge is reopened 10, 5 or 0 min before the 70–80 window, so the city has had less time to recover.

| Reopen at | Active after / baseline | Test 10 result |
|---|---|---|
| min 50 (contract) | 0.97–1.08, 12 seeds | **all PASS** |
| min 60 (10–20 min recovery) | 1.14–1.17 at (2026,7), (11,3), (9,2); 1.09 at (1,1) | **3/4 FAIL** |
| min 65 | 1.19–1.29 | **4/4 FAIL** |
| min 70 | 1.33–1.40 | **4/4 FAIL** |

Demand perturbations also fail test 10 at a fixed seed:
- intra 2.5: fails (2026, 7) with active 1.11.
- cross 1.0: fails both seeds with active 1.19 and 1.13.

So test 10 is not a "bridge is open" test. A city whose backlog is still more than about 10 % of baseline fails it.

The backlog criterion (`active ≤ 1.1×`) does almost all the work:
- The Main share passes even with a 0-min recovery (0.53).
- The queue reduction passes with a 10-min recovery (q/qc 0.29–0.67).

Those two are sanity checks (the reopen took effect, the queues came down), not discriminators. That is acceptable, because backlog is the physically meaningful recovery measure. See MINOR 1 for a vacuity guard.

### 3. The change is measured, documented and not seed-tuned
**All seven checks pass at 16 of 16 seed pairs** at intra 2.3 / cross 0.9, so nothing is tuned to (2026, 7) or (11, 3).

Measured test-10 margins over 12 seeds:

| Measure | Measured | Threshold |
|---|---|---|
| Active ratio | ≤ 1.08 | 1.1 |
| Main share | ≥ 0.73 | 0.5 |
| q/qc | ≤ 0.63 | 0.75 |

The brief (`livingcity.md`) sets no recovery number. The changed number was an epic-level calibration choice, so this is not a deviation from the brief. It is still a change to a binding epic contract made at ward level (see MINOR 3).

## Measured (prototype, intra 2.3 / cross 0.9)
| | (2026, 7) | (11, 3) | 12-seed range |
|---|---|---|---|
| baseline active, min 30–60 | 1716 | 1689 | 1602–1716 |
| closure active, min 40–50 / baseline | 1.21 | 1.25 | 1.19–1.32 |
| closure queued, min 30–50 | 192 | 236 | 156–267 |
| after-reopen active / baseline | 1.06 | 0.99 | 0.97–1.08 |
| after-reopen Main share | 0.81 | 0.73 | 0.73–0.81 |
| after-reopen queued / closure | 0.40 | 0.17 | 0.17–0.63 |
| null queued, 70–80 / 30–60 | 1.13 | 0.99 | 0.65–2.26 |

## Findings

### MINOR 1: test 10's backlog criterion has no non-vacuity guard
`active ≤ 1.1 × baseline` only means "the backlog cleared" if the closure built a backlog. The queued guard exists (`q_closed > 1.5 × base`), but there is no matching guard for active. A city whose closure raises active by less than 10 % passes the backlog criterion trivially. Tests 6 and 8 make that unlikely, but they do not exclude it.

**Fix**, checked against the measured values (closure active / baseline ≥ 1.19 at all 12 seeds):

```rust
assert!(mean(&r.active[40..50]) > 1.15 * a_base, "the closure had built a backlog");
```

### MINOR 2 (optional): a time-matched baseline would make the active ratio cleaner
Demand RNG is separate from behaviour RNG, so the baseline and the reopened run generate identical trips. `mean(r.active[70..80]) / mean(base80.active[70..80])` therefore isolates the backlog from demand drift:
- Recovered seeds measure 0.98–1.06 with it, against 0.97–1.08 for the C3 denominator.
- The baseline's own drift from 30–60 to 70–80 is −5 % to +7 %.

C3 fixes the 30–60 denominator and the current margins are adequate, so this is a recommendation only.

### MINOR 3: process items for the Gold and epic gates (not test defects)
- **Epic gate.** The C3 reopen target was changed during ward Red. Present it at the epic gate as a contract change, with the null and late-reopen evidence above (decision file `.wdd/memory/decisions/river-city-calibration.md`).
- **Gold.** The prototype's `river_city` reads `RC_INTRA` / `RC_CROSS` from the environment. The shipped `cities.rs` must hard-code the calibrated constants. An env-reading sim is a determinism leak that these tests cannot detect, because they run without the variables set. The Gold reviewer should grep for `std::env` in `sim-core/src`.

## Checked and fine
- **Windows:**
  - `[30..60]` = 10–40 min after the closure at 20.
  - `[30..50]` = 10–30 min after the closure (the C3 closure level).
  - `[70..80]` = 20–30 min after the reopen at 50.
  - The share check fails correctly if the total is 0.
- **Spillback chains (test 7):**
  - The 300 m minimum is correct.
  - The chains exclude bridge links, connectors and U-turn feeders.
  - The approaches include both bridge directions, which is consistent with "an approach to the North or Old Bridge".
  - The closed run needs ticks > 0 and more ticks than the baseline.
- **Tests 4–9** are robust across 16 seed pairs. They reject the 1000-active city (test 4) and the oversaturated / not-recovering variants (test 10).
- **Web tests 13–16:** only the `has` trap changed since the r2 review. The wasm-bindgen object behind the Proxy still has its methods bound to the target, so the fallback test is valid. The e2e design matches the ward protocol (`?city=` default and fallback, the hook city taken from the sim, the network difference via `linkCounts`).
- **Test 12:** hashes of two separate builds are compared at every minute for 60 min with the closure, and a different demand seed gives different trips.
- **Earlier tests:** `git show --stat aafc431` shows no approved earlier test file was edited.

## Verdict
**APPROVED.** There is no BLOCKER or MAJOR. The new reopen criteria fix a demonstrably noisy measure (the null ratio reaches 2.26). They still fail cities that have not recovered (late-reopen and demand-perturbation experiments), and the full calibration holds at 16 seed pairs. MINOR 1 is recommended before the Gold snapshot is frozen: it is a one-line guard and does not change any expectation the prototype meets. MINORs 2–3 are advisory.
