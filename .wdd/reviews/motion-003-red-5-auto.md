# motion-003 Red gate, round 5 (Gold regression spec `web/e2e/motion003_gold.spec.ts`): APPROVED (-auto)

Reviewer: a fresh adversarial test-review subagent. It received only the artifacts:
- the spec, at sha256 b700640e5d211b795ebc91fe8ca7456f0cc700353a61087aacdc913ecf6b4cbf (verified);
- `.wdd/reviews/motion-003-gold-1.md` and `-gold-2.md`;
- the ward `.wdd/wards/motion/ward-003.md`;
- `web/src/App.tsx` and `web/src/ui/TimelineBar.tsx` at HEAD c4f4cc5;
- the frozen `e2e/motion003.spec.ts` test 10 and `e2e/layout.spec.ts` `labels_never_half_cut`.

The convergence rule applies (round 5). Every gap found below is verified and fixable in the test, so the verdict is APPROVED with the fix tests spelled out.

## Verdict: APPROVED (-auto). 0 BLOCKER, 2 MAJOR test gaps (verified, fixable, fix tests below), 3 minor

## What the spec pins well (verified with mutants)
- **The sampled conditions match the ones Gold r2 found.** Against a mutant that restores the r2 behaviour (only the first four places, and the first free one or the default place), **both tests fail**:
  - single view: pins over "⌂ Old Town" and "◫ Old Exchange", and pin × pin overlaps at a shared stop-line node;
  - compare: overlaps on **A's half** (`labels: "▼ 17" × "⌂ Old Town"`, …) and on B's half (`labels-b: "▼ 11" × "North Bridge"`, …).

  The sampling therefore reaches the r2 failure (co-located top-queued links beside a label, on both halves, while running).
- **The reported mutant is confirmed.** With `clearPins()` removed from `placeMarks`, the single-view test fails with 439 distinct overlaps.
- **The thresholds are not too lax.**
  - An overlap is counted from 0.5 px in both directions, and every rAF frame is sampled: 120 frames running plus 20 frames paused, over 4 phases (single view) or 3 phases (compare).
  - Pins with `visibility: hidden` are excluded consistently with frozen test 10.
  - A pin hidden through `opacity: 0` keeps its box, so it is still flagged (an opacity mutant failed). The opacity route cannot make the test pass trivially.
- **The tests are stable on a shared machine.** Baseline: 2 passed twice, at 2.6 min (load about 11–13) and 2.7 min (load about 23–29).
- **No conflict with frozen tests.**
  - The spec never asks for a mark to be hidden, so it agrees with test 10 ("hidden although it fits" is forbidden).
  - It does not touch zone visibility (`labels_never_half_cut`).
- **The timeline marker check is solid.**
  - B's closure at the branch tick is found by its accessible name `B: Closed Main Bridge at …`.
  - The visible glyph `✕B` is checked, so the scenario is not carried by colour only.
  - The marker's box must lie inside `.timeline-track` (±0.5 px). That is Gold r2 m-c, fixed by the `at-start` class.

## Findings

### MAJOR-T1 (verified): a pin removed from layout counts as "shown" and never overlaps
- **The gap.** `sampleOverlaps` filters on `visibility` only, and increments `pins` before any box check. A pin with `display: none` has a zero rect, so its overlap is never above 0.5 px, yet it still counts toward `pins > 100`.
- **The mutant that survives.** In `clearPins`, use only the first four places, and set `display = 'none'` on a pin when no place is free (and skip `taken`). Result: **both tests pass (2 passed, 2.6 min)**. That mutant silently drops exactly the crowded-junction pins that r2 found.
- **Why frozen test 10 does not catch it.** It forbids "not laid out" pins, but it samples a single moment, with no guarantee that a collision exists at that moment.
- **Fix test.** Amend `sampleOverlaps` in the same new file, as a Red-gated supersession-free edit, because the file is not frozen yet. For every `.queue-pin` (before the `shown` filter), push a failure `"<layer>: <text> not laid out"` when any of these holds:
  - `getComputedStyle(e).display === 'none'`;
  - its rect has width or height < 1;
  - `Number(getComputedStyle(e).opacity) < 0.5`.

  Count `pins` only for pins that are shown and laid out. The pins must still equal the hook. On the paused samples, add: `document.querySelectorAll('.labels:not(.labels-b) .queue-pin')` shown and laid out count === `queuePins().length` for the viewed side (or ≥ 1 on each half in compare). Then a pin that cannot be placed cannot vanish.

### MAJOR-T2 (verified by construction): the compare test never has an A intervention, so "names each side's own interventions" is half-pinned, and A's half is sampled only with the bridge open
- **The gap.**
  - In `pins_never_cover_labels_comparing_and_named_markers`, A's command log is empty: the `b` key at a past position creates B with the closure. So no `A: …` marker can exist, and an implementation that drops the `side: 'A'` label (`App.tsx:1313`) or A's markers entirely would pass.
  - A's half is sampled only while A is uncongested. Gold r2 found the long-lasting overlaps on A's half **in the demo state, with A's Main Bridge closed** ("▼10…▼22" over "Old Bridge", ticks 3047–3304). The r2 mutant above happened to fail on A's half anyway, so this is about coverage rather than a surviving mutant.
