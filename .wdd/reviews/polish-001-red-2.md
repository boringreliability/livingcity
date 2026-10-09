# polish-001 Red review #2

**Verdict: APPROVED**

Reviewed at commit `9770e2c`. Reviewer: a fresh adversarial Red-gate subagent.

| File | sha256 |
|---|---|
| `web/e2e/a11y.spec.ts` | `95f13b3fa4b0f9cb1fd5e06898b9e2a397ba563657ad68ea9ee3c559978d8501` |
| `web/tests/a11y_docs.test.ts` | `d8cd30e271fa78ef21dfec4ae027bc165813c27d0bc295026679d91e775de728` |

## What I ran

- **`pnpm -C web exec vitest run tests/a11y_docs.test.ts`: 2 of 2 failed.** Both fail for the intended reason.
  - Test 8 fails at `comment names /no[ _]?route/i`. The current comment says only "unreachable + gridlock".
  - Test 9 fails at `not.toMatch(/two Bs/i)`.
- **`pnpm -C web exec playwright test e2e/a11y.spec.ts`: 1 passed, 6 failed (2.7 min).**
  - **1** passed.
  - **2** fails at `:220`: the confirm panel is still there after Esc (a1).
  - **3** fails at `:256`: activeElement is still SELECT after the pointer pick (a2).
  - **4** fails at `:283`: the confirm panel is still there after Esc.
  - **5** fails at `:356`: the heading reads "Viewing A: original" (b5).
  - **6** fails at `:380`: there is no h1.
  - **7** fails with only `moderate page-has-heading-one: html`.

  Every failure is for the intended reason.
- **Probes** (`scratchpad/red-p001-r2/zz_red2_probe.spec.ts`). Each was copied into `web/e2e/` only for the run, then deleted.
  - **A: test 3 with a minimal correct implementation.** I injected a `change` listener into the page: it blurs only when a pointerdown or mousedown came first, and a keydown clears the flag. The full flow of test 3 then **passes** on headless Chromium on macOS. It takes 11 Tabs to reach Speed, and typing `2` gives 20 with focus kept. Round-1 B1 is resolved.
  - **B: teeth of the new slider-Esc step in test 2.**
    - The road selection survives switching A→B→A (`selectedLink` stays 24), so the step does not pass vacuously.
    - With a slider keydown handler that swallows Escape, the selection stays at 24, so test 2's poll would fail. The step has teeth.
  - **C: h1 area under common visually-hidden CSS.**
    - The classic `sr-only` CSS (1px × 1px, clip) gives area 1, so it passes.
    - The `width/height 1px` + `clip-path` variant gives area 1, so it passes.
    - A `clip-path: inset(50%)` without a width or height gives area 16147, so it fails. See m3.
- **I checked frozen specs for conflicts:**
  - `acceptance.spec.ts:150-178`: Tab to the slider and to Compare.
  - `compare.spec.ts:288`: the title "Exit comparison to change roads".
  - `timeline.spec.ts`: the "Viewing …" text only outside compare.
  - All Escape uses in `inspect`/`gold_city003`/`review*`: Esc with focus outside the confirm panel.

  None conflicts with tests 1–9.
- `git status` was clean afterwards apart from this file.

## Round-1 findings

| # | Status |
|---|---|
| B1: arrows on the mac `<select>` | **Resolved.** The test types `2` → 20×, and probe A shows that a correct implementation passes. |
| M1: test 4 accepted the body | **Resolved.** `focusIsSane` now rejects the body (`:168`), and Esc on the road panel must land on a control. Outputs and test now agree. |
| m1: tabindex=-1 escaped test 1 | **Resolved.** Native controls are expected even with tabindex=-1 (`:112-114`). |
| m2: vehicle/confirm panels not toured | Open (minor, below). |
| m3: D case in the table | **Resolved.** It was dropped from the table. |
| m4: Esc on the slider | **Resolved** (`:233`). Probe B shows the step has teeth. |
| m5: Esc in the open Speed list | Open (minor). |
| m6: gone-notice Esc | Open (minor). |
| m7: `NoRoute` spelling | **Resolved** (`a11y_docs.test.ts:23`). |
| m8: Memory phrasing | Loosened, but the order is still not checked (m2 below). |
| m9: h1 visually hidden | **Resolved** (`:382`). It is pinned as area ≤ 1 px² in the Tests table. |
| m10: coupling | Accepted. |

