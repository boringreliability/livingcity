// Ward city-002: the app opens on River City; the core test city stays reachable.
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot | null> =>
  page.evaluate(() => window.__livingcity?.snapshot() ?? null);

async function ready(page: Page, url = '/'): Promise<LivingCitySnapshot> {
  await page.goto(url);
  await expect.poll(async () => (await snap(page))?.tick ?? 0, { timeout: 30_000 }).toBeGreaterThan(10);
  return (await snap(page))!;
}

// 15
test('the app opens on River City and closes its Main Bridge', async ({ page }) => {
  const s0 = await ready(page);
  // Then the city is River City, with traffic
  expect(s0.city).toBe('river_city');
  await expect.poll(async () => (await snap(page))!.metrics['on_network'] ?? 0, { timeout: 30_000 }).toBeGreaterThan(50);
  // And the metric strip still reads the core metrics by name
  expect(s0.metrics['active']).toBeGreaterThan(0);
  expect(s0.metrics).toHaveProperty('unserved');
  // When the user presses "Close the main bridge"
  const main = s0.landmarks!.central_bridge;
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  // Then both River City Main Bridge links are closed (confirmed by a frame)
  await expect
    .poll(async () => {
      const closed = (await snap(page))!.closed;
      return main.every((l) => closed.includes(l));
    })
    .toBe(true);
  // And each Main Bridge link is drawn on screen (both ends of the bridge are in view at fit zoom)
  for (const l of main) {
    expect(await page.evaluate((x) => window.__livingcity!.linkScreenCenter(x), l)).not.toBeNull();
  }
});

// 16
test('?city=three_bridges opens the core test city', async ({ page }) => {
  const s = await ready(page, '/?city=three_bridges');
  expect(s.city).toBe('three_bridges');
  // and an unknown city name falls back to River City
  const r = await ready(page, '/?city=atlantis');
  expect(r.city).toBe('river_city');
  // and the worker really built a different city (not only the label): River City has more links
  expect(r.linkCounts.length).toBeGreaterThan(s.linkCounts.length);
});
