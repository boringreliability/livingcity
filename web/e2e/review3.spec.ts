// Ward core-005, test 21: proposed and verified against a prototype by the Red
// reviewer, round 3 (zoom about the cursor in CSS px, also at DPR 2).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot | null> =>
  page.evaluate(() => window.__livingcity?.snapshot() ?? null);
async function ready(page: Page): Promise<LivingCitySnapshot> {
  await page.goto('/');
  await expect.poll(async () => (await snap(page))?.tick ?? 0).toBeGreaterThan(10);
  return (await snap(page))!;
}
const center = async (page: Page, l: number) => page.evaluate((x) => window.__livingcity!.linkScreenCenter(x), l);

// W1: the wheel zooms about the cursor (CSS px, also at DPR 2); the rate is not assumed
test.describe('HiDPI wheel', () => {
  test.use({ deviceScaleFactor: 2 });
  test('fix W1: the mouse wheel zooms about the cursor', async ({ page }) => {
    const s0 = await ready(page);
    const link = s0.landmarks!.north_bridge[0];
    const vw = page.viewportSize()!;
    // Given the cursor on a road centre well away from the viewport centre
    const p = (await center(page, link))!;
    expect(Math.hypot(p[0] - vw.width / 2, p[1] - vw.height / 2)).toBeGreaterThan(100);
    await page.mouse.move(p[0], p[1]);
    const probe = s0.landmarks!.south_bridge[0];
    const before = (await center(page, probe))!;
    // When the wheel is turned one notch at a time until the view changes
    await expect
      .poll(async () => {
        const c = await center(page, probe);
        if (c === null || Math.hypot(c[0] - before[0], c[1] - before[1]) > 2) return true;
        await page.mouse.wheel(0, -100);
        return false;
      }, { intervals: [150], timeout: 30_000 })
      .toBe(true);
    // Then the road centre under the cursor stays under the cursor
    const q = (await center(page, link))!;
    expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeLessThan(3);
  });
});
