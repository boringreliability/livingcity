# Review: core-001 — Red gate (round 6)

## Reviewer
Adversarial test reviewer (Claude subagent, independent of the author), 2026-10-06.
Inputs read: `livingcity.md`, `.wdd/epics/core.md`, `.wdd/wards/core/ward-001.md`,
`crates/sim-core/tests/core_001_physics.rs` (19 tests), `crates/sim-core/src/*.rs` (stubs),
`.wdd/reviews/core-001-red-5.md`, `git diff f6c114c 1f77026`.
`cargo test -p sim-core --test core_001_physics`: it compiles, and 0 pass / 19 fail on `todo!()`, which is expected for Red.
The worktree is unchanged except for this file.

Method: I copied the round-5 Python reference to `/tmp/wddref6/` (outside the repo) and checked `ref.py` again
against the current contract. The contract did not change in round 5. Only the ward table and the tests changed.
I updated `scen.py` to match the round-5 test changes exactly:
- T15 part 3 (`:741-761`): nodes o1, d1, o2, d2; two 4-lane links; 3 + 3 spawns; one `step_checked`; tuple
  `(link_count(l1), link_count(l2), buf(o1), buf(o2)) == (2, 2, 1, 1)`.
- T19 (`:878-926`): `lanes_a ∈ {1, 2}` as the **outermost** loop, `la = link(oa, m, 13.9, lanes_a)`, 648 configs.

New scripts:
- `new_muts6.py`: 18 new mutants.
- `probe_rr6.py`: consequence probes for the mutants that are not caught.
- `probe_starve.py`: the origin-node starvation in finding 2.
- `t19_count.py`: per-mutant T19 violation counts over all 648 configs.

## Verdict
REJECTED

## Prior findings status (round 5)

| # | Round-5 finding | Status | Evidence |
|---|---|---|---|
| 1 | MAJOR: T19 does not catch `tg_no_limit` / `tg_limit_len` | **Resolved** | T19 now has a 2-lane feeder (`lanes_a` outer loop, 648 configs). Correct: **0/648** violations. `tg_no_limit`: **54/648** (all with lanesA=2), first failure `lanesA=2 A=100 B=100 M=30 lanes=2 pa=1 pb=1`, t=43, link `lm` lane 0, gap 4.65. `tg_limit_len`: **54/648**, same first config and gap. `tg_ignore_moved` is still caught: **93/648** (36 with lanesA=1, 57 with lanesA=2), first failure `lanesA=1 A=200 B=100 M=30 lanes=1 pa=1 pb=1`, t=36, gap 4.25. Ward row 19 is updated, and its claim "covers both guard clauses" is now true. |
| 2 | MAJOR: global admission budget (`admit_global`) | **Resolved** | T15 part 3 (`:741-761`). Correct: `(2, 2, 1, 1)`. `admit_global`: `(2, 0, 1, 3)`, so T15 fails. Ward row 15 now says "not shared across origins". |
| 3 | MINOR: stale T7 comment | **Resolved** | `:342` now reads "And demand still exceeded supply at the end (origin buffer non-empty)", which matches the assertion. |
| 4 | MINOR: low-impact or equivalent mutants | Unchanged | `credit_late`, `sink_gated`, `entry_s_nocap`, `empty_as_length`, `rr_on_blocked` and `lane_change` are still not caught. They are all MINOR or equivalent, as argued in red-4 and red-5. |

## Findings

### 1. MAJOR: admission that checks the tail's pre-move position is not caught (origin capacity −17 %)
The contract `core.md:51` applies the lane-choice rule, including `tail_guaranteed`, to origin admission too
("discharge or origin"). Mutant `admit_tail_pre_move`: admission checks the tail's current `s`, i.e.
`tail.s >= 0 + JAM_SPACING`, while discharge stays correct. `core.md:63` invites this mistake with its own wording:
"entering at rest needs 7.5 m of room". An implementer who writes a dedicated admission check, instead of
reusing the lane-choice function, will very likely write exactly this. **No test catches it: all 19 pass.**
- Consequence, a capacity error: a 1-lane origin admits at ticks 0, 6, 12, … instead of 0, 5, 10, …, so
  **0.333 veh/s instead of the 0.4 veh/s** that `core.md:63` documents (`probe_rr6.py`: 34 instead of 40 admissions
  in 200 ticks). Every origin link with 1 or 2 lanes then injects 17 % less, so buffers grow and travel times rise.
