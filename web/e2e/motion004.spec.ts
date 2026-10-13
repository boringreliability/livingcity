// Ward motion-004: city character in the browser (tests 5–9): major routes at wide zoom, districts that read
// without hue and stay below the roads, countable queued cars, the followed car and route vs the closure
// sign, legend/layout/a11y and three_bridges.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

type P = [number, number];
const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ready(page: Page, url = '/') {
  await page.goto(url);
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 90_000 }).toBeGreaterThan(1800);
}
async function setRunning(page: Page, on: boolean) {
  await blur(page);
  if ((await snap(page)).running !== on) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(on);
  if (!on) await sleep(500); // the presentation glides to the newest frame
}
/** Hide the DOM label layers (zone and bridge labels, queue pins): pixels are the canvas's own. */
const hideLabels = (page: Page) => page.addStyleTag({ content: '.labels { visibility: hidden !important; }' });
const hideVehicles = (page: Page, on = true) => page.evaluate((h) => window.__livingcity!.setDebug({ hideVehicles: h }), on);
const point = (page: Page, link: number, t: number) => page.evaluate(([l, t]) => window.__livingcity!.linkScreenPoint(l, t), [link, t] as const);

/** Wheel at `at` until the zoom satisfies `ok` (dir −1 zooms in). */
async function wheelZoom(page: Page, at: P, ok: (z: number) => boolean, dir: -1 | 1, step = 60) {
  await page.mouse.move(at[0], at[1]);
  await expect
    .poll(
      async () => {
        if (ok((await snap(page)).camera.zoom)) return true;
        await page.mouse.wheel(0, dir * step);
        return false;
      },
      { intervals: [60], timeout: 60_000 },
    )
    .toBe(true);
  await page.mouse.move(3, 3);
  await sleep(400);
}

/** Luminance (0–255) per pixel of a w × h page clip with its top-left at (x, y), row-major. */
async function lumClip(page: Page, x: number, y: number, w: number, h: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: w, height: h }, animations: 'disabled' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4) out.push(0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!);
    return out;
  }, png.toString('base64'));
}
/** Luminance of an n × n clip centred on `c`. */
const lumAt = (page: Page, c: P, n: number) => lumClip(page, Math.round(c[0]) - Math.floor(n / 2), Math.round(c[1]) - Math.floor(n / 2), n, n);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const onCanvas = (page: Page, [x, y]: P, r: number) =>
  page.evaluate(
    ([x, y, r]) =>
      [[x, y], [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]].every(([a, b]) => document.elementFromPoint(a!, b!)?.tagName === 'CANVAS'),
    [x, y, r] as const,
  );

/** All links' drawn centrelines on the page (A's map). */
const allSegments = (page: Page) =>
  page.evaluate(() => {
    const h = window.__livingcity!;
    const n = h.snapshot().linkCounts.length;
    const out: { l: number; a: [number, number]; b: [number, number]; lanes: number }[] = [];
    for (let l = 0; l < n; l++) {
      const a = h.linkScreenPoint(l, 0);
      const b = h.linkScreenPoint(l, 1);
      if (a && b) out.push({ l, a, b, lanes: h.linkInfo(l)?.lanes ?? 2 });
    }
    return out;
  });
