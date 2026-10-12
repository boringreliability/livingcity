/**
 * Presentation (ward motion-002, contract M2): where and when cars are drawn.
 *
 * Authoritative state is the frame (link, s, v, lane, flags + trip ids). The picture shows a
 * presentation time `P` a little behind the newest frame, never ahead of it, and each car is
 * interpolated between the two retained frames around `P`, matched by trip id. A car on the same link
 * in both frames is drawn at most at the link's stop line (clear of the junction); the junction curve
 * (stop line → the next link's entry point) is used only while it moves onto the link it is on in the
 * newer frame.
 */
import type { DecodedVehicles } from '../sim/frame';
import { DT, FLAG_LANE_SHIFT } from '../sim/protocol';
import { vehiclePosition, type LinkGeom } from './geometry';
import { NO_NEXT, type DrawPose } from './motion';

/** Per link: how far from its end (`end`) and its start (`start`) a 4.5 × 2.0 m car must stay to be clear of
 *  every other road at that junction (render-only, from the drawn geometry; option A, 2026-10-12). */
export interface Clearances {
  end: Float64Array;
  start: Float64Array;
}

/** The car body the clearance keeps out of other roads (m). */
const CLEAR_CAR_L = 4.5;
const CLEAR_CAR_W = 2.0;
/** Clearance grid: 0.5, 0.75, 1, … m. */
const CLEAR_MIN_M = 0.5;
const CLEAR_STEP_M = 0.25;

type V2 = [number, number];

const dirOf = (l: LinkGeom): V2 => {
  const dx = l.x1 - l.x0;
  const dy = l.y1 - l.y0;
  const d = Math.hypot(dx, dy) || 1;
  return [dx / d, dy / d];
};

function roadRect(l: LinkGeom): V2[] {
  const w = l.width / 2;
  return [
    [l.x0 + l.nx * w, l.y0 + l.ny * w],
    [l.x1 + l.nx * w, l.y1 + l.ny * w],
    [l.x1 - l.nx * w, l.y1 - l.ny * w],
    [l.x0 - l.nx * w, l.y0 - l.ny * w],
  ];
}

function carRect(cx: number, cy: number, hx: number, hy: number): V2[] {
  const [nx, ny] = [-hy, hx];
  const a = CLEAR_CAR_L / 2;
  const b = CLEAR_CAR_W / 2;
  return [
    [cx + hx * a + nx * b, cy + hy * a + ny * b],
    [cx + hx * a - nx * b, cy + hy * a - ny * b],
    [cx - hx * a - nx * b, cy - hy * a - ny * b],
    [cx - hx * a + nx * b, cy - hy * a + ny * b],
  ];
}

/** Whether two convex quads overlap (separating axes; touching is not overlap). */
function overlap(p: V2[], q: V2[]): boolean {
  for (const poly of [p, q])
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i]!;
      const [x2, y2] = poly[(i + 1) % 4]!;
      const ax = -(y2 - y1);
      const ay = x2 - x1;
      let pMin = Infinity;
      let pMax = -Infinity;
      let qMin = Infinity;
      let qMax = -Infinity;
      for (const [x, y] of p) {
        const d = x * ax + y * ay;
        pMin = Math.min(pMin, d);
        pMax = Math.max(pMax, d);
      }
      for (const [x, y] of q) {
        const d = x * ax + y * ay;
        qMin = Math.min(qMin, d);
        qMax = Math.max(qMax, d);
      }
      if (pMax <= qMin + 1e-9 || qMax <= pMin + 1e-9) return false;
    }
  return true;
}

