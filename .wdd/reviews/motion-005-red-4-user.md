# motion-005 Red gate: APPROVED by the user after round 3 (2026-10-13)

## Decision
- The Red gate was rejected three times (r1: 3 MAJOR; r2: 1 MAJOR; r3: 1 MAJOR, 4 minor), so it was escalated to the user.
- The r3 findings were fixed in `4a4983a` and verified against the reviewers' mutation trees before the escalation.
- The user's decision, verbatim: "Hvis du har rettet runde 3 huller, behøver vi ikke r4" ("If you have fixed the round 3 gaps, we don't need r4").
- The tests are approved as of `4a4983a`, without a fourth review.

## How the round 3 findings were fixed (verified)
- **MAJOR 1: fixed 1.5 s windows starve under load.**
  - **Fix:** every sampler in flow 5 (running seek, paused seek, scenario switch) runs until ≥ 1.5 s have passed and ≥ 10 samples (11 for the switch) follow the event, capped at 10 s.
  - **Verified:** `base` 9/9 at load 15–30.
- **minor 1: mA can escape the 1× check on B.**
  - **Fix:** while running, tests 1, 4 and 5 require the presented tick to be fractional on ≥ 50 % of the samples.
  - **Verified:** mA is now caught at 1× and 20× in flows 1 and 5 (1×: steps of 13.8 m and 17.9 m; 20×: "presented between frames").
- **minor 2: the scenario switch lands on a paused A.**
  - **Fix:** the spec wording now says so, and A must be presented exactly at its own frame (`presA === tick`).
  - **Still open:** mS (the presenter ignores scenario and epoch) still passes. Viewing a scenario pauses it and A is behind B, so the tick-back reset hides the mutation. There is no visible defect in the product today.
- **minor 3: mGA2 (B's map draws A's traffic, two edits) passes flow 6.** Not changed; it stays open as optional.
- **minor 4:** the spec wording was corrected (mE is caught at both speeds; the 20× bound).

## Red snapshot (sha256)
- `web/tests/motion005.test.ts`: e7d3031affb29dc5f5a4fe8dc0320e985f1c3b16b70fab6ee6c04853b044af00
- `web/e2e/motion005.spec.ts`: 2589ddf4174895b45ca4bd0d7d94e847d5ebaf3b721373439c2ce09ee7e2d18d
