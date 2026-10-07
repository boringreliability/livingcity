// Ward city-002 Gold: regression found while smoke-testing River City (added in Gold;
// no approved Red test was changed).
import { expect, test } from '@playwright/test';

// A speed chosen before the simulation is ready must be the speed it runs at
test('fix S1: a speed picked before ready is honoured, not reset to the default', async ({ page }) => {
  await page.goto('/');
  // Given the user picks 60× immediately (the worker may still be starting)
  await page.getByRole('combobox', { name: /speed/i }).selectOption({ label: '60×' });
  // Then, once ready, the simulation runs at 60× (120 ticks per wall second), not at the default
  const tick = () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0);
  await expect.poll(tick).toBeGreaterThan(10);
  const t0 = await tick();
  await page.waitForTimeout(3000);
  const rate = ((await tick()) - t0) / 3;
  expect(rate).toBeGreaterThan(90);
  await expect(page.getByTestId('achieved-speed')).toHaveText(/^(5\d|6\d)\.\d× of 60×$/);
});