function segDist([px, py]: P, [ax, ay]: P, [bx, by]: P) {
  const [dx, dy] = [bx - ax, by - ay];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * A road's cross-section at t = 0.5 of an axis-aligned link: width = pixels with lum > ground + 25 on a
 * 31 px line across it (ground = median of the 6 outermost samples), light = the brightest half's mean.
 */
async function crossSection(page: Page, link: number) {
  const a = (await point(page, link, 0))!;
  const b = (await point(page, link, 1))!;
  const m = (await point(page, link, 0.5))!;
  const horizontal = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  const n = 31;
  const across = horizontal ? await lumClip(page, Math.round(m[0]), Math.round(m[1]) - 15, 1, n) : await lumClip(page, Math.round(m[0]) - 15, Math.round(m[1]), n, 1);
  const ground = median([...across.slice(0, 3), ...across.slice(n - 3)]);
  const road = across.filter((v) => v > ground + 25);
  const core = [...road].sort((x, y) => y - x).slice(0, Math.max(1, Math.floor(road.length / 2)));
  return { width: road.length, light: road.length ? mean(core) : 0 };
}

/** Links of a class that are straight and axis-aligned, ≥ 60 px long, uncongested, with their middle ≥ 25 px
 * from every other road (its own reverse twin excepted) and on the canvas. */
async function measurableLinks(page: Page, ids: number[], want: number) {
  const segs = await allSegments(page);
  const s = await snap(page);
  const out: number[] = [];
  for (const l of ids) {
    const me = segs.find((x) => x.l === l);
    if (!me) continue;
    const [dx, dy] = [me.b[0] - me.a[0], me.b[1] - me.a[1]];
    if (Math.hypot(dx, dy) < 60 || Math.min(Math.abs(dx), Math.abs(dy)) > 1) continue;
    const cap = await page.evaluate((x) => window.__livingcity!.linkCapacity(x), l);
    if (s.linkCounts[l]! / cap >= 0.1) continue;
    const m: P = [(me.a[0] + me.b[0]) / 2, (me.a[1] + me.b[1]) / 2];
    const twin = (x: (typeof segs)[number]) => Math.hypot(x.a[0] - me.b[0], x.a[1] - me.b[1]) < 12 && Math.hypot(x.b[0] - me.a[0], x.b[1] - me.a[1]) < 12;
    if (segs.some((x) => x.l !== l && !twin(x) && segDist(m, x.a, x.b) < 25)) continue;
    if (!(await onCanvas(page, m, 16))) continue;
    out.push(l);
    if (out.length >= want) break;
  }
  return out;
}

// 5
test('wide_zoom_shows_major_routes', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page, '/?demand=0.25');
  await setRunning(page, false);
  await hideLabels(page);
  await hideVehicles(page);
  await sleep(400);
  const cls = await page.evaluate(() => window.__livingcity!.roadClasses());
  const bridges = (await snap(page)).landmarks!;
  const bridgeLinks = [...bridges.north_bridge, ...bridges.central_bridge, ...bridges.south_bridge];
  const major = await measurableLinks(page, cls.major.filter((l) => !bridgeLinks.includes(l)), 3);
  const local = await measurableLinks(page, cls.local, 3);
  expect(major.length, 'three measurable major links').toBe(3);
  expect(local.length, 'three measurable local links').toBe(3);
  const M = await Promise.all(major.map((l) => crossSection(page, l)));
  const L = await Promise.all(local.map((l) => crossSection(page, l)));
  const widest = Math.max(...L.map((x) => x.width));
  for (const [k, x] of M.entries()) {
    expect(x.width, `major ${major[k]} width`).toBeGreaterThanOrEqual(4);
    expect(x.width, `major ${major[k]} vs the widest local (${widest})`).toBeGreaterThanOrEqual(1.5 * widest);
  }
  expect(mean(M.map((x) => x.light)), 'major roads brighter').toBeGreaterThanOrEqual(mean(L.map((x) => x.light)) + 8);
  // the bridges are major: wide at fit zoom
  for (const l of [bridges.north_bridge[0], bridges.central_bridge[0], bridges.south_bridge[0]]) {
    expect((await crossSection(page, l)).width, `bridge link ${l}`).toBeGreaterThanOrEqual(4);
  }
});

