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
| S4 | motion-002 | `web/tests/motion.test.ts` (6b83cbd11fec12e94e61aa1b1927cf9226cf823236f12a5bc7249577e8af98be, at ceaa65e) | test 3 `draw_position_is_continuous_across_junctions` | (a) a car at s = length is drawn at the next link's start | Held cars drawn inside junctions (i2) | motion002 test 2 (held behind the stop line), test 3 (a smooth curve during a real transition; straight placement off it) |
| S5 | motion-002 | `web/tests/motion.test.ts` (6b83cbd11fec12e94e61aa1b1927cf9226cf823236f12a5bc7249577e8af98be, at ceaa65e) | test 4 `extrapolation_stops_at_the_end_on_the_curve` | Extrapolation clamped at the link end and drawn at the next link's start | The car stops at the curve end and then jumps (i1), and held cars sit in junctions (i2) | motion002 test 4 (never beyond an authoritative position, no backward step) and test 2 |
| S6 | motion-002 | `web/tests/motion.test.ts` (6b83cbd11fec12e94e61aa1b1927cf9226cf823236f12a5bc7249577e8af98be, at ceaa65e) | test 5 `speed_change_never_moves_cars_back` | The `ExtrapolationClock` API (implementation-specific) | The class is replaced by the presentation clock | motion002 test 4 (speed changes 20× → 5× → 60× → 1×, no backward step) |
| S7 | motion-002 | `web/tests/motion.test.ts` (6b83cbd11fec12e94e61aa1b1927cf9226cf823236f12a5bc7249577e8af98be, at ceaa65e) | test 6 `stall_cannot_overshoot` | "> 0.5": extrapolation must run ahead of the frame | Running ahead of authoritative state causes backward steps (i4) | motion002 test 4 (P never ahead of the newest frame, even with a 300 ms delayed frame) and test 8 (bounded lag) |
| S8 | motion-002 | `web/e2e/motion.spec.ts` (6878ebd52193b4757eb35b76c0688336fb7ea84b58e24f85942a6b47c08cef72, at ceaa65e) | test 7 `gpu_draws_cars_where_the_cpu_says` | Held cars drawn on the junction curve (`vehicleDraw` with the old rule) | Held cars drawn inside junctions (i2) | motion002 e2e test 9 (the GPU draws where the presentation rule says; held cars behind their stop lines) |

