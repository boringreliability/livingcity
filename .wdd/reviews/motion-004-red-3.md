# motion-004 Red gate, round 3: REJECTED

## Verdict: REJECTED (1 BLOCKER, 1 MAJOR, 4 minor)

Reviewer: a fresh adversarial test-review subagent. Reviewed Red commit b4a01cd plus the fix commits 7a6637c (r1) and 3f3efa0 (r2). The stubs are unchanged since b4a01cd.

Test hashes (sha256) as reviewed:
- `web/tests/motion004.test.ts`: a36e515c2628e644ee81d83070f12289cfc1b97ca75e0b3af123c5b9d2cac4f7
- `web/e2e/motion004.spec.ts`: e313e91b554eea7594b78a5438fd4ab67bb247b96e93bcc24e4eb548d07e3923

Load average: 29.04 / 24.86 / 22.18 at the start, 14.79 / 17.56 / 18.71 at the end. Between those it was 17–22, and other sessions shared the machine. The BLOCKER below does not come from load: it follows from geometry and gives the same pixel distances on every run.

Note for the orchestrator: this is the **third** rejection on this gate. Under CLAUDE.md, the next step is escalation to the human.

## Commands and results

### On the stubs
1. **`pnpm -C web exec vitest run tests/motion004.test.ts`: 4 failed / 4**, each for the right reason:
   - test 1: `buildingKinds.length` was 0, not 2140;
   - test 2: the marks Set had size 1, not 4;
   - test 3: `DECOR_COLORS.water` was undefined;
   - test 4: `ROAD_MIN_PX.major` was 2.5, below 5.5.
2. **`cd web && node_modules/.bin/playwright test -c zz-alt-port2.config.ts e2e/motion004.spec.ts --reporter=line` (port 5231): 5 failed / 5**, each for the right reason:
   - 5 failed at "every link in exactly one class" (stub `roadClasses`);
   - 6 failed at "residential shown at fit zoom" (stub `districtSamples`);
   - **7 got past 7(a), the intended guard, which passed, and past the r2 precondition (`measured` = 14). It failed at "queued cars with a dark seam on both sides (0/14)".** That is the right reason: B-N4 is fixed;
   - 8 failed at "the Main Bridge closure ring" (stub `closureSigns`);
   - 9 failed at the legend "ring" ("Closed road (hatch, barriers)").

### Emulation
I built a spec-faithful emulation in a scratchpad copy of `web/` (`scratchpad/red3/emu/web`, `node_modules` symlinked). Its own Vite ran on port **5288** and was stopped afterwards. No repo file was changed apart from this verdict. It started from the r2 emulation and was brought up to the current spec:
- **`character.ts`:**
  - grey fills 0.07 / 0.10 / 0.13 / 0.16, each mark +0.04 (spec ≥ +0.035), outlines 0.18;
  - `DECOR_COLORS` with water, bank, park, building, outline, pad, quay, bollard, deck and railing;
  - `DECOR_MAX_LUM` computed (0.20 ≤ 0.2065);
  - `ROAD_BASE.major` (0.31, 0.335, 0.37);
  - `ROAD_MIN_PX` 5.5 / 2.5.
- **Decor:**
  - `buildingKinds` by the spec rule;
  - `padKinds`, and pads drawn as a disc, a square or a cross in both cities;
  - a 10-m `quay` strip with bollards, rendered in the decor pass.
- **Renderer:**
  - it takes its colours from `DECOR_COLORS`, so the test 3 source regex is clean;
  - per-kind fills, and marks from zoom 1 at 1.6 m (≥ 1.5 px);
  - per-class road width and base colour, with the `u_pass == 1` halo gate;
  - a car outline from 1.5 px/m;
  - corner brackets;
  - a 2.5-px route casing;
  - a 9-px end square aligned with the last link.
- **Hooks:** as specified, including the 12-px centre fallback in `districtSamples` and the closure ring `radiusPx` = 8 (`GLYPH_OUTER_PX`).
- **Legend:** the spec's short texts, with a bracket sample.

Results on the emulation:
3. **vitest** (`tests/motion004.test.ts`, `decor.test.ts`, `gold5.test.ts`): **13 / 13 passed**. Tests 1–4 are feasible, including the pad shape ratios, the quay bounds and the source regex.
4. **`motion004.spec.ts`, run 1:**
   - tests 5, 6, 7 and 9 passed;
   - 8 failed at "ring lit" because of my own emulation error (`radiusPx` 10 instead of 8). After the fix, see below.
5. **Tests 7 and 8, `--repeat-each=2`:**
   - test 7 passed 2/2 (3/3 in all);
   - **test 8 failed 1/2 at "brought onto the canvas"** (line 541, the end mark).
