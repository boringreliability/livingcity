// Ward core-005: end-to-end in a real browser (Rust → WASM → worker → WebGL2/React → command → Rust).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot | null> =>
  page.evaluate(() => window.__livingcity?.snapshot() ?? null);

async function ready(page: Page): Promise<LivingCitySnapshot> {
  await page.goto('/');
  await expect.poll(async () => (await snap(page))?.tick ?? 0).toBeGreaterThan(10);
  return (await snap(page))!;
}

/** Remove keyboard focus so global shortcuts (Space, B) reach the app. */
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function meanBridgeOccupancy(page: Page, links: number[], samples = 10): Promise<number> {
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = (await snap(page))!;
    sum += links.reduce((acc, l) => acc + (s.linkCounts[l] ?? 0), 0);
    await sleep(200);
  }
  return sum / samples;
}

// 4
test('e2e: city loads and traffic moves', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  // Given the app, When it loads
  const first = await ready(page);
  // Then it renders with WebGL2 into a canvas that is not blank
  expect(await page.evaluate(() => !!document.querySelector('canvas')?.getContext('webgl2'))).toBe(true);
  const png = await page.locator('canvas').first().screenshot();
  expect(png.byteLength).toBeGreaterThan(20_000);
  // And sim time advances with active vehicles
  await expect.poll(async () => (await snap(page))!.simTimeS).toBeGreaterThan(first.simTimeS + 5);
  expect((await snap(page))!.metrics['active']).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// 5
test('e2e: close the main bridge and traffic reroutes', async ({ page }) => {
  const s0 = await ready(page);
  const lm = s0.landmarks!;
  await page.getByLabel(/speed/i).selectOption({ label: '60×' });
  await sleep(2000);
  const alternatives = [lm.north_bridge[0], lm.south_bridge[0]];
  const before = await meanBridgeOccupancy(page, alternatives);
  // When the main bridge is closed
  const button = page.getByRole('button', { name: /close the main bridge/i });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  // Then both directions are closed in the simulation
  await expect.poll(async () => (await snap(page))!.closed).toEqual(expect.arrayContaining(lm.central_bridge));
  const closedAt = (await snap(page))!.simTimeS;
  // And after five sim-minutes the bridge is empty and the alternatives carry more
  await expect.poll(async () => (await snap(page))!.simTimeS, { timeout: 90_000 }).toBeGreaterThan(closedAt + 300);
  await expect
    .poll(async () => {
      const s = (await snap(page))!;
      return s.linkCounts[lm.central_bridge[0]]! + s.linkCounts[lm.central_bridge[1]]!;
    })
    .toBe(0);
  const after = await meanBridgeOccupancy(page, alternatives);
  expect(after).toBeGreaterThan(before);
});

// 6
test('e2e: select a road, reopen, pause by keyboard', async ({ page }) => {
  const s0 = await ready(page);
  const road = s0.landmarks!.south_bridge[0];
  // When the user clicks the middle of a road
  const p = await page.evaluate((l) => window.__livingcity!.linkScreenCenter(l), road);
  expect(p).not.toBeNull();
  await page.mouse.click(p![0], p![1]);
  // Then it is selected and the panel shows it
  await expect.poll(async () => (await snap(page))!.selectedLink).toBe(road);
  await expect(page.getByText(new RegExp(`Link ${road}\\b`))).toBeVisible();
  // When closed and reopened from the panel
  await page.getByRole('button', { name: /^close link$/i }).click();
  await expect.poll(async () => (await snap(page))!.closed).toContain(road);
  await page.getByRole('button', { name: /^reopen link$/i }).click();
  await expect.poll(async () => (await snap(page))!.closed).not.toContain(road);
  // When Space is pressed, Then sim time stops, and Space resumes it
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page))!.running).toBe(false);
  const t1 = (await snap(page))!.simTimeS;
  await sleep(1000);
  expect((await snap(page))!.simTimeS).toBe(t1);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page))!.simTimeS).toBeGreaterThan(t1);
});

// 7
test('e2e: controls are keyboard reachable and labeled', async ({ page }) => {
  await ready(page);
  // When tabbing through the page
  const seen: { tag: string; name: string }[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    seen.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const label = el?.getAttribute('aria-label') ?? (el?.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null);
        return { tag: el?.tagName ?? '', name: (label ?? el?.textContent ?? '').trim() };
      }),
    );
  }
  const interactive = seen.filter((s) => ['BUTTON', 'SELECT', 'INPUT'].includes(s.tag));
  // Then every reached control has a name, and the key controls are reachable
  expect(interactive.length).toBeGreaterThanOrEqual(3);
  for (const c of interactive) expect(c.name, `${c.tag} without a name`).not.toBe('');
  const names = interactive.map((c) => c.name.toLowerCase()).join(' | ');
  expect(names).toMatch(/pause|play/);
  expect(names).toMatch(/speed/);
  expect(names).toMatch(/main bridge/);
  // And B toggles the main bridge
  await blur(page);
  const button = page.getByRole('button', { name: /main bridge/i });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('b');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

// 8
test('e2e: rendering is decoupled from simulation', async ({ page }) => {
  await ready(page);
  // When paused
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page))!.running).toBe(false);
  await sleep(500);
  const r0 = (await snap(page))!.renderFrames;
  const a = await page.locator('canvas').first().screenshot();
  await sleep(500);
  const b = await page.locator('canvas').first().screenshot();
  // Then rAF keeps drawing but vehicles do not move
  expect((await snap(page))!.renderFrames).toBeGreaterThan(r0 + 10);
  expect(Buffer.compare(a, b)).toBe(0);
  // When resumed, Then the picture changes
  await page.keyboard.press('Space');
  await sleep(1000);
  const c = await page.locator('canvas').first().screenshot();
  expect(Buffer.compare(b, c)).not.toBe(0);
  // And resizing the window resizes the canvas without touching the simulation
  const tick = (await snap(page))!.tick;
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(() => page.evaluate(() => document.querySelector('canvas')!.clientWidth)).toBe(900);
  await expect.poll(async () => (await snap(page))!.tick).toBeGreaterThan(tick);
});
