// Ward city-003: inspect and follow vehicles, inspect roads (River City).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot | null> =>
  page.evaluate(() => window.__livingcity?.snapshot() ?? null);
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const panel = (page: Page) => page.getByRole('region', { name: 'Selected vehicle' });

async function ready(page: Page): Promise<LivingCitySnapshot> {
  await page.goto('/');
  await expect.poll(async () => (await snap(page))?.tick ?? 0, { timeout: 30_000 }).toBeGreaterThan(10);
  // let traffic build up: from tick ≈ 450 the zoomed view at the centre (Main Bridge) holds
  // 13–26 vehicles; at the default 20× this is ~11 s (Red r2 B1)
  await expect.poll(async () => (await snap(page))!.frameRecords, { timeout: 30_000 }).toBeGreaterThan(300);
  await expect.poll(async () => (await snap(page))!.tick, { timeout: 60_000 }).toBeGreaterThanOrEqual(450);
  return (await snap(page))!;
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page))!.running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page))!.running).toBe(false);
  await sleep(300);
}

/** Wheel-zoom at the canvas centre until the camera is at least `min` px/m (the wheel rate is not assumed). */
async function zoomIn(page: Page, min: number) {
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(async () => {
      if ((await snap(page))!.camera.zoom >= min) return true;
      await page.mouse.wheel(0, -100);
      return false;
    }, { intervals: [100], timeout: 30_000 })
    .toBe(true);
  await page.mouse.move(5, 400);
  await sleep(200);
}

/** Records whose centre is on the canvas (not under an overlay) and whose click picks exactly them. */
async function clickableVehicles(page: Page, max = 40): Promise<{ record: number; at: [number, number] }[]> {
  return page.evaluate((max) => {
    const h = window.__livingcity!;
    const n = h.snapshot().frameRecords;
    const out: { record: number; at: [number, number] }[] = [];
    for (let i = 0; i < n && out.length < max; i++) {
      const p = h.vehicleScreenCenter(i);
      if (!p) continue;
      const onCanvas = [[0, 0], [-16, -16], [16, -16], [-16, 16], [16, 16]].every(
        ([dx, dy]) => document.elementFromPoint(p[0] + dx!, p[1] + dy!)?.tagName === 'CANVAS',
      );
      if (onCanvas && h.pickAt(p[0], p[1]).vehicle === i) out.push({ record: i, at: p });
    }
    return out;
  }, max);
}

async function clickableVehicle(page: Page): Promise<{ record: number; at: [number, number] }> {
  const all = await clickableVehicles(page, 1);
  expect(all.length).toBeGreaterThan(0);
  return all[0]!;
}

/** A point on `link` where a click picks the road, not a vehicle. */
async function clickableRoadPoint(page: Page, link: number): Promise<[number, number]> {
  const p = await page.evaluate((l) => {
    const h = window.__livingcity!;
    for (let k = 1; k < 20; k++) {
      const q = h.linkScreenPoint(l, k / 20);
      if (!q || document.elementFromPoint(q[0], q[1])?.tagName !== 'CANVAS') continue;
      const pick = h.pickAt(q[0], q[1]);
      if (pick.vehicle === null && pick.link === l) return q;
    }
    return null;
  }, link);
  expect(p).not.toBeNull();
  return p!;
}

/** Luminance (0–255) per pixel of a page clip (row-major, w × h at DPR 1). */
async function luminance(page: Page, [x, y]: [number, number], w: number, h: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: x - w / 2, y: y - h / 2, width: w, height: h } });
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
const light = (lum: number[]) => lum.filter((v) => v >= 235).length;

/** Near-white pixels on each side, farther than `band` px from the line through the box centre
 * along unit `dir`. A ring is symmetric; a route line beside the vehicle is one-sided (Red r2). */