// 6
test('districts_read_and_stay_subordinate', async ({ page }) => {
  test.setTimeout(400_000);
  await ready(page);
  await setRunning(page, false);
  await hideLabels(page);
  await hideVehicles(page);
  await sleep(400);
  const fitZoom = (await snap(page)).camera.zoom;
  const kinds = ['residential', 'workplace', 'hospital', 'waterfront'];
  const at: Record<string, { z1: number; z3: number }> = {};
  for (const kind of kinds) {
    const fit = await page.evaluate(() => window.__livingcity!.districtSamples());
    const start = fit.find((s) => s.kind === kind);
    expect(start, `${kind} shown at fit zoom`).toBeDefined();
    let res: { z1: number; z3: number } = { z1: 0, z3: 0 };
    for (const [zoom, key] of [[1, 'z1'], [3, 'z3']] as const) {
      const near = (await page.evaluate((k) => window.__livingcity!.districtSamples().find((s) => s.kind === k)?.page ?? null, kind)) ?? start!.page;
      await wheelZoom(page, near, (z) => z >= zoom, -1);
      const samples = await page.evaluate((p) => window.__livingcity!.districtSamples(p), near);
      expect(new Set(samples.map((s) => s.kind)), `all kinds sampled at zoom ${zoom}`).toEqual(new Set(kinds));
      const s = samples.find((x) => x.kind === kind)!;
      const fill = mean(await lumAt(page, s.page, 3));
      res = { ...res, [key]: fill };
      // below the roads: a local road's centreline here is ≥ 15 brighter
      const cls = await page.evaluate(() => window.__livingcity!.roadClasses());
      let road: number | null = null;
      for (const l of cls.local) {
        const m = await point(page, l, 0.5);
        if (m && (await onCanvas(page, m, 4))) {
          road = median(await lumAt(page, m, 3));
          break;
        }
      }
      expect(road, `a local road on screen at zoom ${zoom}`).not.toBeNull();
      expect(fill, `${kind} fill below a local road at zoom ${zoom}`).toBeLessThanOrEqual(road! - 15);
      // decor around it stays below the median road: the 99th percentile off the roads
      const segs = await allSegments(page);
      const z = (await snap(page)).camera.zoom;
      const [cx, cy] = [Math.round(s.page[0]) - 100, Math.round(s.page[1]) - 100];
      if (await onCanvas(page, s.page, 100)) {
        const crop = await lumClip(page, cx, cy, 200, 200);
        const nearCrop = segs.filter((sg) => segDist([cx + 100, cy + 100], sg.a, sg.b) <= 200);
        const bridgeIds = new Set(Object.values((await snap(page)).landmarks!).flat());
        const off: number[] = [];
        const roadLums: number[] = [];
        for (let y = 0; y < 200; y++)
          for (let x = 0; x < 200; x++) {
            const p: P = [cx + x + 0.5, cy + y + 0.5];
            let nearRoad = false;
            let nearBridge = false;
            for (const sg of nearCrop) {
              const d = segDist(p, sg.a, sg.b);
              // the drawn half width (lanes × 3.5 m / 2, at least the local minimum) plus 3 px of edge
              if (d <= Math.max(sg.lanes * 1.75 * z, 2.25) + 3) nearRoad = true;
              if (bridgeIds.has(sg.l) && d <= 25) nearBridge = true;
              if (d <= 1) roadLums.push(crop[y * 200 + x]!);
            }
            if (!nearRoad && !nearBridge) off.push(crop[y * 200 + x]!);
          }
        if (off.length > 1000 && roadLums.length > 20) {
          const sorted = off.sort((a, b) => a - b);
          expect(sorted[Math.floor(0.99 * (sorted.length - 1))]!, `decor 99th percentile below the median road (${kind}, zoom ${zoom})`).toBeLessThan(median(roadLums));
        }
      }
      // at zoom 3 the roof mark is there: a local maximum ≥ fill + 6 inside the building, on a line
      // through its centre along x or along y
      if (zoom === 3) {
        const [x0, y0, x1, y1] = s.box;
        const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
        const rowW = Math.floor(x1 - x0) - 4;
        const colH = Math.floor(y1 - y0) - 4;
        const row = await lumClip(page, x0 + 2, my, rowW, 1);
        const col = await lumClip(page, mx, y0 + 2, 1, colH);
        const peak = (v: number[]) => v.some((x, i) => i > 0 && i < v.length - 1 && x >= v[i - 1]! && x >= v[i + 1]! && x >= fill + 6);
        expect(peak(row) || peak(col), `${kind} roof mark (${s.mark})`).toBe(true);
      }
    }
    at[kind] = res;
    await wheelZoom(page, [640, 400], (z) => z <= fitZoom * 1.05, 1);
  }
  for (const key of ['z1', 'z3'] as const)
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const [a, b] = [at[kinds[i]!]![key], at[kinds[j]!]![key]];
        expect(Math.abs(a - b), `${kinds[i]} vs ${kinds[j]} at ${key}`).toBeGreaterThanOrEqual(3);
      }
});

