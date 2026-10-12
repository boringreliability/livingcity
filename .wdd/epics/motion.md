---
epic: "motion"
name: "Convincing motion, quiet pause, understandable consequences"
status: "active"
created: "2026-10-12"
---
# Epic: Convincing motion, quiet pause, understandable consequences

## Goal
The goal is a city whose traffic is convincing to watch, whose interventions are understandable, and whose engine stops doing unnecessary work while paused. Everything stays in 2D. This epic is the user's task of 2026-10-11 (`.wdd/memory/task-2026-10-11-motion-paused-consequences.md`, quoted verbatim). Its measured starting point is `.wdd/memory/investigation-2026-10-12.md`.

## Authorization to supersede frozen tests
The user explicitly authorized reopening or superseding frozen contracts and tests that preserve these unwanted behaviours:
- cars drawn inside a junction while waiting at its stop line;
- visible jumps or backward steps caused by rendering;
- unnecessary full-frame production while paused;
- buffer-pool rules that prevent sensible bounded reuse.

The procedure is in CLAUDE.md § "Frozen tests and contracts: unlocking":
- Supersede whole tests and keep their valid intent.
- Every replacement goes through a Red gate.
- Log every supersession in `.wdd/memory/supersessions.md`.

**Never superseded:** determinism, replay correctness (restore ≡ uninterrupted run, the golden `state_hash` values in `polish_005_perf.rs`), branch independence, identical external demand, and meaningful comparison metrics (incomplete and unserved trips stay visible).

## Contract
**M1, quiet pause (ward 001).**
- **No idle frames.** While paused, the host neither steps nor re-encodes and transfers identical frames. It posts a frame when something changed: every handled message (a no-op included), a seek, branch, view switch or compare change, or an inspection result. It also sends one settling frame once the achieved-speed window has emptied, so the shown speed reads 0. The clock's report window stays bounded without posts.
- **Bounded pools.** Each side's pool holds at most a small fixed number of buffers (LIFO, exact size). A used buffer leaves the pool. A detached or zero-length buffer is never reused. Buffers returned for a world that has since been replaced (re-init, branch replaced, B discarded) are dropped, never reused for the new world. Frames in flight are bounded, so a stalled UI does not queue frames without limit.
- **Measured before and after:** paused frames per second, bytes per second and `encode_frame` calls, in a host test and in the browser.

**M2, convincing motion (ward 002).**
- **Identity.** The frame carries a parallel `tripIds: Uint32Array`, one per record. The 16-byte record stays unchanged.
- **Interpolation.** The renderer interpolates between authoritative frames, keyed by trip id, at an explicit presentation time: the newest frame's sim time minus a small delay of about one frame or tick interval. A and B share one presentation clock.
- **Separation of concerns.** Three things are kept apart:
  - authoritative position: link, s and lane from the sim;
  - visual path: a stop line before the junction, and a junction curve used only while a car moves from link A to its next link B between two frames;
  - presentation timing: the delay and the clock.
- **Held cars.** A car held at the end of a link is drawn behind its visual stop line, never inside the junction.
- **No artefacts.** Steady forward playback shows no backward steps. A speed change, a delayed frame or a missing frame cause no jump, and extrapolation is not used at all, or tightly bounded. Nothing is drawn through a closure or a stationary queue.
- **History resets.** Spawn and completion appear and disappear in place. Motion history is cleared on seek, branch, scenario switch, compare change, re-init and restart. There is never interpolation across a seek or between unrelated worlds.
- **One rule everywhere.** Picking, Follow, the tracked ring and the record-based test hooks use the same presentation position as the GPU.
- **Measured:** the added presentation latency.

**M3, consequences (ward 003).** The goal is that a user can answer these questions from real sim data, building on the existing UI and not adding a dashboard:
- Which road was closed, and when? From the command log: a timeline marker plus a compact intervention summary.
- Where is traffic queueing now? The links with the most queued vehicles, highlighted on the map with a pattern and a label.
- Which crossings are being used? Crossings per bridge from `exit_count` differences over a window, with the bridges named on the map.
- How do A and B differ at the same sim time? The existing cohort comparison, plus crossings per bridge in B − A since the branch.

Two kinds of statement are kept apart:
- **Single view:** "observed since <time>" (measured changes over time), never a causal claim.
- **A/B:** matching cohorts and windows, with identical demand.

Incomplete and unserved trips stay visible, and nothing is called "faster" while trips are unfinished. All of this is colourblind-safe, combining labels, shapes, line styles and icons. The new data comes from read-only wasm getters (`command_log`, `link_exits`). There is **no new `World` state**, so the hashes are unchanged.

**M4, character (ward 004).** A restrained visual pass on the current renderer:
- distinguishable residential, commercial (workplace), hospital and waterfront areas;
- bridges and major routes recognizable at wide zoom;
- vehicles and queues readable at close zoom;
- closures and selected routes unmistakable;
- decor subordinate to traffic.

It must not break any frozen visual test that pins valid behaviour.

**M5, integration (ward 005).**
- **Browser flows.** Every flow is checked in a real browser at 1× and 20×:
  - traffic crossing a junction;
  - queue formation and release;
  - closing and reopening the main bridge;
  - pause, inspect and resume;
  - rewind and branch;
  - side-by-side comparison.

  Screenshots cover layout, and successive observed frames or a short recording cover motion.
- **Measured before and after:** tick cost, render frame intervals, frame payload and transfer rate, paused frame production, and the presentation latency. SwiftShader measurements are kept apart from hardware ones.
- **Documentation.** The docs and WDD state are updated so that resolved issues are no longer listed as unresolved, and the supersession log is complete.
- **No deploy** unless separately authorized.

## Wards
| Ward | Content |
|---|---|
| motion-001 | complete |
| motion-002 | complete |
| motion-003 | M3: consequences of an intervention |
| motion-004 | M4: city character |
| motion-005 | M5: integration (browser flows, measurements, docs) |

## Completion criteria
- All suites are green locally and on GitHub Actions.
- The determinism, replay, branch and demand tests are unchanged and green.
- Every supersession is logged and approved at Red.
- The human epic gate.