export function clearances(links: readonly LinkGeom[], linkFrom: ArrayLike<number>, linkTo: ArrayLike<number>): Clearances {
  const n = links.length;
  const atNode = new Map<number, number[]>();
  const add = (node: number, k: number) => {
    const list = atNode.get(node);
    if (list) list.push(k);
    else atNode.set(node, [k]);
  };
  for (let k = 0; k < n; k++) {
    add(linkFrom[k]!, k);
    if (linkTo[k] !== linkFrom[k]) add(linkTo[k]!, k);
  }
  const rects = links.map(roadRect);
  /** Road rectangles of the other links at `node` (`self` and its reverse excluded). */
  const others = (node: number, self: number): V2[][] =>
    (atNode.get(node) ?? []).filter((k) => k !== self && !(linkFrom[k] === linkTo[self] && linkTo[k] === linkFrom[self])).map((k) => rects[k]!);
  const clearAt = (l: LinkGeom, roads: V2[][], s: number): boolean => {
    const [hx, hy] = dirOf(l);
    for (let lane = 0; lane < l.lanes; lane++) {
      const [x, y] = vehiclePosition(l, s, lane);
      const car = carRect(x, y, hx, hy);
      if (roads.some((r) => overlap(car, r))) return false;
    }
    return true;
  };
  const end = new Float64Array(n);
  const start = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const l = links[i]!;
    // both end zones (2·end + 2·start) must fit the link: each clearance at most a quarter of it
    const cap = Math.max(CLEAR_MIN_M, CLEAR_MIN_M + Math.floor((l.length / 4 - CLEAR_MIN_M) / CLEAR_STEP_M) * CLEAR_STEP_M);
    const search = (roads: V2[][], at: (c: number) => number): number => {
      for (let k = 0; ; k++) {
        const c = CLEAR_MIN_M + k * CLEAR_STEP_M;
        if (c >= cap || clearAt(l, roads, at(c))) return Math.min(c, cap);
      }
    };
    end[i] = search(others(linkTo[i]!, i), (c) => l.length - c);
    start[i] = search(others(linkFrom[i]!, i), (c) => c);
  }
  return { end, start };
}

/** Along-link coordinate (m) of `l`'s visual stop line. */
export function stopLine(l: LinkGeom, c: Clearances): number {
  return l.length - c.end[l.id]!;
}

/** The visual coordinate of sim position `s` on `l`: both end zones drawn in half their length, so a held car
 *  (s = length) sits at the stop line, an entering car (s = 0) at the entry point, and a queue does not overlap. */
export function visualS(l: LinkGeom, c: Clearances, s: number): number {
  const e = c.start[l.id]!;
  const z = c.end[l.id]!;
  if (s <= 2 * e) return e + s / 2;
  if (s >= l.length - 2 * z) return l.length - 2 * z + (s - (l.length - 2 * z)) / 2;
  return s;
}

/** The visual rule: a car at visual coordinate `s` on `link`, moving onto `next` (or NO_NEXT: not moving on). */
export function visualPose(links: readonly LinkGeom[], c: Clearances, link: number, s: number, lane: number, next: number): DrawPose {
  const l = links[link]!;
  const d = dirOf(l);
  const laneA = Math.min(Math.max(lane, 0), l.lanes - 1);
  const stop = stopLine(l, c);
  const b = next !== NO_NEXT ? links[next] : undefined;
  if (!b || s <= stop) {
    const [x, y] = vehiclePosition(l, Math.min(Math.max(s, c.start[link]!), stop), laneA);
    return { x, y, hx: d[0], hy: d[1] };
  }
  // cubic Bézier: the stop-line pose (leaving along l) → b's entry point (arriving along b)
  const e = dirOf(b);
  const p0 = vehiclePosition(l, stop, laneA);
  const p3 = vehiclePosition(b, c.start[b.id]!, Math.min(Math.max(lane, 0), b.lanes - 1));
  const h = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 3;
  const p1: V2 = [p0[0] + d[0] * h, p0[1] + d[1] * h];
  const p2: V2 = [p3[0] - e[0] * h, p3[1] - e[1] * h];
  const u = Math.min(1, (s - stop) / c.end[link]!);
  const w = 1 - u;
  const x = w * w * w * p0[0] + 3 * w * w * u * p1[0] + 3 * w * u * u * p2[0] + u * u * u * p3[0];
  const y = w * w * w * p0[1] + 3 * w * w * u * p1[1] + 3 * w * u * u * p2[1] + u * u * u * p3[1];
  let tx = 3 * w * w * (p1[0] - p0[0]) + 6 * w * u * (p2[0] - p1[0]) + 3 * u * u * (p3[0] - p2[0]);
  let ty = 3 * w * w * (p1[1] - p0[1]) + 6 * w * u * (p2[1] - p1[1]) + 3 * u * u * (p3[1] - p2[1]);
  const tl = Math.hypot(tx, ty);
  if (tl < 1e-9) [tx, ty] = e;
  else [tx, ty] = [tx / tl, ty / tl];
  return { x, y, hx: tx, hy: ty };
}

/** One authoritative frame as the presenter needs it. */
export interface PresentFrame {
  tick: number;
  scenario: 0 | 1;
  world: number;
  /** The side's timeline epoch: a new one after any jump (seek, branch, view switch, discard, compare). */
  epoch: number;
  compare: boolean;
  vehicles: DecodedVehicles;
  tripIds: Uint32Array;
}

