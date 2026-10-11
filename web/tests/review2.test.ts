// Ward core-004, tests 21–27: proposed and verified against an independent
// reference by the Red reviewer, round 2 (behind honesty in both directions,
// paused frames and commands, pre-init safety, pool bounds, lane bits).
import { describe, expect, test } from 'vitest';

import { SimClock } from '../src/sim/clock';
import { decodeVehicles } from '../src/sim/frame';
import { createSimHost, type SimLike } from '../src/sim/host';
import { type FrameMessage, type FromWorker, type ReadyMessage } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

/** A clock on fake time with cheap ticks; `run(ms)` iterates the 16 ms loop and returns every status read. */
function cheapClock(multiplier: number) {
  let t = 0;
  const clock = new SimClock(() => t);
  clock.setSpeed(multiplier);
  clock.setRunning(true);
  const run = (ms: number, stepMs = 16) => {
    const seen = [];
    for (const end = t + ms; t < end; ) {
      t += stepMs;
      const n = clock.plan();
      clock.report(n, 0.01 * n);
      seen.push(clock.status());
    }
    return seen;
  };
  return { clock, run, stall: (ms: number) => (t += ms) };
}

describe('core-004 review r2: behind is honest in both directions', () => {
  test('G1 a cap event is sticky for 1 s, then behind clears once the clock keeps up', () => {
    // Given 60x with cheap ticks, running smoothly
    const c = cheapClock(60);
    expect(c.run(2000).every((s) => !s.behind)).toBe(true);
    // When the loop stalls for 1.5 s (GC, background tab): owed wall time is dropped at the cap
    c.stall(1500);
    const after = c.run(16);
    // Then behind is reported right away
    expect(after.at(-1)!.behind).toBe(true);
    // And once the clock has kept up for more than 1 s it clears again (not latched forever)
    c.run(1100);
    const later = c.run(2000);
    expect(later.every((s) => !s.behind)).toBe(true);
  });

  test('G2 no false behind during the first second after start, a speed change, or a resume', () => {
    // Given a fresh 1x clock with cheap ticks: the first second is not judged
    const c = cheapClock(1);
    expect(c.run(3000).every((s) => !s.behind)).toBe(true);
    // When the speed changes to 60x, Then the old-speed window does not flag behind
    c.clock.setSpeed(60);
    expect(c.run(3000).every((s) => !s.behind)).toBe(true);
    // When paused for 2 s and resumed, Then the empty window does not flag behind
    c.clock.setRunning(false);
    c.run(2000);
    c.clock.setRunning(true);
    expect(c.run(3000).every((s) => !s.behind)).toBe(true);
  });

  test('G3 a paused clock is never behind', () => {
    // Given 60x running smoothly, When paused for 5 s
    const c = cheapClock(60);
    c.run(2000);
    c.clock.setRunning(false);
    const paused = c.run(5000);
    // Then nothing runs and nothing claims the engine cannot keep up
    expect(paused.every((s) => s.running === false && !s.behind)).toBe(true);
    expect(paused.at(-1)!.executedTicks).toBe(paused[0]!.executedTicks);
  });

  test('G5 setSpeed ignores non-finite and non-positive multipliers', () => {
    const c = cheapClock(10);
    c.run(1000);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) c.clock.setSpeed(bad);
    const before = c.run(16).at(-1)!.executedTicks;
    const s = c.run(2000).at(-1)!;
    expect(s.multiplier).toBe(10);
    expect(s.targetTicksPerS).toBe(20);
    expect(Math.abs(s.executedTicks - before - 40)).toBeLessThanOrEqual(2);
  });
});

/** Host on real wasm with fake time (same as host.test.ts `host()`). */
function host() {
  const memory = loadWasm();
  let t = 0;
  const posted: FromWorker[] = [];
  const h = createSimHost({
    createSim: (d, b) => Sim.three_bridges(d, b) as unknown as SimLike,
    memory: () => memory,
    post: (msg) => posted.push(msg),
    now: () => t,
  });
  const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
  const advance = (iterations: number) => {
    for (let k = 0; k < iterations; k++) {
      t += 16;
      h.iterate();
    }
  };
  return { h, posted, frames, advance };
}

