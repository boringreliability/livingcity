// Ward timeline-003, Gold r1 regressions (the approved spec stays frozen): the scenario panel
// covers neither the city nor the road panel (MAJOR 1), and a pending main-bridge state never
// outlives a seek (MAJOR 2).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const slider = (page: Page) => page.getByRole('slider', { name: 'Timeline' });

async function ready(page: Page) {
  await page.goto('/');
  await expect.poll(async () => (await snap(page)).timeline.headTick, { timeout: 60_000 }).toBeGreaterThan(2400);
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}

async function stepBack(page: Page): Promise<number> {
  await slider(page).focus();
  const p = (await snap(page)).timeline.positionTick;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p - 120);
  return p - 120;
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
]) {
  test(`scenario panel covers no road and no side panel (${size.width}×${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await ready(page);
    await pause(page);
    await stepBack(page);
    await page.getByRole('button', { name: /close the main bridge/i }).click();
    await expect(page.getByRole('region', { name: 'Scenarios' })).toBeVisible();
    // every road point at fit zoom is still the city canvas
    const covered = await page.evaluate(() => {
      const h = window.__livingcity!;
      const city = document.querySelector('canvas.city');
      const n = h.snapshot().linkCounts.length;
      let bad = 0;
      for (let l = 0; l < n; l++) {
        for (const t of [0.25, 0.5, 0.75]) {
          const p = h.linkScreenPoint(l, t);
          if (!p || p[0] < 0 || p[1] < 0 || p[0] > innerWidth || p[1] > innerHeight) continue;
          const el = document.elementFromPoint(p[0], p[1]);
          if (el !== city && !el?.closest('.labels') && el?.closest('.scenarios')) bad++;
        }
      }
      return bad;
    });
    expect(covered).toBe(0);
    // with a road selected, the road panel does not overlap the scenario panel
    const lm = (await snap(page)).landmarks!;
    const p = (await page.evaluate((l) => window.__livingcity!.linkScreenCenter(l), lm.north_bridge[0]))!;
    await page.mouse.click(p[0], p[1]);
    const road = page.getByRole('region', { name: 'Selected road' });
    await expect(road).toBeVisible();
    const a = (await road.boundingBox())!;
    const b = (await page.getByRole('region', { name: 'Scenarios' }).boundingBox())!;
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap).toBe(false);
  });
}

test('a pending main-bridge state never outlives a seek', async ({ page }) => {
  await ready(page);
  await pause(page);
  const central = (await snap(page)).landmarks!.central_bridge;
  const bridge = page.getByRole('button', { name: /close the main bridge/i });
  // at A's head, paused: B → pending close
  await blur(page);
  await page.keyboard.press('b');
  await expect(bridge).toContainText(/pending/i);
  // a seek back: the view shows the bridge open, and nothing is pending any more
  await stepBack(page);
  await expect(bridge).not.toContainText(/pending/i);
  await expect(bridge).toContainText('Close the main bridge');
  // pressing B now branches with a *close* of the bridge
  await blur(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await expect(bridge).toContainText(/pending/i); // B shows the pending close until it runs
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(central));
  await expect(bridge).not.toContainText(/pending/i);
});
