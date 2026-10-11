# Investigation 2026-10-12, for the queued task (motion, paused work, consequences, character)

These are verified facts from three read-only investigations. Line refs are taken at commit e605bd7. The task itself is `.wdd/memory/task-2026-10-11-motion-paused-consequences.md`.

## Motion (i1, i2, i4, c1–c3)
- **Record format.** A vehicle record is 4×u32 (16 B):
  - link;
  - s (f32 bits);
  - v (f32 bits, speed over the last tick = Δs/DT);
  - flags: bit0 queued (v < 2 m/s), bit1 on a closed link, bit2 stranded, bits 8..15 lane.

  Order: links ↑, then lanes ↑, then front first (`World::for_each_on_network`, world.rs:1795). The order is rebuilt on every encode, so **a record index is not an identity**. Slots are reused LIFO with no generation. The 16 B layout is pinned by `core_004_frame.rs`, `sim.test.ts`, `host.test.ts` and `frame.test.ts`: use parallel typed arrays, as `nextLinks` does.
- **Identity.** `Vehicle.trip_id: u64` is unique and monotonic. sim-wasm `encode_frame` already collects the trip ids per record (lib.rs:191-216). Exposing a parallel `tripIds` (u32, 4 B/vehicle) is cheap.
- **Junction discharge in the sim** (world.rs:1528-1618):
  - Only the lane's front vehicle can cross, iff s + v·DT ≥ len, the next link has a lane with space, and the lane has credit ≥ 1 (sat_flow·DT = 0.25 per tick).
  - A crossing car lands on the next link at entry_s = reach − len (≤ ~7 m).
  - A **held car stays on its own link at s = len** (move_vehicles caps at len, world.rs:1728) and gets v ≈ 0.
- **i2 is a render choice.** The Bézier over the last min(6 m, len/2) ends at the next link's start (motion.ts:61-84, VEH_VS renderer.ts:271-291), so a held car at s = len is drawn inside the junction.
- **i1.** Extrapolation `min(s + v·dt, len)` (motion.ts:91, VEH_VS:267) drives a car to the curve end, where it waits; the next frame then jumps it to (next, entry_s).
- **i4.** `ExtrapolationClock` (motion.ts:103-139) anchors on the main-thread *receipt* time and uses a nominal rate (App.tsx:639-645), while frame intervals jitter: the worker uses setTimeout 4 ms (worker.ts:10) and posts at most every 16 ms. When the next tick arrives, the drawn time drops back. v·dt overshoots after an instant deceleration too.
- **Duplicated placement rules.** Picking (picking.ts:48-75), tracked/Follow/ring (renderer.ts:764-790) and the test hooks `vehicleScreenCenter`/`vehicleDraw`/`trackedDraw`/`drawAt` (App.tsx:1003-1094) all repeat the clamp and draw rule, so they must move together.
- **Compare.** A and B use the same rAF `now` and rate, but each renderer has its own ExtrapolationClock.
- **High speed.** At 60× a frame can span ≥ 2 ticks, so a car may pass an intermediate link; `nextLinks` only gives the next link.

**Frozen tests that pin unwanted motion (supersede, authorized):**
- `web/tests/motion.test.ts` test 3(a): at s = len the car is drawn at the next link's start.
- `web/tests/motion.test.ts` test 4: the clamp at the link end is drawn at the next start.
- `web/tests/motion.test.ts` test 6: its "> 0.5" check requires extrapolation to happen.
- `web/e2e/motion.spec.ts` test 7: uses `vehicleDraw` with held cars on the curve.

**Valid intent to keep:**
- motion.test 2, 3(b)(c) and 5;
- `motion.spec` test 8 (tracked continuity, ring = car);
- `polish_003_next_links.rs`;
- gold_city003 (Follow lurch ≤ 1);
- inspect/city Follow centring;
- the record-index hook API used by many e2e tests (`vehicleScreenCenter(record)` ≡ `pickAt().vehicle`).

## Consequences (A)
- **Guide.** DemoGuide is pinned by `guide_static.test.ts`: fixed step titles, no sim imports, the single prop `onHide`. Put consequence data in another component or pass it as data props only.
- **Timeline.** It has only a branch marker. `gold_polish002.spec.ts:182` checks that `.timeline` children and `.timeline-branch` do not overlap.
- **Selection.** `LinkDetail` = {vehicles, queued, costS, freeFlowS, exits (cumulative), capacityVph}. It has no names and no "closed at".
- **Routes.** `TrackedVehicle.route` exists, and the route is drawn as a dashed line.
- **Command log.** `World::command_log()` (world.rs:889) holds tick + Close/Open(link) but is **not exposed** by wasm; a read-only getter is cheap and leaves the hash untouched. In the UI, "when closed" is today only the frame-observed `guideProgress.closedSince`.
- **Crossing flow.** `World.exit_count: Vec<u64>` is cumulative exits per link, already snapshotted and hashed. The difference between two ticks is a deterministic crossing count, and B − A at the same tick is the difference since the branch. Expose `link_exits()` from wasm. **No new World field**: it would change the golden hashes in `polish_005_perf.rs`, which are never superseded. Window aggregation goes in sim-wasm or TS.
- **Window metrics.** `window_metrics(from)` (the cohort created_tick ≥ from) exists; the host calls it only while comparing (≤ every 500 ms).
- **Landmarks.** north_bridge (1 lane), central_bridge (Main, 2 lanes, 3,600 veh/h) and south_bridge (= "Old Bridge", 1 lane, 900 veh/h), each [W→E, E→W]. There are no display names.
- **Queued and congestion.** Queued = v < 2 m/s: a square amber car with a brake band. Road congestion is drawn from occupancy (linkCounts/capacity), lighter and wider. `linkQueued` is used only by SelectionPanel.
- **Comparison.** It has Generated/Completed/Incomplete/Unserved/Mean/p95 rows, with Δ shown as sign + ▲/▼; the rows and header are pinned by `compare.spec`. Risk: "Mean ▼" read as "faster"; only a tooltip guards against it.

