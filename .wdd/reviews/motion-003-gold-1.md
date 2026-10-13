# motion-003 Gold gate, round 1: REJECTED

Reviewer: a fresh adversarial implementation-review subagent. Scope: `git diff 6753f58..HEAD -- crates web/src docs` at HEAD 34d6a55, ward spec `.wdd/wards/motion/ward-003.md`, epic contract M3, task §3.

## Verdict: REJECTED (0 BLOCKER, 2 MAJOR, 6 minor)

Every suite is green, the Rust change is read-only, and the numbers on screen match the hooks and the sim. The rejection is for two visible defects in the demo flow that no frozen test covers:
- the new queue pins cover the new bridge names (and district labels);
- in compare, the timeline marks A's intervention only, without naming the scenario.

## Frozen tests (verified)
- sha256:
  - `web/e2e/motion003.spec.ts` = 9b9ca968…095e;
  - `web/tests/motion003.test.ts` = 4ea646df…bee4f;
  - `crates/sim-core/tests/motion_003_consequences.rs` = 26d2388b…7b87.

  All three match the red-4-auto freeze.
- `git diff 6753f58..HEAD --stat -- web/tests web/e2e crates/*/tests` lists only `web/e2e/motion003.spec.ts` (+26/−4). Those are the Red r3 selector fixes (f3f39ef) and the Red r4 label-placement amendment and m3 (34d6a55), and nothing else. No other test file changed.

## Commands and results
| Command | Result |
|---|---|
| `pnpm -C web build:wasm` | exit 0 |
| `pnpm -C web build` | exit 0 (typecheck + vite build) |
| `pnpm -C web test` | 31 files, **156 passed, 7 skipped**, exit 0 (293 s) |
| `pnpm -C web exec vitest run tests/motion003.test.ts --reporter=verbose` | 6/6 passed (2, 2b, 3, 4, 5, 6) |
| `cargo test --workspace` | 173 passed, 0 failed, 9 ignored (calibration tests are ignored in debug); `motion_003_consequences` 3/3 |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |
| `playwright -c zz-alt-port.config.ts motion003 look layout a11y guide` | **37 passed** (7.7 min, load 30) |
| `playwright -c zz-alt-port2.config.ts timeline gold_polish002 compare acceptance inspect motion002 gold_timeline003/004/005` | **51 passed** (13.3 min, load 18–28) |
| node + wasm micro-benchmark (scratch `bench.mjs`; River City, Main Bridge closed at 2400, tick 7200) | `command_log` + 4× `exits_at` (6 links) = **0.85 µs/frame**, against `encode_frame` 23.5 µs (load 27). This agrees with docs/performance.md (0.66 µs). `state_hash` is unchanged after 22,000 getter calls. |

## Determinism and invariants (checked)
- **The Rust diff is read-only.**
  - `Timeline::exits_at` reads either `self.world` or a snapshot's `state` through `link_exit_count`, located with `partition_point`.
  - `Sim::command_log` and `Sim::exits_at` only read. An unknown link, or a NaN or negative tick, gives NaN.
  - No `World` field was added. The golden-hash, replay and branch tests are green.
- **Demand is identical.** The smoke-test compare shows Generated 2772 / 2772.
- **Incomplete and unserved trips stay visible.** The comparison rows Generated, Completed, Incomplete, Unserved, Mean trip and p95 trip are unchanged, and the crossing rows are added after them.
- **No new message type.** `crossings` is an optional field on `comparison`, and `interventions` and `bridgeFlow` are on `frame`.
- **`branchBase` lifecycle.** It is read once in `branch()` and checked against `base[0] === fromTick`. It is cleared on init, on `discard`, and on the `worlds[1]++` path. Compare is clamped to ≥ branchTick (host.ts:363/430), so the "since" values cannot go negative.
- **Wording.** No "because", "caused", "due to", "faster" or "slower" in the added code or UI strings (grep over the added lines).

