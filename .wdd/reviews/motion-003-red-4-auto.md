# motion-003 Red gate, round 4 (e2e amendment, test 7 bridge-label placement): APPROVED

Reviewer: a fresh adversarial test-review subagent. Scope: `git diff f3f39ef dc2ba15 -- web/e2e/motion003.spec.ts .wdd/wards/motion/ward-003.md`. That diff changes test 7's label assertion (+8/−2 lines) and the ward text (map bullet and Tests row 7). No other e2e file changed (`git diff --stat f3f39ef dc2ba15 -- web/e2e` lists only motion003.spec.ts).

## Hashes (verified, sha256)
- `git show f3f39ef:web/e2e/motion003.spec.ts`: 59b05a8b0e36ebcf23822f241c5094addcf7499af870637ace3162ecea203b3f. This matches the stated freeze.
- `web/e2e/motion003.spec.ts` (working tree = dc2ba15): ddcfb5fe3864beb194ef406d7de3d7e25b65814d232b56603e21c3a8d425a378. This matches the stated amendment.

## Verdict: APPROVED (0 BLOCKER, 0 MAJOR, 3 minor)

## Stated reason: verified
- These frozen tests in `e2e/look.spec.ts` (unchanged since b434541) sample hatch yellow (`r>200, g>150, b<90`) around a bridge midpoint at the fitted view:
  - `hatch_leaves_junctions_clear`: 9×9 at the W→E link's midpoint, needs >5 yellow pixels;
  - `hatch_moves_with_the_map`: 30×12, needs >20;
  - `selected_halo_keeps_opposite_hatch`: 40×16 at the E→W link's midpoint, needs >20 and ≥0.9× after selection.
- The label is a 74×14 px plate in `rgba(10,12,16,0.72)`. Drawn over yellow, it gives r ≈ 0.28·255 + 7 ≈ 79, which is below 200. A label centred on the midpoint would therefore remove every yellow pixel in the 9×9 sample, and most of them in the larger ones. The conflict is real, and the old ±6 px bound required exactly that overlap.
- The frozen look.spec intent ("a closed bridge is visibly hatched at its middle") outranks a newer test's label placement. Moving the label is the correct resolution: the frozen tests stay untouched and no supersession is needed.

## Intent and strength of test 7
- **Intent kept.** Each of the three bridges is named on the map, at its bridge:
  - same names, in landmark order, from the hook;
  - `shown` at the fitted view;
  - the DOM element is visible;
  - horizontally centred on the bridge midpoint (±6 px);
  - vertically within a 22 px band just above it (bottom edge 8–30 px above the midpoint).
- **Strength.** The bridges are about 270 px apart vertically (River City) and about 280 px apart (three_bridges), so the 8–30 px band cannot be satisfied by a label at the wrong bridge. The vertical window (22 px) is a little wider than the old 12 px disk, but it is still unambiguous.
- **Assertion target.** The test now asserts on the DOM `boundingBox()` rather than only the hook's `page`. That is stronger, because it is what the user sees.
- **Hook-equals-DOM check.** The extra check (≤1 px) is near-tautological (`bridgeLabels()` reads the same rect), but it is harmless. It pins that the hook reports the element under test.
- **"Never covering it".** The ≥8 px gap from the label's bottom edge to the mean midpoint keeps the label out of the midpoint ±8 px band that all three look.spec samples use vertically. Any horizontal extent is then irrelevant.

## Geometry measured (temporary probe spec, deleted afterwards; 1280×800, fitted view)
| City | Bridge | W→E y / E→W y at t=0.5 | mean mid y | label box (x, y, w×h) | gap below label | centre dx |
|---|---|---|---|---|---|---|
| River City | North | 141.30 / 140.63 | 140.96 | 590.3, 115.0, 78×14 | 12.0 | 0.0 |
| River City | Main | 411.08 / 409.88 | 410.48 | 592.5, 384.5, 74×14 | 12.0 | 0.0 |
| River City | Old | 680.34 / 679.66 | 680.00 | 596.4, 654.0, 66×14 | 12.0 | 0.0 |
| three_bridges | North | 120.9 / 119.1 | 120.0 | 600.8, 94, 78×14 | 12.0 | 0.0 |
| three_bridges | Main | 401.6 / 398.4 | 400.0 | 603.0, 374, 74×14 | 12.0 | 0.0 |
| three_bridges | South | 680.9 / 679.1 | 680.0 | 600.3, 654, 79×14 | 12.0 | 0.0 |

