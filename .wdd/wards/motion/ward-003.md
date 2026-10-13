---
ward: 3
revision: null
name: "Consequences of an intervention"
epic: "motion"
status: "red"
dependencies: ["motion-002"]
layer: "fullstack"
estimated_tests: 10
created: "2026-10-11"
completed: null
---
# Ward motion-003: Consequences of an intervention

## Scope
This ward is contract **M3** of epic `motion` and §3 of the user's task. It makes four questions answerable from real sim data, on the existing UI and without a dashboard:
1. **Which road was closed, and when?** An intervention summary built from the command log, and markers on the timeline.
2. **Where is traffic queueing now?** The most-queued links, marked on the map with a pin, a count and a glyph, and listed in the summary.
3. **Which crossings are used?** The bridges named on the map. Crossings per bridge, per 10 sim min: now, and in the 10 min before the latest closure. This is an observation in one scenario, not a causal claim.
4. **How do A and B differ at the same sim time?** The existing cohort comparison, plus crossings per bridge since the branch, for A, B and Δ.

There is **no new `World` state**: only read-only getters. So `state_hash` and the golden hashes are unchanged. The facts are in `.wdd/memory/investigation-2026-10-12.md` § Consequences.

## Inputs
- `sim-core`:
  - `World::command_log()` (`Command { tick, kind: CloseLink | OpenLink }`, kept across seeks, truncated by a schedule in the past; a branch keeps commands before its tick).
  - `World::exit_count` (cumulative exits per link, snapshotted).
  - `Timeline` snapshots (each holds a `World`, every 120 ticks).
- `sim-wasm` `Sim`: `window_metrics`, `landmarks_json`.
- `web/src/sim/{host,protocol}.ts`: `postFrame`, `postComparison`, `ComparisonMessage`, `Landmarks`.
- UI:
  - `TimelineBar` (with its `frac` placement);
  - `ComparisonPanel` (rows of `[name, title, a, b, Δ]`, Δ as a sign plus ▲/▼);
  - `SelectionPanel` (selection by link id);
  - the DOM label layers `.labels` / `.labels-b` (`placeLabel`, `hideCutLabels`);
  - `App.pushLinkState`.
- Render-side city data: `render/cities/riverCity.ts`.

## Outputs
- **`sim-core`:** `Timeline::exits_at(tick, links) -> Option<(u64, Vec<u64>)>`.
  - If `tick ≥ position`, it returns the current world's exit counts, with base = position.
  - Otherwise it returns the counts of the newest retained snapshot with snapshot tick ≤ `tick`, with base = that snapshot's tick.
  - It returns `None` when no retained snapshot is at or before `tick`.
  - It is read-only.
- **`sim-wasm` `Sim`:**
  - `command_log() -> Vec<f64>`: `[tick, kind (0 = close, 1 = open), link]` triples in log order.
  - `exits_at(tick: f64, links: &[u32]) -> Vec<f64>`: `[baseTick, count per link…]`, with baseTick = NaN when there is none.
- **Protocol:**
  - `FrameMessage.interventions: Float64Array`: the viewed side's command log, as triples.
  - `FrameMessage.bridgeFlow: Float64Array`: the layout below, or empty when there are no landmarks.
  - `ComparisonMessage.crossings: { a: Float64Array; b: Float64Array; baseTick: number }`: per bridge link (landmark order), exits since the branch.
  - No new message type: the set ready/frame/comparison/error is frozen.
- **`bridgeFlow` layout.** `L` is the landmark links in order: north we, ew, central we, ew, south we, ew. Then:
  - `[posTick, nowBase, …L exits at position, …L exits at nowBase]`;
  - followed by `[closeTick, beforeBase, …L exits at closeTick, …L exits at beforeBase]`, where:
    - `nowBase` = the base of `exits_at(position − 1200)`;
    - `closeTick` = the tick of the latest close command at or before the position;
    - `beforeBase` = the base of `exits_at(closeTick − 1200)`.

  If there is no such close command, the second block is `[NaN, NaN, NaN…]`.
