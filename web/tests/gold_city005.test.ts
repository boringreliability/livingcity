// Ward city-005, Gold r1 regression (M1): the warm-up keeps its 100 ms batch bound even when
// ticks get dearer as the city fills (a constant-cost fake, as in test 5, cannot show this).
import { describe, expect, test } from 'vitest';

import { createSimHost, type SimLike } from '../src/sim/host';
import { DT, WARMUP_SIM_S, type FromWorker, type ReadyMessage } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

describe('city-005 gold r1: warm-up batch bound with rising tick cost', () => {
  for (const [label, cost] of [
    ['linear growth (0.0001 → 0.18 ms/tick)', (tick: number) => 0.0001 * (1 + tick)],
    ['a step: 0.002 ms/tick, then 1 ms/tick from tick 200', (tick: number) => (tick < 200 ? 0.002 : 1)],
  ] as const) {
    test(label, () => {
      const memory = loadWasm();
      let t = 0;
      let sim: Sim | undefined;
      const posted: FromWorker[] = [];
      const h = createSimHost({
        createSim: (d, b) => {
          sim = Sim.river_city(d, b);
          const s = sim;
          return new Proxy(s as unknown as SimLike, {
            get(target, key) {
              if (key === 'step')
                return (n: number) => {
                  for (let k = 0; k < n; k++) t += cost(s.tick() + k);
                  s.step(n);
                };
              const v = Reflect.get(target, key) as unknown;
              return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
            },
          });
        },
        memory: () => memory,
        post: (m) => posted.push(m),
        now: () => t,
      });
      h.handle({ type: 'init', demandSeed: 2026, behaviorSeed: 7, warmupS: WARMUP_SIM_S });
      let longest = 0;
      for (let i = 0; i < 100_000 && !posted.some((m) => m.type === 'ready'); i++) {
        t += 4;
        const t0 = t;
        h.iterate();
        longest = Math.max(longest, t - t0);
      }
      const ready = posted.find((m): m is ReadyMessage => m.type === 'ready');
      expect(ready?.tick).toBe(WARMUP_SIM_S / DT);
      expect(longest).toBeLessThanOrEqual(100);
    });
  }

  test('a re-init restarts sim time: frames keep tick = executed ticks', () => {
    const memory = loadWasm();
    let t = 0;
    const posted: FromWorker[] = [];
    const h = createSimHost({
      createSim: (d, b) => Sim.three_bridges(d, b) as unknown as SimLike,
      memory: () => memory,
      post: (m) => posted.push(m),
      now: () => t,
    });
    h.handle({ type: 'init', demandSeed: 1, behaviorSeed: 2 });
    h.handle({ type: 'setSpeed', multiplier: 60 });
    h.handle({ type: 'setRunning', running: true });
    for (let i = 0; i < 100; i++) {
      t += 16;
      h.iterate();
    }
    h.handle({ type: 'init', demandSeed: 1, behaviorSeed: 2 });
    const from = posted.length;
    for (let i = 0; i < 50; i++) {
      t += 16;
      h.iterate();
    }
    const after = posted.slice(from).filter((m) => m.type === 'frame');
    expect(after.length).toBeGreaterThan(0);
    for (const f of after) if (f.type === 'frame') expect(f.tick).toBe(f.clock.executedTicks);
  });
});
