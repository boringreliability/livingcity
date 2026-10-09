// Ward polish-003, tests 7–10: the GPU places cars by the CPU rule (junction curves), a tracked car
// moves continuously, hover reads by shape, and a closed road is marked at every zoom.
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface VehicleDraw {
  link: number;
  s: number;
  lane: number;
  next: number;
  inBlend: boolean;
  world: [number, number];
  page: [number, number];
  straightPage: [number, number];
}
interface TrackedDraw {
  link: number;
  /** metres along `link` as drawn (after extrapolation, ≤ length) */
  s: number;
  length: number;
  lane: number;
  /** the next link (0xFFFF none) and the lane predicted on it */
  next: number;
  nextLane: number;
  world: [number, number];
}
type Hook = NonNullable<Window['__livingcity']> & {
  vehicleDraw(record: number): VehicleDraw | null;
  trackedDraw(): TrackedDraw | null;
};

async function ready(page: Page, url = '/') {
  await page.goto(url);
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}

/** Wheel at the canvas point `at` until the zoom satisfies `ok`. */
async function wheelZoom(page: Page, at: [number, number], ok: (z: number) => boolean, dir: -1 | 1, step = 60) {
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
  await sleep(300);
}

/** Luminance (0–255) of a w × h clip centred on `c` (page px, DPR 1), row-major. */
async function lum(page: Page, c: [number, number], w: number, h: number): Promise<number[]> {
  const buf = await page.screenshot({ clip: { x: Math.round(c[0] - w / 2), y: Math.round(c[1] - h / 2), width: w, height: h }, animations: 'disabled' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = new OffscreenCanvas(img.width, img.height);
    const g = cv.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4) out.push(0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!);
    return out;
  }, buf.toString('base64'));
}

const onCanvas = (page: Page, p: [number, number]) =>
  page.evaluate(([x, y]) => [[0, 0], [-6, -6], [6, -6], [-6, 6], [6, 6]].every(([a, b]) => document.elementFromPoint(x + a!, y + b!)?.tagName === 'CANVAS'), p);

// 7
test('gpu_draws_cars_where_the_cpu_says', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page, '/?demand=3');
  // junction queues: close the main bridge and let the alternatives fill
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await blur(page);
  const t0 = (await snap(page)).tick;
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(t0 + 1200);
  await pause(page);
  const drawAll = () =>
    page.evaluate(() => {
      const h = window.__livingcity as unknown as Hook;
      const out: VehicleDraw[] = [];
      for (let i = 0; i < h.snapshot().frameRecords; i++) {
        const d = h.vehicleDraw(i);
        if (d) out.push(d);
      }
      return out;
    });
  // zoom in where most blend-zone cars are (by world position)
  const before = (await drawAll()).filter((d) => d.inBlend);
  expect(before.length, 'blend-zone cars in the city').toBeGreaterThanOrEqual(10);
  let best = before[0]!;
  let bestN = 0;
  for (const d of before) {
    const n = before.filter((e) => Math.hypot(e.world[0] - d.world[0], e.world[1] - d.world[1]) < 60).length;
    if (n > bestN) [best, bestN] = [d, n];
  }
  await wheelZoom(page, best.page, (z) => z >= 4, -1);
  const all = await drawAll();
  const visible: VehicleDraw[] = [];
  for (const d of all) if (d.page[0] > 20 && d.page[1] > 20 && (await onCanvas(page, d.page))) visible.push(d);
  // blend-zone cars drawn clearly off the straight line (≥ 1.5 m at ≥ 4 px/m), and plain cars
  const curved = visible.filter((d) => d.inBlend && Math.hypot(d.page[0] - d.straightPage[0], d.page[1] - d.straightPage[1]) >= 6);
  const plain = visible.filter((d) => !d.inBlend);
  expect(curved.length, 'curved cars in view').toBeGreaterThanOrEqual(5);
  expect(plain.length, 'plain cars in view').toBeGreaterThanOrEqual(8);
  const shown = async (p: [number, number]) => lum(page, p, 3, 3);
  const at = async (pts: [number, number][]) => Promise.all(pts.map(shown));
  const curvedPts = curved.slice(0, 12).map((d) => d.page);
  const straightPts = curved.slice(0, 12).map((d) => d.straightPage);
  const plainPts = plain.slice(0, 12).map((d) => d.page);
  const withCars = { curved: await at(curvedPts), straight: await at(straightPts), plain: await at(plainPts) };
  await page.evaluate(() => window.__livingcity!.setDebug({ hideVehicles: true }));
  await sleep(300);
  const without = { curved: await at(curvedPts), straight: await at(straightPts), plain: await at(plainPts) };
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const diff = (k: 'curved' | 'straight' | 'plain', i: number) => Math.abs(mean(withCars[k][i]!) - mean(without[k][i]!));
  // a car is drawn where the CPU rule puts it …
  for (let i = 0; i < curvedPts.length; i++) expect(diff('curved', i), `curved car ${i} drawn at its curve point`).toBeGreaterThanOrEqual(30);
  for (let i = 0; i < plainPts.length; i++) expect(diff('plain', i), `plain car ${i} drawn at its point`).toBeGreaterThanOrEqual(30);
  // … and mostly not at the straight (old) point
  const emptyStraight = straightPts.filter((_, i) => diff('straight', i) < 30).length;
  expect(emptyStraight, 'straight points left empty').toBeGreaterThanOrEqual(Math.ceil(straightPts.length / 2));
});

