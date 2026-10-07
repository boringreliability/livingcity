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

export function buildRoadGeometry(_network: NetworkArrays): RoadGeometry {
  throw new Error('not implemented');
}

/** World position of a vehicle at offset `s` in `lane` (lane 0 = rightmost). */
export function vehiclePosition(_link: LinkGeom, _s: number, _lane: number): [number, number] {
  throw new Error('not implemented');
}
