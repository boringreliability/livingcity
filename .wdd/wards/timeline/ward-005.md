---
ward: 5
revision: null
name: "The full brief workflow in the browser, measured"
epic: "timeline"
status: "approved"
dependencies: ["timeline-004"]
layer: "fullstack"
estimated_tests: 9
created: "2026-10-09"
completed: null
---
# Ward timeline-005: The full brief workflow in the browser, measured (integration ward)

## Scope
This is the integration ward of epic `timeline`, contract **T5**. It covers four things:
- **The acceptance flow.** The brief's criterion runs end to end in a real browser: *close a bridge, see the traffic consequences emerge, rewind, try another decision, and compare the outcomes*.
- **Measurement.** The timeline's costs are measured and reported in `docs/performance.md`: seek, branch, snapshot memory, and lockstep tick and render.
- **Delivery documents.** The remaining items in the brief's § Delivery list:
  - a README with setup and run commands;
  - a concise architecture explanation;
  - the traffic-model assumptions;
  - a demo walkthrough.
- **Wiring.** Automated integration checks across the whole app:
  - every protocol message has a sender and a consumer;
  - there are no orphaned exports in `web/src`;
  - the docs cite numbers that exist in the JSON results.

## Inputs
Everything from epics core, city and timeline:
- `Timeline`, `branch` and `window_metrics`;
- the host's scenarios, seek and compare;
- `TimelineBar`, `ScenarioPanel`, `ComparisonPanel` and the test hook;
- the perf harness (`web/e2e/perf.spec.ts`, `e2e:perf`, `web/perf-results/`);
- `docs/performance.md`.

## Outputs
**E2e: the acceptance flow** (`web/e2e/acceptance.spec.ts`). The steps:
1. Open the app (it is already living) and observe traffic.
2. Close the main bridge at A's head.
3. Run until queues and rerouting are visible: queued at least doubles, and an Old or North Bridge approach shows spillback (the city-005 criterion).
4. Rewind on the timeline to before the closure.
5. Try another decision there. In A's past this creates B. The decision: keep the main bridge open and close the North Bridge instead.
6. Run B to A's head.
7. Compare side by side at the matching sim time: incomplete trips shown; A has the main bridge closed and B has it open.

