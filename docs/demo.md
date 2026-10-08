# Demo: close a bridge, rewind, branch, compare

This takes about five minutes. It assumes the app is running (`pnpm -C web build:wasm`, then `pnpm -C web dev`; see the README) and is open in a desktop browser at least 1,280 px wide.

## 1. A living city
When the page opens, River City has already run for 15 sim minutes, and traffic flows over all three bridges.
- The **Main Bridge** is the wide crossing in the middle.
- The **North Bridge** is the top crossing.
- The **Old Bridge** is the narrow, slow bottom crossing.

The metrics strip at the bottom left, above the timeline, shows the live values computed by the sim: **sim time** (labelled as such, in a monospaced clock), active, completed, mean trip time, **queued** and **unserved**. Hover the ⓘ for definitions.

- **Speed:** the app starts at **20×**. Change it in the *Speed* box or with **+** / **−** (1×, 5×, 20×, 60×). If the engine cannot keep up, the control panel says *"⚠ Behind"* instead of silently dropping steps.
- **Zoom:** use the mouse wheel. Zoomed out, the roads and congestion dominate (congested roads draw wider and lighter). Zoomed in, individual cars become readable. Moving cars are long and slim; queued cars are squares with a brake band. The legend at the bottom explains each symbol by shape and pattern, never by colour alone.

## 2. Close the main bridge
Click **Close the main bridge** in the control panel, or press **B**.
- The bridge gets an unmistakable marker: a hatch and white barriers at both ends.
- Cars already on it drive off. Cars heading for it reroute at their next junction.

Let it run for 5–15 sim minutes (about 15–45 s of wall time at 20×) and watch:
- queues building on the approaches to the **Old Bridge** and the **North Bridge**, with square cars stacking back up the streets (spillback);
- **queued** in the metrics strip. It fluctuates while drivers reroute, and over those minutes it typically ends up well above where it was; the queues on the bridge approaches are the clearer signal.

Click a road to see its lanes, vehicles, queued count and state in the *Selected road* panel. Click a car (zoomed in) to follow it and see its route.

## 3. Rewind
Press **Space** to pause. The **timeline** at the bottom shows the replay window: the retained sim time and its memory against the budget.
- Drag the handle or click on the track to scrub back to **before the closure**. You can also press **−1 min** a few times, or focus the track and press **←**.
- The bridge is open again at that moment: you are looking at the past of the original scenario, *A*.

## 4. Try another decision (this creates a branch)
At that earlier moment, keep the Main Bridge open and close the **North Bridge** instead.
1. Zoom in on the North Bridge (mouse wheel over it) until its two directions are drawn as separate lanes, then click one of them. The *Selected road* panel opens.
2. Click **Close link**.
3. Because you are in A's past, this does not rewrite A. It creates **branch B** from that tick. The *Scenarios* panel appears ("Viewing B: branch"), and A is kept exactly as it was.
4. Click the other direction of the North Bridge and **Close link** again, so both directions are closed in B.

(Pressing **B** in A's past also creates a branch: then B closes the Main Bridge from that earlier moment instead.)

Press **Space** and let B run past the time where you paused A. The *A: original* and *B: branch from …* buttons switch which scenario you view; each keeps its own position.

## 5. Compare side by side
Click **Compare side by side**.
- The two scenarios appear next to each other at the **same sim time**, with one shared camera: pan or zoom one and the other follows.
- The labels in the bottom corners say which side is which. A's Main Bridge is hatched; B's North Bridge is hatched.
- Press **Space**: both advance in lockstep.

The **Comparison** panel counts the same trips in both: those generated since the branch.
- **Generated** is equal in A and B. Demand is identical; only the outcome differs.
- **Completed**, **Incomplete** (still on their way or waiting), the removals, and the **mean / p95 travel time** show the consequences.
- The difference column gives the sign and an arrow ▲/▼.
- Incomplete trips are always listed, so a scenario does not look better just because its slowest trips have not arrived yet.

While comparing, interventions are disabled (comparing is for observing). Click **Compare side by side** again to return to the single view. **Discard branch** removes B.

## Also try
- Press **D** for the diagnostics panel: sim tick cost and render frame time, reported separately.
- Open `?city=three_bridges` for the small test city, or `?demand=3` for a stress load. A badge marks it as a measurement, not a forecast.
