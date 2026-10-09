// Ward polish-004, Gold r1 regressions (the approved guide spec stays frozen): the completed guide fits its
// column (the hide button stays on screen), and the control panel stays in the top band with the bridge closed.
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const guide = (page: Page) => page.getByRole('region', { name: 'Demo guide' });

async function ready(page: Page) {
  await page.goto('/');
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 768, height: 800 },
]) {
  test(`the completed guide fits its column (${size.width})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(size);
    await ready(page);
    await page.getByRole('combobox', { name: 'Speed' }).selectOption('60');
    await blur(page);
    const lm = (await snap(page)).landmarks!;
    await page.getByRole('button', { name: /close the main bridge/i }).click();
    await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(lm.central_bridge));
    const t = (await snap(page)).tick;
    await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThan(t + 400);
    await pause(page);
    const slider = page.getByRole('slider', { name: 'Timeline' });
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('b');
    await expect.poll(async () => (await snap(page)).scenario).toBe('B');
    await page.getByRole('button', { name: 'Compare side by side' }).click();
    await expect.poll(async () => (await snap(page)).compare).toBe(true);
    await page.getByRole('button', { name: 'Compare side by side' }).click();
    await expect.poll(async () => (await snap(page)).compare).toBe(false);
    await expect(guide(page)).toContainText(/demo complete/i);
    const r = await page.evaluate(() => {
      const g = document.querySelector('section[aria-label="Demo guide"]')!.getBoundingClientRect();
      const side = document.querySelector('.side')!.getBoundingClientRect();
      const hide = document.querySelector('button[aria-label="Hide demo guide"]')!.getBoundingClientRect();
      return { g: [g.left, g.right], side: [side.left, side.right], hide: [hide.left, hide.right], vw: window.innerWidth };
    });
    expect(r.g[1], 'guide inside its column').toBeLessThanOrEqual(r.side[1]! + 0.5);
    expect(r.hide[1], 'hide button on screen').toBeLessThanOrEqual(r.vw);
    await guide(page).getByRole('button', { name: 'Hide demo guide' }).click();
    await expect(guide(page)).toBeHidden();
  });
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
]) {
  test(`the control panel stays in the top band with the bridge closed or pending (${size.width})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await ready(page);
    const check = async (label: string) => {
      const r = await page.evaluate(() => {
        const c = document.querySelector('section.controls')!.getBoundingClientRect();
        const h = window.__livingcity!;
        let roads = 0;
        for (let l = 0; l < h.snapshot().linkCounts.length; l++)
          for (let k = 0; k < 10; k++) {
            const q = h.linkScreenPoint(l, 0.05 + k * 0.1);
            if (q && q[0] >= c.left && q[0] <= c.right && q[1] >= c.top && q[1] <= c.bottom) roads++;
          }
        return { bottom: c.bottom, roads };
      });
      expect(r.bottom, `${label}: control panel bottom`).toBeLessThanOrEqual(120);
      expect(r.roads, `${label}: roads under the control panel`).toBe(0);
    };
    await check('open');
    const lm = (await snap(page)).landmarks!;
    await page.getByRole('button', { name: /close the main bridge/i }).click();
    await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(lm.central_bridge));
    await check('closed');
    // pending: reopen while paused
    await pause(page);
    await page.getByRole('button', { name: /close the main bridge/i }).click();
    await expect(page.getByRole('button', { name: /close the main bridge/i })).toContainText('(pending)');
    await check('pending');
  });
}