- **`web/src/ui/consequences.ts`** (pure):
  - `summarizeInterventions(log, positionTick, names)` returns entries `{ tick, kind, label, links }`. Both directions of one bridge at the same tick and kind are one entry, labelled with the bridge's name. Another link is labelled "Link N". Commands after the position are left out.
  - `crossingRates(bridgeFlow, names)` returns, per bridge, `{ name, now, before, nowSpanS, beforeSpanS }`. The rates are crossings per 10 sim min, normalised from the measured span. They are null when a base is missing or the span is 0.
  - `topQueues(linkQueued, n = 3, min = 3)` returns the n links with the most queued vehicles (≥ min), ties to the lower id.
- **Display names (render side, `riverCity.ts`):**
  - `north_bridge` → "North Bridge";
  - `central_bridge` → "Main Bridge";
  - `south_bridge` → "Old Bridge".

  Other cities get "Bridge 1/2/3" in landmark order.
- **UI:**
  - **Intervention summary.** `section.panel.consequences` (`aria-label="Intervention"`), in `.side` above the selection, single view only. It is shown once the viewed scenario has an intervention at or before the position. It holds:
    - one line per intervention, e.g. "✕ Closed Main Bridge · 00:12:30" or "○ Reopened Main Bridge · 00:40:00";
    - "Crossings per 10 min (observed)": per bridge, *now* and *before the closure*, as numbers, with the change shown as ▲/▼ and a number;
    - "Longest queues now": up to 3 "Link N · q queued" buttons that select the link.

    The wording describes observations only: "observed", "since", "before". It never says "because", "caused", "due to" or "faster".
  - **Timeline.** One marker per intervention in the window, inside `.timeline-track`: ✕ for close, ○ for open. Each has an accessible name such as "Closed Main Bridge at 00:12:30". A glyph, not colour, carries the kind.
  - **Map.**
    - A bridge name label at each bridge's midpoint (class `bridge-label`, not `zone`; camera-placed; hidden when cut), on each shown side.
    - A queue pin at the stop-line end of each top-queued link: class `queue-pin`, "▼ q", on each shown side from that side's frame.
  - **Comparison.** Rows "Crossings · North Bridge", "Crossings · Main Bridge" and "Crossings · Old Bridge". Each has A, B (exits since the branch, both directions) and Δ = B − A in the existing count format. The existing rows, header and formats are unchanged.
- **Hooks:**
  - `interventions()` → the summary entries;
  - `crossings()` → `crossingRates`;
  - `queuePins()` → `[{ link, queued, page }]`;
  - `bridgeLabels()` → `[{ name, page, shown }]`.

## Must NOT
- Add `World` state, or change `state_hash`, the golden hashes, determinism, the 16 B record or the demand.
- Make causal claims, or call a scenario "faster"; incomplete and unserved trips stay as they are.
- Add a new worker-to-UI message type.
- Break the frozen layout, label, timeline, guide or compare tests.
- Use colour as the only carrier of meaning.