- **Fix test.** Add a third test, `pins_never_cover_labels_comparing_demo_state`, in the same file:
  1. River City at 20×. Close the Main Bridge in A at about tick 1850 (button `Close the main bridge`), and run to more than 2600.
  2. Pause, focus the Timeline slider, and step back (ArrowLeft) until the position is **before** the closure tick.
  3. Branch B there (press `b`, which closes in B too, or branch by any UI path that leaves B without A's later closure). Then `Compare side by side`.
  4. Assert that `.timeline-track` contains the marker named `/^A: Closed Main Bridge at <simClock(closeTick)>$/` with text `✕A`, inside the track (±0.5 px).
  5. If B's own closure is at the branch tick, assert that `/^B: Closed Main Bridge at /` with `✕B` is also present.
  6. Then run the same 3 × (120 running + 20 paused) `sampleOverlaps` loop, with the T1 amendment. Expect no overlaps, and at least 1 laid-out pin on **each** half in the paused samples.

### Minor
- **m1, observation: the layout-effect placement is not distinguished.** With `useLayoutEffect(placeMarks)` removed, both tests pass (2 passed). The rAF loop places pins before every paint, including while paused, so I could not show a painted frame where the layout effect matters. This is not a test gap. If the Gold reviewer wants it pinned, a sample after a React commit and before the next rAF, for example from a `MutationObserver` on `.labels` childList, would do it. That is optional.
- **m2: an end-of-window marker is not checked.** The `at-end` class (fraction > 0.98) is unchecked. The behaviour statement names only the window's start, so this is optional. It could be covered by asserting that the marker for an intervention at the head stays inside the track.
- **m3, contract note: at a junction where all 16 places are blocked, the implementation still overlaps (it takes the "least covered" place).** This spec would then fail, while test 10 forbids hiding a fitting pin. That is consistent with the stated behaviour ("never covers"), and none of the sampled runs hit it. If it ever occurs, the resolution belongs in the ward (merge co-located pins), not in a weaker test.

## Commands and results
| Command | Result |
|---|---|
| `shasum -a 256 web/e2e/motion003_gold.spec.ts` | b700640e…4cbf (matches) |
| `playwright -c zz-alt-port.config.ts e2e/motion003_gold.spec.ts` (baseline, HEAD c4f4cc5) | 2 passed (2.6 min, load about 11–13) |
| same, second baseline | 2 passed (2.7 min, load 23–29) |
| mutant A, r2 behaviour (`PIN_PLACES.slice(0,4)`, first free or default) | **2 failed**: single (Old Town, Old Exchange, pin × pin) and compare (A half and B half) |
| mutant B, `clearPins()` removed from `placeMarks` | **failed**: single view, 439 overlaps (compare not reached in the output shown) |
| mutant C, `useLayoutEffect(placeMarks)` removed | 2 passed (see m1) |
| mutant D, 4 places, `opacity: 0` when no place is free | **failed**: the hidden pin is still flagged |
| mutant E, 4 places, `display: none` when no place is free | **2 passed**: MAJOR-T1 |

`web/src/App.tsx` was restored from a byte copy after each mutant. Its sha256 is 78241f722dce7125ba013f391d9dcb0f81097a190fe28a28c290b81ccb6a05e8 before and after.

## Git state
`git status --short` lists the pre-existing `web/zz-alt-port.config.ts` and `web/zz-alt-port2.config.ts`, plus this file.

---

## Applied (round 5, convergence rule, 2026-10-13)

APPROVED with two fix tests, so this is logged as `-auto`.
- **T1:** `sampleOverlaps` now reports any queue pin that is `display: none`, has a box under 1 px, or has an opacity below 0.5. It counts only pins that are laid out. In each paused sample of the single-view test, the number of pins drawn in A's layer must equal `queuePins().length`.
- **T2:** new third test, `pins_never_cover_labels_comparing_with_A_closed`. A's Main Bridge is closed. The test rewinds to before that closure and branches there (B also closes the Main Bridge, at the branch tick). It then compares and runs past A's closure. Both markers ("A: Closed Main Bridge at …" ✕A and "B: Closed Main Bridge at …" ✕B) must be inside the track, and pins are sampled on both halves, running and paused, with at least one pin drawn on each half.
  - The marker check runs only after both sides are past A's closure, because the shared compare window ends at the lower head.
- m1–m3: noted.

Runs: all three tests pass (2 in 3.8 min, the third in 1.8 min).

**Frozen (sha256):** `web/e2e/motion003_gold.spec.ts` = `aad8d3342396c57f073aea2a374efd171da07c59ded5b90bc878f1d3d6a6b89a`
