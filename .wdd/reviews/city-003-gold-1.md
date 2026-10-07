# city-003 Gold review, round 1

**Verdict: REJECTED** (2 MAJOR, 0 BLOCKER)

Reviewer: fresh adversarial Gold subagent. Implementation = f75526d, compared with the Red snapshot 8522c56.

## Test freeze
`git diff 8522c56 -- crates/sim-core/tests web/tests web/e2e` is **empty**, so no approved test changed. The only non-source change is ward-003.md (status → gold, plus the "Gold refinement" note).

## Commands run
| Command | Result |
|---|---|
| `cargo test --workspace --release` | all green (city_003_inspect 5/5; city_001 28, city_002 12, core_001 20, core_002 24, core_003 36, core_004 5) |
| `cargo test -p sim-core` (debug) | all green (city_002: 4 passed, 8 ignored, which are the pre-existing release-only tests) |
| `cargo clippy -p sim-core -p sim-wasm --all-targets -- -D warnings` | clean |
| `pnpm -C web build:wasm` | OK |
| `pnpm -C web typecheck` | OK |
| `pnpm -C web test` | 12 files, 52/52 passed |
| `pnpm -C web build` | OK |
| `pnpm -C web e2e` (port 5190) | 27/27 passed |
| `playwright test city review1 review2 gold5 --repeat-each=3` | 48/48 passed |
| Manual smoke (scripted Playwright on a separate dev port, 5191) | steps 1–3 pass; Follow at 1× **jitters** (M1) |

Smoke scripts (throwaway): `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/g003/{smoke,stale,escape}.mjs`. Screenshots are in `.playwright-mcp/city003-gold-*.png`.

## Smoke test evidence
1. **Car on the Main Bridge.** Paused at zoom 2.24, I clicked trip #777 on link 284.
   - The panel read "Trip #777: Old Town → Tech Park", "▶ driving", 48 km/h, link 284, route changes 0, Follow.
   - Ring box 30×30: 190 near-white px (lum ≥ 235) and 175 dark px.
   - Remaining-route link midpoint: 42 near-white px.
   - Both the ring and the dashed line are clearly visible in the grayscale screenshot (`city003-gold-selected-gray.png`).
2. **Car approaching the closed bridge.** Trip #904 had route [38, **284**, 172, …] and 0 switches. I pressed B, ran at 1×, then paused.
   - Its route became [38, 136, 138, 140, **286**, …], i.e. the North Bridge, and the panel's "route changes" went to **1**.
   - The dashed line moved off the hatched closed bridge (`city003-gold-approach-after.png`).
3. **Old Bridge (link 288).** The panel showed `900 veh/h`, travel time now `52.2 s` and free flow `52.2 s`. After the closure, at 20×, it showed `74.2 s` against `52.2 s` (tick 967).
- **Follow at 1×:** the tracked car stays ≤ 0.6 px from the canvas centre, but the camera motion is not smooth. See M1.

## Findings

### MAJOR

**M1: Follow at 1× jitters: the camera (and every car) stands still, then jumps one whole tick (~15 px) twice a second.** This fails the ward's pass criterion "Follow is smooth (no visible jitter at 1×)".

Evidence: I sampled the camera on every rAF for 3 s at 1× while following (zoom 2.24, a car at 48 km/h).
- Median step 0.13 px/rAF, p95 0.47 px, max **15.3 px**.
- 48 of 125 steps were < 0.05 px.
- The sequence is `0.0 0.0 … 0.0 15.3 0.3 0.1 … 0.2 15.2 0.0 …`: one ~15 px jump per tick (6.6 m × 2.24 px/m).

Cause: `CityRenderer.setFrame` sets `frameAtMs = receivedAtMs` on **every** posted frame. The host posts every 16 ms even when the tick has not changed (at 1× a tick lasts 500 ms). So `dtSim = (now − frameAtMs) × simPerMs` never grows past ~16 ms of sim time, and the extrapolation collapses. The bug came in with core-005, but Follow (`trackedWorldPosition`, which uses the same `frameAtMs`) is new in this ward, and it turns per-car stepping into a whole-map lurch. This is the explicit smoke criterion.

Fix (changes no test; no test touches `setFrame`): give `setFrame` the frame's tick, and reset `frameAtMs` only when the tick changes:
```ts
setFrame(words, count, receivedAtMs, tick) { …; if (tick !== this.frameTick) { this.frameTick = tick; this.frameAtMs = receivedAtMs; } }
```
App passes `f.tick`. Keep the 2 s cap. Re-measure the step series afterwards: it should be roughly uniform (~0.4 px/rAF at 1×, with no ~15 px spikes).
- Side effect to handle together with this fix (see m1): `pickVehicle` will then lag the drawn car by up to one tick of travel.

**M2: A pick that the worker cannot resolve leaves the old vehicle panel, ring, route and Follow frozen, showing stale data as if it were live.** The host resolves an unretained/out-of-range pick to `trackedTrip = null` and from then on sends `tracked: null`. In `App.onFrame`, a `null` `tracked` is ignored (only `gone` and a non-null vehicle are handled). So the UI keeps `trackedRef`/`tracked` from the last detail forever, while the worker has stopped tracking.

Evidence (`stale.mjs`):
- I tracked trip 937 and set the sim running at 20×.
- I blocked the main thread for 600 ms (≈ 37 frames encoded, but only 8 retained), then clicked a car from the stale latest frame.
- Over the next 2.4 s the ticks went 630 → 715, but the snapshot stayed `trackedTrip 937`, `trackedRoute.length 8` the whole time.
- The panel still read "48 km/h … on trip 2:31 … link 284", with no updates.

