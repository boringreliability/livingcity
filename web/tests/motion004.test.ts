// Ward motion-004: city character (render side). Tests 1–4: district kinds, district styles without hue,
// decor darker than roads, road classes.
import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { cityDecor } from '../src/render/cities';
import {
  DECOR_COLORS,
  DECOR_MAX_LUM,
  DISTRICT_KINDS,
  DISTRICT_STYLE,
  PAD_SHAPE,
  ROAD_BASE,
  ROAD_MIN_PX,
  roadClass,
  type RGB,
} from '../src/render/cities/character';
import { buildRoadGeometry } from '../src/render/geometry';
import type { Landmarks, NetworkArrays, ZoneInfo } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

/** A city as the worker exports it, and its decor. */
function city(name: 'river_city' | 'three_bridges') {
  loadWasm();
  const sim = name === 'river_city' ? Sim.river_city(2026, 7) : Sim.three_bridges(2026, 7);
  const network: NetworkArrays = {
    nodeXy: sim.node_xy(),
    nodeIsZone: sim.node_is_zone(),
    linkFrom: sim.link_from(),
    linkTo: sim.link_to(),
    linkLanes: sim.link_lanes(),
    linkLength: sim.link_length(),
    linkSpeed: sim.link_speed(),
    linkSatFlow: sim.link_sat_flow(),
  };
  const landmarks = JSON.parse(sim.landmarks_json()) as Landmarks;
  const zones = JSON.parse(sim.zones_json()) as ZoneInfo[];
  const r = Array.from(sim.river());
  const river: [number, number] = [r[0]!, r[1]!];
  const geometry = buildRoadGeometry(network);
  const decor = () => cityDecor({ city: name, network, landmarks, zones, river }, geometry);
  return { network, landmarks, zones, river, decor };
}

