# motion-005 S9 — Red gate review 2 (supersession of `3b visual_rule_sweep` timeout + manual deploy)

**Verdict: APPROVED**

Reviewer: fresh adversarial Red reviewer (subagent), 2026-10-13. Static review plus `typecheck` and `motion005.test.ts`. The sweep was deliberately not run, because a measurement is running on this machine.

Scope: the uncommitted changes on top of HEAD 18c0f74, found with `git diff -- web/tests/motion002.test.ts .wdd/memory/supersessions.md .github/workflows/ci.yml README.md .wdd/wards/motion/ward-005.md`, plus the new `.wdd/memory/authorization-2026-10-13-s9-ci.md`. The Pause smoke-step edit in ward-005 (line ~128) belongs to the motion-005 Gold fixes and is outside this review.

## r1 findings: resolution

| r1 | Status | Evidence |
|---|---|---|
| M1: the ward spec forbids supersessions and omits S9/CI | **Resolved** | `ward-005.md:106` now reads "…except S9: the user authorized on 2026-10-13 (`.wdd/memory/authorization-2026-10-13-s9-ci.md`) superseding only the 600 s timeout … now `3b-ci` with 1800 s and identical assertions". The Deploy must-not line records that the CI `deploy` job is now manual-only under the same authorization. |
| m1: the log header covers only the 10-11 authorization | **Resolved** | `supersessions.md` has a new paragraph, "**Second authorization (S9 only):** …", stating that S9 is not one of the 10-11 behaviour classes and rests on a separate authorization. |
| m2: the authorization is not durable | **Resolved** | The new file `.wdd/memory/authorization-2026-10-13-s9-ci.md` holds the verbatim Danish question, an English translation, the answer "ja" and the scope: the timeout only, assertions unchanged, deploy manual-only, Web job at 60 min, nothing deployed. The S9 row, the header and the ward spec all link to it. The question covers exactly what was changed and nothing more. |
| m3: the CI duration is unmeasured | **Open (accepted)** | Still to be recorded after the first CI run. Nothing in the repo yet notes it as a to-do (ward spec, known-issues). Carry it to the Gold/epic gate so that it is not forgotten. |
| info: Cloudflare Git auto-deploy | **For the user** | This cannot be verified from the repo. The user should check the Pages project in the Cloudflare dashboard. |

## Core checks (re-verified)

1. **The old test is only skipped.**
   - `git show HEAD:web/tests/motion002.test.ts | shasum -a 256` = `bd9de6d6…af98…`. Full hash: `bd9de6d61ae82aafafb8a0e83ac6b9024a8eda83983d5f3a396a88c2667b4246`, the same as the S9 row. HEAD is `18c0f74`, as the row says.
   - A script (`chk.py` in scratchpad) reconstructed the working-tree file: it removed the 2-line comment, turned `test.skip(` back into `test(`, and removed the inserted `3b-ci` block. The result is **byte-identical to HEAD** (`reconstruct==HEAD True`).
   - The skipped test keeps `}, 600_000);`.
   - The `SUPERSEDED … S9 in .wdd/memory/supersessions.md` comment is on line 527, two lines above the `test.skip` on line 529, so within 3 lines.
   - There is no `.only` or `describe.skip` in the file.
2. **The `3b-ci` body is byte-identical.**
   - The 53-line body of `3b-ci visual_rule_sweep` equals the HEAD `3b` body: `True`.
   - The only differences are the name and the timeout, which is `1_800_000`, plus one comment line above it.
   - `web/vite.config.ts` has no `testTimeout` cap.
3. **The S9 row is complete.** It has all 7 columns:
   - ward;
   - file with its sha256 at 18c0f74;
   - test;
   - pinned behaviour (600 s);
   - why unwanted, which also carries the authorization: its date, "ja", a link and the scope;
   - the replacement.
4. **CI.**
   - Triggers are unchanged: push to main, pull_request, workflow_dispatch.
   - `deploy`: `needs: [rust, web, e2e]` and `if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'`. Neither a push nor a PR can satisfy this condition, and `ci.yml` is the only workflow.
   - `web` has `timeout-minutes: 60`. Rust stays at 30, E2E at 60 and deploy at 10.
   - The README paragraph is accurate. No doc still claims that CI deploys on push.
5. `pnpm -C web typecheck` is clean. `vitest run tests/motion005.test.ts` passes: 2/2.

## Findings
- None blocking.
- m3 (carried over, minor): record the actual GitHub runtime of `3b-ci`, and of the Web job, after the first CI run. 1800 s per test and 60 min per job are still unmeasured margins.
- info (for the user): confirm in the Cloudflare dashboard that the Pages project has no Git integration that deploys on push independently of CI.
- info: `CONTEXT.md:61` says "CI green on Ubuntu" for epic `fonts` (2026-10-12). This is consistent only if `fonts` predates motion-002. When CONTEXT.md is next updated, state that CI has been red since motion-002 until S9.
