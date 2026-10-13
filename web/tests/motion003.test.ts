// Ward motion-003, tests 2–6 (vitest): the command-log and exits getters, the pure consequence readings,
// and the frame / comparison fields the host builds from them (read-only: no new World state).
import { describe, expect, test } from 'vitest';

import { createSimHost, type SimLike } from '../src/sim/host';
import type { ComparisonMessage, FrameMessage, FromWorker, Landmarks, ReadyMessage, ToWorker } from '../src/sim/protocol';
import { crossingRates, summarizeInterventions, topQueues, type BridgeNaming } from '../src/ui/consequences';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

const triples = (a: ArrayLike<number>) => {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 2 < a.length; i += 3) out.push([a[i]!, a[i + 1]!, a[i + 2]!]);
  return out;
};

// ---- a host on real wasm with a fake clock; `sims` are the created sims (A, then B…) ----
function host() {
  const memory = loadWasm();
  let t = 0;
  const sims: Sim[] = [];
  const wrap = (s: Sim): SimLike =>
    new Proxy(s as unknown as SimLike, {
      get(target, key) {
        if (key === 'branch')
          return (at: number) => {
            const b = s.branch(at);
            sims.push(b);
            return wrap(b);
          };
        const v = Reflect.get(target, key) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  const posted: FromWorker[] = [];
  const h = createSimHost({
    createSim: (d, b, city) => {
      const s = city === 'three_bridges' ? Sim.three_bridges(d, b) : Sim.river_city(d, b);
      sims.push(s);
      return wrap(s);
    },
    memory: () => memory,
    post: (m) => posted.push(m),
    now: () => t,
  });
  const send = (m: ToWorker) => h.handle(m);
  const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
  const comparisons = () => posted.filter((m): m is ComparisonMessage => m.type === 'comparison');
  const iterate = (n: number, ms = 16) => {
    for (let i = 0; i < n; i++) {
      t += ms;
      h.iterate();
    }
  };
  const ready = () => posted.find((m): m is ReadyMessage => m.type === 'ready')!;
  return { send, frames, comparisons, iterate, ready, sims };
}

const NAMES: BridgeNaming = {
  bridges: [
    { key: 'north_bridge', name: 'North Bridge', links: [1, 2] },
    { key: 'central_bridge', name: 'Main Bridge', links: [3, 4] },
    { key: 'south_bridge', name: 'Old Bridge', links: [5, 6] },
  ],
};

describe('motion-003', () => {
  test('2 command_log_getter', () => {
    loadWasm();
    const s = Sim.river_city(17, 23);
    const lm = JSON.parse(s.landmarks_json()) as Landmarks;
    const [c0, c1] = lm.central_bridge;
    s.step(100);
    expect(s.close_link(c0)).toBe(true);
    expect(s.close_link(c1)).toBe(true);
    s.step(50);
    s.open_link(c0);
    s.close_link(5);
    s.step(10);
    const hash = s.state_hash_hex();
    expect(triples(s.command_log())).toEqual([
      [100, 0, c0],
      [100, 0, c1],
      [150, 1, c0],
      [150, 0, 5],
    ]);
    // exits_at at or after the position: the current world (the link detail's cumulative exits)
    const links = Uint32Array.from([c0, c1, 5, 7]);
    const ex = s.exits_at(s.tick(), links);
    expect(ex[0], 'base = position').toBe(160);
    expect(Array.from(ex.subarray(1))).toEqual(Array.from(links).map((l) => s.link_detail(l)[4]));
    expect(s.exits_at(-1, links)[0], 'no snapshot before tick 0').toBeNaN();
    expect(s.exits_at(0, links)[0], 'the first snapshot is at tick 0').toBe(0);
    for (let i = 0; i < 5; i++) {
      s.command_log();
      s.exits_at(120, links);
    }
    expect(s.state_hash_hex(), 'the getters leave the world untouched').toBe(hash);
    // a branch keeps the commands before its tick; a command at the branch tick is B's own
    const b = s.branch(120);
    expect(triples(b.command_log())).toEqual([
      [100, 0, c0],
      [100, 0, c1],
    ]);
    b.close_link(7);
    expect(triples(b.command_log()).at(-1)).toEqual([120, 0, 7]);
    expect(triples(s.command_log()).length, 'A unchanged by B').toBe(4);
    // a schedule in the past truncates the later commands (as World does)
    expect(s.seek(130)).toBe(true);
    expect(triples(s.command_log()).length, 'a seek keeps the log').toBe(4);
    s.close_link(9);
    expect(triples(s.command_log())).toEqual([
      [100, 0, c0],
      [100, 0, c1],
      [130, 0, 9],
    ]);
  });

  test('3 summarize_interventions', () => {
    const log = [100, 0, 3, 100, 0, 4, 100, 0, 9, 200, 0, 5, 300, 1, 3, 300, 1, 4, 400, 0, 1];
    expect(summarizeInterventions(log, 350, NAMES)).toEqual([
      { tick: 100, kind: 'close', label: 'Main Bridge', links: [3, 4] },
      { tick: 100, kind: 'close', label: 'Link 9', links: [9] },
      { tick: 200, kind: 'close', label: 'Old Bridge (W→E)', links: [5] },
      { tick: 300, kind: 'open', label: 'Main Bridge', links: [3, 4] },
    ]);
    expect(summarizeInterventions(log, 99, NAMES), 'nothing at or before the position').toEqual([]);
    expect(summarizeInterventions(log, 400, NAMES).at(-1)).toEqual({ tick: 400, kind: 'close', label: 'North Bridge (W→E)', links: [1] });
    expect(summarizeInterventions([250, 0, 6], 300, NAMES)).toEqual([{ tick: 250, kind: 'close', label: 'Old Bridge (E→W)', links: [6] }]);
    // the two directions at different ticks are two entries
    expect(summarizeInterventions([100, 0, 3, 110, 0, 4], 200, NAMES).map((e) => e.label)).toEqual(['Main Bridge (W→E)', 'Main Bridge (E→W)']);
    // in tick order even if the log is not
    expect(summarizeInterventions([300, 0, 9, 100, 0, 8], 400, NAMES).map((e) => e.tick)).toEqual([100, 300]);
    expect(summarizeInterventions([], 1000, NAMES)).toEqual([]);
  });

  test('4 crossing_rates', () => {
    const NaN6 = [NaN, NaN, NaN, NaN, NaN, NaN];
    const flow = [
      // posTick, nowBase, exits at the position, exits at nowBase
      3000, 1800, 100, 110, 200, 210, 50, 60, 80, 90, 200, 210, 30, 40,
      // closeTick, beforeBase, exits at closeTick, exits at beforeBase
      1500, 360, 70, 75, 190, 200, 20, 25, 10, 15, 100, 110, 5, 5,
    ];
    const r = crossingRates(flow, NAMES);
    expect(r.map((x) => x.name)).toEqual(['North Bridge', 'Main Bridge', 'Old Bridge']);
    expect(r.map((x) => x.now)).toEqual([40, 0, 40]);
    expect(r.map((x) => x.nowSpanS)).toEqual([600, 600, 600]);
    expect(r[0]!.before).toBeCloseTo((120 * 1200) / 1140, 9);
    expect(r[1]!.before).toBeCloseTo((180 * 1200) / 1140, 9);
    expect(r[2]!.before).toBeCloseTo((35 * 1200) / 1140, 9);
    expect(r.map((x) => x.beforeSpanS)).toEqual([570, 570, 570]);
    for (const x of r) for (const v of [x.now, x.before]) expect(v!).toBeGreaterThanOrEqual(0);
    // no close: no "before"
    const noClose = [...flow.slice(0, 14), NaN, NaN, ...NaN6, ...NaN6];
    expect(crossingRates(noClose, NAMES).map((x) => [x.before, x.beforeSpanS])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
    // no base for "now" (window too short), or a zero span: null, never a made-up number
    const noBase = [3000, NaN, 100, 110, 200, 210, 50, 60, ...NaN6, ...flow.slice(14)];
    expect(crossingRates(noBase, NAMES).map((x) => x.now)).toEqual([null, null, null]);
    const zero = [3000, 3000, 100, 110, 200, 210, 50, 60, 100, 110, 200, 210, 50, 60, ...flow.slice(14)];
    expect(crossingRates(zero, NAMES).map((x) => x.now)).toEqual([null, null, null]);
    expect(crossingRates([], NAMES), 'no landmarks: nothing').toEqual([]);
  });

  test('5 top_queues', () => {
    const q = [0, 5, 3, 9, 9, 2, 4];
    expect(topQueues(q)).toEqual([
      { link: 3, queued: 9 },
      { link: 4, queued: 9 },
      { link: 1, queued: 5 },
    ]);
    expect(topQueues(q, 3, 6)).toEqual([
      { link: 3, queued: 9 },
      { link: 4, queued: 9 },
    ]);
    expect(topQueues(q, 5)).toEqual([
      { link: 3, queued: 9 },
      { link: 4, queued: 9 },
      { link: 1, queued: 5 },
      { link: 6, queued: 4 },
      { link: 2, queued: 3 },
    ]);
    expect(topQueues([0, 0, 2, 1])).toEqual([]);
    expect(topQueues(Uint16Array.from([7, 7, 7]), 2)).toEqual([
      { link: 0, queued: 7 },
      { link: 1, queued: 7 },
    ]);
  });

  test('6 frame_and_comparison_carry_consequences', () => {
    const w = host();
    w.send({ type: 'init', demandSeed: 17, behaviorSeed: 23, warmupS: 600 });
    for (let i = 0; i < 4000 && w.frames().length === 0; i++) w.iterate(1, 4);
    const lm = w.ready().landmarks;
    const L = Uint32Array.from([...lm.north_bridge, ...lm.central_bridge, ...lm.south_bridge]);
    w.send({ type: 'setSpeed', multiplier: 60 });
    w.send({ type: 'setRunning', running: true });
    w.iterate(60);
    w.send({ type: 'command', kind: 'close', link: lm.central_bridge[0] });
    w.send({ type: 'command', kind: 'close', link: lm.central_bridge[1] });
    w.iterate(2);
    const A = w.sims[0]!;
    const closeTick = triples(A.command_log()).at(-1)![0];
    for (let i = 0; i < 4000 && A.tick() < closeTick + 1500; i++) w.iterate(1);
    w.send({ type: 'setRunning', running: false });
    w.iterate(3);
    const f = w.frames().at(-1)!;
    expect(f.tick, 'paused: the frame is at the position').toBe(A.tick());
    expect(Array.from(f.interventions)).toEqual(Array.from(A.command_log()));
    // bridgeFlow = exits_at read directly
    const exNow = A.exits_at(f.tick - 1200, L);
    const exClose = A.exits_at(closeTick, L);
    const exBefore = A.exits_at(closeTick - 1200, L);
    const expected = [f.tick, exNow[0]!, ...A.exits_at(f.tick, L).subarray(1), ...exNow.subarray(1), closeTick, exBefore[0]!, ...exClose.subarray(1), ...exBefore.subarray(1)];
    expect(f.bridgeFlow.length).toBe(2 * (2 + 2 * 6));
    expect(Array.from(f.bridgeFlow)).toEqual(expected);
    expect(exClose[0], 'the close tick is read at or before it').toBeLessThanOrEqual(closeTick);
    expect(crossingRates(f.bridgeFlow, { bridges: [] }), 'well-formed').toEqual([]);

    // a branch before the closure (B without it), then compare: crossings since the branch
    const at = closeTick - 100;
    w.send({ type: 'branch', fromTick: at, then: [] });
    w.iterate(2);
    w.send({ type: 'compare', on: true });
    w.iterate(2);
    w.send({ type: 'setRunning', running: true });
    w.iterate(80);
    w.send({ type: 'setRunning', running: false });
    w.iterate(3);
    const c = w.comparisons().at(-1)!;
    const B = w.sims[1]!;
    expect(c.crossings, 'the comparison carries crossings').toBeDefined();
    expect(c.crossings!.baseTick).toBe(at);
    const since = (s: Sim) => {
      const now = s.exits_at(s.tick(), L);
      const base = B.exits_at(at, L); // both sides hold the same counts at the branch tick
      expect(base[0]).toBe(at);
      return Array.from(now.subarray(1)).map((v, i) => v - base[i + 1]!);
    };
    expect(A.tick()).toBe(B.tick());
    expect(Array.from(c.crossings!.a)).toEqual(since(A));
    expect(Array.from(c.crossings!.b)).toEqual(since(B));
    expect(c.a[2], 'identical demand: generated A = B').toBe(c.b[2]);
    // the closure is visible in the data: A (closed) carries nothing over the Main Bridge after the close
    const main = [2, 3];
    expect(main.map((i) => c.crossings!.a[i]!).reduce((x, y) => x + y)).toBeLessThan(main.map((i) => c.crossings!.b[i]!).reduce((x, y) => x + y));

    // leave compare, view A, seek back before the closure: no "before" block, the log still lists it
    w.send({ type: 'compare', on: false });
    w.send({ type: 'discardBranch' });
    w.iterate(2);
    w.send({ type: 'seek', tick: closeTick - 300 });
    w.iterate(3);
    const g = w.frames().at(-1)!;
    expect(g.tick).toBe(closeTick - 300);
    expect(g.bridgeFlow.slice(14).every((v) => Number.isNaN(v)), 'no close at or before the position').toBe(true);
    expect(triples(g.interventions).some(([t]) => t === closeTick), 'the log keeps the later command').toBe(true);
    expect(summarizeInterventions(g.interventions, g.tick, NAMES), 'the summary leaves it out').toEqual([]);
  }, 300_000);
});
