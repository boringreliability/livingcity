# Supersessions of frozen tests and contracts

The rules are in CLAUDE.md § "Frozen tests and contracts: unlocking (supersession)".
- A superseded test is not deleted. It is marked `test.skip` with a comment that points here and to its replacement.
- Its valid intent lives on in the replacing tests, which passed a Red gate.

**Authorization:** the user, on 2026-10-11, in `.wdd/memory/task-2026-10-11-motion-paused-consequences.md` § "Explicit authorization to revise frozen contracts". It covers:
- cars drawn inside a junction while waiting at its stop line;
- visible jumps or backward steps caused by rendering;
- unnecessary full-frame production while paused;
- buffer-pool behaviour that prevents sensible bounded reuse.

| # | Ward | Frozen file (sha256 before the change) | Test | Pinned behaviour | Why unwanted | Replaced by |
|---|---|---|---|---|---|---|
| S1 | motion-001 | `web/tests/review2.test.ts` (f3856bebe4ff66eb7fd3d46dbc29e18d980e986625af114faed576284d496c0a, at 19e9fbf) | G4 | ≥ 95 full frames in 100 paused iterations (line 121): a full encode + transfer every 16 ms while paused | Unnecessary full-frame production while paused (measured 50 frames/s, 1.65 MB/s at default demand; `paused-before.json`) | motion-001 test 4 (tick unchanged while paused; a closure issued while paused applies at the first resumed tick, ≤ 4 ticks; no error), test 2 (a frame after every handled message) and test 1 (quiet) |
| S2 | motion-001 | `web/tests/review3.test.ts` (499373ef9bd76ca20e783b2e1768f9e0ce714f0acbda52911d8b385fb8297c7e, at 19e9fbf) | G4b | ≥ 9 frames in 10 paused iterations (line 122) | The same | motion-001 test 4 (no paused frame shows the closure) |
| S3 | motion-001 | `web/tests/review2.test.ts` (f3856bebe4ff66eb7fd3d46dbc29e18d980e986625af114faed576284d496c0a, at 19e9fbf) | G8 | A returned buffer that fits a later frame but not the next one is never used, i.e. the whole pool is dropped on every post | Buffer-pool behaviour that prevents sensible bounded reuse. The intent "no unbounded pool" is kept. | motion-001 test 6 (a bounded LIFO pool, at most 4 per side; never 0-length, wrong-size or double use) and test 7 (never reused across a replaced world) |
