# polish-001 Red review #1

**Verdict: REJECTED**

Reviewed at commit `23722e1`. Reviewer: fresh adversarial Red-gate subagent.

| File | sha256 |
|---|---|
| `web/e2e/a11y.spec.ts` | `91df1ba25d9d320bd06a2fc5aecad2fe284502fbb456124d62def6a8c1e0064d` |
| `web/tests/a11y_docs.test.ts` | `629c1f829eae23e1dba1116966723177b2fe2be82841ac0d702f5c10b9dd6696` |

## What I ran

- `pnpm -C web exec vitest run tests/a11y_docs.test.ts` gave 2 failed out of 2.
  - Test 8 fails at the first comment term: `comment names /no[ _]route/i`. The docs half of test 8 already passes, because `traffic-model.md:107` names all four terms.
  - Test 9 fails at `not.toMatch(/two Bs/i)`. The host half already passes, because `host.ts:401` frees the old B before `a.branch(` on line 404.
  - Both fail for the intended reasons.
- `pnpm -C web exec playwright test e2e/a11y.spec.ts` gave 1 passed and 6 failed in 2.8 min:
  - **1 passed** (5.4 s).
  - **2** fails at `:218`: the confirm panel is still there after Esc (a1). This is the intended reason.
  - **3** fails at `:253`: activeElement is still SELECT after the pointer pick (a2). This is the intended reason, but see B1.
  - **4** fails at `:280`: the confirm panel is still there after Esc. This is the intended reason.
  - **5** fails at `:353`: the heading reads "Viewing A: original" while comparing (b5). The B and A single-view parts already pass. This is the intended reason.
  - **6** fails at `:371` with 0 h1. This is the intended reason.
  - **7** fails in the **compare** state only, on `page-has-heading-one`. The other six states are already clean. This matches the baseline.
- **Probe of a native `<select>`** in the same headless Chromium on macOS, with the e2e launch args (`select_probe*.mjs` in the scratchpad). Focus via Tab, then:
  - `ArrowUp` and `ArrowDown` leave the value **unchanged** and fire no `change`. The first arrow opens the mac popup, and later keys (`Enter`, arrows) do not commit anything.
  - Type-ahead does change the value and fires `change`: `2` → 20, `1` → 1.
  - A pointer pick (`click` + `selectOption`) followed by `blur()` in the `change` handler leaves focus on BODY, and the next Space and `b` reach `window` as keydown events on BODY. The pointer half of test 3 is sound.
  - After a focused element is removed, `document.activeElement` is BODY (connected).
- **Teeth probes for test 1**, run temporarily as `web/e2e/zz_red_teeth.spec.ts` and then deleted:
  - `.diag-toggle:focus-visible{outline:none}` makes the test fail ("focus ring on f2-Diagnostics"). It has teeth.
  - A 1px slider outline makes the test fail ("focus ring on f9-Timeline"). It has teeth.
  - `tabindex="-1"` on the Diagnostics button: the test **still passes**. It has no teeth for this case (see m1).
  - Esc with focus on the slider clears the road selection today (`selectedLink → null`).
- `git status` is clean apart from this file.

## Findings

### BLOCKER

**B1. Test 3's keyboard half cannot pass on this platform** (`web/e2e/a11y.spec.ts:266-267`)
- `ArrowUp` on a focused, closed `<select>` in headless Chromium on macOS opens the native popup and does **not** change the value; I confirmed this in isolation (value stays `60`, no `change` event). `expect(speed).not.toHaveValue('60')` will therefore fail for **every** implementation, including a correct one, and the test is frozen after approval. (On Linux, arrows do change the value, so the test is platform-dependent as well.)
- The open popup also swallows later keys, so the test cannot recover within the same step.
- **Fix:** make the keyboard change with type-ahead, which works on every platform and fires `change` without a pointer. For example, `await page.keyboard.press('2')` → `toHaveValue('20')`, then assert that focus is still on the select. Update the Tests-table wording from "ArrowUp or ArrowDown" to "a keyboard selection (type-ahead)".

### MAJOR

