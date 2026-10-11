// Ward motion-001, tests 1–7: a paused host is quiet (frames only when something changed, one
// settling frame), the clock window is bounded, and frame buffers are reused in a bounded, safe way.
import { describe, expect, test } from 'vitest';

import { SimClock } from '../src/sim/clock';
import { createSimClient } from '../src/sim/client';
import { createSimHost, type SimLike } from '../src/sim/host';
import type { FrameMessage, FromWorker, ReadyMessage, ToWorker } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

type Framed = FrameMessage & { world?: number };

/** A host on real wasm (three_bridges 17/23), fake clock; counts `encode_frame` calls on every sim. */
function host() {
  const memory = loadWasm();
  let t = 0;
  let encodes = 0;
  const wrap = (s: Sim): SimLike =>
    new Proxy(s as unknown as SimLike, {
      get(target, key) {
        if (key === 'encode_frame')
          return () => {
            encodes++;
            return s.encode_frame();
          };
        if (key === 'branch') return (at: number) => wrap(s.branch(at));
        const v = Reflect.get(target, key) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  const posted: FromWorker[] = [];
  const h = createSimHost({
    createSim: (d, b) => wrap(Sim.three_bridges(d, b)),
    memory: () => memory,
    post: (m) => posted.push(m),
    now: () => t,
  });
  const send = (m: ToWorker) => h.handle(m);
  const frames = () => posted.filter((m): m is Framed => m.type === 'frame');
  const errors = () => posted.filter((m) => m.type === 'error');
  const comparisons = () => posted.filter((m) => (m as { type: string }).type === 'comparison');
  const iterate = (n: number, ms = 4) => {
    for (let i = 0; i < n; i++) {
      t += ms;
      h.iterate();
    }
  };
  const ready = () => posted.find((m): m is ReadyMessage => m.type === 'ready')!;
  return { h, send, posted, frames, errors, comparisons, iterate, ready, encodes: () => encodes, now: () => t };
}

/** Running at 60× for `ms`, then paused and settled (past the settling frame). */
function pausedHost(opts: { compare?: boolean } = {}) {
  const w = host();
  w.send({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
  w.send({ type: 'setSpeed', multiplier: 60 });
  w.send({ type: 'setRunning', running: true });
  w.iterate(500); // 2 s
  w.send({ type: 'setRunning', running: false });
  w.iterate(2);
  if (opts.compare) {
    const at = w.frames().at(-1)!.tick - 40;
    w.send({ type: 'branch', fromTick: at, then: [{ kind: 'close', link: w.ready().landmarks.central_bridge[0]! }] });
    w.send({ type: 'compare', on: true });
    w.iterate(2);
  }
  w.iterate(400); // 1.6 s: past the 1 s achieved window and the settling frame
  return w;
}

describe('motion-001', () => {
  test('1 paused_host_is_quiet', () => {
    for (const compare of [false, true]) {
      const w = pausedHost({ compare });
      const n = w.frames().length;
      const c = w.comparisons().length;
      const e = w.encodes();
      const tick = w.frames().at(-1)!.tick;
      w.iterate(300);
      expect(w.frames().length - n, `${compare ? 'comparing' : 'single'}: no frame while paused and clean`).toBe(0);
      expect(w.comparisons().length - c, 'no comparison message').toBe(0);
      expect(w.encodes() - e, 'no encode_frame while paused and clean').toBe(0);
      expect(w.frames().at(-1)!.tick).toBe(tick);
      expect(w.errors()).toEqual([]);
    }
  });

  test('2 every_handled_message_gets_a_frame_then_quiet', () => {
    const w = pausedHost();
    const last = () => w.frames().at(-1)!;
    const link = w.ready().landmarks.north_bridge[0]!;
    const msgs: ToWorker[] = [
      { type: 'command', kind: 'close', link },
      { type: 'command', kind: 'open', link },
      { type: 'setSpeed', multiplier: 20 },
      { type: 'inspectLink', link },
      { type: 'inspectVehicle', frameTick: last().tick, record: 0, seq: 1 },
      { type: 'setRunning', running: false },
      { type: 'viewScenario', scenario: 0 },
      { type: 'seek', tick: last().timeline.positionTick - 10 },
    ];
    for (const m of msgs) {
      w.send(m);
      const n = w.frames().length; // after any frame the handler posted itself
      w.iterate(1);
      expect(w.frames().length, `iterate posts a frame after ${m.type}`).toBeGreaterThan(n);
      const m2 = w.frames().length;
      w.iterate(100);
      expect(w.frames().length - m2, `quiet again after ${m.type}`).toBe(0);
    }
    // returnBuffer is not a change: no frame for it
    const n = w.frames().length;
    w.send({ type: 'returnBuffer', buffer: new ArrayBuffer(last().vehicles.byteLength), scenario: 0 });
    w.iterate(100);
    expect(w.frames().length - n, 'no frame for returnBuffer').toBe(0);
    // comparing: an ignored inspectVehicle still gets its pair, then quiet
    const c = pausedHost({ compare: true });
    const n2 = c.frames().length;
    c.send({ type: 'inspectVehicle', frameTick: c.frames().at(-1)!.tick, record: 0, seq: 2 });
    c.iterate(1);
    const pair = c.frames().slice(n2);
    expect(pair.map((f) => f.scenario).sort()).toEqual(expect.arrayContaining([0, 1]));
    const n3 = c.frames().length;
    c.iterate(100);
    expect(c.frames().length - n3).toBe(0);
    expect(w.errors()).toEqual([]);
    expect(c.errors()).toEqual([]);
  });

  test('3 pause_settles_achieved_speed_to_zero', () => {
    const w = host();
    w.send({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
    w.send({ type: 'setSpeed', multiplier: 60 });
    w.send({ type: 'setRunning', running: true });
    w.iterate(500);
    expect(w.frames().at(-1)!.clock.achievedTicksPerS).toBeGreaterThan(0);
    const n = w.frames().length;
    w.send({ type: 'setRunning', running: false });
    w.iterate(300); // 1.2 s
    const after = w.frames().slice(n);
    expect(after.length, 'a few frames between pause and settle').toBeLessThanOrEqual(3);
    const settled = after.at(-1)!;
    expect(settled.clock.running).toBe(false);
    expect(settled.clock.achievedTicksPerS, 'the shown speed settles to 0').toBe(0);
    const m = w.frames().length;
    w.iterate(500); // 2 s more
    expect(w.frames().length - m, 'then nothing').toBe(0);
  });

  test('4 closure_while_paused_applies_at_the_first_resumed_tick', () => {
    const w = pausedHost();
    const pausedTick = w.frames().at(-1)!.tick;
    const [we, ew] = w.ready().landmarks.central_bridge;
    const n = w.frames().length;
    w.send({ type: 'command', kind: 'close', link: we! });
    w.send({ type: 'command', kind: 'close', link: ew! });
    w.iterate(10);
    const paused = w.frames().slice(n);
    expect(paused.length, 'the commands are answered by a frame').toBeGreaterThan(0);
    for (const f of paused) {
      expect(f.tick).toBe(pausedTick);
      expect(Array.from(f.closed)).not.toContain(we);
      expect(Array.from(f.closed)).not.toContain(ew);
    }
    w.send({ type: 'setRunning', running: true });
    w.iterate(10);
    const f = w.frames().find((x) => x.tick > pausedTick)!;
    expect(f, 'frames flow again after resume').toBeDefined();
    expect(f.tick - pausedTick).toBeLessThanOrEqual(4);
    expect(Array.from(f.closed)).toEqual(expect.arrayContaining([we, ew]));
    expect(w.errors()).toEqual([]);
  });

  test('5 clock_window_is_bounded_without_status', () => {
    let t = 0;
    const clock = new SimClock(() => t);
    clock.setSpeed(20);
    for (let i = 0; i < 100_000; i++) {
      t += 4;
      clock.report(clock.plan(), 0);
    }
    const size = (clock as unknown as { windowSize(): number }).windowSize();
    expect(size, 'report window bounded without status()').toBeLessThanOrEqual(300);
    clock.setRunning(true);
    for (let i = 0; i < 500; i++) {
      t += 4;
      clock.report(clock.plan(), 0.01);
    }
    expect(Math.abs(clock.status().achievedTicksPerS - 40)).toBeLessThanOrEqual(2);
  });

  test('6 pool_is_bounded_lifo_and_safe', () => {
    const w = pausedHost();
    const size = w.frames().at(-1)!.vehicles.byteLength;
    expect(size).toBeGreaterThan(0);
    const world = w.frames().at(-1)!.world;
    const returned = Array.from({ length: 10 }, () => new ArrayBuffer(size));
    const zero = new ArrayBuffer(0);
    const wrong = new ArrayBuffer(size + 16);
    w.send({ type: 'returnBuffer', buffer: zero, scenario: 0 });
    w.send({ type: 'returnBuffer', buffer: wrong, scenario: 0 });
    for (const b of returned) w.send({ type: 'returnBuffer', buffer: b, scenario: 0, ...(world === undefined ? {} : { world }) } as ToWorker);
    const n = w.frames().length;
    for (let k = 0; k < 10; k++) {
      w.send({ type: 'setSpeed', multiplier: 20 });
      w.iterate(1);
    }
    const fs = w.frames().slice(n);
    expect(fs.length).toBeGreaterThanOrEqual(10);
    for (const f of fs) expect(f.vehicles.byteLength).toBe(f.count * 16);
    const used = fs.map((f) => f.vehicles).filter((b) => returned.includes(b));
    // the pool keeps the 4 most recent (oldest dropped first) and hands them out newest first
    expect(fs.slice(0, 4).map((f) => returned.indexOf(f.vehicles)), 'kept and reused newest first').toEqual([9, 8, 7, 6]);
    expect(fs.slice(4, 10).some((f) => returned.includes(f.vehicles)), 'nothing beyond the cap').toBe(false);
    expect(used.length, 'some reuse').toBeGreaterThan(0);
    expect(new Set(used).size, 'never the same buffer twice without a new return').toBe(used.length);
    expect(used.length, 'bounded: at most 4 kept').toBeLessThanOrEqual(4);
    expect(fs.some((f) => f.vehicles === zero || f.vehicles === wrong), 'no 0-length or wrong-size reuse').toBe(false);
    expect(w.errors()).toEqual([]);
  });

  test('7 returns_from_a_replaced_world_are_never_reused', () => {
    // host: B replaced, B discarded, and a re-init
    const w = pausedHost();
    const at = w.frames().at(-1)!.tick - 40;
    const then = [{ kind: 'close' as const, link: w.ready().landmarks.central_bridge[0]! }];
    w.send({ type: 'branch', fromTick: at, then });
    w.iterate(2);
    const b1 = w.frames().filter((f) => f.scenario === 1).at(-1)!;
    expect(typeof b1.world, 'frames carry a world generation').toBe('number');
    const staleB = Array.from({ length: 4 }, () => new ArrayBuffer(b1.vehicles.byteLength));
    w.send({ type: 'branch', fromTick: at, then }); // the same branch again: same state, same sizes, a new world
    for (const b of staleB) w.send({ type: 'returnBuffer', buffer: b, scenario: 1, world: b1.world } as ToWorker);
    let n = w.frames().length;
    for (let k = 0; k < 6; k++) {
      w.send({ type: 'setSpeed', multiplier: 20 });
      w.iterate(1);
    }
    let fs = w.frames().slice(n).filter((f) => f.scenario === 1);
    expect(fs.length).toBeGreaterThan(0);
    expect(fs[0]!.vehicles.byteLength, 'same size as the stale buffers').toBe(b1.vehicles.byteLength);
    expect(fs.every((f) => f.world !== b1.world), "the replaced B's frames have a new world").toBe(true);
    expect(fs.some((f) => staleB.includes(f.vehicles)), 'no reuse across the replace').toBe(false);
    // a buffer returned for the current world is reused
    const cur = new ArrayBuffer(fs.at(-1)!.vehicles.byteLength);
    w.send({ type: 'returnBuffer', buffer: cur, scenario: 1, world: fs.at(-1)!.world } as ToWorker);
    w.send({ type: 'setSpeed', multiplier: 20 });
    w.iterate(1);
    expect(w.frames().at(-1)!.vehicles, 'current-world reuse').toBe(cur);
    // discard: late B returns are dropped, also when the same branch is made again (same sizes)
    const b2 = w.frames().at(-1)!;
    w.send({ type: 'discardBranch' });
    const staleD = Array.from({ length: 4 }, () => new ArrayBuffer(b2.vehicles.byteLength));
    for (const b of staleD) w.send({ type: 'returnBuffer', buffer: b, scenario: 1, world: b2.world } as ToWorker);
    w.iterate(2);
    expect(w.frames().at(-1)!.scenario).toBe(0);
    w.send({ type: 'branch', fromTick: at, then });
    n = w.frames().length;
    for (let k = 0; k < 6; k++) {
      w.send({ type: 'setSpeed', multiplier: 20 });
      w.iterate(1);
    }
    const afterDiscard = w.frames().slice(n).filter((f) => f.scenario === 1);
    expect(afterDiscard.length).toBeGreaterThan(0);
    expect(afterDiscard.every((f) => f.world !== b2.world), 'a branch after a discard is a new world').toBe(true);
    expect(afterDiscard.some((f) => staleD.includes(f.vehicles)), 'no reuse across a discard').toBe(false);
    // re-init with the same seeds and a warm-up: the first frame has the size of the old one
    const reinit = () => {
      const k = w.frames().length;
      w.send({ type: 'init', demandSeed: 17, behaviorSeed: 23, warmupS: 600 });
      for (let i = 0; i < 4000 && w.frames().length === k; i++) w.iterate(1);
      return w.frames()[k]!;
    };
    const first = reinit();
    const staleA = new ArrayBuffer(first.vehicles.byteLength);
    const staleA2 = new ArrayBuffer(first.vehicles.byteLength);
    n = w.frames().length;
    const again = (() => {
      const k = w.frames().length;
      w.send({ type: 'init', demandSeed: 17, behaviorSeed: 23, warmupS: 600 });
      w.send({ type: 'returnBuffer', buffer: staleA, scenario: 0, world: first.world } as ToWorker); // late, old world
      w.send({ type: 'returnBuffer', buffer: staleA2, scenario: 1, world: first.world } as ToWorker); // late, old world, other side
      for (let i = 0; i < 4000 && w.frames().length === k; i++) w.iterate(1);
      return w.frames()[k]!;
    })();
    expect(again.vehicles.byteLength).toBe(staleA.byteLength);
    expect(again.world, 'init starts a new world').not.toBe(first.world);
    expect(again.vehicles === staleA, 'no reuse across a re-init').toBe(false);
    fs = w.frames().slice(n);
    expect(fs.some((f) => f.vehicles === staleA || f.vehicles === staleA2)).toBe(false);
    expect(w.errors()).toEqual([]);

    // client: returnBuffer sends back the world and side of the frame that delivered the buffer
    const sent: { msg: ToWorker; transfer: Transferable[] }[] = [];
    const fake = {
      onmessage: null as null | ((e: MessageEvent) => void),
      onerror: null as unknown,
      onmessageerror: null as unknown,
      postMessage: (msg: ToWorker, transfer: Transferable[] = []) => sent.push({ msg, transfer }),
      terminate: () => {},
    };
    const opts = { createWorker: () => fake } as unknown as Parameters<typeof createSimClient>[3];
    const client = createSimClient(17, 23, undefined, opts);
    const bufA = new ArrayBuffer(32);
    const bufB = new ArrayBuffer(32);
    const bufB2 = new ArrayBuffer(32);
    const deliver = (vehicles: ArrayBuffer, scenario: 0 | 1, world: number) =>
      fake.onmessage!({ data: { ...b1, vehicles, scenario, world } as unknown as FrameMessage } as MessageEvent);
    let got = 0;
    client.onFrame(() => got++);
    deliver(bufA, 0, 3);
    deliver(bufB, 1, 7);
    deliver(bufB2, 1, 8); // a newer B world arrives before bufB is returned
    expect(got).toBe(3);
    client.returnBuffer(bufB, 1);
    client.returnBuffer(bufA, 0);
    const rs = sent.map((s) => s.msg).filter((m) => m.type === 'returnBuffer') as (ToWorker & { buffer: ArrayBuffer; world?: number; scenario?: number })[];
    expect(rs.map((r) => [r.buffer === bufB ? 'B' : r.buffer === bufA ? 'A' : '?', r.scenario, r.world]), "each buffer goes back with its own frame's side and world").toEqual([
      ['B', 1, 7],
      ['A', 0, 3],
    ]);
  });
});
