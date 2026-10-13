# User authorization 2026-10-13: S9 (sweep timeout) and a manual CI deploy

During ward motion-005, the Gold r1 review found two problems:
- GitHub Actions had been red on `main` since motion-002. The frozen test `3b visual_rule_sweep` in `web/tests/motion002.test.ts` exceeds its 600 s timeout on GitHub's runners; it takes about 250 s on an M4 Pro.
- The CI `deploy` job runs automatically on a green push to `main`.

**The question put to the user** (in Danish, quoted verbatim):

> needs input: Må jeg (1) supersede timeouten i den frosne `3b visual_rule_sweep` fra 600 s til 1800 s med uændrede påstande, og (2) gøre `deploy`-jobbet manuelt (`workflow_dispatch`), så en grøn CI ikke deployer automatisk? Eller foretrækker du et andet valg?

In English: may I (1) supersede the timeout of the frozen `3b visual_rule_sweep` from 600 s to 1800 s with the assertions unchanged, and (2) make the `deploy` job manual (`workflow_dispatch`), so that a green CI does not deploy automatically? Or would the user prefer another option?

**The user's answer:** "ja" ("yes").

**Scope:**
- Supersession S9 covers only the timeout of that one test. The assertions, loops and steps stay identical, and the replacement is `3b-ci visual_rule_sweep`.
- In `.github/workflows/ci.yml`, the `deploy` job runs only on a manual `workflow_dispatch` on `main`. The Web job's timeout was raised to 60 minutes so that the slower sweep fits.
- Nothing is deployed by this change.
