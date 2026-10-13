# motion-003 Red gate, round 1 — REJECTED

Reviewer: fresh adversarial test-review subagent. Commit 1e0a117.
Artifacts reviewed:
- `.wdd/wards/motion/ward-003.md`, `.wdd/epics/motion.md` (M3), task §3, investigation § Consequences.
- Test hashes (verified):
  - `crates/sim-core/tests/motion_003_consequences.rs` 26d2388b…7b87
  - `web/tests/motion003.test.ts` 580d2d1d…47f0
  - `web/e2e/motion003.spec.ts` 9c93d219…e5fe

## Verdict: REJECTED (1 BLOCKER, 3 MAJOR)

## Findings

### B1 BLOCKER: test 6 fails for a correct implementation (`motion003.test.ts:250`)
I prototyped `Timeline::exits_at`, `Sim.command_log`/`exits_at`, the host fields and the pure functions in a scratch copy, then reverted them. Every assertion in test 6 passed except line 250, which fails deterministically with `expected 68 to be less than 68`.

Why it fails:
- The run ends with A at about 2815. The test branches at `at = closeTick − 100` (1215) and enters compare from B's view, so A **seeks back** to B's tick (`host.compare`).
- The 80 iterations at 60× then advance both sides only about 153 ticks, to 1368. That is just 53 ticks after A's closure at 1315.
- The vehicles already on the Main Bridge are still allowed to leave it. So A's and B's crossings since the branch are identical on every bridge: `[3,2,46,22,6,1]` on both sides.

The strict `<` therefore cannot hold.

**Fix:** run the compare long enough for the closure to show, for example until `A.tick() ≥ closeTick + 600`, with a loop bound. Keep the strict inequality.

### M1 MAJOR: the "before the closure" rate is normalised by a span that does not match its counts
The `bridgeFlow` layout puts `closeTick` (the command tick) in the second block. Its counts, however, come from `exits_at(closeTick)`, which reads the snapshot at or before `closeTick`, so their real base is `floor(closeTick/120)·120`. Test 6 pins this: it drops `exClose[0]`, and line 221 admits that the read is "at or before". Test 4 then pins `beforeSpan = closeTick − beforeBase`.

Both reads are floored to the same 120-tick grid, so the counts always cover exactly 1200 ticks. The divisor, though, is anywhere from 1200 to 1319 ticks. The rate is therefore understated by up to about 9%. In test 6's own run (closeTick 1315) the counts span 1200 ticks but the divisor is 1315 ticks, which is 8.7% low.

This breaks "metrics must be real sim values".

**Fix:**
- Carry the close-side base in the layout, for example `[closeTick, closeBase, beforeBase, …]` or `[closeBase, beforeBase, …]` with closeTick taken from `interventions`.
- In tests 4 and 6, compute `beforeSpan = closeBase − beforeBase`.
- Add a test-4 case where `closeTick` is not a multiple of 120.

### M2 MAJOR: Must DO "cover both cities" is not tested, and `bridgeNaming` has no direct test
No test uses `three_bridges`. The only appearance is the `createSim` switch in the host helper. The spec's "Bridge 1/2/3 in landmark order" is never asserted, and `bridgeNaming` (river names, links `[W→E, E→W]` in landmark order) is only exercised indirectly through River City e2e.

**Fix:**
- Add a vitest for `bridgeNaming('river_city', lm)` and `bridgeNaming('three_bridges', lm)`, checking names, keys and links against `landmarks`.
- Add at least one host or e2e check on `?city=three_bridges`: `bridgeFlow` has 28 values, the summary label is "Bridge 2" (or whatever the spec settles on), and there are 3 bridge labels.

Also decide in the spec whether three_bridges' central bridge is "Main Bridge", since the button there says "Close the main bridge".

### M3 MAJOR: the reopen / ○ path is not tested anywhere in the UI
The spec outputs "○ Reopened Main Bridge · hh:mm:ss" and a ○ timeline marker named "Reopened … at …". The test table for #7 claims "every marker carries a glyph (✕, ○ or ▼)", but no test reopens anything. Only the pure `kind: 'open'` is covered, in test 3. A UI that renders every entry as "✕ Closed …" would pass the whole suite.

This is smoke step 4 and part of Scope Q1, which also asks *when* a road was reopened.

**Fix:** add an e2e step (in test 7 or a new test) that reopens via the button, then asserts:
- the summary line "○ Reopened Main Bridge" with `hms(openTick)`;
- the marker `Reopened Main Bridge at hh:mm:ss` containing ○, at its fraction (±2 px);
- `interventions()` has 2 entries in tick order.