- Why it is missed: every test whose throughput is measured has an origin link with ≥ 3 lanes (T7: 4, T8: 3,
  T16: 3), where `ORIGIN_ADMIT_PER_TICK` or downstream discharge binds instead. The 1-lane origins (T12, T19,
  T10's `o2a`) are never admission-bound in a measured quantity.
- The mutant also flips the priority between origin and through traffic (see finding 2: through traffic exits
  191 vs 0), but no test observes that either.

**Fix (verified):** add to T15: a 1-lane, 500 m origin link and 3 spawned vehicles. After 5 `step_checked`,
assert `link_count == 1`. After the 6th, assert `link_count == 2`. In other words, the second vehicle is admitted
during tick 5: tail at s = 5.0 and v = 4 gives `tail_guaranteed = min(5.0 + 5·0.5, 500) = 7.5 ≥ 7.5`.
Correct: 1 then 2. `admit_tail_pre_move`: 1 then 1.

### 2. MAJOR (contract defect, in this ward's scope): at a node that is also an origin, admission starves through traffic completely
This is not a mutant. It is what a **correct** implementation of the current contract does, so no test can catch
it. Discharge (step 4) runs before admission (step 5), which suggests that through traffic has priority. The
feasibility thresholds invert that priority:
- A through vehicle standing at the stop line has `v' = 1`, `reach = length + 0.5`, so `entry_s = 0.5`. It needs
  `tail_guaranteed ≥ 8.0`.
- An admitted vehicle has `entry_s = 0`. It needs `tail_guaranteed ≥ 7.5`.

When the tail starts from rest, `tail_guaranteed` runs 0.5, 1.5, 3.0, 5.0, **7.5**. In the tick where it reaches
7.5, discharge fails (7.5 < 8.0) and admission succeeds in the same tick. The new tail starts at s = 0, so the
cycle repeats. A vehicle moving toward the stop line has an even larger `entry_s` and loses too.

Measured on the correct reference (`probe_starve.py`): u → o (1 lane) → d (300 m, 1 lane) → e, 3600 ticks, through
demand every 4 ticks.

| Origin demand at o | L0 exits (through) | Offered | Origin admitted | Downstream L1 |
|---|---|---|---|---|
| none | 705 | 900 | — | — |
| every 5 ticks (0.4 veh/s = admission capacity) | **0** | 900 | 720 | nearly empty |
| every 3 ticks | **0** | 900 | 720 | |
| every 3 ticks, with through demand only every 10 ticks | **0** | 360 | 720 | |
| every 6 ticks (0.33 veh/s, below capacity) | 148 | 900 | 599 | |
| 2-lane links, origin demand every 2 ticks | **0** | 1800 | 1440 | |

In every case except "every 6 ticks", L0 fills to capacity (66/66) and spills back while L1, the next link, is
far from full. This contradicts the brief (`livingcity.md:70`: "A queue must be able to propagate upstream **when
the next road is full**"). It is the same class of total starvation that `core.md:58` explicitly designs against
("Not `tick mod n` … would always favor the same feeder"). Core-002 puts demand on nodes ("origins/destinations are
nodes", `core.md:113`), and the demo city routes rerouted traffic through nodes of residential districts. Through
traffic would then queue behind an almost empty road and never clear. The cause is far from where it shows up.

Severity: the definitions classify implementation mistakes, and this is a contract defect. I rate it MAJOR because
it is in this ward's scope (the interaction of steps 4 and 5, which `ward-001.md` implements) and because
starvation is a listed MAJOR consequence. If the gate owner reads MAJOR strictly as "implementation mistake", this
becomes MINOR. The verdict stays REJECTED because of finding 1.

**Fix options (the author decides; each needs a test):**
- (a) Make the origin buffer a virtual in-lane of its node in the discharge round-robin (it has its own credit,
  and admission consumes it). This gives fair sharing like real merges. Test: node with an in-link plus saturated
  origin demand; the through share is 40–60 %.
- (b) Make it a network rule: an origin node must have no in-links (centroid connector), and validate it in
  `spawn_with_route` / core-002 demand. The downstream intersection's round-robin then arbitrates. This is the
  cheapest change. Document it under "Documented simplifications", and add a negative test.
- (c) Keep the behavior, but document it explicitly as a simplification ("origins have priority over through
  traffic at their node"). I do not recommend this, because it contradicts `livingcity.md:70`.

### 3. MINOR: other new mutants that are not caught (no measurable consequence, or less plausible)
Consequence probes (`probe_rr6.py`): 3→1, 2+1→1, 3→2, 2+1+1→2 and 3+1→2 lane merges, a 1-lane origin, origin vs.
through traffic, and a blocked-link skip.
- `rr_live` (the scan reads `rr_next` live instead of fixing the order at scan start, violating `core.md:58`),
  `rr_first_only` (`rr_next` updated only after the first transfer of the tick) and `lane_major_order` (in-lanes
  ordered by lane index first): shares and per-lane rates are identical to the correct reference within ±1
  vehicle. They violate the contract's ordering, but they are equivalent in effect.
- `nodes_desc` (discharge nodes descending) and `swap_discharge_admission` (steps 4 and 5 swapped): no difference
  in any test or probe. Because of finding 2, step 4 vs. 5 currently makes no observable difference at a shared
  node. Whatever fix lands for finding 2 should also pin this order.
- `admit_origins_desc`: equivalent while budgets are per origin.
- `admit_count_skipped`: vehicles skipped because their first link is blocked consume the per-origin budget. With
  `[X, Y, Y2 → short; Z → wide]`, correct gives `wide=[3]` and the mutant gives `wide=[]`, which starves the
  origin's other links. T15 part 2 has only one vehicle (Y) behind X, so it cannot see this. This is less
  plausible than the caught `admit_count_attempts`. **Cheap fix:** spawn a third `short` vehicle in T15 part 2
  (X, Y, Y2, Z, Z2). Expected: short=[0], wide=[3], buffer **3**.
- `credit_reset_zero` (credit = 0 instead of −1 on transfer): exactly equivalent, because credit is at most 1 and
  ≥ 1 is required, so it is exactly 1.0 when a transfer happens.

### 4. MINOR: notes
- The commit subject of `1f77026` says "red r6", but it contains the round-5 fixes and `red-5.md`. This is
  cosmetic.
- `check_invariants` still has no negative test, and LIFO reuse in the free list is untested beyond
  `VehicleId(0)` (red-4/red-5).

## Reference results (current contract, `python3 -I /tmp/wddref6/scen.py`)

| Test | Assertion(s) | Measured | Result |
|---|---|---|---|
| 1–3 | builder/spawn API | read-through; unchanged since red-4; consistent with `core.md:42` | OK |
| 4 | travel within ±2 of 205.5 | **205** | PASS |
| 5 | gap ≥ 7.5 − 1e-3; s monotone; lane constant | no violation; 332 completed | PASS |
| 6 | link_count ≤ cap; L2 reaches cap | L2 max 20/20 | PASS |
| 7 | lanes=1: 135–151; lanes=2: 270–302; buffer > 0 | **150** (L1 13/40, buffer 954); **300** (L1 77/80, buffer 619) | PASS |
| 8 | L2 full < L1 full ≤ origin ≥ 5; front stopped; frac ≥ 0.9 | 203 < 1362 ≤ 1494; true; 1.000 | PASS |
| 9 | blocked_ticks > 50; no crossing while full; waiting front | 734; L2 max 13/13; true | PASS |
| 10 | conservation; all complete; twin identical | 1015 spawned, all completed by tick 3022 | PASS |
| 11 | completed ticks == [65,75,85]; 28.78–34.25 s | **[65, 75, 85]**; 32.5 s × 3 | PASS |
| 12 | total ≥ 250; share 0.4–0.6 | **300**; **0.500** (150/150); l3c completions 350 | PASS |
| 13 | crossings ≤ 1 + 0.25 n; L2 ≥ 10 | first exit at loop tick 122; min slack 0; L2 = 19 | PASS |
| 14 | lanes [0,1,0,1]; no lane change | [0,1,0,1] on both links | PASS |
| 15 | part 1 FIFO/rate/at rest; part 2 short=[0], wide=[2], buffer 2; **part 3 (2,2,1,1)** | as expected; part 3 **(2, 2, 1, 1)**; all 10 admitted within 60 ticks | PASS |
| 16 | done > 227.5; max L1 < 99 | done **325**; max L1 **40**/198 | PASS |
| 17 | travel == 152; slowest > 5 | **152**; 13.0 | PASS |
| 18 | v on L2 ≤ 8 + 1e-9; completed_tick == 85 | **85**; max 8.0 | PASS |
| 19 | **648** configs; spacing ≥ 7.5 − 1e-9; invariants every tick | 648 configs, **0** violations; min gap exactly **7.5**; 64608 completions in total | PASS |

All 19 pass on the reference. **No BLOCKER:** no test fails a correct implementation of the current contract.

## Mutation table
"Caught by" lists tests that fail on the mutant and pass on the correct reference. Scripts: `muts.py`,
`extra_muts.py` and `new_muts6.py` (new this round, marked ★); T19 counts come from `t19_count.py`.

| Mutation | Caught by | Severity if not caught |
|---|---|---|
| No spacing check on entry | 5, 6, 7, 8, 9, 10, 12, 13, 15, 19 | |
| Tail compared at pre-move position (both steps) | 6, 7, 8, 9, 12, 16 | |
| ★ Tail pre-move, discharge only | 6, 7, 8, 9, 12, 16 | |
| ★ Tail pre-move, **admission only** | **NOT CAUGHT** | **MAJOR** (finding 1) |
| `tail_guaranteed` ignores `moved` | 19 (93/648) | |
| `tail_guaranteed` ignores `limit_now` | **19 (54/648)**, resolved | |
| `tail_guaranteed` limit = link length | **19 (54/648)**, resolved | |
| `tail_guaranteed` uses `tail.v` | 7, 8, 9, 12 | |
| ★ Movement uses the leader's pre-move position | 6, 7, 8, 9, 12, 16 | |
| ★ Front not limited at stop line | 5, 6, 7, 8, 9, 10, 12, 13, 19 | |
| ★ `v = v'` instead of `(s'−s)/DT` | 8, 9 | |
| Credit cap 4.0 | 13 | |
| ★ Cap applied before add (max 1.25) | 9, 13 | |
| No credit | 6, 7, 8, 9, 13 | |
| Credit only on non-empty lanes | 17 | |
| Credit added after decision | NOT CAUGHT | MINOR (equivalent in core-001) |
| Credit per link | 6, 7, 8, 9, 16 | |
| ★ Credit reset to 0 on transfer | NOT CAUGHT | MINOR (exactly equivalent) |
| ★ Lane capacity off by one (`count <= lane_cap`) | 5, 6, 7, 8, 9, 10, 12, 13, 19 | |
| Lowest-id first (no RR) | 7, 8, 12 | |
| RR start = tick mod n | 9, 12 | |
| `rr_next = i` | 7, 8, 12 | |
| `rr_next` advanced on completion | 12 | |
| `rr_next` advanced when waiting for credit | NOT CAUGHT | MINOR |
| ★ Scan reads `rr_next` live | NOT CAUGHT | MINOR (equivalent in probes) |
| ★ `rr_next` only after first transfer | NOT CAUGHT | MINOR (equivalent in probes) |
| ★ In-lanes ordered lane-major | NOT CAUGHT | MINOR (equivalent in probes) |
| ★ Nodes discharged descending | NOT CAUGHT | MINOR |
| ★ Steps 4 and 5 swapped | NOT CAUGHT | MINOR (unobservable because of finding 2) |
| ★ Front already moved this tick crosses again | 17 | |
| ★ Transferred vehicle not marked moved | 11, 17, 18 | |
| ★ Admitted vehicle not marked moved | 11, 15, 17, 18 | |
| Transferred/admitted also move in step 6 | 11, 15, 17, 18 | |
| Sink consumes credit | 16 | |
| Sink gated on credit | NOT CAUGHT | MINOR (equivalent) |
| Unlimited admission | 15 | |
| Admission limit per first link | 15 | |
| Admission limit global across origins | **15 (part 3)**, resolved | |
| ★ Origins admitted descending | NOT CAUGHT | MINOR (equivalent with per-origin budget) |
| Blocked vehicle uses admission budget | 15 | |
| ★ Skipped (same blocked link) vehicles use budget | NOT CAUGHT | MINOR (finding 3; cheap fix given) |
| LIFO admission | 14, 15 | |
| Global head-of-line blocking | 15 | |
| Lane = lowest feasible | 14 | |
| Lane tie → highest index | 14 | |
| Empty lane valued as link length | NOT CAUGHT | MINOR |
| Lane = rank mod lanes | 5, 14 | |
| Lane change into gap (overtaking) | 5 | |
| Lane change rebalance to lane 0 | NOT CAUGHT | MINOR (fires about once) |
| Ignoring downstream capacity | 5, 6, 7, 8, 9, 10, 12, 13, 19 | |
| Completion without reaching end | 4, 11, 17, 18 | |
| `completed_tick + 1` | 11, 17, 18 | |
| No acceleration limit | 4, 11, 17, 18 | |
| Admitted at vmax | 4, 11, 15, 17, 18 | |
| Entry speed ignores next limit | 18 | |
| Movement uses wrong link's vmax | 18 | |
| Strict `>` crossing / feasibility | 7, 8, 9, 12 / 7, 8, 9, 12 | |
| Transfer at s = 0 / at v = 0 | 7, 8, 9, 12, 17, 18 / 6, 7, 8, 9, 11, 12, 16, 17, 18 | |
| `entry_s` not capped | NOT CAUGHT | MINOR (cannot be observed below 20 m/s) |
| No car following | 5, 6, 7, 8, 9, 10, 12, 13, 19 | |
| Contract (correct impl): origin admission beats through traffic | n/a (correct behavior) | **MAJOR, contract** (finding 2) |

## Notes for Gold reviewer
- A correct implementation produces exactly:
  - T4: travel **205** ticks.
  - T5: 332 completed.
  - T6: L2 max 20/20.
  - T7: **150** (lanes=1, L1 13/40, buffer 954) and **300** (lanes=2, L1 77/80, buffer 619).
  - T8: L2 full at tick **203**, L1 full at **1362**, origin ≥ 5 at **1494**, frac 1.000.
  - T9: blocked_ticks **734**.
  - T10: **1015** spawned, all completed by tick 3022.
  - T11: completed ticks **65/75/85**.
  - T12: total **300**, 150/150, share 0.500.
  - T13: first L2 exit at loop tick **122**, final L2 count 19.
  - T14: [0,1,0,1].
  - T15: part 2 short=[0], wide=[2], buffer 2; part 3 **(2, 2, 1, 1)**.
  - T16: done **325**, max L1 **40**.
  - T17: travel **152**.
  - T18: completed tick **85**.
  - T19: **648** configs, 0 violations, min gap exactly 7.5.
- If finding 1 is fixed as proposed: a 1-lane origin admits at ticks **0, 5, 10, …**, so `link_count` is 1 after 5
  steps and 2 after 6 steps.
- If finding 3's cheap fix is applied (X, Y, Y2, Z, Z2): short=[0], wide=[3], buffer 3.
- Read the Gold admission code to confirm that it calls the **same** lane-choice/`tail_guaranteed` function as
  discharge, with `entry_s = 0`, and not a separate `tail.s >= 7.5` check.
- Also check the following:
  - The admission counter is reset inside the per-origin loop.
  - `tail_guaranteed` contains `min(…, limit_now)`.
  - Movement has no `f64::clamp`.
  - `check_invariants` is at least as strict as T19's spacing check.
  - `link()` does not index nodes eagerly.
- Reproduce with:
  - `python3 -I /tmp/wddref6/scen.py`
  - `python3 -I /tmp/wddref6/muts.py`
  - `python3 -I /tmp/wddref6/extra_muts.py`
  - `python3 -I /tmp/wddref6/new_muts6.py`
  - `python3 -I /tmp/wddref6/t19_count.py`
  - `python3 -I /tmp/wddref6/probe_rr6.py`
  - `python3 -I /tmp/wddref6/probe_starve.py`