function lightOffAxisSides(lum: number[], w: number, h: number, dir: [number, number], band = 4): [number, number] {
  const n: [number, number] = [0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - w / 2;
      const dy = y + 0.5 - h / 2;
      const perp = dx * dir[1] - dy * dir[0];
      if (Math.abs(perp) > band && lum[y * w + x]! >= 235) n[perp > 0 ? 0 : 1]++;
    }
  return n;
}
const onCanvasBox = (page: Page, [x, y]: [number, number], r: number) =>
  page.evaluate(
    ([x, y, r]) =>
      [[x, y], [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]].every(
        ([a, b]) => document.elementFromPoint(a!, b!)?.tagName === 'CANVAS',
      ),
    [x, y, r] as const,
  );

// 11
test('click_vehicle_opens_panel', async ({ page }) => {
  await ready(page);
  await pause(page);
  await zoomIn(page, 1.5);
  const v = await clickableVehicle(page);
  // When the user clicks the vehicle (zoomed in: vehicles are pickable)
  await page.mouse.click(v.at[0], v.at[1]);
  // Then it is tracked and the panel names its trip with district names
  await expect.poll(async () => (await snap(page))!.trackedTrip).not.toBeNull();
  await expect(panel(page)).toBeVisible();
  const title = page.getByTestId('vehicle-title');
  await expect(title).toHaveText(/^Trip #\d+: .+ → .+$/);
  await expect(title).not.toHaveText(/node \d+/);
  // and a road was not selected by that click
  expect((await snap(page))!.selectedLink).toBeNull();
});

// 12
test('tracked_vehicle_ring_and_route_visible', async ({ page }) => {
  await ready(page);
  await pause(page);
  await zoomIn(page, 1.5);
  // Find a vehicle with a remaining route link ≥ 30 px away on the canvas (try several candidates)
  for (const v of await clickableVehicles(page, 12)) {
    const ringBeforeLum = await luminance(page, v.at, 30, 30);
    await page.mouse.click(v.at[0], v.at[1]);
    await expect.poll(async () => (await snap(page))!.trackedRoute.length).toBeGreaterThan(0);
    await page.mouse.move(5, 400);
    await sleep(300);
    const s = (await snap(page))!;
    const route = s.trackedRoute;
    let target: { l: number; mid: [number, number] } | null = null;
    for (const l of route) {
      const mid = await page.evaluate((x) => window.__livingcity!.linkScreenCenter(x), l);
      if (mid && Math.hypot(mid[0] - v.at[0], mid[1] - v.at[1]) >= 30 && (await onCanvasBox(page, mid, 12))) {
        target = { l, mid };
        break;
      }
    }
    if (!target || !(await onCanvasBox(page, v.at, 15))) {
      await blur(page);
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await snap(page))!.trackedTrip).toBeNull();
      await sleep(300);
      continue;
    }
    // Then a near-white ring appears around the vehicle, off the road axis (not just the route line)
    const a = (await page.evaluate((l) => window.__livingcity!.linkScreenPoint(l, 0), route[0]!))!;
    const b = (await page.evaluate((l) => window.__livingcity!.linkScreenPoint(l, 1), route[0]!))!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const before = lightOffAxisSides(ringBeforeLum, 30, 30, dir);
    const after = lightOffAxisSides(await luminance(page, v.at, 30, 30), 30, 30, dir);
    const delta: [number, number] = [after[0] - before[0], after[1] - before[1]];
    // on both sides of the vehicle (a one-sided route line cannot fake it), and in total
    expect(delta[0]).toBeGreaterThanOrEqual(4);
    expect(delta[1]).toBeGreaterThanOrEqual(4);
    expect(delta[0] + delta[1]).toBeGreaterThanOrEqual(12);
    // And a near-white dashed line runs along a remaining route link ≥ 30 px away
    const routeAfter = light(await luminance(page, target.mid, 24, 24));
    await blur(page);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await snap(page))!.trackedTrip).toBeNull();
    await sleep(300);
    const routeBefore = light(await luminance(page, target.mid, 24, 24));
    expect(routeAfter - routeBefore).toBeGreaterThanOrEqual(6);
    return;
  }
  throw new Error('no candidate vehicle with a remaining route link ≥ 30 px away on the canvas');
});

