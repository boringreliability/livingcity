import type { NetworkArrays } from '../sim/protocol';
import type { Bounds } from './geometry';

/** Purely visual city data (render side). Static: nothing animates in core-005. */
export interface Decor {
  /** Triangles: x, y per vertex (world m). */
  water: Float32Array;
  /** Triangles for zone pads. */
  pads: Float32Array;
}

/** The three-bridges river runs north–south along x ∈ [−60, 60] m. */
const RIVER_HALF_WIDTH_M = 60;
const PAD_RADIUS_M = 45;

function rect(x0: number, y0: number, x1: number, y1: number): number[] {
  return [x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1];
}

function disc(cx: number, cy: number, r: number, segments = 24): number[] {
  const out: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (2 * Math.PI * i) / segments;
    const a1 = (2 * Math.PI * (i + 1)) / segments;
    out.push(cx, cy, cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a1), cy + r * Math.sin(a1));
  }
  return out;
}

export function threeBridgesDecor(network: NetworkArrays, bounds: Bounds): Decor {
  const margin = 2000;
  const water = rect(-RIVER_HALF_WIDTH_M, bounds.minY - margin, RIVER_HALF_WIDTH_M, bounds.maxY + margin);
  const pads: number[] = [];
  for (let n = 0; n < network.nodeIsZone.length; n++) {
    if (network.nodeIsZone[n]) pads.push(...disc(network.nodeXy[2 * n]!, network.nodeXy[2 * n + 1]!, PAD_RADIUS_M));
  }
  return { water: new Float32Array(water), pads: new Float32Array(pads) };
}
