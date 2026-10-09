// Ward polish-003, tests 2–6: next links in the frame; one placement rule through junctions;
// extrapolation onto the next link; the extrapolation clock (speed changes, stalls).
import { describe, expect, test } from 'vitest';

import { createSimHost, type SimLike } from '../src/sim/host';
import { buildRoadGeometry, vehiclePosition, type LinkGeom } from '../src/render/geometry';
import { BLEND_M, ExtrapolationClock, NO_NEXT, extrapolate, vehicleDrawPosition } from '../src/render/motion';
// (extrapolate: never past the link end; the blend curve ends at the next link's start)
import type { FrameMessage, FromWorker, ReadyMessage, ToWorker } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

/** A host on real wasm (River City) with a fake clock. */
function host() {
  const memory = loadWasm();
  let t = 0;
  const posted: FromWorker[] = [];
  const h = createSimHost({
    createSim: (d, b) => Sim.river_city(d, b) as unknown as SimLike,
    memory: () => memory,
    post: (m) => posted.push(m),
    now: () => t,
  });
  const send = (m: ToWorker) => h.handle(m);
  const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
  const iterate = (n: number, ms = 16) => {
    for (let i = 0; i < n; i++) {
      t += ms;
      h.iterate();
    }
  };
  send({ type: 'init', demandSeed: 2026, behaviorSeed: 7 });
  const ready = posted.find((m): m is ReadyMessage => m.type === 'ready')!;
  return { send, frames, iterate, ready, last: () => frames().at(-1)! };
}