// 13
test('follow_keeps_vehicle_centred', async ({ page }) => {
  await ready(page);
  await page.getByRole('combobox', { name: /speed/i }).selectOption({ label: '1×' });
  await pause(page);
  await zoomIn(page, 2);
  // Given a driving vehicle (not queued), followed
  let found = false;
  for (const v of await clickableVehicles(page, 20)) {
    await page.mouse.click(v.at[0], v.at[1]);
    await expect.poll(async () => (await snap(page))!.trackedTrip).not.toBeNull();
    const st = (await snap(page))!;
    if (st.trackedState === 'driving' && st.trackedRoute.length >= 2) {
      found = true;
      break;
    }
    await blur(page);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await snap(page))!.trackedTrip).toBeNull();
  }
  expect(found).toBe(true);
  await page.getByRole('button', { name: /^follow$/i }).click();
  await expect.poll(async () => (await snap(page))!.following).toBe(true);
  // When the sim runs
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page))!.running).toBe(true);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const centre: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  // Then the tracked vehicle stays at the canvas centre while the camera moves with it
  let samples = 0;
  const c0 = (await snap(page))!.camera;
  for (let k = 0; k < 6; k++) {
    await sleep(500);
    const p = await page.evaluate(() => window.__livingcity!.trackedScreenCenter());
    if (p === null) {
      await expect(panel(page)).toContainText(/Arrived after|Removed:/);
      break;
    }
    samples++;
    expect(Math.hypot(p[0] - centre[0], p[1] - centre[1])).toBeLessThanOrEqual(12);
  }
  const c1 = (await snap(page))!.camera;
  expect(samples).toBeGreaterThanOrEqual(4);
  expect(Math.hypot(c1.cx - c0.cx, c1.cy - c0.cy)).toBeGreaterThanOrEqual(5);
  // And a drag turns follow off
  await page.mouse.move(centre[0] + 40, centre[1] + 40);
  await page.mouse.down();
  await page.mouse.move(centre[0] + 120, centre[1] + 90, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await snap(page))!.following).toBe(false);
});

// 14
test('vehicle_gone_message', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  await pause(page);
  await zoomIn(page, 1.5);
  const v = await clickableVehicle(page);
  await page.mouse.click(v.at[0], v.at[1]);
  await page.getByRole('button', { name: /^follow$/i }).click();
  await page.getByRole('combobox', { name: /speed/i }).selectOption({ label: '60×' });
  await blur(page);
  await page.keyboard.press('Space');
  // Then, when the trip ends, the panel says so and following stops
  await expect(panel(page)).toContainText(/Arrived after \d+:\d\d|Removed: (no route|gridlock)/, { timeout: 90_000 });
  await expect.poll(async () => (await snap(page))!.following).toBe(false);
});

