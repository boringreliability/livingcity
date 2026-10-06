// Ward core-004, tests 12–20: proposed and verified against an independent
// reference by the Red reviewer, round 1 (behind honesty, pause, frame rate,
// transfer, pooling, frame consistency, reopen, ready values, error handling).
import { describe, expect, test } from 'vitest';

import { ITERATION_BUDGET_MS, MAX_BACKLOG_S, SimClock } from '../src/sim/clock';
import { decodeVehicles } from '../src/sim/frame';
import { createSimHost, FRAME_INTERVAL_MS, type SimLike } from '../src/sim/host';
import {
  DT,
  FLAG_QUEUED,
  VEHICLE_RECORD_BYTES,
  type FrameMessage,
  type FromWorker,
  type ReadyMessage,
  type ToWorker,
} from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

/** Host on real wasm with fake time; records posts and their transfer lists. */
function host(opts: { stepMs?: number; createSim?: (d: number, b: number) => SimLike } = {}) {
  const memory = loadWasm();
  let t = 0;
  const posted: { msg: FromWorker; transfer: Transferable[] }[] = [];
  const h = createSimHost({
    createSim: opts.createSim ?? ((d, b) => Sim.three_bridges(d, b) as unknown as SimLike),
    memory: () => memory,
    post: (msg, transfer) => posted.push({ msg, transfer }),
    now: () => t,
  });
  const send = (m: ToWorker) => h.handle(m);
  const frames = () => posted.map((p) => p.msg).filter((m): m is FrameMessage => m.type === 'frame');
  const advance = (iterations: number, stepMs = opts.stepMs ?? 16) => {
    for (let k = 0; k < iterations; k++) {
      t += stepMs;
      h.iterate();
    }
  };
  const start = (speed = 60) => {
    send({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
    send({ type: 'setSpeed', multiplier: speed });
    send({ type: 'setRunning', running: true });
    return posted.find((p) => p.msg.type === 'ready')!.msg as ReadyMessage;
  };
  return { h, send, posted, frames, advance, start, now: () => t };
}

describe('core-004 review fixes: clock', () => {
  test('F2 hitting the backlog cap reports behind even when achieved >= 90 % of target', () => {
    // Given 60x and 7.8 ms ticks with a 1 ms loop gap: achieved ~ 1000/8.8 = 113.6 ticks/s (94.7 % of 120)
    let t = 0;
    const clock = new SimClock(() => t);
    clock.setSpeed(60);
    clock.setRunning(true);
    const cap = MAX_BACKLOG_S * (60 / DT);
    let sawCap = false;
    while (t < 40_000) {
      t += 1;
      const n = clock.plan();
      expect(n * 7.8).toBeLessThanOrEqual(Math.max(7.8, ITERATION_BUDGET_MS));
      t += 7.8 * n;
      clock.report(n, 7.8 * n);
      const s = clock.status();
      if (s.backlogTicks >= cap - n - 1e-9) sawCap = true; // read after report(): the cap minus this batch
    }
    const s = clock.status();
    expect(sawCap).toBe(true);
    expect(s.achievedTicksPerS).toBeGreaterThanOrEqual(0.9 * s.targetTicksPerS);
    // Then wall time is being dropped at the cap, so the clock must say so
    expect(s.behind).toBe(true);
  });
});

test('F2b a sustained shortfall is reported (behind, honest achieved) before the backlog reaches the cap', () => {
  // Given 60x and 10 ms ticks with a 0.4 ms loop gap: ~96 ticks/s = 80 % of 120
  let t = 0;
  const clock = new SimClock(() => t);
  clock.setSpeed(60);
  clock.setRunning(true);
  const cap = MAX_BACKLOG_S * (60 / DT);
  while (t < 2500) {
    t += 0.4;
    const n = clock.plan();
    t += 10 * n;
    clock.report(n, 10 * n);
  }
  const s = clock.status();
  // the backlog (~0.2 x 120 x 2.5 s = 60 ticks) is still well below the cap
  expect(s.backlogTicks).toBeLessThan(0.75 * cap);
  expect(s.achievedTicksPerS).toBeLessThan(0.9 * s.targetTicksPerS);
  expect(s.achievedTicksPerS).toBeGreaterThan(0.7 * s.targetTicksPerS);
  expect(s.behind).toBe(true);
});

describe('core-004 review fixes: host', () => {
  test('F3 setRunning(false) stops the sim in the host; resuming does not catch up', () => {
    const w = host();
    w.start();
    w.advance(100);
    w.send({ type: 'setRunning', running: false });
    const pausedAt = w.frames().at(-1)!.tick;
    w.advance(200);
    for (const f of w.frames()) if (f.clock.running === false) expect(f.tick).toBe(pausedAt);
    expect(Math.max(...w.frames().map((f) => f.tick))).toBe(pausedAt);
    w.send({ type: 'setRunning', running: true });
    w.advance(1);
    // 16 ms at 60x is 1.92 ticks: no catch-up of the 3.2 s pause
    expect(w.frames().at(-1)!.tick - pausedAt).toBeLessThanOrEqual(2);
  });

  test('F4 at most one frame per 16 ms even when the loop iterates faster', () => {
    const w = host({ stepMs: 2 });
    w.start();
    w.advance(1000); // 2 s of wall time in 2 ms iterations
    const fs = w.frames();
    expect(fs.length).toBeGreaterThan(2000 / FRAME_INTERVAL_MS - 5);
    expect(fs.length).toBeLessThanOrEqual(Math.floor(2000 / FRAME_INTERVAL_MS) + 1);
  });

  test('F5 frame buffers are transferred, not cloned', () => {
    const w = host();
    w.start();
    w.advance(50);
    const posts = w.posted.filter((p) => p.msg.type === 'frame');
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      const f = p.msg as FrameMessage;
      expect(p.transfer).toContain(f.vehicles);
    }
  });

  test('F6 pooled buffers never change frame size or content', () => {
    // Given two hosts with the same seeds and time; B gets buffers of mixed sizes back
    const a = host();
    const b = host();
    a.start();
    b.start();
    let compared = 0;
    for (let k = 0; k < 400; k++) {
      const [na, nb] = [a.frames().length, b.frames().length];
      a.advance(1);
      b.advance(1);
      expect(b.frames().length - nb).toBe(a.frames().length - na);
      if (b.frames().length === nb) continue;
      const fa = a.frames().at(-1)!;
      const fb = b.frames().at(-1)!;
      // Then every pooled frame is exactly count x 16 bytes and equals the unpooled frame (checked on receipt)
      expect(fb.vehicles.byteLength).toBe(fb.count * VEHICLE_RECORD_BYTES);
      expect(fb.count).toBe(fa.count);
      expect(new Uint32Array(fb.vehicles)).toEqual(new Uint32Array(fa.vehicles));
      compared++;
      if (k % 3 === 0) {
        // the UI is done with this frame: give it back, plus foreign sizes
        b.send({ type: 'returnBuffer', buffer: fb.vehicles }); // exact size (reused only if count is unchanged)
        b.send({ type: 'returnBuffer', buffer: new ArrayBuffer(fb.vehicles.byteLength + 64) }); // larger
        b.send({ type: 'returnBuffer', buffer: new ArrayBuffer(16) }); // smaller
      }
    }
    expect(compared).toBeGreaterThan(300);
  });

  test('F7 every frame is internally consistent (records, link stats, metrics, clock)', () => {
    const w = host();
    const ready = w.start();
    const idx = (n: string) => ready.metricNames.indexOf(n);
    w.advance(400);
    w.send({ type: 'command', kind: 'close', link: ready.landmarks.central_bridge[0] });
    w.advance(200);
    let sawWaiting = false;
    for (const f of w.frames()) {
      const words = new Uint32Array(f.vehicles.slice(0));
      const perLink = new Uint32Array(f.linkCounts.length);
      const perLinkQ = new Uint32Array(f.linkCounts.length);
      for (let i = 0; i < f.count; i++) {
        perLink[words[4 * i]!]!++;
        if (words[4 * i + 3]! & FLAG_QUEUED) perLinkQ[words[4 * i]!]!++;
      }
      expect(Array.from(f.linkCounts)).toEqual(Array.from(perLink));
      expect(Array.from(f.linkQueued)).toEqual(Array.from(perLinkQ));
      expect(f.metrics[idx('on_network')]).toBe(f.count);
      expect(f.metrics[idx('tick')]).toBe(f.tick);
      expect(f.metrics[idx('active')]).toBe(f.metrics[idx('on_network')]! + f.metrics[idx('waiting_at_origin')]! + f.metrics[idx('no_route')]!);
      if (f.metrics[idx('waiting_at_origin')]! > 0) sawWaiting = true;
      expect(f.tick).toBe(f.clock.executedTicks);
      expect(f.simTimeS).toBe(f.tick * DT);
    }
    expect(sawWaiting).toBe(true);
  });

  test('F8 reopen restores the bridge', () => {
    const w = host();
    const ready = w.start();
    const [we, ew] = ready.landmarks.central_bridge;
    w.advance(300);
    w.send({ type: 'command', kind: 'close', link: we });
    w.send({ type: 'command', kind: 'close', link: ew });
    w.advance(300);
    w.send({ type: 'command', kind: 'open', link: we });
    w.send({ type: 'command', kind: 'open', link: ew });
    w.advance(300);
    const last = w.frames().at(-1)!;
    expect(Array.from(last.closed)).not.toContain(we);
    expect(Array.from(last.closed)).not.toContain(ew);
    expect(last.linkCounts[we]! + last.linkCounts[ew]!).toBeGreaterThan(0);
  });

  test('F9 the ready message describes three_bridges correctly', () => {
    const w = host();
    const r = w.start();
    const n = r.network;
    const xy = (node: number) => [n.nodeXy[2 * node]!, n.nodeXy[2 * node + 1]!] as const;
    // node 0 = W(0,0) at (-1000, -700); zones are nodes 18..23
    expect(xy(0)).toEqual([-1000, -700]);
    expect(Array.from(n.nodeIsZone).flatMap((z, i) => (z ? [i] : []))).toEqual([18, 19, 20, 21, 22, 23]);
    for (let l = 0; l < n.linkFrom.length; l++) {
      const [x0, y0] = xy(n.linkFrom[l]!);
      const [x1, y1] = xy(n.linkTo[l]!);
      expect(n.linkLength[l]).toBeCloseTo(Math.hypot(x1 - x0, y1 - y0), 2);
      expect([Math.fround(11.1), Math.fround(13.9)]).toContain(n.linkSpeed[l]);
    }
    // central bridge: west bank x = -100 -> east bank x = 100 at y = 0, two lanes, arterial speed
    const [we, ew] = r.landmarks.central_bridge;
    expect([xy(n.linkFrom[we]!), xy(n.linkTo[we]!)]).toEqual([[-100, 0], [100, 0]]);
    expect([xy(n.linkFrom[ew]!), xy(n.linkTo[ew]!)]).toEqual([[100, 0], [-100, 0]]);
    expect([n.linkLanes[we], n.linkLanes[ew]]).toEqual([2, 2]);
    expect(r.zones.map((z) => z.kind).sort()).toEqual(['hospital', 'residential', 'residential', 'residential', 'workplace', 'workplace']);
    for (const z of r.zones) expect(n.nodeIsZone[z.node]).toBe(1);
  });

  test('F10 bad input never throws out of the host and is reported', () => {
    const w = host();
    w.start();
    expect(() => w.send({ type: 'command', kind: 'close', link: 99_999 })).not.toThrow();
    expect(() => w.advance(5)).not.toThrow();
    expect(w.posted.some((p) => p.msg.type === 'error')).toBe(true);
    const bad = host({
      createSim: () => {
        throw new Error('boom');
      },
    });
    expect(() => bad.send({ type: 'init', demandSeed: 1, behaviorSeed: 1 })).not.toThrow();
    const err = bad.posted.find((p) => p.msg.type === 'error')?.msg;
    expect(err && err.type === 'error' && err.message).toContain('boom');
  });
});
