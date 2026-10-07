import type { NetworkArrays } from '../sim/protocol';

export const LANE_WIDTH_M = 3.5;
export const MEDIAN_GAP_M = 1.0;

/** A link as drawn: world metres, y up. */
export interface LinkGeom {
  id: number;
  /** Drawn centerline (shifted to the right for two-way pairs). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Unit right-hand normal of the travel direction: (dy, −dx)/|d|. */
  nx: number;
  ny: number;
  /** lanes × LANE_WIDTH_M */
  width: number;
  lanes: number;
  /** Simulation length (m), used to map s → position. */
  length: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RoadGeometry {
  links: LinkGeom[];
  bounds: Bounds;
}

export function buildRoadGeometry(network: NetworkArrays): RoadGeometry {
  const { nodeXy, linkFrom, linkTo, linkLanes, linkLength } = network;
  const pairs = new Set<string>();
  for (let i = 0; i < linkFrom.length; i++) pairs.add(`${linkFrom[i]}-${linkTo[i]}`);

  const links: LinkGeom[] = [];
  for (let i = 0; i < linkFrom.length; i++) {
    const a = linkFrom[i]!;
    const b = linkTo[i]!;
    const ax = nodeXy[2 * a]!;
    const ay = nodeXy[2 * a + 1]!;
    const bx = nodeXy[2 * b]!;
    const by = nodeXy[2 * b + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len;
    const ny = -dx / len;
    const lanes = linkLanes[i]!;
    const width = lanes * LANE_WIDTH_M;
    // A two-way pair keeps right: each direction moves off the node line.
    const offset = pairs.has(`${b}-${a}`) ? width / 2 + MEDIAN_GAP_M / 2 : 0;
    links.push({
      id: i,
      x0: ax + nx * offset,
      y0: ay + ny * offset,
      x1: bx + nx * offset,
      y1: by + ny * offset,
      nx,
      ny,
      width,
      lanes,
      length: linkLength[i]!,
    });
  }

  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let n = 0; n < nodeXy.length / 2; n++) {
    const x = nodeXy[2 * n]!;
    const y = nodeXy[2 * n + 1]!;
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  return { links, bounds };
}

/** Lateral offset of a lane's centre from the drawn centerline, along +n (lane 0 = rightmost). */
export function laneOffset(lanes: number, lane: number): number {
  return ((lanes - 1) / 2 - lane) * LANE_WIDTH_M;
}

/** World position of a vehicle at offset `s` in `lane` (lane 0 = rightmost). */
export function vehiclePosition(link: LinkGeom, s: number, lane: number): [number, number] {
  const t = Math.min(1, Math.max(0, s / link.length));
  const lat = laneOffset(link.lanes, lane);
  return [link.x0 + (link.x1 - link.x0) * t + link.nx * lat, link.y0 + (link.y1 - link.y0) * t + link.ny * lat];
}