const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// 1
test('building_kinds_cover_the_city', () => {
  const c = city('river_city');
  const d = c.decor();
  expect(d.buildingKinds.length).toBe(d.buildingBoxes.length);
  expect(d.buildingBoxes.length).toBeGreaterThan(200);
  // blocks recomputed independently: grid cells between distinct non-zone junction coordinates
  const xy = c.network.nodeXy;
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (let n = 0; n < c.network.nodeIsZone.length; n++) {
    if (c.network.nodeIsZone[n]) continue;
    xs.add(Math.round(xy[2 * n]!));
    ys.add(Math.round(xy[2 * n + 1]!));
  }
  const gx = [...xs].sort((a, b) => a - b);
  const gy = [...ys].sort((a, b) => a - b);
  const cell = (g: number[], v: number) => g.findIndex((x, k) => k > 0 && g[k - 1]! <= v && v < x);
  const [west, east] = c.river;
  const riverColumn = gx.findIndex((x, k) => k > 0 && gx[k - 1]! < east && x > west);
  expect(riverColumn, 'the column holding the river').toBeGreaterThan(1);
  const zoneAt = c.zones.map((z) => [xy[2 * z.node]!, xy[2 * z.node + 1]!] as const);
  const blockOf = (box: [number, number, number, number]) => {
    const [cx, cy] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const i = cell(gx, cx);
    const j = cell(gy, cy);
    expect(i, 'box inside a grid block').toBeGreaterThan(0);
    expect(j, 'box inside a grid block').toBeGreaterThan(0);
    const [bx, by] = [(gx[i - 1]! + gx[i]!) / 2, (gy[j - 1]! + gy[j]!) / 2];
    let best = 0;
    let bd = Infinity;
    zoneAt.forEach(([zx, zy], k) => {
      const dd = Math.hypot(zx - bx, zy - by);
      if (dd < bd) [bd, best] = [dd, k];
    });
    return { kind: c.zones[best]!.kind, riverside: i === riverColumn - 1 || i === riverColumn + 1 };
  };
  const counts = [0, 0, 0, 0];
  d.buildingBoxes.forEach((box, k) => {
    const code = d.buildingKinds[k]!;
    expect(code).toBeLessThan(4);
    counts[code]!++;
    const kind = DISTRICT_KINDS[code];
    const block = blockOf(box);
    if (block.riverside && block.kind !== 'hospital') expect(kind, `box ${k} (riverside block)`).toBe('waterfront');
    else expect(kind, `box ${k}: its block's kind`).toBe(block.kind);
  });
  const [res, work, hosp, water] = counts as [number, number, number, number];
  expect(res, 'residential boxes').toBeGreaterThanOrEqual(20);
  expect(work, 'workplace boxes').toBeGreaterThanOrEqual(20);
  expect(water, 'waterfront boxes').toBeGreaterThanOrEqual(20);
  expect(hosp, 'hospital boxes').toBeGreaterThanOrEqual(4);
  // deterministic
  expect(Array.from(c.decor().buildingKinds)).toEqual(Array.from(d.buildingKinds));
  // pads carry their zone's kind
  expect(Array.from(d.padKinds)).toEqual(c.zones.map((z) => DISTRICT_KINDS.indexOf(z.kind)));
  // pads are drawn in their kind's shape (Red r1 m3): area ÷ bounding-box area per zone's pad
  const padShape = (pads: Float32Array, cx: number, cy: number) => {
    let area = 0;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let t = 0; t < pads.length; t += 6) {
      const [ax, ay, bx, by, qx, qy] = [pads[t]!, pads[t + 1]!, pads[t + 2]!, pads[t + 3]!, pads[t + 4]!, pads[t + 5]!];
      if (Math.hypot((ax + bx + qx) / 3 - cx, (ay + by + qy) / 3 - cy) > 60) continue;
      area += Math.abs((bx - ax) * (qy - ay) - (qx - ax) * (by - ay)) / 2;
      for (const [x, y] of [[ax, ay], [bx, by], [qx, qy]] as const) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
    const fill = area / ((x1 - x0) * (y1 - y0));
    return fill >= 0.95 ? 'square' : fill >= 0.74 && fill <= 0.82 ? 'disc' : fill <= 0.7 ? 'cross' : `? (${fill.toFixed(2)})`;
  };
  for (const [cc, dd] of [[c, d], [city('three_bridges'), null]] as const) {
    const pads = (dd ?? cc.decor()).pads;
    for (const z of cc.zones) {
      const [zx, zy] = [cc.network.nodeXy[2 * z.node]!, cc.network.nodeXy[2 * z.node + 1]!];
      expect(padShape(pads, zx, zy), `${z.name} pad`).toBe(PAD_SHAPE[z.kind]);
    }
  }
  // the quay runs along the water edges, outside the water
  expect(d.quay.length).toBeGreaterThan(0);
  expect(d.quay.length % 6).toBe(0);
  const edgeAt = (y: number) => {
    const k = d.riverProfile.findIndex((p) => p.y >= y);
    const i = k < 0 ? d.riverProfile.length - 1 : Math.max(1, k); // beyond the end: the last segment (Red r1 m4)
    const [p, q] = [d.riverProfile[i - 1]!, d.riverProfile[i]!];
    const t = q.y === p.y ? 0 : (y - p.y) / (q.y - p.y);
    return [p.x0 + t * (q.x0 - p.x0), p.x1 + t * (q.x1 - p.x1)] as const;
  };
  for (let v = 0; v < d.quay.length; v += 2) {
    const [x, y] = [d.quay[v]!, d.quay[v + 1]!];
    const [x0, x1] = edgeAt(y);
    expect(x <= x0 + 0.5 || x >= x1 - 0.5, `quay vertex (${x.toFixed(1)}, ${y.toFixed(1)}) outside the water`).toBe(true);
    expect(Math.min(Math.abs(x - x0), Math.abs(x - x1)), 'quay vertex near a water edge').toBeLessThanOrEqual(15);
  }
  // generic decor: no buildings, pads per kind
  const t = city('three_bridges');
  const td = t.decor();
  expect(td.buildingKinds.length).toBe(0);
  expect(td.quay.length).toBe(0);
  expect(Array.from(td.padKinds)).toEqual(t.zones.map((z) => DISTRICT_KINDS.indexOf(z.kind)));
});