// 15
test('road_panel_real_stats', async ({ page }) => {
  test.setTimeout(120_000);
  const s0 = await ready(page);
  await pause(page);
  const old = s0.landmarks!.south_bridge[0];
  const p = await clickableRoadPoint(page, old);
  await page.mouse.click(p[0], p[1]);
  await expect.poll(async () => (await snap(page))!.selectedLink).toBe(old);
  const num = async (id: string) => Number(((await page.getByTestId(id).textContent()) ?? '').replace(/[^0-9.]/g, ''));
  // Then the Old Bridge shows its limited capacity and travel time now vs free flow (pinned formats)
  await expect(page.getByTestId('link-capacity')).toHaveText(/^\d+ veh\/h$/);
  await expect(page.getByTestId('link-cost')).toHaveText(/^\d+(\.\d)? s$/);
  await expect(page.getByTestId('link-freeflow')).toHaveText(/^\d+(\.\d)? s$/);
  expect(await num('link-capacity')).toBeLessThanOrEqual(900);
  expect(await num('link-freeflow')).toBeGreaterThan(0);
  expect(await num('link-cost')).toBeGreaterThanOrEqual(await num('link-freeflow'));
  // (precondition: not already congested before the closure)
  expect(await num('link-cost')).toBeLessThanOrEqual((await num('link-freeflow')) + 1);
  // When the main bridge closes, the Old Bridge's travel time rises above free flow (≤ 6 sim min at 20×)
  await page.getByRole('combobox', { name: /speed/i }).selectOption({ label: '20×' });
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await blur(page);
  await page.keyboard.press('Space');
  const t0 = (await snap(page))!.tick;
  await expect
    .poll(async () => (await num('link-cost')) > (await num('link-freeflow')) + 1, { timeout: 90_000 })
    .toBe(true);
  expect((await snap(page))!.tick - t0).toBeLessThanOrEqual(6 * 120 + 240);
});

// 16
test('keyboard_escape_order', async ({ page }) => {
  const s0 = await ready(page);
  await pause(page);
  // Given a selected road (fit zoom) and a selected vehicle (zoomed in)
  const road = s0.landmarks!.central_bridge[0];
  const p = await clickableRoadPoint(page, road);
  await page.mouse.click(p[0], p[1]);
  await expect.poll(async () => (await snap(page))!.selectedLink).toBe(road);
  await zoomIn(page, 1.5);
  const v = await clickableVehicle(page);
  await page.mouse.click(v.at[0], v.at[1]);
  await expect.poll(async () => (await snap(page))!.trackedTrip).not.toBeNull();
  expect((await snap(page))!.selectedLink).toBe(road);
  // The Follow button is reachable with Tab and works with Enter
  await blur(page);
  let onFollow = false;
  for (let k = 0; k < 25 && !onFollow; k++) {
    await page.keyboard.press('Tab');
    onFollow = await page.evaluate(() => /^follow$/i.test(document.activeElement?.textContent?.trim() ?? ''));
  }
  expect(onFollow).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snap(page))!.following).toBe(true);
  // When Escape is pressed (outside a control): first the vehicle, then the road
  await blur(page);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page))!.trackedTrip).toBeNull();
  expect((await snap(page))!.selectedLink).toBe(road);
  expect((await snap(page))!.following).toBe(false);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page))!.selectedLink).toBeNull();
});

// 17
test('fit_zoom_clicks_select_roads_not_vehicles', async ({ page }) => {
  // (Red r1 M3: the network dominates at wide zoom; vehicles are pickable from VEHICLE_PICK_MIN_ZOOM)
  await ready(page);
  await pause(page);
  const s = (await snap(page))!;
  expect(s.camera.zoom).toBeLessThan(1);
  // Given vehicle centres on the canvas at fit zoom
  const centres = await page.evaluate(() => {
    const h = window.__livingcity!;
    const out: [number, number][] = [];
    for (let i = 0; i < h.snapshot().frameRecords && out.length < 30; i += 11) {
      const p = h.vehicleScreenCenter(i);
      if (p && document.elementFromPoint(p[0], p[1])?.tagName === 'CANVAS') out.push(p);
    }
    return out;
  });
  expect(centres.length).toBeGreaterThan(10);
  // Then a click there would never pick a vehicle, and picks the road under it
  for (const c of centres) {
    const pick = await page.evaluate(([x, y]) => window.__livingcity!.pickAt(x, y), c);
    expect(pick.vehicle).toBeNull();
    expect(pick.link).not.toBeNull();
  }
  // And clicking one of them selects a road and tracks no vehicle
  await page.mouse.click(centres[0]![0], centres[0]![1]);
  await expect.poll(async () => (await snap(page))!.selectedLink).not.toBeNull();
  expect((await snap(page))!.trackedTrip).toBeNull();
});
