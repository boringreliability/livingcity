// Ward motion-002, tests 1–6 and 8: trip ids in the frame, and the presentation model (interpolation
// by trip id at a presentation time that never runs ahead of the newest frame; stop lines; resets).
import { describe, expect, test } from 'vitest';

import { decodeVehicles } from '../src/sim/frame';
import { createSimHost, type SimLike } from '../src/sim/host';
import { DT, FLAG_LANE_SHIFT, type FrameMessage, type FromWorker, type ReadyMessage, type ToWorker } from '../src/sim/protocol';
import { buildRoadGeometry, vehiclePosition, type LinkGeom } from '../src/render/geometry';
import { NO_NEXT } from '../src/render/motion';
import { Presenter, stopLine, STOP_M, type PresentClockInput, type PresentFrame } from '../src/render/presentation';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

type Framed = FrameMessage & { tripIds?: Uint32Array; world?: number };

/** A host on real wasm (three_bridges 17/23) with a fake clock. */
function host() {
  const memory = loadWasm();
  let t = 0;
  const posted: FromWorker[] = [];
  const h = createSimHost({
    createSim: (d, b) => Sim.three_bridges(d, b) as unknown as SimLike,
    memory: () => memory,
    post: (m) => posted.push(m),
    now: () => t,
  });
  const send = (m: ToWorker) => h.handle(m);
  const frames = () => posted.filter((m): m is Framed => m.type === 'frame');
  const iterate = (n: number, ms = 4) => {
    for (let i = 0; i < n; i++) {
      t += ms;
      h.iterate();
    }
  };
  const ready = () => posted.find((m): m is ReadyMessage => m.type === 'ready')!;
  return { h, send, frames, iterate, ready, now: () => t };
}

/** The network of three_bridges: geometry plus topology. */
function network() {
  const w = host();
  w.send({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
  const r = w.ready();
  const g = buildRoadGeometry(r.network);
  return { links: g.links, from: r.network.linkFrom, to: r.network.linkTo };
}

/** Links a → b with b leaving a's end node (not a's reverse), both long; and the sharpest such turn. */
function pairs(net: ReturnType<typeof network>) {
  const { links, from, to } = net;
  const dir = (l: LinkGeom) => {
    const d = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
    return [(l.x1 - l.x0) / d, (l.y1 - l.y0) / d] as const;
  };
  let straight: [number, number] | null = null;
  let turn: [number, number, number] | null = null;
  let unrelated: number | null = null;
  for (let a = 0; a < links.length; a++) {
    if (links[a]!.length < 40) continue;
    for (let b = 0; b < links.length; b++) {
      if (b === a || from[b] !== to[a] || to[b] === from[a] || links[b]!.length < 40) continue;
      const [ax, ay] = dir(links[a]!);
      const [bx, by] = dir(links[b]!);
      const ang = (Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by))) * 180) / Math.PI;
      if (ang < 10 && !straight) straight = [a, b];
      if (!turn || ang > turn[2]) turn = [a, b, ang];
    }
  }
  const [a] = straight ?? [turn![0]];
  for (let c = 0; c < links.length && unrelated === null; c++) if (from[c] !== to[a!] && c !== a && links[c]!.length >= 40) unrelated = c;
  return { straight: straight ?? [turn![0], turn![1]], turn: turn!, unrelated: unrelated! };
}

type Car = { trip: number; link: number; s: number; v?: number; lane?: number; queued?: boolean };
function frame(tick: number, cars: Car[], opts: Partial<Pick<PresentFrame, 'scenario' | 'world' | 'compare'>> = {}): PresentFrame {
  const words = new Uint32Array(cars.length * 4);
  const f32 = new Float32Array(words.buffer);
  cars.forEach((c, i) => {
    words[i * 4] = c.link;
    f32[i * 4 + 1] = c.s;
    f32[i * 4 + 2] = c.v ?? 0;
    words[i * 4 + 3] = ((c.lane ?? 0) << FLAG_LANE_SHIFT) | (c.queued ? 1 : 0);
  });
  return {
    tick,
    scenario: opts.scenario ?? 0,
    world: opts.world ?? 1,
    compare: opts.compare ?? false,
    vehicles: decodeVehicles(words.buffer, cars.length),
    tripIds: Uint32Array.from(cars.map((c) => c.trip)),
  };
}
const RUN1: PresentClockInput = { running: true, multiplier: 1, achievedTicksPerS: 2, behind: false };
const PAUSED: PresentClockInput = { running: false, multiplier: 1, achievedTicksPerS: 0, behind: false };