**Perf harness** (`@perf`). `perf_timeline_recorded` writes `web/perf-results/timeline.json`, covering:
- the in-app seek cost (from slider input to the first frame at the target; median / p95 over ≥ 20 seeks across a full window);
- the branch cost (from the intervention to B's first frame);
- the snapshot memory of A and B against the budget;
- lockstep tick ms (mean, from the recording) against single view, over the same sim range;
- the render interval in both modes.

It also includes the run conditions, the same as the other harness files.

**Docs**
- `README.md` (repo root):
  - what Living City is;
  - prerequisites (Rust, wasm-pack, Node, pnpm);
  - setup and run commands (`pnpm -C web build:wasm`, `pnpm -C web dev`);
  - the test commands (Rust, Vitest, Playwright, `e2e:perf`);
  - URL parameters and keys;
  - links to the docs below.
- `docs/architecture.md`, ≤ 2 pages:
  - the layers: Rust core, wasm adapter, worker host, UI and renderer;
  - the data flow per frame (typed buffers, no per-vehicle calls);
  - determinism (fixed tick, two RNGs, the command log);
  - the timeline (snapshots, seek, branch, lockstep compare);
  - the sim/render boundary.
- `docs/traffic-model.md`: the deliberate simplifications and their reasons:
  - links, lanes, storage and queues; discharge and saturation flow;
  - routing (cost EMA, budgeted rerouting, hysteresis); closures and NoRoute;
  - gridlock relief; demand (OD flows, profile, counter-based RNG);
  - what "queued", "incomplete" and "unserved" mean.
- `docs/demo.md`: the walkthrough of the most compelling demo, step by step with keys, written so a newcomer can run it in five minutes.
- `docs/performance.md` gains a **Timeline** section that cites `timeline.json`, with no estimates.

**Integration checks** (`web/tests/integration.test.ts`, static source analysis):
- every `ToWorker` type in `protocol.ts` is sent by `client.ts` and handled by `host.ts`;
- every `FromWorker` type is posted by `host.ts` (or `worker.ts`) and consumed by `client.ts`;
- every exported symbol in `web/src` (excluding `wasm/`) is imported somewhere else in `web/src` or in the tests or harness, or it is on an explicit, commented allowlist of public constants;
- every number in the Timeline section of `docs/performance.md` appears in `web/perf-results/timeline.json`.

## Specification
- **Acceptance flow semantics** (fixed by timeline-003/004):
  - the closure at A's head is an ordinary command;
  - an intervention in A's past creates B from that tick, with the commands < tick, so B never sees the main closure;
  - running B passes A's position. B then goes back, or compare aligns at B's or A's position, so both are compared at the same tick;
  - compare shows the cohort from the branch tick.
- **Measurement honesty.** As in city-005: only measured numbers; the run conditions are stated; sub-resolution values are flagged.
- **Docs.** They must match the code. The Gold reviewer follows README and `demo.md` literally on a clean shell and reports any step that fails.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `brief_acceptance_flow` (e2e) | steps 1–7 above. Spillback and queued doubling in A after the closure (as city-005 test 10). After rewinding before the closure, B is created by the North Bridge closure at that tick, and B has no main closure. In compare at the shared tick, `sides.a.closed ⊇ main`, `sides.b.closed ⊇ north` with no main, and the panel shows **Incomplete** for both. The panel's Generated values are equal (identical demand) |
| 2 | `acceptance_flow_keyboard_only` (e2e) | the same core path using only the keyboard: Space, B, Tab to the slider, ←, B, Tab to "Compare side by side" and Enter. It ends in compare with the panel visible. No pointer events are used |
| 3 | `protocol_messages_are_wired` (vitest) | each `ToWorker` / `FromWorker` type literal has a sender and a consumer, by static scan |
| 4 | `no_orphaned_exports` (vitest) | every export in `web/src` is used outside its own file, or is allowlisted with a reason |
| 5 | `docs_exist_and_cover_the_brief` (vitest) | `README.md` and `docs/{architecture,traffic-model,demo,performance}.md` exist. README contains the setup, run and test commands. `traffic-model.md` defines queued, incomplete and unserved. `demo.md` mentions close the bridge, rewind, branch and compare |
| 6 | `performance_doc_cites_measured_timeline_numbers` (vitest) | every number in `docs/performance.md`'s Timeline section appears in `timeline.json` |
| 7 | `perf_timeline_recorded` (@perf) | writes `timeline.json` with every field. ≥ 20 seeks, all within the window. Branch time is measured. Lockstep and single-view tick means come from recordings over the same sim range. Memory ≤ 2 × budget |
| 8 | `readme_commands_are_real` (vitest) | every `pnpm -C web <script>` named in README exists in `web/package.json`, and every `cargo` command names an existing package, test or example |
| 9 | `epic_gate_deviation_list_complete` (vitest) | the Deviations sections of timeline wards 003/004 and the epic file's Completion Criteria are reflected in `docs/architecture.md` § Deviations: each deviation title appears |

## Must NOT
- Fabricate or estimate numbers.
- Write docs that contradict the code.
- Edit frozen tests.

## Must DO
- Update CONTEXT, the epic table, and CLAUDE.md where its commands changed.
- Prepare the epic-gate summary.

## Manual Smoke Test
### Setup
On a clean shell, follow README literally.
### Steps
1. Run the demo exactly as `docs/demo.md` says. Verify every step behaves as written.
2. Run `pnpm -C web e2e:perf`. Verify `timeline.json` is written and `docs/performance.md`'s Timeline section matches it.
### Pass criteria
- [ ] All suites green
- [ ] README and the demo work as written
- [ ] The numbers are measured and cited

## Verification
The Gold reviewer:
- runs everything, including `e2e:perf`;
- follows README and `demo.md` literally;
- audits the docs against the code (architecture claims, model assumptions);
- reviews the integration checks for teeth: an orphan or an unwired message must fail them.
