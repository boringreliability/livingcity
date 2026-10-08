// Ward timeline-004, tests 1–10: lockstep comparison in the worker host (contract T4).
import { describe, expect, test } from 'vitest';

import { ITERATION_BUDGET_MS } from '../src/sim/clock';
import { createSimHost, type SimLike } from '../src/sim/host';
import type { FrameMessage, FromWorker, ToWorker } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

type Comparison = { type: 'comparison'; tick: number; fromTick: number; a: Float64Array; b: Float64Array };

/** A host on real wasm (three_bridges 17/23) with a fake clock. Every created sim (A and its
 * branches) is exposed; `tickCostMs` makes each sim step cost fake wall time; `calls` logs
 * `window_metrics`, `free` and `branch` calls in order. */
function host(opts: { tickCostMs?: number } = {}) {
  const memory = loadWasm();
  let t = 0;
  const sims: Sim[] = [];
  const calls: { op: string; sim: number; tick: number; arg?: number }[] = [];
  const wrap = (s: Sim): SimLike =>
    new Proxy(s as unknown as SimLike, {
      get(target, key) {
        const id = sims.indexOf(s);
        if (key === 'step')
          return (n: number) => {
            t += n * (opts.tickCostMs ?? 0);
            s.step(n);
          };
        if (key === 'branch')
          return (at: number) => {
            calls.push({ op: 'branch', sim: id, tick: s.tick(), arg: at });
            const b = s.branch(at);
            sims.push(b);
            return wrap(b);
          };
        if (key === 'window_metrics')
          return (from: number) => {
            calls.push({ op: 'window_metrics', sim: id, tick: s.tick(), arg: from });
            return s.window_metrics(from);
          };
        if (key === 'free')
          return () => {
            calls.push({ op: 'free', sim: id, tick: -1 });
            s.free();
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
  /** Iterations of `ms` host time each; returns the longest host time one iterate() took. */
  const iterate = (n: number, ms = 4) => {
    let longest = 0;
    for (let i = 0; i < n; i++) {
      t += ms;
      const t0 = t;
      h.iterate();
      longest = Math.max(longest, t - t0);
    }
    return longest;
  };
  const runViewedTo = (tick: number) => {
    send({ type: 'setSpeed', multiplier: 60 });
    send({ type: 'setRunning', running: true });
    for (let i = 0; i < 100_000 && (frames().at(-1)?.tick ?? 0) < tick; i++) iterate(1, 16);
    send({ type: 'setRunning', running: false });
    iterate(2);
  };
  const start = () => send({ type: 'init', demandSeed: 17, behaviorSeed: 23, city: 'three_bridges' });
  return { send, frames, comparisons, errors, iterate, runViewedTo, start, sims, calls, now: () => t, posted };
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

/** Frames posted while comparing must come in strict (A, B) pairs with one tick and compare set. */
function strictPairs(fs: FrameMessage[]): [FrameMessage, FrameMessage][] {
  expect(fs.length % 2).toBe(0);
  const out: [FrameMessage, FrameMessage][] = [];
  for (let i = 0; i < fs.length; i += 2) {
    expect([fs[i]!.scenario, fs[i + 1]!.scenario]).toEqual([0, 1]);
    expect(fs[i]!.tick).toBe(fs[i + 1]!.tick);
    expect([fs[i]!.timeline.compare, fs[i + 1]!.timeline.compare]).toEqual([1, 1]);
    out.push([fs[i]!, fs[i + 1]!]);
  }
  return out;
}

describe('timeline-004 host: lockstep comparison', () => {
  test('1 compare_aligns_and_pauses', () => {
    const { x, bTick } = scenario();
    // entered while B runs: aligning pauses both
    x.send({ type: 'setRunning', running: true });
    x.iterate(3, 16);
    const t1 = x.frames().at(-1)!.tick;
    expect(t1).toBeGreaterThan(bTick);
    const n = x.frames().length;
    x.send({ type: 'compare', on: true });
    x.iterate(3);
    const ps = strictPairs(x.frames().slice(n));
    expect(ps.length).toBeGreaterThan(0);
    for (const [a, b] of ps) {
      expect([a.tick, b.tick]).toEqual([t1, t1]);
      expect(a.clock.running).toBe(false);
      expect(b.clock.running).toBe(false);
    }
    expect(x.sims[0]!.timeline_info()[1]).toBeGreaterThanOrEqual(1200); // A was sought (its own head kept)
    // B ahead of A's position: leave, view A at 1,100 (> B's head), re-enter: B steps forward
    x.send({ type: 'compare', on: false });
    x.send({ type: 'viewScenario', scenario: 0 });
    x.send({ type: 'seek', tick: 1100 });
    const m = x.frames().length;
    x.send({ type: 'compare', on: true });
    x.iterate(3);
    const ps2 = strictPairs(x.frames().slice(m));
    expect(ps2.length).toBeGreaterThan(0);
    for (const [a, b] of ps2) {
      expect([a.tick, b.tick]).toEqual([1100, 1100]);
      expect(a.clock.running || b.clock.running).toBe(false);
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
    const ps = strictPairs(x.frames().slice(n));
    expect(ps.length).toBeGreaterThan(20);
    x.send({ type: 'setRunning', running: false });
    x.iterate(2);
    const [simA, simB] = [x.sims[0]!, x.sims[1]!];
    const tick = simA.tick();
    expect(simB.tick()).toBe(tick);
    const refA = Sim.three_bridges(17, 23);
    refA.step(tick);
    const refB = Sim.three_bridges(17, 23);
    refB.step(600);
    for (const l of main) refB.close_link(l);
    refB.step(tick - 600);
    expect(simA.state_hash_hex()).toBe(refA.state_hash_hex());
    expect(simB.state_hash_hex()).toBe(refB.state_hash_hex());
    // and each frame of the last pair comes from its own side
    const [fa, fb] = strictPairs(x.frames().slice(-2))[0]!;
    expect(Array.from(fb.closed)).toEqual(expect.arrayContaining(main));
    expect(Array.from(fa.closed).some((l) => main.includes(l))).toBe(false);
    expect(Array.from(fa.metrics)).toEqual(Array.from(simA.metrics()));
    expect(Array.from(fb.metrics)).toEqual(Array.from(simB.metrics()));
  });

  test('3 comparison_messages', () => {
    const { x } = scenario();
    expect(x.comparisons().length).toBe(0); // none outside compare
    x.send({ type: 'compare', on: true });
    expect(x.comparisons().length).toBe(1); // at once on entering
    x.send({ type: 'seek', tick: 800 });
    expect(x.comparisons().length).toBe(2); // at once after a seek
    const t0 = x.now();
    x.send({ type: 'setSpeed', multiplier: 20 });
    x.send({ type: 'setRunning', running: true });
    x.iterate(400, 10); // 4 s of host time
    const running = x.comparisons().slice(2);
    expect(running.length).toBeGreaterThanOrEqual(6);
    expect(running.length).toBeLessThanOrEqual(Math.floor((x.now() - t0) / 500) + 1);
    const pairTicks = new Set(strictPairs(x.frames().filter((f) => f.timeline.compare === 1)).map(([a]) => a.tick));
    for (const c of running) {
      expect(c.fromTick).toBe(600);
      expect(pairTicks.has(c.tick)).toBe(true);
      for (const w of [c.a, c.b]) expect(w[6]).toBe(w[2]! - w[3]! - w[4]! - w[5]!);
      // both sides' window_metrics were computed at that very tick
      const at = x.calls.filter((k) => k.op === 'window_metrics' && k.tick === c.tick);
      expect(new Set(at.map((k) => k.sim))).toEqual(new Set([0, 1]));
      for (const k of at) expect(k.arg).toBe(600);
    }
    x.send({ type: 'setRunning', running: false });
    x.iterate(2);
    const last = x.comparisons().at(-1)!; // a pause sends one
    const [simA, simB] = [x.sims[0]!, x.sims[1]!];
    expect(last.tick).toBe(simA.tick());
    expect(simB.tick()).toBe(last.tick);
    expect(Array.from(last.a)).toEqual(Array.from(simA.window_metrics(600)));
    expect(Array.from(last.b)).toEqual(Array.from(simB.window_metrics(600)));
    expect(last.b[6]!).toBeGreaterThanOrEqual(last.a[6]!);
    expect(x.errors()).toEqual([]);
  });

  test('4 seek_in_compare_moves_both', () => {
    const { x } = scenario();
    x.send({ type: 'compare', on: true });
    x.send({ type: 'seek', tick: 700 });
    x.iterate(2);
    const [a, b] = strictPairs(x.frames().slice(-2))[0]!;
    expect([a.tick, b.tick]).toEqual([700, 700]);
    // the shared window: [max(starts, branchTick), min(heads)]
    expect(a.timeline.windowStartTick).toBe(600);
    expect(b.timeline.windowStartTick).toBe(600);
    expect(a.timeline.headTick).toBe(b.timeline.headTick);
    const [simA, simB] = [x.sims[0]!, x.sims[1]!];
    const hashes = [simA.state_hash_hex(), simB.state_hash_hex()];
    for (const bad of [a.timeline.headTick + 50, 599]) {
      const nErr = x.errors().length;
      x.send({ type: 'seek', tick: bad }); // beyond B's head / before the branch
      expect(x.errors().length).toBe(nErr + 1);
      expect([simA.state_hash_hex(), simB.state_hash_hex()]).toEqual(hashes);
      expect([simA.tick(), simB.tick()]).toEqual([700, 700]);
    }
  });

  test('5 commands_refused_in_compare', () => {
    const { x, main } = scenario();
    x.send({ type: 'compare', on: true });
    const [simA, simB] = [x.sims[0]!, x.sims[1]!];
    const hashes = [simA.state_hash_hex(), simB.state_hash_hex()];
    const nErr = x.errors().length;
    x.send({ type: 'command', kind: 'open', link: main[0] });
    expect(x.errors().length).toBe(nErr + 1);
    x.send({ type: 'setRunning', running: true });
    x.iterate(20, 16);
    expect(Array.from(x.frames().at(-1)!.closed)).toEqual(expect.arrayContaining(main)); // B still closed
    expect(simA.tick()).toBe(simB.tick());
    expect(hashes).not.toContain(simA.state_hash_hex()); // it ran
  });

  test('6 behind_counts_the_pair', () => {
    // 3 ms per sim step: one sim manages ≤ 333 ticks/s; with 4 ms per iteration and the 8 ms
    // budget the pair runs 1 tick per 4 + 6 = 10 ms = 100/s (a host timing one sim: 120, not behind)
    const x = host({ tickCostMs: 3 });
    x.start();
    x.send({ type: 'setSpeed', multiplier: 60 });
    x.send({ type: 'setRunning', running: true });
    x.iterate(800);
    const single = x.frames().at(-1)!.clock;
    expect(single.behind).toBe(false);
    expect(single.achievedTicksPerS).toBeGreaterThanOrEqual(115);
    x.send({ type: 'branch', fromTick: x.frames().at(-1)!.tick, then: [] });
    x.send({ type: 'compare', on: true });
    x.send({ type: 'setRunning', running: true });
    x.iterate(300);
    const longest = x.iterate(1200);
    const pair = x.frames().at(-1)!.clock;
    expect(pair.behind).toBe(true);
    expect(pair.achievedTicksPerS).toBeGreaterThan(90);
    expect(pair.achievedTicksPerS).toBeLessThan(110);
    expect(longest).toBeLessThanOrEqual(ITERATION_BUDGET_MS + 2 * 3);
  });

  test('7 exit_compare_single_view', () => {
    const { x } = scenario();
    x.send({ type: 'compare', on: true });
    x.send({ type: 'compare', on: false });
    const n = x.frames().length;
    const c = x.comparisons().length;
    x.send({ type: 'setRunning', running: true });
    x.iterate(50, 16);
    const after = x.frames().slice(n);
    expect(after.length).toBeGreaterThan(5);
    for (const f of after) {
      expect(f.scenario).toBe(1); // B stays viewed
      expect(f.timeline.compare).toBe(0);
    }
    expect(x.comparisons().length).toBe(c); // no comparisons outside compare
    // discard while comparing ends compare and frees B
    x.send({ type: 'compare', on: true });
    x.send({ type: 'discardBranch' });
    x.iterate(3);
    expect(x.frames().at(-1)!.scenario).toBe(0);
    expect(x.frames().at(-1)!.timeline.compare).toBe(0);
    expect(x.frames().at(-1)!.timeline.branchTick).toBe(-1);
    expect(x.calls.filter((k) => k.op === 'free').map((k) => k.sim)).toEqual([1]);
    const c2 = x.comparisons().length;
    x.send({ type: 'setRunning', running: true });
    x.iterate(50, 16);
    expect(x.comparisons().length).toBe(c2);
  });

  test('8 compare_refused_without_branch', () => {
    const x = host();
    x.start();
    x.runViewedTo(400);
    const nErr = x.errors().length;
    x.send({ type: 'compare', on: true });
    expect(x.errors().length).toBe(nErr + 1);
    x.iterate(2);
    expect(x.frames().at(-1)!.timeline.compare).toBe(0);
    expect(x.comparisons()).toEqual([]);
  });

  test('9 view_switch_and_vehicle_picks_refused_in_compare', () => {
    const { x } = scenario();
    // tracked in single view …
    const f0 = x.frames().at(-1)!;
    x.send({ type: 'inspectVehicle', frameTick: f0.tick, record: 0, seq: 1 });
    x.iterate(2);
    expect(x.frames().at(-1)!.tracked).not.toBeNull();
    // … and no longer once comparing
    x.send({ type: 'compare', on: true });
    x.iterate(2);
    const nErr = x.errors().length;
    x.send({ type: 'viewScenario', scenario: 0 });
    expect(x.errors().length).toBe(nErr + 1);
    const [, fb] = strictPairs(x.frames().slice(-2))[0]!;
    x.send({ type: 'inspectVehicle', frameTick: fb.tick, record: 0, seq: 2 }); // ignored while comparing
    const n = x.frames().length;
    x.iterate(4);
    const after = strictPairs(x.frames().slice(n));
    expect(after.length).toBeGreaterThan(0);
    for (const [a, b] of after) {
      expect(a.tracked ?? null).toBeNull();
      expect(b.tracked ?? null).toBeNull();
      expect(a.linkDetail ?? null).toBeNull(); // no host link detail while comparing
      expect(b.linkDetail ?? null).toBeNull();
    }
  });

  test('10 replace_order_and_compare_end', () => {
    const { x } = scenario();
    x.send({ type: 'compare', on: true });
    const before = x.calls.length;
    // out of A's window: refused before anything is built or freed; compare stays on
    x.send({ type: 'viewScenario', scenario: 0 }); // refused in compare (test 9): stay on B
    x.send({ type: 'compare', on: false });
    x.send({ type: 'viewScenario', scenario: 0 });
    x.send({ type: 'compare', on: true });
    const mid = x.calls.length;
    const nErr = x.errors().length;
    x.send({ type: 'branch', fromTick: 99_999, then: [] });
    expect(x.errors().length).toBe(nErr + 1);
    expect(x.calls.slice(mid).filter((k) => k.op === 'free' || k.op === 'branch')).toEqual([]);
    x.iterate(2);
    expect(x.frames().at(-1)!.timeline.compare).toBe(1);
    // a valid replace frees the old B before building the new one, and ends compare
    x.send({ type: 'branch', fromTick: 700, then: [] });
    const ops = x.calls.slice(mid).filter((k) => k.op === 'free' || k.op === 'branch');
    expect(ops.map((k) => [k.op, k.sim])).toEqual([
      ['free', 1],
      ['branch', 0],
    ]);
    x.iterate(2);
    const f = x.frames().at(-1)!;
    expect(f.timeline.compare).toBe(0);
    expect(f.timeline.branchTick).toBe(700);
    expect(before).toBeGreaterThan(0);
  });
});
