# Review city-002 RED 2

**Reviewer:** adversarial test reviewer (fresh subagent, round 2), 2026-10-07
**Verdict:** REJECTED (1 MAJOR, 3 MINOR)

Scope: `.wdd/wards/city/ward-002.md`, `.wdd/epics/city.md` § C1–C3, `.wdd/epics/core.md`, and the tests at commit 37b5d9c:
- `crates/sim-core/tests/city_002_river.rs` (tests 1–12)
- `web/tests/river.test.ts` (tests 13–14)
- `web/e2e/river.spec.ts` (tests 15–16)

I also read `crates/sim-core/src/world.rs` (metrics), `crates/sim-wasm/src/lib.rs`, `web/src/sim/{host,protocol}.ts`, `web/src/ui/testHook.ts` and `web/src/App.tsx` (where `linkCounts` comes from).

## What I ran

All of this ran in a scratch copy of the implementer's calibration prototype at `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/r002b/rc`. Nothing in the worktree was touched except this file.
- `git diff --stat 113a7a4 HEAD`: only the three new test files, the ward and the r1 review changed. No approved test file was edited.
- `cargo test -p sim-core --release --test city_002_river` with `RC_INTRA=2.4` (the intended setting):
  - 10 tests pass and 2 fail (`reopen_recovers`, and `calibration_holds_for_another_seed` at its reopen check).
  - It takes 3.0 s for all 12 tests, so runtime is far below 120 s.
- Debug `cargo test -p sim-core --test city_002_river`: 4 tests pass (1, 2, 3, 12) and 8 are `ignored, calibration: run with --release`. It takes 0.46 s.
- `cargo clippy -p sim-core --tests`: no diagnostics in `tests/city_002_river.rs`. The only warnings are in the prototype's `cities.rs`, which is not under review.
- A diagnostic test (`tests/zz_diag.rs`, scratch only) reuses the file's own `run` harness. It prints every measured quantity, and a null experiment for test 10.

### Prototype measurements, RC_INTRA = 2.4

| | (2026, 7) | (11, 3) |
|---|---|---|
| baseline active, min 30–60 | 1853 | 1854 |
| longest ≥ 95 %-full run, base / closed | 0 / 4259 ticks | 0 / 2565 ticks |
| W→E exits, min 30–60 [Main, North, Old] | [1408, 171, 215] (78 %) | [1418, 179, 220] |
| queued ratio, closed / base | 5.29 | 5.28 |
| spillback ticks, closed / base | 1527 / 0 | 1556 / 0 |
| W→E trip-time ratio (n base / closed) | 1.77 (1782 / 1340) | 1.91 (1790 / 1331) |
| North + Old exits, closed / base | 1348 / 386 | 1350 / 399 |
| Main entries while closed / Main exits from +10 min | 0 / 0 | 0 / 0 |
| gridlock removals / trips generated | 0 / 23008 | 0 / 22985 |
| reopen: q(75–80) / base q(75–80) | 200.4 / 119.9 = 1.67 | 166.8 / 45.9 = 3.63 |

Demand sweep (`RC_INTRA` 1.0 / 1.6 / 2.0 / 2.8):
- Every closure target holds robustly throughout.
- The reopen target passes at 1.0, where active is about 1000, so test 4 fails there.
- At 2.8 the baseline is oversaturated, and test 4 correctly rejects it (2007 ticks ≥ 95 % full).
- The prototype at 2.4 really has not recovered by minute 80: active is about 2200 against 1850.

The harness therefore measures C3 correctly. Tests 4–9 are far from knife-edge at the intended setting, and the reopen failure at 2.4 is a genuine calibration problem in the prototype, not a test bug. However, the reopen **check itself** has a measurement problem (MAJOR 1).

