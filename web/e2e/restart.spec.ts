// Ward polish-005, test 8: after a wasm trap the simulation can be restarted from the UI.
import { expect, test, type Page } from '@playwright/test';

const tick = (page: Page) => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0);

test('trap_offers_restart', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let workers = 0;
  page.on('worker', () => workers++);
  await page.goto('/');
  await expect.poll(() => tick(page), { timeout: 60_000 }).toBeGreaterThan(1800);
  // a trap inside the worker's wasm
  await page.evaluate(() => (window.__livingcity as unknown as { debugTrap(): void }).debugTrap());
  const alert = page.getByRole('alert').filter({ hasText: /the simulation stopped/i });
  await expect(alert).toBeVisible({ timeout: 10_000 });
  const restart = alert.getByRole('button', { name: 'Restart simulation' });
  await expect(restart).toBeVisible();
  await expect(alert.getByRole('button', { name: /dismiss/i })).toHaveCount(0);
  // other actions do not clear a fatal error
  await page.getByRole('slider', { name: 'Timeline' }).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await expect(alert).toBeVisible();
  const deadTick = await tick(page);
  // restart: a living city again
  const before = workers;
  await restart.click();
  await expect(alert).toHaveCount(0, { timeout: 60_000 });
  expect(workers, 'a new worker was created').toBeGreaterThan(before);
  await expect.poll(() => tick(page), { timeout: 60_000 }).toBeGreaterThan(1800);
  // a new world: it started again from the warm-up (not the halted one's tick)
  const t0 = await tick(page);
  expect(t0, 'the restarted city is a new one').toBeLessThan(deadTick + 1800);
  await expect.poll(() => tick(page), { timeout: 20_000 }).toBeGreaterThan(t0);
  expect(errors).toEqual([]);
});