// 8
test('tracked_car_moves_continuously', async ({ page }) => {
  test.setTimeout(400_000);
  await ready(page);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('5');
  await blur(page);
  const lm = (await snap(page)).landmarks!;
  const centre = (await page.evaluate((l) => window.__livingcity!.linkScreenCenter(l), lm.central_bridge[0]!))!;
  await wheelZoom(page, centre, (z) => z >= 2.24, -1);
  let crossings = 0;
  let worst = 0;
  let at = '';
  let cars = 0;
  const deadline = Date.now() + 240_000;
  while (crossings < 3 && Date.now() < deadline) {
    // track a moving car on screen (Follow keeps it in view)
    const pick = await page.evaluate(() => {
      const h = window.__livingcity!;
      for (let i = 0; i < h.snapshot().frameRecords; i++) {
        const v = h.frameVehicle(i);
        const p = h.vehicleScreenCenter(i);
        if (!v || v.queued || !p) continue;
        const free = [[0, 0], [-12, -12], [12, -12], [-12, 12], [12, 12]].every(([a, b]) => document.elementFromPoint(p[0] + a!, p[1] + b!)?.tagName === 'CANVAS');
        if (free && h.pickAt(p[0], p[1]).vehicle === i) return p;
      }
      return null;
    });
    if (!pick) {
      await sleep(500);
      continue;
    }
    await page.mouse.click(pick[0], pick[1]);
    await expect.poll(async () => (await snap(page)).trackedTrip, { timeout: 5_000 }).not.toBeNull();
    const follow = page.getByRole('region', { name: 'Selected vehicle' }).getByRole('button', { name: /^Follow/ });
    if (await follow.count()) await follow.click();
    cars++;
    // geometric continuity, sampled every animation frame for up to 40 s or until the car leaves
    const r = await page.evaluate(
      () =>
        new Promise<{ worst: number; at: string; crossings: number }>((resolve, reject) => {
          const h = window.__livingcity as unknown as Hook;
          let prev: TrackedDraw | null = null;
          let worst = 0;
          let at = '';
          let crossings = 0;
          const t0 = performance.now();
          const step = () => {
            try {
              const d = h.trackedDraw();
              if (!d || performance.now() - t0 > 40_000 || crossings >= 3) return resolve({ worst, at, crossings });
              if (prev) {
                const moved = Math.hypot(d.world[0] - prev.world[0], d.world[1] - prev.world[1]);
                let along: number;
                let exempt = false;
                if (d.link === prev.link) along = Math.abs(d.s - prev.s);
                else if (d.link === prev.next) {
                  // a crossing: the distance left on the old link plus the distance on the new one
                  along = prev.length - prev.s + d.s;
                  if (d.lane === prev.nextLane) crossings++;
                  else exempt = true; // the sim chose another entry lane than predicted: a lane move
                } else {
                  exempt = true; // rerouted between frames: no geometric claim
                  along = 0;
                }
                const excess = moved - (along + 0.9);
                if (!exempt && excess > worst) {
                  worst = excess;
                  at = `${prev.link}@${prev.s.toFixed(1)}→${d.link}@${d.s.toFixed(1)} lane ${prev.lane}→${d.lane}: moved ${moved.toFixed(2)} m, along ${along.toFixed(2)} m`;
                }
              }
              prev = d;
              requestAnimationFrame(step);
            } catch (e) {
              reject(e);
            }
          };
          requestAnimationFrame(step);
        }),
    );
    crossings += r.crossings;
    if (r.worst > worst) [worst, at] = [r.worst, r.at];
    await page.keyboard.press('Escape');
  }
  expect(crossings, `same-lane junction crossings observed (${cars} cars)`).toBeGreaterThanOrEqual(3);
  expect(worst, `no geometric jump beyond the along-route distance + 0.9 m: ${at}`).toBeLessThanOrEqual(0);
});