## Round-1 findings: are they fixed?
| r1 | Status |
|---|---|
| M1: second seed covers only part of C3 | **Fixed.** `check_*` helpers. Test 11 runs all seven checks at (11, 3). |
| m2: drain-timing premise | **Fixed.** Per-tick `main_entries_while_closed` while closed. The drain check is loosened to the window start (10 min after the closure). |
| m3: Main Bridge arterial speed | **Fixed.** It equals the fastest non-connector speed. |
| m4: landmark geography | **Fixed.** North 1–2.5 km north of Main, Old 1–2.5 km south, plus the extent check. |
| m5: unserved only at min 60 | **Fixed.** Per-minute `unserved` and `removed_gridlock`, all 0. |
| m6: window means from 1 sample per minute | **Fixed.** Per-tick sums, divided per minute. |
| m7: fallback for fakes without `city_name`/`river` | **Fixed**, with one gap (MINOR 3). |
| m8: hook city from URL vs sim | **Fixed.** The test compares `linkCounts.length` of the two loaded networks. |
| m9: vitest timeout | **Fixed.** 30 s on 13 and 14. |

## Findings

### MAJOR 1: test 10's denominator (one 5-min baseline window) is noise, so the reopen verdict is decided by the seed, not by recovery
`check_reopen` compares `mean(r.queued[75..80])` with `1.5 × mean(base.queued[75..80])`, which is a single 5-minute window of the baseline. In a stationary baseline, 5-minute mean `queued` fluctuates strongly. On the prototype at d = 2026, across behaviour seeds 1–12, the 5-min windows range from 42 to 122 while the 30–60 means are 53–88.

**Null experiment.** I treated the "reopened" run as just another baseline realisation, i.e. a city that has fully recovered: same demand seed, a different behaviour seed. I used 12 behaviour seeds × 2 demand seeds, with 264 ordered pairs.

| Check | Fully recovered city fails |
|---|---|
| (a) current: q(75–80) ≤ 1.5 × base q(75–80) | **39 / 264 (14.8 %)** |
| (b) q(75–80) ≤ 1.5 × base mean(30–60) (the C3 baseline) | 29 / 264 (11 %) |
| (f) q(75–80) ≤ 1.5 × max(base 30–60, base 75–80) | 14 / 264 (5.3 %) |
| (d) 10-min numerator vs base 30–80 | 10 / 264 (3.8 %) |

**At the actual seeds it is worse, and in both directions:**
- **(11, 3):** the baseline window 75–80 is 45.9, the **lowest** of the 12 behaviour realisations at d = 11. The threshold becomes 68.9, which **9 of the other 11 baseline realisations exceed**. A city that has recovered perfectly fails test 11 with probability about 0.8.
- **(2026, 7):** the window is 119.9, the **highest** of 12. The threshold becomes 180, so a city still at about 2.3× its typical baseline queue (≈ 75) passes.

The verdict is therefore driven by the denominator's noise. A correct implementation is likely to fail at (11, 3), and a wrong (unrecovered) one can pass at (2026, 7). The predictable result is calibration by seed luck, which is exactly the overfitting the second seed was added to prevent.

**Fix (verified).** Use the C3 baseline, which C3 defines as the mean over sim minutes 30–60, the same quantity tests 4–6 use, as the denominator. Update ward row 10 from "≤ 1.5 × baseline over the same minutes" to "≤ 1.5 × the baseline mean over min 30–60".

```rust
/// Test 10: 25–30 min after reopening (at closure + 30 min), queued is back near baseline.
fn check_reopen(c: &City) {
    let reopen_at = CLOSE_AT + 30 * MIN;
    let mut cmds = close_main(c, CLOSE_AT);
    cmds.extend(c.landmarks.central_bridge.iter().map(|&l| open(l, reopen_at)));
    let base = run(c, &[], 60, None, None);
    let r = run(c, &cmds, 50 + 30, None, None);
    // C3 "baseline" = the mean over minutes 30–60 (one 5-min baseline window is as noisy as the target)
    let qb = mean(&base.queued[30..60]);
    let qr = mean(&r.queued[75..80]);
    assert!(qr <= 1.5 * qb, "after reopen queued {qr} vs baseline {qb}");
    assert!(mean(&r.queued[40..50]) > 1.5 * qb, "the closure had raised queued");
}
```

