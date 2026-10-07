# Review city-002 RED 1

**Reviewer:** adversarial test reviewer (fresh subagent), 2026-10-07
**Verdict:** REJECTED (1 MAJOR, 8 MINOR)

Scope: `.wdd/wards/city/ward-002.md`, `.wdd/epics/city.md` § C1–C3, `.wdd/epics/core.md`, and the tests at commit 2b4670e:
- `crates/sim-core/tests/city_002_river.rs` (blob `ca4ec6dd…`)
- `web/tests/river.test.ts` (blob `4afc45d1…`)
- `web/e2e/river.spec.ts` (blob `81a1d640…`)

I also read `crates/sim-core/src/{cities,world,network,command}.rs`, `crates/sim-wasm/src/lib.rs`, `web/src/sim/{host,protocol}.ts`, `web/src/ui/testHook.ts`, every existing `web/tests/*.test.ts` that uses `createSim`, and all the core e2e specs.

## What I ran

A scratch workspace at `/Users/Z6DEC/.claude/jobs/e54ac286/tmp/r002/ws` holds a copy of sim-core only. Nothing in the worktree was touched except this file.
- I added `City.name` and `City.river` (three_bridges → `"three_bridges"`, `(-60, 60)`).
- I added a **toy** `river_city`: a 5×7 grid per bank at 600 m spacing, corridor `(-75, 75)`, and bridges at y = −1800 (Old: 1 lane, 30 km/h, sat 0.25), y = 0 (Main: 2 lanes, arterial) and y = +1800 (North: 1 lane). It has 5 west zones (4 residential and a workplace), 3 east workplaces and an east hospital. Demand is scaled with `TOY_K`. It exists only to exercise the harness, and its calibration was not judged.
- `cargo clippy -p sim-core --all-targets -- -D warnings`: clean. The test file triggers no lint; its crate-level `allow`s cover `needless_range_loop` and `manual_is_multiple_of`.
- `cargo test -p sim-core --release --test city_002_river` on the toy: 12 tests in 0.27 s. Runtime is not a concern; even a city 10× more expensive stays far below 120 s.
- Debug `cargo test` (the `profile.test` opt-level 2 still has `debug_assertions`): the 8 calibration tests are reported `ignored, calibration: run with --release`. Tests 1, 2, 3 and 12 run and pass in 0.5 s.
- I added a diagnostic test (`zz_diag`, scratch only) that prints every measured quantity of the harness at two seeds and two loads:

  | Toy, seed (2026, 7) | K = 1.0 | K = 1.8 (oversaturated) |
  |---|---|---|
  | base active (min 30–60) | 1130 | 3379 |
  | base queued | 19.9 | 373 |
  | base longest ≥ 95 %-full run | 0 ticks | 8865 ticks (test 4 rejects it: good) |
  | closed queued | 457 | 1568 |
  | spillback ticks (closed / base) | 2888 / 0 | 3600 / 0 |
  | W→E mean trip (base → closed) | 617 s → 1025 s (×1.66, n = 1907 / 1358) | ×1.33 |
  | W→E bridge exits, base [Main, North, Old] | [1555, 139, 213] | – |
  | W→E bridge exits, closed | [0, 900, 450] (exactly North and Old saturation over 30 min: the exit differencing is right) | – |
  | Main Bridge W→E exits per minute, min 20–22 after closing | 50, 15, then 0 | 60, 20, then 0 |
  | gridlock removals | 0 | 0 |

**Harness conclusions:**
- `crossing_links` finds exactly the 6 bridge links.
- The `[0]`/`[1]` direction checks, the west→east trip filter (origin x < west_x, dest x > east_x) and the per-minute window indexing behave as intended. Index `i` is the sample at the end of minute `i + 1`, so `[30..60]` is minutes 30–60 and `[75..80]` is minutes 75–80.
- The spillback chain (bridge-head feeder L1 plus its upstream feeder L2, without connectors, bridges or U-turns) fires under closure and never in either baseline. The full-link run counter discriminates a saturated baseline.
- Determinism (two independent builds, closure command) holds.

## Findings

### MAJOR 1: test 11 checks only 2 of the C3 target groups at the second seed
C3 (binding) says: "The targets are verified by tests at seeds (2026, 7), **plus at least one other seed pair**", followed by the full list (baseline, closure, reopen). The ward also says "Calibration targets: exactly § C3". Test 11 re-checks only test 4 (baseline) and test 6 (queues double) at (11, 3).

**Why this lets a wrong city pass:** calibration is tuned by trial at (2026, 7). A city whose closure trip-time ratio is 1.26 at that seed and 1.1 at another, or whose spillback only appears at one seed, is exactly the overfit city the second seed exists to catch. The following targets are verified at one seed only:
- spillback (7)
- trip-time ratio (8)
- rerouting to alternatives and ≤ 1 % removals (9)
- recovery after the reopen (10)
- Main Bridge share (5)

