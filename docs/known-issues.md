# Known issues

Every item collected in the polish backlog (`.wdd/memory/polish-backlog.md`) and its status after epic `polish`: **resolved (ward)**, **limitation:** (known and left, with the reason) or **deviation:** (differs from the plan or brief, and is pinned by a frozen test).

## Epic gate

Deviations for the human gate of epic `polish` (details in `docs/architecture.md` § Deviations, "From epic polish"):

- e2 — paused frames keep their 16 ms rate (frozen host tests G4/G4b).
- e3 — frame pools are per side only; wider reuse is pinned by F2/G8.
- i1 — at 1× a moving car can stop at the end of the junction curve for up to a tick, then move on ~7 m (polish-003 test 4: extrapolation never passes the link end).
- i2 — cars held at a stop line are drawn at the next link's start, so they can stack inside busy junctions (polish-003 tests 3(a)/4/7).
- i3 — the hover keeps its grey halo under the dashed stroke (gold5 G1).
- i5 — the closure sign is a ring around the hatch, not a solid core (look.spec midpoint hatch).
- New in polish-006: under SwiftShader at `?demand=5`, the WebGL work that a compare switch needs (releasing B's old context, preparing a spare one) runs as main-thread tasks just *after* the switch is drawn: 0.1–0.8 s with one app tab, and up to 2.9 s was seen with two more app tabs open (Gold review). The switch itself shows within 300 ms; input in that moment waits. On a hardware GPU these calls take a few milliseconds.

## (a) Accessibility and keyboard
- **a1:** Esc closes "Replace the branch?" — resolved (polish-001).
- **a2:** Space and B after a pointer pick in Speed — resolved (polish-001).
- **a3:** the `unserved` comment and docs name unreachable removals — resolved (polish-001); the tooltip text itself is pinned by city-005.
- **a4:** sub-resolution tick percentiles show 0.100 — limitation: the value format is pinned by city-005's Red contract; the tooltip explains it.
- **a5:** metrics bar at 375 px — resolved (polish-002).

## (b) Compare and timeline UI
- **b1:** refit on resize in compare — resolved (polish-002).
- **b2:** road panel over B's roads at 1280×800 — resolved (polish-002).
- **b3:** district labels cut at the halves' edges — resolved (polish-002): a cut label is hidden.
- **b4:** the bridge button shows A's state while comparing — resolved (polish-001).
- **b5:** "Viewing B" while comparing — resolved (polish-001).
- **b6:** the comparison panel is wider than its table — limitation: cosmetic only.
- **b7:** scenario and road panels near 900 px — resolved (polish-002).

## (c) Renderer
- **c1:** cars stepping at junctions — resolved (polish-003): junction curves; see i1 for what remains.
- **c2:** a speed change made cars step back — resolved (polish-003).
- **c3:** a worker stall extrapolated at full speed — resolved (polish-003): the cap is 1.5 × the expected sim advance.
- **c4:** hover halo close to a congested road — resolved (polish-003): a dashed stroke; see i3.
- **c5:** closed-road hatch dropped when zoomed out — resolved (polish-003): the ring sign shows at every zoom.
- **c6:** bridge railing contrast over land — resolved (polish-003): rechecked in its smoke test.

## (d) First run and demo
- **d1:** running B past A at 20× — resolved (polish-004).
- **d2:** in-app first-run guidance — resolved (polish-004): the demo guide.
- **d3:** stale "A plus two Bs" — resolved (polish-001).

## (e) Performance
- **e1:** `metrics()` cost under stress — resolved (polish-005): incremental counters.
- **e2:** paused frames — deviation: pinned by the frozen host tests G4/G4b (see Epic gate).
- **e3:** frame-buffer reuse — deviation: per-side pools only, pinned by F2/G8 (see Epic gate).
- **e4:** `Timeline::branch` cloned all snapshots — resolved (polish-005): shared `Arc` snapshots.
- **e5:** a seek copies the head-log prefix — limitation: 1.72 ms at 3 sim h, well within budget.
- **e6:** `apply_commands` scans the command log — limitation: measured as negligible.
- **e7:** `vehicle_by_trip` / `trip_outcome` scan linearly — limitation: used only for vehicle inspection, not per tick.
- **e8:** batches are unbounded when ms/tick measures 0 — limitation: happens only while a batch measures below the 0.1 ms timer resolution; not seen to cause stalls.
- **e9:** `performance.now()` resolves to 0.1 ms — limitation: a browser property; the diagnostics flag sub-resolution values.
- **e10:** 10k vehicles and ~60 FPS on SwiftShader — limitation: documented targets missed (peak ~7.6k on the network; SwiftShader ~20 FPS), see `docs/performance.md`.

## (f) Robustness and other
- **f1:** re-init reset only part of the clock — resolved (polish-005).
- **f2:** no recovery after a wasm trap — resolved (polish-005): Restart simulation.
- **f3:** Rust formatting — resolved (polish-006): `crates/*/src` and the examples pass `rustfmt --check`; frozen test files are excluded.
- **f4:** close-while-paused in the browser — resolved (polish-006).
- **f5:** no host unit test that `trackedSeq` is echoed — limitation: covered indirectly by the e2e inspection flows.
- **f6:** a failing B replace left the host on a freed B — resolved (polish-006).
- **f7:** small code-hygiene items (a repeated metric-name literal, a stale credit rule in `core.md`, needlessly `pub` constants, the ~2k baseline wording, a weak gold5 test, the frame's optional typing) — limitation: no behaviour change; left for a later cleanup.

## (g) Found in polish wards
- **g1:** Esc on confirm-replace moved focus from anywhere — resolved (polish-006).
- **g2:** opening Speed with the pointer without a change keeps focus there — limitation: Space then opens the select, as a focused select should.
- **g3:** toggling compare clears the pending bridge cue — limitation: a visual cue only; the queued closure itself is unaffected.
- **g4:** dashed `viewing-b` frame while comparing — resolved (polish-002).
- **g5:** a minimal `.sr-only` — limitation: the frozen h1 test only needs it hidden, which it is.
- **g6:** `gold_polish002` measures `section.panel` only — limitation: a frozen test; the error banner's layout was checked by probe.
- **g7:** fatal errors could be dismissed — resolved (polish-005).
- **g8:** `.error` max-width has no effect in the top band — limitation: cosmetic (a wider banner).
- **g9:** short timeline track between 960 and ~1100 px — limitation: still usable (111–175 px), keyboard steps unaffected.
- **g10:** speed readout wraps with the `?demand=6` badge — limitation: stress mode only.
- **g11:** compare panels over map edges at sizes outside the pinned ones — limitation: the pinned sizes (1280×800, 1100×800, 1024×768) are clear.
- **i1:** a car stops at the curve end, then moves on — deviation: pinned by polish-003 test 4 (see Epic gate).
- **i2:** held cars stack in junctions — deviation: pinned by polish-003 tests 3(a)/4/7 (see Epic gate).
- **i3:** the hover keeps its halo — deviation: pinned by gold5 G1 (see Epic gate).
- **i4:** small backward steps at a steady 20× — limitation: 0.15–0.74 m; fixing it needs the rate from measured frame intervals.
- **i5:** the closure sign is a ring — deviation: pinned by look.spec (see Epic gate).
- **i6:** architecture docs on the cap and `nextLinks` — resolved (polish-006).
- **j1:** the first control row overflows with `?demand=6` — limitation: stress mode only.
- **j2:** docs and tooltips name the "?" button — resolved (polish-006).
- **j3:** no focus ring on pressed toggles — resolved (polish-006): an outer ring.
- **j4:** the disabled "?" explains itself only in its title — limitation: the guide is not needed while comparing, and the title says why.
- **j5:** guide step 2 can tick from forward seeks while paused — limitation: it still needs the closure held for 3 sim minutes.
- **j6:** `labels_never_half_cut` is intermittent under heavy machine load — limitation: passes at normal load; a timing-sensitive layout probe.

## (k) From polish-005
- **k1:** browser perf harness re-run after polish-005 — resolved (polish-006): see `docs/performance.md`.
- **k2:** Restart left UI state of the dead world — resolved (polish-006).
- **k3:** the fatal banner and the halted controls — resolved (polish-006): the banner stays until the new world's first frame; Play, Speed and the bridge are disabled with the reason.
- **k4:** `index` missing from the snapshot field classification — resolved (polish-006).
- **k5:** frame pools not cleared — resolved (polish-006): on init, on leaving compare and when B is freed.
- **k6:** test 7b counts `returnBuffer` arguments only — limitation: a frozen test; every App call passes its side (checked in review).

## (k) From polish-006 (Gold review minors)
- **k7:** while halted, keyboard shortcuts still act: `+`/`-` change the disabled speed (carried into the new world), Space goes to the stopped worker; the timeline, Compare and Discard stay enabled — limitation: no effect on a stopped simulation besides the remembered speed; left for a follow-up.
- **k8:** the test hook's `snapshot()` settles pending B-context releases (a microtask) — limitation: it only brings forward a release the app makes anyway right after the next draw.
- **k9:** a B buffer returned after compare was left goes into B's just-cleared pool — limitation: bounded (one buffer), reused or cleared at the next change.
- **k10:** the fatal alert reads "The simulation stopped: simulation halted: …" — limitation: wording only.
- **k11:** the post-switch WebGL tasks grow with more app tabs open (2.9 s seen with three tabs), and compareOn's median reached 280 ms of the 300 ms at load 19 — limitation: SwiftShader GPU contention; making the spare only when idle would help.

## From epic fonts (fonts-001 Gold review minors)
- Expanding a collapsed legend near the beside/stacked border can show one frame of overlap before it moves up (the measurement commits after paint) — limitation: one frame; `flushSync` or keeping it stacked while collapsed would remove it.
- Every Fontsource subset is emitted (336 KB in `dist/assets`, including JetBrains Mono `.woff` duplicates); the browser fetches only the latin subsets (~69 KB) — limitation: disk size only.
- At 1280 px with Inter the legend's gap is 26 px against the 24 px unstack threshold — limitation: the placement is measured, so a narrower margin only changes where it stacks, never causes an overlap.