/** The clock state a frame arrived with. */
export interface PresentClockInput {
  running: boolean;
  multiplier: number;
  achievedTicksPerS: number;
  behind: boolean;
}

/** A car as drawn at the presentation time. */
export interface PresentedVehicle {
  tripId: number;
  /** Its record index in the newest frame (−1 if it is only in the older one: never returned). */
  record: number;
  link: number;
  /** Along-link coordinate as drawn (≤ the stop line unless moving onto `next`). */
  s: number;
  lane: number;
  /** The link it is moving onto right now, or NO_NEXT. */
  next: number;
  queued: boolean;
  pose: DrawPose;
}

/** What the clock knows about one side (A or B). */
interface ClockSide {
  /** Newest frame time (sim s), the wall time its tick first arrived, and the delay D. */
  newestT: number;
  arrivalMs: number;
  delayS: number;
  input: PresentClockInput;
}

/** Sim seconds per wall ms `P` advances at: the requested speed, or the achieved one when behind. */
function rateOf(c: PresentClockInput): number {
  const requested = c.multiplier / 1000;
  if (!c.running || !c.behind || !(c.achievedTicksPerS > 0)) return requested;
  return Math.min(requested, (c.achievedTicksPerS * DT) / 1000);
}

/** The presentation time shared by A and B while comparing. */
export class PresentationClock {
  private P = 0;
  private lastMs: number | null = null;
  private readonly sides = new Map<object, ClockSide>();

  /** Presentation sim time (s) at wall time `nowMs`. */
  at(nowMs: number): number {
    if (this.lastMs === null || this.sides.size === 0) {
      this.lastMs = nowMs;
      return this.P;
    }
    const dt = nowMs - this.lastMs;
    if (dt <= 0) return this.P;
    this.lastMs = nowMs;
    let rate = Infinity;
    let target = Infinity;
    let ceil = Infinity;
    for (const s of this.sides.values()) {
      const r = rateOf(s.input);
      rate = Math.min(rate, r);
      ceil = Math.min(ceil, s.newestT);
      const t = s.input.running ? Math.min(s.newestT, s.newestT - s.delayS + r * (nowMs - s.arrivalMs)) : s.newestT;
      target = Math.min(target, t);
    }
    const ideal = this.P + rate * dt;
    // steer towards the target: never backwards, at most 1.5 × rate (catch-up)
    const corr = Math.min(Math.max(target - ideal, -rate * dt), 0.5 * rate * dt);
    this.P = Math.max(this.P, Math.min(ideal + corr, ceil));
    return this.P;
  }

  /** @internal A side's newest frame (a new tick or a repeat of it). */
  frame(side: object, tick: number, nowMs: number, input: PresentClockInput): void {
    const T = tick * DT;
    const s = this.sides.get(side);
    if (!s) {
      this.sides.set(side, { newestT: T, arrivalMs: nowMs, delayS: DT, input });
      return;
    }
    if (T > s.newestT) {
      s.delayS = Math.min(4 * DT, Math.max(DT, T - s.newestT));
      s.newestT = T;
      s.arrivalMs = nowMs;
    } else if (!s.input.running && input.running) {
      s.arrivalMs = nowMs; // resumed on the same tick: the target restarts from here
    }
    s.input = input;
  }

  /** @internal A side starts over at `tick` (history reset): `P` restarts at its frame. */
  reset(side: object, tick: number, nowMs: number, input: PresentClockInput): void {
    this.sides.set(side, { newestT: tick * DT, arrivalMs: nowMs, delayS: DT, input });
    let ceil = Infinity;
    for (const s of this.sides.values()) ceil = Math.min(ceil, s.newestT);
    this.P = ceil;
    this.lastMs = nowMs;
  }

  /** @internal The side stops taking part (its renderer is gone). */
  drop(side: object): void {
    this.sides.delete(side);
  }
}

/** A retained frame: its own copy of what the presenter needs (the transferred buffer goes back to the pool). */
interface Kept {
  tick: number;
  T: number;
  link: Uint32Array;
  s: Float32Array;
  lane: Uint8Array;
  queued: Uint8Array;
  trip: Uint32Array;
  index: Map<number, number>;
}

