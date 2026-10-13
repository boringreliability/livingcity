// Ward motion-003, tests 2–6 (vitest): the command-log and exits getters, the pure consequence readings,
// and the frame / comparison fields the host builds from them (read-only: no new World state).
import { describe, expect, test } from 'vitest';

import { bridgeNaming } from '../src/render/cities';
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
  /** While set, the host sees no snapshot older than the position (as if the replay window evicted them). */
  const evict = { on: false };
  const wrap = (s: Sim): SimLike =>
    new Proxy(s as unknown as SimLike, {
      get(target, key) {
        if (key === 'exits_at')
          return (tick: number, links: Uint32Array) => {
            const r = s.exits_at(tick, links);
            if (evict.on && tick < s.tick()) r.fill(NaN);
            return r;
          };
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
  return { send, frames, comparisons, iterate, ready, sims, evict };
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

  test('2b bridge_naming', () => {
    const lm: Landmarks = { north_bridge: [1, 2], central_bridge: [3, 4], south_bridge: [5, 6] };
    expect(bridgeNaming('river_city', lm)).toEqual({
      bridges: [
        { key: 'north_bridge', name: 'North Bridge', links: [1, 2] },
        { key: 'central_bridge', name: 'Main Bridge', links: [3, 4] },
        { key: 'south_bridge', name: 'Old Bridge', links: [5, 6] },
      ],
    });
    expect(bridgeNaming('three_bridges', lm).bridges.map((b) => b.name)).toEqual(['North Bridge', 'Main Bridge', 'South Bridge']);
    expect(bridgeNaming('unknown', lm).bridges.map((b) => b.name)).toEqual(['North Bridge', 'Main Bridge', 'South Bridge']);
  });

  test('4 crossing_rates', () => {
    const NaN15 = Array<number>(15).fill(NaN);
    // [refTick, refBase, fromBase, …L at refBase, …L at fromBase]
    const now = [3000, 3000, 1800, 100, 110, 200, 210, 50, 60, 80, 90, 200, 210, 30, 40];
    // a close at 1530 (off the 120-tick grid): counts at its snapshot base 1440, from base 360 (an evicted
    // window gives a shorter span than 1200)
    const before = [1530, 1440, 360, 70, 75, 190, 200, 20, 25, 10, 15, 100, 110, 5, 5];
    const r = crossingRates([...now, ...before], NAMES);
    expect(r.map((x) => x.name)).toEqual(['North Bridge', 'Main Bridge', 'Old Bridge']);
    expect(r.map((x) => x.now)).toEqual([40, 0, 40]);
    expect(r.map((x) => x.nowSpanS)).toEqual([600, 600, 600]);
    expect(r[0]!.before).toBeCloseTo((120 * 1200) / 1080, 9);
    expect(r[1]!.before).toBeCloseTo((180 * 1200) / 1080, 9);
    expect(r[2]!.before).toBeCloseTo((35 * 1200) / 1080, 9);
    expect(r.map((x) => x.beforeSpanS), 'the span between the two bases, not from the close tick').toEqual([540, 540, 540]);
    // no bridge closure: no "before"
    expect(crossingRates([...now, ...NaN15], NAMES).map((x) => [x.before, x.beforeSpanS])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
    // no base for "now" (window too short), or a zero span: null, never a made-up number
    const noBase = [3000, 3000, NaN, 100, 110, 200, 210, 50, 60, NaN, NaN, NaN, NaN, NaN, NaN];
    expect(crossingRates([...noBase, ...before], NAMES).map((x) => x.now)).toEqual([null, null, null]);
    const zero = [3000, 3000, 3000, 100, 110, 200, 210, 50, 60, 100, 110, 200, 210, 50, 60];
    expect(crossingRates([...zero, ...before], NAMES).map((x) => x.now)).toEqual([null, null, null]);
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
    const isBridge = new Set(L);
    let side = 0;
    while (isBridge.has(side)) side++; // a link that is not a bridge
    w.send({ type: 'setSpeed', multiplier: 60 });
    w.send({ type: 'setRunning', running: true });
    w.iterate(60);
    w.send({ type: 'command', kind: 'close', link: lm.central_bridge[0] });
    w.send({ type: 'command', kind: 'close', link: lm.central_bridge[1] });
    w.iterate(2);
    const A = w.sims[0]!;
    const closeTick = triples(A.command_log()).at(-1)![0];
    for (let i = 0; i < 4000 && A.tick() < closeTick + 900; i++) w.iterate(1);
    // a later closure of a side street does not move the "before the closure" window (bridges only)
    w.send({ type: 'command', kind: 'close', link: side });
    for (let i = 0; i < 4000 && A.tick() < closeTick + 1500; i++) w.iterate(1);
    w.send({ type: 'setRunning', running: false });
    w.iterate(3);
    const f = w.frames().at(-1)!;
    expect(f.tick, 'paused: the frame is at the position').toBe(A.tick());
    expect(Array.from(f.interventions)).toEqual(Array.from(A.command_log()));
    expect(triples(f.interventions).length, 'two bridge directions and the side street').toBe(3);
    // bridgeFlow = exits_at read directly, two blocks [refTick, refBase, fromBase, …at refBase, …at fromBase]
    const at = (t: number) => A.exits_at(t, L);
    const block = (ref: number) => {
      const r = at(ref);
      const from = at(ref - 1200);
      return [ref, r[0]!, from[0]!, ...r.subarray(1), ...from.subarray(1)];
    };
    expect(f.bridgeFlow.length).toBe(30);
    expect(Array.from(f.bridgeFlow)).toEqual([...block(f.tick), ...block(closeTick)]);
    expect(f.bridgeFlow[16], 'the close side is read at a snapshot at or before the close').toBeLessThanOrEqual(closeTick);

    // a branch before the closure (B without it), then compare: crossings since the branch
    const bt = closeTick - 100;
    w.send({ type: 'branch', fromTick: bt, then: [] });
    w.iterate(2);
    const B = w.sims[1]!;
    const base = B.exits_at(bt, L); // both sides hold the same counts at the branch tick
    expect(base[0]).toBe(bt);
    // from here the host sees no snapshot older than the position (the window evicted them): the
    // comparison must not depend on reading the branch tick again
    w.evict.on = true;
    w.send({ type: 'compare', on: true });
    w.iterate(2);
    w.send({ type: 'setRunning', running: true });
    for (let i = 0; i < 6000 && A.tick() < closeTick + 600; i++) w.iterate(1);
    w.send({ type: 'setRunning', running: false });
    w.iterate(3);
    const c = w.comparisons().at(-1)!;
    expect(c.crossings, 'the comparison carries crossings').toBeDefined();
    expect(c.crossings!.baseTick).toBe(bt);
    const since = (s: Sim) => Array.from(s.exits_at(s.tick(), L).subarray(1)).map((v, i) => v - base[i + 1]!);
    expect(A.tick()).toBe(B.tick());
    expect(Array.from(c.crossings!.a)).toEqual(since(A));
    expect(Array.from(c.crossings!.b)).toEqual(since(B));
    expect(c.a[2], 'identical demand: generated A = B').toBe(c.b[2]);
    // the closure is visible in the data: A (closed 100 ticks after the branch) crosses the Main Bridge
    // less than B (open) since the branch
    const main = [2, 3];
    const sum = (x: Float64Array) => main.map((i) => x[i]!).reduce((p, q) => p + q);
    expect(sum(c.crossings!.a)).toBeLessThan(sum(c.crossings!.b));
    w.evict.on = false;

    // leave compare, view A, seek back before the closure: no "before" block, the log still lists it
    w.send({ type: 'compare', on: false });
    w.send({ type: 'discardBranch' });
    w.iterate(2);
    w.send({ type: 'seek', tick: closeTick - 300 });
    w.iterate(3);
    const g = w.frames().at(-1)!;
    expect(g.tick).toBe(closeTick - 300);
    expect(g.bridgeFlow.slice(15).every((v) => Number.isNaN(v)), 'no bridge close at or before the position').toBe(true);
    expect(triples(g.interventions).some(([t]) => t === closeTick), 'the log keeps the later command').toBe(true);
    expect(summarizeInterventions(g.interventions, g.tick, NAMES), 'the summary leaves it out').toEqual([]);
  }, 300_000);
});
