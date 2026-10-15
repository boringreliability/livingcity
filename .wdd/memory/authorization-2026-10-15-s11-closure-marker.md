# User authorization 2026-10-15: S11, and a standing rule for frozen tests

CI run 38636714605 on `f66e2f6` failed one E2E test: the frozen `web/e2e/motion.spec.ts` › `closed_road_marked_at_every_zoom` (polish-003). It counts light pixels in a 14×14 page clip at the Main Bridge midpoint, before and after the closure, at three zooms. The closure must add at least 20 light pixels.

On that run, at `MIN_ZOOM` 0.05, the count fell from 125 to 77. Three local runs were 0 before and about 75 after. The closure ring is drawn the same in both places. The window also contains HTML overlays (`.bridge-label`, `.queue-pin`), which arrived in motion-003 after the test was frozen. On CI, with Linux fonts and a different queue at the pause, one of them covered the window before the closure and was gone after. The test passed on the previous CI run, so it fails only sometimes.

**The question put to the user** (in Danish, quoted verbatim):

> Hvordan skal jeg håndtere `closed_road_marked_at_every_zoom`?
> - **(A) Anbefalet, S11:** jeg erstatter kun måleteknikken. Testen skjuler HTML-overlays (labels og pins) under pixelmålingen, ligesom motion-005's B-pixeltest gør. Den tester stadig, at lukningen tilføjer en lys markør ved alle tre zoomniveauer, og det hele går gennem en ny Red-gate. Derefter pusher jeg, og Gold r4 kører på den næste CI-kørsel.
> - **(B):** testen står urørt og noteres i epic-gaten som kendt ustabil test på CI, sammen med latency-testen. Gold r4 kører så med de kendte ustabile tests som undtagelse.

**The user's answer:** "A - og frosne tests skal altså ikke tages så bogstaveligt at vi holder fast i forkert opførsel. HVIS en frossen tests fastholder noget uhensigtsmæssigt bør vi altid ændre den."

**Scope of S11:** only the pixel measurement of that one test. The replacement, `closed_road_marked_at_every_zoom_s11`, is the same test with HTML overlays hidden during each capture (`body *` hidden, `canvas` visible), the same way motion-005 reads B's map. Vehicles stay hidden. The assertion is unchanged: at each of the three zooms the closure adds at least 20 pixels of luminance ≥ 220. No product change.

**Standing rule, from the same answer.** A frozen test pins a requirement, not an implementation, and not a behaviour that is undesirable. When a frozen test preserves undesirable behaviour, supersede it. Do not keep that behaviour because the test is frozen, and do not wait for a separate authorization for that case.

The supersession process is unchanged: do not weaken an assertion in place, do not delete the test, keep the valid intent in a replacement, send the replacement through a Red gate, and log the row in `.wdd/memory/supersessions.md`.

Still never superseded unless the user names them: determinism, replay correctness (restore ≡ uninterrupted run, golden `state_hash` values), branch independence, identical external demand, and meaningful comparison metrics (including incomplete and unserved trips).