6. **Diagnostic copy of test 8** (logs every `bringToFree` step), `--repeat-each=4`: **3 / 4 failed** (BLOCKER B3-1).
7. **Test 8 with only the pan budget raised from 8 to 40** (scratch copy): **3 / 3 passed**. Every check in test 8 is feasible, including the casing and the end mark.
8. **Frozen set against the emulation:**
   - specs: look, gold5, motion, inspect, layout, review2, motion002, motion003, motion003_gold, city, city.e2e, guide, compare, fonts;
   - result: **80 passed, 1 skipped, 0 failed (21.3 min)**;
   - so the spec's numbers, the short legend and the brackets hold together with every frozen visual and layout test.
9. **Mutation:** the same emulation, but with the *ridge* mark drawn for every kind (port 5289, stopped). `DISTRICT_STYLE` still declares four distinct marks. **Test 6 passed** (MAJOR M3-1).
10. **Mark-signature probe** (scratch copy of test 6, logging only), at zoom 1 and zoom 3. On the emulation, the four marks have stable, distinct signatures (the basis for the M3-1 fix):

| mark | centre lit | across short side | along long side |
|---|---|---|---|
| ridge | yes | 1 run of 2/26 px (z1), 4/83 px (z3) | 1 run of 22/27 px, 64/88 px |
| court | no | 2 runs | 2 runs |
| cross | yes | 1 run of 24/44 px, 71/137 px | 1 run of 24/62 px, 70/189 px |
| quay | no | 2 runs | 0 runs |

## Round-2 findings

| R2 | Resolved? | Evidence |
|---|---|---|
| B-N1 test 8: no candidate; drags from off-canvas points | **Partly.** The candidate rule (≥ 0.3) now finds a car in every run (4 / 4 diagnostic, 2 / 2 and 3 / 3 runs), and `bringToFree` pans correctly. **The 8 × 300 px budget is too small:** see B3-1. | — |
| B-N2 no `districtSamples` at fit zoom | **Yes** | The 12-px centre fallback is in the spec. Test 6 passed on the emulation for all four kinds. |
| B-N3 local road probe at zoom 3 | **Yes** | The test samples t = 0.1…0.9. The hospital and the waterfront passed at zoom 3. |
| B-N4 test 7(b) `pins[0]` under the legend | **Yes** | Stubs: `measured` = 14, and the test fails at the seam (right reason). Emulation: passed 3 / 3. |
| M-N1 legend text breaks frozen tests | **Yes** | The short texts plus the footprint bound are in test 9, which passed. The frozen set passed 80/80 with the new legend. |
| mi1 float tolerance | Yes | — |
| mi2 mark headroom | Yes | +0.035 and ≥ 1.5 px. The emulation's marks were found at zoom 1 and 3. |
| mi3 hooks trusted | **No** | `districtSamples().kind` and `.mark` are not checked against `buildingKinds` or the drawn shape. It is now part of M3-1. |
| mi4 end-mark orientation | Yes | The spec says the mark is aligned with the last link. |
| mi5 decor below roads | Open (optional) | — |
| mi6 compare mode | Open (optional) | — |

## Round-1 findings (still hold)

| R1 | Still resolved? |
|---|---|
| B1 brake band | Yes. The seam is 0/14 on the stubs, and test 7 passes with the outline. |
| B2 one kind per visit | Yes. |
| B3 test 8 candidate | The candidate is found. The reach problem is B3-1. |
| M1 casing, end mark, hooks | Yes. Casing and end mark passed on the emulation whenever the subject was reached. |
| M2 test 5 margin | Yes. It passed. |
| M3 fit-zoom cars | Yes. 7(a) passes on the stubs and on the emulation. |
| M4 fill spacing | Yes. It passed. |
| m1–m8 | As in r2. m1 is folded into M3-1. |

## New findings

### B3-1 BLOCKER: test 8's pan budget (≤ 8 pans of ≤ 300 px) cannot reach the route end; a correct implementation fails about 75 % of runs
- **The cap is in both places.** Test 8 runs at zoom 2.17 px/m (the zoom it set for the closure ring). The spec ("at most 8 pans of ≤ 300 px") and `bringToFree` both cap the reach at about 2 400 px, which is ≈ 1.1 km.
- **The route end is often farther than that.** In the diagnostic runs, `routeEnd().page` started at:

  | start | distance from FREE | pans needed |
  |---|---|---|
  | (6230, −547) | ≈ 5 800 px | ≈ 20 |
  | (4714, −1846) | ≈ 4 700 px | ≈ 16 |
  | (−50, −547) | — | reached in 4 |

  So 3 of 4 runs failed with "brought onto the canvas".
