// Ward city-004: render-side city decor, fit with insets, the 2D link table.
import { readdirSync, readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { Camera } from '../src/render/camera';
import { cityDecor } from '../src/render/cities';
import { LABEL_ICONS, riverCityDecor } from '../src/render/cities/riverCity';
import { buildRoadGeometry, type RoadGeometry } from '../src/render/geometry';
import { FIT_INSETS } from '../src/render/layout';
import { LINK_TEX_WIDTH, linkTexel } from '../src/render/linkTable';
import type { Landmarks, NetworkArrays, ZoneInfo } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

/** The real River City network as the worker exports it. */
function river() {
  loadWasm();
  const sim = Sim.river_city(2026, 7);
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
  const corridor: [number, number] = [r[0]!, r[1]!];
  const geometry = buildRoadGeometry(network);
  return { network, landmarks, zones, corridor, geometry };
}

const decorOf = (c: ReturnType<typeof river>) => riverCityDecor(c.network, c.geometry, c.landmarks, c.zones, c.corridor);

/** Unscaled road segments (node to node) with their drawn half width. */
function segments(g: RoadGeometry) {
  return g.links.map((l) => ({ id: l.id, x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1, half: l.width / 2 }));
}

// 1
test('decor_is_deterministic', () => {
  const c = river();
  const a = decorOf(c);
  const b = decorOf(c);
  for (const k of ['water', 'banks', 'parks', 'buildings', 'bridgeDecks', 'pads'] as const) {
    expect(Array.from(a[k])).toEqual(Array.from(b[k]));
  }
  expect(a.labels).toEqual(b.labels);
  expect(a.riverProfile).toEqual(b.riverProfile);
  expect(a.buildingBoxes).toEqual(b.buildingBoxes);
  // no randomness in the decor sources
  const dir = new URL('../src/render/cities/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    expect(src.includes('Math.random'), f).toBe(false);
  }
  // and the dispatcher picks River City by name
  const ready = { city: 'river_city', network: c.network, landmarks: c.landmarks, zones: c.zones, river: c.corridor };
  const viaIndex = cityDecor(ready as never, c.geometry);
  expect(Array.from(viaIndex.buildings)).toEqual(Array.from(a.buildings));
}, 30_000);

// 2
test('river_stays_in_corridor', () => {
  const c = river();
  const d = decorOf(c);
  const [west, east] = c.corridor;
  expect(d.water.length).toBeGreaterThan(0);
  for (let i = 0; i < d.water.length; i += 2) {
    expect(d.water[i]!).toBeGreaterThanOrEqual(west - 1e-6);
    expect(d.water[i]!).toBeLessThanOrEqual(east + 1e-6);
  }
  const p = d.riverProfile;
  const b = c.geometry.bounds;
  expect(p[0]!.y).toBeLessThanOrEqual(b.minY - 500 + 1e-6);
  expect(p.at(-1)!.y).toBeGreaterThanOrEqual(b.maxY + 500 - 1e-6);
  for (let i = 0; i < p.length; i++) {
    const s = p[i]!;
    expect(s.x1 - s.x0, `width at y=${s.y}`).toBeGreaterThanOrEqual(60);
    expect(s.x0).toBeGreaterThanOrEqual(west - 1e-6);
    expect(s.x1).toBeLessThanOrEqual(east + 1e-6);
    if (i > 0) expect(s.y - p[i - 1]!.y).toBeLessThanOrEqual(50 + 1e-9);
  }
  // and it actually meanders (not just the straight corridor)
  const widths = new Set(p.map((s) => Math.round(s.x0)));
  expect(widths.size).toBeGreaterThan(3);
}, 30_000);

// 3
test('every_bridge_spans_water', () => {
  const c = river();
  const d = decorOf(c);
  const [west, east] = c.corridor;
  const at = (y: number) => d.riverProfile.reduce((a, s) => (Math.abs(s.y - y) < Math.abs(a.y - y) ? s : a));
  const bridges = new Set([...c.landmarks.central_bridge, ...c.landmarks.north_bridge, ...c.landmarks.south_bridge]);
  for (const l of c.geometry.links) {
    if (bridges.has(l.id)) {
      const s = at((l.y0 + l.y1) / 2);
      expect(Math.min(l.x0, l.x1)).toBeLessThan(s.x0);
      expect(Math.max(l.x0, l.x1)).toBeGreaterThan(s.x1);
    } else {
      for (let k = 0; k <= 20; k++) {
        const x = l.x0 + ((l.x1 - l.x0) * k) / 20;
        expect(x < west || x > east, `link ${l.id} enters the corridor`).toBe(true);
      }
    }
  }
}, 30_000);

// 4
test('buildings_avoid_roads_water_and_each_other', () => {
  const c = river();
  const d = decorOf(c);
  const [west, east] = c.corridor;
  const boxes = d.buildingBoxes;
  expect(boxes.length).toBeGreaterThanOrEqual(200);
  expect(d.buildings.length).toBe(boxes.length * 12); // 6 vertices × (x, y) per box
  const b = c.geometry.bounds;
  const segs = segments(c.geometry);
  const distToBox = (x: number, y: number, [x0, y0, x1, y1]: [number, number, number, number]) =>
    Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
  for (const box of boxes) {
    const [x0, y0, x1, y1] = box;
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeGreaterThan(y0);
    expect(x1 < west || x0 > east, `box ${box} in the river`).toBe(true);
    expect(x0 >= b.minX && x1 <= b.maxX && y0 >= b.minY && y1 <= b.maxY, `box ${box} outside bounds`).toBe(true);
    for (const s of segs) {
      const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
      const n = Math.max(1, Math.ceil(len / 5));
      for (let k = 0; k <= n; k++) {
        const x = s.x0 + ((s.x1 - s.x0) * k) / n;
        const y = s.y0 + ((s.y1 - s.y0) * k) / n;
        if (distToBox(x, y, box) < s.half + 4 - 1e-6) throw new Error(`box ${box} too close to link ${s.id}`);
      }
    }
  }
  // no two boxes overlap (sweep over x)
  const sorted = [...boxes].sort((p, q) => p[0] - q[0]);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j]![0] < sorted[i]![2]; j++) {
      const [a, q] = [sorted[i]!, sorted[j]!];
      const overlap = a[0] < q[2] && q[0] < a[2] && a[1] < q[3] && q[1] < a[3];
      expect(overlap, `boxes ${a} and ${q} overlap`).toBe(false);
    }
  }
}, 60_000);

