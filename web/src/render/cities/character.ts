// Ward motion-004: city character (render side only). District kinds, their styles, road classes and
// the decor palette. RED STUB: values are placeholders until Gold.
import type { Landmarks, NetworkArrays } from '../../sim/protocol';

export const DISTRICT_KINDS = ['residential', 'workplace', 'hospital', 'waterfront'] as const;
export type DistrictKind = (typeof DISTRICT_KINDS)[number];
export type RGB = [number, number, number];


export interface DistrictStyle {
  fill: RGB;
  outline: RGB;
  mark: 'ridge' | 'court' | 'cross' | 'quay';
  markColor: RGB;
}

const GREY: RGB = [0.09, 0.1, 0.12];
export const DISTRICT_STYLE: Record<DistrictKind, DistrictStyle> = {
  residential: { fill: GREY, outline: GREY, mark: 'ridge', markColor: GREY },
  workplace: { fill: GREY, outline: GREY, mark: 'ridge', markColor: GREY },
  hospital: { fill: GREY, outline: GREY, mark: 'ridge', markColor: GREY },
  waterfront: { fill: GREY, outline: GREY, mark: 'ridge', markColor: GREY },
};

export const PAD_SHAPE: Record<'residential' | 'workplace' | 'hospital', 'disc' | 'square' | 'cross'> = {
  residential: 'disc',
  workplace: 'disc',
  hospital: 'disc',
};

export type RoadClass = 'major' | 'local';
export const ROAD_MIN_PX: Record<RoadClass, number> = { major: 2.5, local: 2.5 };
export const ROAD_BASE: Record<RoadClass, RGB> = { major: [0.24, 0.27, 0.31], local: [0.24, 0.27, 0.31] };

/** Every decor colour the renderer uses (deck and railing are listed but not bounded by DECOR_MAX_LUM). */
export const DECOR_COLORS: Record<string, RGB> = {};
export const DECOR_MAX_LUM = 0;

export const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Major: arterial speed (≥ 13.9 m/s) or a landmark bridge; local otherwise. */
export function roadClass(_network: NetworkArrays, _landmarks: Landmarks, _link: number): RoadClass {
  return 'local';
}
