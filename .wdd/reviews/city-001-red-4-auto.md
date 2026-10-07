# city-001 Red gate: auto-approval after round 4

**Verdict:** APPROVED. The user's convergence rule (2026-10-06) applies: from round 4 on, a gate whose only BLOCKER/MAJOR findings are verified-fixable test gaps is approved once the fix tests are incorporated.

## Round 4 findings (`city-001-red-4.md`)
- **M1, type (a), a test gap verified by the reviewer.** `unreachable == no_route + stranded + removed_unreachable` was not asserted once gridlock removals exist (mutant UNR survived).
  - Fix: one assertion added to `step_checked`, which every test uses.
  - On the reference, all 28 city_001 tests and 85 core tests pass, and the UNR mutant now fails tests 9, 12, 13, 15 and 21 (reviewer's run).
- **There are no BLOCKERs, no contract or spec defects, no unverified findings and no disagreements.** The rule's escalation conditions do not apply.

## MINORs
- **m1:** "a forced decision without a route resets `blocked_ticks`" is now a Gold code-review item.
- **m2:** the `sim-wasm` extended-metrics wiring is a Gold code-review item.
- **m3:** two builder edge-case tests were added as tests 27 and 28.
- **m4:** a tiny positive sat flow makes a link effectively unroutable. This is accepted, noted in the ward.

## Verification after incorporating
The reference is at `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/proto4/sim-core`, holding the final test file:
- `cargo test --release`: city_001 28/28, core_001 20, core_002 24, core_003 36, core_004 5. All green.
- `cargo clippy --all-targets -- -D warnings`: clean.

## Gate history
- r1 REJECTED: 2 BLOCKER, 4 MAJOR (a metric-name conflict with core_004, test 11's start, untested credit/1200/closure/cache rules).
- r2 REJECTED: 2 MAJOR (stranding reset, exit time at removal).
- r3 REJECTED: 2 MAJOR (approaching front, clippy).
- r4: 1 MAJOR, type (a) → auto-approved here.

Test snapshot: the commit that records this file. Gold must not change `crates/sim-core/tests/city_001_relief.rs`.