// 5
test('district_labels_cover_all_zones', () => {
  const c = river();
  const d = decorOf(c);
  expect(d.labels.length).toBe(c.zones.length);
  for (const z of c.zones) {
    const l = d.labels.find((x) => x.text === z.name);
    expect(l, z.name).toBeDefined();
    expect(l!.kind).toBe(z.kind);
    expect(l!.icon).toBe(LABEL_ICONS[z.kind]);
  }
  const cam = new Camera();
  cam.setViewport(1280, 800);
  cam.fitInsets(c.geometry.bounds, FIT_INSETS);
  const boxes = d.labels.map((l) => {
    const [sx, sy] = cam.worldToScreen(l.x, l.y);
    const w = 7.5 * l.text.length + 18;
    return { t: l.text, x0: sx - w / 2, x1: sx + w / 2, y0: sy - 9, y1: sy + 9 };
  });
  for (const b of boxes) {
    expect(b.x0 >= 0 && b.x1 <= 1280 && b.y0 >= 0 && b.y1 <= 800, `${b.t} off canvas`).toBe(true);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i]!, boxes[j]!];
      const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
      expect(overlap, `${a.t} overlaps ${b.t}`).toBe(false);
    }
}, 30_000);

// 6
test('fit_insets_keeps_bounds_clear_of_panels', () => {
  const bounds = { minX: -3000, minY: -1900, maxX: 3200, maxY: 2000 };
  const cam = new Camera();
  cam.setViewport(1280, 800);
  const ins = { top: 140, right: 24, bottom: 96, left: 24 };
  cam.fitInsets(bounds, ins);
  const [ax, ay] = cam.worldToScreen(bounds.minX, bounds.maxY); // top-left
  const [bx, by] = cam.worldToScreen(bounds.maxX, bounds.minY); // bottom-right
  const eps = 1e-6;
  expect(ax).toBeGreaterThanOrEqual(ins.left - eps);
  expect(ay).toBeGreaterThanOrEqual(ins.top - eps);
  expect(bx).toBeLessThanOrEqual(1280 - ins.right + eps);
  expect(by).toBeLessThanOrEqual(800 - ins.bottom + eps);
  // touches the inset rectangle on one axis, centred on both
  const touchX = Math.abs(ax - ins.left) < 1e-6 && Math.abs(1280 - ins.right - bx) < 1e-6;
  const touchY = Math.abs(ay - ins.top) < 1e-6 && Math.abs(800 - ins.bottom - by) < 1e-6;
  expect(touchX || touchY).toBe(true);
  expect((ax + bx) / 2).toBeCloseTo((ins.left + 1280 - ins.right) / 2, 6);
  expect((ay + by) / 2).toBeCloseTo((ins.top + 800 - ins.bottom) / 2, 6);
  // zero insets ≡ fit(bounds, 0)
  const a = new Camera();
  a.setViewport(1280, 800);
  a.fitInsets(bounds, { top: 0, right: 0, bottom: 0, left: 0 });
  const b = new Camera();
  b.setViewport(1280, 800);
  b.fit(bounds, 0);
  expect([a.cx, a.cy, a.zoom]).toEqual([b.cx, b.cy, b.zoom]);
});

// 7
test('link_texture_is_2d', () => {
  expect(LINK_TEX_WIDTH).toBe(1024);
  const n = 5000;
  const seen = new Set<string>();
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < n; i++) {
      const [x, y] = linkTexel(i, row, n);
      expect(x >= 0 && x < 1024 && y >= 0 && y < 15).toBe(true);
      const k = `${x},${y}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 300; i++) {
      const [x, y] = linkTexel(i, row, 300);
      expect(x).toBe(i);
      expect(y).toBe(row);
    }
});
