// Ward motion-004: city character (render side only). District kinds and their styles, zone pad shapes,
// road classes and the decor palette. Pure data and geometry, no GL: the renderer and the decor builders
// read it, so every decor colour has one home and stays darker than the darkest road.
import type { Landmarks, NetworkArrays, ZoneInfo } from '../../sim/protocol';

export const DISTRICT_KINDS = ['residential', 'workplace', 'hospital', 'waterfront'] as const;
export type DistrictKind = (typeof DISTRICT_KINDS)[number];
export type RGB = [number, number, number];

interface DistrictStyle {
  fill: RGB;
  outline: RGB;
  mark: 'ridge' | 'court' | 'cross' | 'quay';
  markColor: RGB;
}

/** A cool grey of luminance v (the blue lift is balanced by the red drop, so lum stays v). */
const grey = (v: number): RGB => [v - 0.01, v, v + 0.0294];

/**
 * Kinds differ by roof mark first (shape), by fill lightness second (≥ 0.03 apart); never by hue.
 * The lightest mark stays below lum(ROAD_BASE.local) − 0.06, so decor never competes with a road.
 */
export const DISTRICT_STYLE: Record<DistrictKind, DistrictStyle> = {
  residential: { fill: grey(0.078), outline: grey(0.184), mark: 'ridge', markColor: grey(0.123) },
  workplace: { fill: grey(0.109), outline: grey(0.184), mark: 'court', markColor: grey(0.154) },
  hospital: { fill: grey(0.14), outline: grey(0.184), mark: 'cross', markColor: grey(0.185) },
  waterfront: { fill: grey(0.17), outline: grey(0.184), mark: 'quay', markColor: grey(0.2055) },
};

/** Roof marks are drawn from this zoom (px/m) with lines of MARK_LINE_PX on screen. */
export const MARK_MIN_ZOOM = 1;
export const MARK_LINE_PX = 2;
/**
 * Mark geometry as fractions of the building box (ward motion-004):
 * ridge: a centre line along the long side over RIDGE_SPAN of it; court: an inner rectangle outline with
 * its sides at COURT_AT; cross: two centred arms over CROSS_SPAN of their sides; quay: two lines along the
 * long side at QUAY_AT of the short side, over QUAY_SPAN of the long side.
 */
export const MARK_GEOMETRY = { RIDGE_SPAN: 0.7, COURT_AT: [0.2, 0.8], CROSS_SPAN: 0.6, QUAY_AT: [1 / 3, 2 / 3], QUAY_SPAN: 0.8 } as const;

type Box = [number, number, number, number];

/** The mark's line rectangles (world m) for a building box; `half` is half the line width in metres. */
export function markRects(kind: DistrictKind, [x0, y0, x1, y1]: Box, half: number): Box[] {
  const { RIDGE_SPAN, COURT_AT, CROSS_SPAN, QUAY_AT, QUAY_SPAN } = MARK_GEOMETRY;
  const [w, h] = [x1 - x0, y1 - y0];
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const longX = w >= h;
  // a line along x at y (from xa to xb), or along y at x
  const alongX = (y: number, xa: number, xb: number): Box => [xa, y - half, xb, y + half];
  const alongY = (x: number, ya: number, yb: number): Box => [x - half, ya, x + half, yb];
  switch (DISTRICT_STYLE[kind].mark) {
    case 'ridge':
      return [longX ? alongX(cy, cx - (RIDGE_SPAN * w) / 2, cx + (RIDGE_SPAN * w) / 2) : alongY(cx, cy - (RIDGE_SPAN * h) / 2, cy + (RIDGE_SPAN * h) / 2)];
    case 'court': {
      const [ax, bx] = [x0 + COURT_AT[0] * w, x0 + COURT_AT[1] * w];
      const [ay, by] = [y0 + COURT_AT[0] * h, y0 + COURT_AT[1] * h];
      return [alongX(ay, ax - half, bx + half), alongX(by, ax - half, bx + half), alongY(ax, ay - half, by + half), alongY(bx, ay - half, by + half)];
    }
    case 'cross':
      return [alongX(cy, cx - (CROSS_SPAN * w) / 2, cx + (CROSS_SPAN * w) / 2), alongY(cx, cy - (CROSS_SPAN * h) / 2, cy + (CROSS_SPAN * h) / 2)];
    case 'quay':
      return longX
        ? QUAY_AT.map((f) => alongX(y0 + f * h, cx - (QUAY_SPAN * w) / 2, cx + (QUAY_SPAN * w) / 2))
        : QUAY_AT.map((f) => alongY(x0 + f * w, cy - (QUAY_SPAN * h) / 2, cy + (QUAY_SPAN * h) / 2));
  }
}

