// Ward core-005, tests 9–13: proposed and verified against a prototype by the
// Red reviewer, round 1 (focus-safe shortcuts, toggle reopen, Esc/±, closed marker in
// grayscale, picking at DPR 2 after wheel zoom).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot | null> =>
  page.evaluate(() => window.__livingcity?.snapshot() ?? null);
async function ready(page: Page): Promise<LivingCitySnapshot> {
  await page.goto('/');
  await expect.poll(async () => (await snap(page))?.tick ?? 0).toBeGreaterThan(10);
  return (await snap(page))!;
}
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const speedSelect = (page: Page) => page.getByRole('combobox', { name: /speed/i });

// G1: shortcuts must not double-fire or hijack focused controls
test('fix G1: global shortcuts are ignored while a control has focus', async ({ page }) => {
  await ready(page);
  const bridge = page.getByRole('button', { name: /main bridge/i });
  // Given focus on the main-bridge button, When Space is pressed (native activation)
  await bridge.focus();
  await page.keyboard.press('Space');
  // Then the button toggles, And the sim is NOT paused by the global Space shortcut
  await expect(bridge).toHaveAttribute('aria-pressed', 'true');
  await sleep(500);
  expect((await snap(page))!.running).toBe(true);
  // Given focus on the speed select, When Space and B are pressed, Then neither shortcut fires
  await speedSelect(page).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await speedSelect(page).focus();
  await page.keyboard.press('b');
  await sleep(500);
  const s = (await snap(page))!;
  expect(s.running).toBe(true);
  await expect(bridge).toHaveAttribute('aria-pressed', 'true');
});

// G2: the main-bridge toggle reopens both directions
test('fix G2: pressing the main-bridge toggle again reopens both directions', async ({ page }) => {
  const s0 = await ready(page);
  const central = s0.landmarks!.central_bridge;
  const bridge = page.getByRole('button', { name: /main bridge/i });
  await blur(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page))!.closed).toEqual(expect.arrayContaining(central));
  await expect(bridge).toHaveAttribute('aria-pressed', 'true');
  await bridge.click();
  await expect.poll(async () => (await snap(page))!.closed.filter((l) => central.includes(l))).toEqual([]);
  await expect(bridge).toHaveAttribute('aria-pressed', 'false');
});

// G3: Esc clears the selection; + / − step the speed
test('fix G3: Esc clears the selection and +/- change the speed', async ({ page }) => {
  const s0 = await ready(page);
  const road = s0.landmarks!.central_bridge[1];
  const p = (await page.evaluate((l) => window.__livingcity!.linkScreenCenter(l), road))!;
  await page.mouse.click(p[0], p[1]);
  await expect.poll(async () => (await snap(page))!.selectedLink).toBe(road);
  await blur(page);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page))!.selectedLink).toBeNull();
  await speedSelect(page).selectOption({ label: '5×' });
  await blur(page);
  await page.keyboard.press('+');
  await expect(speedSelect(page).locator('option:checked')).toHaveText('20×');
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect(speedSelect(page).locator('option:checked')).toHaveText('1×');
});

// G4: a closed road is visibly marked (grayscale), independent of vehicles
test('fix G4: closing the main bridge changes its grayscale appearance', async ({ page }) => {
  const s0 = await ready(page);
  const central = s0.landmarks!.central_bridge;
  await speedSelect(page).selectOption({ label: '1×' });
  const clip = async () => {
    const [a, b] = await Promise.all(central.map((l) => page.evaluate((x) => window.__livingcity!.linkScreenCenter(x), l)));
    const cx = (a![0] + b![0]) / 2;
    const cy = (a![1] + b![1]) / 2;
    const png = await page.screenshot({ clip: { x: cx - 30, y: cy - 8, width: 60, height: 16 } });
    // decode in the page; return luminance per pixel
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const out: number[] = [];
      for (let i = 0; i < d.length; i += 4) out.push(0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!);
      return out;
    }, png.toString('base64'));
  };
  const pause = async (running: boolean) => {
    await blur(page);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await snap(page))!.running).toBe(running);
    await sleep(300);
  };
  const emptyBridge = async () => {
    const s = (await snap(page))!;
    expect(s.linkCounts[central[0]]! + s.linkCounts[central[1]]!).toBe(0);
  };
  // Given the open, empty bridge while paused
  await pause(false);
  await emptyBridge();
  const open = await clip();
  // When it is closed (confirmed) and paused again before any vehicle arrives
  await pause(true);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page))!.closed).toEqual(expect.arrayContaining(central));
  await pause(false);
  await emptyBridge();
  const closed = await clip();
  // Then the bridge looks clearly different in grayscale
  const meanAbsDiff = open.reduce((acc, v, i) => acc + Math.abs(v - closed[i]!), 0) / open.length;
  expect(meanAbsDiff).toBeGreaterThan(15);
});

// (G5 was replaced by "fix G5 (r2)" in review2.spec.ts: Red review r2, B6.)
