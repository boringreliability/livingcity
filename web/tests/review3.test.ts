// Ward core-004, tests 28–32: proposed and verified against an independent
// reference by the Red reviewer, round 3 (frame spacing under jitter and
// stalls, sticky behind duration, first-start grace, paused state, pre-init).
import { describe, expect, test } from 'vitest';

import { SimClock } from '../src/sim/clock';
import { createSimHost, FRAME_INTERVAL_MS, type SimLike } from '../src/sim/host';
import { type FrameMessage, type FromWorker, type ReadyMessage } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

describe('core-004 review r3: clock', () => {
  test('G9 after a single stall, behind stays true for the whole second after the clamp, then clears', () => {
    // Given 60x with cheap ticks on a 16 ms loop, running smoothly for 2 s
    let t = 0;
    const clock = new SimClock(() => t);
    clock.setSpeed(60);
    clock.setRunning(true);
    const step = () => {
      t += 16;
      const n = clock.plan();
      clock.report(n, 0.01 * n);
      return clock.status();
    };
    for (let k = 0; k < 125; k++) step();
    // When the loop stalls for 1.5 s: the next plan clamps the backlog at the cap (once; the clock then keeps up)
    t += 1500;
    const first = step();
    const clampT = t;
    expect(first.behind).toBe(true);
    // Then every status strictly within 1 s of that clamp says behind (not just the clamp iteration)
    const during = [];
    while (t + 16 < clampT + 1000) during.push(step());
    expect(during.length).toBeGreaterThan(55);
    expect(during.filter((s) => !s.behind)).toHaveLength(0);
    // And once 1 s has passed since the clamp, it clears (achieved is back at target)
    while (t < clampT + 1016) step();
    const after = Array.from({ length: 60 }, step);
    expect(after.filter((s) => s.behind)).toHaveLength(0);
  });

  test('G2b the 1 s grace follows the first start, not the construction of the clock', () => {
    // Given a 1x clock created long before it is first started
    let t = 0;
    const clock = new SimClock(() => t);
    clock.setSpeed(1);
    for (let k = 0; k < 300; k++) {
      t += 16;
      clock.report(clock.plan(), 0);
    }
    // When it is started, Then the first second is not judged
    clock.setRunning(true);
    const seen = [];
    for (let k = 0; k < 200; k++) {
      t += 16;
      const n = clock.plan();
      clock.report(n, 0.01 * n);
      seen.push(clock.status());
    }
    expect(seen.filter((s) => s.behind)).toHaveLength(0);
  });
});

/** Host on real wasm with fake time; records the wall time of every post. */
function timedHost() {
  const memory = loadWasm();
  let t = 0;
  const posted: { msg: FromWorker; at: number }[] = [];
  const h = createSimHost({
    createSim: (d, b) => Sim.three_bridges(d, b) as unknown as SimLike,
    memory: () => memory,
    post: (msg) => posted.push({ msg, at: t }),
    now: () => t,
  });
  const frames = () => posted.filter((p) => p.msg.type === 'frame') as { msg: FrameMessage; at: number }[];
  const iterate = (ms: number) => {
    t += ms;
    h.iterate();
  };
  return { h, posted, frames, iterate, stall: (ms: number) => (t += ms) };
}

describe('core-004 review r3: host', () => {
  test('G10 frames stay >= 16 ms apart with a jittered loop and after a stall (no catch-up burst)', () => {
    // Given a running host whose loop iterates at irregular 1..12 ms intervals
    const w = timedHost();
    w.h.handle({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
    w.h.handle({ type: 'setSpeed', multiplier: 10 });
    w.h.handle({ type: 'setRunning', running: true });
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let k = 0; k < 600; k++) w.iterate(1 + Math.floor(rnd() * 12));
    // When the loop stalls for 1 s and then iterates every 2 ms for 1.2 s
    w.stall(1000);
    const nBefore = w.frames().length;
    for (let k = 0; k < 600; k++) w.iterate(2);
    // Then no two frames are ever closer than FRAME_INTERVAL_MS of wall time
    const at = w.frames().map((f) => f.at);
    const gaps = at.slice(1).map((x, i) => x - at[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(FRAME_INTERVAL_MS);
    // And frames resume at about 60/s after the stall (neither a burst nor a gap)
    const after = w.frames().length - nBefore;
    expect(after).toBeLessThanOrEqual(Math.floor(1200 / FRAME_INTERVAL_MS) + 1);
    expect(after).toBeGreaterThan(1200 / FRAME_INTERVAL_MS - 5);
  });

  test('G4b paused frames show the unchanged state: a close issued while paused is not in `closed` until resumed', () => {
    const w = timedHost();
    w.h.handle({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
    const ready = w.posted.find((p) => p.msg.type === 'ready')!.msg as ReadyMessage;
    w.h.handle({ type: 'setSpeed', multiplier: 60 });
    w.h.handle({ type: 'setRunning', running: true });
    for (let k = 0; k < 200; k++) w.iterate(16);
    w.h.handle({ type: 'setRunning', running: false });
    w.iterate(16);
    const [we, ew] = ready.landmarks.central_bridge;
    const n0 = w.frames().length;
    w.h.handle({ type: 'command', kind: 'close', link: we });
    w.h.handle({ type: 'command', kind: 'close', link: ew });
    for (let k = 0; k < 10; k++) w.iterate(16);
    const paused = w.frames().slice(n0).map((f) => f.msg);
    expect(paused.length).toBeGreaterThanOrEqual(9);
    for (const f of paused) {
      expect(Array.from(f.closed)).not.toContain(we);
      expect(Array.from(f.closed)).not.toContain(ew);
    }
  });

  test('G6b iterating before init posts nothing at all', () => {
    const w = timedHost();
    for (let k = 0; k < 5; k++) w.iterate(16);
    expect(w.posted).toHaveLength(0);
    w.h.handle({ type: 'command', kind: 'close', link: 0 });
    const afterCommand = w.posted.length;
    for (let k = 0; k < 5; k++) w.iterate(16);
    expect(w.posted).toHaveLength(afterCommand);
  });
});
