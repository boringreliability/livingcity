// Ward timeline-003, Gold r1 regressions (the approved test files stay frozen):
// a dropped scenario B is released at once (MAJOR 3), and a view switch forgets the target's
// retained frame trip tables (MINOR 4).
import { describe, expect, test } from 'vitest';

import { createSimHost, type SimLike } from '../src/sim/host';
import type { FromWorker, ToWorker } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

/** Wraps every Sim (A and its branches) to count `free` and `forget_frames` calls. */
function host() {
  const memory = loadWasm();
  let t = 0;
  const freed: string[] = [];
  const forgot: string[] = [];
  let n = 0;
  const wrap = (s: Sim, name: string): SimLike =>
    new Proxy(s as unknown as SimLike, {
      get(target, key) {
        if (key === 'free')
          return () => {
            freed.push(name);
            s.free();
          };
        if (key === 'forget_frames')
          return () => {
            forgot.push(name);
            s.forget_frames();
          };
        if (key === 'branch') return (at: number) => wrap(s.branch(at), `B${++n}`);
        const v = Reflect.get(target, key) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  const posted: FromWorker[] = [];
  const h = createSimHost({
    createSim: (d, b) => wrap(Sim.three_bridges(d, b), 'A'),
    memory: () => memory,
    post: (m) => posted.push(m),
    now: () => t,
  });
  const send = (m: ToWorker) => h.handle(m);
  const iterate = (k: number) => {
    for (let i = 0; i < k; i++) {
      t += 16;
      h.iterate();
    }
  };
  return { send, iterate, freed, forgot, posted };
}

describe('timeline-003 gold r1', () => {
  test('a replaced or discarded B is freed at once; A is not', () => {
    const x = host();
    x.send({ type: 'init', demandSeed: 17, behaviorSeed: 23, city: 'three_bridges' });
    x.send({ type: 'setSpeed', multiplier: 60 });
    x.send({ type: 'setRunning', running: true });
    x.iterate(300);
    x.send({ type: 'branch', fromTick: 100, then: [] });
    expect(x.freed).toEqual([]);
    x.send({ type: 'viewScenario', scenario: 0 });
    x.send({ type: 'branch', fromTick: 200, then: [] }); // replaces B1
    expect(x.freed).toEqual(['B1']);
    x.send({ type: 'discardBranch' }); // drops B2
    expect(x.freed).toEqual(['B1', 'B2']);
    // the host keeps working on A after the frees
    x.send({ type: 'setRunning', running: true });
    x.iterate(5);
    expect(x.posted.filter((m) => m.type === 'error')).toEqual([]);
  });

  test('a view switch forgets the target scenario frame trip tables', () => {
    const x = host();
    x.send({ type: 'init', demandSeed: 17, behaviorSeed: 23, city: 'three_bridges' });
    x.send({ type: 'setSpeed', multiplier: 60 });
    x.send({ type: 'setRunning', running: true });
    x.iterate(200);
    x.send({ type: 'branch', fromTick: 100, then: [] });
    x.send({ type: 'viewScenario', scenario: 0 });
    expect(x.forgot).toEqual(['A']);
    x.send({ type: 'viewScenario', scenario: 1 });
    expect(x.forgot).toEqual(['A', 'B1']);
  });
});
