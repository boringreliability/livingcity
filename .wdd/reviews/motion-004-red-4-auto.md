# motion-004 Red gate, round 4: APPROVED (convergence rule, with one fix test)

## Verdict: APPROVED-auto (0 unresolved BLOCKER; 1 MAJOR = verified-fixable test gap, fix below; 3 minor)

Reviewer: a fresh adversarial Red-gate subagent. Reviewed fix commit `ca7136e` (diff `3f3efa0..ca7136e`) on top of `b4a01cd`, `7a6637c` and `3f3efa0`. No repo file was changed apart from this verdict.

Round 4 convergence rule: the only MAJOR finding (B4-1) is a test that is too strict for a spec-compliant picture. The fix is concrete and was verified on the emulation. It does not weaken any check, and the mutations still fail. So the verdict is APPROVED, **on condition that the fix below is applied to `web/e2e/motion004.spec.ts` before the tests are frozen** (re-hash after applying it).

### Hashes verified (sha256, unchanged during review)
- `web/tests/motion004.test.ts`: a36e515c2628e644ee81d83070f12289cfc1b97ca75e0b3af123c5b9d2cac4f7 ✔
- `web/e2e/motion004.spec.ts`: 95ebbf34fe2988aacc988a97e059d5728b061b6c2586835992f864bce0d99403 ✔

Load average was 20–25 throughout (shared machine). None of the findings depends on load. B4-1 comes from pixel geometry and reproduces at the same rate in two separate probe runs.

## Commands and results

### On the stubs
1. `pnpm -C web exec vitest run tests/motion004.test.ts`: **4 failed / 4**, each for the right reason:
   - test 1: 0 ≠ 2140;
   - test 2: the marks Set has size 1, not 4;
   - test 3: `DECOR_COLORS.water` is undefined;
   - test 4: `ROAD_MIN_PX.major` 2.5 < 5.5.

   The e2e results on the stubs (5/5 fail, for the right reasons) were taken from the orchestrator and from r3. On the stubs, tests 6 and 8 fail before the new code paths run, so they were judged on the emulation below.

### Emulation
I copied the r3 emulation to `scratchpad/red4/emu/web` (`node_modules` symlinked; Vite on my own ports 5391–5394, all stopped afterwards) and brought it up to the current spec:
- **Mark geometry, now pinned by the spec:**
  - ridge: 70 % of the long side;
  - court: an inner rectangle outline with its lines at 0.2 and 0.8 of each side;
  - cross: arms of 60 % of each side;
  - quay: two lines at 1/3 and 2/3 of the short side, each 80 % of the long side.
- **Mark line width:** a constant px width (`VITE_LW`, default 2 px), with the marks rebuilt per zoom.
- **Mark colour:** optionally exactly fill + `VITE_MC` (used with 0.035, the spec minimum).
- **`districtSamples`:** its mark-avoidance geometry was updated to match the marks.
- **Mutation switches** (`VITE_MUT`):
  - `samemark`: every kind draws the ridge;
  - `samemark-court`: every kind draws the court;
  - `nocasing`: the route edge is 1 px, as today;
  - `noend`: no destination mark;
  - `ringmarker`: the tracked marker is a ring of r = 9.9 px instead of brackets.
- **Unchanged from r3:** fills, `DECOR_COLORS`, road classes and width, car outline, brackets, 2.5-px casing, end square, the hooks, the legend, and the closure ring `radiusPx` = 8.

