import type { Landmarks, ReadyMessage } from '../../sim/protocol';
import type { BridgeNaming } from '../../ui/consequences';
import type { RoadGeometry } from '../geometry';
import { kindCode, padTriangles, roadMajorFlags } from './character';
import { LABEL_ICONS, riverCityDecor, type CityDecor } from './riverCity';

export type { CityDecor, CityLabel } from './riverCity';

/**
 * Display names of the bridges (render-side data, ward motion-003), in landmark order (north, central,
 * south). The central one is the "Main Bridge" the control panel closes in every city; River City's
 * southern bridge is its Old Bridge.
 */
export function bridgeNaming(city: string, landmarks: Landmarks): BridgeNaming {
  const south = city === 'river_city' ? 'Old Bridge' : 'South Bridge';
  return {
    bridges: [
      { key: 'north_bridge', name: 'North Bridge', links: [...landmarks.north_bridge] },
      { key: 'central_bridge', name: 'Main Bridge', links: [...landmarks.central_bridge] },
      { key: 'south_bridge', name: south, links: [...landmarks.south_bridge] },
    ],
  };
}

const MARGIN_M = 2000;

/** The look of the city the worker built: River City's own, or a generic one (straight corridor, pads). */
export function cityDecor(ready: Pick<ReadyMessage, 'city' | 'network' | 'landmarks' | 'zones' | 'river'>, geometry: RoadGeometry): CityDecor {
  if (ready.city === 'river_city') return riverCityDecor(ready.network, geometry, ready.landmarks, ready.zones, ready.river);
  return genericDecor(ready, geometry);
}

function genericDecor(ready: Pick<ReadyMessage, 'network' | 'landmarks' | 'zones' | 'river'>, geometry: RoadGeometry): CityDecor {
  const [west, east] = ready.river;
  const b = geometry.bounds;
  const [y0, y1] = [b.minY - MARGIN_M, b.maxY + MARGIN_M];
  const water = east > west ? [west, y0, east, y0, east, y1, west, y0, east, y1, west, y1] : [];
  const profile = [];
  if (east > west) for (let y = y0; y <= y1 + 1e-9; y += 50) profile.push({ y, x0: west, x1: east });
  const xy = ready.network.nodeXy;
  const pads: number[] = [];
  for (const z of ready.zones) {
    padTriangles(pads, z.kind, xy[2 * z.node]!, xy[2 * z.node + 1]!);
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
    buildingKinds: new Uint8Array(0),
    quay: new Float32Array(0),
    quayBollardsFrom: 0,
    padKinds: Uint8Array.from(ready.zones, (z) => kindCode(z.kind)),
    roadMajor: roadMajorFlags(ready.network, ready.landmarks),
    labels: ready.zones.map((z) => ({ text: z.name, kind: z.kind, icon: LABEL_ICONS[z.kind], x: xy[2 * z.node]!, y: xy[2 * z.node + 1]! })),
  };
}
