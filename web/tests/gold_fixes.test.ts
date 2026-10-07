// Ward core-004 Gold, regression tests for Gold review r1 findings (added in
// Gold; no approved Red test was changed).
import { expect, test } from 'vitest';

import { SimClock } from '../src/sim/clock';
import { createSimHost, type SimLike } from '../src/sim/host';
import type { FrameMessage, FromWorker, ReadyMessage } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

test('F1 non-integer or out-of-range link ids are rejected, never coerced onto a real link', () => {
  // Given a running host on the real wasm
  const memory = loadWasm();
  let t = 0;
  const posted: FromWorker[] = [];
  const h = createSimHost({
    createSim: (d, b) => Sim.three_bridges(d, b) as unknown as SimLike,
    memory: () => memory,
    post: (m) => posted.push(m),
    now: () => t,
  });
  h.handle({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
  const ready = posted.find((m): m is ReadyMessage => m.type === 'ready')!;
  const n = ready.network.linkFrom.length;
  // When commands carry ids that wasm-bindgen would coerce to valid u32 ids
  const bad = [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.7, 2 ** 32 + 2, n, undefined as unknown as number];
  for (const link of bad) h.handle({ type: 'command', kind: 'close', link });
  h.handle({ type: 'command', kind: 'shut' as 'close', link: 3 });
  t += 16;
  h.iterate();
  // Then each one is reported and no link was closed
  const errors = posted.filter((m) => m.type === 'error');
  expect(errors).toHaveLength(bad.length + 1);
  const frame = posted.filter((m): m is FrameMessage => m.type === 'frame').at(-1)!;
  expect(Array.from(frame.closed)).toEqual([]);
});

test('F2 a second speed drop before any plan keeps the option-(ii) suppression', () => {
  // Given 300× keeping up, When the speed drops 300 → 60 → 20 with no plan in between
  let t = 0;
  const clock = new SimClock(() => t);
  clock.setSpeed(300);
  clock.setRunning(true);
  for (let k = 0; k < 125; k++) {
    t += 16;
    clock.report(clock.plan(), 0.01);
  }
  t += 300; // 300 ms at 300× owes 180 ticks > the 60× cap (120): a real clamp
  clock.setSpeed(60);
  t += 5;
  clock.setSpeed(20);
  // Then lowering the speed never makes behind blink
  for (let k = 0; k < 62; k++) {
    t += 16;
    const n = clock.plan();
    clock.report(n, 0.01 * n);
    expect(clock.status().behind).toBe(false);
  }
});

test('F3 a clock that goes backwards never plans or reports negative ticks', () => {
  let t = 1000;
  const clock = new SimClock(() => t);
  clock.setSpeed(10);
  clock.setRunning(true);
  t += 500;
  clock.report(clock.plan(), 0.1);
  const executed = clock.status().executedTicks;
  t -= 400; // non-monotonic wall time
  const n = clock.plan();
  expect(n).toBeGreaterThanOrEqual(0);
  clock.report(n, 0);
  expect(clock.status().executedTicks).toBeGreaterThanOrEqual(executed);
  expect(clock.status().simTimeS).toBe(clock.status().executedTicks * 0.5);
});
