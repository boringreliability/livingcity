// Ward motion-002, tests 1–6 and 8 (vitest): trip ids and epochs in the frame, junction clearances, and the
// presentation model — interpolation by trip id at a presentation time P that never runs ahead of the newest
// frame and never jumps; held cars at a stop line clear of the junction, entering cars beyond it; compressed
// end zones (no overlap); continuous transitions; resets.
import { describe, expect, test } from 'vitest';

import { decodeVehicles } from '../src/sim/frame';
import { createSimHost, type SimLike } from '../src/sim/host';
import { DT, FLAG_LANE_SHIFT, type FrameMessage, type FromWorker, type ReadyMessage, type ToWorker } from '../src/sim/protocol';
import { buildRoadGeometry, vehiclePosition, type LinkGeom } from '../src/render/geometry';
import { NO_NEXT } from '../src/render/motion';
import { clearances, PresentationClock, Presenter, visualPose, type Clearances, type PresentClockInput, type PresentFrame } from '../src/render/presentation';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

type Framed = FrameMessage & { tripIds?: Uint32Array; world?: number; epoch?: number };
type City = 'three_bridges' | 'river_city';
type V = [number, number];

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
      const s = city === 'river_city' ? Sim.river_city(d, b) : Sim.three_bridges(d, b);
      sims.push(s);
      return wrap(s);
    },
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
  return { h, send, frames, iterate, ready, sims };
}

// ---- networks and their clearances ----
const NETS = new Map<City, { links: LinkGeom[]; from: Uint32Array; to: Uint32Array }>();
function network(city: City = 'three_bridges') {
  const cached = NETS.get(city);
  if (cached) return cached;
  const w = host();
  w.send({ type: 'init', demandSeed: 17, behaviorSeed: 23, city });
  const r = w.ready();
  const net = { links: buildRoadGeometry(r.network).links, from: Uint32Array.from(r.network.linkFrom), to: Uint32Array.from(r.network.linkTo) };
  NETS.set(city, net);
  return net;
}
const CLS = new Map<City, Clearances>();
function cl(city: City = 'three_bridges'): Clearances {
  const cached = CLS.get(city);
  if (cached) return cached;
  const n = network(city);
  const c = clearances(n.links, n.from, n.to);
  CLS.set(city, c);
  return c;
}

// ---- the expected geometry, computed here from the clearances ----
const stopAt = (l: LinkGeom, c: Clearances) => l.length - c.end[l.id]!;
const entryAt = (l: LinkGeom, c: Clearances) => c.start[l.id]!;
/** The expected visual coordinate: each end zone (2·clearance) drawn in half its length. */
function vS(l: LinkGeom, c: Clearances, s: number): number {
  const e = c.start[l.id]!;
  const z = c.end[l.id]!;
  if (s <= 2 * e) return e + s / 2;
  if (s >= l.length - 2 * z) return l.length - 2 * z + (s - (l.length - 2 * z)) / 2;
  return s;
}
const dirOf = (l: LinkGeom): V => {
  const d = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
  return [(l.x1 - l.x0) / d, (l.y1 - l.y0) / d];
};
function along(l: LinkGeom, x: number, y: number): number {
  const dx = l.x1 - l.x0;
  const dy = l.y1 - l.y0;
  return (((x - l.x0) * dx + (y - l.y0) * dy) / (dx * dx + dy * dy)) * l.length;
}
const near = (p: { x: number; y: number }, q: V, tol: number) => Math.hypot(p.x - q[0], p.y - q[1]) <= tol;

// ---- rectangles (separating axes), independent of the implementation ----
const CAR_L = 4.5;
const CAR_W = 2.0;
function roadRect(l: LinkGeom): V[] {
  const w = l.width / 2;
  return [
    [l.x0 + l.nx * w, l.y0 + l.ny * w],
    [l.x1 + l.nx * w, l.y1 + l.ny * w],
    [l.x1 - l.nx * w, l.y1 - l.ny * w],
    [l.x0 - l.nx * w, l.y0 - l.ny * w],
  ];
}
function carRect(cx: number, cy: number, hx: number, hy: number): V[] {
  const [nx, ny] = [-hy, hx];
  const a = CAR_L / 2;
  const b = CAR_W / 2;
  return [
    [cx + hx * a + nx * b, cy + hy * a + ny * b],
    [cx + hx * a - nx * b, cy + hy * a - ny * b],
    [cx - hx * a - nx * b, cy - hy * a - ny * b],
    [cx - hx * a + nx * b, cy - hy * a + ny * b],
  ];
}
function overlap(p: V[], q: V[]): boolean {
  for (const poly of [p, q])
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i]!;
      const [x2, y2] = poly[(i + 1) % 4]!;
      const ax = -(y2 - y1);
      const ay = x2 - x1;
      const a = p.map(([x, y]) => x * ax + y * ay);
      const b = q.map(([x, y]) => x * ax + y * ay);
      if (Math.max(...a) <= Math.min(...b) + 1e-9 || Math.max(...b) <= Math.min(...a) + 1e-9) return false;
    }
  return true;
}
/** Road rectangles of the other links at `node` (link `self` and its reverse excluded). */
function othersAt(city: City, node: number, self: number): V[][] {
  const { links, from, to } = network(city);
  const out: V[][] = [];
  for (let k = 0; k < links.length; k++) {
    if (k === self || (from[k] === to[self] && to[k] === from[self])) continue;
    if (from[k] === node || to[k] === node) out.push(roadRect(links[k]!));
  }
  return out;
}
const clearAt = (city: City, l: LinkGeom, node: number, s: number, lane: number) => {
  const [x, y] = vehiclePosition(l, s, lane);
  const [hx, hy] = dirOf(l);
  return othersAt(city, node, l.id).every((r) => !overlap(carRect(x, y, hx, hy), r));
};