- All six bridges run W–E (constant y from t=0 to t=1). The implementation (`.bridge-label { transform: translate(-50%, calc(-100% - 12px)) }`) sits in the middle of the tested 8–30 band in both cities.
- **Collisions (River City Main Bridge label, x 592–666, y 384–398):** nearest is the zone "⌂ Old Town" (x 481–550) and the queue pin "▼ 60" (x 478–512). There is no overlap. No other label overlaps a bridge label in either city at the fitted view. The layout test (`consequences_layout_and_a11y`) already checks that each label is either fully in the layer or hidden.

## Findings
- **m1 (minor): the 8 px lower bound is relative to the mean of both directions' midpoints.** look.spec's `selected_halo_keeps_opposite_hatch` samples at the E→W midpoint. That point is 0.6–1.6 px above the mean in River City (3.2 px in three_bridges), so a label at exactly the 8 px boundary could overlap that sample by about 1 px row. This is not a gap in practice:
  - the implementation keeps a 12 px gap;
  - the frozen look.spec tests run in the same suite and are the real guard.

  No fix is required. Optionally, measure the gap from `min(y_we, y_ew)`.
- **m2 (minor): the "above" placement is only meaningful for roughly horizontal bridges.** For a N–S bridge, a label 12 px above the midpoint would sit on the deck. Both cities' bridges are W–E (verified above), and the brief's city is fixed and hand-designed, so this is hypothetical. The ward text ("just above … never covering it") is correct for v1. A future city with non-horizontal bridges must revisit this (the label would need offsetting perpendicular to the deck).
- **m3 (minor, test gap, auto-fixable, not required for approval): test 7b only checks label count and names in three_bridges, not placement.** The probe shows that three_bridges complies (gap 12, dx 0). Optional fix test: in 7b, for each `['north_bridge','central_bridge','south_bridge']`, apply the same four assertions as in test 7:
  - |box centre x − mid x| ≤ 6;
  - 8 ≤ mid y − box bottom ≤ 30.

  Also, constant pixel offsets are only checked at the fitted view. At high zoom the deck grows wider than 12 px, and the label would sit on the deck (but not on a sampled test point). This is acceptable because frozen look tests sample only at the fitted view.
- **Ward text:** the map bullet and row 7 now match the test exactly. The reason and the source (Red r4) are recorded. There is no contradiction with other rows: 9 checks label count on both halves, and 10 checks layout fit.

## Commands and results
- `git status --short` → only the two untracked `web/zz-alt-port*.config.ts` (pre-existing).
- `shasum -a 256 web/e2e/motion003.spec.ts` → ddcfb5fe…a378. `git show f3f39ef:web/e2e/motion003.spec.ts | shasum -a 256` → 59b05a8b…203b3f.
- Temporary probe `web/e2e/zz-r4-measure.spec.ts` (both cities, label boxes, link midpoints and other label layer elements): `node_modules/.bin/playwright test -c zz-alt-port.config.ts e2e/zz-r4-measure.spec.ts --reporter=line` → 2 passed (values in the table). The file was deleted.
- `cd web && node_modules/.bin/playwright test -c zz-alt-port.config.ts e2e/motion003.spec.ts e2e/look.spec.ts --reporter=line` → **17 passed (4.5m)**. These include `hatch_leaves_junctions_clear`, `hatch_moves_with_the_map`, `selected_halo_keeps_opposite_hatch`, `intervention_summary_and_map_markers`, `consequences_in_three_bridges` and `consequences_layout_and_a11y` ×3.
- Git status afterwards is unchanged apart from this file.

---

## Applied (round 4, convergence rule, 2026-10-13)

APPROVED, so this is logged as `-auto`.
- **m3:** applied. Test 7b now checks the same label placement for all three three_bridges bridges: within ±6 px, and 8–30 px above the midpoint. It passes (19 s).
- **m1, m2:** noted. m2 (bridges that are not horizontal) is recorded for a future city.

**Frozen (sha256):**
- `web/e2e/motion003.spec.ts`: `9b9ca968622bccc86169b1819faa0644c2aae9170498708fc53bfad02da4095e`
- `web/tests/motion003.test.ts`: `4ea646df425d5516483754ac8a80871df3ad8faa1901315156cd94a691dbee4f` (unchanged)
- `crates/sim-core/tests/motion_003_consequences.rs`: `26d2388bdbd244cdc8058316bb98f084e7f0e25a13005b1e204b86a16a387b87` (unchanged)
