import type { ReadyMessage } from '../../sim/protocol';
import type { RoadGeometry } from '../geometry';
import { LABEL_ICONS, riverCityDecor, type CityDecor } from './riverCity';

export type { CityDecor, CityLabel } from './riverCity';

const PAD_RADIUS_M = 45;
const MARGIN_M = 2000;

/** The look of the city the worker built: River City's own, or a generic one (straight corridor, pads). */
export function cityDecor(ready: Pick<ReadyMessage, 'city' | 'network' | 'landmarks' | 'zones' | 'river'>, geometry: RoadGeometry): CityDecor {
  if (ready.city === 'river_city') return riverCityDecor(ready.network, geometry, ready.landmarks, ready.zones, ready.river);
  return genericDecor(ready, geometry);
}

function genericDecor(ready: Pick<ReadyMessage, 'network' | 'zones' | 'river'>, geometry: RoadGeometry): CityDecor {
  const [west, east] = ready.river;
  const b = geometry.bounds;
  const [y0, y1] = [b.minY - MARGIN_M, b.maxY + MARGIN_M];
  const water = east > west ? [west, y0, east, y0, east, y1, west, y0, east, y1, west, y1] : [];
  const profile = [];
  if (east > west) for (let y = y0; y <= y1 + 1e-9; y += 50) profile.push({ y, x0: west, x1: east });
  const xy = ready.network.nodeXy;
  const pads: number[] = [];
  for (const z of ready.zones) {
    const [cx, cy] = [xy[2 * z.node]!, xy[2 * z.node + 1]!];
    for (let i = 0; i < 24; i++) {
      const a0 = (2 * Math.PI * i) / 24;
      const a1 = (2 * Math.PI * (i + 1)) / 24;
      pads.push(cx, cy, cx + PAD_RADIUS_M * Math.cos(a0), cy + PAD_RADIUS_M * Math.sin(a0), cx + PAD_RADIUS_M * Math.cos(a1), cy + PAD_RADIUS_M * Math.sin(a1));
    }
  }
  return {
    water: new Float32Array(water),
    banks: new Float32Array(0),
    parks: new Float32Array(0),
    buildings: new Float32Array(0),
    bridgeDecks: new Float32Array(0),
    pads: new Float32Array(pads),
    riverProfile: profile,
    buildingBoxes: [],
    labels: ready.zones.map((z) => ({ text: z.name, kind: z.kind, icon: LABEL_ICONS[z.kind], x: xy[2 * z.node]!, y: xy[2 * z.node + 1]! })),
  };
}