Any main-thread hitch longer than ~8 frames (GC, React render, slow device, 60×) triggers this. It contradicts "metrics must be real sim values". The same code path would also let an in-flight frame resurrect a vehicle just cleared with Escape and then freeze it. I could not reproduce that race (0 of 24 Escape trials at 5×), but the null-ignoring handler makes it possible.

Fix (no test change):
- (a) In `App.onFrame`, when `'tracked' in f && f.tracked === null`, clear `trackedRef`, call `renderer.setTracked(null)`, `setTracked(null)` and follow-off, but **do not** clear `gone`. That keeps the one-shot "Arrived after …" notice, because the frames after `gone` are null.
- (b) Optionally, in `host.inspectVehicle`, keep the current `trackedTrip` when `trip_at_record` returns −1, so that a missed click does not drop an existing selection. This is compatible with frozen test 8, which clears before the stale pick.

### MINOR
- **m1: Vehicle picking ignores the extrapolation that the renderer draws.** At 60× and zoom 2, a drawn car can be ~1 sim s (≈ 28 px) ahead of its record, outside the 8 px tolerance, so clicks on moving cars miss. After the M1 fix this also matters at 1× (up to ½ tick). Suggestion: keep `pickVehicle` as specified (frozen test 9), but have `App.pickVehicleAt` pass record positions advanced by the renderer's current `dtSim`, or pick against `s + v·dtSim`. Alternatively, document that clicks are reliable when paused.
- **m2: `FrameMessage.tracked` / `linkDetail` are typed as always present but are absent at runtime until inspection is used.** Judgement: **acceptable**. The frozen core-004 test rejects `null` fields, frozen test 7 needs `tracked === null` after `gone`, and frozen `inspect.test.ts` (`isGone(t: TrackedVehicle | TrackedGone | null)`) does not type-check with an optional field. So no other shape satisfies all three. It is documented in the JSDoc and in the ward's Gold refinement, and the App reads both with `?? null`/truthiness. Residual risk: a future consumer could compare `=== null` and misread `undefined`. Suggestion: add a tiny accessor, e.g. `frameTracked(f) => f.tracked ?? null`, and use it.
- **m3: The vehicle panel hard-codes `blockedTicks / 2`.** It should be `blockedTicks * DT` (DT is exported from `protocol.ts`).
- **m4: After `gone`, the title drops the zone names.** It shows only `Trip #id`. Keep the last tracked origin/dest so the notice reads "Trip #id: A → B".
- **m5: The state text "stranded: no route on" reads as truncated.** Suggest "stranded: no route onward".
- **m6: Escape does nothing while focus is on the panel's Follow / Stop following button** (the global handler skips interactive targets), e.g. right after a mouse click on Follow. Consider handling Escape in the panel itself.
- **m7: Narrow widths: at 520 px the right `.side` column (264–504 px) overlaps the control panel (16–302 px)** and covers part of the speed readout and the "Close the main bridge" button (`city003-gold-narrow-520.png`). This pre-existed with the 220 px selection panel and is now 240 px. Suggest a media query (stack below the controls, or `max-width: calc(100vw - 32px)`) below ~560 px.
- **m8: The host's `init` does not reset `trackedTrip`, `inspectedLink` or the `*InspectionUsed` flags.** City changes currently reload the page (URL `?city=`), so this does not bite now. A re-init on the same worker would track a dense trip id in the new world. Reset them in `init`.
- **m9: `World::vehicle_by_trip` and `trip_outcome` scan linearly** (slots, `completed_log`), so the per-frame tracking cost is O(slots) in Rust rather than O(route). It is cheap at the current scale (~1.2k slots) and there is no JS O(vehicles) work. A `trip → slot` index would make it O(1) if counts grow.

## Checks that passed
- **`state_hash` covers `removed_log`.** It hashes the length plus `(trip_id, kind as u64)` for each entry (world.rs, after the counters). `removed_log` is pushed in both removal paths (unreachable and gridlock). `World` derives `Clone`, so snapshots carry it.
- **Queries are read-only.** All the new `World` queries take `&self`. `inspection_does_not_change_state` passes, and there is no wall-clock time in sim-core (grep for Instant/SystemTime/Date is empty).
- **Frame trip table.**
  - It is built in `encode_frame` in the same order as `write_vehicle_records` (links → lanes → front first, as tests 1 and 6 confirm).
  - It keeps the 8 most recent **distinct** ticks: re-encoding the same tick (paused, or 1× between ticks) replaces that tick's entry.
  - The oldest table's Vec is reused.
  - The trip table is not sim state (adapter cache) and is not hashed, which is correct.
- **Budget.** Per post: one `vehicle_detail`; one `trip_outcome` only when not live, after which tracking stops; one `link_detail`. The host guards all of the optional `SimLike` methods.
- **Frame format.** Vehicle records are unchanged at 16 B. The App copies records with `slice(0)` (16 B/vehicle, ~19 KB per frame at 1.2k vehicles), which is negligible.
- **GPU.** The route mesh is rebuilt only when the route changes, the old VAO/buffer is deleted, and `dispose` frees the route, the ring VAO/buffer and both programs. No leak found.
- **Layers.** The route is drawn after the roads and glyphs and before the vehicles, and the ring is drawn last. Both are near-white with dark edges and readable in grayscale. The ring radius is in CSS px (7–10 plus a 1.5 px edge).
- **Escape order.** Vehicle (including a gone notice) first, then road.
- **Colour.** Panel state uses an icon plus text, not colour alone.
- **Ward scope.** Picking below `VEHICLE_PICK_MIN_ZOOM` selects only roads, and selections coexist as specified.