All are knife-edge ratios.

**Fix:** move each calibration test body into a helper that takes `&City`, and run all of them at both seeds. Runtime is no obstacle: the toy runs the whole file in 0.3 s. For example:

```rust
fn check_main_share(c: &City) { /* body of test 5 with `c` */ }
fn check_spillback(c: &City) { /* body of test 7 */ }
fn check_trip_time(c: &City) { /* body of test 8 */ }
fn check_reroutes(c: &City) { /* body of test 9 */ }
fn check_reopen(c: &City) { /* body of test 10 */ }

#[test] #[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn main_bridge_carries_most_crossings() { check_main_share(&river_city(2026, 7)); }
// … likewise for 7, 8, 9, 10 …

// 11
#[test]
#[cfg_attr(debug_assertions, ignore = "calibration: run with --release")]
fn calibration_holds_for_another_seed() {
    let c = river_city(11, 3);
    assert_living_baseline(&c);
    check_main_share(&c);
    assert_queues_double(&c);
    check_spillback(&c);
    check_trip_time(&c);
    check_reroutes(&c);
    check_reopen(&c);
}
```

Update the ward table row 11 to "every C3 target (tests 4–10) holds for seeds (11, 3) too".

### MINOR 2: test 9 adds a premise C3 does not state ("no Main Bridge exits 2 min after the closure")
The core closure semantics say vehicles already on a closed link "continue and may leave", with no time bound. With gridlock relief, a front on the closed bridge that is blocked by a full east-bank link may legitimately exit (or be removed) up to 10 min later. Westbound traffic rerouting along the east bank can congest the Main Bridge's east head.

On the toy the bridge empties within about 1.5 min even when oversaturated, so this is unlikely to bite. However, it tests a timing that is not specified, while the actual invariant (no new entries) goes untested.

**Fix:** replace it with the contract's invariant, tracked per tick inside `run`:

```rust
// in Run: main_entries_after_close: u64 ; in run(), with `close_tick: Option<u64>`:
let before = [b[0][0], b[0][1]].map(|l| r.w.link_count(l));
r.w.step();
// count increases on a closed Main Bridge link = an entry (no entry is allowed)
if close_tick.is_some_and(|ct| r.w.tick() > ct) {
    for (i, l) in [b[0][0], b[0][1]].into_iter().enumerate() {
        if r.w.link_count(l) > before[i] { r.main_entries_after_close += 1; }
    }
}
```

Then assert `main_entries_after_close == 0`. If the explicit drain check is kept, loosen it to "no Main Bridge exits from 10 min after the closure" (the window start), which C2's 10-min removal bounds.

### MINOR 3: test 3 does not pin "arterial speed" for the Main Bridge
It asserts only `main.speed > old.speed`, so a 9 m/s Main Bridge passes. **Fix:** require the Main Bridge to be as fast as the fastest non-connector link:

```rust
let fastest = net.links().iter().filter(|l| !is_connector(&c, l.id)).map(|l| l.speed_limit_mps).fold(0.0, f64::max);
assert_eq!(net.link(lm.central_bridge[0]).speed_limit_mps, fastest, "Main Bridge at arterial speed");
```

### MINOR 4: geography of the landmarks is untested
C3 says Old = `south_bridge`, "south", and the ward places North ~1.5–2 km north and Old ~1.5–2 km south. Nothing checks that the link labelled `north_bridge` is north of the Main Bridge. A city that swaps them, or puts all three crossings within 300 m of each other (which also makes "rerouting" invisible), passes tests 1–3.

**Fix (add to test 1):**

```rust
let y_mid = |l: LinkId| (net.node(net.link(l).from).y_m + net.node(net.link(l).to).y_m) / 2.0;
let (n, m, s) = (y_mid(lm.north_bridge[0]), y_mid(lm.central_bridge[0]), y_mid(lm.south_bridge[0]));
// (three_bridges convention: north = +y)
assert!((1000.0..=2500.0).contains(&(n - m)) && (1000.0..=2500.0).contains(&(m - s)), "bridge spacing {n} {m} {s}");
```

Optionally also check the extent: the x span of nodes is in 4–8 km and the y span in 3–6 km.

### MINOR 5: test 4 checks `unserved == 0` only at minute 60
`unserved` includes the instantaneous `no_route` and `stranded`. C3 says "unserved = 0 … through 60 min". **Fix:** record `m.unserved` and `m.removed_gridlock` per minute in `Run` and assert that every sample is 0. This is cheap, and it also catches a transient NoRoute burst toward a non-zone destination, which test 1's zone-to-zone reachability does not cover.