describe('core-004 review r2: host', () => {
  // SUPERSEDED (motion-001, S1 in .wdd/memory/supersessions.md): pinned full frames every 16 ms while paused;
  // its valid intent (closure timing, unchanged tick) is motion001.test.ts tests 1, 2 and 4.
  test.skip('G4 frames keep coming while paused (tick unchanged); a close issued while paused applies at the first resumed tick', () => {
    // Given a running host, When paused
    const w = host();
    w.h.handle({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
    const ready = w.posted.find((m): m is ReadyMessage => m.type === 'ready')!;
    w.h.handle({ type: 'setSpeed', multiplier: 60 });
    w.h.handle({ type: 'setRunning', running: true });
    w.advance(300);
    w.h.handle({ type: 'setRunning', running: false });
    w.advance(1);
    const pausedTick = w.frames().at(-1)!.tick;
    const n0 = w.frames().length;
    w.advance(100);
    // Then about one frame per 16 ms is still posted, with the tick unchanged
    expect(w.frames().length - n0).toBeGreaterThanOrEqual(95);
    // When the central bridge is closed while paused
    const [we, ew] = ready.landmarks.central_bridge;
    w.h.handle({ type: 'command', kind: 'close', link: we });
    w.h.handle({ type: 'command', kind: 'close', link: ew });
    w.advance(5);
    // Then paused frames still arrive, at the paused tick, without error
    // (NOTE r2 finding: World applies commands inside step(), so `closed` cannot change while paused;
    //  if the spec adopts a `pendingCommands`/pending-closed field, assert it here instead.)
    expect(w.frames().at(-1)!.tick).toBe(pausedTick);
    expect(w.posted.some((m) => m.type === 'error')).toBe(false);
    // When resumed, Then the first frame with a new tick shows the closure (nothing lost while paused)
    w.h.handle({ type: 'setRunning', running: true });
    w.advance(2);
    const f = w.frames().find((x) => x.tick > pausedTick)!;
    expect(f.tick - pausedTick).toBeLessThanOrEqual(4);
    expect(Array.from(f.closed)).toEqual(expect.arrayContaining([we, ew]));
  });

  test('G6 commands and iterations before init never throw; commands are reported as errors', () => {
    const w = host();
    expect(() => w.advance(3)).not.toThrow();
    expect(() => w.h.handle({ type: 'command', kind: 'close', link: 0 })).not.toThrow();
    expect(() => w.h.handle({ type: 'setRunning', running: true })).not.toThrow();
    expect(() => w.advance(3)).not.toThrow();
    expect(w.posted.some((m) => m.type === 'error')).toBe(true);
    expect(w.frames()).toHaveLength(0);
  });
});

// SUPERSEDED (motion-001, S3 in .wdd/memory/supersessions.md): pinned dropping the whole pool on every post;
// its valid intent (a bounded pool) is motion001.test.ts tests 6 and 7.
test.skip('G8 a returned buffer that does not fit the next frame is dropped, never kept for later frames', () => {
  // Given the frame sizes of an unpooled twin (same seeds, same fake time)
  const start = (w: ReturnType<typeof host>) => {
    w.h.handle({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
    w.h.handle({ type: 'setSpeed', multiplier: 60 });
    w.h.handle({ type: 'setRunning', running: true });
  };
  const twin = host();
  start(twin);
  twin.advance(400);
  const sizes = twin.frames().map((f) => f.vehicles.byteLength);
  // When, after frame i, the UI returns a buffer sized for a LATER frame but not for frame i + 1
  const w = host();
  start(w);
  const stale = new Set<ArrayBuffer>();
  for (let k = 0; k < 400; k++) {
    const nBefore = w.frames().length;
    w.advance(1);
    if (w.frames().length === nBefore) continue;
    const i = w.frames().length - 1;
    for (let later = i + 2; later < Math.min(sizes.length, i + 40); later++) {
      if (sizes[later] !== sizes[i + 1] && sizes[later]! > 0) {
        const b = new ArrayBuffer(sizes[later]!);
        stale.add(b);
        w.h.handle({ type: 'returnBuffer', buffer: b });
        break;
      }
    }
  }
  // Then no frame ever carries one of those buffers: they were dropped, not kept (no unbounded pool)
  expect(stale.size).toBeGreaterThan(100);
  expect(w.frames().filter((f) => stale.has(f.vehicles))).toHaveLength(0);
});

test('G7 lane uses all 8 bits (8..15) and ignores higher bits', () => {
  const words = new Uint32Array(4);
  words[3] = (0xab << 8) | (0x5 << 16) | 0x7;
  expect(decodeVehicles(words.buffer, 1).lane(0)).toBe(0xab);
});