## Findings

### BLOCKER
None.

### MAJOR
None.

### MINOR

- **m1. Coverage gaps carried over from round 1.** None of these is required by a Tests-table row, so none blocks.
  - Test 1 does not Tab-tour the vehicle panel or the confirm panel. The table says "the panel buttons".
  - The rule "Esc must not act while the Speed list is open" is untested.
  - The gone-notice Esc path is untested.

  Cover them in the Gold reviewer's smoke test, or in a later regression file. The frozen file must not change for them.
- **m2. Test 9 does not check the order of the wording** (`a11y_docs.test.ts:37-38`).
  - Today's wrong sentence, "the new B is built **before** the old one is **freed**", satisfies both `/\bfree[sd]?\b/` and `/\b(before|first)\b/`.
  - Only `not two Bs` and `A plus (one|a single) B` carry the meaning. A self-contradictory sentence that keeps "built before … freed" next to "A plus one B" would still pass.

  The implementer should write the sentence so that "old B" and "freed" come before "new". The test will not enforce it, so the Gold reviewer should read the line.
- **m3. Test 6 pins one way of hiding the h1** (`a11y.spec.ts:382`). The check `area ≤ 1` accepts the classic `sr-only` CSS, which has an explicit 1px × 1px box. It rejects a `clip-path`-only technique (probe C: area 16147). The Tests table states the ≤ 1 px² rule, so the implementer has been told. This note is only so nobody "fixes" it later.
- **m4. Test 7 relies on D not being swallowed** (`a11y.spec.ts:409-411`). After two Escapes, `d` is pressed without a `blur`.
  - Suppose an implementation moves focus to a **button** whenever Esc closes a panel, even when focus was not inside that panel. Then `d` is ignored (`App.tsx:606`) and test 7 fails at `:412` for a reason unrelated to axe.
  - The spec moves focus only "when a panel that holds focus closes". In test 7, focus is on the body after a canvas click, so a conforming implementation passes.

  For the implementer: move focus only if `document.activeElement` was inside the removed panel.
- **m5. Test 9 is coupled to the free call's syntax** (`a11y_docs.test.ts:45`). `/scenarios\[1\]\??\.free\??\.\(\)/` matches `scenarios[1]?.free?.()` (host.ts:401). It does **not** match `scenarios[1].free()` or `scenarios[1]!.free?.()`, the form used in discard at `:436`. The ward does not require any change to host.ts, so leave `branch()` as it is.
- **m6. `focusIsSane` counts any `[tabindex]` element as a "control"** (`a11y.spec.ts:170`). That includes `tabindex="-1"` containers, and even the 1px h1 if someone gave it a tabindex. Focus parked on an invisible 1px element would pass. Moving focus to a container is a legitimate pattern, so this is only a note: the Gold reviewer should check where focus actually lands, and that it is visible.

## Checked and fine

- Test 3's pointer half fails for the right reason, and its keyboard half is achievable on this platform (probe A).
- Test 4 now has teeth for every case where the focused node disappears: confirm Esc, Replace, Esc on the road panel, and Discard. "Leaving compare" is a guard against the compare button being remounted.
- Test 2:
  - It is deterministic, because branching or viewing pauses the clock.
  - The selection persists across view switches, so `:227` and `:235` are meaningful.
- Test 5's B and A single-view assertions already pass. Only the compare part fails (b5), as intended.
- Test 7 is clean in 6 of 7 states today. The only violation is the expected moderate `page-has-heading-one` in compare.
