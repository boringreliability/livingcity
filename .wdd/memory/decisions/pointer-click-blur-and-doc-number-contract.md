# Pointer-clicked buttons give focus back; docs cite only measured numbers (timeline-005, 2026-10-09)

## Pointer-click blur
- **Decision.** A window `click` listener blurs a `<button>` when the click came from a pointer (`e.detail > 0`). Keyboard activation (`detail === 0`) keeps focus. See `web/src/App.tsx` and the regression spec `web/e2e/gold_timeline005.spec.ts`.
- **Why.**
  - Global shortcuts are ignored while focus is in a control. After a mouse click on "Close the main bridge", "Close link" or "Compare side by side", the next Space therefore re-pressed that button: it reopened the bridge or left compare.
  - `docs/demo.md` says "press Space" right after those clicks. Gold r1 followed the demo literally and found it failing.
  - The acceptance spec had hidden the problem by calling `blur()` before each Space.
- **Not covered.** The Speed `<select>` still keeps focus after a pointer pick (polish backlog).

## Docs ↔ measurement contract
`web/tests/integration.test.ts` test 6 requires every number in `docs/performance.md` § Timeline to be a value in `web/perf-results/timeline.json`:
- integers must match exactly;
- decimals must match at the same precision.

This has consequences:
- No thousands separators, no "10×" style prose numbers, and no ward ids such as `-005` in that section.
- Re-running `e2e:perf` rewrites the JSON. Update the section, or restore the committed JSON, before running the tests.
