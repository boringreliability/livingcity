# Queued task (user, 2026-10-11): motion, paused work, consequences, character

Given by the user on 2026-10-11, to start **after epic `fonts` is finished**. The user also asked that the rule for unlocking frozen tests be recorded in `CLAUDE.md` (done: § "Frozen tests and contracts: unlocking (supersession)"). The instruction follows verbatim.

---

Improve the existing Living City implementation, focusing on convincing vehicle motion, efficient paused behavior, and understandable consequences of road closures.

This is an implementation task. Inspect the current repository, make the changes, run meaningful tests, and verify the result in the browser. Stay in 2D.

Read the repository instructions and WDD context, plus:
- `docs/architecture.md`
- `docs/known-issues.md`
- `docs/performance.md`

Treat those documents as starting points. Verify their findings against the current code.

## Explicit authorization to revise frozen contracts

I authorize you to reopen or supersede existing WDD contracts and frozen tests where they preserve the unwanted behaviors described below.

In particular, “a frozen test requires this behavior” is not a valid reason to retain:
- Vehicles drawn inside a junction while waiting at its stop line.
- Vehicles visibly jumping or stepping backwards because of rendering.
- Unnecessary full-frame production while paused.
- Buffer-pool behavior that prevents sensible bounded reuse.

Preserve the intent of valid requirements. Replace implementation-specific assertions with tests of the desired observable behavior.

Record which contracts you supersede and why. Do not simply delete failing tests or weaken assertions to obtain a passing suite. This authorization is scoped to these improvements; preserve simulation determinism, replay correctness, branch independence, identical external demand, and meaningful comparison metrics.

## 1. Make vehicle movement convincing

Inspect the existing motion calculations, junction curves, frame protocol, and vehicle identity handling.

Fix these documented issues:
- Cars pause at the end of a junction curve and then jump forward.
- Cars waiting at stop lines are rendered at the next link’s entrance, causing overlap inside intersections.
- Small backwards movements occur during steady playback.
- Speed changes or delayed worker frames can create discontinuities.

Establish a clear separation between:
- Authoritative simulation position.
- The vehicle’s visual path through a junction.
- Presentation timing.

A vehicle held at a stop line must remain visually before the junction. It should traverse the junction only once the simulation permits that transition.

Prefer interpolation between authoritative states, using stable trip or vehicle identity across frames. Inspect whether identity already exists; extend the compact frame protocol if necessary. Do not match vehicles by array position when records can be reordered or reused.

A small, explicit presentation delay is acceptable if it produces coherent motion. Use the same presentation time for both sides in comparison mode.

Handle:
- Spawn and completion.
- Link transitions and sharp turns.
- Queueing and release.
- Closure and reopening.
- Pause and resume.
- Speed changes.
- Seek, branch, reset, and scenario switches.
- Delayed or missing frames.

Reset interpolation history when the timeline or scenario changes. Do not interpolate across a seek or between unrelated worlds.

Keep extrapolation, if used, tightly bounded. Never visually drive through a closure or stationary queue merely to keep animation moving.

Do not broadly redesign traffic physics to conceal a rendering problem. If correct junction movement requires a simulation-model change, identify it explicitly and scope it separately.

## 2. Stop unnecessary work while paused

Replace the approximately 16 ms full-frame production loop during pause with event-driven updates or a justified lightweight heartbeat.

While paused:
- Do not step the simulation.
- Do not continuously rebuild and transfer identical vehicle buffers.
- Keep camera movement, selection, hover, and controls responsive.
- Publish updated state when an action actually requires it.
- Preserve the defined timing of commands issued while paused.

Review buffer ownership and reuse:
- Keep pools bounded.
- Reuse suitable buffers where practical.
- Handle returned buffers safely after leaving comparison, replacing a branch, or resetting.
- Do not reuse detached buffers or allow cross-scenario confusion.

Measure paused frame production and transfer volume before and after. Avoid adding shared memory or threads without evidence that they are needed.

## 3. Explain the consequences of an intervention

Improve the existing guide, timeline, selection, and comparison UI so a user can understand what closing a bridge changed.

Build on existing controls rather than adding another large dashboard.

Aim to make these questions easy to answer:
- Which road was closed, and when?
- Where is traffic queueing now?
- Which alternative crossings are being used?
- How do the two scenarios differ at the same simulation time?

Use actual simulation data. Never invent causal explanations or scripted outcomes.

Distinguish observation from comparison:
- In a single scenario, describe measured changes over time without presenting them as proof of causation.
- In A/B mode, compare matching cohorts and time windows with identical demand.

Preserve visibility of incomplete and unserved trips. Do not declare one scenario “faster” simply because its slowest trips have not finished.

Prefer a compact intervention summary and clear map highlighting. Reuse current vehicle inspection and route information where available.

All feedback must remain colorblind-safe: combine color with labels, shapes, line styles, or icons.

## 4. Give the existing 2D city more character

After the functional fixes, make a restrained visual pass:
- Improve the distinction between residential, commercial, hospital, and waterfront areas.
- Keep bridges and major routes recognizable at wide zoom.
- Keep individual vehicles and queues readable at close zoom.
- Make closures and selected routes unmistakable.
- Keep decorative detail subordinate to traffic readability.

Use the current rendering architecture. No 3D migration, new asset pipeline, city editor, or unrelated features.

## Verification

Add or revise focused tests for the actual failure modes:
- A held vehicle remains behind its stop line.
- A permitted junction transition is visually continuous.
- Forward playback does not introduce spurious backwards motion.
- Vehicle record reuse does not connect unrelated trips.
- Seek and scenario changes clear stale motion history.
- Paused simulation stops repeated full-frame production.
- Paused interactions still update correctly.
- Buffer reuse remains bounded and safe across scenario lifecycle changes.

Preserve and run the existing relevant checks for deterministic simulation, replay, branch independence, and identical demand.

Inspect the application in a real browser at 1× and 20×, including:
1. Traffic crossing a junction.
2. Queue formation and release.
3. Closing and reopening the main bridge.
4. Pause, inspect, and resume.
5. Rewind and branch.
6. Side-by-side comparison.

Use screenshots for layout and a short recording or successive observed frames for motion verification. Screenshots alone cannot establish smooth movement.

If the available browser lacks hardware graphics support, report that limitation and distinguish software-renderer measurements from hardware performance.

Measure relevant before/after results under comparable conditions:
- Simulation tick cost.
- Rendering frame intervals.
- Frame payload size and transfer rate.
- Paused frame production.
- Any added presentation latency.

Do not claim performance improvements without measurements.

## Delivery

Update the WDD state and relevant documentation so resolved issues are no longer listed as unresolved.

Report:
- What changed and why.
- Which frozen contracts/tests were superseded.
- Tests and browser flows actually verified.
- Performance and presentation-latency trade-offs.
- Remaining limitations.

Complete the implementation and validation. Do not deploy unless separately authorized.

The goal is a city whose traffic is convincing to watch, whose interventions are understandable, and whose engine stops doing unnecessary work when paused.