## Must DO
- Cover both cities (three_bridges has landmarks too).
- Keep it cheap. The host reads `exits_at` for 6 links, up to 4 times per frame. The cost is measured (encode ms before and after).
- Update the docs: `docs/demo.md` (what the summary shows) and `docs/architecture.md` (the getters).

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `exits_at_reads_snapshots` (Rust, `crates/sim-core/tests/motion_003_consequences.rs`) | River City with a Main Bridge closure at tick 600, run to 3,000 while a twin world records `link_exit_count` for every link at every tick:<br>• for every snapshot tick T in the window and every link, `exits_at(T)` equals the twin's count at T, with base T;<br>• `exits_at(T + 50)` uses the snapshot ≤ T + 50;<br>• `exits_at(t ≥ position)` returns the current counts, with base = position;<br>• `exits_at` before the window returns `None`;<br>• `state_hash` is identical before and after many calls;<br>• after a seek, the answers equal those of the uninterrupted run;<br>• in a branch at tick b, `exits_at(b)` on B has base b and equals A's counts at b. |
| 2 | `command_log_getter` (vitest, wasm) | A close and a reopen on the Main Bridge (both directions) and one other link: `Sim.command_log()` gives the triples in log order. A branch with `then` gives B's log (commands before b, plus `then` at b). A schedule in the past truncates as `World` does. `state_hash` is unchanged by the getter calls. |
| 3 | `summarize_interventions` (vitest, pure) | Grouping of both directions → "Main Bridge". A single direction stays a bridge label with its direction ("Main Bridge (W→E)"). A non-bridge link → "Link N". Commands after the position are left out. Close then open → two entries, in tick order. An empty log → []. |
| 4 | `crossing_rates` (vitest, pure) | Hand-built `bridgeFlow`:<br>• rates per 10 min = Δcount · 1200 / spanTicks, summed over both directions;<br>• null when a base is NaN or the span is 0;<br>• "before" is null without a close;<br>• never negative;<br>• names in landmark order. |
| 5 | `top_queues` (vitest, pure) | Top 3 by queued; ≥ min; ties to the lower id; fewer when fewer qualify; [] when none. |
| 6 | `frame_and_comparison_carry_consequences` (vitest, host on wasm) | After a Main Bridge closure and 1,500 ticks:<br>• `frame.interventions` equals `command_log()`;<br>• `frame.bridgeFlow` equals `exits_at` read directly (posTick, nowBase, counts, closeTick = the close command's tick, beforeBase);<br>• after a branch and compare, `comparison.crossings.baseTick` is the branch tick, and `a`/`b` equal each side's `exits_at(position)` − `exits_at(branch)` per link;<br>• the comparison's Generated equals for A and B (identical demand);<br>• a seek back before the closure gives a second `bridgeFlow` block of NaN and an `interventions` that still lists the later command. The summary leaves it out, because it is after the position. |
| 7 | `intervention_summary_and_map_markers` (e2e) | River City at 20×: close the Main Bridge, run ≥ 15 sim min, pause.<br>• The summary shows "Closed Main Bridge" with the sim time of the close command (from the hook).<br>• The timeline has a marker named "Closed Main Bridge at hh:mm:ss" at that tick's fraction of the track (±2 px).<br>• The three bridge labels are visible on the map at their bridge midpoints (±6 px).<br>• The queue pins equal `topQueues(frame.linkQueued)`: their numbers equal the frame's queued counts, at the stop-line end of their links (±8 px).<br>• The crossing numbers equal `crossings()`.<br>• No text in the summary matches `/because\|caused\|due to\|faster\|slower/i`.<br>• Every marker carries a glyph (✕, ○ or ▼) in its text. |
| 8 | `summary_queue_entry_selects_the_link` (e2e) | Clicking "Link N · q queued" selects link N: the selection panel heading is "Link N", and the map halo is on that link (the hook `snapshot().selectedLink`). |
| 9 | `compare_shows_crossings_since_branch` (e2e) | Branch before the closure with the closure in B, then compare at 20×.<br>• The rows "Crossings · North Bridge / Main Bridge / Old Bridge" are visible.<br>• Their A and B cells equal the hook's comparison values summed per bridge, and Δ = B − A in the count format.<br>• The rows Generated, Completed, Incomplete, Unserved, Mean trip and p95 trip remain.<br>• The panel has no "faster" or "slower".<br>• Queue pins and bridge labels show on both halves. |
| 10 | `consequences_layout_and_a11y` (e2e) | At 1280×800, 900×800 and 768×800, with a closure and a summary shown:<br>• no `section.panel` overlaps another, and nothing is outside the viewport; no horizontal scroll;<br>• every shown `bridge-label` and `queue-pin` is fully inside its layer, and a hidden one does not fit;<br>• axe reports no serious or critical violations. |
| 10b | `intervention_marker_clears_the_branch_marker` (e2e) | In A's past, B branches with the Main Bridge closed (the **B** key), so B's closure and the branch are at the same tick: the marker "Closed Main Bridge at …" is visible and does not overlap `.timeline-branch`. |

## Manual Smoke Test
### Setup
`pnpm -C web build:wasm && pnpm -C web dev`
### Steps
1. Close the Main Bridge at 20× and run 15 sim min. The summary says when it was closed. The timeline shows ✕ at that time. The three bridges are named on the map. Queue pins sit at the heads of the longest queues.
2. Read the crossings: per bridge, now vs before the closure, worded as an observation.
3. Click a queue entry: the road is selected and its panel shows the same queue count.
4. Reopen the bridge: a second line appears in the summary with ○, and a ○ marker on the timeline.
5. Rewind to before the closure: the closure leaves the summary, and its marker stays where it was in time.
6. Branch before the closure with the closure in B, then compare. The crossing rows show A, B and Δ since the branch. Incomplete and unserved trips are still shown.
### Pass criteria
- [ ] Every question in the Scope can be answered from what is shown, with numbers that match the hooks.
- [ ] No causal wording; colourblind-safe markers (glyph + text).
- [ ] Layout unchanged elsewhere; all suites green.
