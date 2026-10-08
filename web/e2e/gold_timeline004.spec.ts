// Ward timeline-004, Gold r1 regressions (the approved spec stays frozen): disabled controls look
// disabled without hue (MAJOR 1), and the side labels cover no road (MINOR 2).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

async function comparing(page: Page) {
  await page.goto('/');
  await expect.poll(async () => (await snap(page)).timeline.headTick, { timeout: 60_000 }).toBeGreaterThan(2400);
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
  const slider = page.getByRole('slider', { name: 'Timeline' });
  await slider.focus();
  const p = (await snap(page)).timeline.positionTick;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p - 120);
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
}

test('disabled controls look disabled while comparing (no hue needed)', async ({ page }) => {
  await comparing(page);
  for (const loc of [
    page.getByRole('button', { name: /close the main bridge/i }),
    page.getByRole('button', { name: 'A: original' }),
    page.getByRole('button', { name: /^B: branch from/ }),
  ]) {
    await expect(loc).toBeDisabled();
    const st = await loc.evaluate((el) => {
      const c = getComputedStyle(el);
      return { opacity: Number(c.opacity), cursor: c.cursor, border: c.borderTopStyle };
    });
    expect(st.opacity).toBeLessThan(0.6);
    expect(st.cursor).toBe('not-allowed');
    expect(st.border).toBe('dashed');
  }
  // and the enabled ones do not
  const on = await page.getByRole('button', { name: 'Compare side by side' }).evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(on).toBe(1);
});

for (const size of [
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
]) {
  test(`side labels cover no road (${size.width}×${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await comparing(page);
    const covered = await page.evaluate(() => {
      const h = window.__livingcity!;
      const n = h.snapshot().linkCounts.length;
      let bad = 0;
      for (let l = 0; l < n; l++) {
        for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          for (const p of [h.linkScreenPoint(l, t), h.linkScreenPointB(l, t)]) {
            if (!p) continue;
            if (document.elementFromPoint(p[0], p[1])?.closest('.side-label')) bad++;
          }
        }
      }
      return bad;
    });
    expect(covered).toBe(0);
  });
}
