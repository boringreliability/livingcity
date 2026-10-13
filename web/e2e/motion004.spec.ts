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

/** A free spot on the canvas at 1280×800 (between the top band, the guide and the bottom panels). */
const FREE: P = [512, 400];

/** Drag the map so that page point `from` lands on `to` (the camera keeps its zoom). */
async function dragTo(page: Page, from: P, to: P) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 8 });
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(3, 3);
  await sleep(400);
}

/** Bring the page point `get()` returns (it moves with the map) to FREE: drag it there when it is on the
 * canvas, else pan towards it in steps of at most 300 px; at most 8 pans (Red r2 B-N1). */
async function bringToFree(page: Page, get: () => Promise<P>) {
  for (let k = 0; k < 8; k++) {
    const p = await get();
    if (await onCanvas(page, p, 2)) {
      await dragTo(page, p, FREE);
      return;
    }
    const [dx, dy] = [FREE[0] - p[0], FREE[1] - p[1]];
    const d = Math.hypot(dx, dy);
    const step = Math.min(300, d) / d;
    await dragTo(page, FREE, [FREE[0] + dx * step, FREE[1] + dy * step]);
  }
  expect(await onCanvas(page, await get(), 2), 'brought onto the canvas').toBe(true);
}

/**
 * A road's cross-section at t = 0.5 of an axis-aligned link: width = pixels with lum > ground + 25 on a
 * 31 px line across it (ground = median of the 6 outermost samples); light = the median of the 3 pixels at
 * the middle of that run (Red r1 M2: an edge pixel must not decide it).
 */
async function crossSection(page: Page, link: number) {
  const a = (await point(page, link, 0))!;
  const b = (await point(page, link, 1))!;
  const m = (await point(page, link, 0.5))!;
  const horizontal = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  const n = 31;
  const across = horizontal ? await lumClip(page, Math.round(m[0]), Math.round(m[1]) - 15, 1, n) : await lumClip(page, Math.round(m[0]) - 15, Math.round(m[1]), n, 1);
  const ground = median([...across.slice(0, 3), ...across.slice(n - 3)]);
  const idx = across.map((v, i) => (v > ground + 25 ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return { width: 0, light: 0 };
  const mid = idx[Math.floor(idx.length / 2)]!;
  return { width: idx.length, light: median([across[mid - 1]!, across[mid]!, across[mid + 1]!]) };
}

/** Links of a class that are straight and axis-aligned, ≥ 60 px long, empty together with their reverse twin
 * (no congestion tint, Red r1 M2), with their middle ≥ 25 px from every other road and on the canvas. */
async function measurableLinks(page: Page, ids: number[], want: number) {
  const segs = await allSegments(page);
  const s = await snap(page);
  const out: number[] = [];
  for (const l of ids) {
    const me = segs.find((x) => x.l === l);
    if (!me) continue;
    const [dx, dy] = [me.b[0] - me.a[0], me.b[1] - me.a[1]];
    if (Math.hypot(dx, dy) < 60 || Math.min(Math.abs(dx), Math.abs(dy)) > 1) continue;
    const m: P = [(me.a[0] + me.b[0]) / 2, (me.a[1] + me.b[1]) / 2];
    const twin = (x: (typeof segs)[number]) => Math.hypot(x.a[0] - me.b[0], x.a[1] - me.b[1]) < 12 && Math.hypot(x.b[0] - me.a[0], x.b[1] - me.a[1]) < 12;
    const twins = segs.filter((x) => x.l !== l && twin(x)).map((x) => x.l);
    if ([l, ...twins].some((x) => s.linkCounts[x] !== 0)) continue;
    if (segs.some((x) => x.l !== l && !twin(x) && segDist(m, x.a, x.b) < 25)) continue;
    if (!(await onCanvas(page, m, 16))) continue;
    out.push(l);
    if (out.length >= want) break;
  }
  return out;
}

/** The road-class hook partitions all links, with every landmark bridge link major (Red r1 m1). */
async function classesPartition(page: Page) {
  const cls = await page.evaluate(() => window.__livingcity!.roadClasses());
  const s = await snap(page);
  const all = [...cls.major, ...cls.local].sort((x, y) => x - y);
  expect(all, 'every link in exactly one class').toEqual(s.linkCounts.map((_, i) => i));
  const lm = s.landmarks!;
  for (const l of [...lm.north_bridge, ...lm.central_bridge, ...lm.south_bridge]) expect(cls.major, `bridge link ${l} major`).toContain(l);
  return cls;
}

// 5
test('wide_zoom_shows_major_routes', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page, '/?demand=0.25');
  await setRunning(page, false);
  await hideLabels(page);
  await hideVehicles(page);
  await sleep(400);
  const cls = await classesPartition(page);
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
  expect(mean(M.map((x) => x.light)), 'major roads brighter at their middle').toBeGreaterThanOrEqual(mean(L.map((x) => x.light)) + 8);
  // the bridges are major: wide at fit zoom
  for (const l of [bridges.north_bridge[0], bridges.central_bridge[0], bridges.south_bridge[0]]) {
    expect((await crossSection(page, l)).width, `bridge link ${l}`).toBeGreaterThanOrEqual(4);
  }
});