- **The casing check is already close to the cap.** The congested link started at (84, −1558) and took **7 of the 8** pans.
- The r2 emulation passed this check by luck of the chosen car.
- **This is not a load effect:** the distances are geometry, and they are the same each run.
- **Proof the checks themselves are feasible:** with only the pan budget raised to 40, test 8 passed 3 / 3 on the emulation (ring, brackets, casing, end mark).

**Fix (test and spec text):** pick one.
- (a) Raise the budget, for example to 40 pans of ≤ 300 px, or to "until on the canvas, at most 60 s". Keep the hard `onCanvas` assertion.
- (b) Better for the end mark, whose size is in px so any zoom works: wheel out at FREE until `routeEnd()` is on the canvas with a 12-px margin, then `dragTo` it to FREE. Use the same zoom-out-then-zoom-in approach for the congested link.

Update the spec's "at most 8 pans of ≤ 300 px" to match.

### M3-1 MAJOR: point 1 ("districts differ by **shape and pattern first**") is not verified in the browser; a renderer that draws one mark for every kind passes
- **What the tests check today:**
  - test 2 checks that `DISTRICT_STYLE` *declares* four distinct marks;
  - test 6 checks that *some* local maximum ≥ fill + 6 exists inside each kind's building, and that the fills differ by luminance (the *secondary* carrier).
- **Mutation proof.** In the emulation I drew the ridge for all four kinds, and `districtSamples` still reported distinct mark names. Test 6 **passed** (1.3 min). Tests 2 and 3 pass too, because they only read the constants. The grayscale step in the manual smoke test is the only guard left, and it is a judgement call.

**Fix.** Two parts.
- **Add a per-kind mark signature to test 6 at zoom 1 and zoom 3.**
  - Use the profiles through the box centre, across the short side and along the long side.
  - A pixel is *lit* when it is ≥ fill + 6, and a *run* is consecutive lit pixels.
  - Assert the signature of `DISTRICT_STYLE[kind].mark`:

    | mark | centre lit | across the short side | along the long side |
    |---|---|---|---|
    | ridge | yes | exactly 1 run, ≤ 20 % of the profile | 1 run ≥ 50 % of the profile |
    | court | no | 2 runs | 2 runs |
    | cross | yes | 1 run ≥ 35 % of the profile | 1 run |
    | quay | no | 2 runs | 0 runs |

  - Also assert `districtSamples().mark === DISTRICT_STYLE[kind].mark` (r2 mi3).
- **Pin the geometry the signature relies on in the spec:**
  - the ridge spans ≥ 60 % of the long side, and its line is ≤ 2 m wide;
  - the cross arms span ≥ 40 % of the short side;
  - the court square is centred, with its sides inside 0.2–0.8 of the box;
  - the quay lines sit at 1/3 and 2/3 (already pinned).

The probe in "Commands and results" (item 10) shows these signatures hold at both zooms, with wide margins.

### minor
- **mi3-1. Stale threshold in the spec table.** Test 2's row in the spec's Tests table still says the mark is "≥ its fill's + 0.024". The test and the Outputs section say +0.035. Update the table.
- **mi3-2. Inaccurate comment in test 8.** The comment says "occupancy ≥ 0.3: tinted light, lum > 100". With the current congestion mix, a local road at occupancy 0.3 is about lum 88 and a major road about 98. The test is unaffected, because the casing threshold of ≤ 50 is below any road, so it still separates a 2.5-px casing from today's 1-px edge. Fix the comment, or drop the claim.
- **mi3-3. Test 7(b) uses only the first qualifying pin.** It passed 3/3 on the emulation and measured 14 on the stubs, so this is not a defect today. Iterating qualifying pins until `measured ≥ 4` (r2's suggestion) would harden it against demand changes.
- **mi3-4. Optional items still open.** r2 mi5 (decor below roads beyond luminance) and mi6 (compare mode).

## Summary of what must change before Red can pass
1. **Test 8 and the spec (B3-1):** a pan or zoom strategy that reaches a route end several km away. Zoom out until the subject is on the canvas, or allow ≥ 40 pans.
2. **Test 6 and the spec (M3-1):** per-kind mark-shape signatures in the browser, the `districtSamples().mark` cross-check, and the mark geometry pinned in the spec so the signature is well-defined.

Everything else from rounds 1 and 2 holds. The emulation passes tests 1–7 and 9, test 8 passes once the budget is raised, and the frozen set is green (80 passed, 1 skipped).
