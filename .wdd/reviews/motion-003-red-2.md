# motion-003 Red gate, round 2 — APPROVED

Reviewer: fresh adversarial test-review subagent. Commit 854eff9 (round diff `git diff 1e0a117 854eff9`).
Artifacts: `.wdd/wards/motion/ward-003.md` (revised), epic M3, task §3, investigation § Consequences, round-1 verdict.

Test hashes (verified, sha256):
- `crates/sim-core/tests/motion_003_consequences.rs` 26d2388bdbd244cdc8058316bb98f084e7f0e25a13005b1e204b86a16a387b87 (unchanged since r1)
- `web/tests/motion003.test.ts` 4ea646df425d5516483754ac8a80871df3ad8faa1901315156cd94a691dbee4f
- `web/e2e/motion003.spec.ts` 231efbd8cb675043bd327612d22dc35a16a6dc9bfd85ca7acfcf964875aeb42d

## Verdict: APPROVED (0 BLOCKER, 0 MAJOR, 6 minor)

## Round-1 findings

| R1 | Status | Evidence |
|----|--------|----------|
| B1 test 6 unreachable | **Resolved** | The compare now runs until `A.tick() ≥ closeTick + 600` (bound 6000), and the strict `<` is kept. With a prototype, test 6 passes. Since the branch, A (closed) crossed the Main Bridge 49+23 times and B (open) more. |
| M1 before-rate span | **Resolved** | The layout is now `[refTick, refBase, fromBase, …]` for both blocks, and a rate divides by `refBase − fromBase`. Test 4 uses a close at 1530, which is off the grid, and asserts span 540 s (1080 ticks), not the span from the close tick. Test 6 pins `bridgeFlow[16] ≤ closeTick`. |
| M2 three_bridges / bridgeNaming | **Resolved** | Test 2b (pure) covers river_city, three_bridges and unknown. e2e 7b covers `?city=three_bridges`: the summary shows "✕ Closed Main Bridge · hh:mm:ss", there are 3 `.bridge-label`s, and the hook names are North/Main/South Bridge. The spec decides that central is "Main Bridge" in both cities. |
| M3 reopen untested | **Resolved** | e2e 7 reopens and then checks: the ○ line with `hms(openTick)`, the ✕ line still there, the ○ marker within ±2 px, and two hook entries in tick order. Jump to start then checks that the summary is hidden and both markers stay. |
| M4 branch base evicted | **Resolved** | The spec says the base is captured once, at branch time, in the host. In test 6 a Proxy NaN-fills every `exits_at(t < position)` once compare starts. **Mutation check:** a host that re-reads `B.exits_at(branchTick)` per comparison fails test 6 with `[NaN×6]`. |
| m1 exact cells / change | Resolved | Test 7 asserts the exact cells, with the change in count format. |
| m2 test 8 substring | Resolved | It now uses `queued\s*q\b`. Both sides read the frame's `linkQueued` (`App.tsx:1354`). |
| m3 B<A assertion | Resolved | `motion003.spec.ts:222`. |
| m4 which closure "before" | Partly | It is now bridge-only, and test 6 shows that a later side-street close does not move it. **Mutation check:** "any close" fails test 6. Still open: the summary does not name the closure, and "now" can straddle the closure (minor n3). |
| m5 compare / seek hiding | Resolved | Test 9 checks that the summary is hidden in compare. Test 7 checks the rewind. |
| m6 marker eviction | Open (minor n4) | |
| m7 label overlaps | Open (minor n4) | |
| m8 decreasing counts | Open, acceptable | `exit_count` is cumulative and monotonic, so it cannot decrease. |
| m9 marker names | Resolved | `FORBIDDEN` is applied to the marker accessible names. |

## New findings (all minor; fix during Gold or record)

- **n1 Stale stub docs contradict the spec.**
  - `web/src/sim/protocol.ts` (`FrameMessage.bridgeFlow`) still describes the round-1 layout (`posTick, nowBase, …, closeTick` as "the latest close command").
  - `bridgeNaming`'s doc in `render/cities/index.ts` still says "Bridge 1/2/3".
  - Update both to the revised spec: bridge closes only, `[refTick, refBase, fromBase, …]`, and North/Main/South.
- **n2 7b checks names only through the hook.**
  - Not checked: the summary's crossing-table rows (North/Main/South Bridge) in the DOM, and `bridgeFlow` length 30 on three_bridges.
  - Cheap to add: `box.getByRole('row', { name: /^South Bridge/ })` visible.
- **n3 Context for the "now" window.** "Now" can include pre-closure traffic when the closure is less than 10 min old. With the probe at close + 900 ticks, the Main Bridge's "now" was 188, mostly from before the closure. Test 10 shows the summary in exactly that state. The table is labelled "observed", so this is not a false claim. Still, consider showing the span or "since hh:mm:ss", and naming the closure that "before" refers to. This is a UX note, not a correctness bug.
- **n4 Still untested** (carried over from r1 m6 and m7):
  - a marker for a command before the window start;
  - `bridge-label` / `queue-pin` overlapping `.zone` labels;
  - the "—" cell for a null rate in the UI.