// 6
test('districts_read_and_stay_subordinate', async ({ page }) => {
  test.setTimeout(500_000);
  await ready(page);
  await setRunning(page, false);
  await hideLabels(page);
  await hideVehicles(page);
  await sleep(400);
  const fitZoom = (await snap(page)).camera.zoom;
  const kinds = ['residential', 'workplace', 'hospital', 'waterfront'];
  const fills: Record<string, Record<number, number>> = {};
  const sample = (kind: string, near: P) => page.evaluate(([k, p]) => window.__livingcity!.districtSamples(p).find((s) => s.kind === k) ?? null, [kind, near] as const);
  for (const kind of kinds) {
    fills[kind] = {};
    const start = await sample(kind, FREE);
    expect(start, `${kind} shown at fit zoom`).not.toBeNull();
    let anchor: P = start!.page;
    for (const zoom of [1, 3]) {
      // zoom in at the building (the wheel keeps it under the pointer), then drag it to a free spot
      await wheelZoom(page, anchor, (z) => z >= zoom, -1);
      const s0 = await sample(kind, anchor);
      expect(s0, `${kind} at zoom ${zoom}`).not.toBeNull();
      await dragTo(page, s0!.page, FREE);
      const s = await sample(kind, FREE);
      expect(s, `${kind} at zoom ${zoom} after the drag`).not.toBeNull();
      anchor = s!.page;
      const fill = mean(await lumAt(page, s!.page, 3));
      fills[kind]![zoom] = fill;
      // below the roads: a local road's middle on screen is ≥ 15 brighter
      const cls = await page.evaluate(() => window.__livingcity!.roadClasses());
      let road: number | null = null;
      for (const l of cls.local) {
        for (let t = 0.1; t <= 0.9 && road === null; t += 0.1) {
          const m = await point(page, l, t);
          if (m && (await onCanvas(page, m, 4))) road = median(await lumAt(page, m, 3));
        }
        if (road !== null) break;
      }
      expect(road, `a local road on screen at zoom ${zoom}`).not.toBeNull();
      expect(fill, `${kind} fill below a local road at zoom ${zoom}`).toBeLessThanOrEqual(road! - 15);
      // the roof mark (drawn from zoom 1, Red r1 M4): a local maximum ≥ fill + 6 inside the building, on a
      // line through its centre along x or along y
      {
        const [x0, y0, x1, y1] = s!.box;
        const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
        const row = await lumClip(page, x0 + 2, my, Math.max(3, Math.floor(x1 - x0) - 4), 1);
        const col = await lumClip(page, mx, y0 + 2, 1, Math.max(3, Math.floor(y1 - y0) - 4));
        const peak = (v: number[]) => v.some((x, i) => i > 0 && i < v.length - 1 && x >= v[i - 1]! && x >= v[i + 1]! && x >= fill + 6);
        expect(peak(row) || peak(col), `${kind} roof mark (${s!.mark}) at zoom ${zoom}`).toBe(true);
      }
      // at zoom 1, decor around it stays below the roads: the 99th percentile of a 300 × 300 crop off the
      // roads and bridges is below the median road pixel of the same crop (which must hold roads)
      if (zoom === 1) {
        expect(await onCanvas(page, FREE, 150), 'the crop is on the canvas').toBe(true);
        const [cx, cy] = [FREE[0] - 150, FREE[1] - 150];
        const crop = await lumClip(page, cx, cy, 300, 300);
        const segs = (await allSegments(page)).filter((sg) => segDist(FREE, sg.a, sg.b) <= 300);
        const z = (await snap(page)).camera.zoom;
        const bridgeIds = new Set(Object.values((await snap(page)).landmarks!).flat());
        const off: number[] = [];
        const roadLums: number[] = [];
        for (let y = 0; y < 300; y++)
          for (let x = 0; x < 300; x++) {
            const p: P = [cx + x + 0.5, cy + y + 0.5];
            let nearRoad = false;
            for (const sg of segs) {
              const d = segDist(p, sg.a, sg.b);
              // the drawn half width (lanes × 3.5 m / 2, at least the minimum) plus 3 px of edge; bridges with
              // their deck and railing (20 m half width + 8 px) are structure, not decor (Red r1 m8)
              const reach = bridgeIds.has(sg.l) ? 20 * z + 8 : Math.max(sg.lanes * 1.75 * z, 2.75) + 3;
              if (d <= reach) nearRoad = true;
              if (!bridgeIds.has(sg.l) && d <= 0.75) roadLums.push(crop[y * 300 + x]!);
            }
            if (!nearRoad) off.push(crop[y * 300 + x]!);
          }
        expect(roadLums.length, 'roads in the crop').toBeGreaterThan(20);
        expect(off.length, 'decor in the crop').toBeGreaterThan(10_000);
        const sorted = off.sort((a, b) => a - b);
        expect(sorted[Math.floor(0.99 * (sorted.length - 1))]!, `decor 99th percentile below the median road (${kind})`).toBeLessThan(median(roadLums));
      }
    }
    await wheelZoom(page, FREE, (z) => z <= fitZoom * 1.05, 1);
  }
  // the four kinds' fills differ by ≥ 6 (8-bit) at each zoom (Red r1 M4)
  for (const zoom of [1, 3])
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const [a, b] = [fills[kinds[i]!]![zoom]!, fills[kinds[j]!]![zoom]!];
        expect(Math.abs(a - b), `${kinds[i]} vs ${kinds[j]} at zoom ${zoom}`).toBeGreaterThanOrEqual(6);
      }
});

