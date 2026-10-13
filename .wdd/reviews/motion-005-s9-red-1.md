# motion-005 S9 — Red gate review 1 (supersession of `3b visual_rule_sweep` timeout + manual deploy)

**Verdict: REJECTED**

Reviewer: fresh adversarial Red reviewer (subagent), 2026-10-13. Static review only (the sweep was deliberately not run; a measurement is running on this machine).

Scope: `git diff -- web/tests/motion002.test.ts .wdd/memory/supersessions.md .github/workflows/ci.yml README.md` (uncommitted, on top of 18c0f74), plus the ward spec `.wdd/wards/motion/ward-005.md` because CLAUDE.md requires the ward spec to list supersessions.

## Checks and evidence

### 1. Old test only skipped, comment, hash — PASS
- `git show HEAD:web/tests/motion002.test.ts | shasum -a 256` = `bd9de6d61ae82aafafb8a0e83ac6b9024a8eda83983d5f3a396a88c2667b4246`, identical to the hash in the S9 row ("at 18c0f74" = HEAD).
- Programmatic check (Python, HEAD file vs working tree): reconstructing the new file by removing the 2 comment lines above the old test, turning `test.skip(` back into `test(`, and removing the inserted 3b-ci block (comment + test) yields a file **identical** to HEAD. So nothing else in the file changed.
- The comment directly above (`// SUPERSEDED (motion-005, S9 in .wdd/memory/supersessions.md) ...`) is within 2 lines and names the replacement (3b-ci). The old test keeps `}, 600_000);`.
- No `test.only` / `describe.skip` / `it.only` in the file.

### 2. Replacing test body identical — PASS
- Body (53 lines between the `test(...)` line and the closing `}, <timeout>);`) of `3b-ci visual_rule_sweep` == body of the HEAD `3b visual_rule_sweep` == body of the skipped test: all `True` in a programmatic list comparison.
- Differences: name (`3b-ci visual_rule_sweep`), timeout `1_800_000`, and a one-line comment above. All loop bounds (0.5 m and `min(0.01, end/100)` steps), tolerances (1e-6, 0.75, 10°, cos(1e-3), 1 - 1e-9) and counts (>100 pairs, >1300 cases) unchanged.
- No vitest `testTimeout` override in `web/vite.config.*` that would cap the per-test 1 800 000 ms.
- `pnpm -C web typecheck` (`tsc --noEmit`): clean.

### 3. S9 log row — PASS (with a minor)
- 7 columns, same format as S1–S8: `S9 | motion-005 | file (sha256, at 18c0f74) | test | pinned behaviour (finish within 600 s) | why unwanted (≈250 s M4 Pro, > 600 s on GitHub ubuntu runners, Web + E2E failing since motion-002) | authorization (2026-10-13, in session, "ja", only the timeout 600 → 1800 s, assertions unchanged) | replacement (3b-ci, identical sweep and assertions, 1800 s)`. The authorization is stated in the row and matches the scope given to me.

### 4. CI — PASS
- `on:` already contained `push: [main]`, `pull_request`, `workflow_dispatch` (unchanged).
- `deploy`: `needs: [rust, web, e2e]` kept; `if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'`. A push or PR can no longer satisfy the condition. `.github/workflows/` holds only `ci.yml`; no other workflow can deploy.
- `web` job: `timeout-minutes` 30 → 60 with a comment. Rust (30), E2E (60, `needs: web`) and deploy (10) unchanged. No other hunk in `ci.yml`.
- README: new paragraph after the manual `wrangler pages deploy` block explains that CI deploys only when run by hand on `main` after Rust, Web and E2E pass. Accurate.

## Findings

- **M1 (major, recording) — the ward spec contradicts the supersession and does not list it.** `.wdd/wards/motion/ward-005.md:106` still says under must-not: "Change, skip or supersede any frozen test (no user authorization in this ward)." This ward now does exactly that, with a new authorization. CLAUDE.md § supersession: "The ward spec and the epic gate list the supersessions too." The spec must be updated: amend the must-not line, add S9 (and the manual-deploy CI change) with the 2026-10-13 authorization, and refer to the S9 row.
- **m1 (minor) — the log header covers only the 2026-10-11 authorization.** The `**Authorization:**` paragraph at the top of `supersessions.md` covers four behaviour classes, and a 600 s test timeout is not one of them. The S9 row states its own authorization. Still, the header should say that S9 rests on a separate authorization (2026-10-13), so that a reader does not take it to be covered by the 10-11 task file.
- **m2 (minor) — the authorization is not durable outside the row.** S1–S8 point to a task file. S9 cites "in this session", which cannot be checked later. Record the user's exact question and answer in a durable place (`.wdd/memory/` task or decision note, or the ward spec) and link it from the row.
- **m3 (minor, risk, no change required) — the CI time is unmeasured.** Nobody has measured how long the sweep takes on GitHub runners; we only know it is > 600 s. If it exceeds 1800 s, or the whole Web job exceeds 60 min, CI fails again. Recommendation: record the actual CI duration of 3b-ci after the first run (ward spec or known-issues).
- **info — external auto-deploy.** The repo cannot show whether the Cloudflare Pages project also has its own Git integration, which would deploy on push independently of CI. The user should confirm in the Cloudflare dashboard if "no deploy on push" is meant to be absolute.

## What would make this APPROVED
Fix M1 (update ward-005 spec: must-not line + supersession list). m1/m2 are strongly recommended. The test and CI changes themselves are correct and need no changes.