/** Junction pairs a → b (b leaves a's end node, not a's reverse). */
function junctionPairs(minLen = 0, city: City = 'three_bridges'): [number, number][] {
  const { links, from, to } = network(city);
  const out: [number, number][] = [];
  for (let a = 0; a < links.length; a++)
    for (let b = 0; b < links.length; b++)
      if (b !== a && from[b] === to[a] && to[b] !== from[a] && links[a]!.length >= minLen && links[b]!.length >= minLen) out.push([a, b]);
  return out;
}
const turnOf = (city: City, [a, b]: [number, number]) => {
  const { links } = network(city);
  const [ax, ay] = dirOf(links[a]!);
  const [bx, by] = dirOf(links[b]!);
  return { angle: (Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by))) * 180) / Math.PI, cross: ax * by - ay * bx };
};
function pick() {
  const { links, from, to } = network();
  const ps = junctionPairs(40);
  const straight = ps.find((p) => turnOf('three_bridges', p).angle < 10) ?? ps[0]!;
  const byTurn = (sign: number) => ps.filter((p) => Math.sign(turnOf('three_bridges', p).cross) === sign).reduce((m, p) => (turnOf('three_bridges', p).angle > turnOf('three_bridges', m).angle ? p : m));
  const turnL = byTurn(1);
  const turnR = byTurn(-1);
  const turn = turnOf('three_bridges', turnL).angle >= turnOf('three_bridges', turnR).angle ? turnL : turnR;
  const a = straight[0];
  let unrelated = -1;
  for (let c = 0; c < links.length && unrelated < 0; c++) if (c !== a && from[c] !== to[a] && links[c]!.length >= 40) unrelated = c;
  return { straight, turn, turnL, turnR, turnAngle: turnOf('three_bridges', turn).angle, unrelated };
}

type Car = { trip: number; link: number; s: number; v?: number; lane?: number; queued?: boolean };
function frame(tick: number, cars: Car[], o: Partial<Pick<PresentFrame, 'scenario' | 'world' | 'compare' | 'epoch'>> = {}): PresentFrame {
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
    scenario: o.scenario ?? 0,
    world: o.world ?? 1,
    epoch: o.epoch ?? 1,
    compare: o.compare ?? false,
    vehicles: decodeVehicles(words.buffer, cars.length),
    tripIds: Uint32Array.from(cars.map((c) => c.trip)),
  };
}
const run = (m: number): PresentClockInput => ({ running: true, multiplier: m, achievedTicksPerS: 2 * m, behind: false });
const PAUSED = (m: number): PresentClockInput => ({ running: false, multiplier: m, achievedTicksPerS: 0, behind: false });

/** Streams `schedule` into `p` (each frame pushed once wall time reaches it) and samples every `step` ms. */
function drive(p: Presenter, schedule: { at: number; f: PresentFrame; c: PresentClockInput }[], until: number, step: number, onSample: (now: number, P: number) => void) {
  let k = 0;
  for (let now = schedule[0]!.at; now <= until; now += step) {
    while (k < schedule.length && schedule[k]!.at <= now) {
      p.push(schedule[k]!.f, schedule[k]!.at, schedule[k]!.c);
      k++;
    }
    onSample(now, p.advance(now));
  }
}
/** Pose samples with P: steps bounded by their share of the path, heading turning gradually. */
function expectSmooth(poses: { x: number; y: number; hx: number; hy: number; P: number }[], tag: string) {
  let len = 0;
  for (let i = 1; i < poses.length; i++) len += Math.hypot(poses[i]!.x - poses[i - 1]!.x, poses[i]!.y - poses[i - 1]!.y);
  const span = (poses.at(-1)!.P - poses[0]!.P) / DT || 1;
  for (let i = 1; i < poses.length; i++) {
    const step = Math.hypot(poses[i]!.x - poses[i - 1]!.x, poses[i]!.y - poses[i - 1]!.y);
    const share = (poses[i]!.P - poses[i - 1]!.P) / DT / span;
    expect(step, `${tag}: no jump`).toBeLessThanOrEqual(1.5 * share * len + 1e-3);
    expect(poses[i]!.hx * poses[i - 1]!.hx + poses[i]!.hy * poses[i - 1]!.hy, `${tag}: heading turns gradually`).toBeGreaterThanOrEqual(Math.cos(Math.PI / 6) - 1e-9);
  }
}

