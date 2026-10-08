// Ward city-005, tests 2–5: perf statistics, measurement isolation and the warm-up.
// Contract: `.wdd/wards/city/ward-005.md` § Specification and § Red-phase contract details.
import { describe, expect, test } from 'vitest';

import { createSimHost, type SimLike } from '../src/sim/host';
import { percentile, RENDER_WINDOW, SampleWindow, TICK_WINDOW, TickWindow, weightedPercentile } from '../src/sim/perf';
import {
  DT,
  WARMUP_SIM_S,
  parseDemandScale,
  type FrameMessage,
  type FromWorker,
  type ReadyMessage,
  type ToWorker,
} from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

describe('test 2: percentiles_nearest_rank', () => {
  test('median and p95 by nearest rank', () => {
    // nearest rank: rank = max(1, ceil(p·n)), value = sorted[rank − 1]
    expect(percentile([5], 0.5)).toBe(5);
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(twenty, 0.5)).toBe(10);
    expect(percentile(twenty, 0.95)).toBe(19);
    expect(percentile([7, 1, 9, 3, 5], 0.5)).toBe(5); // unsorted input
  });

  test('ties, tiny p and empty input', () => {
    expect(percentile([3, 3, 3, 9], 0.5)).toBe(3);
    expect(percentile([3, 3, 3, 9], 0.95)).toBe(9);
    expect(percentile([3, 3, 3, 9], 0.75)).toBe(3);
    expect(percentile([4, 2, 8], 0)).toBe(2); // rank is at least 1
    expect(percentile([], 0.5)).toBe(0);
  });

  test('does not mutate its input', () => {
    const v = [9, 1, 5];
    percentile(v, 0.5);
    expect(v).toEqual([9, 1, 5]);
  });

  test('SampleWindow keeps the last `capacity` finite values', () => {
    expect(RENDER_WINDOW).toBe(300);
    const w = new SampleWindow(4);
    expect(w.stats()).toEqual({ median: 0, p95: 0, count: 0 });
    for (const v of [100, 100, 1, 2, NaN, Infinity, 3, 4]) w.add(v);
    // the 100s fell out of the window; non-finite values were ignored
    expect(w.stats()).toEqual({ median: 2, p95: 4, count: 4 });
  });
});

describe('weightedPercentile (the harness statistics)', () => {
  test('weighted nearest rank over all samples', () => {
    expect(weightedPercentile([], 0.5)).toBe(0);
    expect(weightedPercentile([[1, 10], [2, 20]], 0.5)).toBe(2);
    expect(weightedPercentile([[1, 10], [2, 20]], 0.3)).toBe(1); // rank 9 ≤ 10
    expect(weightedPercentile([[5, 1], [1, 98], [9, 1]], 0.95)).toBe(1);
    expect(weightedPercentile([[5, 1], [1, 98], [9, 1]], 0.995)).toBe(9); // rank 100
    expect(weightedPercentile([[2, 0], [7, -1], [NaN, 5], [3, 4]], 0.5)).toBe(3); // invalid samples ignored
  });
});

