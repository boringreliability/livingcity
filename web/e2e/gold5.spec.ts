// Ward core-005 Gold, regression tests for Gold review r1 findings (added in
// Gold; no approved Red test was changed).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot | null> =>
  page.evaluate(() => window.__livingcity?.snapshot() ?? null);
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ready(page: Page): Promise<LivingCitySnapshot> {
  await page.goto('/');
  await expect.poll(async () => (await snap(page))?.tick ?? 0).toBeGreaterThan(10);
  return (await snap(page))!;
}
const center = async (page: Page, l: number): Promise<[number, number]> =>
  (await page.evaluate((x) => window.__livingcity!.linkScreenCenter(x), l))!;

async function pause(page: Page) {
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page))!.running).toBe(false);
  await sleep(300);
}

/** Luminance (0–255) of every pixel in a page clip, decoded in the page. */
async function luminance(page: Page, [x, y]: [number, number], w: number, h: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: x - w / 2, y: y - h / 2, width: w, height: h } });
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
}
const count = (lum: number[], lo: number, hi: number) => lum.filter((v) => v >= lo && v <= hi).length;

// G1 (MAJOR): the selected road must be clearly visible at the fitted (default) zoom
test('fix G1: the selected road gets a visible outline at fit zoom', async ({ page }) => {
  const s0 = await ready(page);
  const road = s0.landmarks!.north_bridge[0];
  await pause(page);
  const p = await center(page, road);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, p)).toBe('CANVAS');
  // Given the paused city at fit zoom, nothing selected
  const before = await luminance(page, p, 40, 24);
  // When the user clicks the road and moves the pointer away (no hover on it)
  await page.mouse.click(p[0], p[1]);
  await expect.poll(async () => (await snap(page))!.selectedLink).toBe(road);
  await page.mouse.move(p[0], p[1] + 200);
  await sleep(300);
  const after = await luminance(page, p, 40, 24);
  // Then a white outline (≥ 2 px on each side, along most of the clip) appears
  expect(count(after, 245, 255) - count(before, 245, 255)).toBeGreaterThanOrEqual(2 * 2 * 30);
});

// G1 (MAJOR): hovering a road is visible too, and distinct from selection by lightness
test('fix G1: a hovered road gets a lighter grey outline at fit zoom', async ({ page }) => {
  const s0 = await ready(page);
  const road = s0.landmarks!.south_bridge[0];
  await pause(page);
  const p = await center(page, road);
  await page.mouse.move(p[0], p[1] + 200);
  await sleep(300);
  const before = await luminance(page, p, 40, 24);
  // When the pointer rests on the road (no click)
  await page.mouse.move(p[0], p[1]);
  await sleep(300);
  const after = await luminance(page, p, 40, 24);
  // Then a light grey halo (not white) appears around it
  expect(count(after, 170, 200) - count(before, 170, 200)).toBeGreaterThanOrEqual(2 * 30);
  expect(count(after, 245, 255) - count(before, 245, 255)).toBeLessThan(20);
});

// M6: holding Space (key auto-repeat) toggles play/pause once, not on every repeat
test('fix M6: a held Space key toggles running exactly once', async ({ page }) => {
  await ready(page);
  await blur(page);
  expect((await snap(page))!.running).toBe(true);
  // Given Space pressed once (paused, confirmed by a frame)
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page))!.running).toBe(false);
  // When the held key auto-repeats after the state has settled
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', repeat: true, bubbles: true })),
  );
  await sleep(500);
  // Then the simulation stays paused
  expect((await snap(page))!.running).toBe(false);
});
