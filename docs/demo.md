# Demo: close a bridge, rewind, branch, compare

This takes about five minutes. It assumes the app is running (`pnpm -C web build:wasm`, then `pnpm -C web dev`; see the README) and is open in a desktop browser at least 1,280 px wide.

The app has the same walkthrough built in: the **demo guide** at the top right ticks off each step when you actually do it (hide it with ×, show it again with the **?** (Guide) button).

## 1. A living city
When the page opens, River City has already run for 15 sim minutes, and traffic flows over all three bridges.
- The **Main Bridge** is the wide crossing in the middle.
- The **North Bridge** is the top crossing.
- The **Old Bridge** is the narrow, slow bottom crossing.

The metrics strip at the bottom left, above the timeline, shows the live values computed by the sim: **sim time** (labelled as such, in a monospaced clock), active, completed, mean trip time, **queued** and **unserved**. Hover the ⓘ for definitions.

- **Speed:** the app starts at **20×**. Change it in the *Speed* box or with **+** / **−** (1×, 5×, 20×, 60×). If the engine cannot keep up, the control panel says *"⚠ Behind"* instead of silently dropping steps.
- **Zoom:** use the mouse wheel. Zoomed out, the roads and congestion dominate (congested roads draw wider and lighter). The arterials and the three bridges are drawn wider and lighter than local streets, so the main routes read even at the widest zoom. Zoomed in, individual cars become readable. Moving cars are long and slim; queued cars are squares with a brake band, and from about 1.5 px/m every car has a dark outline, so the cars in a queue can be counted one by one. The legend at the bottom explains each symbol by shape and pattern, never by colour alone.
- **Districts:** zoom to 1 px/m or closer and each district shows its own roof mark, in a darker shade than any road (it also reads in grayscale):
  - **residential** (Westbrook and the other housing areas): a ridge line along each house;
  - **workplace** (Market, Downtown, Tech, Harbor): an inner courtyard outline;
  - **hospital** (St. Mary's): a cross;
  - **waterfront** (the blocks next to the river): two shed lines, and a paved quay with bollards along the water.

  The zone pads differ by shape too: a disc for housing, a square for workplaces, a cross for the hospital.

## 2. Close the main bridge
Click **Close the main bridge** in the control panel, or press **B**.
- The bridge gets an unmistakable marker: a hatch, white barriers at both ends and a white ring at its middle.
- Cars already on it drive off. Cars heading for it reroute at their next junction.

### Watch the queues
Let it run for 5–15 sim minutes (about 15–45 s of wall time at 20×) and watch:
- queues building on the approaches to the **Old Bridge** and the **North Bridge**, with square cars stacking back up the streets (spillback);
- **queued** in the metrics strip. It fluctuates while drivers reroute, and over those minutes it typically ends up well above where it was; the queues on the bridge approaches are the clearer signal.

Click a road to see its lanes, vehicles, queued count and state in the *Selected road* panel. Click a car (zoomed in) to follow it and see its route: four white corner brackets mark the car (a different shape from the closure ring), its remaining route is a white dashed line with a dark casing that reads even across a congested road, and a white square marks where the trip ends.

### What the closure changed
The **Intervention** panel (beside the map) answers it from the simulation's own data:
- **Which road, and when:** "✕ Closed Main Bridge · 00:16:12", from the command log. The timeline shows the same ✕ at that time; a reopening is a ○.
- **Which crossings are used:** crossings per bridge per 10 sim min, *now* and in the 10 min *before* the bridge closure, with the change. The three bridges are named on the map. This is an observation of one scenario over time, not proof of cause: for that, compare with a branch (step 5).
- **Where traffic queues now:** up to three of the longest queues (3 or more cars), as ▼ pins with their count at the queue heads on the map and as buttons that select the road. While a road or a car is selected, its panel takes the place of the summary; press **Esc** to get the summary back.

## 3. Pause and rewind
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

Press **Space** and let B run past the time where you paused A (press **+** for 60×: B catches up sooner). The *A: original* and *B: branch from …* buttons switch which scenario you view; each keeps its own position.

## 5. Compare side by side
Click **Compare side by side**.
- The two scenarios appear next to each other at the **same sim time**, with one shared camera: pan or zoom one and the other follows.
- The labels in the bottom corners say which side is which. A's Main Bridge is hatched; B's North Bridge is hatched.
- Press **Space**: both advance in lockstep.

The **Comparison** panel counts the same trips in both: those generated since the branch.
- **Generated** is equal in A and B. Demand is identical; only the outcome differs.
- **Completed**, **Incomplete** (still on their way or waiting), the removals, and the **mean / p95 travel time** show the consequences.
- The difference column gives the sign and an arrow ▲/▼.
- The timeline marks each scenario's own interventions after the branch: "✕B" is a closure in B, "✕A" one in A (the names say so too).
- **Crossings · North / Main / Old Bridge** count the vehicles over each bridge since the branch, in A and B, for the same trips and time window.
- Incomplete trips are always listed, so a scenario does not look better just because its slowest trips have not arrived yet.

While comparing, interventions are disabled (comparing is for observing). Click **Compare side by side** again to return to the single view. **Discard branch** removes B.

## Also try
- Press **D** for the diagnostics panel: sim tick cost and render frame time, reported separately.
- Open `?city=three_bridges` for the small test city, or `?demand=3` for a stress load. A badge marks it as a measurement, not a forecast.
