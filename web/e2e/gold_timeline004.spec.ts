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
    expect(st.border).toBe('dotted'); // dashed stays B's pattern
  }
  // and the enabled ones do not
  const on = await page.getByRole('button', { name: 'Compare side by side' }).evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(on).toBe(1);
});

for (const size of [
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
  { width: 1100, height: 800 },
  { width: 1024, height: 768 },
]) {
  test(`side labels are visible and cover no road or panel (${size.width}×${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await comparing(page);
    // geometric (the labels ignore pointer events, so hit-testing cannot see them)
    const r = await page.evaluate(() => {
      const h = window.__livingcity!;
      const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
      const labels = [...document.querySelectorAll('.side-label')].map((e) => ({ text: e.textContent, r: rect(e)! }));
      const inside = (p: [number, number], b: DOMRect) => p[0] >= b.left && p[0] <= b.right && p[1] >= b.top && p[1] <= b.bottom;
      const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const n = h.snapshot().linkCounts.length;
      let roads = 0;
      for (let l = 0; l < n; l++)
        for (const t of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1])
          for (const p of [h.linkScreenPoint(l, t), h.linkScreenPointB(l, t)])
            if (p && labels.some((x) => inside(p, x.r))) roads++;
      const panels = ['.scenarios', '.comparison', '.controls', '.timeline', '.side']
        .flatMap((sel) => [...document.querySelectorAll(sel)].map((e) => [sel, rect(e)!] as const))
        .filter(([, b]) => b.width > 0 && b.height > 0);
      const covered = labels.flatMap((x) => panels.filter(([, b]) => overlap(x.r, b)).map(([sel]) => `${x.text} under ${sel}`));
      const a = rect(document.querySelector('canvas.city'))!;
      const bb = rect(document.querySelector('canvas.city-b'))!;
      return {
        texts: labels.map((x) => x.text),
        roads,
        covered,
        inA: labels[0] ? labels[0].r.left >= a.left && labels[0].r.right <= a.right : false,
        inB: labels[1] ? labels[1].r.left >= bb.left && labels[1].r.right <= bb.right : false,
      };
    });
    expect(r.texts).toEqual(['A: original', 'B: branch']);
    expect(r.roads).toBe(0);
    expect(r.covered).toEqual([]);
    expect(r.inA && r.inB).toBe(true);
  });
}