### M4 MAJOR: crossings since the branch are undefined once the branch snapshot is evicted
The comparison base is `B.exits_at(branchTick)`, which comes from B's snapshot at the branch tick. That snapshot is subject to the 48 MB budget: about 200 snapshots, roughly 23k ticks, which is about 3 wall-clock minutes at 60× and about 10 at 20×.

`window_metrics` (from the logs) keeps working after that point. Crossings, however, become NaN, or an implementation silently falls back to a later base, which gives mismatched windows. The spec says nothing, and no test covers it. This contradicts "matching windows" for A/B.

**Fix:**
- Specify it: the host captures the base counts once, at branch time, as adapter or host state rather than World state.
- Test it, for example with a wrapped `SimLike` whose `exits_at(branchTick)` returns NaN after the branch: crossings stay equal to now − base-at-branch. If you choose null rows ("—") instead, specify and test that.

### Minor findings (fix or record)
- m1. **Test 7 row numbers:** checking `toContainText(String(Math.round(r.now)))` is a substring match. For example, "0" matches any row containing a 0 digit. Assert the exact cell text. The ▲/▼ + number change is also never asserted.
- m2. **Test 8:** `toContainText(String(queued))` is a substring check, so it is weak.
- m3. **Test 9:** the comment at line 174 ("B has the Main Bridge closed…") has no assertion. Assert that B's Main Bridge crossings are below A's, or at most a small number.
- m4. **Which closure "before" refers to:** "before the closure" uses the latest close of *any* link. A user can close any link from the SelectionPanel, so closing a side street after the bridge silently moves the "before" window. The summary should name the closure it refers to, and a test should pin that. In the same area, "now" straddles the closure when the closure is less than 10 min old; consider flagging that span.
- m5. **Compare and seek in the UI:** nothing tests that the summary is hidden in compare ("single view only"), or that after seeking back before the closure the summary disappears while the marker stays (smoke step 5). The vitest covers only the data.
- m6. **Window eviction of markers:** a command before the window start has no marker test.
- m7. **Overlaps:** no test checks that bridge labels and queue pins do not overlap zone labels or each other.
- m8. **Weak non-negative check:** test 4's "never negative" loop is trivially satisfied by the fixture. Add a fixture where the counts decrease, which must clamp or give null.
- m9. **Causal wording elsewhere:** FORBIDDEN is checked only on the summary text, and test 9 checks only faster/slower. Also check the marker accessible names and titles.

## Checked and fine
- **Stubs fail for the right reasons:**
  - Rust: all three tests panic with `todo!`.
  - vitest:
    - test 2 fails on the empty log;
    - tests 3–5 throw "not implemented";
    - test 6 fails on the empty `command_log`.
  - e2e:
    - 7, 8 and 10 (all three sizes) fail at `interventions().length > 0`;
    - 9 fails with "crossings since the branch" being null;
    - 10b fails because the marker is not found.
  - `no_orphaned_exports` fails only on `bridgeNaming` (expected).
- **Satisfiable (prototype):**
  - Rust test 1, all three `#[test]`s, pass with a 7-line `exits_at`.
  - vitest 2–5 pass.
  - Test 6 passes apart from B1.
  - The getters leave `state_hash` unchanged.
- **No conflicts with frozen tests:**
  - `layout.spec` labels test selects `.zone` only;
  - `look.spec` checks `.labels .zone`;
  - `decor.test` checks the length of zones;
  - `gold_polish002` covers `.timeline` children and `.timeline-branch`, and markers live inside the track;
  - compare rows are matched by name;
  - `integration.test` message set: no new type is needed;
  - `guide_static` is untouched.
- **Invariants:**
  - identical demand (test 6 Generated A = B);
  - matching windows (test 6 uses B's base for both sides);
  - incomplete and unserved rows are still asserted (test 9);
  - glyphs plus text are asserted;
  - no World state (hash checks in tests 1 and 2).

## Commands run
- `cargo test -p sim-core --release --test motion_003_consequences`: 3 failed (todo!).
  - With a scratch `exits_at`: 3 passed. Reverted.
- `pnpm -C web build:wasm`: OK. Rebuilt with the prototype, then again from the reverted stubs.
- `pnpm -C web typecheck`: clean.
- `pnpm -C web exec vitest run tests/motion003.test.ts`:
  - on the stubs: 5 failed (reasons above);
  - with the scratch prototype: 4 passed, and test 6 failed at line 250 (`68 < 68`);
  - with line 250 disabled in an untracked copy, since deleted: 5 passed.
- `pnpm -C web exec vitest run tests/integration.test.ts`: only `no_orphaned_exports` fails, on `bridgeNaming`.
- `cd web && node_modules/.bin/playwright test -c zz-alt-port.config.ts e2e/motion003.spec.ts --reporter=line`: 7 failed, all for stub reasons.
- `git status` was restored to its original state: only `web/zz-alt-port.config.ts` is untracked, plus this file.