/** Along-link coordinate (m) of world point (x, y) on `l` (its drawn line scaled to the sim length). */
function along(l: LinkGeom, x: number, y: number): number {
  const dx = l.x1 - l.x0;
  const dy = l.y1 - l.y0;
  const d2 = dx * dx + dy * dy;
  return (((x - l.x0) * dx + (y - l.y0) * dy) / d2) * l.length;
}
const dist = (a: { x: number; y: number }, b: [number, number]) => Math.hypot(a.x - b[0], a.y - b[1]);

describe('motion-002', () => {
  test('1 frame_carries_trip_ids', () => {
    const w = host();
    w.send({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
    w.send({ type: 'setSpeed', multiplier: 60 });
    w.send({ type: 'setRunning', running: true });
    w.iterate(400);
    const fs = w.frames().slice(-20);
    for (const f of fs) {
      expect(f.tripIds, 'a tripIds array').toBeInstanceOf(Uint32Array);
      expect(f.tripIds!.length).toBe(f.count);
      expect(new Set(f.tripIds).size, 'unique within a frame').toBe(f.count);
      expect(f.vehicles.byteLength, 'the 16 B record is unchanged').toBe(f.count * 16);
    }
    // the ids are the trips the worker resolves picks to: inspecting record i tracks trip tripIds[i]
    const last = fs.at(-1)!;
    const i = Math.floor(last.count / 2);
    w.send({ type: 'setRunning', running: false });
    w.iterate(2);
    const paused = w.frames().at(-1)!;
    w.send({ type: 'inspectVehicle', frameTick: paused.tick, record: i, seq: 9 });
    w.iterate(2);
    const tracked = w.frames().at(-1)!.tracked as { tripId: number } | null;
    expect(tracked && tracked.tripId, 'record i resolves to tripIds[i]').toBe(paused.tripIds![i]);
    // a vehicle keeps its id while its record index changes
    w.send({ type: 'setRunning', running: true });
    w.iterate(100);
    const later = w.frames().at(-1)!;
    const id = paused.tripIds![i]!;
    const j = Array.from(later.tripIds!).indexOf(id);
    if (j >= 0) {
      const dv = decodeVehicles(later.vehicles, later.count);
      expect(dv.link(j), 'found again by id: the tracked vehicle').toBe((w.frames().at(-1)!.tracked as { link: number }).link);
    }
    // after a seek, and in B
    w.send({ type: 'setRunning', running: false });
    w.iterate(2);
    const at = w.frames().at(-1)!.tick - 60;
    w.send({ type: 'seek', tick: at });
    w.iterate(2);
    const s = w.frames().at(-1)!;
    expect(s.tripIds!.length).toBe(s.count);
    w.send({ type: 'branch', fromTick: at - 20, then: [] });
    w.iterate(2);
    const b = w.frames().at(-1)!;
    expect(b.scenario).toBe(1);
    expect(b.tripIds!.length).toBe(b.count);
    expect(new Set(b.tripIds).size).toBe(b.count);
  });

  test('2 held_car_stays_behind_its_stop_line', () => {
    const net = network();
    const [a, b] = pairs(net).straight;
    const A = net.links[a]!;
    const B = net.links[b]!;
    const p = new Presenter(net.links, net.from, net.to);
    for (let k = 0; k < 6; k++) {
      p.push(
        frame(100 + k, [
          { trip: 1, link: a, s: A.length, v: 0, queued: true },
          { trip: 2, link: a, s: A.length - 20, v: 0, queued: true },
        ]),
        k * 500,
        RUN1,
      );
      for (let n = k * 500; n < (k + 1) * 500; n += 16) {
        p.advance(n);
        const held = p.vehicle(1)!;
        expect(held, 'the held car is drawn').not.toBeNull();
        expect(along(A, held.pose.x, held.pose.y), 'held: at or behind the stop line').toBeLessThanOrEqual(stopLine(A) + 1e-6);
        expect(held.next, 'not moving on').toBe(NO_NEXT);
        expect(dist(held.pose, vehiclePosition(B, 0, 0)), 'never at the next link’s start').toBeGreaterThan(2);
        const q = p.vehicle(2)!;
        const [x, y] = vehiclePosition(A, A.length - 20, 0);
        expect(Math.hypot(q.pose.x - x, q.pose.y - y), 'a queued car before the stop line: exactly its own s').toBeLessThan(1e-6);
      }
    }
    expect(STOP_M).toBe(6);
  });

  test('3 junction_transition_is_continuous', () => {
    const net = network();
    const pr = pairs(net);
    for (const [a, b] of [pr.straight, [pr.turn[0], pr.turn[1]] as [number, number]]) {
      const A = net.links[a]!;
      const B = net.links[b]!;
      const p = new Presenter(net.links, net.from, net.to);
      p.push(frame(200, [{ trip: 5, link: a, s: A.length - 12, v: 8 }]), 0, RUN1);
      p.push(frame(201, [{ trip: 5, link: b, s: 3, v: 8 }]), 500, RUN1);
      p.push(frame(202, [{ trip: 5, link: b, s: 7, v: 8 }]), 1000, RUN1);
      const poses: { x: number; y: number; hx: number; hy: number }[] = [];
      for (let n = 0; n <= 1600; n += 2) {
        const P = p.advance(n);
        if (P >= 200 * DT - 1e-9 && P <= 201 * DT + 1e-9) poses.push(p.vehicle(5)!.pose);
      }
      expect(poses.length).toBeGreaterThan(20);
      const [sx, sy] = vehiclePosition(A, A.length - 12, 0);
      const [ex, ey] = vehiclePosition(B, 3, 0);
      expect(Math.hypot(poses[0]!.x - sx, poses[0]!.y - sy), 'starts at A at its s').toBeLessThan(0.05);
      expect(Math.hypot(poses.at(-1)!.x - ex, poses.at(-1)!.y - ey), 'ends at B at its s').toBeLessThan(0.05);
      let len = 0;
      for (let i = 1; i < poses.length; i++) len += Math.hypot(poses[i]!.x - poses[i - 1]!.x, poses[i]!.y - poses[i - 1]!.y);
      for (let i = 1; i < poses.length; i++) {
        const step = Math.hypot(poses[i]!.x - poses[i - 1]!.x, poses[i]!.y - poses[i - 1]!.y);
        expect(step, 'no jump').toBeLessThanOrEqual((1.5 * len) / (poses.length - 1) + 1e-3);
        const cos = poses[i]!.hx * poses[i - 1]!.hx + poses[i]!.hy * poses[i - 1]!.hy;
        expect(cos, 'heading turns gradually (≤ 30° per step)').toBeGreaterThanOrEqual(Math.cos(Math.PI / 6) - 1e-9);
      }
    }
    expect(pr.turn[2], 'a real turn was tested').toBeGreaterThanOrEqual(85);
    // a link that does not leave A's end node: placed directly, no fabricated path
    const [a] = pr.straight;
    const A = net.links[a]!;
    const C = net.links[pr.unrelated]!;
    const p = new Presenter(net.links, net.from, net.to);
    p.push(frame(300, [{ trip: 7, link: a, s: A.length - 12, v: 8 }]), 0, RUN1);
    p.push(frame(301, [{ trip: 7, link: pr.unrelated, s: 3, v: 8 }]), 500, RUN1);
    p.push(frame(302, [{ trip: 7, link: pr.unrelated, s: 7, v: 8 }]), 1000, RUN1);
    const onSeg = (l: LinkGeom, x: number, y: number) => {
      const t = along(l, x, y);
      if (t < -0.5 || t > l.length + 0.5) return false;
      const [px, py] = vehiclePosition(l, Math.max(0, Math.min(l.length, t)), 0);
      return Math.hypot(px - x, py - y) < 1;
    };
    for (let n = 0; n <= 1600; n += 8) {
      p.advance(n);
      const v = p.vehicle(7);
      if (v) expect(onSeg(A, v.pose.x, v.pose.y) || onSeg(C, v.pose.x, v.pose.y), 'only on A or on the new link').toBe(true);
    }
  });

  test('4 forward_playback_never_steps_back', () => {
    // record a real run: speed changes 20× → 5× → 60× → 1×
    const w = host();
    w.send({ type: 'init', demandSeed: 17, behaviorSeed: 23, warmupS: 600 });
    for (let i = 0; i < 4000 && w.frames().length === 0; i++) w.iterate(1);
    w.send({ type: 'setRunning', running: true });
    const plan: [number, number][] = [
      [20, 120],
      [5, 120],
      [60, 120],
      [1, 300],
    ];
    for (const [m, iters] of plan) {
      w.send({ type: 'setSpeed', multiplier: m });
      w.iterate(iters, 16);
    }
    const fs = w.frames().filter((f) => f.clock.running);
    expect(fs.length).toBeGreaterThanOrEqual(200);
    const geo = network();
    const p = new Presenter(geo.links, geo.from, geo.to);
    // arrivals with jitter (8–40 ms, deterministic) and one 300 ms delayed frame
    let now = 0;
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let lastP = -Infinity;
    const lastPos = new Map<number, { link: number; s: number }>();
    let newest: Framed | null = null;
    for (let k = 0; k < fs.length; k++) {
      const f = fs[k]!;
      const gap = k === Math.floor(fs.length / 2) ? 300 : 8 + 32 * rnd();
      for (let n = now; n < now + gap; n += 4) {
        if (!newest) continue;
        const P = p.advance(n);
        expect(P, 'P non-decreasing').toBeGreaterThanOrEqual(lastP - 1e-9);
        expect(P, 'P never ahead of the newest frame').toBeLessThanOrEqual(newest.tick * DT + 1e-9);
        lastP = P;
        const dv = decodeVehicles(newest.vehicles, newest.count);
        const newestById = new Map<number, number>();
        newest.tripIds!.forEach((id, i) => newestById.set(id, i));
        for (const v of p.vehicles()) {
          const prev = lastPos.get(v.tripId);
          if (prev && prev.link === v.link) expect(v.s, `trip ${v.tripId} steps back`).toBeGreaterThanOrEqual(prev.s - 1e-6);
          lastPos.set(v.tripId, { link: v.link, s: v.s });
          const i = newestById.get(v.tripId);
          if (i !== undefined && dv.link(i) === v.link) expect(v.s, `trip ${v.tripId} drawn beyond its newest position`).toBeLessThanOrEqual(dv.s(i) + 1e-6);
        }
      }
      now += gap;
      p.push({ tick: f.tick, scenario: f.scenario, world: f.world ?? 1, compare: f.timeline.compare === 1, vehicles: decodeVehicles(f.vehicles, f.count), tripIds: f.tripIds! }, now, f.clock);
      newest = f;
    }
  });

  test('5 identity_not_record_index', () => {
    const net = network();
    const [a] = pairs(net).straight;
    const a2 = pairs(net).unrelated;
    const p = new Presenter(net.links, net.from, net.to);
    p.push(frame(400, [{ trip: 10, link: a, s: 10, v: 8 }, { trip: 11, link: a, s: 25, v: 8 }]), 0, RUN1);
    // reordered, and record 0 now holds a new trip somewhere else
    p.push(frame(401, [{ trip: 12, link: a2, s: 5, v: 8 }, { trip: 11, link: a, s: 29, v: 8 }, { trip: 10, link: a, s: 14, v: 8 }]), 500, RUN1);
    // trip 11 completes
    p.push(frame(402, [{ trip: 12, link: a2, s: 9, v: 8 }, { trip: 10, link: a, s: 18, v: 8 }]), 1000, RUN1);
    const A = net.links[a]!;
    const A2 = net.links[a2]!;
    let sawMid = false;
    for (let n = 0; n <= 1600; n += 4) {
      const P = p.advance(n);
      const t10 = p.vehicle(10);
      const t12 = p.vehicle(12);
      if (P > 400 * DT && P < 401 * DT) {
        sawMid = true;
        expect(t10!.link).toBe(a);
        expect(t10!.s).toBeGreaterThanOrEqual(10 - 1e-6);
        expect(t10!.s).toBeLessThanOrEqual(14 + 1e-6);
        const t11 = p.vehicle(11)!;
        expect(t11.s).toBeGreaterThanOrEqual(25 - 1e-6);
        expect(t11.s).toBeLessThanOrEqual(29 + 1e-6);
        // the new trip is drawn where it is (not slid from record 0's old car)
        if (t12) {
          const [x, y] = vehiclePosition(A2, 5, 0);
          expect(Math.hypot(t12.pose.x - x, t12.pose.y - y), 'a new trip appears at its own position').toBeLessThan(1e-6);
        }
      }
      if (P > 401 * DT + 1e-9) {
        expect(p.vehicle(11), 'a completed trip is not drawn').toBeNull();
        expect(t12!.link).toBe(a2);
        expect(along(A2, t12!.pose.x, t12!.pose.y)).toBeGreaterThanOrEqual(5 - 1e-6);
      }
    }
    expect(sawMid).toBe(true);
    void A;
  });

  test('6 history_resets_on_seek_scenario_and_world', () => {
    const net = network();
    const [a] = pairs(net).straight;
    const A = net.links[a]!;
    const base = (tick: number, s: number, opts = {}) => frame(tick, [{ trip: 20, link: a, s, v: 8 }], opts);
    const cases: [string, ReturnType<typeof frame>][] = [
      ['seek back', base(50, 3)],
      ['seek forward (jump)', base(140, 3)],
      ['scenario', base(102, 3, { scenario: 1 })],
      ['world', base(102, 3, { world: 2 })],
      ['compare', base(102, 3, { compare: true })],
    ];
    for (const [name, f] of cases) {
      const p = new Presenter(net.links, net.from, net.to);
      p.push(base(100, 30), 0, RUN1);
      p.push(base(101, 34), 500, RUN1);
      p.advance(700);
      p.push(f, 900, RUN1);
      const P = p.advance(901);
      expect(P, `${name}: P restarts at the new frame`).toBeCloseTo(f.tick * DT, 9);
      const v = p.vehicle(20)!;
      const [x, y] = vehiclePosition(A, 3, 0);
      expect(Math.hypot(v.pose.x - x, v.pose.y - y), `${name}: no interpolation from the old frames`).toBeLessThan(1e-6);
    }
  });

  test('8 presentation_latency_is_bounded', () => {
    const net = network();
    const [a] = pairs(net).straight;
    for (const [mult, msPerTick] of [
      [1, 500],
      [20, 25],
    ] as const) {
      const p = new Presenter(net.links, net.from, net.to);
      const clock: PresentClockInput = { running: true, multiplier: mult, achievedTicksPerS: 2 * mult, behind: false };
      const lags: number[] = [];
      for (let now = 0; now < 6000; now += 16) {
        const tick = 1000 + Math.floor(now / msPerTick);
        p.push(frame(tick, [{ trip: 30, link: a, s: (tick % 50) + 1, v: 2 }]), now, clock);
        for (let n = now; n < now + 16; n += 4) {
          p.advance(n);
          if (now > 2000) lags.push(p.lagS());
        }
      }
      const max = Math.max(...lags);
      const bound = mult === 1 ? 0.55 : 4 * DT;
      expect(max, `${mult}×: lag ≤ ${bound} sim s`).toBeLessThanOrEqual(bound + 1e-9);
      expect(Math.min(...lags), `${mult}×: never ahead`).toBeGreaterThanOrEqual(-1e-9);
    }
    void PAUSED;
  });
});