## Manual Smoke Test (performed; dev server on port 5260, 1280×800, Playwright MCP; screenshots in `.playwright-mcp/m003-*.png`, which git ignores)
1. **PASS, with a defect (MAJOR-1).**
   - River City at 20×: the Main Bridge closed at tick 2382 and was run to 37:02.
   - Summary: "✕ Closed Main Bridge · 00:19:51". That is 2382 × 0.5 s = 1191 s, so the time is correct.
   - Timeline ✕ at x = 625. The expected x is 401 + (2382/4564)·428.4 = 624.6.
   - Labels: North, Main and Old Bridge are shown.
   - Pins: ▼27, ▼15, ▼11 on links 68, 32 and 42. These equal `snapshot().linkQueued` and `queuePins()`.
   - The pin "▼ 27" covers "North Bridge" (screenshot m003-smoke1).
2. **PASS.** Crossings per 10 min, read as now / before / change:

   | Bridge | now | before | change |
   |---|---|---|---|
   | North Bridge | 386 | 41 | +345 ▲ |
   | Main Bridge | 0 | 537 | −537 ▼ |
   | Old Bridge | 208 | 81 | +127 ▲ |

   - The hook gives 385.71 / 41, 0 / 537 and 208.31 / 81.
   - The spans are 602 s and 600 s. The before window is 1080→2280 (snapshot ≤ 2382 and ≤ 1182), and the now window is 3240→4444.
   - Total crossings: 659 before, 594 now, which is plausible. The Main Bridge rate is 0 after closing.
   - The caption reads "(observed): now and before the bridge closure at 00:19:51".
3. **PASS.**
   - "Link 68 · 27 queued" → `selectedLink` 68; the panel heading is "Link 68" with "queued 27".
   - The summary hides while the road is open (Gold layout decision, see m2), and Esc brings it back.
4. **PASS.**
   - Reopen gives "○ Reopened Main Bridge · 00:37:02", and the hook has two entries in tick order.
   - The ○ marker is at x = 817 (expected 818.1).
5. **PASS.**
   - Jump to start: the summary is gone, `interventions()` and `crossings()` are [], and the markers stay at 625 and 817.
6. **PASS for the numbers, with a defect (MAJOR-2).** Branch at 15:00 with B (Main Bridge closed in B), compare, run to 22:30.
   - Rows:

     | Bridge | A | B | Δ |
     |---|---|---|---|
     | North Bridge | 32 | 179 | +147 ▲ |
     | Main Bridge | 308 | 32 | −276 ▼ |
     | Old Bridge | 72 | 130 | +58 ▲ |

   - These equal the sums of `comparison().crossings` a = [25,7,248,60,59,13] and b = [134,45,21,11,96,34], with baseTick 1800.
   - Generated is equal, and Incomplete and Unserved are shown.
   - The summary is hidden while comparing. Each half has 3 bridge labels and 3 pins.
   - After leaving compare and discarding the branch, the summary is A's again and fresh: closure 19:51, rates at 2700. Nothing is stale.
- **three_bridges.** "✕ Closed Main Bridge · 00:16:34". Rates: North 271 / 65, Main 0 / 345, South 188 / 20. Labels North, Main and South Bridge, with no overlaps.

## Findings

### MAJOR-1: queue pins cover the bridge names (and district labels); there is no collision handling between the new marks
- **Evidence.** River City, single view, after the closure (tick 4444). These are DOM rects [l, t, r, b]:
  - "North Bridge" [590, 116, 669, 129];
  - "▼ 27" (link 68, the approach to the North Bridge) [582, 121, 617, 137].

  The opaque pin hides the start of the bridge name, which reads "▼27 rth Bridge" (m003-smoke1.png).
- **In compare (m003-smoke6b.png):**
  - on B, "▼ 29" covers "North Bridge" and "▼ 61" covers "Old Bridge";
  - on A, "▼ 28" covers the zone "◫ Market Square" and "▼ 6" covers "◫ Old Exchange".
- **Why this is not incidental.** After a closure the longest queues form on the approaches to the *other* bridges. The approach link's stop-line end is the bridge's end, which is within a few pixels of the bridge label. `hideCutLabels` only hides marks cut by the layer edge, not marks that overlap each other or the zone labels.
- **Impact.** The defect appears reliably on the demo path (fixed demand). It defeats contract M3's "bridges named on the map" exactly when question 3 matters. It also violates the brief's "finished little simulation product" bar.
- **Fix direction.** Resolve collisions among `.bridge-label`, `.queue-pin` and `.zone`. For example:
  - give pins priority and nudge or hide the overlapped label;
  - or place a pin on the side of the link end away from the bridge label.

  Add a regression test in a new file: no shown bridge label overlaps a shown pin, in single and compare views after the closure.