// 9
test('hover_differs_from_congestion_by_shape', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page, '/?demand=3');
  // wait until some visible link is congested (occupancy ≥ 0.8), then pause
  const target = async () =>
    page.evaluate(() => {
      const h = window.__livingcity!;
      const s = h.snapshot();
      for (let l = 0; l < s.linkCounts.length; l++) {
        if (s.linkCounts[l]! / h.linkCapacity(l) < 0.8) continue;
        const m = h.linkScreenPoint(l, 0.5);
        if (m && document.elementFromPoint(m[0], m[1])?.tagName === 'CANVAS') return m;
      }
      return null;
    });
  await expect.poll(target, { timeout: 120_000, intervals: [1000] }).not.toBeNull();
  await pause(page);
  await page.evaluate(() => window.__livingcity!.setDebug({ hideVehicles: true }));
  const focus = (await target())!;
  // a congested, long, visible link and an empty one
  const pickLinks = async () =>
    page.evaluate(() => {
      const h = window.__livingcity!;
      const s = h.snapshot();
      let congested = -1;
      let empty = -1;
      for (let l = 0; l < s.linkCounts.length; l++) {
        const a = h.linkScreenPoint(l, 0.3);
        const b = h.linkScreenPoint(l, 0.7);
        if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 90) continue;
        const ok = [a, b, h.linkScreenPoint(l, 0.5)!].every((p) => document.elementFromPoint(p[0], p[1])?.tagName === 'CANVAS');
        if (!ok) continue;
        const occ = s.linkCounts[l]! / h.linkCapacity(l);
        if (congested < 0 && occ >= 0.8) congested = l;
        if (empty < 0 && s.linkCounts[l] === 0) empty = l;
      }
      return { congested, empty };
    });
  await wheelZoom(page, focus, (z) => z >= 1.2, -1);
  const { congested, empty } = await pickLinks();
  expect(congested, 'a congested link in view').toBeGreaterThanOrEqual(0);
  expect(empty, 'an empty link in view').toBeGreaterThanOrEqual(0);
  /** Luminance along the link's drawn centreline (t 0.35 … 0.65), 1 sample per px. */
  const along = async (l: number) => {
    const pts = await page.evaluate((l) => {
      const h = window.__livingcity!;
      const a = h.linkScreenPoint(l, 0.35)!;
      const b = h.linkScreenPoint(l, 0.65)!;
      const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]));
      return Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as [number, number]);
    }, l);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const box = { x: Math.floor(Math.min(...xs)) - 2, y: Math.floor(Math.min(...ys)) - 2, w: Math.ceil(Math.max(...xs) - Math.min(...xs)) + 5, h: Math.ceil(Math.max(...ys) - Math.min(...ys)) + 5 };
    const px = await lum(page, [box.x + box.w / 2, box.y + box.h / 2], box.w, box.h);
    const left = Math.round(box.x + box.w / 2 - box.w / 2);
    const top = Math.round(box.y + box.h / 2 - box.h / 2);
    return pts.map(([x, y]) => px[(Math.round(y) - top) * box.w + (Math.round(x) - left)] ?? 0);
  };
  /** Dark→bright alternations along a profile (a dash pattern), relative to its own range. */
  const dashes = (p: number[]) => {
    const lo = Math.min(...p);
    const hi = Math.max(...p);
    if (hi - lo < 40) return 0;
    const mid = (lo + hi) / 2;
    let n = 0;
    for (let i = 1; i < p.length; i++) if (p[i - 1]! < mid && p[i]! >= mid) n++;
    return n;
  };
  const hover = async (l: number) => {
    const m = (await page.evaluate((l) => window.__livingcity!.linkScreenPoint(l, 0.5), l))!;
    await page.mouse.move(m[0], m[1]);
    await sleep(300);
  };
  const unhoveredCongested = await along(congested);
  await hover(congested);
  const hoveredCongested = await along(congested);
  await hover(empty);
  const hoveredEmpty = await along(empty);
  expect(dashes(hoveredCongested), 'hovered congested road: a dash pattern').toBeGreaterThanOrEqual(3);
  expect(dashes(hoveredEmpty), 'hovered empty road: a dash pattern').toBeGreaterThanOrEqual(3);
  expect(dashes(unhoveredCongested), 'unhovered congested road: no dash pattern').toBeLessThanOrEqual(1);
});

// 10
test('closed_road_marked_at_every_zoom', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page);
  await pause(page);
  // vehicles hidden for both measurements (moving cars are as bright as the glyph)
  await page.evaluate(() => window.__livingcity!.setDebug({ hideVehicles: true }));
  const lm = (await snap(page)).landmarks!;
  const link = lm.central_bridge[0]!;
  const mid = async () => (await page.evaluate((l) => window.__livingcity!.linkScreenPoint(l, 0.5), link))!;
  const counts = async () => {
    const px = await lum(page, await mid(), 14, 14);
    return { bright: px.filter((v) => v >= 220).length, dark: px.filter((v) => v <= 40).length };
  };
  const centre = await mid();
  const zooms: { label: string; ok: (z: number) => boolean; dir: -1 | 1 }[] = [
    { label: 'MIN_ZOOM 0.05', ok: (z) => z <= 0.0501, dir: 1 },
    { label: '0.07', ok: (z) => z >= 0.06 && z <= 0.08, dir: -1 },
    { label: '0.2', ok: (z) => z >= 0.17 && z <= 0.23, dir: -1 },
  ];
  const before: Record<string, { bright: number; dark: number }> = {};
  for (const z of zooms) {
    await wheelZoom(page, centre, z.ok, z.dir, 25);
    before[z.label] = await counts();
  }
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(lm.central_bridge));
  await pause(page);
  // the same zooms in the same order (out to the minimum, then in)
  for (const z of zooms) {
    await wheelZoom(page, await mid(), z.ok, z.dir, 25);
    const c = await counts();
    const b = before[z.label]!;
    expect(c.bright - b.bright, `${z.label}: the closure adds a bright marker (${b.bright} → ${c.bright})`).toBeGreaterThanOrEqual(12);
  }
});