## Character (B)
- **Decor.** It lives in `web/src/render/cities/{index,riverCity}.ts`, is deterministic and uses no Math.random.
- **Buildings.** One colour; a block's kind (nearest zone: residential/workplace/hospital) changes only density and size. About 14% of blocks are parks.
- **Missing.** There is no commercial or waterfront kind in the sim (districts keyed in cities.rs but not exported), no district tint and no bridge labels.
- **Labels.** `.zone ${kind}` spans have no kind styles. `decor.test.ts` requires labels.length === zones.length and no overlap, so keep extra labels in a separate list.
- **Road hierarchy.** Major and local roads differ only by lane count; at fit zoom both are at the 2.5 px minimum.
- **Pinned visuals:**
  - look.spec #9–15: hatch yellow, hatch anchored to the world, barriers, the halo keeping the hatch, labels follow the camera, congestion ≥ 1 px wider and ≥ 10 lighter, legend texts;
  - gold5 G1: select/hover luminance bands;
  - motion.spec: hover dash, and the closure sign at every zoom;
  - inspect ring/route: luminance ≥ 235;
  - city.e2e #7: Main Bridge open vs closed;
  - review2 N2.

## Paused work and pools (e2, e3, k9)
- Worker loop `setTimeout(iterate, 4 ms)` never slows (worker.ts:10,35). `iterate` (host.ts:616-663): paused → `plan()`=0, but `clock.report(0,…)` every iteration (reports trimmed only in `status()` → grows ~250/s without posts), and the post gate `t - lastPost >= 16` has no running/dirty check → full `encode_frame` + post every 16 ms while paused (pairs in compare). Comparison msgs only when `n>0` (plus on pause/compare-on/seek).
- Handlers that post themselves: afterJump (seek/branch/view/discard), afterPairJump, compare(false), init→ready. Not posting: command, setRunning, setSpeed, inspectVehicle, inspectLink, returnBuffer (paused loop shows their effect today).
- Per paused frame UI cost: 2 GL uploads, `decodeVehicles(slice)`, setLinkState over all links + texture upload, React re-render (both sides in compare). Estimated ~56 frames/s × (frameBytes + ~1.3 kB link arrays) ≈ 1.9 MB/s baseline, ~6 MB/s at ?demand=5 (NOT measured yet).
- Hidden dependencies: visible "achieved speed" (ControlPanel, Diagnostics) decays to 0 only via paused frames → need a settling frame or achieved=0 when paused. `perf.framesPerS` decays too (unused by UI/tests).
- Commands while paused: scheduled at current tick, applied as step 1 of the next step (world.rs:1127) → `closed` can't change while paused; pinned (valid) by G4 (closure in first resumed frame ≤ 4 ticks), G4b (not in paused frames), e2e close_while_paused.
- Pools (host.ts:143, 530-533, 580): per side, exact-size `find` then `pools[side]=[]` on every post; cleared on init (both), compare(false) (B only if viewed 0), branch/discard (B). In-flight frames unbounded (no flow control). Detached-buffer risk if a kept pool doesn't remove the used buffer (byteLength 0 matches count 0 → Uint32Array throws → fatal). Late returns after branch replace go to new B's pool (harmless: fully overwritten, exact size).
- Frozen tests pinning paused RATE (supersede, authorized): review2.test.ts:107 G4 line 121 (≥95 frames in 100 paused iterations), review3.test.ts:107 G4b line 122 (≥9 in 10), polish006.test.ts:26 test 4 line 79 (frames after failed branch's own fallback post), compare.test.ts:316 test 9 line 336 (frame after an ignored inspectVehicle while comparing). Their other assertions are valid intent (closure timing, A after failed replace, no tracking while comparing).
- Valid "frame after every handled message" (keep): polish005.test.ts:40 test 6 (one iteration, incl. no-ops), timeline.test.ts tests 2/4/8, compare.test 9 lines 316-321, gold_fixes F1, gold_city003 m8, host.test F3.
- Pool pins: host.test.ts:133 **F6** (docs wrongly say F2): byteLength === count*16 + content equals unpooled (valid protocol invariant). review2.test.ts:151 **G8** line 182: a returned buffer for a later-but-not-next frame never used (pins drop-on-post; valid intent = bounded pool). polish005.test.ts:75 test 7: line 98 most recently returned buffer reused when count unchanged (→ a kept pool must be LIFO), ≥10 reuses/side. polish006 test 4b (cleared on init valid; on leaving compare = detail). polish006 test 8 requires e2/e3 ids remain in known-issues § Epic gate and architecture "From epic polish".
- Measuring: host unit test with fake clock counting posts and summing bytes (+ Proxy counting encode_frame, like compare.test.ts:15-48); browser: `diagnostics().perf.framesPerS` (host posts last 1 s, both sides), `frameBytes`, perf recording (`frames` counts applied A frames only). No hook counts received worker frames.