// 7
test('queued_cars_countable_at_close_zoom', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('20');
  await blur(page);
  await page.getByRole('button', { name: 'Close the main bridge' }).click();
  await blur(page);
  const t0 = (await snap(page)).tick;
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(t0 + 600);
  await setRunning(page, false);
  await hideLabels(page);
  const pins = await page.evaluate(() => window.__livingcity!.queuePins());
  expect(pins.length, 'a queue to look at').toBeGreaterThan(0);
  const fitZoom = (await snap(page)).camera.zoom;
  // the first queue whose last 60 m fit on the canvas when zoomed at their middle
  let found: { link: number; a: P; b: P; off: number; ux: number; uy: number; len: number; inStretch: P[] } | null = null;
  for (const pin of pins) {
    const link = pin.link;
    const info = (await page.evaluate((l) => window.__livingcity!.linkInfo(l), link))!;
    await wheelZoom(page, (await point(page, link, 1 - 30 / info.length))!, (z) => z >= 5, -1);
    const a = (await point(page, link, 1 - 60 / info.length))!;
    const b = (await point(page, link, 1))!;
    // lane 0's drawn cars on this link, as presented now
    const cars = await page.evaluate((l) => {
      const h = window.__livingcity!;
      const out: [number, number][] = [];
      for (let i = 0; i < h.snapshot().frameRecords; i++) {
        const v = h.vehicleDraw(i);
        if (v && v.link === l && v.lane === 0) out.push(v.page);
      }
      return out;
    }, link);
    // the lane line: the centreline a→b moved sideways to the cars (median perpendicular offset)
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const off = cars.length ? median(cars.map(([x, y]) => (x - a[0]) * -uy + (y - a[1]) * ux)) : 0;
    const along = (p: P) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
    const inStretch = cars.filter((p) => along(p) >= 0 && along(p) <= len);
    let visible = cars.length > 0;
    for (const p of [a, b]) visible = visible && (await onCanvas(page, [p[0] - uy * off, p[1] + ux * off], 2));
    if (visible) {
      found = { link, a, b, off, ux, uy, len, inStretch };
      break;
    }
    await wheelZoom(page, [640, 400], (z) => z <= fitZoom * 1.05, 1);
  }
  expect(found, 'a queue whose last 60 m are on the canvas at zoom 5').not.toBeNull();
  const { a, b, off, ux, uy, len, inStretch } = found!;
  expect(inStretch.length, '≥ 4 cars in the last 60 m').toBeGreaterThanOrEqual(4);
  // sample every 0.2 m (zoom ≥ 5 → ≥ 1 px)
  const x0 = Math.floor(Math.min(a[0], b[0]) - Math.abs(off) - 4);
  const y0 = Math.floor(Math.min(a[1], b[1]) - Math.abs(off) - 4);
  const w = Math.ceil(Math.abs(b[0] - a[0]) + 2 * Math.abs(off) + 8);
  const h = Math.ceil(Math.abs(b[1] - a[1]) + 2 * Math.abs(off) + 8);
  const crop = await lumClip(page, x0, y0, w, h);
  const steps = Math.round(60 / 0.2);
  const profile: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const px = Math.round(a[0] + ux * len * t - uy * off - x0);
    const py = Math.round(a[1] + uy * len * t + ux * off - y0);
    profile.push(crop[py * w + px]!);
  }
  let runs = 0;
  let inRun = false;
  let dark = true;
  for (const v of profile) {
    if (v >= 150 && !inRun && dark) {
      runs++;
      inRun = true;
      dark = false;
    } else if (v <= 90) {
      inRun = false;
      dark = true;
    }
  }
  expect(Math.abs(runs - inStretch.length), `bright runs ${runs} vs cars ${inStretch.length}`).toBeLessThanOrEqual(1);
});