// 7
test('queued_cars_countable_and_cars_readable_at_fit_zoom', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page);
  await setRunning(page, false);
  await hideLabels(page);
  // (a) at fit zoom, moving cars stay bright (the outline must not eat them; Red r1 M3)
  {
    const moving = await page.evaluate(() => {
      const h = window.__livingcity!;
      const out: [number, number][] = [];
      for (let i = 0; i < h.snapshot().frameRecords && out.length < 40; i++) {
        const f = h.frameVehicle(i);
        const v = h.vehicleDraw(i);
        if (!f || !v || f.queued) continue;
        const [x, y] = v.page;
        if ([[0, 0], [-6, -6], [6, 6]].every(([dx, dy]) => document.elementFromPoint(x + dx!, y + dy!)?.tagName === 'CANVAS')) out.push(v.page);
      }
      return out;
    });
    expect(moving.length, 'moving cars on the canvas').toBeGreaterThanOrEqual(10);
    const shown = await Promise.all(moving.map(async (p) => Math.max(...(await lumAt(page, p, 3)))));
    const bright = shown.filter((v) => v >= 180).length;
    expect(bright, `moving cars with a bright core at fit zoom (${bright}/${moving.length})`).toBeGreaterThanOrEqual(Math.ceil(0.8 * moving.length));
  }
  // (b) queued cars at close zoom: a dark seam at both sides of each car's body, across the lane, on a
  // congested (light) road where the brake band cannot make it (Red r1 B1)
  await setRunning(page, true);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('20');
  await blur(page);
  await page.getByRole('button', { name: 'Close the main bridge' }).click();
  await blur(page);
  const t0 = (await snap(page)).tick;
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(t0 + 600);
  await setRunning(page, false);
  const pins = await page.evaluate(() => window.__livingcity!.queuePins());
  expect(pins.length, 'a queue to look at').toBeGreaterThan(0);
  let link = -1;
  let info: { length: number; lanes: number } | null = null;
  for (const pin of pins) {
    const li = (await page.evaluate((l) => window.__livingcity!.linkInfo(l), pin.link))!;
    const at = (await point(page, pin.link, 1 - 30 / li.length))!;
    const a0 = (await point(page, pin.link, 0))!;
    const b0 = (await point(page, pin.link, 1))!;
    const axis = Math.min(Math.abs(b0[0] - a0[0]), Math.abs(b0[1] - a0[1])) <= 1;
    if (axis && (await onCanvas(page, at, 6))) {
      [link, info] = [pin.link, li];
      break;
    }
  }
  expect(link, 'a queue pin on an axis-aligned link with its anchor on the canvas').toBeGreaterThanOrEqual(0);
  await wheelZoom(page, (await point(page, link, 1 - 30 / info!.length))!, (z) => z >= 5, -1);
  await bringToFree(page, async () => (await point(page, link, 1 - 30 / info!.length))!);
  const a = (await point(page, link, 0))!;
  const b = (await point(page, link, 1))!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const cars = await page.evaluate((l) => {
    const h = window.__livingcity!;
    const out: [number, number][] = [];
    for (let i = 0; i < h.snapshot().frameRecords; i++) {
      const f = h.frameVehicle(i);
      const v = h.vehicleDraw(i);
      if (f && v && f.queued && v.link === l) out.push(v.page);
    }
    return out;
  }, link);
  // 25-px profiles across the lane through each car's middle, with the cars shown and then hidden
  const across = async (c: P) => {
    const clip = await lumAt(page, c, 25);
    const prof: number[] = [];
    for (let k = -12; k <= 12; k++) prof.push(clip[Math.round(12 + ux * k) * 25 + Math.round(12 - uy * k)]!);
    return prof;
  };
  const onScreen: P[] = [];
  for (const c of cars) if (await onCanvas(page, c, 14)) onScreen.push(c);
  const shownProfiles = await Promise.all(onScreen.map(across));
  await hideVehicles(page, true);
  await sleep(400);
  const hiddenProfiles = await Promise.all(onScreen.map(across));
  await hideVehicles(page, false);
  let measured = 0;
  let seamed = 0;
  for (const [i, prof] of shownProfiles.entries()) {
    const road = hiddenProfiles[i]!;
    // the bright body around the middle (index 12)
    if (prof[12]! < 150) continue;
    let lo = 12;
    let hi = 12;
    while (lo > 0 && prof[lo - 1]! >= 150) lo--;
    while (hi < 24 && prof[hi + 1]! >= 150) hi++;
    if (lo < 3 || hi > 21) continue;
    // counted only where the 2 pixels outside the body on both sides are light road without the cars
    // (congested): there the brake band cannot make a seam, only an outline can
    const outside = [lo - 1, lo - 2, hi + 1, hi + 2];
    if (!outside.every((k) => road[k]! > 100)) continue;
    measured++;
    if ((prof[lo - 1]! <= 90 || prof[lo - 2]! <= 90) && (prof[hi + 1]! <= 90 || prof[hi + 2]! <= 90)) seamed++;
  }
  expect(measured, 'queued cars measured on a light road').toBeGreaterThanOrEqual(4);
  expect(seamed, `queued cars with a dark seam on both sides (${seamed}/${measured})`).toBeGreaterThanOrEqual(Math.ceil(0.8 * measured));
});