type PadShape = 'disc' | 'square' | 'cross';
export const PAD_SHAPE: Record<ZoneInfo['kind'], PadShape> = {
  residential: 'disc',
  workplace: 'square',
  hospital: 'cross',
};
/** Pad size: a disc of radius PAD_RADIUS_M (24-gon), a square of side 2·PAD_RADIUS_M, a cross of arms 30 m wide. */
export const PAD_RADIUS_M = 45;
const PAD_ARM_HALF_M = 15;

/** Push the triangles (x, y per vertex) of a zone pad of `kind` centred on (cx, cy). */
export function padTriangles(out: number[], kind: ZoneInfo['kind'], cx: number, cy: number): void {
  const r = PAD_RADIUS_M;
  const quad = (x0: number, y0: number, x1: number, y1: number) => out.push(x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1);
  switch (PAD_SHAPE[kind]) {
    case 'disc':
      for (let i = 0; i < 24; i++) {
        const a0 = (2 * Math.PI * i) / 24;
        const a1 = (2 * Math.PI * (i + 1)) / 24;
        out.push(cx, cy, cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a1), cy + r * Math.sin(a1));
      }
      return;
    case 'square':
      quad(cx - r, cy - r, cx + r, cy + r);
      return;
    case 'cross': {
      const a = PAD_ARM_HALF_M;
      quad(cx - r, cy - a, cx + r, cy + a);
      quad(cx - a, cy - r, cx + a, cy - a);
      quad(cx - a, cy + a, cx + a, cy + r);
    }
  }
}

/** A zone kind's code in DISTRICT_KINDS (zones are never waterfront). */
export const kindCode = (kind: ZoneInfo['kind']): number => DISTRICT_KINDS.indexOf(kind);

type RoadClass = 'major' | 'local';
/** Minimum drawn width (CSS px): at fit zoom both directions of a road merge into one band per class. */
export const ROAD_MIN_PX: Record<RoadClass, number> = { major: 5.5, local: 2.5 };
export const ROAD_BASE: Record<RoadClass, RGB> = { major: [0.31, 0.335, 0.37], local: [0.24, 0.27, 0.31] };

const PALETTE = {
  water: [0.075, 0.18, 0.27],
  bank: [0.11, 0.14, 0.16],
  park: [0.085, 0.115, 0.1],
  outline: [0.16, 0.18, 0.21],
  pad: [0.14, 0.16, 0.19],
  quay: [0.125, 0.135, 0.15],
  bollard: [0.19, 0.19, 0.19],
  railingEdge: [0.02, 0.022, 0.025],
  deck: [0.17, 0.185, 0.21],
  railing: [0.42, 0.44, 0.47],
} satisfies Record<string, RGB>;
/** Every decor colour the renderer uses. Deck and railing are bridge structure, not bounded below. */
export const DECOR_COLORS: Record<string, RGB> & typeof PALETTE = PALETTE;
const UNBOUNDED = new Set(['deck', 'railing']);

const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The lightest decor colour (bounded keys and every district colour): ≤ lum(ROAD_BASE.local) − 0.06. */
export const DECOR_MAX_LUM = Math.max(
  ...Object.entries(DECOR_COLORS)
    .filter(([k]) => !UNBOUNDED.has(k))
    .map(([, c]) => lum(c as RGB)),
  ...DISTRICT_KINDS.flatMap((k) => [DISTRICT_STYLE[k].fill, DISTRICT_STYLE[k].outline, DISTRICT_STYLE[k].markColor].map(lum)),
);

/** Major: arterial speed (≥ 13.9 m/s) or a landmark bridge; local otherwise (zone connectors are streets). */
export function roadClass(network: NetworkArrays, landmarks: Landmarks, link: number): RoadClass {
  if (network.linkSpeed[link]! >= 13.9 - 1e-3) return 'major';
  const bridges = [landmarks.north_bridge, landmarks.central_bridge, landmarks.south_bridge];
  return bridges.some((pair) => pair.includes(link)) ? 'major' : 'local';
}

/** 1 per major link, 0 per local one, in link order. */
export function roadMajorFlags(network: NetworkArrays, landmarks: Landmarks): Uint8Array {
  return Uint8Array.from({ length: network.linkFrom.length }, (_, l) => (roadClass(network, landmarks, l) === 'major' ? 1 : 0));
}