// 2
test('district_styles_differ_without_hue', () => {
  const kinds = [...DISTRICT_KINDS];
  const marks = kinds.map((k) => DISTRICT_STYLE[k].mark);
  expect(new Set(marks).size).toBe(4);
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) {
      const a = lum(DISTRICT_STYLE[kinds[i]!].fill);
      const b = lum(DISTRICT_STYLE[kinds[j]!].fill);
      expect(Math.abs(a - b), `${kinds[i]} vs ${kinds[j]} fill lum`).toBeGreaterThanOrEqual(0.03);
    }
  for (const k of kinds) expect(lum(DISTRICT_STYLE[k].markColor), `${k} mark brighter than its fill`).toBeGreaterThanOrEqual(lum(DISTRICT_STYLE[k].fill) + 0.024);
  expect(new Set(Object.values(PAD_SHAPE)).size).toBe(3);
});

// 3
test('decor_is_darker_than_roads', () => {
  expect(ROAD_BASE.local).toEqual([0.24, 0.27, 0.31]);
  const limit = lum(ROAD_BASE.local) - 0.06;
  for (const k of ['water', 'bank', 'park', 'outline', 'pad', 'quay', 'bollard']) expect(DECOR_COLORS[k], `DECOR_COLORS.${k}`).toBeDefined();
  const bounded: [string, RGB][] = Object.entries(DECOR_COLORS).filter(([k]) => k !== 'deck' && k !== 'railing');
  for (const kind of DISTRICT_KINDS) {
    const s = DISTRICT_STYLE[kind];
    bounded.push([`${kind}.fill`, s.fill], [`${kind}.outline`, s.outline], [`${kind}.markColor`, s.markColor]);
  }
  for (const [name, c] of bounded) expect(lum(c), `${name} below the road`).toBeLessThanOrEqual(limit + 1e-9);
  expect(DECOR_MAX_LUM).toBeCloseTo(Math.max(...bounded.map(([, c]) => lum(c))), 9);
  expect(lum(ROAD_BASE.major)).toBeGreaterThanOrEqual(lum(ROAD_BASE.local) + 0.05);
  const src = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
  expect(src).toMatch(/\bDECOR_COLORS\b/);
  expect(src).toMatch(/\bDISTRICT_STYLE\b/);
  // no decor colour literal left in the renderer (Red r1 m2)
  expect(src).not.toMatch(/\b(water|bank|park|building|pad|outline|deck|railing|quay)\w*\s*[:=]\s*\[\s*0?\.\d/i);
});

// 4
test('road_classes', () => {
  expect(ROAD_MIN_PX.major).toBeGreaterThanOrEqual(2.2 * ROAD_MIN_PX.local); // 5.5 vs 2.5: ≥ 1 px headroom at fit zoom (Red r1 M2)
  for (const name of ['river_city', 'three_bridges'] as const) {
    const c = city(name);
    const n = c.network.linkFrom.length;
    const cls = Array.from({ length: n }, (_, l) => roadClass(c.network, c.landmarks, l));
    const bridges = [...c.landmarks.north_bridge, ...c.landmarks.central_bridge, ...c.landmarks.south_bridge];
    for (const l of bridges) expect(cls[l], `${name}: bridge link ${l}`).toBe('major');
    for (let l = 0; l < n; l++) {
      if (c.network.linkSpeed[l]! >= 13.9 - 1e-3) expect(cls[l], `${name}: arterial ${l}`).toBe('major');
      const zone = c.network.nodeIsZone[c.network.linkFrom[l]!] || c.network.nodeIsZone[c.network.linkTo[l]!];
      if (zone) expect(cls[l], `${name}: zone connector ${l}`).toBe('local');
      expect(['major', 'local']).toContain(cls[l]);
    }
    expect(cls.filter((k) => k === 'major').length, `${name}: some major`).toBeGreaterThan(0);
    expect(cls.filter((k) => k === 'local').length, `${name}: some local`).toBeGreaterThan(0);
    if (name === 'river_city') {
      // the Old Bridge is slow (8.3 m/s) but a landmark: major
      for (const l of c.landmarks.south_bridge) expect(c.network.linkSpeed[l]!).toBeLessThan(13.9);
    }
  }
});