### MINOR 6: "mean over a window" is sampled once per minute
`queued`/`active` are sampled once per minute, so test 10's "mean over 5 min" is 5 samples. With the toy's baseline queued ≈ 20, one sample's noise moves the 1.5× threshold noticeably. The tests are deterministic, so this does not cause flakes, but it makes the calibration knife-edge at a single seed. **Fix:** accumulate per-tick sums in `run` (for example `queued_ticks: Vec<u64>` summed per minute and divided by `MIN`), so every window mean is over all ticks.

### MINOR 7: test 14 does not check the ward's fallback for fakes without `city_name`/`river`
The ward's Outputs require `'unknown'` / `[0, 0]` when `SimLike` lacks the optional methods. The existing fakes and `createSim(d, b)` callers type-check and keep working (I read `host.test.ts`, `sim.test.ts`, `gold_fixes.test.ts`, `review2/3.test.ts`; none deep-equals the ready message). Still, nothing asserts the fallback, and a host that throws on a missing `city_name` would only fail incidentally. **Fix (append to test 14):**

```ts
const posted3: FromWorker[] = [];
const real = Sim.three_bridges(1, 1);
const fake = new Proxy(real, { get: (t, p) => (p === 'city_name' || p === 'river' ? undefined : (t as any)[p]?.bind?.(t) ?? (t as any)[p]) });
createSimHost({ createSim: () => fake as unknown as SimLike, memory: () => memory, post: (m) => posted3.push(m), now: () => 0 })
  .handle({ type: 'init', demandSeed: 1, behaviorSeed: 1 });
const r3 = posted3.find((m): m is ReadyMessage => m.type === 'ready')!;
expect(r3.city).toBe('unknown');
expect(r3.river).toEqual([0, 0]);
```

### MINOR 8: test 16 cannot tell whether the hook's `city` comes from the sim or from the URL
If `snapshot().city` is derived from `?city=` and `worker.ts` ignores `init.city` (always `Sim.river_city`), test 16 still passes. Test 14 covers only the host, not the worker glue. **Fix:** compare the network that actually loaded:

```ts
const s = await ready(page, '/?city=three_bridges');
expect(s.city).toBe('three_bridges');
const r = await ready(page, '/?city=atlantis');
expect(r.city).toBe('river_city');
// the sim really changed: River City has more links than the 66-link core city
expect(r.linkCounts.length).toBeGreaterThan(s.linkCounts.length);
```

Also state in the ward that `snapshot().city` is `ready.city`.

### MINOR 9: test 13 runs `sim.step(2400)` of River City inside vitest's default 5 s timeout
There is no `testTimeout` in `web/vite.config.ts`. This is fine at the toy's speed. At the ward's own performance ceiling (80 min < 10 s native, so up to 2.5 s for 20 min, and wasm in Node is slower), it could time out. **Fix:** `test('river city runs through wasm …', () => { … }, 30_000);`

## Core e2e tests under the River City default (asked; advisory, not counted)
- All core e2e specs read `landmarks`, never ids. `city.spec` 5 needs the bridge empty within 5 sim-minutes, and the toy empties it in about 1.5. Id-wise they should keep working.
- The real risk is **scale at fit zoom**, not ids. River City is about 3× wider than three_bridges (about 0.18 px/m instead of 0.5 px/m in the 1280-px viewport).
  - `gold5.spec` G1 ("selected road gets a visible outline", which needs ≥ 120 white px in a 40×24 clip around `north_bridge[0]`) and G1-hover (≥ 60 px) need the North Bridge to be about ≥ 30–40 px long on screen, so about ≥ 200 m.
  - `city.spec` 6 / `review1` G3 click `central_bridge[1]` at fit zoom, where the two directions are only about 1.5 px apart on screen.
- **What should happen:** the Gold step runs the full e2e suite against the River City default. If these fail, fix it in the city or renderer without editing tests: bridges long enough (corridor plus abutment), and picking that resolves the direction at the clicked offset. The ward sentence "that test's harness keeps the default" cannot be implemented without editing approved files or `playwright.config.ts`. If that becomes necessary, escalate rather than add a config-level default-city switch silently.

## Verdict
REJECTED on MAJOR 1. All other findings are MINOR.
- The harness itself measures C3 correctly.
- The debug `ignore` attributes are correct, clippy is clean, and release runtime is far below 120 s.
- Tests 13–16 match the ward's protocol design and leave the existing fakes and `createSim(d, b)` callers working.

Fixing MAJOR 1 (all targets at the second seed) is required for approval. MINORs 2, 4, 5 and 8 are cheap and recommended.