let cached: { links: LinkGeom[]; ready: ReadyMessage } | null = null;
function city() {
  if (!cached) {
    const { ready } = host();
    cached = { links: buildRoadGeometry(ready.network).links, ready };
  }
  return cached;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('polish-003', () => {
  test('2 frame_carries_next_links', () => {
    const h = host();
    const { linkFrom, linkTo } = h.ready.network;
    const n = linkFrom.length;
    const check = (f: FrameMessage, label: string) => {
      const next = (f as FrameMessage & { nextLinks: Uint16Array }).nextLinks;
      expect(next, `${label}: nextLinks`).toBeInstanceOf(Uint16Array);
      expect(next.length, `${label}: one per record`).toBe(f.count);
      const words = new Uint32Array(f.vehicles, 0, f.count * 4);
      let some = 0;
      for (let i = 0; i < f.count; i++) {
        const nx = next[i]!;
        if (nx === NO_NEXT) continue;
        some++;
        expect(nx, `${label}: record ${i} next is a link`).toBeLessThan(n);
        const link = words[4 * i]!;
        expect(linkFrom[nx], `${label}: record ${i} next starts where its link ends`).toBe(linkTo[link]);
      }
      expect(some, `${label}: some vehicles have a next link`).toBeGreaterThan(f.count / 2);
    };
    h.send({ type: 'setSpeed', multiplier: 60 });
    h.send({ type: 'setRunning', running: true });
    for (let i = 0; i < 100_000 && (h.frames().at(-1)?.tick ?? 0) < 1800; i++) h.iterate(1);
    h.send({ type: 'setRunning', running: false });
    h.iterate(2);
    expect(h.last().count).toBeGreaterThan(300);
    check(h.last(), 'running');
    // after a seek
    h.send({ type: 'seek', tick: h.last().tick - 200 });
    h.iterate(2);
    check(h.last(), 'after a seek');
    // in B after a branch (the main bridge closed in B)
    h.send({ type: 'branch', fromTick: h.last().tick, then: h.ready.landmarks.central_bridge.map((link) => ({ kind: 'close' as const, link })) });
    h.send({ type: 'setRunning', running: true });
    h.iterate(30);
    h.send({ type: 'setRunning', running: false });
    h.iterate(2);
    expect(h.last().scenario).toBe(1);
    check(h.last(), 'branch B');
  });

  test('3 draw_position_is_continuous_across_junctions', { timeout: 120_000 }, () => {
    const { links } = city();
    let pairs = 0;
    for (const a of links) {
      const end = { x: a.x1, y: a.y1 };
      for (const b of links) {
        // b starts at a's end node: same node line (the two-way offsets differ), so compare node ids via geometry
        if (b.id === a.id) continue;
        const { linkFrom, linkTo } = city().ready.network;
        if (linkFrom[b.id] !== linkTo[a.id] || linkTo[b.id] === linkFrom[a.id]) continue; // no U-turns
        pairs++;
        for (let lane = 0; lane < a.lanes; lane++) {
          const outLane = Math.min(lane, b.lanes - 1);
          // (a) s = length on a lands on b's start, heading along b
          const atEnd = vehicleDrawPosition(links, a.id, a.length, lane, b.id);
          const bStart = vehicleDrawPosition(links, b.id, 0, outLane, NO_NEXT);
          expect(dist(atEnd, bStart), `${a.id}→${b.id} lane ${lane}: end = next start`).toBeLessThanOrEqual(1e-3);
          const bdx = (b.x1 - b.x0) / Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
          const bdy = (b.y1 - b.y0) / Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
          expect(Math.acos(Math.min(1, atEnd.hx * bdx + atEnd.hy * bdy)), `${a.id}→${b.id}: heading at the end`).toBeLessThanOrEqual(0.05);
          // (b) no jump along a: 0.1 m steps through the blend zone (and 0.5 m before it) move at most 0.75 m
          // (the curve may be up to ~2.3 × the blend length, far below the 4.6 m junction jumps it replaces)
          const from = Math.max(0, a.length - Math.min(BLEND_M, a.length / 2) - 0.5);
          let prev = vehicleDrawPosition(links, a.id, from, lane, b.id);
          let worst = 0;
          let worstAt = from;
          for (let s = from + 0.1; s <= a.length + 0.1 - 1e-9; s += 0.1) {
            const p = vehicleDrawPosition(links, a.id, Math.min(s, a.length), lane, b.id);
            if (dist(p, prev) > worst) [worst, worstAt] = [dist(p, prev), s];
            prev = p;
          }
          expect(worst, `${a.id}→${b.id} lane ${lane}: worst 0.1 m step at s=${worstAt.toFixed(1)}`).toBeLessThanOrEqual(0.75);
          // (c) outside the blend zone: today's placement
          const blend = Math.min(BLEND_M, a.length / 2);
          for (const s of [0, a.length / 3, a.length - blend - 0.01]) {
            const p = vehicleDrawPosition(links, a.id, s, lane, b.id);
            const [x, y] = vehiclePosition(a, s, lane);
            expect(Math.hypot(p.x - x, p.y - y)).toBeLessThanOrEqual(1e-9);
          }
        }
        void end;
      }
    }
    expect(pairs).toBeGreaterThan(300);
    // without a next link: today's placement everywhere
    for (const a of links.slice(0, 40))
      for (const s of [0, a.length / 2, a.length]) {
        const p = vehicleDrawPosition(links, a.id, s, 0, NO_NEXT);
        const [x, y] = vehiclePosition(a, s, 0);
        expect(Math.hypot(p.x - x, p.y - y)).toBeLessThanOrEqual(1e-9);
      }
  });

  test('4 extrapolation_stops_at_the_end_on_the_curve', () => {
    // The sim holds cars at stop lines and stops them instantly, so extrapolating past the end would
    // snap cars back when the next frame arrives (Red r1 B1). Extrapolation stops at the link end; with a
    // next link that end is the next link's start (the blend curve), so the next frame continues from there.
    const { links, ready } = city();
    const { linkFrom, linkTo } = ready.network;
    let checked = 0;
    for (const a of links) {
      const b = links.find((x) => linkFrom[x.id] === linkTo[a.id] && linkTo[x.id] !== linkFrom[a.id]);
      if (!b) continue;
      checked++;
      for (const next of [b.id, NO_NEXT]) {
        // within the link: s + v·dt
        const r = extrapolate(links, a.id, a.length - 10, 10, 0.5, next);
        expect(r).toEqual({ link: a.id, s: a.length - 5 });
        // past the end: stays on a at its end
        const e = extrapolate(links, a.id, a.length - 3, 10, 1, next);
        expect(e).toEqual({ link: a.id, s: a.length });
      }
      // with a next link the stopped car is drawn at the next link's start (lane min(lane, b.lanes − 1))
      const atEnd = vehicleDrawPosition(links, a.id, extrapolate(links, a.id, a.length - 3, 10, 1, b.id).s, 0, b.id);
      const bStart = vehicleDrawPosition(links, b.id, 0, 0, NO_NEXT);
      expect(dist(atEnd, bStart)).toBeLessThanOrEqual(1e-3);
      if (checked > 60) break;
    }
    expect(checked).toBeGreaterThan(60);
  });

  test('5 speed_change_never_moves_cars_back', () => {
    const c = new ExtrapolationClock();
    let now = 0;
    let tick = 100;
    const frame = (running = true) => c.frame(now, tick, running);
    // 20× = 0.02 sim s per wall ms; a new tick every 25 ms
    let rate = 0.02;
    const seq: number[] = [];
    for (let i = 0; i < 40; i++) {
      if (i % 2 === 0) {
        tick++;
        frame();
      } else frame();
      now += 12.5;
      seq.push(c.at(now, rate));
    }
    // within a tick the extrapolation never decreases
    for (let i = 1; i < seq.length; i += 2) expect(seq[i]!).toBeGreaterThanOrEqual(seq[i - 1]! - 1e-12);
    for (const next of [0.005, 0.001, 0.06]) {
      // mid-tick, the rate changes: continuous at the change
      const before = c.at(now, rate);
      rate = next;
      const after = c.at(now, rate);
      expect(Math.abs(after - before), `continuous at the change to ${next}`).toBeLessThanOrEqual(1e-9);
      // and it keeps growing at the new rate
      now += 5;
      expect(c.at(now, rate)).toBeGreaterThan(after);
    }
    // pause: 0; resume: restarts from 0 at the first running frame
    frame(false);
    now += 100;
    expect(c.at(now, rate)).toBe(0);
    now += 1000;
    frame(true);
    expect(c.at(now, rate)).toBe(0);
    now += 10;
    expect(c.at(now, rate)).toBeCloseTo(10 * rate, 9);
  });

  test('6 stall_cannot_overshoot', () => {
    const c = new ExtrapolationClock();
    let now = 0;
    let tick = 0;
    const rate = 0.01; // 10 sim s per wall s: 0.5 sim s per frame at 50 ms
    for (let i = 0; i < 20; i++) {
      tick++;
      c.frame(now, tick, true);
      now += 50;
    }
    // a 2 s stall: no frame
    let max = 0;
    for (let ms = 0; ms <= 2000; ms += 10) max = Math.max(max, c.at(now + ms, rate));
    expect(max).toBeLessThanOrEqual(0.75 + 1e-9);
    expect(max).toBeGreaterThan(0.5); // it does extrapolate up to the cap
    // after a speed change too
    now += 2000;
    tick++;
    c.frame(now, tick, true);
    let max2 = 0;
    for (let ms = 0; ms <= 2000; ms += 10) max2 = Math.max(max2, c.at(now + ms, rate * 3));
    expect(max2).toBeLessThanOrEqual(0.75 + 1e-9);
  });
});
