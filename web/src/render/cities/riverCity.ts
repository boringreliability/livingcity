import type { Landmarks, NetworkArrays, ZoneInfo } from '../../sim/protocol';
import type { RoadGeometry } from '../geometry';
import { DISTRICT_KINDS, PAD_RADIUS_M, kindCode, padTriangles, roadMajorFlags } from './character';

/**
 * River City's look (render side only; the simulation knows only the river corridor).
 * A pure function of its inputs: no randomness, the same city gives the same picture.
 */
export interface CityLabel {
  text: string;
  kind: ZoneInfo['kind'];
  icon: string;
  x: number;
  y: number;
}

export interface CityDecor {
  /** Triangles (x, y per vertex, world metres). */
  water: Float32Array;
  banks: Float32Array;
  parks: Float32Array;
  buildings: Float32Array;
  bridgeDecks: Float32Array;
  pads: Float32Array;
  /** The river's west/east edge, sampled at most every 50 m, covering all drawn water. */
  riverProfile: { y: number; x0: number; x1: number }[];
  /** Building footprints as axis-aligned boxes [x0, y0, x1, y1]; `buildings` draws exactly these. */
  buildingBoxes: [number, number, number, number][];
  labels: CityLabel[];
  /** District kind code (index into DISTRICT_KINDS) per building box (motion-004). */
  buildingKinds: Uint8Array;
  /**
   * Triangles of the paved quay strip along both water edges, then the bollards (from float index
   * `quayBollardsFrom` on; motion-004).
   */
  quay: Float32Array;
  quayBollardsFrom: number;
  /** District kind code per zone pad, in zone order (motion-004). */
  padKinds: Uint8Array;
  /** 1 per major link (arterial or landmark bridge), 0 per local street, in link order (motion-004). */
  roadMajor: Uint8Array;
}

export const LABEL_ICONS: Record<ZoneInfo['kind'], string> = { residential: '⌂', workplace: '◫', hospital: '✚' };

const PROFILE_STEP_M = 25;
/** Far beyond any fitted view, so the river never visibly starts or ends (Gold r1). */
const PROFILE_MARGIN_M = 2000;
const BANK_M = 6;
/** The quay: a paved strip this wide outside each water edge, bollards of BOLLARD_M every BOLLARD_EVERY_M. */
const QUAY_M = 10;
const BOLLARD_M = 2;
const BOLLARD_EVERY_M = 40;
const DECK_HALF_M = 20;
const ROAD_CLEARANCE_M = 4;
/** Extra keep-out around roads beyond the required clearance (looks like pavement). */
const SETBACK_M = 6;

/** Deterministic hash → [0, 1) (stable across loads; not a source of randomness). */
function hash01(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function quad(out: number[], x0: number, y0: number, x1: number, y1: number): void {
  out.push(x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1);
}

/** Distance from point (px, py) to the axis-aligned box. */
function pointBoxDistance(px: number, py: number, [x0, y0, x1, y1]: [number, number, number, number]): number {
  return Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1));
}

/** Distance from point (px, py) to the segment a→b. */
function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Exact distance from segment a→b to an axis-aligned box (0 if they intersect). */
function segmentBoxDistance(ax: number, ay: number, bx: number, by: number, box: [number, number, number, number]): number {
  const [x0, y0, x1, y1] = box;
  // Liang–Barsky clip: does the segment touch the box?
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay)) return 0;
  // otherwise the closest pair involves a segment end or a box corner
  return Math.min(
    pointBoxDistance(ax, ay, box),
    pointBoxDistance(bx, by, box),
    pointSegmentDistance(x0, y0, ax, ay, bx, by),
    pointSegmentDistance(x1, y0, ax, ay, bx, by),
    pointSegmentDistance(x1, y1, ax, ay, bx, by),
    pointSegmentDistance(x0, y1, ax, ay, bx, by),
  );
}