**M1. Test 4 cannot fail on its named property, and it accepts body where the ward requires a sensible element** (`web/e2e/a11y.spec.ts:162-172`, used at `:281,290,296,305,310`)
- In Chromium, `document.activeElement` is never a detached node. When the focused element is removed it becomes `body`, which I confirmed by probe. `focusIsSane` returns `ok` for `body`, so "never left on a removed element" passes by construction.
- Today the road-panel case (Esc while "Close link" has focus) already leaves focus on body, and the test accepts that. The ward's Outputs say "focus moves to a **sensible, visible element**". The only thing test 4 enforces is that Esc closes confirm, and test 2 already covers that.
- **Fix:**
  - For the cases where the focused control disappears, require `activeElement !== body` and a visible control. The cases are Esc on confirm, Replace, Discard branch, and Esc on the road panel. For confirm, Replace and Discard, the slider is the existing convention: `focusSlider()` and `onDiscard`.
  - Keep `body` acceptable only where nothing was removed, such as leaving compare.
  - If body is meant to be acceptable for the road panel, say so in the Outputs. As it stands, the Outputs and the test disagree.

### MINOR

- **m1. Test 1 cannot detect a control taken out of the tab order** (`:112`). `focusables` keeps only `tabIndex >= 0`, so a control set to `tabindex="-1"` drops out of the expected list as well (probe: still passes). Build the expected list without the `tabIndex` filter (visible, enabled `button, select, input, [role="slider"]`), or assert a fixed list of named controls.
- **m2. Test 1 does not tour the vehicle panel or the confirm panel.** The table says "the panel buttons", but Follow, Stop following, Dismiss, Replace and Cancel are never Tab-visited. Add a `tabTour` with a tracked vehicle and one with confirm-replace open.
- **m3. Test 4 omits a case listed in the Tests table:** "D toggling diagnostics off while its button had focus". Either add the step or drop it from the table. Note that D is ignored while a button has focus (`App.tsx:606`), and `DiagnosticsPanel` has no focusable children, so as written the case is a no-op.
- **m4. Esc on the slider is not exercised.** The spec says "Esc must still work while focus is on a button or the slider". It works today (probe), but nothing guards it. A slider `onKeyDown` that swallows every key would go unnoticed. In test 2, add a final Esc with `slider.focus()` before it.
- **m5. The rule "Esc must not act while focus is in the Speed select's open list" is untested.** Add a step: focus the select, press ArrowDown (which opens the list on mac), then Escape, and check that `selectedLink` and `trackedTrip` are unchanged.
- **m6. The Esc path for the gone-notice is untested.** Spec step 2 says "a vehicle tracked **or gone-notice shown**".
- **m7. Test 8's comment regex rejects the codebase's own spelling** (`a11y_docs.test.ts:23`). `/no[ _]route/i` does not match `NoRoute`, which `traffic-model.md:107` uses, while the docs check on line 28 uses `/no ?route/i`. Use `/no[ _]?route/i` on both lines.
- **m8. Test 9's phrasing regex is narrow** (`:36`).
  - Correct sentences fail. "frees the old B first, then builds the new one" fails because neither `freed?` nor `before` matches.
  - A wrong sentence passes that half: "before … built" matches "the new B is built before …"-style word orders whenever "before" precedes "built".
  - Fix: accept `\bfree(d|s)?\b` and require that "old B" precedes "new" in the sentence. Otherwise, pin the exact sentence in the ward spec so the implementer knows it.
- **m9. Test 6 does not check that the h1 is visually hidden** or its text ("Living City: traffic simulation"). A visible h1 that shifts the layout would pass. Optionally assert a ≤1px box or a clip.
- **m10. Implementation coupling** (accepted, noted):
  - test 5 locates the heading by `.scenario-label` (`:336`);
  - test 9 locates the free call by the names `scenarios[1]` and `a.branch(`.

  Both name existing code, so this is fine, but renaming either breaks a frozen test.

## Checked and fine

- **Conflicts with frozen tests:** none found.
  - `compare.spec.ts:288` pins the disabled title `'Exit comparison to change roads'`, which satisfies test 5's non-empty title check.
  - `timeline.spec.ts:219,232,312` assert "Viewing …" text only outside compare.
  - All specs locate the bridge by the fixed `aria-label` "Close the main bridge", so test 5's `toHaveText` reads the visible text, not the name.
- **Test 2 is deterministic:** `branch` and `viewScenario` both call `clock.setRunning(false)` (`host.ts:410,425`), so `headTick` does not drift between `aBefore` and the check.
- **Test 1 handles wrap-around:** forward `id === null` skips are symmetric with back `BODY` skips. Chromium resumes Tab after the last blurred element, which `forward` handles via the set comparison.
- **Test 1's ring check has teeth:** the UA default `outline: auto 1px` fails the `≥ 2px` check. No focusable has a decorative `box-shadow`; the only one, `styles.css:421`, is on `.timeline-playhead`, which is not focusable.
- **Test 7 matches the spec:** it covers the 7 states, uses the default rule set, and the failure message lists the rule ids and targets.
