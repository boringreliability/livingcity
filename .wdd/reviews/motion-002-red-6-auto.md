# motion-002 Red review r6 (test changes after Gold r1)

**Verdict: APPROVED with required fix tests (F1–F3)**

Reviewer: fresh adversarial Red subagent, artifacts only. Date: 2026-10-13. HEAD `8e08383`, branch `public-main`.
Convergence rule (round 6): only verified-fixable test gaps, so APPROVED with required fixes. No contract defect, no BLOCKER, and no test that fails to detect what it literally asserts.

## Scope and hashes
| File | sha256 | Status |
|---|---|---|
| `web/e2e/motion002.spec.ts` | `fdf90feec8b61f456a05cb5810db87ecd3b5be545957440562993473ae968dd7` (was `9859df9e…5d09` at 8fe0bbf, confirmed) | Typing-only amendment, approved. This is the new frozen hash. |
| `web/tests/motion002_gold.test.ts` | `8b822ff40a18b0e52e2d3de787c333eb2f6a62eb76f4297ced04e2e1a0c7e7f5` | New M1 regression. Approved once F1–F3 are added (the new hash goes to the Gold reviewer). |

## 1. `motion002.spec.ts`: typing only (confirmed)
`git diff 8fe0bbf 8e08383 -- web/e2e/motion002.spec.ts` changes exactly one line, line 71:
`m[k] += d[i + k]! / (d.length / 4)` → `m[k] = m[k]! + d[i + k]! / (d.length / 4)`.
`m` is initialised to `[0, 0, 0]` and `k ∈ {0, 1, 2}`, so `m[k]!` is always defined and the arithmetic is identical. No bound, sample, selector or flow changed. `pnpm -C web typecheck` is now green, which resolves B1.

## 2. `motion002_gold.test.ts`: findings

### F1: MAJOR (required fix). "Presenting resumes" has no lower bound, so a stale-freezing presenter passes
- **What test 1 asserts after resume:** `P ≤ newest·DT` and `vehicles().length === 500`.
- **Why that is not enough:** both also hold for a presenter that stops accepting frames at the cap.
- **Mutant `keep_stale`:** `if (!reset && this.frames.length >= MAX_KEPT) return;` keeps the first 48 frames forever while hidden.
  - It **survives** `motion002_gold.test.ts` (3/3 pass).
  - It **survives** the frozen `motion002.test.ts` (14/14 pass).
  - Behaviour: back in view, P sits at about tick 1047 instead of 4749, so the picture shows a state 1,850 sim-s old and then crawls at 1.5× to catch up.
- **Required:** in test 1, after the first `advance` on resume, assert
  - `P ≥ (1000+3749)·DT − 4·DT` (and keep the upper bound);
  - that trip 1's presented `s` equals the newest pushed frame's `s` for trip 1 (within 1e-6, single straight link, so no interpolation ambiguity);
  - optionally, the same within ≤ 1 s of further advances.
- **Verified:** the `P ≥ last·DT − 4·DT` assertion passes on HEAD (P = 2374.5 = newest, lag 0) and kills `keep_stale` (`expected 523.5 ≥ 2372.5`).

### F2: MINOR (required fix). The shared clock in compare is not covered
- **Gap:** all three tests use one presenter with its own clock. In the app, A and B share a `PresentationClock`. A cap reset calls `clock.reset`, which sets the shared P to the minimum `newestT` over sides.
- **Required:** add `history_stays_bounded_in_compare`:
  - two `Presenter`s on one `PresentationClock`;
  - `compare: true` frames pushed to both (A then B, same tick and time), with no `advance`, for ≥ 3,000 frames;
  - assert both `retainedFrames() ≤ 48` throughout;
  - after one `advance(now)` on each, assert `a.time() === b.time()` and both `≥ last·DT − 4·DT`.
- **Verified on HEAD:** peak 48, PA = PB = 1999.5, lag 0 for both.

### F3: MINOR (required fix). Test 3 "normal playback never hits the bound" checks only the count, not that no reset fires
- **Gap:** the comment says "no reset ever fires", but only `retainedFrames() < 16` is asserted.
- **Mutant `MAX_KEPT = 2`:** survives the gold file (3/3). It is caught by frozen `motion002.test.ts` (2b, 3, 3d, 4, 4b, 6 fail).
- **Mutant `MAX_KEPT = 6`:** survives the gold file and is caught only by frozen test 4 ("no jump after the stall": 11.16 > 0.12).
- So the frozen suite currently protects normal play, but the gold test's own claim is not pinned.
- **Required:** in test 3, also assert per `advance`:
  - P is non-decreasing;
  - `P − lastP ≤ 1.5 · (20/1000) · Δms + 1e-9`.
  - A reset would snap P to the newest tick, which is a jump of up to 4·DT in one 16 ms step at 20× (bound 0.48 sim-s per 16 ms is 1.5×). If that bound is too loose to catch a reset, then assert instead that P never equals the newest frame's T right after a push in steady play. Pick the assertion that kills `MAX_KEPT = 2` within this file, and show the kill in the Gold log.

