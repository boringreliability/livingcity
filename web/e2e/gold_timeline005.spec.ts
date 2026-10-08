// Ward timeline-005, Gold r1 regression (the approved specs stay frozen): after a pointer click on a
// panel button, Space and B are shortcuts again (docs/demo.md says "press Space" right after clicks).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());

test('space after clicking a panel button plays/pauses instead of pressing the button again', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThan(1800);
  const lm = (await snap(page)).landmarks!;
  // click "Close the main bridge", then Space: the sim pauses, the bridge stays closed
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(lm.central_bridge));
  expect((await snap(page)).running).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
  expect((await snap(page)).closed).toEqual(expect.arrayContaining(lm.central_bridge));
  // click "−1 min" (in A's past now), then B: a branch is created by the shortcut
  await page.getByRole('button', { name: '−1 min' }).click();
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBeLessThan((await snap(page)).timeline.headTick);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  // click "Compare side by side", then Space: compare stays on and both sides run in lockstep
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  const t0 = (await snap(page)).sides!.a.tick;
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).sides?.a.tick ?? 0, { timeout: 30_000 }).toBeGreaterThan(t0 + 120);
  const s = await snap(page);
  expect(s.compare).toBe(true);
  expect(s.sides!.a.tick).toBe(s.sides!.b.tick);
});

test('keyboard activation keeps focus on the button (Tab + Enter users stay in place)', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThan(1800);
  const button = page.getByRole('button', { name: /close the main bridge/i });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snap(page)).closed.length).toBeGreaterThan(0);
  expect(await button.evaluate((el) => el === document.activeElement)).toBe(true);
});