export function riverCityDecor(
  network: NetworkArrays,
  geometry: RoadGeometry,
  landmarks: Landmarks,
  zones: ZoneInfo[],
  river: [number, number],
): CityDecor {
  const [west, east] = river;
  const b = geometry.bounds;
  const xy = network.nodeXy;

  // River: a meandering ribbon inside the corridor (≥ 60 m wide everywhere).
  const corridor = east - west;
  const mid = (west + east) / 2;
  const profile: { y: number; x0: number; x1: number }[] = [];
  const y0 = b.minY - PROFILE_MARGIN_M;
  const y1 = b.maxY + PROFILE_MARGIN_M;
  const steps = Math.ceil((y1 - y0) / PROFILE_STEP_M);
  for (let k = 0; k <= steps; k++) {
    const y = y0 + ((y1 - y0) * k) / steps; // ≤ 25 m apart, exactly covering [y0, y1]
    const width = Math.min(corridor - 10, 70 + 8 * Math.sin(y / 380));
    const swing = (corridor - width) / 2 - 2; // keep the edges strictly inside the corridor
    const centre = mid + swing * Math.sin(y / 650) * 0.9;
    profile.push({ y, x0: centre - width / 2, x1: centre + width / 2 });
  }
  const water: number[] = [];
  const banks: number[] = [];
  for (let i = 1; i < profile.length; i++) {
    const p = profile[i - 1]!;
    const q = profile[i]!;
    water.push(p.x0, p.y, q.x0, q.y, q.x1, q.y, p.x0, p.y, q.x1, q.y, p.x1, p.y);
    banks.push(p.x0 - BANK_M, p.y, q.x0 - BANK_M, q.y, q.x0, q.y, p.x0 - BANK_M, p.y, q.x0, q.y, p.x0, p.y);
    banks.push(p.x1, p.y, q.x1, q.y, q.x1 + BANK_M, q.y, p.x1, p.y, q.x1 + BANK_M, q.y, p.x1 + BANK_M, p.y);
  }

  // Quay: a paved strip outside both water edges (over the bank), and bollards along its water side.
  const quay: number[] = [];
  for (let i = 1; i < profile.length; i++) {
    const p = profile[i - 1]!;
    const q = profile[i]!;
    quay.push(p.x0 - QUAY_M, p.y, q.x0 - QUAY_M, q.y, q.x0, q.y, p.x0 - QUAY_M, p.y, q.x0, q.y, p.x0, p.y);
    quay.push(p.x1, p.y, q.x1, q.y, q.x1 + QUAY_M, q.y, p.x1, p.y, q.x1 + QUAY_M, q.y, p.x1 + QUAY_M, p.y);
  }
  const quayBollardsFrom = quay.length;
  const edgeAt = (y: number) => {
    const k = Math.min(profile.length - 1, Math.max(1, profile.findIndex((p) => p.y >= y)));
    const [p, q] = [profile[k - 1]!, profile[k]!];
    const t = (y - p.y) / (q.y - p.y);
    return [p.x0 + t * (q.x0 - p.x0), p.x1 + t * (q.x1 - p.x1)] as const;
  };
  for (let y = profile[0]!.y + BOLLARD_EVERY_M / 2; y < profile[profile.length - 1]!.y; y += BOLLARD_EVERY_M) {
    const [x0, x1] = edgeAt(y);
    const h = BOLLARD_M / 2;
    quad(quay, x0 - 1 - BOLLARD_M, y - h, x0 - 1, y + h);
    quad(quay, x1 + 1, y - h, x1 + 1 + BOLLARD_M, y + h);
  }

  // Bridge decks: one wide deck under each two-way crossing.
  const decks: number[] = [];
  for (const pair of [landmarks.central_bridge, landmarks.north_bridge, landmarks.south_bridge]) {
    const l = geometry.links[pair[0]];
    if (!l) continue;
    const a = network.linkFrom[pair[0]]!;
    const z = network.linkTo[pair[0]]!;
    const [ax, ay, bx, by] = [xy[2 * a]!, xy[2 * a + 1]!, xy[2 * z]!, xy[2 * z + 1]!];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
    const h = DECK_HALF_M;
    const c = [ax + nx * h, ay + ny * h, bx + nx * h, by + ny * h, bx - nx * h, by - ny * h, ax - nx * h, ay - ny * h];
    decks.push(c[0]!, c[1]!, c[2]!, c[3]!, c[4]!, c[5]!, c[0]!, c[1]!, c[4]!, c[5]!, c[6]!, c[7]!);
  }

  // Zone pads and labels.
  const pads: number[] = [];
  const labels: CityLabel[] = [];
  for (const z of zones) {
    const [x, y] = [xy[2 * z.node]!, xy[2 * z.node + 1]!];
    padTriangles(pads, z.kind, x, y);
    labels.push({ text: z.name, kind: z.kind, icon: LABEL_ICONS[z.kind], x, y });
  }

  // Buildings: a grid of footprints in every block, kept clear of roads, pads and the river.
  const segs = geometry.links.map((l) => ({
    ax: xy[2 * network.linkFrom[l.id]!]!,
    ay: xy[2 * network.linkFrom[l.id]! + 1]!,
    bx: xy[2 * network.linkTo[l.id]!]!,
    by: xy[2 * network.linkTo[l.id]! + 1]!,
    // drawn centreline too (two-way pairs are drawn offset)
    dx0: l.x0,
    dy0: l.y0,
    dx1: l.x1,
    dy1: l.y1,
    half: l.width / 2,
  }));
  const zoneXY = zones.map((z) => [xy[2 * z.node]!, xy[2 * z.node + 1]!] as const);
  // distinct junction x / y values (the street grid)
  const uniq = (vs: number[]) => [...new Set(vs.map((v) => Math.round(v)))].sort((p, q) => p - q);
  const nodeXs: number[] = [];
  const nodeYs: number[] = [];
  for (let n = 0; n < network.nodeIsZone.length; n++) {
    if (network.nodeIsZone[n]) continue;
    nodeXs.push(xy[2 * n]!);
    nodeYs.push(xy[2 * n + 1]!);
  }
  const gx = uniq(nodeXs);
  const gy = uniq(nodeYs);
  // the district kind that shapes a block: the nearest zone's kind
  const kindAt = (x: number, y: number): ZoneInfo['kind'] => {
    let best = 0;
    let bd = Infinity;
    zoneXY.forEach(([zx, zy], i) => {
      const d = Math.hypot(zx - x, zy - y);
      if (d < bd) [bd, best] = [d, i];
    });
    return zones[best]?.kind ?? 'residential';
  };
  const boxes: [number, number, number, number][] = [];
  // the district kind per box: its block's zone kind, or waterfront in the grid columns next to the river's
  const kinds: number[] = [];
  const riverCol = gx.findIndex((x, i) => i > 0 && gx[i - 1]! < east && x > west);
  const parks: number[] = [];
  const clearOfRoads = (box: [number, number, number, number]) =>
    segs.every((s) => {
      const keep = s.half + ROAD_CLEARANCE_M + SETBACK_M;
      // quick reject: the segment's bounding box is far from the box
      const far =
        Math.min(s.ax, s.bx, s.dx0, s.dx1) > box[2] + keep + 20 ||
        Math.max(s.ax, s.bx, s.dx0, s.dx1) < box[0] - keep - 20 ||
        Math.min(s.ay, s.by, s.dy0, s.dy1) > box[3] + keep + 20 ||
        Math.max(s.ay, s.by, s.dy0, s.dy1) < box[1] - keep - 20;
      return (
        far ||
        (segmentBoxDistance(s.dx0, s.dy0, s.dx1, s.dy1, box) >= keep && segmentBoxDistance(s.ax, s.ay, s.bx, s.by, box) >= keep)
      );
    });
  const clearOfPads = (box: [number, number, number, number]) =>
    zoneXY.every(([zx, zy]) => pointBoxDistance(zx, zy, box) >= PAD_RADIUS_M + 8);
  for (let i = 1; i < gx.length; i++) {
    for (let j = 1; j < gy.length; j++) {
      const [bx0, bx1, by0, by1] = [gx[i - 1]!, gx[i]!, gy[j - 1]!, gy[j]!];
      if (bx0 < east && bx1 > west) continue; // the river block
      const kind = kindAt((bx0 + bx1) / 2, (by0 + by1) / 2);
      // one park block in about every seven, by a stable hash
      if (hash01(bx0, by0) < 0.14) {
        const m = 24;
        const park: [number, number, number, number] = [bx0 + m, by0 + m, bx1 - m, by1 - m];
        if (park[2] > park[0] && park[3] > park[1] && clearOfRoads(park) && clearOfPads(park)) {
          quad(parks, ...park);
          continue;
        }
      }
      const cell = kind === 'residential' ? 46 : 74;
      const margin = 22;
      const ring = kind === 'residential' ? 2 : 1; // rows of buildings along each street; courtyards inside
      for (let x = bx0 + margin; x + cell <= bx1 - margin + 1e-9; x += cell) {
        for (let y = by0 + margin; y + cell <= by1 - margin + 1e-9; y += cell) {
          const fromEdge = Math.min(x - bx0 - margin, bx1 - margin - (x + cell), y - by0 - margin, by1 - margin - (y + cell));
          if (fromEdge >= ring * cell) continue;
          const h = hash01(x, y);
          if (h < 0.12) continue; // a gap now and then (yards, plazas)
          const fill = kind === 'residential' ? 0.55 + 0.25 * h : 0.6 + 0.3 * h;
          const w = Math.max(8, cell * fill);
          const d = Math.max(8, cell * (0.5 + 0.35 * hash01(y, x)));
          const box: [number, number, number, number] = [x + (cell - w) / 2, y + (cell - d) / 2, x + (cell + w) / 2, y + (cell + d) / 2];
          if (box[2] > b.maxX || box[0] < b.minX || box[3] > b.maxY || box[1] < b.minY) continue;
          if (!(box[2] < west || box[0] > east)) continue;
          if (!clearOfRoads(box) || !clearOfPads(box)) continue;
          boxes.push(box);
          const riverside = i === riverCol - 1 || i === riverCol + 1;
          kinds.push(riverside && kind !== 'hospital' ? DISTRICT_KINDS.indexOf('waterfront') : kindCode(kind));
        }
      }
    }
  }
  const buildings: number[] = [];
  for (const box of boxes) quad(buildings, ...box);

  return {
    water: new Float32Array(water),
    banks: new Float32Array(banks),
    parks: new Float32Array(parks),
    buildings: new Float32Array(buildings),
    bridgeDecks: new Float32Array(decks),
    pads: new Float32Array(pads),
    riverProfile: profile,
    buildingBoxes: boxes,
    labels,
    buildingKinds: new Uint8Array(kinds),
    quay: new Float32Array(quay),
    quayBollardsFrom,
    padKinds: Uint8Array.from(zones, (z) => kindCode(z.kind)),
    roadMajor: roadMajorFlags(network, landmarks),
  };
}
