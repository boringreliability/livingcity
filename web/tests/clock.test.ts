// Ward core-004: the worker's fixed-step clock (pure, fake time).
import { describe, expect, test } from 'vitest';

import { ITERATION_BUDGET_MS, MAX_BACKLOG_S, SimClock } from '../src/sim/clock';
import { DT } from '../src/sim/protocol';

describe('SimClock', () => {
  // 7
  test('clock runs at target rate', () => {
    for (const multiplier of [1, 10, 60]) {
      // Given cheap ticks and a 16 ms worker loop for 10 s of wall time
      let t = 0;
      const clock = new SimClock(() => t);
      clock.setSpeed(multiplier);
      clock.setRunning(true);
      for (let k = 0; k < 625; k++) {
        t += 16;
        const n = clock.plan();
        clock.report(n, 0.001 * n);
      }
      // Then executed ticks track the target (± 2 ticks) and nobody is behind
      const s = clock.status();
      const target = (multiplier / DT) * 10;
      expect(Math.abs(s.executedTicks - target)).toBeLessThanOrEqual(2);
      expect(s.targetTicksPerS).toBe(multiplier / DT);
      expect(Math.abs(s.achievedTicksPerS - s.targetTicksPerS)).toBeLessThanOrEqual(0.1 * s.targetTicksPerS);
      expect(s.behind).toBe(false);
      expect(s.simTimeS).toBe(s.executedTicks * DT);
    }
  });

  // 8
  test('clock reports falling behind without skipping', () => {
    // Given ticks that cost 10 ms each at 60× (120 ticks/s would need 1.2 s per s)
    let t = 0;
    const clock = new SimClock(() => t);
    clock.setSpeed(60);
    clock.setRunning(true);
    const cap = MAX_BACKLOG_S * (60 / DT);
    while (t < 5000) {
      t += 1;
      const n = clock.plan();
      // When each batch respects the iteration budget (but at least one tick runs)
      expect(n * 10).toBeLessThanOrEqual(Math.max(10, ITERATION_BUDGET_MS));
      t += 10 * n;
      clock.report(n, 10 * n);
      // Then the backlog never exceeds the cap
      expect(clock.status().backlogTicks).toBeLessThanOrEqual(cap + 1e-9);
    }
    // And the clock says so honestly, and sim time is exactly the executed ticks
    const s = clock.status();
    expect(s.behind).toBe(true);
    expect(s.achievedTicksPerS).toBeLessThan(s.targetTicksPerS);
    expect(s.achievedTicksPerS).toBeGreaterThan(50);
    expect(s.simTimeS).toBe(s.executedTicks * DT);
  });

  // 9
  test('pause and speed change', () => {
    let t = 0;
    const clock = new SimClock(() => t);
    clock.setSpeed(1);
    clock.setRunning(true);
    // Given real time, one wall second gives two ticks
    t += 1000;
    expect(clock.plan()).toBe(2);
    clock.report(2, 0.1);
    // When paused for 5 s, Then nothing is planned and nothing is owed
    clock.setRunning(false);
    t += 5000;
    expect(clock.plan()).toBe(0);
    expect(clock.status().running).toBe(false);
    // When resumed, Then the paused time is not caught up
    clock.setRunning(true);
    t += 16;
    expect(clock.plan()).toBe(0);
    // When the speed changes to 10×, Then the next plan uses it
    clock.setSpeed(10);
    t += 1000;
    const n = clock.plan();
    expect(n).toBeGreaterThanOrEqual(19);
    expect(n).toBeLessThanOrEqual(21);
    expect(clock.status().multiplier).toBe(10);
    expect(clock.status().executedTicks).toBe(2);
  });
});