describe('test 3: tick_window_weights_batches', () => {
  test('batches are weighted by their tick count', () => {
    expect(TICK_WINDOW).toBe(1000);
    const w = new TickWindow();
    expect(w.stats()).toEqual({ median: 0, p95: 0, max: 0, ticks: 0 });
    w.add(10, 10); // 1 ms/tick × 10
    w.add(40, 20); // 2 ms/tick × 20
    // W = 30: median rank 15 → 2 (cumulative 10 < 15); p95 rank 29 → 2
    expect(w.stats()).toEqual({ median: 2, p95: 2, max: 2, ticks: 30 });
    w.add(3, 1); // 3 ms/tick × 1: W = 31, p95 rank 30 → 2; max 3
    expect(w.stats()).toEqual({ median: 2, p95: 2, max: 3, ticks: 31 });
  });

  test('only the newest 1,000 ticks count; the oldest batch is truncated', () => {
    const w = new TickWindow();
    w.add(4.975, 995); // 0.005 ms/tick × 995
    w.add(30, 10); // 3 ms/tick × 10 → 1,005 ticks: the first batch counts 990
    const s = w.stats();
    expect(s.ticks).toBe(1000);
    expect(s.median).toBeCloseTo(0.005, 12);
    expect(s.p95).toBeCloseTo(0.005, 12); // rank 950 ≤ 990
    expect(s.max).toBe(3);
    w.add(1, 50); // 0.02 × 50: the 3 ms batch is still inside the newest 1,000 ticks
    expect(w.stats().max).toBe(3);
    expect(w.stats().ticks).toBe(1000);
    w.add(20, 1000); // 0.02 ms/tick × 1,000: every older batch drops out
    expect(w.stats()).toEqual({ median: 0.02, p95: 0.02, max: 0.02, ticks: 1000 });
  });

  test('one batch larger than the window is truncated to 1,000 ticks', () => {
    const w = new TickWindow();
    w.add(3000, 1500);
    expect(w.stats()).toEqual({ median: 2, p95: 2, max: 2, ticks: 1000 });
  });

  test('empty or invalid batches are ignored', () => {
    const w = new TickWindow();
    w.add(5, 0);
    w.add(5, -3);
    w.add(NaN, 10);
    w.add(Infinity, 10);
    expect(w.stats().ticks).toBe(0);
    w.add(0, 10); // 0 ms is a valid (coarse-clock) measurement
    expect(w.stats()).toEqual({ median: 0, p95: 0, max: 0, ticks: 10 });
  });
});

