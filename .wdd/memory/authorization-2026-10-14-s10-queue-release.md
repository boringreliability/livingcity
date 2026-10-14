# User authorization 2026-10-14: S10 (motion-005 queue release check)

The motion-005 Gold r2 review (`.wdd/reviews/motion-005-gold-2.md`, MAJOR 2) found that motion-005's own frozen `flow_queue_forms_and_releases` (`web/e2e/motion005.spec.ts`) failed on GitHub's CI.
- The test compares with the queue at the reopen (`q0`).
- After 3–10 s of wall-clock observation at 1× and 20×, the pinned queues had mostly drained on the slower runner, so `q0` was 6.
- Ordinary stop-and-go then left 4 cars, against a limit of 3.

**The question put to the user** (in Danish, quoted verbatim):

> Motion-005-køtesten `flow_queue_forms_and_releases` fejlede på CI. Skal den have:
> - **(A) Anbefalet:** jeg udskifter kun dens frigivelsestjek som S10 og sender det gennem en ny Red-gate. Kravet bliver, at køen er højst halveret eller ligger højst 2 biler over niveauet med åben bro, og at der står mindst 10 biler i kø, når broen genåbnes.
> - **(B):** testen står urørt og noteres som en kendt ustabil test på CI i epic-gaten.

In English: should the test get (A, recommended) a replacement of only its release check as S10, through a new Red gate? The release requirement becomes: the queue is at most halved, or at most 2 cars above the open-bridge level, and at least 10 cars are queued when the bridge reopens. Or (B): the test stays untouched and is noted as a known CI flake at the epic gate.

**The user's answer:** "a".

**Scope:** only the release section of that one test. Everything before it (the closure, the queue forming within 20 sim min, the observation at 1× and 20× with queued cars held behind the stop line) is byte-identical in the replacement, `flow_queue_forms_and_releases_s10`.

**Second question, after S10 Red r1 and a measurement** (in Danish, quoted verbatim):

> Hvilken vej skal S10-frigivelsestjekket gå?
> - **(A2) Anbefalet:** "broen kører igen i begge retninger inden for 5 sim-minutter, og køen vokser ikke".
> - **(B):** dropper S10. Den frosne test står urørt som kendt ustabil test på CI, men vær opmærksom på, at den ikke tester frigivelse.

**Context of that question:**
- S10 Red r1 (`.wdd/reviews/motion-005-s10-red-1.md`) showed that single `linkQueued` samples swing by tens of cars within sim seconds.
- Measured over 2 sim min with the bridge still closed, the mean queued on the pinned links was only 2.5–4.5: rerouting dissolves the closure's queue before the reopen.
- The frozen test's "halved" bound therefore measured noise. It also passed with the bridge still closed in the sim.

**The user's answer:** "Vi tager din anbefaling" ("we take your recommendation").

**What the replacement checks (A2):**
- Both Main Bridge links carry cars again (`linkCounts` > 0) within 5 sim min of the reopen.
- The mean queued on the pinned links over 2 sim min after the reopen is at most the mean over the 2 sim min before it, plus 2.