// 8
test('followed_car_and_route_are_unmistakable', async ({ page }) => {
  test.setTimeout(400_000);
  await ready(page, '/?demand=3');
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('20');
  await blur(page);
  await page.getByRole('button', { name: 'Close the main bridge' }).click();
  await blur(page);
  const t0 = (await snap(page)).tick;
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(t0 + 300);
  await setRunning(page, false);
  await hideLabels(page);
  // the closure sign: lit at its cardinal points across the bridge
  const main = (await snap(page)).landmarks!.central_bridge[0];
  const ma = (await point(page, main, 0))!;
  const mb = (await point(page, main, 1))!;
  await wheelZoom(page, (await point(page, main, 0.5))!, (z) => z >= 2, -1);
  const signs = await page.evaluate(() => window.__livingcity!.closureSigns());
  const ring = signs.find((s) => s.link === main);
  expect(ring, 'the Main Bridge closure ring').toBeDefined();
  {
    const len = Math.hypot(mb[0] - ma[0], mb[1] - ma[1]);
    const n: P = [-(mb[1] - ma[1]) / len, (mb[0] - ma[0]) / len];
    for (const sgn of [1, -1]) {
      const q: P = [ring!.page[0] + sgn * (ring!.radiusPx - 2) * n[0], ring!.page[1] + sgn * (ring!.radiusPx - 2) * n[1]];
      expect(Math.max(...(await lumAt(page, q, 3))), 'ring lit across the bridge').toBeGreaterThanOrEqual(220);
    }
  }
  // follow a car on an axis-aligned link whose remaining route crosses a congested link on screen
  const cands = await page.evaluate(() => {
    const h = window.__livingcity!;
    const out: [number, number][] = [];
    for (let i = 0; i < h.snapshot().frameRecords && out.length < 30; i++) {
      const p = h.vehicleScreenCenter(i);
      if (!p) continue;
      const ok = [[0, 0], [-20, -20], [20, -20], [-20, 20], [20, 20]].every(([dx, dy]) => document.elementFromPoint(p[0] + dx!, p[1] + dy!)?.tagName === 'CANVAS');
      if (ok && h.pickAt(p[0], p[1]).vehicle === i) out.push(p);
    }
    return out;
  });
  for (const at of cands) {
    await hideVehicles(page, false);
    await page.mouse.click(at[0], at[1]);
    await expect.poll(async () => (await snap(page)).trackedRoute.length).toBeGreaterThan(0);
    await page.mouse.move(3, 3);
    await hideVehicles(page, true);
    await sleep(400);
    const td = await page.evaluate(() => window.__livingcity!.trackedDraw());
    const marker = await page.evaluate(() => window.__livingcity!.trackedMarker());
    const s = await snap(page);
    const untrack = async () => {
      await blur(page);
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await snap(page)).trackedTrip).toBeNull();
      await sleep(400);
    };
    if (!td || !marker || !(await onCanvas(page, marker.page, marker.radiusPx + 4))) {
      await untrack();
      continue;
    }
    const la = (await point(page, td.link, 0))!;
    const lb = (await point(page, td.link, 1))!;
    const horizontal = Math.abs(lb[1] - la[1]) < 1;
    const vertical = Math.abs(lb[0] - la[0]) < 1;
    // a congested route link ≥ 30 px from the car, its middle on the canvas
    let congested: P | null = null;
    for (const l of s.trackedRoute) {
      const cap = await page.evaluate((x) => window.__livingcity!.linkCapacity(x), l);
      if (s.linkCounts[l]! / cap < 0.5) continue;
      const m = await point(page, l, 0.5);
      if (m && Math.hypot(m[0] - marker.page[0], m[1] - marker.page[1]) >= 30 && (await onCanvas(page, m, 12))) {
        congested = m;
        break;
      }
    }
    const end = await page.evaluate(() => window.__livingcity!.routeEnd());
    if (!(horizontal || vertical) || !congested || !end || !(await onCanvas(page, end.page, 8))) {
      await untrack();
      continue;
    }
    // the marker: four lit diagonal corners, dark at the cardinal points across the heading
    const [c, r] = [marker.page, marker.radiusPx];
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      expect(Math.max(...(await lumAt(page, [c[0] + 0.71 * r * dx, c[1] + 0.71 * r * dy], 3))), 'bracket corner lit').toBeGreaterThanOrEqual(235);
    }
    const across: P[] = horizontal ? [[c[0], c[1] - r], [c[0], c[1] + r]] : [[c[0] - r, c[1]], [c[0] + r, c[1]]];
    for (const q of across) expect(Math.max(...(await lumAt(page, q, 3))), 'no ring across the heading').toBeLessThan(200);
    // the route on a congested road and its end mark: present while followed, gone after
    const routeOn = await lumAt(page, congested, 24);
    const endOn = await lumAt(page, end.page, 15);
    await untrack();
    const routeOff = await lumAt(page, congested, 24);
    const endOff = await lumAt(page, end.page, 15);
    const count = (v: number[], f: (x: number) => boolean) => v.filter(f).length;
    expect(count(routeOn, (x) => x >= 235) - count(routeOff, (x) => x >= 235), 'route light on a congested road').toBeGreaterThanOrEqual(6);
    expect(count(routeOn, (x) => x <= 50) - count(routeOff, (x) => x <= 50), 'route casing dark on a congested road').toBeGreaterThanOrEqual(6);
    expect(count(endOn, (x) => x >= 235) - count(endOff, (x) => x >= 235), 'destination mark').toBeGreaterThanOrEqual(12);
    return;
  }
  throw new Error('no followed car with a congested route link and its destination on the canvas');
});