/** A transition path A → B: poses sampled along a nominal parameter, with their cumulative drawn length. */
interface Path {
  a: number;
  b: number;
  sA: number;
  sB: number;
  laneA: number;
  laneB: number;
  /** Whether the lane is blended (the newer lane differs from min(laneA, B.lanes − 1)). */
  blend: boolean;
  /** Nominal parameter split: A straight + curve up to `tCurveEnd`, then B. */
  tStop: number;
  tCurveEnd: number;
  cum: Float64Array;
}

const PATH_SAMPLES = 48;
/**
 * Frames kept at most. `advance` (once per animation frame) trims the history; without animation frames
 * (a hidden tab) pushes would pile up, so beyond this the history starts over at the newest frame. The
 * presentation never needs that many: it trails by ≤ 4·DT, plus a catch-up after a stall (Red r6 modelled
 * ≤ 48 frames at 60× after a 1 s worker stall). 128 frames hold ≈ 10 MB at 6,000 cars.
 */
const MAX_KEPT = 128;

export class Presenter {
  private readonly clock: PresentationClock;
  private readonly C: Clearances;
  private frames: Kept[] = [];
  private key: { scenario: number; world: number; epoch: number; compare: boolean } | null = null;
  private P = 0;
  private pair: [number, number] = [-1, -1];
  private paths = new Map<number, Path | null>();

  constructor(
    private readonly links: readonly LinkGeom[],
    private readonly linkFrom: ArrayLike<number>,
    private readonly linkTo: ArrayLike<number>,
    clock?: PresentationClock,
    C?: Clearances,
  ) {
    this.clock = clock ?? new PresentationClock();
    this.C = C ?? clearances(links, linkFrom, linkTo);
  }

  /** The junction clearances this presenter draws with. */
  clearances(): Clearances {
    return this.C;
  }

  /** A frame arrived at wall time `nowMs`. */
  push(frame: PresentFrame, nowMs: number, clock: PresentClockInput): void {
    const k = this.key;
    const newest = this.frames.at(-1);
    const reset =
      !k || !newest || k.scenario !== frame.scenario || k.world !== frame.world || k.epoch !== frame.epoch || k.compare !== frame.compare || frame.tick < newest.tick;
    if (reset || this.frames.length >= MAX_KEPT) {
      this.key = { scenario: frame.scenario, world: frame.world, epoch: frame.epoch, compare: frame.compare };
      this.frames = [this.keep(frame)];
      this.clock.reset(this, frame.tick, nowMs, clock);
      this.P = frame.tick * DT;
      this.pair = [-1, -1];
      this.paths.clear();
      return;
    }
    if (frame.tick === newest.tick) {
      this.frames[this.frames.length - 1] = this.keep(frame);
      if (this.pair[1] === newest.tick) this.paths.clear(); // the same tick again: rebuild against the copy
    } else this.frames.push(this.keep(frame));
    this.clock.frame(this, frame.tick, nowMs, clock);
  }

  /** Advance to wall time `nowMs`; returns the presentation time `P` (sim seconds). */
  advance(nowMs: number): number {
    if (this.frames.length === 0) return this.P;
    this.P = this.clock.at(nowMs);
    // keep one frame at or before P, and every frame after it
    let i = 0;
    while (i + 1 < this.frames.length && this.frames[i + 1]!.T <= this.P + 1e-12) i++;
    if (i > 0) this.frames = this.frames.slice(i);
    return this.P;
  }

  /** The presentation time `P` the last `advance` returned (sim seconds). */
  time(): number {
    return this.P;
  }

  /** Forget every frame and leave the shared clock (this side shows nothing until its next frame). */
  release(): void {
    this.frames = [];
    this.key = null;
    this.pair = [-1, -1];
    this.paths.clear();
    this.clock.drop(this);
  }

  /** How far `P` trails the newest frame (sim seconds). */
  lagS(): number {
    const newest = this.frames.at(-1);
    return newest ? Math.max(0, newest.T - this.P) : 0;
  }

  /** How many frames the presenter holds (bounded by MAX_KEPT). */
  retainedFrames(): number {
    return this.frames.length;
  }

  /** Every car drawn at the current `P`. */
  vehicles(): PresentedVehicle[] {
    const newest = this.frames.at(-1);
    if (!newest) return [];
    const out: PresentedVehicle[] = [];
    for (let r = 0; r < newest.trip.length; r++) {
      const v = this.present(r);
      if (v) out.push(v);
    }
    return out;
  }