// 8
test('followed_car_and_route_are_unmistakable', async ({ page }) => {
  test.setTimeout(500_000);
  await ready(page, '/?demand=3');
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('20');
  await blur(page);
  await page.getByRole('button', { name: 'Close the main bridge' }).click();
  await blur(page);
  const t0 = (await snap(page)).tick;
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(t0 + 300);
  await setRunning(page, false);
  await hideLabels(page);
  // (a) the closure sign: lit at its cardinal points across the bridge
  const main = (await snap(page)).landmarks!.central_bridge[0];
  await wheelZoom(page, (await point(page, main, 0.5))!, (z) => z >= 2, -1);
  await bringToFree(page, async () => (await point(page, main, 0.5))!);
  {
    const ma = (await point(page, main, 0))!;
    const mb = (await point(page, main, 1))!;
    const ring = (await page.evaluate(() => window.__livingcity!.closureSigns())).find((s) => s.link === main);
    expect(ring, 'the Main Bridge closure ring').toBeDefined();
    const mid = (await point(page, main, 0.5))!;
    expect(Math.hypot(ring!.page[0] - mid[0], ring!.page[1] - mid[1]), 'the ring at the bridge middle').toBeLessThanOrEqual(2);
    const len = Math.hypot(mb[0] - ma[0], mb[1] - ma[1]);
    const n: P = [-(mb[1] - ma[1]) / len, (mb[0] - ma[0]) / len];
    for (const sgn of [1, -1]) {
      const q: P = [ring!.page[0] + sgn * (ring!.radiusPx - 2) * n[0], ring!.page[1] + sgn * (ring!.radiusPx - 2) * n[1]];
      expect(Math.max(...(await lumAt(page, q, 3))), 'ring lit across the bridge').toBeGreaterThanOrEqual(220);
    }
  }
  // (b) follow a car on an axis-aligned link whose remaining route has a congested link (occupancy ≥ 0.3:
  // tinted light, lum > 100; Red r2 B-N1)
  const cands = await page.evaluate(() => {
    const h = window.__livingcity!;
    const out: [number, number][] = [];
    for (let i = 0; i < h.snapshot().frameRecords && out.length < 40; i++) {
      const p = h.vehicleScreenCenter(i);
      if (!p) continue;
      const ok = [[0, 0], [-20, -20], [20, -20], [-20, 20], [20, 20]].every(([dx, dy]) => document.elementFromPoint(p[0] + dx!, p[1] + dy!)?.tagName === 'CANVAS');
      if (ok && h.pickAt(p[0], p[1]).vehicle === i) out.push(p);
    }
    return out;
  });
  const untrack = async () => {
    await blur(page);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await snap(page)).trackedTrip).toBeNull();
    await sleep(400);
  };
  let congestedLink: number | null = null;
  let horizontal = false;
  for (const at of cands) {
    await hideVehicles(page, false);
    await page.mouse.click(at[0], at[1]);
    await expect.poll(async () => (await snap(page)).trackedRoute.length).toBeGreaterThan(0);
    await page.mouse.move(3, 3);
    const td = await page.evaluate(() => window.__livingcity!.trackedDraw());
    const s = await snap(page);
    if (!td) {
      await untrack();
      continue;
    }
    const la = (await point(page, td.link, 0))!;
    const lb = (await point(page, td.link, 1))!;
    horizontal = Math.abs(lb[1] - la[1]) < 1;
    const vertical = Math.abs(lb[0] - la[0]) < 1;
    let cong: number | null = null;
    for (const l of s.trackedRoute.slice(1)) {
      const cap = await page.evaluate((x) => window.__livingcity!.linkCapacity(x), l);
      if (s.linkCounts[l]! / cap >= 0.3 && (await page.evaluate((x) => window.__livingcity!.linkInfo(x)!.length, l)) >= 40) {
        cong = l;
        break;
      }
    }
    if ((horizontal || vertical) && cong !== null) {
      congestedLink = cong;
      break;
    }
    await untrack();
  }
  expect(congestedLink, 'a followed car on an axis-aligned link with a congested link ahead').not.toBeNull();
  await hideVehicles(page, true);
  await sleep(400);
  // the marker: at the car, four lit diagonal corners, dark at the cardinal points across the heading
  {
    const marker = await page.evaluate(() => window.__livingcity!.trackedMarker());
    expect(marker, 'the tracked marker').not.toBeNull();
    const car = (await page.evaluate(() => window.__livingcity!.trackedScreenCenter()))!;
    expect(Math.hypot(marker!.page[0] - car[0], marker!.page[1] - car[1]), 'the marker at the car').toBeLessThanOrEqual(1.5);
    if (!(await onCanvas(page, marker!.page, marker!.radiusPx + 4))) await bringToFree(page, async () => (await page.evaluate(() => window.__livingcity!.trackedMarker()))!.page);
    const m = (await page.evaluate(() => window.__livingcity!.trackedMarker()))!;
    const [c, r] = [m.page, m.radiusPx];
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      expect(Math.max(...(await lumAt(page, [c[0] + 0.71 * r * dx, c[1] + 0.71 * r * dy], 3))), 'bracket corner lit').toBeGreaterThanOrEqual(235);
    }
    const across: P[] = horizontal ? [[c[0], c[1] - r], [c[0], c[1] + r]] : [[c[0] - r, c[1]], [c[0] + r, c[1]]];
    for (const q of across) expect(Math.max(...(await lumAt(page, q, 3))), 'no ring across the heading').toBeLessThan(200);
  }
  // the route on the congested link: a white core with a dark casing ≥ 2 px wide on both sides (Red r1 M1)
  {
    await bringToFree(page, async () => (await point(page, congestedLink!, 0.5))!);
    const a = (await point(page, congestedLink!, 0))!;
    const b = (await point(page, congestedLink!, 1))!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let checked = 0;
    let cased = 0;
    for (let k = 0.2; k <= 0.8; k += 0.02) {
      const p: P = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      if (!(await onCanvas(page, p, 12))) continue;
      const clip = await lumAt(page, p, 25);
      const prof: number[] = [];
      for (let j = -12; j <= 12; j++) prof.push(clip[Math.round(12 + ux * j) * 25 + Math.round(12 - uy * j)]!);
      // a dash: the white core at the middle
      const core = prof.findIndex((v, i) => i >= 9 && i <= 15 && v >= 235);
      if (core < 0) continue;
      let lo = core;
      let hi = core;
      while (lo > 0 && prof[lo - 1]! >= 235) lo--;
      while (hi < 24 && prof[hi + 1]! >= 235) hi++;
      checked++;
      const dark2 = (from: number, step: number) => prof[from + step]! <= 50 && prof[from + 2 * step]! <= 50;
      if (dark2(lo, -1) && dark2(hi, 1)) cased++;
    }
    expect(checked, 'route dashes measured on the congested link').toBeGreaterThanOrEqual(4);
    expect(cased, `dashes with a ≥ 2 px dark casing on both sides (${cased}/${checked})`).toBeGreaterThanOrEqual(Math.ceil(0.75 * checked));
  }
  // the destination mark: at the route's last point, a square lit off the route's axis and beyond its end
  {
    const route = (await snap(page)).trackedRoute;
    const last = route[route.length - 1]!;
    const end = await page.evaluate(() => window.__livingcity!.routeEnd());
    expect(end, 'the route end').not.toBeNull();
    const want = (await point(page, last, 1))!;
    expect(Math.hypot(end!.page[0] - want[0], end!.page[1] - want[1]), 'routeEnd at the last link end').toBeLessThanOrEqual(1);
    await bringToFree(page, async () => (await page.evaluate(() => window.__livingcity!.routeEnd()))!.page);
    const e = (await page.evaluate(() => window.__livingcity!.routeEnd()))!.page;
    const la = (await point(page, last, 0))!;
    const lb = (await point(page, last, 1))!;
    const len = Math.hypot(lb[0] - la[0], lb[1] - la[1]);
    const [ux, uy] = [(lb[0] - la[0]) / len, (lb[1] - la[1]) / len];
    const probes: P[] = [
      [e[0] - uy * 4.5, e[1] + ux * 4.5],
      [e[0] + uy * 4.5, e[1] - ux * 4.5],
      [e[0] + ux * 4.5, e[1] + uy * 4.5],
    ];
    const on = await Promise.all(probes.map(async (q) => Math.max(...(await lumAt(page, q, 3)))));
    await untrack();
    const off = await Promise.all(probes.map(async (q) => Math.max(...(await lumAt(page, q, 3)))));
    for (let k = 0; k < 3; k++) {
      expect(on[k]!, `end mark lit at probe ${k}`).toBeGreaterThanOrEqual(235);
      expect(off[k]!, `nothing lit there when not followed (probe ${k})`).toBeLessThan(200);
    }
  }
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
  await expect(sel).toContainText(/brackets/i);
  // the legend keeps today's footprint (one row, 703 × 50 px; frozen layout and pixel tests depend on it)
  for (const size of [{ width: 1280, height: 800 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size);
    await sleep(500);
    const box = (await legend.boundingBox())!;
    expect(box.width, `legend width at ${size.width}×${size.height}`).toBeLessThanOrEqual(703.5);
    expect(box.height, `legend height at ${size.width}×${size.height}`).toBeLessThanOrEqual(50.5);
    expect(box.x, `legend left at ${size.width}×${size.height}`).toBeGreaterThanOrEqual(560.5);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
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
  const cls = await classesPartition(page);
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