| # | Command (from `emu/web`, `-c zz4.config.ts`) | Result |
|---|---|---|
| 2 | `vitest run tests/motion004.test.ts tests/decor.test.ts tests/gold5.test.ts` | **13/13 passed** |
| 3 | `playwright test e2e/motion004.spec.ts` (LW 2) | **5/5 passed** (3.1 min) |
| 4 | `… -g followed_car --repeat-each=4` | **4/4 passed** (3.9 min), so test 8 passed 5/5 in all. **B3-1 is fixed.** |
| 5 | mutation `samemark` (current spec), test 6 | **failed** as it should: "workplace roof mark at zoom 1: expected court, received ridge". **M3-1 is fixed.** |
| 6 | mutation `nocasing`, test 8 | **failed**: "dashes with a ≥ 2 px dark casing (0/12)" |
| 7 | mutation `noend`, test 8 | **failed**: "end mark lit at probe 0: 100.5 < 235" |
| 8 | mutation `ringmarker`, test 8 | **failed**: "no ring across the heading: 247 ≥ 200" |
| 9 | **probe** (`e2e/zprobe.spec.ts`, scratch only): `markSignature` on every distinct building per kind found by `districtSamples` over a 70-px grid, at zoom 1.06 and 3.09, with **LW 1.5 and mark = fill + 0.035 (the spec minimums)** | **current `markSignature`: residential 18/43 misread at zoom 1 and 5/10 at zoom 3**, all as `unknown (centre true, across [1], along [])`. Workplace, hospital and waterfront: 0 misreads. **Fixed version: 0/43 and 0/10** (B4-1). Repeated in a second run: identical. |
| 10 | the same probe with LW 3 (the spec maximum) | current: 0 misreads; fixed: 0 misreads |
| 11 | the current test 6 at LW 1.5 / +0.035, `--repeat-each=2` | 2/2 passed. The buildings this run happens to pick have favourable sub-pixel centres: see B4-1. |
| 12 | the **fixed** test 6 at LW 1.5 / +0.035, `--repeat-each=2` | **2/2 passed** |
| 13 | the **fixed** spec, all of 5–9 (LW 2) | **5/5 passed** |
| 14 | the **fixed** test 6 with mutations `samemark` and `samemark-court` | **both failed** as they should: workplace read as ridge, and residential read as court |
| 15 | **frozen set** against the emulation: look, gold5, motion, motion002, inspect, city, city.e2e, review2, layout, guide, compare, fonts, motion003, motion003_gold | **80 passed, 1 skipped**. One failure on the first run (`layout compare_frame_and_supported_widths`) was my setup: README.md was missing from the scratch copy. With README copied it passed (1/1). No frozen test needs a change. |

## Earlier findings re-checked

| Finding | Status | Evidence |
|---|---|---|
| r3 B3-1: test 8 cannot reach far route ends | **Fixed** | `bringToFree` now zooms out at FREE until the subject is on the canvas (via `elementFromPoint`, so not under an overlay), drags it to FREE, then zooms back in. Test 8 passed 5/5, including the casing and the end mark. |
| r3 M3-1: the mark is not read from the picture | **Fixed (one sampling defect remains, B4-1)** | The `samemark` and `samemark-court` mutations fail test 6. The hook's mark is cross-checked against `DISTRICT_STYLE`. |
| r3 mi3-1: stale +0.024 in the spec table | Fixed | The table says +0.035. |
| r3 mi3-2: test 8 comment | Fixed | — |
| r3 mi3-3: test 7(b) uses only the first qualifying pin | Open (minor) | It passed on the emulation. |
| r1/r2 B1–B3, B-N1…B-N4, M1–M4, M-N1 | Still resolved | Tests 5, 7 and 9 passed. The legend footprint and the frozen set are green. |

## Findings

### B4-1 MAJOR (verified-fixable test gap): `markSignature` samples the profile row and column with `Math.round` of the box centre, so a spec-compliant thin mark line is missed for about half of the buildings

**Why the line is missed.**
- `my = Math.round((y0 + y1) / 2)` selects the pixel row `[my, my+1)`, whose centre `my + 0.5` lies 0 to **1.0 px** from the true centre line. The row should be the pixel that contains the centre.
- A mark line pinned by the spec at 1.5 px wide with contrast fill + 0.035 (about 8.9 in 8 bit) is drawn with MSAA (`antialias: true`). It lights a pixel to ≥ fill + 6 only where it covers ≥ 67 % of it.
- So the profile *along* a ridge (and along a cross arm) can miss the line entirely, which gives `along = []` and the result `unknown`.

**Evidence.**
- Probe (item 9): with LW 1.5 / +0.035, **18 of 43** residential buildings at zoom 1 and **5 of 10** at zoom 3 are misread.
- Every misread building has a centre fraction ≥ 0.5 (for example c_y = 261.70, 431.73).
- At LW 2 the analytic failure rate is about 10–17 %. At LW 3 it is 0.

