// Ward timeline-004, tests 1–8: lockstep comparison in the worker host (contract T4).
import { describe, expect, test } from 'vitest';

import { createSimHost, type SimLike } from '../src/sim/host';
import type { FrameMessage, FromWorker, ToWorker } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

type Comparison = { type: 'comparison'; tick: number; fromTick: number; a: Float64Array; b: Float64Array };

/** A host on real wasm (three_bridges 17/23) with a fake clock. Every created sim (A and its
 * branches) is exposed; `tickCostMs` makes each sim step cost fake wall time. */
function host(opts: { tickCostMs?: number } = {}) {
  const memory = loadWasm();
  let t = 0;
  const sims: Sim[] = [];
  const wrap = (s: Sim): SimLike =>
    new Proxy(s as unknown as SimLike, {
      get(target, key) {
        if (key === 'step')
          return (n: number) => {
            t += n * (opts.tickCostMs ?? 0);
            s.step(n);
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
    createSim: (d, b) => {
      const s = Sim.three_bridges(d, b);
      sims.push(s);
      return wrap(s);
    },
    memory: () => memory,
    post: (m) => posted.push(m),
    now: () => t,
  });
  const send = (m: ToWorker) => h.handle(m);
  const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
  const comparisons = () => posted.filter((m) => (m as { type: string }).type === 'comparison') as unknown as Comparison[];
  const errors = () => posted.filter((m) => m.type === 'error');
  const iterate = (n: number, ms = 4) => {
    for (let i = 0; i < n; i++) {
      t += ms;
      h.iterate();
    }
  };
  const runViewedTo = (tick: number) => {
    send({ type: 'setSpeed', multiplier: 60 });
    send({ type: 'setRunning', running: true });
    for (let i = 0; i < 100_000 && (frames().at(-1)?.tick ?? 0) < tick; i++) iterate(1, 16);
    send({ type: 'setRunning', running: false });
    iterate(2);
  };
  const start = () => send({ type: 'init', demandSeed: 17, behaviorSeed: 23, city: 'three_bridges' });
  return { send, frames, comparisons, errors, iterate, runViewedTo, start, sims, now: () => t, posted };
}

const CENTRAL = (s: Sim) => (JSON.parse(s.landmarks_json()) as { central_bridge: [number, number] }).central_bridge;

/** A at 1,000 (head 1,200), B branched at 600 with the main bridge closed and run to 900, B viewed. */
function scenario() {
  const x = host();
  x.start();
  x.runViewedTo(1200);
  x.send({ type: 'seek', tick: 1000 });
  const main = CENTRAL(x.sims[0]!);
  x.send({ type: 'branch', fromTick: 600, then: main.map((link) => ({ kind: 'close' as const, link })) });
  x.runViewedTo(900);
  return { x, main, bTick: x.frames().at(-1)!.tick };
}

/** Frame pairs posted while comparing: consecutive (scenario 0, scenario 1) frames. */
function pairs(fs: FrameMessage[]): [FrameMessage, FrameMessage][] {
  const out: [FrameMessage, FrameMessage][] = [];
  for (let i = 0; i + 1 < fs.length; i++) {
    if (fs[i]!.scenario === 0 && fs[i + 1]!.scenario === 1) out.push([fs[i]!, fs[i + 1]!]);
  }
  return out;
}

describe('timeline-004 host: lockstep comparison', () => {
  test('1 compare_aligns_and_pauses', () => {
    const { x, bTick } = scenario();
    const n = x.frames().length;
    x.send({ type: 'compare', on: true });
    x.iterate(3);
    const ps = pairs(x.frames().slice(n));
    expect(ps.length).toBeGreaterThan(0);
    for (const [a, b] of ps) {
      expect(a.tick).toBe(bTick);
      expect(b.tick).toBe(bTick);
      expect(a.clock.running || b.clock.running).toBe(false);
      expect(a.timeline.compare).toBe(1);
    }
    // viewing A instead (A at bTick now): leaving and re-entering aligns B to A's position
    x.send({ type: 'compare', on: false });
    x.send({ type: 'viewScenario', scenario: 0 });
    x.send({ type: 'seek', tick: 1100 }); // A ahead of B's head (900): B must step forward
    const m = x.frames().length;
    x.send({ type: 'compare', on: true });
    x.iterate(3);
    for (const [a, b] of pairs(x.frames().slice(m))) {
      expect(a.tick).toBe(1100);
      expect(b.tick).toBe(1100);
    }
    expect(x.errors()).toEqual([]);
  });

  test('2 lockstep_equals_separate_runs', () => {
    const { x, main } = scenario();
    x.send({ type: 'compare', on: true });
    const n = x.frames().length;
    x.send({ type: 'setSpeed', multiplier: 60 });
    x.send({ type: 'setRunning', running: true });
    for (let i = 0; i < 100_000 && x.frames().at(-1)!.tick < 1500; i++) x.iterate(1, 16);
    x.send({ type: 'setRunning', running: false });
    x.iterate(2);
    const ps = pairs(x.frames().slice(n));
    expect(ps.length).toBeGreaterThan(20);
    for (const [a, b] of ps) expect(a.tick).toBe(b.tick);
    const tick = ps.at(-1)![0].tick;
    const [simA, simB] = [x.sims[0]!, x.sims[1]!];
    // references: A = plain run; B = A's history to 600, then the main bridge closed at 600
    const refA = Sim.three_bridges(17, 23);
    refA.step(tick);
    const refB = Sim.three_bridges(17, 23);
    refB.step(600);
    for (const l of main) refB.close_link(l);
    refB.step(tick - 600);
    expect(simA.tick()).toBe(tick);
    expect(simB.tick()).toBe(tick);
    expect(simA.state_hash_hex()).toBe(refA.state_hash_hex());
    expect(simB.state_hash_hex()).toBe(refB.state_hash_hex());
  });

  test('3 comparison_messages', () => {
    const { x } = scenario();
    const c0 = x.comparisons().length;
    x.send({ type: 'compare', on: true });
    expect(x.comparisons().length).toBe(c0 + 1); // at once on entering
    x.send({ type: 'seek', tick: 800 });
    expect(x.comparisons().length).toBe(c0 + 2); // at once after a seek
    const t0 = x.now();
    x.send({ type: 'setSpeed', multiplier: 20 });
    x.send({ type: 'setRunning', running: true });
    x.iterate(400, 10); // 4 s of host time
    const running = x.comparisons().slice(c0 + 2);
    expect(running.length).toBeGreaterThanOrEqual(6);
    expect(running.length).toBeLessThanOrEqual(Math.floor((x.now() - t0) / 500) + 1);
    x.send({ type: 'setRunning', running: false });
    x.iterate(2);
    const last = x.comparisons().at(-1)!;
    expect(last.fromTick).toBe(600);
    const [simA, simB] = [x.sims[0]!, x.sims[1]!];
    expect(last.tick).toBe(simA.tick());
    expect(Array.from(last.a)).toEqual(Array.from(simA.window_metrics(600)));
    expect(Array.from(last.b)).toEqual(Array.from(simB.window_metrics(600)));
    for (const w of [last.a, last.b]) {
      expect(w.length).toBe(9);
      expect(w[6]).toBe(w[2]! - w[3]! - w[4]! - w[5]!);
    }
    // the closure leaves more trips unfinished in B
    expect(last.b[6]!).toBeGreaterThanOrEqual(last.a[6]!);
  });

  test('4 seek_in_compare_moves_both', () => {
    const { x } = scenario();
    x.send({ type: 'compare', on: true });
    x.send({ type: 'seek', tick: 700 });
    x.iterate(2);
    const ps = pairs(x.frames());
    expect(ps.at(-1)![0].tick).toBe(700);
    expect(ps.at(-1)![1].tick).toBe(700);
    const [simA, simB] = [x.sims[0]!, x.sims[1]!];
    const hashes = [simA.state_hash_hex(), simB.state_hash_hex()];
    const nErr = x.errors().length;
    const bHead = ps.at(-1)![1].timeline.headTick;
    x.send({ type: 'seek', tick: bHead + 50 }); // within A's window, beyond B's head
    expect(x.errors().length).toBe(nErr + 1);
    expect([simA.state_hash_hex(), simB.state_hash_hex()]).toEqual(hashes);
    expect([simA.tick(), simB.tick()]).toEqual([700, 700]);
  });

  test('5 commands_refused_in_compare', () => {
    const { x, main } = scenario();
    x.send({ type: 'compare', on: true });
    const [simA, simB] = [x.sims[0]!, x.sims[1]!];
    const hashes = [simA.state_hash_hex(), simB.state_hash_hex()];
    const nErr = x.errors().length;
    x.send({ type: 'command', kind: 'open', link: main[0] });
    expect(x.errors().length).toBe(nErr + 1);
    expect([simA.state_hash_hex(), simB.state_hash_hex()]).toEqual(hashes);
  });

  test('6 behind_counts_the_pair', () => {
    const x = host({ tickCostMs: 5 });
    x.start();
    x.send({ type: 'setSpeed', multiplier: 60 });
    x.send({ type: 'setRunning', running: true });
    x.iterate(800); // single view, ~3+ s
    const single = x.frames().at(-1)!.clock;
    expect(single.behind).toBe(false);
    expect(single.achievedTicksPerS).toBeGreaterThan(110);
    x.send({ type: 'branch', fromTick: x.frames().at(-1)!.tick, then: [] });
    x.send({ type: 'compare', on: true });
    x.send({ type: 'setRunning', running: true });
    x.iterate(1500);
    const pair = x.frames().at(-1)!.clock;
    expect(pair.behind).toBe(true);
    expect(pair.achievedTicksPerS).toBeGreaterThan(90);
    expect(pair.achievedTicksPerS).toBeLessThan(110);
  });

  test('7 exit_compare_single_view', () => {
    const { x } = scenario();
    x.send({ type: 'compare', on: true });
    x.send({ type: 'compare', on: false });
    const n = x.frames().length;
    x.send({ type: 'setRunning', running: true });
    x.iterate(50, 16);
    const after = x.frames().slice(n);
    expect(after.length).toBeGreaterThan(5);
    for (const f of after) {
      expect(f.scenario).toBe(1); // B stays viewed
      expect(f.timeline.compare).toBe(0);
    }
    // discard while comparing ends compare and frees B
    x.send({ type: 'compare', on: true });
    const freed: string[] = [];
    const b = x.sims[1]!;
    const free = b.free.bind(b);
    (b as unknown as { free: () => void }).free = () => {
      freed.push('B');
      free();
    };
    x.send({ type: 'discardBranch' });
    x.iterate(3);
    expect(x.frames().at(-1)!.scenario).toBe(0);
    expect(x.frames().at(-1)!.timeline.compare).toBe(0);
    expect(x.frames().at(-1)!.timeline.branchTick).toBe(-1);
    expect(freed).toEqual(['B']);
  });

  test('8 compare_refused_without_branch_or_below_window', () => {
    const x = host();
    x.start();
    x.runViewedTo(400);
    const nErr = x.errors().length;
    x.send({ type: 'compare', on: true });
    expect(x.errors().length).toBe(nErr + 1);
    x.iterate(2);
    expect(x.frames().at(-1)!.timeline.compare).toBe(0);
  });
});