// 9
test('character_layout_legend_and_three_bridges', async ({ page }) => {
  test.setTimeout(500_000);
  await ready(page);
  const legend = page.getByRole('region', { name: 'Legend' });
  const toggle = legend.getByRole('button');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(legend.locator('li')).toHaveCount(5);
  await expect(legend.locator('li').filter({ hasText: /closed road/i })).toContainText(/ring/i);
  const sel = legend.locator('li').filter({ hasText: /select/i });
  await expect(sel).toContainText(/corner brackets/i);
  await expect(sel).toContainText(/dashed route/i);
  expect(await legend.locator('svg').count()).toBeGreaterThanOrEqual(5);
  // layout with a closure and its summary shown, at four sizes
  await page.getByRole('button', { name: 'Close the main bridge' }).click();
  await blur(page);
  await expect(page.getByRole('region', { name: 'Intervention' })).toBeVisible({ timeout: 30_000 });
  for (const size of [{ width: 1280, height: 800 }, { width: 1280, height: 720 }, { width: 900, height: 800 }, { width: 768, height: 800 }]) {
    await page.setViewportSize(size);
    await sleep(800);
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const panels = [...document.querySelectorAll<HTMLElement>('section.panel')].filter((e) => e.offsetParent !== null);
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const boxes = panels.map((e) => ({ name: e.getAttribute('aria-label') ?? e.className, r: e.getBoundingClientRect() }));
      for (const { name, r } of boxes) if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) out.push(`${name} outside the viewport`);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i]!.r, boxes[j]!.r];
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) out.push(`${boxes[i]!.name} × ${boxes[j]!.name}`);
        }
      return out;
    });
    expect(problems, `${size.width}×${size.height}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  // three_bridges: both classes, and the width rule
  await ready(page, '/?city=three_bridges');
  await setRunning(page, false);
  await hideLabels(page);
  await hideVehicles(page);
  await sleep(400);
  const cls = await page.evaluate(() => window.__livingcity!.roadClasses());
  expect(cls.major.length).toBeGreaterThan(0);
  expect(cls.local.length).toBeGreaterThan(0);
  const [mj] = await measurableLinks(page, cls.major, 1);
  const [lc] = await measurableLinks(page, cls.local, 1);
  expect(mj, 'a measurable major link').toBeDefined();
  expect(lc, 'a measurable local link').toBeDefined();
  const M = await crossSection(page, mj!);
  const L = await crossSection(page, lc!);
  expect(M.width).toBeGreaterThanOrEqual(4);
  expect(M.width).toBeGreaterThanOrEqual(1.5 * L.width);
});
