---
name: ward
description: "Continue working on the current WDD Ward. Checks ward status and follows checkpoint discipline with mandatory human approval gates."
---

# /ward — Continue Current Ward

Run `wdd session` to find the current ward and its status, then follow the appropriate flow:

## planned — Start Red phase
1. Run `wdd ward status <id> red`
2. Write tests per the ward spec's Tests table
3. Present tests to user
4. ⏸️ **STOP — Wait for explicit approval. Do NOT proceed.**

## red — Tests written, awaiting approval
1. Present the tests if not yet shown
2. ⏸️ **STOP — Wait for explicit approval. Do NOT proceed.**

## approved — Start Gold phase
1. Run `wdd ward status <id> gold`
2. Implement until all tests pass
3. Read the `## Manual Smoke Test` section from the ward file
4. **Spin up the solution** (build, npm link, dev server, etc.) per the Setup subsection
5. **Provide the exact Steps as copy-pasteable commands to the user** and wait for them to run
6. Present implementation results AND smoke test outcome to user
7. ⏸️ **STOP — Wait for explicit approval of BOTH automated tests AND smoke test. Do NOT proceed.**

## gold — Implementation done, awaiting approval
1. Run the tests. If failing, fix implementation (not tests).
2. Run the Manual Smoke Test from the ward file if not already done in approved-phase
3. Present results to user — automated tests + smoke test outcome
4. ⏸️ **STOP — Wait for explicit approval. Do NOT proceed.**
5. When approved: run `wdd complete <id>` and follow its output

**The Manual Smoke Test is mandatory before Gold approval. Automated tests prove functions work — the smoke test proves the human can use the result.**

## complete — Ward is done
- Tell user this ward is complete
- Suggest creating the next ward with /ward-new

## blocked — Ward is blocked
- Show what the ward depends on
- Suggest resolving the blocker

**NEVER skip a checkpoint. NEVER proceed without the user saying "approved" or "godkendt".**
