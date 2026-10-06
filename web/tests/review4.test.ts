// Ward core-004, tests 33–36: proposed and verified against an independent
// reference by the Red reviewer, round 4 (lowering the speed, cap events
// inside the grace period, setSpeed crediting; G11b = the user's option (ii)).
import { describe, expect, test } from 'vitest';

import { MAX_BACKLOG_S, SimClock } from '../src/sim/clock';
import { DT } from '../src/sim/protocol';

/** A 16 ms loop with cheap ticks; returns the ticks planned by each iteration. */
function loop(clock: SimClock, advance: () => void, iterations: number, onStatus?: () => void): number {
  let total = 0;
  for (let k = 0; k < iterations; k++) {
    advance();
    const n = clock.plan();
    clock.report(n, 0.01 * n);
    total += n;
    onStatus?.();
  }
  return total;
}

describe('core-004 review r4: lowering the speed', () => {
  test('G11 lowering the speed clamps the backlog to the new cap at once and is not a cap event', () => {
    // A: Given 60x with 10 ms ticks, the clock is far behind and its backlog sits at the 60x cap
    {
      let t = 0;
      const clock = new SimClock(() => t);
      clock.setSpeed(60);
      clock.setRunning(true);
      while (t < 3000) {
        t += 1;
        const n = clock.plan();
        t += 10 * n;
        clock.report(n, 10 * n);
      }
      expect(clock.status().backlogTicks).toBeGreaterThan(50);
      // When the user selects 1x
      clock.setSpeed(1);
      const newCap = MAX_BACKLOG_S * (1 / DT);
      const before = clock.status().executedTicks;
      // Then the old backlog is not worked off: over the next 2 s of a 16 ms loop the sim runs at 1x
      for (let k = 0; k < 125; k++) {
        t += 16;
        const n = clock.plan();
        t += 10 * n;
        clock.report(n, 10 * n);
        expect(clock.status().backlogTicks).toBeLessThanOrEqual(newCap + 1e-9);
      }
      // at most the 1x cap (2 ticks) plus 2 s at 2 ticks/s, plus one tick of rounding
      expect(clock.status().executedTicks - before).toBeLessThanOrEqual(newCap + 2 * (1 / DT) + 1);
    }
    // B: Given 60x keeping up with cheap ticks, and a 100 ms hiccup (12 ticks owed, far below the 120-tick cap)
    {
      let t = 0;
      const clock = new SimClock(() => t);
      clock.setSpeed(60);
      clock.setRunning(true);
      loop(clock, () => (t += 16), 125);
      t += 100;
      // When the speed drops to 1x (the owed 12 ticks exceed the new 2-tick cap)
      clock.setSpeed(1);
      const sw = t;
      // Then the speed-lowering clamp itself is not a cap event, and (b) is in its grace period
      expect(clock.status().behind).toBe(false);
      const before = clock.status().executedTicks;
      // (Whether the overflow at the *next* plan, with the backlog still at the new cap, is a cap event
      // is not decided by the spec: see finding m-new-1 / fixes4_option_ii.ts.)
      loop(clock, () => (t += 16), 61);
      expect(t - sw).toBeLessThan(1000);
      // And the 12 owed ticks were dropped down to the 1x cap, not executed
      expect(clock.status().executedTicks - before).toBeLessThanOrEqual(MAX_BACKLOG_S * (1 / DT) + 1 * (1 / DT) + 1);
    }
  });
});

describe('core-004 review r4: setSpeed bookkeeping', () => {
  test('G12 a cap clamp is reported even inside the grace period after a speed change', () => {
    // Given 60x keeping up with cheap ticks on a 16 ms loop
    let t = 0;
    const clock = new SimClock(() => t);
    clock.setSpeed(60);
    clock.setRunning(true);
    loop(clock, () => (t += 16), 125);
    // When the worker stalls for 1.5 s and the queued speed change (to 30x) is handled before the next plan
    t += 1500;
    clock.setSpeed(30);
    const sw = t;
    // Then the stall was clamped at the (old) cap: behind is true at once and for the whole following
    // second, although (b) is still in its grace period
    expect(clock.status().behind).toBe(true);
    loop(
      clock,
      () => (t += 16),
      61,
      () => expect({ at: t - sw, behind: clock.status().behind }).toEqual({ at: t - sw, behind: true }),
    );
  });

  test('G13 setSpeed credits the time since the last plan at the old speed', () => {
    // Given 1x keeping up (backlog below one tick), When 200 ms pass and the speed goes to 60x
    {
      let t = 0;
      const clock = new SimClock(() => t);
      clock.setSpeed(1);
      clock.setRunning(true);
      loop(clock, () => (t += 16), 125);
      t += 200;
      clock.setSpeed(60);
      // Then those 200 ms are worth 0.4 ticks (1x), not 24 ticks (60x)
      expect(clock.plan()).toBeLessThanOrEqual(1);
    }
    // Given 60x keeping up, When 200 ms pass and the speed goes to 1x
    {
      let t = 0;
      const clock = new SimClock(() => t);
      clock.setSpeed(60);
      clock.setRunning(true);
      loop(clock, () => (t += 16), 125);
      t += 200;
      clock.setSpeed(1);
      // Then those 200 ms are worth 24 ticks (60x), clamped to the 2-tick 1x cap
      expect(clock.plan()).toBe(MAX_BACKLOG_S * (1 / DT));
    }
  });
});

describe('core-004 review r4: option (ii)', () => {
  test('G11b lowering the speed while lagging shows no behind during the following second', () => {
    // Given 60x keeping up with cheap ticks, and a 100 ms hiccup (12 ticks owed, below the 120-tick cap)
    let t = 0;
    const clock = new SimClock(() => t);
    clock.setSpeed(60);
    clock.setRunning(true);
    for (let k = 0; k < 125; k++) {
      t += 16;
      const n = clock.plan();
      clock.report(n, 0.01 * n);
    }
    t += 100;
    // When the speed drops to 1x
    clock.setSpeed(1);
    const sw = t;
    // Then nobody is behind for the next second (no cap event; (b) is in its grace period)
    for (let k = 0; k < 61; k++) {
      t += 16;
      const n = clock.plan();
      clock.report(n, 0.01 * n);
      expect({ at: t - sw, behind: clock.status().behind }).toEqual({ at: t - sw, behind: false });
    }
  });
});