  /** The car of `tripId` as drawn at the current `P`, or null. */
  vehicle(tripId: number): PresentedVehicle | null {
    const r = this.frames.at(-1)?.index.get(tripId);
    return r === undefined ? null : this.present(r);
  }

  /** The car of record `r` of the newest frame as drawn at the current `P`, or null. */
  record(r: number): PresentedVehicle | null {
    const newest = this.frames.at(-1);
    return newest && r >= 0 && r < newest.trip.length ? this.present(r) : null;
  }

  /**
   * Writes every record's drawn pose (x, y, hx, hy) into `out` (4 floats per record of the newest frame)
   * and returns the count; a record with no pose yet gets its newest position.
   */
  writePoses(out: Float32Array): number {
    const newest = this.frames.at(-1);
    if (!newest) return 0;
    const n = Math.min(newest.trip.length, Math.floor(out.length / 4));
    for (let r = 0; r < n; r++) {
      const v = this.present(r)!;
      out[4 * r] = v.pose.x;
      out[4 * r + 1] = v.pose.y;
      out[4 * r + 2] = v.pose.hx;
      out[4 * r + 3] = v.pose.hy;
    }
    return n;
  }

  private keep(f: PresentFrame): Kept {
    const n = f.vehicles.count;
    const link = new Uint32Array(n);
    const s = new Float32Array(n);
    const lane = new Uint8Array(n);
    const queued = new Uint8Array(n);
    const trip = Uint32Array.from(f.tripIds.subarray(0, n));
    const index = new Map<number, number>();
    const w = f.vehicles.words;
    const fl = f.vehicles.floats;
    for (let i = 0; i < n; i++) {
      link[i] = w[4 * i]!;
      s[i] = fl[4 * i + 1]!;
      const flags = w[4 * i + 3]!;
      lane[i] = (flags >>> FLAG_LANE_SHIFT) & 0xff;
      queued[i] = flags & 1;
      index.set(trip[i]!, i);
    }
    return { tick: f.tick, T: f.tick * DT, link, s, lane, queued, trip, index };
  }

  /** Record `r` of the newest frame at the current P. */
  private present(r: number): PresentedVehicle | null {
    const fs = this.frames;
    const newest = fs.at(-1)!;
    const trip = newest.trip[r]!;
    const queued = newest.queued[r] === 1;
    // the pair around P: fs[0] is at or before P (after advance), fs[1] after it
    const older = fs[0]!;
    const newer = fs.length > 1 ? fs[1]! : older;
    if (this.pair[0] !== older.tick || this.pair[1] !== newer.tick) {
      this.pair = [older.tick, newer.tick];
      this.paths.clear();
    }
    const j = newer.index.get(trip);
    if (j === undefined) {
      // not yet in the pair's newer frame: at its first retained position (where the next pair starts it)
      for (let k = 2; k < fs.length; k++) {
        const at = fs[k]!.index.get(trip);
        if (at !== undefined) return this.still(fs[k]!, at, r, queued);
      }
      return this.still(newest, r, r, queued);
    }
    const i = newer === older ? undefined : older.index.get(trip);
    if (i === undefined) return this.still(newer, j, r, queued);
    const alpha = Math.min(1, Math.max(0, (this.P - older.T) / (newer.T - older.T)));
    const la = older.link[i]!;
    const lb = newer.link[j]!;
    const A = this.links[la];
    const B = this.links[lb];
    if (!A || !B) return this.still(newer, j, r, queued);
    if (la === lb) {
      const s = visualS(A, this.C, older.s[i]!) + alpha * (visualS(A, this.C, newer.s[j]!) - visualS(A, this.C, older.s[i]!));
      const lane = older.lane[i]! + alpha * (newer.lane[j]! - older.lane[i]!);
      return this.made(trip, r, la, s, lane, NO_NEXT, queued);
    }
    if (this.linkFrom[lb] !== this.linkTo[la]) {
      // more than one link in one frame: placed directly, no fabricated path
      return alpha > 0 ? this.still(newer, j, r, queued) : this.still(older, i, r, queued);
    }
    let path = this.paths.get(trip);
    if (path === undefined) {
      path = this.path(la, older.s[i]!, older.lane[i]!, lb, newer.s[j]!, newer.lane[j]!);
      this.paths.set(trip, path);
    }
    if (!path) return this.still(newer, j, r, queued);
    return this.along(path, alpha, trip, r, queued);
  }

