---
ward: 6
revision: null
name: "Finished product, verified"
epic: "polish"
status: "red"
dependencies: ["polish-005"]
layer: "fullstack"
estimated_tests: 9
created: "2026-10-10"
completed: null
---
# Ward polish-006: Finished product, verified (integration ward)

## Scope
This is contract **P6**, the integration ward of epic `polish`. It verifies the finished product end to end, re-measures performance, accounts for every backlog item, and closes the remaining small items. The ward reviewer also checks the wiring: no orphaned exports, no unconsumed messages or buffers, and no UI controls without effect.

The ward resolves these backlog items (`.wdd/memory/polish-backlog.md`):
- **here, as fixes:** f3, f4, f6, g1, i6, j2, j3, k2, k3, k4, k5;
- **here, as measurement and docs:** k1.

Every other id ends up either "resolved in <ward>" or as a known limitation or deviation with a reason, in `docs/known-issues.md` (new).

## Inputs
- Everything from epics core, city, timeline and polish.
- The existing e2e flows:
  - `acceptance.spec.ts` (the brief's flow, pointer and keyboard);
  - `guide.spec.ts` (the first-run guide);
  - `a11y.spec.ts`, `layout.spec.ts`, `motion.spec.ts`, `restart.spec.ts`.
- The perf harness: `e2e:perf` writes `web/perf-results/{baseline-1x,baseline-20x,closure-burst,stress-5x,timeline}.json`, and `frame_cost_probe` writes `frame-cost.json`.
- `docs/{architecture,traffic-model,demo,performance}.md`, `README.md`, and the polish backlog.

## Outputs
**Responsiveness under load (brief: "control responsiveness under load")**
- At `?demand=5` (20×), each of these takes effect in the app's state within 300 ms of the key or click:
  - Pause and Play (Space);
  - a seek (← on the timeline);
  - entering compare;
  - leaving compare.

**Fixes**
- **f4:** the close-while-paused flow is covered in the browser. While paused, the main-bridge button shows "(pending)" and `closed` is unchanged. After Play, the closure applies, and the pending marker goes once it is confirmed.
- **f6:** while a B replace is being built, `viewed` is 0 and `sim` is A. A failure in between never leaves the host pointing at a freed B.
- **g1:** Esc closes confirm-replace from anywhere, but moves focus to the slider only if focus was inside the confirm panel.
- **i6:** `docs/architecture.md` states the extrapolation cap correctly (1.5 × the expected sim advance), and says that `nextLinks` is copied.
- **j2:** the docs and the tooltip name the button as "the **?** (Guide) button".
- **j3:** a pressed toggle button ("?", Diagnostics, the scenario buttons) still shows a distinct focus ring: a focused pressed button is visibly different from an unfocused pressed one.
- **k2:** Restart gives a clean UI. Guide progress resets for the new world; selection, tracked vehicle, Follow, pending seek, comparison, the held pair and the confirm dialog are cleared; compare is off.
- **k3:** the fatal banner stays until the new worker is **ready**, then disappears. While halted, the run controls (Play/Pause, speed, bridge) are disabled and show why.
- **k4:** the `Snapshot` field classification in `timeline.rs` lists `index` as derived (rebuilt by `restored`).
- **k5:** `init` clears both frame pools, and leaving compare clears B's pool.
- **f3:** a formatting gate on the non-frozen Rust sources: `crates/*/src/**` and `crates/sim-core/examples/**` pass `rustfmt --check`. Frozen test files are excluded, because approved tests are never edited.

**Measurement (k1)**
- Re-run `pnpm -C web e2e:perf` and `frame_cost_probe`.
- `docs/performance.md` cites the new JSONs everywhere and gains a short browser before/after (polish-005) comparison of the stress run.

**Docs and accounting**
- `docs/known-issues.md` (new) has one line per backlog id (a1…k6) with its status: `resolved (<ward>)`, `limitation: <reason>` or `deviation: <reason, pinned by …>`.
- Its § Epic gate lists the deviations for the human: e2, e3, i1, i2, i3, i5, plus anything new.
- README links it. `docs/architecture.md` § Deviations gains a "From epic polish" item list that names the same deviations.

## Specification
- **The 300 ms.** It is measured in the page: from the event dispatch to the first `snapshot()` showing the change (running flag, position tick, compare flag). The page is under `?demand=5` load at 20×. The test log records the machine load (`uptime`).
- **Pinned and not to be broken:** all frozen tests, including G4/G4b (paused frames) and F2/G8 (pool rule).
- **Accounting is exhaustive.** The set of ids in `docs/known-issues.md` equals the set of `**<id>**` leads in `.wdd/memory/polish-backlog.md`.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `controls_respond_under_load` (e2e) | At `?demand=5` and 20× (≥ 4,000 on the network), measured in the page: Space pause, Space play, ← seek, the Compare click and the Compare-off click each show in `snapshot()` within 300 ms. Three repetitions; the median of each ≤ 300 ms. |
| 2 | `close_while_paused` (e2e) | Paused: clicking "Close the main bridge" shows "(pending)", and `closed` is unchanged for 1 s. After Space, `closed` contains the main bridge within 2 s and "(pending)" is gone. |
| 3 | `restart_is_clean` (e2e) | Close the main bridge, pause and rewind, branch, compare (guide steps 1/3/4/5 done), select a road, compare again, then `debugTrap()`. The fatal alert shows; Play/Pause, Speed and the bridge button are disabled with a reason. After Restart, the alert stays until the new world's first frame and then disappears. After that: no compare, no branch, no selection, no tracked vehicle, guide steps all undone, controls enabled. |
| 4 | `replace_points_at_a` (vitest, host) | During a B replace, the host's `viewed` is 0 at the moment the old B is freed: a probe sim's `free()` hook records the host's `scenario()` view. When the new branch throws, frames continue from A (scenario 0) and no call goes to a freed sim. |
| 5 | `esc_focus_only_from_the_confirm` (e2e) | Confirm-replace is open with focus on the canvas (body). Esc closes it and focus stays on the body. With focus inside the confirm panel, Esc moves focus to the slider (polish-001 behaviour). |
| 6 | `pressed_toggles_show_focus` (e2e) | For "?" (pressed), Diagnostics (expanded) and the viewed scenario button (pressed): focused via Tab, the computed outline or box-shadow differs from the same button pressed and unfocused. |
| 7 | `rust_sources_are_formatted` (vitest, runs `rustfmt --check --edition 2021`) | Every `.rs` file under `crates/*/src` and `crates/sim-core/examples` passes `rustfmt --check`. The files under `crates/*/tests` are not checked (frozen). |
| 8 | `backlog_fully_accounted` (vitest, static) | The ids in `docs/known-issues.md` equal the backlog's ids. Each line has a status `resolved (…)`, `limitation: …` or `deviation: …`. § Epic gate names e2, e3, i1, i2, i3, i5. README links `docs/known-issues.md`. `docs/architecture.md` § Deviations has a "From epic polish" item naming each of those ids. |
| 9 | `perf_results_are_current` (vitest, static) | Each browser perf JSON (`baseline-1x`, `baseline-20x`, `closure-burst`, `stress-5x`, `timeline`) has a `timestamp` ≥ `2026-10-10`, so it was taken after polish-005. `frame-cost.json` exists. Every number in `docs/performance.md`'s results tables appears in one of the JSONs: the existing city-005/timeline-005 doc checks stay green. `docs/architecture.md` states the cap as "1.5 × the expected sim advance" and that `nextLinks` is copied. |

## Must NOT
- Edit frozen tests or reformat frozen test files.
- Change sim results: the golden hashes must hold.
- Estimate numbers.

## Must DO
- Run every suite and `e2e:perf` under normal load, and log the load.
- Prepare the epic-gate summary: demo, commands, review log, deviations, known issues.
- Update CONTEXT and CLAUDE.md (commands, if changed).

## Manual Smoke Test
### Setup
From a clean shell, follow the README literally.
### Steps
1. In a fresh profile, complete the whole demo from the in-app guide only.
2. Repeat the brief's flow keyboard-only.
3. At `?demand=5`, pause, seek and compare: everything responds immediately.
4. Run `window.__livingcity.debugTrap()`, then Restart: the result is a clean, living city.
5. Read `docs/known-issues.md`: every item is either fixed or has an honest reason.
### Pass criteria
- [ ] All suites are green, and `e2e:perf` has been re-run and cited.
- [ ] The flows work.
- [ ] Every backlog id is accounted for.
- [ ] The docs match the product.