I ran this in the scratch copy:
- It compiles and adds no clippy findings.
- At `RC_INTRA=1.0` (a city that does recover) it passes.
- At 2.4 it fails correctly: 200.4 against 1.5 × 78.96. The prototype has not recovered.
- At the two fixed seeds, the null false-failure rate drops to 2 of 24 baseline realisations.

The 5-min numerator noise is left over from C3's own wording ("mean queued (over 5 min)"), and I do not ask the tests to deviate from it. If Gold's city fails only by that noise, the implementer should **escalate** to the human with a null check like the one above (the 10-min numerator (d) or the envelope variant) rather than tune seeds.

### MINOR 2: the spillback chain does not bound link length, and junction spacing is untested
`check_spillback` accepts any two consecutive non-connector links, each ≥ 80 % full. The ward's layout guidance gives junction spacing of 300–700 m, but nothing tests it. A city with short stub links near a bridge head (for example 40 m abutment links, which r1 even suggested as a way to make bridges clickable) would satisfy "spillback" with a queue of about 10 vehicles. The prototype has 600 m links, so it is not affected.

**Fix (optional):** in the chain construction, require `net.link(l1).length_m + net.link(l2).length_m >= 300.0`. Alternatively, in test 1, assert that non-connector, non-bridge links are ≥ 150 m.

### MINOR 3: test 14's fallback Proxy only hides the methods from `get`, not from `in`
The Proxy has no `has` trap, so `'city_name' in fake` is still `true`. A host that detects the optional method with `'city_name' in sim`, which is reasonable for an optional interface member and correct for a plain-object fake lacking the method, would call `undefined()` and fail this test for a bad reason. **Fix:**
```ts
const fake = new Proxy(real, {
  get: /* as now */,
  has: (target, prop) => prop !== 'city_name' && prop !== 'river' && prop in target,
});
```

### MINOR 4: the per-tick no-entry counter can be masked by a same-tick exit
`main_entries_while_closed` compares `link_count` before and after each step. An entry and an exit on the same Main Bridge link in the same tick cancel out.
- The west→east direction is backstopped: the window's `central_late == 0` check would see the exits of any vehicle that entered.
- The east→west link `b[0][1]` has no such backstop.

Core closure tests already cover no-entry semantics, so this is low risk. **Fix (optional):** also count east→west exits in the window and assert they are 0, or compare `link_exit_count` differences together with counts.

## Checked and fine
- **Windows.** Index `i` is the sample at the end of minute `i + 1`:
  - `[30..60]` is 10–40 min after the closure at 20.
  - `[75..80]` is 25–30 min after the reopen at 50.
  - `main_closed = (CLOSE_AT, 60*MIN)` starts counting at the closure tick, so there are no false positives.
- **Trip-time filter.** The west→east filter uses zone-node x against the corridor. Survivorship (fewer completions under the closure) biases conservatively.
- **Crossing and geography checks** behave as intended on the prototype.
- **Test 12** compares hashes of two separate builds every minute, plus different trips for a different demand seed.
- **Web tests 13–16** match the ward's protocol design:
  - `createSim` gets a third argument, so existing `(d, b)` fakes still type-check.
  - `init` without a city gives `createSim('river_city')`.
  - `ready.city` and `ready.river` are checked, with the `'unknown'` / `[0, 0]` fallback.
  - An explicit `three_bridges` is honoured.
  - The hook's `city` is backed by a real network difference: `linkCounts` comes from frames (`App.tsx`), and `ready()` waits for tick > 10, so it is non-empty.
  - `linkScreenCenter` returns null off-screen, so test 15 checks "on screen".
- **Ignore attributes and docs.** The debug `ignore` attributes are present on 4–11, and the file header documents the release command. The test file is clippy-clean.
- **Earlier tests** are unchanged.

## Verdict
**REJECTED** on MAJOR 1. Its fix is a few lines and is verified above, together with the ward row 10 wording. MINORs 2–4 are recommended but not required.