### MAJOR-2: in compare, the timeline shows only A's interventions, unlabelled, while the scenario control says B is the viewed side
- **Evidence.** In compare at 22:30, `snapshot().scenario` = "B" and `.timeline-intervention` = ["Closed Main Bridge at 00:19:51"]. That is A's own closure at tick 2382, the only one in A's log. B's closure (tick 1800) has no marker.
- **Outside compare (single view on B):** the markers are B's (["Closed Main Bridge at 00:15:00"]).
- **Cause.** In compare, `frame` is A's frame, and `allEntries` is built from it (App.tsx `summarizeInterventions(frame.interventions, Infinity, …)`).
- **Impact.** Entering compare silently swaps the markers to the other scenario. In the demo's usual set-up (B = closed, A = original, which also closed later), a single unlabelled "✕ Closed Main Bridge" sits on the shared A/B timeline. A user will read it as B's closure, at the wrong time. This misleads on question 4 (A vs B at the same sim time).
- **Fix direction.** In compare:
  - show both sides' markers, each named with its scenario ("A: Closed Main Bridge at …", "B: …"), with a side marker that is not only colour (for example a letter);
  - or show only the viewed side's markers, named.

  Add a test in a new file.

### Minor
- **m1 (a11y): the markers sit inside the `role="slider"` element.** ARIA slider children are presentational, so the markers' `role="img"` names may not reach assistive tech, although axe passes. Suggestion: move them to a sibling layer over the track, or add the latest intervention to the slider's `aria-valuetext` / `aria-describedby`.
- **m2 (layout decision, acceptable): the summary is hidden while a road or vehicle detail is open.** This deviates from the ward text "in `.side` above the selection". Clicking a summary queue entry therefore makes the list you clicked disappear (Esc restores it). Test 8 still holds, and it avoids pushing the selection panel down over the map, so it is acceptable. But it must be recorded in the ward spec (Outputs/UI) and `docs/demo.md`, which currently say nothing about it.
- **m3 (layout decision, acceptable): the reserved 100 px guide band.** It keeps the summary from jumping when the guide is shown or hidden, which is reasonable. But with the guide hidden it leaves an empty 100 px band above the summary. It is cosmetic. Consider collapsing it once the guide has been hidden by the user, since that is not a transient change.
- **m4 (docs): `docs/architecture.md` does not name the getters, although the ward's Must DO asks it to.** It only says "Frames also carry the command log and bridge exits". It should name `Timeline::exits_at`, `Sim.command_log()`, `Sim.exits_at()` and the `bridgeFlow` / `crossings` layout or a pointer to protocol.ts.
  - `docs/demo.md` says "the three longest queues". The UI shows *up to* three, and only with ≥ 3 queued.
  - `docs/performance.md` reports a micro-benchmark rather than the ward's "encode ms before and after". My rerun agrees with its number, so this is acceptable.
- **m5 (wording): `docs/demo.md` says "…since the branch, in A and B: where the traffic went instead."** This is in the A/B section, where comparison is legitimate, but "went instead" reads as a causal account. Suggestion: "how each bridge was used in A and in B".
- **m6 (cosmetic): row headers wrap in the summary's crossing table at 1280 px.** "North / Bridge" and "Main / Bridge" each take two lines (m003-smoke1.png). Use `white-space: nowrap` on `th[scope=row]`.

### Nits (no action required)
- `markRef(key, x, y)` returns a new callback each render. React therefore detaches and reattaches every mark on each App render, which is harmless but churns the `marks` map. A stable ref per key would avoid it.
- When the position equals the closure tick, "now" and "before" cover the same window, so the change is 0. This is consistent with the spec.

## Git state
After the review, `git status --short` lists only the pre-existing `web/zz-alt-port*.config.ts` and this file. The dev server on port 5260 and the browser were stopped.