describe('motion-002', () => {
  test('1 frame_carries_trip_ids_and_epoch', () => {
    const w = host();
    w.send({ type: 'init', demandSeed: 17, behaviorSeed: 23, warmupS: 900 }); // River City (the default city)
    for (let i = 0; i < 6000 && w.frames().length === 0; i++) w.iterate(1);
    w.send({ type: 'setSpeed', multiplier: 20 });
    w.send({ type: 'setRunning', running: true });
    w.iterate(600);
    const fs = w.frames().filter((f) => f.count > 100).slice(-12);
    expect(fs.length).toBeGreaterThan(5);
    for (const f of fs) {
      expect(f.tripIds, 'a tripIds array').toBeInstanceOf(Uint32Array);
      expect(f.tripIds!.length).toBe(f.count);
      expect(new Set(f.tripIds).size, 'unique within a frame').toBe(f.count);
      expect(f.vehicles.byteLength, 'the 16 B record is unchanged').toBe(f.count * 16);
    }
    const last = fs.at(-1)!;
    for (let i = 0; i < last.count; i++) expect(w.sims[0]!.trip_at_record(last.tick, i), `record ${i}`).toBe(last.tripIds![i]);
    // stable identity across consecutive running frames: same link with s not smaller, or moved on
    const { to, from } = network('river_city');
    for (let k = 1; k < fs.length; k++) {
      const [x, y] = [fs[k - 1]!, fs[k]!];
      if (y.tick === x.tick) continue;
      const dx = decodeVehicles(x.vehicles, x.count);
      const dy = decodeVehicles(y.vehicles, y.count);
      const at = new Map<number, number>();
      y.tripIds!.forEach((id, i) => at.set(id, i));
      let again = 0;
      for (let i = 0; i < x.count; i++) {
        const j = at.get(x.tripIds![i]!);
        if (j === undefined) continue;
        again++;
        if (dy.link(j) === dx.link(i)) expect(dy.s(j), 'same trip, same link: not moved back').toBeGreaterThanOrEqual(dx.s(i) - 1e-6);
        else expect(from[dy.link(j)], 'same trip on another link: one it reached from its old link').toBe(to[dx.link(i)]);
      }
      expect(again / x.count, 'most trips reappear').toBeGreaterThanOrEqual(0.5);
    }
    // epochs: unchanged while plainly running; new after seek, branch, view switch, discard, compare
    expect(new Set(fs.map((f) => f.epoch)).size, 'one epoch while plainly running').toBe(1);
    expect(typeof last.epoch).toBe('number');
    const epochAfter = (m: ToWorker) => {
      const before = w.frames().at(-1)!;
      w.send(m);
      w.iterate(2);
      return { before, after: w.frames().at(-1)! };
    };
    w.send({ type: 'setRunning', running: false });
    w.iterate(2);
    const at = w.frames().at(-1)!.tick - 60;
    let r = epochAfter({ type: 'seek', tick: at });
    expect(r.after.epoch, 'seek').not.toBe(r.before.epoch);
    for (let i = 0; i < r.after.count; i++) expect(w.sims[0]!.trip_at_record(r.after.tick, i), `after a seek, record ${i}`).toBe(r.after.tripIds![i]);
    r = epochAfter({ type: 'branch', fromTick: at - 20, then: [] });
    expect(r.after.scenario).toBe(1);
    expect(r.after.epoch === r.before.epoch && r.after.scenario === r.before.scenario, 'branch').toBe(false);
    const b = r.after;
    for (let i = 0; i < b.count; i++) expect(w.sims[1]!.trip_at_record(b.tick, i), `B record ${i}`).toBe(b.tripIds![i]);
    r = epochAfter({ type: 'compare', on: true });
    const pairEpoch = r.after.epoch;
    expect(pairEpoch, 'compare on').not.toBe(r.before.epoch);
    r = epochAfter({ type: 'compare', on: false });
    expect(r.after.epoch, 'compare off').not.toBe(pairEpoch);
    r = epochAfter({ type: 'viewScenario', scenario: 0 });
    const aEpoch = r.after.epoch;
    r = epochAfter({ type: 'viewScenario', scenario: 1 });
    expect(r.after.epoch === r.before.epoch && r.after.scenario === r.before.scenario, 'view switch').toBe(false);
    r = epochAfter({ type: 'discardBranch' });
    expect(r.after.scenario).toBe(0);
    expect(r.after.epoch, 'discard').not.toBe(aEpoch);
  });

  test('2 held_car_stays_at_its_stop_line_without_overlap', () => {
    const net = network();
    const C = cl();
    const [a] = pick().straight;
    const A = net.links[a]!;
    const p = new Presenter(net.links, net.from, net.to);
    const back = 2 * C.start[a]! + 5; // outside both end zones
    const sched = Array.from({ length: 7 }, (_, k) => ({
      at: k * 500,
      c: run(1),
      f: frame(100 + k, [
        { trip: 1, link: a, s: A.length, v: 0, queued: true },
        { trip: 2, link: a, s: A.length - 7.5, v: 0, queued: true },
        { trip: 3, link: a, s: back, v: 0, queued: true },
      ]),
    }));
    let n = 0;
    drive(p, sched, 3200, 16, () => {
      const head = p.vehicle(1)!;
      const fol = p.vehicle(2)!;
      const q = p.vehicle(3)!;
      expect(near(head.pose, vehiclePosition(A, stopAt(A, C), 0), 1e-6), 'held head car: exactly at the stop line').toBe(true);
      expect(head.s).toBeCloseTo(stopAt(A, C), 6);
      expect(head.next, 'not moving on').toBe(NO_NEXT);
      const [hx, hy] = dirOf(A);
      expect(othersAt('three_bridges', net.to[a]!, a).every((r) => !overlap(carRect(head.pose.x, head.pose.y, hx, hy), r)), 'its body overlaps no other road').toBe(true);
      expect(near(fol.pose, vehiclePosition(A, vS(A, C, A.length - 7.5), 0), 1e-6), 'follower at its visual coordinate').toBe(true);
      expect(Math.hypot(head.pose.x - fol.pose.x, head.pose.y - fol.pose.y), 'no overlap at the queue front').toBeGreaterThanOrEqual(3.6);
      expect(near(q.pose, vehiclePosition(A, back, 0), 1e-6), 'outside the end zones: exactly its own s').toBe(true);
      n++;
    });
    expect(n).toBeGreaterThan(100);
  });

  test('2c interpolation_is_linear_in_the_visual_coordinate', () => {
    const net = network();
    const C = cl();
    const [a] = pick().straight;
    const A = net.links[a]!;
    for (const [mult, msPerTick] of [
      [1, 500],
      [20, 25],
    ] as const) {
      const p = new Presenter(net.links, net.from, net.to);
      const base = 2 * C.start[a]! + 2;
      const s1 = [base, base + 7, base + 14, base + 21];
      const s2 = [A.length - 10, A.length - 6, A.length - 2, A.length];
      const sched = s1.map((x, k) => ({ at: k * msPerTick, c: run(mult), f: frame(600 + k, [{ trip: 1, link: a, s: x, v: 14 }, { trip: 2, link: a, s: s2[k]!, v: 8 }]) }));
      let n = 0;
      drive(p, sched, 4 * msPerTick, msPerTick / 50, (_now, P) => {
        const k = Math.floor(P / DT + 1e-9) - 600;
        if (k < 0 || k >= 3) return;
        const alpha = P / DT - (600 + k);
        const e1 = vS(A, C, s1[k]!) + alpha * (vS(A, C, s1[k + 1]!) - vS(A, C, s1[k]!));
        const e2 = vS(A, C, s2[k]!) + alpha * (vS(A, C, s2[k + 1]!) - vS(A, C, s2[k]!));
        expect(p.vehicle(1)!.s, `${mult}×: linear between frames (α ${alpha.toFixed(3)})`).toBeCloseTo(e1, 6);
        expect(p.vehicle(2)!.s, `${mult}×: linear in the compressed end zone`).toBeCloseTo(e2, 6);
        n++;
      });
      expect(n, `${mult}×: samples between frames`).toBeGreaterThan(40);
    }
  });

  test('2b release_from_a_held_state_is_continuous', () => {
    const net = network();
    const C = cl();
    const pr = pick();
    for (const [a, b] of [pr.straight, pr.turnL, pr.turnR]) {
      const A = net.links[a]!;
      const B = net.links[b]!;
      const p = new Presenter(net.links, net.from, net.to);
      const sched = [0, 1, 2, 3].map((k) => ({ at: k * 500, c: run(1), f: frame(100 + k, [{ trip: 4, link: a, s: A.length, v: 0, queued: true }]) }));
      sched.push({ at: 2000, c: run(1), f: frame(104, [{ trip: 4, link: b, s: 2, v: 4 }]) });
      sched.push({ at: 2500, c: run(1), f: frame(105, [{ trip: 4, link: b, s: 4, v: 4 }]) });
      const poses: { x: number; y: number; hx: number; hy: number; P: number }[] = [];
      drive(p, sched, 3600, 2, (_n, P) => {
        if (P < 103 * DT - 1e-9 || P > 104 * DT + 1e-9) return;
        const v = p.vehicle(4)!;
        poses.push({ ...v.pose, P });
        if (v.link === a && P > 103 * DT + 1e-9) expect(v.next, 'moving onto B').toBe(b);
      });
      const tag = `release ${a}→${b}`;
      expect(poses.length).toBeGreaterThan(20);
      expect(near(poses[0]!, vehiclePosition(A, stopAt(A, C), 0), 0.05), `${tag}: starts at the stop line`).toBe(true);
      expect(near(poses.at(-1)!, vehiclePosition(B, vS(B, C, 2), 0), 0.05), `${tag}: ends at B`).toBe(true);
      expectSmooth(poses, tag);
    }
  });

  test('3 junction_transition_is_continuous', () => {
    const pr = pick();
    expect(pr.turnAngle, 'the sharpest turn is a real turn').toBeGreaterThanOrEqual(85);
    const cases: [City, number, number][] = [];
    for (const [x, y] of junctionPairs(30)) cases.push(['three_bridges', x, y]);
    junctionPairs(30, 'river_city').forEach(([x, y], i) => {
      if (i % 8 === 0) cases.push(['river_city', x, y]);
    });
    expect(cases.length, 'many junction pairs').toBeGreaterThanOrEqual(120);
    let turns = 0;
    for (const [city, a, b] of cases) {
      const net = network(city);
      const C = cl(city);
      const A = net.links[a]!;
      const B = net.links[b]!;
      if (turnOf(city, [a, b]).angle >= 85) turns++;
      const s0 = Math.max(vS(A, C, 0), A.length - 2 * C.end[a]! - 6); // before the end zone
      const p = new Presenter(net.links, net.from, net.to);
      const sched = [
        { at: -500, c: run(1), f: frame(199, [{ trip: 5, link: a, s: s0 - 7, v: 8 }]) }, // priming
        { at: 0, c: run(1), f: frame(200, [{ trip: 5, link: a, s: s0, v: 8 }]) },
        { at: 500, c: run(1), f: frame(201, [{ trip: 5, link: b, s: 3, v: 8 }]) },
        { at: 1000, c: run(1), f: frame(202, [{ trip: 5, link: b, s: 7, v: 8 }]) },
      ];
      const poses: { x: number; y: number; hx: number; hy: number; P: number }[] = [];
      drive(p, sched, 1800, 2, (_n, P) => {
        if (P >= 200 * DT - 1e-9 && P <= 201 * DT + 1e-9) poses.push({ ...p.vehicle(5)!.pose, P });
      });
      const tag = `${city} ${a}→${b}`;
      expect(poses.length, tag).toBeGreaterThan(20);
      expect(near(poses[0]!, vehiclePosition(A, vS(A, C, s0), 0), 0.05), `${tag}: starts at A`).toBe(true);
      expect(near(poses.at(-1)!, vehiclePosition(B, vS(B, C, 3), 0), 0.05), `${tag}: ends at B`).toBe(true);
      expectSmooth(poses, tag);
    }
    expect(turns, 'turns among the cases').toBeGreaterThan(20);
    // a link that does not leave A's end node: placed directly, no fabricated path
    const net = network();
    const [a] = pr.straight;
    const A = net.links[a]!;
    const Cn = net.links[pr.unrelated]!;
    const p = new Presenter(net.links, net.from, net.to);
    const onLane = (l: LinkGeom, x: number, y: number) => {
      const t = along(l, x, y);
      if (t < -0.5 || t > l.length + 0.5) return false;
      const [px, py] = vehiclePosition(l, Math.max(0, Math.min(l.length, t)), 0);
      return Math.hypot(px - x, py - y) < 0.5;
    };
    drive(
      p,
      [
        { at: 0, c: run(1), f: frame(300, [{ trip: 7, link: a, s: A.length / 2, v: 8 }]) },
        { at: 500, c: run(1), f: frame(301, [{ trip: 7, link: pr.unrelated, s: 3, v: 8 }]) },
        { at: 1000, c: run(1), f: frame(302, [{ trip: 7, link: pr.unrelated, s: 7, v: 8 }]) },
      ],
      1800,
      8,
      () => {
        const v = p.vehicle(7);
        if (v) expect(onLane(A, v.pose.x, v.pose.y) || onLane(Cn, v.pose.x, v.pose.y), 'only on A or on the new link').toBe(true);
      },
    );
  }, 180_000);

  test('3c clearances_keep_cars_out_of_junctions', () => {
    for (const city of ['river_city', 'three_bridges'] as const) {
      const { links, from, to } = network(city);
      const C = cl(city);
      expect(C.end.length).toBe(links.length);
      expect(C.start.length).toBe(links.length);
      for (const l of links) {
        const c = C.end[l.id]!;
        const e = C.start[l.id]!;
        const tag = `${city} link ${l.id}`;
        expect(c, `${tag}: end clearance on the 0.25 m grid from 0.5`).toBeCloseTo(0.5 + Math.round((c - 0.5) / 0.25) * 0.25, 9);
        expect(e, `${tag}: start clearance on the grid`).toBeCloseTo(0.5 + Math.round((e - 0.5) / 0.25) * 0.25, 9);
        expect(c).toBeGreaterThanOrEqual(0.5);
        expect(e).toBeGreaterThanOrEqual(0.5);
        expect(c).toBeLessThanOrEqual(l.length / 2);
        expect(e).toBeLessThanOrEqual(l.length / 2);
        expect(2 * c + 2 * e, `${tag}: both end zones fit`).toBeLessThanOrEqual(l.length + 1e-9);
        for (let lane = 0; lane < l.lanes; lane++) {
          expect(clearAt(city, l, to[l.id]!, l.length - c, lane), `${tag} lane ${lane}: clear at its stop line`).toBe(true);
          expect(clearAt(city, l, from[l.id]!, e, lane), `${tag} lane ${lane}: clear at its entry point`).toBe(true);
        }
        // minimal: a quarter metre closer, some lane overlaps another road
        if (c > 0.5) expect([...Array(l.lanes).keys()].every((ln) => clearAt(city, l, to[l.id]!, l.length - c + 0.25, ln)), `${tag}: end clearance is minimal`).toBe(false);
        if (e > 0.5) expect([...Array(l.lanes).keys()].every((ln) => clearAt(city, l, from[l.id]!, e - 0.25, ln)), `${tag}: start clearance is minimal`).toBe(false);
      }
    }
  }, 300_000);

  test('3b visual_rule_sweep', () => {
    let cases = 0;
    for (const city of ['river_city', 'three_bridges'] as const) {
      const { links } = network(city);
      const C = cl(city);
      const pairs = junctionPairs(0, city);
      expect(pairs.length, `${city}: every junction pair`).toBeGreaterThan(100);
      const seenA = new Set<number>();
      for (const [a, b] of pairs) {
        const A = links[a]!;
        const B = links[b]!;
        const [ax, ay] = dirOf(A);
        for (let lane = 0; lane < A.lanes; lane++) {
          cases++;
          if (!seenA.has(a * 16 + lane)) {
            seenA.add(a * 16 + lane);
            for (let s = 0; s <= A.length + 1e-9; s += 0.5) {
              const pz = visualPose(links, C, a, s, lane, NO_NEXT);
              const [x, y] = vehiclePosition(A, Math.min(Math.max(s, entryAt(A, C)), stopAt(A, C)), lane);
              expect(Math.hypot(pz.x - x, pz.y - y), `${city}: no next: straight, clamped to [entry, stop line] (link ${a}, s ${s})`).toBeLessThan(1e-6);
              expect(pz.hx * ax + pz.hy * ay, 'no next: A’s heading').toBeGreaterThanOrEqual(1 - 1e-9);
            }
          }
          const tag = `${city} ${a}→${b}, lane ${lane}`;
          let prev = visualPose(links, C, a, 0, lane, b);
          let arc = 0;
          let turned = 0;
          const step = Math.min(0.01, C.end[a]! / 100);
          for (let s = step; s <= A.length + 1e-9; s += step) {
            const pz = visualPose(links, C, a, s, lane, b);
            const dl = Math.hypot(pz.x - prev.x, pz.y - prev.y);
            expect(dl, `${tag}, s ${s.toFixed(2)}: continuous`).toBeLessThanOrEqual(0.75);
            arc += dl;
            turned += Math.acos(Math.max(-1, Math.min(1, pz.hx * prev.hx + pz.hy * prev.hy)));
            if (arc >= 0.1) {
              expect((turned * 180) / Math.PI / (arc / 0.1), `${tag}, s ${s.toFixed(2)}: heading ≤ 10° per 0.1 m of arc`).toBeLessThanOrEqual(10);
              arc = 0;
              turned = 0;
            }
            if (s <= stopAt(A, C) - 1e-9 && s >= entryAt(A, C)) {
              const [x, y] = vehiclePosition(A, s, lane);
              expect(Math.hypot(pz.x - x, pz.y - y), `${tag}: straight before the stop line`).toBeLessThan(1e-6);
            }
            prev = pz;
          }
          const end = visualPose(links, C, a, A.length, lane, b);
          const [ex, ey] = vehiclePosition(B, entryAt(B, C), Math.min(lane, B.lanes - 1));
          expect(Math.hypot(end.x - ex, end.y - ey), `${tag}: ends at B's entry point`).toBeLessThan(1e-6);
          const [bx, by] = dirOf(B);
          expect(end.hx * bx + end.hy * by, `${tag}: with B’s heading`).toBeGreaterThanOrEqual(Math.cos(1e-3));
        }
      }
    }
    expect(cases, 'pair × lane cases (both networks)').toBeGreaterThan(1300);
  }, 600_000);

  test('4 forward_playback_is_smooth', () => {
    // a real run (River City, the default city) with speed changes 20× → 5× → 60× → 1×
    const w = host();
    w.send({ type: 'init', demandSeed: 17, behaviorSeed: 23, warmupS: 600 });
    for (let i = 0; i < 4000 && w.frames().length === 0; i++) w.iterate(1);
    w.send({ type: 'setRunning', running: true });
    for (const [m, iters] of [
      [20, 120],
      [5, 120],
      [60, 120],
      [1, 300],
    ] as const) {
      w.send({ type: 'setSpeed', multiplier: m });
      w.iterate(iters, 16);
    }
    const fs = w.frames().filter((f) => f.clock.running);
    expect(fs.length).toBeGreaterThanOrEqual(200);
    const net = network('river_city');
    const C = cl('river_city');
    const p = new Presenter(net.links, net.from, net.to);
    let now = 0;
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let lastP: number | null = null;
    let lastN = 0;
    const lastPos = new Map<number, { link: number; s: number }>();
    const held = new Map<number, Set<number>>();
    let newest: Framed | null = null;
    let prevMult = 0;
    for (let k = 0; k < fs.length; k++) {
      const f = fs[k]!;
      const gap = k === Math.floor(fs.length / 2) ? 300 : 8 + 32 * rnd();
      for (let n = now; n < now + gap; n += 4) {
        if (!newest) continue;
        const P = p.advance(n);
        if (lastP !== null) {
          const rate = Math.max(prevMult, newest.clock.multiplier) / 1000;
          expect(P, 'P non-decreasing').toBeGreaterThanOrEqual(lastP - 1e-9);
          expect(P - lastP, 'P never jumps').toBeLessThanOrEqual(1.5 * rate * (n - lastN) + 1e-9);
        }
        expect(P, 'P never ahead of the newest frame').toBeLessThanOrEqual(newest.tick * DT + 1e-9);
        lastP = P;
        lastN = n;
        const dv = decodeVehicles(newest.vehicles, newest.count);
        const idx = new Map<number, number>();
        newest.tripIds!.forEach((id, i) => idx.set(id, i));
        for (const v of p.vehicles()) {
          const prev = lastPos.get(v.tripId);
          if (prev && prev.link === v.link) expect(v.s, `trip ${v.tripId} steps back`).toBeGreaterThanOrEqual(prev.s - 1e-6);
          if (prev && prev.link !== v.link) expect(held.get(v.tripId)?.has(v.link), `trip ${v.tripId} drawn on a link it never held`).toBe(true);
          lastPos.set(v.tripId, { link: v.link, s: v.s });
          const i = idx.get(v.tripId);
          if (i !== undefined && dv.link(i) === v.link && v.next === NO_NEXT)
            expect(v.s, `trip ${v.tripId} drawn beyond its newest position`).toBeLessThanOrEqual(vS(net.links[v.link]!, C, dv.s(i)) + 1e-6);
        }
      }
      now += gap;
      prevMult = newest ? newest.clock.multiplier : f.clock.multiplier;
      p.push({ tick: f.tick, scenario: f.scenario, world: f.world ?? 1, epoch: f.epoch ?? 1, compare: f.timeline.compare === 1, vehicles: decodeVehicles(f.vehicles, f.count), tripIds: f.tripIds! }, now, f.clock);
      const dv = decodeVehicles(f.vehicles, f.count);
      f.tripIds!.forEach((id, i) => {
        const s = held.get(id) ?? new Set<number>();
        s.add(dv.link(i));
        held.set(id, s);
      });
      newest = f;
    }

    // a stall: steady 20× frames, then 600 ms without frames, then frames ~24 ticks further on
    const tb = network();
    const [a] = pick().straight;
    const q = new Presenter(tb.links, tb.from, tb.to);
    let P0: number | null = null;
    let t0 = 0;
    const sched: { at: number; f: PresentFrame; c: PresentClockInput }[] = [];
    for (let k = 0; k < 40; k++) sched.push({ at: k * 25, c: run(20), f: frame(500 + k, [{ trip: 9, link: a, s: 15 + k * 0.2, v: 0.4 }]) });
    for (let k = 0; k < 120; k++) sched.push({ at: 1600 + k * 25, c: run(20), f: frame(564 + k, [{ trip: 9, link: a, s: 15 + (64 + k) * 0.2, v: 0.4 }]) });
    let caughtUp = Infinity;
    drive(q, sched, 4600, 4, (n, P) => {
      if (P0 !== null) expect(P - P0, 'no jump after the stall').toBeLessThanOrEqual(1.5 * (20 / 1000) * (n - t0) + 1e-9);
      if (n > 1600 && q.lagS() <= 4 * DT + 1e-9 && caughtUp === Infinity) caughtUp = n;
      P0 = P;
      t0 = n;
    });
    expect(caughtUp - 1600, 'caught up within 3 s').toBeLessThanOrEqual(3000);
  }, 120_000);

  test('4b pause_and_resume_have_no_jump', () => {
    const net = network();
    const [a] = pick().straight;
    for (const [mult, msPerTick] of [
      [1, 500],
      [20, 25],
    ] as const)
      for (const quiet of [false, true]) {
        const tag = `${mult}×${quiet ? ', quiet pause' : ''}`;
        const p = new Presenter(net.links, net.from, net.to);
        const sched: { at: number; f: PresentFrame; c: PresentClockInput }[] = [];
        const T = (k: number) => k * msPerTick;
        for (let k = 0; k < 6; k++) sched.push({ at: T(k), c: run(mult), f: frame(700 + k, [{ trip: 11, link: a, s: 15 + k * 0.5, v: 1 }]) });
        const pauseAt = T(5) + 0.4 * msPerTick; // mid-interval: P still trails the newest frame (tick 705)
        for (let k = 0; k < (quiet ? 1 : 4); k++) sched.push({ at: pauseAt + k * 16, c: PAUSED(mult), f: frame(705, [{ trip: 11, link: a, s: 17.5, v: 1 }]) });
        const resumeAt = pauseAt + 3000;
        for (let k = 0; k < 6; k++) sched.push({ at: resumeAt + T(k), c: run(mult), f: frame(706 + k, [{ trip: 11, link: a, s: 18 + k * 0.5, v: 1 }]) });
        let last: [number, number] | null = null;
        let settledAt = Infinity;
        let glided = false;
        const rate = mult / 1000;
        drive(p, sched, resumeAt + T(6), 2, (n, P) => {
          if (last) {
            expect(P, `${tag}: monotone`).toBeGreaterThanOrEqual(last[0] - 1e-9);
            expect(P - last[0], `${tag}: no jump`).toBeLessThanOrEqual(1.5 * rate * (n - last[1]) + 1e-9);
          }
          if (n >= pauseAt && n < resumeAt) {
            expect(P, `${tag}: paused: never past the newest frame`).toBeLessThanOrEqual(705 * DT + 1e-9);
            if (705 * DT - P > 0.1) glided = true;
            if (Math.abs(P - 705 * DT) < 1e-9 && settledAt === Infinity) settledAt = n;
            if (settledAt !== Infinity) expect(P, `${tag}: paused: stays on the newest frame`).toBeCloseTo(705 * DT, 9);
          }
          last = [P, n];
        });
        expect(glided, `${tag}: glides to the newest frame after the pause (not a snap)`).toBe(true);
        expect(settledAt, `${tag}: settles on the newest frame while paused`).toBeLessThan(resumeAt);
      }
  });

  test('5 identity_not_record_index', () => {
    const net = network();
    const C = cl();
    const [a] = pick().straight;
    const a2 = pick().unrelated;
    const A2 = net.links[a2]!;
    const b0 = 2 * C.start[a]! + 2;
    const p = new Presenter(net.links, net.from, net.to);
    let mid = 0;
    let after = 0;
    const s2 = 2 * C.start[a2]! + 3;
    drive(
      p,
      [
        { at: 0, c: run(1), f: frame(400, [{ trip: 10, link: a, s: b0, v: 8 }, { trip: 11, link: a, s: b0 + 15, v: 8 }]) },
        // swapped records, and a new trip in between
        { at: 500, c: run(1), f: frame(401, [{ trip: 11, link: a, s: b0 + 19, v: 8 }, { trip: 12, link: a2, s: s2, v: 8 }, { trip: 10, link: a, s: b0 + 4, v: 8 }]) },
        // trip 11 completes
        { at: 1000, c: run(1), f: frame(402, [{ trip: 12, link: a2, s: s2 + 4, v: 8 }, { trip: 10, link: a, s: b0 + 8, v: 8 }]) },
      ],
      1800,
      4,
      (_n, P) => {
        if (P > 400 * DT + 1e-9 && P < 401 * DT - 1e-9) {
          mid++;
          const t10 = p.vehicle(10)!;
          const t11 = p.vehicle(11)!;
          expect([t10.link, t11.link]).toEqual([a, a]);
          expect(t10.s, 'trip 10 between its own states').toBeGreaterThanOrEqual(b0 - 1e-6);
          expect(t10.s).toBeLessThanOrEqual(b0 + 4 + 1e-6);
          expect(t11.s, 'trip 11 between its own states').toBeGreaterThanOrEqual(b0 + 15 - 1e-6);
          expect(t11.s).toBeLessThanOrEqual(b0 + 19 + 1e-6);
          const t12 = p.vehicle(12);
          if (t12) expect(near(t12.pose, vehiclePosition(A2, vS(A2, C, s2), 0), 1e-6), 'a new trip appears at its own position').toBe(true);
        }
        if (P > 401 * DT + 1e-9) {
          after++;
          expect(p.vehicle(11), 'a completed trip is not drawn').toBeNull();
          const t12 = p.vehicle(12)!;
          expect(t12.link).toBe(a2);
          expect(t12.s).toBeGreaterThanOrEqual(vS(A2, C, s2) - 1e-6);
        }
      },
    );
    expect(mid).toBeGreaterThan(10);
    expect(after).toBeGreaterThan(10);
  });

  test('5b shared_clock_gives_one_presentation_time', () => {
    const net = network();
    const [a] = pick().straight;
    const clock = new PresentationClock();
    const pa = new Presenter(net.links, net.from, net.to, clock);
    const pb = new Presenter(net.links, net.from, net.to, clock);
    let k = 0;
    let compared = 0;
    let newestA = -1;
    let newestB = -1;
    for (let now = 0; now < 4000; now += 4) {
      if (now >= k * 25) {
        pa.push(frame(900 + k, [{ trip: 1, link: a, s: 15 + k * 0.1, v: 0.2 }], { scenario: 0, compare: true }), now, run(20));
        newestA = 900 + k;
        k++;
      }
      if (now >= (k - 1) * 25 + 3 && now < (k - 1) * 25 + 7) {
        pb.push(frame(900 + k - 1, [{ trip: 2, link: a, s: 16 + (k - 1) * 0.1, v: 0.2 }], { scenario: 1, compare: true }), now, run(20));
        newestB = 900 + k - 1;
      }
      if (now < 100) continue;
      const Pa = pa.advance(now);
      const Pb = pb.advance(now);
      expect(Pa, `one presentation time at ${now} ms`).toBe(Pb);
      expect(Pa, 'never ahead of either side’s newest frame').toBeLessThanOrEqual(Math.min(newestA, newestB) * DT + 1e-9);
      compared++;
    }
    expect(compared).toBeGreaterThan(500);
  });

  test('6 history_resets_on_epoch_scenario_world', () => {
    const net = network();
    const C = cl();
    const [a] = pick().straight;
    const A = net.links[a]!;
    const s3 = 2 * C.start[a]! + 3;
    const f = (tick: number, s: number, o = {}) => frame(tick, [{ trip: 20, link: a, s, v: 8 }], o);
    const cases: [string, PresentFrame, boolean][] = [
      ['seek back (new epoch)', f(50, s3, { epoch: 2 }), true],
      ['seek forward (new epoch)', f(140, s3, { epoch: 2 }), true],
      ['lower tick, same epoch', f(50, s3), true],
      ['scenario', f(102, s3, { scenario: 1 }), true],
      ['world', f(102, s3, { world: 2 }), true],
      ['compare', f(102, s3, { compare: true }), true],
      ['a stall: 30 ticks ahead, same epoch', f(131, s3 + 40), false],
    ];
    for (const [name, nf, resets] of cases) {
      const p = new Presenter(net.links, net.from, net.to);
      p.push(f(100, s3 + 25), 0, run(1));
      p.push(f(101, s3 + 29), 500, run(1));
      const before = p.advance(700);
      p.push(nf, 900, run(1));
      const P = p.advance(901);
      if (resets) {
        expect(P, `${name}: P restarts at the new frame`).toBeCloseTo(nf.tick * DT, 9);
        expect(near(p.vehicle(20)!.pose, vehiclePosition(A, s3, 0), 1e-6), `${name}: no interpolation from the old frames`).toBe(true);
      } else {
        expect(P, `${name}: no reset, no jump`).toBeLessThanOrEqual(before + 1.5 * (1 / 1000) * 201 + 1e-9);
      }
    }
  });

  test('8 presentation_latency_is_bounded', () => {
    const net = network();
    const [a] = pick().straight;
    for (const [mult, msPerTick] of [
      [1, 500],
      [20, 25],
    ] as const) {
      const p = new Presenter(net.links, net.from, net.to);
      const lags: number[] = [];
      for (let now = 0; now < 6000; now += 16) {
        const tick = 1000 + Math.floor(now / msPerTick);
        p.push(frame(tick, [{ trip: 30, link: a, s: (tick % 20) + 15, v: 2 }]), now, run(mult));
        for (let n = now; n < now + 16; n += 4) {
          p.advance(n);
          if (now > 2000) lags.push(p.lagS());
        }
      }
      const bound = mult === 1 ? 0.55 : 4 * DT;
      expect(Math.max(...lags), `${mult}×: lag ≤ ${bound} sim s`).toBeLessThanOrEqual(bound + 1e-9);
      expect(Math.min(...lags), `${mult}×: never ahead`).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});