### F4: OBSERVATION (recommended, not required). The bound's margin during catch-up at 60× is thin
- **Probe:** a scratch model of `SimClock` (backlog cap 1 s, post ≥ 16 ms apart, one tick per frame or more) at 60×, with a worker stall of 1–1.5 s, then resume, and rAF at 16, 100, 152 and 200 ms.
- **Result:** peak retained frames of **41–48**, with **0 resets** and a max step of 1.5× rate in every case. At 20× the peak is ≤ 31. At 5× it is ≤ 9.
- **Assessment:** no failure today. But the count bound sits at 48 frames, about 0.77 s of 16 ms posts, while legitimate catch-up after a ≤ 1 s backlog needs up to about 46.
- **Recommendation:**
  - Add a regression: 60× after a 1 s worker stall, rAF 150 ms, no jump beyond 1.5 × rate × Δt.
  - The Gold reviewer should check whether a reset during catch-up, e.g. a real 60× hiccup plus slower rAF, produces a visible jump. The jump size is ≤ about 4·DT beyond natural catch-up, which is small, but it is exactly the "stall-then-jump" the ward forbids.
  - A time-based bound (e.g. drop frames older than ceiling − 2 s) would remove the coupling to the post rate.

### F5: INFO. The `CityRenderer.advance` change is not unit-tested
`p?.advance(nowMs)` now runs even with 0 cars. No vitest exercises `CityRenderer`, because it needs WebGL. This does not matter for M1: the bound now lives in `Presenter.push`, independent of rAF and the renderer. That is what test 2 (`empty frames`, no `advance`) pins. Mutant `nocap` fails tests 1 and 2.

## Mutants run (`web/src/render/presentation.ts`, restored byte-exact each time)
| Mutant | gold test | frozen motion002.test |
|---|---|---|
| `nocap` (cap removed) | **killed** (tests 1 and 2: 3750 and 500 > 48) | not run |
| `MAX_KEPT = 2` | survives (3/3) | killed (6 failures) |
| `MAX_KEPT = 6` | survives | killed (test 4 stall jump) |
| `keep_stale` (drop new frames at cap) | **survives** | **survives** (14/14), so F1 is required |

The proposed F1 assertion kills `keep_stale`, and the proposed F2 test passes on HEAD. Both were verified with a temporary probe file, which has since been deleted.

## Commands and results
| Command | Result |
|---|---|
| `git diff 8fe0bbf 8e08383 -- web/e2e/motion002.spec.ts` | one line, typing only |
| `shasum -a 256` on spec / gold test / HEAD presentation.ts | `fdf90fee…68dd7` / `8b822ff4…7e7f5` / `7d226437…5ac31` (restored = HEAD) |
| `pnpm -C web typecheck` | green (exit 0) |
| `pnpm -C web exec vitest run tests/motion002_gold.test.ts tests/motion002.test.ts` | 2 files, 17 passed (305 s) |
| mutant runs (above) | as tabled |
| `git diff --stat -- web/src` at end | empty |

## Required before Gold r2
1. F1: add the resume lower bound and the newest-position check to test 1.
2. F2: add `history_stays_bounded_in_compare` with the shared clock.
3. F3: add the P continuity assertions to test 3, so that the file itself kills `MAX_KEPT = 2`.
4. Record the new gold-test hash. The frozen `motion002.spec.ts` hash is now `fdf90fee…68dd7`.

---

## Applied under the convergence rule (round 6, 2026-10-13)

APPROVED with required fix tests, so it is logged as `-auto`:
- **F1:** test 1 asserts P ≥ newest·DT − 4·DT on resume and trip 1 at the newest frame's s (realistic 20× cadence).
- **F2:** new `history_stays_bounded_in_compare` (two presenters, one clock).
- **F3:** `normal_playback_never_hits_the_bound` asserts P never falls back or jumps (> 1.5·rate·Δt), at 20×, 60× and 60× with a 1 s worker stall (**F4** recommendation).
- **F4:** the bound was raised from 48 to 128 frames (≈ 10 MB at 6,000 cars) for margin at 60× after a stall.

Mutants against `presentation.ts` (file restored byte-exactly): MAX_KEPT = 2 → 3 fail; = 6 → 1 fails; `keep_stale` → 2 fail; no bound (1e9) → 3 fail. Full vitest: 30 files, 150 passed, 7 skipped.

**Frozen (sha256):**
- `web/tests/motion002.test.ts`: `bd9de6d61ae82aafafb8a0e83ac6b9024a8eda83983d5f3a396a88c2667b4246`
- `web/e2e/motion002.spec.ts`: `fdf90feec8b61f456a05cb5810db87ecd3b5be545957440562993473ae968dd7`
- `web/tests/motion002_gold.test.ts`: `bd9d0055fce3c62a3be942a4fa5ffaab29904d8489ce2f7be8a0ef81544d10e2`
