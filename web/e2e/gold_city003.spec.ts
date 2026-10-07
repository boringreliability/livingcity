// Ward city-003 Gold, regression tests for Gold review r1 findings (added in Gold;
// no approved Red test was changed).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// M1: Follow must be smooth: no lurch when a new tick arrives
test('fix M1: following at 1x moves the camera smoothly (no jump per tick)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThanOrEqual(450);
  await page.getByRole('combobox', { name: /speed/i }).selectOption({ label: '1×' });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(async () => {
      if ((await snap(page)).camera.zoom >= 2) return true;
      await page.mouse.wheel(0, -100);
      return false;
    }, { intervals: [100], timeout: 30_000 })
    .toBe(true);
  // a driving vehicle with route left
  const picked = await page.evaluate(() => {
    const h = window.__livingcity!;
    const out: [number, number][] = [];
    for (let i = 0; i < h.snapshot().frameRecords; i++) {
      const p = h.vehicleScreenCenter(i);
      if (p && document.elementFromPoint(p[0], p[1])?.tagName === 'CANVAS' && h.pickAt(p[0], p[1]).vehicle === i) out.push(p);
    }
    return out.slice(0, 20);
  });
  let ok = false;
  for (const p of picked) {
    await page.mouse.click(p[0], p[1]);
    await expect.poll(async () => (await snap(page)).trackedTrip).not.toBeNull();
    const s = await snap(page);
    if (s.trackedState === 'driving' && s.trackedRoute.length >= 2) {
      ok = true;
      break;
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
  }
  expect(ok).toBe(true);
  await page.getByRole('button', { name: /^follow$/i }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // When the sim starts (Play) and the camera centre is sampled every animation frame for 2 s,
  // from the moment of Play (Gold r2 M-A: the first ticks after Play must not lurch either)
  await page.keyboard.press('Space');
  const samples = await page.evaluate(
    () =>
      new Promise<{ d: number; dt: number }[]>((resolve) => {
        const out: { d: number; dt: number }[] = [];
        let last: { cx: number; cy: number; t: number } | null = null;
        const t0 = performance.now();
        const loop = (t: number) => {
          const c = window.__livingcity!.snapshot().camera;
          if (last) out.push({ d: Math.hypot(c.cx - last.cx, c.cy - last.cy), dt: (t - last.t) / 1000 });
          last = { cx: c.cx, cy: c.cy, t };
          if (performance.now() - t0 < 2000) requestAnimationFrame(loop);
          else resolve(out);
        };
        requestAnimationFrame(loop);
      }),
  );
  const steps = samples.map((x) => x.d);
  // Then it moves in small, even steps (a car at ≤ 60 km/h covers < 0.5 m per frame at 1×).
  // The bug lurched on every tick (2 per second at 1×: ~4 in this window). One step may be larger:
  // crossing a junction moves the car between two drawn link centrelines (all cars do that).
  // A lurch is a step not explained by elapsed time: more than the car's typical speed × dt + 2.5 m
  // (time-normalised, so a throttled frame rate in a busy test browser does not matter).
  expect(samples.length).toBeGreaterThanOrEqual(10);
  const rates = samples.filter((x) => x.dt > 0).map((x) => x.d / x.dt).sort((a, b) => a - b);
  const typical = rates[Math.floor(rates.length / 2)]!;
  expect(typical).toBeLessThan(20); // m/s: a car at city speed, not a camera jumping around
  const lurches = samples.filter((x) => x.d > typical * x.dt + 2.5);
  expect(lurches.length, JSON.stringify(lurches)).toBeLessThanOrEqual(1);
  expect(steps.reduce((a, b) => a + b, 0)).toBeGreaterThan(5); // it really followed a moving car
});
