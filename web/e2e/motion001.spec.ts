// Ward motion-001, test 8: a paused app is quiet (the UI receives ~no frames) and still responsive.
import { expect, test, type Page } from '@playwright/test';

type Snap = { tick: number; running: boolean; renderFrames: number; camera: { zoom: number }; selectedLink: number | null; framesReceived?: number };
const snap = (page: Page): Promise<Snap> => page.evaluate(() => window.__livingcity!.snapshot() as unknown as Snap);

test('8 paused_app_is_quiet_and_responsive', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThan(1800);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
  await page.waitForTimeout(2000); // settle
  const a = await snap(page);
  expect(typeof a.framesReceived, 'the hook counts received frames').toBe('number');
  await page.waitForTimeout(3000);
  const b = await snap(page);
  expect(b.framesReceived! - a.framesReceived!, 'paused: about no frames').toBeLessThanOrEqual(1);
  expect(b.tick).toBe(a.tick);

  // hover: the hovered road gets its dashed stroke (paused: nothing else moves on screen)
  const north = await page.evaluate(() => {
    const h = window.__livingcity!;
    const r = h.snapshot() as unknown as { landmarks?: { north_bridge: number[] } };
    return r.landmarks!.north_bridge[0]!;
  });
  const p = (await page.evaluate((l) => window.__livingcity!.linkScreenPoint(l, 0.5), north))!;
  const clip = { x: Math.round(p[0]) - 20, y: Math.round(p[1]) - 20, width: 40, height: 40 };
  await page.mouse.move(3, 3);
  await page.waitForTimeout(400);
  const before = await page.screenshot({ clip });
  await page.mouse.move(p[0], p[1]);
  await page.waitForTimeout(400);
  const after = await page.screenshot({ clip });
  expect(Buffer.compare(before, after), 'hover changes the road while paused').not.toBe(0);

  // click a road: the selection panel fills with numbers
  await page.mouse.click(p[0], p[1]);
  const panel = page.getByRole('region', { name: 'Selected road' });
  await expect(panel).toBeVisible({ timeout: 1000 });
  await expect(panel).toContainText(/\d/, { timeout: 1000 });

  // responsive while paused: zoom
  const box = (await page.locator('canvas.city').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await snap(page)).camera.zoom).not.toBe(b.camera.zoom);
  const r0 = (await snap(page)).renderFrames;
  await expect.poll(async () => (await snap(page)).renderFrames).toBeGreaterThan(r0 + 5);

  // resume: frames flow again
  await page.mouse.move(3, 3);
  const c = await snap(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(true);
  await page.waitForTimeout(1000);
  expect((await snap(page)).framesReceived! - c.framesReceived!, 'frames flow again after resume').toBeGreaterThanOrEqual(20);
});
