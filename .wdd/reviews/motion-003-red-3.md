# motion-003 Red gate, round 3 (e2e amendment): APPROVED

Reviewer: a fresh adversarial test-review subagent. Scope: the amendment `git diff 6753f58 f3f39ef -- web/e2e/motion003.spec.ts`, which changes 2 lines (test 7 and test 8). No other file changed in f3f39ef.

## Hashes (verified, sha256)
- `git show 6753f58:web/e2e/motion003.spec.ts`: 469d96e65f319d88454b994b818f165e2a54d22f9b334ffc487cb77e2412a1fa. This matches the stated freeze.
- `web/e2e/motion003.spec.ts` in the working tree (= f3f39ef): 59b05a8b0e36ebcf23822f241c5094addcf7499af870637ace3162ecea203b3f. This matches the stated amendment.
- Note: red-2 recorded 231efbd… (that is 854eff9). The 854eff9→6753f58 tightening was added after that review. I reviewed it here (see m2).

## Verdict: APPROVED (0 BLOCKER, 0 MAJOR, 2 minor)

## (a) Test 7 reopen selector
**Claim verified.**
- `ControlPanel.tsx:105–106` sets `aria-label="Close the main bridge"` and `aria-pressed={bridgeStateHidden ? undefined : mainBridgeClosed}`. The visible text "Main bridge closed — reopen" is only the content.
- Under accname rules the aria-label wins over content, so `getByRole('button', { name: /reopen/i })` could never match the toggle.
- No other "reopen" button exists in that state. SelectionPanel's "Reopen link" needs a selected closed link, and the "Reopened …" markers are `role="img"` and do not exist yet.
- The name is pinned by frozen tests: `e2e/a11y.spec.ts:343,359` and `gold_timeline003.spec.ts:84`.
- Red-2's satisfiability note ("`.first()` resolves to it") was wrong.

**Strength: kept or improved.**
- `pressed: true` adds a precondition the old selector lacked: the toggle must report "closed" before the click.
- The click's effect is not trusted. The test asserts the result through the sim hook: exactly 2 interventions, `[['close','Main Bridge'],['open','Main Bridge']]`, with the open tick later than the close tick. After that come the "○ Reopened Main Bridge · hh:mm:ss" line, the ○ marker at ±2 px, and the rewind.
- So a click that did anything other than reopen the Main Bridge would fail.
- `toggleMainBridge` (`App.tsx:855–866`) sends `open` for all central_bridge links when they are closed.
- Playwright's string `name` is a case-insensitive substring match. Only one button contains "Close the main bridge", so this is not ambiguous.

## (b) Test 8 `\b` → `(?!\d)`
**Claim verified.** `SelectionPanel.tsx:39–40` renders `<dt>queued</dt><dd>{p.queued}</dd>` with no whitespace. `toContainText` reads textContent ("…queued50state…"), and `\b` between the digit and "s" never holds, so the old regex failed even for a correct value.

**No wrong number can pass.** I checked both regexes in node:

| q | text | old `\b` | new `(?!\d)` |
|---|------|----------|--------------|
| 50 | `queued50state` | false | true |
| 5 | `queued50state` | false | false |
| 5 | `queued15state` | false | false |
| 50 | `queued5state` | false | false |
| 5 | `queued5state` | false | true |

- The prefix `queued\s*` anchors the left side and `(?!\d)` the right side.
- `queued` is an integer count, so a decimal tail cannot occur.
- "queued" appears only once in the region (the dt). Titles are not part of textContent.
- The intent of red-2 m2 (exact count, not a substring) is preserved.

## Same-class sweep (accessible name vs visible text, textContent without separators)
Every other selector and text match is sound against the Gold DOM:
- `closeAndRun` `/close the main bridge/i` matches the aria-label.
- `Jump to start` is an aria-label (`TimelineBar.tsx:101`).
- Speed, Timeline and Compare side by side are fine.
- Markers: the aria-label is "Verb Label at hh:mm:ss" and the content is the glyph, so `toContainText('○')` works.
- The summary lines read `<span aria-hidden>✕</span> Closed …`. JSX keeps the literal space, so the textContent "✕ Closed Main Bridge · hh:mm:ss" holds.
- The queue pin's text is `▼ {queued}`, so it matches `^\s*▼ N\s*$`.
- The queue buttons' names are `Link N · q queued`, followed by a space, so link and count are both exact.
- Crossing rows: `th scope=row` is a rowheader, so `getByRole('cell')` returns exactly the 3 td.
- The comparison rows' names are `Crossings · Name`.
- Selection heading: `^Link N\b` is at the end of the string or before " (A)", so it is fine.

## Minor
- **m1.** Test 8 still matches the panel text as a whole rather than the `queued` dd specifically. That is acceptable: there is only one "queued", and both anchors are now exact. A dt→dd locator would be cleaner if the panel ever gains more "queued…" text.
- **m2 (process).** The 6753f58 pre-freeze tightening (exact pin regex n5, crossing rows in 7b n2) had no reviewer. I reviewed it now: both changes strictly strengthen the tests and pass against Gold. The freeze record should state that 469d96e…, not 231efbd…, is the approved r2 baseline, and that 59b05a8… is the r3 baseline.

## Commands and results
- `git diff 6753f58 f3f39ef --stat`: 1 file, +3/−2 (only the two lines above).
- `shasum -a 256`: as listed above.
- `cd web && node_modules/.bin/playwright test -c zz-alt-port.config.ts e2e/motion003.spec.ts --reporter=line` (port 5194, against the uncommitted Gold implementation): **8 passed (3.9m)**.
- Node regex table: as above.
- `git status --short` was unchanged before and after. The only addition is this file.

---

**Freeze record (m2):** the Red r2 baseline is `469d96e65f319d88454b994b818f165e2a54d22f9b334ffc487cb77e2412a1fa` (6753f58; it includes the two tightenings reviewed above). The Red r3 baseline, frozen now, is `web/e2e/motion003.spec.ts` = `59b05a8b0e36ebcf23822f241c5094addcf7499af870637ace3162ecea203b3f` (f3f39ef). The other motion-003 test files are unchanged since Red r2.
