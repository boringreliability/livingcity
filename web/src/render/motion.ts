/**
 * Where a vehicle is drawn, and how far ahead of its frame (ward polish-003, contract P3).
 *
 * One placement rule for the CPU (tracked car, ring, Follow, picking, test hook) and the vehicle
 * vertex shader (`VEH_VS` in renderer.ts mirrors `vehicleDrawPosition` exactly). Through a junction,
 * the last `B = min(BLEND_M, length / 2)` of a link curve (quadratic Bézier) onto the next link's
 * start, so a car never jumps between the right-shifted drawn centrelines of two links.
 */
import { DT } from '../sim/protocol';
import { vehiclePosition, type LinkGeom } from './geometry';

/** Blend zone at a link's end (m). */
export const BLEND_M = 6;
/** No next link (final link, stranded, or unknown); mirrors `NO_NEXT_LINK` in protocol.ts. */
export const NO_NEXT = 0xffff;

/** World position (m) and unit heading of a drawn vehicle. */
export interface DrawPose {
  x: number;
  y: number;
  hx: number;
  hy: number;
}

const dirOf = (l: LinkGeom): [number, number] => {
  const dx = l.x1 - l.x0;
  const dy = l.y1 - l.y0;
  const d = Math.hypot(dx, dy) || 1;
  return [dx / d, dy / d];
};

/** Length of the blend zone of `l`. */
const blendLength = (l: LinkGeom): number => Math.min(BLEND_M, l.length / 2);

/** Whether a vehicle at `s` on `link` with `next` is drawn on the junction curve. */
export function inBlend(links: readonly LinkGeom[], link: number, s: number, next: number): boolean {
  const l = links[link];
  return !!l && next !== NO_NEXT && !!links[next] && s > l.length - blendLength(l);
}

/**
 * The control point of the junction curve from `p0` (heading `d`) to `p2` (heading `e`): where the two
 * lane lines meet, if that lies ahead of p0, behind p2 and within |p2 − p0| of both; otherwise a point
 * behind p2 along e, so the curve always arrives heading along the next link.
 */
function controlPoint(p0: [number, number], d: [number, number], p2: [number, number], e: [number, number]): [number, number] {
  const rx = p2[0] - p0[0];
  const ry = p2[1] - p0[1];
  const chord = Math.hypot(rx, ry);
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) > 1e-9) {
    // p0 + t·d = p2 + u·e
    const t = (rx * e[1] - ry * e[0]) / den;
    const u = (rx * d[1] - ry * d[0]) / den;
    if (t > 0 && u < 0 && t <= chord && -u <= chord) return [p0[0] + t * d[0], p0[1] + t * d[1]];
  }
  return [p2[0] - (e[0] * chord) / 2, p2[1] - (e[1] * chord) / 2];
}

/** Where a vehicle at `s` in `lane` of `link`, heading for `next` (or NO_NEXT), is drawn. */
export function vehicleDrawPosition(links: readonly LinkGeom[], link: number, s: number, lane: number, next: number): DrawPose {
  const l = links[link]!;
  const d = dirOf(l);
  const n = next !== NO_NEXT ? links[next] : undefined;
  const b = blendLength(l);
  if (!n || s <= l.length - b) {
    const [x, y] = vehiclePosition(l, s, lane);
    return { x, y, hx: d[0], hy: d[1] };
  }
  const p0 = vehiclePosition(l, l.length - b, lane);
  const p2 = vehiclePosition(n, 0, Math.min(lane, n.lanes - 1));
  const e = dirOf(n);
  const c = controlPoint(p0, d, p2, e);
  const u = Math.min(1, Math.max(0, (s - (l.length - b)) / b));
  const a = (1 - u) * (1 - u);
  const m = 2 * u * (1 - u);
  const q = u * u;
  let tx = 2 * (1 - u) * (c[0] - p0[0]) + 2 * u * (p2[0] - c[0]);
  let ty = 2 * (1 - u) * (c[1] - p0[1]) + 2 * u * (p2[1] - c[1]);
  const tl = Math.hypot(tx, ty);
  if (tl < 1e-9) [tx, ty] = e;
  else [tx, ty] = [tx / tl, ty / tl];
  return { x: a * p0[0] + m * c[0] + q * p2[0], y: a * p0[1] + m * c[1] + q * p2[1], hx: tx, hy: ty };
}

/**
 * The frame position advanced by `dtSim` sim seconds: `s + v·dt`, never past the link end. (The sim
 * holds cars at stop lines and stops them instantly, so running onto the next link would snap cars
 * back when the next frame arrives; with a next link, the end is the next link's start anyway.)
 */
export function extrapolate(links: readonly LinkGeom[], link: number, s: number, v: number, dtSim: number, next: number): { link: number; s: number } {
  void next;
  const l = links[link]!;
  return { link, s: Math.min(s + v * dtSim, l.length) };
}

/**
 * How far (sim seconds) the drawn picture runs ahead of the last frame. Restarts at 0 on a frame with a
 * new tick and on resume; 0 while paused. A rate change (speed, behind) re-bases the anchor so the value
 * is continuous (no backward step); the value is capped at 1.5 × the expected advance between frames
 * (the tick delta of the last two new-tick frames × DT; 2 s until known), so a stall cannot run ahead.
 */
export class ExtrapolationClock {
  private running = false;
  private tick: number | null = null;
  private anchorMs = 0;
  private baseS = 0;
  private rate: number | null = null;
  private advanceS: number | null = null;

  frame(nowMs: number, tick: number | undefined, running: boolean): void {
    if (!running) {
      this.running = false;
      return;
    }
    const resumed = !this.running;
    this.running = true;
    if (resumed || tick === undefined || tick !== this.tick) {
      if (!resumed && tick !== undefined && this.tick !== null && tick > this.tick) this.advanceS = (tick - this.tick) * DT;
      this.tick = tick ?? null;
      this.anchorMs = nowMs;
      this.baseS = 0;
      // a new anchor: the next `at` adopts its rate (a rate from before a pause must not apply to the
      // time since this frame — that ran cars ahead to the cap right after Play)
      this.rate = null;
    }
  }

  at(nowMs: number, simSecondsPerMs: number): number {
    if (!this.running) return 0;
    if (this.rate !== simSecondsPerMs) {
      if (this.rate !== null) this.baseS += (nowMs - this.anchorMs) * this.rate;
      this.anchorMs = nowMs;
      this.rate = simSecondsPerMs;
    }
    const cap = this.advanceS === null ? 2 : 1.5 * this.advanceS;
    return Math.max(0, Math.min(cap, this.baseS + (nowMs - this.anchorMs) * simSecondsPerMs));
  }
}
