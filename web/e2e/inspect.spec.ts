// Ward city-003: inspect and follow vehicles, inspect roads (River City).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot | null> =>
  page.evaluate(() => window.__livingcity?.snapshot() ?? null);
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ready(page: Page): Promise<LivingCitySnapshot> {
  await page.goto('/');
  await expect.poll(async () => (await snap(page))?.tick ?? 0, { timeout: 30_000 }).toBeGreaterThan(10);
  // let traffic build up a little
  await expect.poll(async () => (await snap(page))!.frameRecords, { timeout: 30_000 }).toBeGreaterThan(300);
  return (await snap(page))!;
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page))!.running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page))!.running).toBe(false);
  await sleep(300);
}

/** A record whose centre is on the canvas (not under an overlay) and picks exactly that record. */
async function clickableVehicle(page: Page): Promise<{ record: number; at: [number, number] }> {
  const found = await page.evaluate(() => {
    const h = window.__livingcity!;
    const n = h.snapshot().frameRecords;
    for (let i = 0; i < n; i += 7) {
      const p = h.vehicleScreenCenter(i);
      if (!p) continue;
      if (document.elementFromPoint(p[0], p[1])?.tagName !== 'CANVAS') continue;
      const pick = h.pickAt(p[0], p[1]);
      if (pick.vehicle === i) return { record: i, at: p };
    }
    return null;
  });
  expect(found).not.toBeNull();
  return found!;
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

/** Luminance (0–255) per pixel of a page clip. */
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

// 11
test('click_vehicle_opens_panel', async ({ page }) => {
  await ready(page);
  await pause(page);
  const v = await clickableVehicle(page);
  // When the user clicks the vehicle
  await page.mouse.click(v.at[0], v.at[1]);
  // Then it is tracked and the panel names its trip with district names
  await expect.poll(async () => (await snap(page))!.trackedTrip).not.toBeNull();
  const panel = page.getByRole('region', { name: 'Selected vehicle' });
  await expect(panel).toBeVisible();
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
  const v = await clickableVehicle(page);
  await page.mouse.move(5, 400);
  await sleep(200);
  const ringBefore = light(await luminance(page, v.at, 30, 30));
  await page.mouse.click(v.at[0], v.at[1]);
  await expect.poll(async () => (await snap(page))!.trackedRoute.length).toBeGreaterThan(0);
  await page.mouse.move(5, 400);
  await sleep(300);
  const s = (await snap(page))!;
  // Then a light ring appears around the vehicle
  const ringAfter = light(await luminance(page, v.at, 30, 30));
  expect(ringAfter - ringBefore).toBeGreaterThanOrEqual(12);
  // And a light dashed line runs along a remaining route link (the next one, else the current)
  const routeLink = s.trackedRoute[1] ?? s.trackedRoute[0]!;
  const mid = (await page.evaluate((l) => window.__livingcity!.linkScreenCenter(l), routeLink))!;
  expect(mid).not.toBeNull();
  await blur(page);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page))!.trackedTrip).toBeNull();
  await sleep(300);
  const routeBefore = light(await luminance(page, mid, 24, 24));
  await page.mouse.click(v.at[0], v.at[1]);
  await expect.poll(async () => (await snap(page))!.trackedTrip).not.toBeNull();
  await page.mouse.move(5, 400);
  await sleep(300);
  const routeAfter = light(await luminance(page, mid, 24, 24));
  expect(routeAfter - routeBefore).toBeGreaterThanOrEqual(6);
});

// 13
test('follow_keeps_vehicle_centred', async ({ page }) => {
  await ready(page);
  await page.getByRole('combobox', { name: /speed/i }).selectOption({ label: '1×' });
  await pause(page);
  const v = await clickableVehicle(page);
  await page.mouse.click(v.at[0], v.at[1]);
  await page.getByRole('button', { name: /^follow$/i }).click();
  await expect.poll(async () => (await snap(page))!.following).toBe(true);
  // When the sim runs
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page))!.running).toBe(true);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const centre: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  // Then the tracked vehicle stays at the canvas centre
  for (let k = 0; k < 6; k++) {
    await sleep(500);
    const p = await page.evaluate(() => window.__livingcity!.trackedScreenCenter());
    if (p === null) break; // arrived: following ends (covered by test 14)
    expect(Math.hypot(p[0] - centre[0], p[1] - centre[1])).toBeLessThanOrEqual(12);
  }
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
  const v = await clickableVehicle(page);
  await page.mouse.click(v.at[0], v.at[1]);
  await page.getByRole('button', { name: /^follow$/i }).click();
  await page.getByRole('combobox', { name: /speed/i }).selectOption({ label: '60×' });
  await blur(page);
  await page.keyboard.press('Space');
  // Then, when the trip ends, the panel says so and following stops
  await expect(page.getByRole('region', { name: 'Selected vehicle' })).toContainText(
    /Arrived after \d+:\d\d|Removed: (no route|gridlock)/,
    { timeout: 90_000 },
  );
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
  // Then the Old Bridge shows its limited capacity and travel time now vs free flow
  await expect(page.getByTestId('link-capacity')).toHaveText(/veh\/h/);
  expect(await num('link-capacity')).toBeLessThanOrEqual(900);
  expect(await num('link-freeflow')).toBeGreaterThan(0);
  expect(await num('link-cost')).toBeGreaterThanOrEqual(await num('link-freeflow'));
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
  // Given a selected road and a selected vehicle
  const road = s0.landmarks!.north_bridge[0];
  const p = await clickableRoadPoint(page, road);
  await page.mouse.click(p[0], p[1]);
  await expect.poll(async () => (await snap(page))!.selectedLink).toBe(road);
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