**Why the test still passes today.** It does so only because of which building the run picks. Its pass or fail depends on the sub-pixel position of one building, which the wheel stop and the drag decide. A layout or camera change, or an implementation that picks another nearest building, can turn a correct implementation red. Because a correct implementation can fail, this would be a BLOCKER. It is classed under the convergence rule because the fix is verified.

**Fix (verified: items 9, 10, 12, 13, 14).** Replace these four lines of `markSignature` in `web/e2e/motion004.spec.ts`:
```ts
  const [mx, my] = [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
  const row = await lumClip(page, Math.ceil(x0), my, Math.floor(w), 1);
  const col = await lumClip(page, mx, Math.ceil(y0), 1, Math.floor(h));
  const [shortP, longP, shortLen, longLen] = w <= h ? [row, col, w, h] : [col, row, h, w];
  const centre = Math.max(...(await lumAt(page, [mx, my], 3))) >= fill + 6;
```
with:
```ts
  // the pixel that contains the centre, and 3-px-wide profiles (per-position max) through it: a 1.5-px mark line
  // whose centre falls between two pixel rows still lights one of them (Red r4 B4-1)
  const [mx, my] = [Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2)];
  const [W, H] = [Math.floor(w), Math.floor(h)];
  const rows = await lumClip(page, Math.ceil(x0), my - 1, W, 3);
  const cols = await lumClip(page, mx - 1, Math.ceil(y0), 3, H);
  const row = Array.from({ length: W }, (_, i) => Math.max(rows[i]!, rows[W + i]!, rows[2 * W + i]!));
  const col = Array.from({ length: H }, (_, i) => Math.max(cols[3 * i]!, cols[3 * i + 1]!, cols[3 * i + 2]!));
  const [shortP, longP, shortLen, longLen] = w <= h ? [row, col, w, h] : [col, row, h, w];
  const centre = Math.max(...(await lumAt(page, [mx, my], 3))) >= fill + 6;
```

**Why the fix is not weaker.**
- The per-position max widens a profile only *perpendicular* to its own direction. Run counts and run lengths along the profile stay the same for lines that cross it (the ridge across, the court and quay sides).
- The centre-dark checks for the court and the quay keep their 3×3 window.
- Results: the `samemark` and `samemark-court` mutations still fail test 6; the fixed spec passes 5/5; and the probe finds 0 misreads at LW 1.5 and at LW 3.

Update the test 6 row of the spec's Tests table to say "3-px-wide profiles through the pixel containing the box centre".

### minor
- **m4-1. The court wording "an inner rectangle outline at 0.2–0.8 of the box" can be read as "anywhere inside 0.2–0.8".** A small centred court (for example 0.45–0.55) would merge into one lit blob at zoom 1 and fail as `unknown`. Suggest "with its sides at 0.2 and 0.8 of the box (± 0.05)". The emulation used 0.2 / 0.8 exactly and passed.
- **m4-2. Coverage limit of the evidence.** The probe grid found no hospital building fully on the canvas at zoom 3 (n = 0). The cross at zoom 3 was exercised only by the one building test 6 visits (it passed in items 3, 12 and 13). The cross shares the ridge's along-a-line risk, which the fix removes.
- **m4-3. Carried over.** r3 mi3-3 (test 7(b) uses only the first qualifying pin) and the optional r2 mi5/mi6 (decor below roads beyond luminance; compare mode).

## Conditions for the orchestrator
1. Apply the B4-1 replacement verbatim to `web/e2e/motion004.spec.ts`, re-hash it, and record the new hash as the Red snapshot.
2. Update the test 6 row in `.wdd/wards/motion/ward-004.md` (B4-1) and, optionally, the court wording (m4-1).

## Red snapshot (orchestrator, after applying B4-1 verbatim)
- The B4-1 replacement and the spec wording for B4-1 and m4-1 were applied. `web/e2e/motion004.spec.ts` is byte-identical to the reviewer's verified `motion004fix.spec.ts` (empty `diff`). Typecheck is green.
- Frozen hashes (sha256) for the Gold gate:
  - `web/tests/motion004.test.ts`: a36e515c2628e644ee81d83070f12289cfc1b97ca75e0b3af123c5b9d2cac4f7
  - `web/e2e/motion004.spec.ts`: 84bbd08b2e24e40dc8860bcb85b061c6fd19fa4dd37a426df0c7a5a88bdd6655