- **n5 Weak DOM pin check** (`motion003.spec.ts:109`). `hasText: '▼ 5'` also matches "▼ 52". The hook equality and the position check carry the real assertion, so this is a low-value line. Prefer an exact text match.
- **n6 Layering nit.** `render/cities` imports the `BridgeNaming` type from `ui/consequences`. The dependency is type-only, but the type belongs on the render or protocol side.

## Satisfiability (prototype, reverted)
I implemented the following in place and then ran the tests:
- `Timeline::exits_at` (partition_point over snapshots plus the position world);
- `Sim.command_log` / `exits_at` (NaN-filled on `None`);
- host `interventions` / `bridgeFlow` (latest bridge close ≤ position) / `crossings` (base captured in `branch()`);
- the three pure functions and `bridgeNaming`.

Results:
- **Rust:** 3/3 passed.
- **vitest `motion003.test.ts`:** 6/6 passed.
- **Mutations:**
  - re-reading the branch base per comparison: test 6 fails (NaN);
  - "before" taken from any close: test 6 fails.

**e2e preconditions probed on wasm** (River City 2026/7, the app's seeds):
- A without a closure has links with ≥ 3 queued at most sampled ticks between 2520 and 3360 (max 4–30), so test 9's pins on A are reachable.
- After the Main Bridge closes at 1900, the top queues are 39–67, and the Main Bridge's "now" rate at close + 1800 is 0, as test 7 expects.

**Not prototyped:** the UI (summary, markers, labels, pins). The e2e satisfiability was judged from the existing DOM:
- the reopen button is "Main bridge closed — reopen", and `.first()` resolves to it, since no selection is open;
- the "Jump to start" button exists;
- `.labels-b` exists only while comparing, so 7b's count of 3 is sound;
- the SelectionPanel shows `<dt>queued</dt><dd>N</dd>`.

Afterwards I reverted everything:
- `git checkout` of the 5 source files;
- deleted the probe file `web/tests/zz_probe_r2.test.ts`;
- rebuilt the wasm from the stubs.

## Stubs fail for the right reasons
- **Rust:** all 3 tests panic `not yet implemented: motion-003 red: exits_at`.
- **vitest:**
  - test 2: `expected [] to deeply equal [[100,0,284],…]`;
  - tests 3, 4 and 5: "consequences: not implemented";
  - test 2b: "bridgeNaming: not implemented";
  - test 6: empty `command_log` → `.at(-1)` undefined (line 229).
- **e2e (8):**
  - 7, 7b, 8 and 10 (all three sizes): `interventions().length > 0` timeout;
  - 9: "crossings since the branch" is null;
  - 10b: the marker is not found.

## Commands run
- `shasum -a 256` on the 3 test files: the hashes match the ones above.
- `cargo test -p sim-core --release --test motion_003_consequences`:
  - stubs: 3 failed (`todo!`);
  - prototype: 3 passed.
- `pnpm -C web build:wasm`: OK (stubs, then the prototype, then the stubs again).
- `pnpm -C web typecheck`: clean, on both the stubs and the prototype.
- `pnpm -C web exec vitest run tests/motion003.test.ts`:
  - stubs: 6 failed;
  - prototype: 6 passed;
  - the 2 mutants each fail test 6.
- `pnpm -C web exec vitest run tests/zz_probe_r2.test.ts` (temporary probe, deleted): the queue and rate preconditions above.
- `cd web && node_modules/.bin/playwright test -c zz-alt-port.config.ts e2e/motion003.spec.ts --reporter=line` (port 5194): 8 failed, all for stub reasons.
- `git status` afterwards: only `?? web/zz-alt-port.config.ts` (pre-existing) plus this file.

---

## After approval (2026-10-13), before the freeze

Two of the minors were tightened in the tests; nothing else was changed:
- **n5:** test 7 matches a queue pin's text exactly (`^▼ q$`).
- **n2:** test 7b checks that the summary shows a crossing row per bridge name.

Left for Gold: n1 (stub doc comments), n6 (move `BridgeNaming` to the render or protocol side), n3 (show the span and the closure that "before" refers to), n4 (record as known or untested).

**Frozen (sha256):**
- `crates/sim-core/tests/motion_003_consequences.rs`: `26d2388bdbd244cdc8058316bb98f084e7f0e25a13005b1e204b86a16a387b87`
- `web/tests/motion003.test.ts`: `4ea646df425d5516483754ac8a80871df3ad8faa1901315156cd94a691dbee4f`
- `web/e2e/motion003.spec.ts`: `469d96e65f319d88454b994b818f165e2a54d22f9b334ffc487cb77e2412a1fa`