  private still(f: Kept, i: number, r: number, queued: boolean): PresentedVehicle | null {
    const l = this.links[f.link[i]!];
    if (!l) return null;
    return this.made(f.trip[i]!, r, l.id, visualS(l, this.C, f.s[i]!), f.lane[i]!, NO_NEXT, queued);
  }

  private made(tripId: number, record: number, link: number, s: number, lane: number, next: number, queued: boolean): PresentedVehicle {
    // on A or the curve the lane may exceed A's (blending into a lane of B); visualPose clamps per link
    const l = this.links[link]!;
    const ln = next === NO_NEXT ? Math.min(Math.max(lane, 0), l.lanes - 1) : Math.max(lane, 0);
    return { tripId, record, link, s, lane: ln, next, queued, pose: visualPose(this.links, this.C, link, s, ln, next) };
  }

  /** Presented (link, ŝ, lane, next) at nominal parameter t ∈ [0, 1] of `p`. */
  private at(p: Path, t: number): { link: number; s: number; lane: number; next: number } {
    const lane = p.blend ? p.laneA + t * (p.laneB - p.laneA) : t < p.tCurveEnd ? p.laneA : p.laneB;
    if (t < p.tCurveEnd || p.tCurveEnd >= 1) {
      const A = this.links[p.a]!;
      const stop = stopLine(A, this.C);
      const s = t <= p.tStop ? p.sA + (p.tStop > 0 ? (t / p.tStop) * (stop - p.sA) : 0) : stop + ((t - p.tStop) / (p.tCurveEnd - p.tStop)) * (A.length - stop);
      return { link: p.a, s: Math.min(s, A.length), lane, next: p.b };
    }
    const B = this.links[p.b]!;
    const e = this.C.start[p.b]!;
    return { link: p.b, s: e + ((t - p.tCurveEnd) / (1 - p.tCurveEnd)) * (p.sB - e), lane: Math.min(lane, B.lanes - 1), next: NO_NEXT };
  }

  private poseAt(p: Path, t: number): DrawPose {
    const q = this.at(p, t);
    return visualPose(this.links, this.C, q.link, q.s, q.lane, q.next);
  }

  private path(a: number, sOld: number, laneOld: number, b: number, sNew: number, laneNew: number): Path | null {
    const A = this.links[a]!;
    const B = this.links[b]!;
    const sA = visualS(A, this.C, sOld);
    const sB = visualS(B, this.C, sNew);
    const stop = stopLine(A, this.C);
    const laneA = Math.min(laneOld, A.lanes - 1);
    const laneB = Math.min(laneNew, B.lanes - 1);
    // nominal lengths: A straight, the curve (its chord as an estimate), B straight
    const p0 = vehiclePosition(A, stop, laneA);
    const p3 = vehiclePosition(B, this.C.start[b]!, Math.min(laneA, B.lanes - 1));
    const l1 = Math.max(0, stop - sA);
    const lc = Math.max(1e-3, Math.hypot(p3[0] - p0[0], p3[1] - p0[1]));
    const l2 = Math.max(0, sB - this.C.start[b]!);
    const total = l1 + lc + l2;
    const p: Path = {
      a,
      b,
      sA,
      sB,
      laneA,
      laneB,
      blend: laneB !== Math.min(laneA, B.lanes - 1),
      tStop: l1 / total,
      tCurveEnd: (l1 + lc) / total,
      cum: new Float64Array(PATH_SAMPLES + 1),
    };
    let prev = this.poseAt(p, 0);
    for (let k = 1; k <= PATH_SAMPLES; k++) {
      const q = this.poseAt(p, k / PATH_SAMPLES);
      p.cum[k] = p.cum[k - 1]! + Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
    return p;
  }

  /** The car at share `alpha` of the drawn length of `p` (uniform along the drawn path). */
  private along(p: Path, alpha: number, tripId: number, record: number, queued: boolean): PresentedVehicle {
    const total = p.cum[PATH_SAMPLES]!;
    let t = alpha;
    if (total > 0) {
      const want = alpha * total;
      let k = 0;
      while (k < PATH_SAMPLES && p.cum[k + 1]! < want) k++;
      const seg = p.cum[Math.min(k + 1, PATH_SAMPLES)]! - p.cum[k]!;
      t = (k + (seg > 0 ? Math.min(1, (want - p.cum[k]!) / seg) : 0)) / PATH_SAMPLES;
    }
    const q = this.at(p, Math.min(1, Math.max(0, t)));
    return this.made(tripId, record, q.link, q.s, q.lane, q.next, queued);
  }
}