/** A host on real wasm with its own fake clock; the created Sim is exposed for hashing. */
function host(opts: { perfNow?: () => number; city?: 'three_bridges' | 'river_city'; tickCostMs?: number } = {}) {
  const memory = loadWasm();
  let t = 0;
  let sim: Sim | undefined;
  const createArgs: unknown[][] = [];
  const posted: FromWorker[] = [];
  const wrap = (s: Sim): SimLike => {
    const like = s as unknown as SimLike;
    if (!opts.tickCostMs) return like;
    // every tick costs `tickCostMs` of fake wall time
    return new Proxy(like, {
      get(target, key) {
        if (key === 'step')
          return (n: number) => {
            t += n * opts.tickCostMs!;
            s.step(n);
          };
        const v = Reflect.get(target, key) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  };
  const h = createSimHost({
    createSim: (...args: unknown[]) => {
      createArgs.push(args);
      const [d, b, city] = args as [number, number, string];
      sim = city === 'three_bridges' ? Sim.three_bridges(d, b) : Sim.river_city(d, b);
      return wrap(sim);
    },
    memory: () => memory,
    post: (msg) => posted.push(msg),
    now: () => t,
    ...(opts.perfNow ? { perfNow: opts.perfNow } : {}),
  });
  const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
  const ready = () => posted.find((m): m is ReadyMessage => m.type === 'ready');
  /** One handle/iterate call; returns the fake wall time it took. */
  const timed = (f: () => void) => {
    const t0 = t;
    f();
    return t - t0;
  };
  return {
    send: (m: ToWorker) => timed(() => h.handle(m)),
    iterate: () => timed(() => h.iterate()),
    tick: (ms: number) => {
      t += ms;
    },
    posted,
    frames,
    ready,
    sim: () => sim!,
    createArgs,
    now: () => t,
  };
}

describe('test 4: perf_never_changes_the_sim', () => {
  test('a host with jittery measurement and one with measurement stubbed out simulate identically', () => {
    // Given two hosts on the same city, seeds and wall clock; one measures with a wildly wrong clock
    // (a full second per reading: if it leaked into the SimClock, the schedule would collapse)
    let k = 0;
    const jitter = () => k++ * 1000;
    const a = host({ perfNow: jitter, city: 'three_bridges' });
    const b = host({ perfNow: () => 0, city: 'three_bridges' });
    for (const x of [a, b]) {
      x.send({ type: 'init', demandSeed: 17, behaviorSeed: 23, city: 'three_bridges' });
      x.send({ type: 'setSpeed', multiplier: 60 });
      x.send({ type: 'setRunning', running: true });
    }
    // When both run 700 loop iterations of 16 ms (≈ 1,340 ticks at 60×)
    for (let i = 0; i < 700; i++) {
      for (const x of [a, b]) {
        x.tick(16);
        x.iterate();
      }
    }
    // Then they are at the same tick with the same state, frame for frame
    expect(a.sim().tick()).toBeGreaterThan(1000);
    expect(a.sim().tick()).toBe(b.sim().tick());
    expect(a.sim().state_hash_hex()).toBe(b.sim().state_hash_hex());
    const fa = a.frames();
    const fb = b.frames();
    expect(fa.length).toBe(fb.length);
    fa.forEach((f, i) => {
      expect(f.tick).toBe(fb[i]!.tick);
      expect(f.clock).toEqual(fb[i]!.clock);
      expect(Array.from(f.metrics)).toEqual(Array.from(fb[i]!.metrics));
    });
    // and the measured times did differ (the jumping clock was really used for perf)
    expect(fa.some((f, i) => f.perf.frameTickMs !== fb[i]!.perf.frameTickMs)).toBe(true);
    // and the measurement really was active in one and not in the other
    const pa = fa.at(-1)!.perf;
    const pb = fb.at(-1)!.perf;
    expect(pa.ticksMeasured).toBe(1000);
    expect(pa.tickMsMax).toBeGreaterThan(0);
    expect(pb.tickMsMedian).toBe(0);
    expect(pb.tickMsMax).toBe(0);
    for (const p of [pa, pb]) for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('test 5: warmup_before_ready', () => {
  test('ready arrives after the warm-up, which runs in bounded batches', () => {
    expect(WARMUP_SIM_S).toBe(900);
    // Given expensive ticks (2 ms each in fake wall time) and a warm-up of 900 s = 1,800 ticks
    const x = host({ tickCostMs: 2 });
    let longestSend = x.send({ type: 'init', demandSeed: 2026, behaviorSeed: 7, warmupS: WARMUP_SIM_S });
    // init itself does not simulate, and posts nothing yet
    expect(x.sim().tick()).toBe(0);
    expect(x.posted).toEqual([]);
    // a speed and a running state chosen during the warm-up are kept
    longestSend = Math.max(longestSend, x.send({ type: 'setSpeed', multiplier: 20 }));
    longestSend = Math.max(longestSend, x.send({ type: 'setRunning', running: true }));
    const bridge = JSON.parse(x.sim().landmarks_json()).central_bridge[0] as number;
    let longest = 0;
    let iterations = 0;
    let sentClose = false;
    while (!x.ready() && iterations < 10_000) {
      x.tick(4);
      longest = Math.max(longest, x.iterate());
      iterations++;
      // a close sent during the warm-up
      if (iterations === 5) {
        longestSend = Math.max(longestSend, x.send({ type: 'command', kind: 'close', link: bridge }));
        sentClose = true;
      }
    }
    expect(sentClose).toBe(true);
    // Then the warm-up never blocked message handling for more than 100 ms at a time
    expect(x.ready()).toBeDefined();
    expect(longest).toBeLessThanOrEqual(100);
    expect(longestSend).toBeLessThanOrEqual(100);
    expect(iterations).toBeGreaterThanOrEqual(Math.ceil((1800 * 2) / 100));
    // and ready is the first message, at tick 1,800
    expect(x.posted[0]!.type).toBe('ready');
    expect(x.ready()!.tick).toBe(WARMUP_SIM_S / DT);
    expect(x.sim().tick()).toBe(1800);
    // and the close was not applied during the warm-up
    expect(Array.from(x.sim().closed_links())).not.toContain(bridge);
    // When the app runs on
    const t1 = x.frames().length;
    const tReady = x.now();
    for (let i = 0; i < 200; i++) {
      x.tick(16);
      x.iterate();
    }
    const elapsedS = (x.now() - tReady) / 1000;
    const after = x.frames().slice(t1);
    expect(after.length).toBeGreaterThan(0);
    // Then frames continue from the warm-up, with sim time = executed ticks × DT
    for (const f of after) {
      expect(f.tick).toBeGreaterThanOrEqual(1800);
      expect(f.tick).toBe(f.clock.executedTicks);
      expect(f.simTimeS).toBe(f.tick * DT);
    }
    // and the close took effect after the warm-up
    const closedAt = after.find((f) => Array.from(f.closed).includes(bridge));
    expect(closedAt).toBeDefined();
    expect(closedAt!.tick).toBeGreaterThan(1800);
    // and the speed chosen during the warm-up is kept: 20× = 40 ticks per elapsed second, no catch-up
    const last = after.at(-1)!;
    const ran = last.tick - 1800;
    expect(ran).toBeLessThanOrEqual(Math.ceil(elapsedS * 40) + 2);
    expect(ran).toBeGreaterThanOrEqual(Math.floor(elapsedS * 40 * 0.8) - 2);
    // and the warm-up neither inflated the achieved rate nor left a backlog
    expect(after[0]!.clock.backlogTicks).toBeLessThanOrEqual(2);
    for (const f of after) expect(f.clock.achievedTicksPerS).toBeLessThanOrEqual(40 * 1.15);
    // and perf describes the running app only: warm-up batches are not measured
    expect(after[0]!.perf.ticksMeasured).toBeLessThanOrEqual(after[0]!.tick - 1800);
    const sumTicks = after.reduce((acc, f) => acc + f.perf.frameTicks, 0);
    expect(sumTicks).toBe(ran);
  });

  test('a new init during the warm-up restarts it', () => {
    const x = host({ tickCostMs: 1 });
    x.send({ type: 'init', demandSeed: 2026, behaviorSeed: 7, warmupS: WARMUP_SIM_S });
    for (let i = 0; i < 5; i++) {
      x.tick(4);
      x.iterate();
    }
    expect(x.ready()).toBeUndefined();
    x.send({ type: 'init', demandSeed: 2026, behaviorSeed: 7, warmupS: 60 });
    let n = 0;
    while (!x.ready() && n++ < 10_000) {
      x.tick(4);
      x.iterate();
    }
    // one ready, for the new world, after its own (shorter) warm-up
    expect(x.posted.filter((m) => m.type === 'ready')).toHaveLength(1);
    expect(x.ready()!.tick).toBe(120);
    expect(x.sim().tick()).toBe(120);
  });

  test('the demand scale reaches createSim (default 1)', () => {
    const x = host();
    x.send({ type: 'init', demandSeed: 2026, behaviorSeed: 7, demandScale: 2.5 });
    x.send({ type: 'init', demandSeed: 2026, behaviorSeed: 7 });
    expect(x.createArgs[0]![3]).toBe(2.5);
    expect(x.createArgs[1]![3]).toBe(1);
  });

  test('without warmupS, ready is posted at once at tick 0 (unchanged behaviour)', () => {
    const x = host();
    x.send({ type: 'init', demandSeed: 2026, behaviorSeed: 7 });
    expect(x.ready()).toBeDefined();
    expect(x.ready()!.tick).toBe(0);
  });
});

describe('parseDemandScale (URL ?demand=)', () => {
  test('valid, missing and invalid values', () => {
    expect(parseDemandScale(null)).toEqual({ scale: 1, invalid: false });
    expect(parseDemandScale('')).toEqual({ scale: 1, invalid: false });
    expect(parseDemandScale('3')).toEqual({ scale: 3, invalid: false });
    expect(parseDemandScale('0.25')).toEqual({ scale: 0.25, invalid: false });
    expect(parseDemandScale('6')).toEqual({ scale: 6, invalid: false });
    for (const bad of ['abc', '0', '0.2', '6.5', '-2', 'NaN', 'Infinity', '3x']) {
      expect(parseDemandScale(bad)).toEqual({ scale: 1, invalid: true });
    }
  });
});
