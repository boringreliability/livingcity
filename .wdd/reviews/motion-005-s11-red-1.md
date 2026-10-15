# motion-005 S11 Red review r1

**Verdict: APPROVED**

Reviewer: a fresh adversarial Red reviewer (subagent), 2026-10-15. Artifacts only: the authorization, supersessions row S11, `web/e2e/motion.spec.ts`, the ward Must NOT bullet, and the frozen `epic_wiring_and_docs` check. No product code was changed.

## Identity

- `git show f66e2f6:web/e2e/motion.spec.ts` sha256 `c7f494ec0c65746c6be3dc1aeac4d3582df9206b8cf3e5f9223ee2f4603bee45`, matching the S11 row.
- The skipped `closed_road_marked_at_every_zoom` body is byte-identical once `test.skip(` is put back to `test(`. The SUPERSEDED comment is the only addition, and `supersessions.md` is on the line immediately above the skip.
- The replacement keeps the three zooms and `c.bright - b.bright >= 20` (luminance ≥ 220). The capture hides every element except the canvases.

## Commands

| What | Result |
|---|---|
| `pnpm -C web exec vitest run tests/motion005.test.ts -t epic_wiring` | 1 passed, 1 skipped |
| `pnpm -C web exec playwright test e2e/motion.spec.ts -g closed_road_marked_at_every_zoom_s11` | 1 passed (26.4 s) |
| Ring mutant (midpoint-ring vertices removed from `barMesh`, file restored) | 1 failed (21.3 s) at zoom 0.07: `0 → 0`, expected ≥ 20 |
| Style mutant (copied spec without the `body *` hide, copy deleted) | 1 failed (38.4 s): `.bridge-label` visibility was `visible` |

## Findings

- minor: the replacement also moves the mouse to (3, 3), waits 100 ms, and requires a `.bridge-label` with `visibility: hidden` during the capture. The style mutant fails on that check, not on the pixel count. The ring mutant still fails on the pixel assertion, so the marker requirement is not weakened.
- minor: at `MIN_ZOOM` 0.05 the ring mutant's difference was still ≥ 20 (hatch and barriers remain). The test still fails, at zoom 0.07 (`0 → 0`). The assertion is the one the frozen test had.

## Red snapshot

`web/e2e/motion.spec.ts` `2df0b3440aa76e5bfe71afc98ae78228f68d7a6a15d1383c10916f980c8cd668`
