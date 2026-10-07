// Ward city-004: the miniature-city look and the renderer fixes (River City).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ready(page: Page, minTick = 10): Promise<LivingCitySnapshot> {
  await page.goto('/');
  await expect.poll(async () => (await page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0)), { timeout: 60_000 }).toBeGreaterThan(minTick);
  return snap(page);
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
  await sleep(300);
}

async function closeMain(page: Page) {
  const main = (await snap(page)).landmarks!.central_bridge;
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => { const c = (await snap(page)).closed; return main.every((l) => c.includes(l)); }).toBe(true);
}

/** RGB per pixel of a page clip, row-major. */
async function pixels(page: Page, [x, y]: [number, number], w: number, h: number): Promise<[number, number, number][]> {
  const png = await page.screenshot({ clip: { x: Math.round(x - w / 2), y: Math.round(y - h / 2), width: w, height: h } });
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
    const out: [number, number, number][] = [];
    for (let i = 0; i < d.length; i += 4) out.push([d[i]!, d[i + 1]!, d[i + 2]!]);
    return out;
  }, png.toString('base64'));
}
const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** The closed-road hatch's yellow (and only it: high red/green, low blue). */
const isHatchYellow = ([r, g, b]: [number, number, number]) => r > 200 && g > 150 && b < 90;
const point = (page: Page, link: number, t: number) =>
  page.evaluate(([l, t]) => window.__livingcity!.linkScreenPoint(l, t), [link, t] as const) as Promise<[number, number]>;
const nodeScreen = (page: Page, link: number, end: 0 | 1) => point(page, link, end);

// 8
test('b_key_repeat_ignored', async ({ page }) => {
  const s = await ready(page);
  const main = s.landmarks!.central_bridge;
  await blur(page);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', repeat: true, bubbles: true })));
  await sleep(600);
  const c = (await snap(page)).closed;
  expect(main.some((l) => c.includes(l))).toBe(false);
  await expect(page.getByRole('button', { name: /close the main bridge/i })).toBeVisible();
});

// 9
test('hatch_leaves_junctions_clear', async ({ page }) => {
  const s = await ready(page);
  await pause(page);
  await page.evaluate(() => window.__livingcity!.setDebug({ hideVehicles: true }));
  await closeMain(page);
  await page.mouse.move(5, 400);
  await sleep(300);
  const we = s.landmarks!.central_bridge[0];
  // the east end junction of the west→east Main Bridge link
  const end = await nodeScreen(page, we, 1);
  const atJunction = await pixels(page, end, 5, 5);
  // (only the yellow is a reliable hatch cue: its black stripes match the dark ground)
  expect(atJunction.filter(isHatchYellow).length).toBe(0);
  // while the bridge's middle is hatched
  const mid = await point(page, we, 0.5);
  const atMid = await pixels(page, mid, 9, 9);
  expect(atMid.filter(isHatchYellow).length).toBeGreaterThan(5);
});

// 10
test('hatch_moves_with_the_map', async ({ page }) => {
  const s = await ready(page);
  await pause(page);
  await page.evaluate(() => window.__livingcity!.setDebug({ hideVehicles: true }));
  await closeMain(page);
  await page.mouse.move(5, 400);
  await sleep(300);
  const we = s.landmarks!.central_bridge[0];
  const mid = await point(page, we, 0.5);
  const before = await pixels(page, mid, 30, 12);
  // When the map is dragged by 37 px to the right (starting on an empty spot below the bridge)
  const start: [number, number] = [mid[0], mid[1] + 80];
  await page.mouse.move(start[0], start[1]);
  await page.mouse.down();
  await page.mouse.move(start[0] + 20, start[1], { steps: 4 });
  await page.mouse.move(start[0] + 37, start[1], { steps: 4 });
  await page.mouse.up();
  await page.mouse.move(5, 400);
  await sleep(300);
  const moved = await point(page, we, 0.5);
  expect(moved[0] - mid[0]).toBeCloseTo(37, 0);
  const after = await pixels(page, moved, 30, 12);
  // Then the hatch moved with it: the same pattern
  let maxDiff = 0;
  for (let i = 0; i < before.length; i++) for (let k = 0; k < 3; k++) maxDiff = Math.max(maxDiff, Math.abs(before[i]![k]! - after[i]![k]!));
  expect(before.filter(isHatchYellow).length).toBeGreaterThan(20);
  expect(maxDiff).toBeLessThanOrEqual(2);
});

// 11
test('barriers_visible_at_fit_zoom', async ({ page }) => {
  const s = await ready(page);
  await pause(page);
  await page.evaluate(() => window.__livingcity!.setDebug({ hideVehicles: true }));
  await closeMain(page);
  await page.mouse.move(5, 400);
  await sleep(300);
  for (const l of s.landmarks!.central_bridge) {
    const at = await point(page, l, 0.12);
    const a = await point(page, l, 0);
    const b = await point(page, l, 1);
    const horizontal = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    const n = 21;
    const px = await pixels(page, at, n, n);
    // the longest run of near-white pixels along the road direction through the centre
    let best = 0;
    for (let off = -2; off <= 2; off++) {
      let run = 0;
      for (let k = 0; k < n; k++) {
        const idx = horizontal ? (10 + off) * n + k : k * n + (10 + off);
        if (lum(px[idx]!) >= 220) best = Math.max(best, ++run);
        else run = 0;
      }
    }
    expect(best, `barrier on link ${l}`).toBeGreaterThanOrEqual(3);
  }
});

// 12
test('selected_halo_keeps_opposite_hatch', async ({ page }) => {
  const s = await ready(page);
  await pause(page);
  await page.evaluate(() => window.__livingcity!.setDebug({ hideVehicles: true }));
  const [we, ew] = s.landmarks!.central_bridge;
  // close only east→west via the road panel
  const pe = await point(page, ew, 0.5);
  await page.mouse.click(pe[0], pe[1]);
  await expect.poll(async () => (await snap(page)).selectedLink).toBe(ew);
  await page.getByRole('button', { name: /^close link$/i }).click();
  await expect.poll(async () => (await snap(page)).closed).toContain(ew);
  await blur(page);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).selectedLink).toBeNull();
  await page.mouse.move(5, 400);
  await sleep(300);
  const mid = await point(page, ew, 0.5);
  const before = (await pixels(page, mid, 40, 16)).filter(isHatchYellow).length;
  expect(before).toBeGreaterThan(20);
  // When the west→east direction is selected (its halo is drawn)
  const pw = await point(page, we, 0.3);
  await page.mouse.click(pw[0], pw[1]);
  await expect.poll(async () => (await snap(page)).selectedLink).toBe(we);
  await page.mouse.move(5, 400);
  await sleep(300);
  const after = (await pixels(page, mid, 40, 16)).filter(isHatchYellow).length;
  expect(after).toBeGreaterThanOrEqual(0.9 * before);
});

// 13
test('labels_follow_camera_while_paused', async ({ page }) => {
  await ready(page);
  await pause(page);
  const read = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.labels .zone')).map((e) => {
        const r = e.getBoundingClientRect();
        return [r.left, r.top] as [number, number];
      }),
    );
  const before = await read();
  expect(before.length).toBeGreaterThan(10);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const start: [number, number] = [box.x + box.width / 2, box.y + box.height - 140];
  await page.mouse.move(start[0], start[1]);
  await page.mouse.down();
  await page.mouse.move(start[0] - 30, start[1] - 20, { steps: 5 });
  await page.mouse.up();
  // by the next animation frame
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const after = await read();
  for (let i = 0; i < before.length; i++) {
    expect(after[i]![0] - before[i]![0]).toBeCloseTo(-30, 0);
    expect(after[i]![1] - before[i]![1]).toBeCloseTo(-20, 0);
  }
});

// 14
test('congestion_reads_in_grayscale', async ({ page }) => {
  test.setTimeout(240_000);
  const s = await ready(page, 450);
  await page.evaluate(() => window.__livingcity!.setDebug({ hideVehicles: true }));
  const old = s.landmarks!.south_bridge[0];
  // the Old Bridge's west approach: the street link ending where the Old Bridge starts
  const approach = await page.evaluate((oldId) => {
    const h = window.__livingcity!;
    return h.approachLinks(oldId);
  }, old);
  expect(approach.length).toBeGreaterThan(0);
  const link = approach[0]!;
  const a = await point(page, link, 0);
  const b = await point(page, link, 1);
  const horizontal = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  const measure = async () => {
    await pause(page);
    await page.mouse.move(5, 400);
    await sleep(300);
    const m = await point(page, link, 0.5);
    const n = 25;
    const px = await pixels(page, m, n, n);
    // a line across the road through the clip centre; road pixels are clearly lighter than the ground
    const across: number[] = [];
    for (let k = 0; k < n; k++) across.push(lum(px[horizontal ? k * n + 12 : 12 * n + k]!));
    const ground = Math.min(...across);
    const road = across.filter((v) => v > ground + 25);
    const core = [...road].sort((x, y) => y - x).slice(0, Math.max(1, Math.floor(road.length / 2)));
    return { width: road.length, light: core.reduce((x, y) => x + y, 0) / core.length };
  };
  const before = await measure();
  expect(before.width).toBeGreaterThan(0);
  // When the main bridge is closed and the approach fills up (≥ 60 % of its capacity)
  await closeMain(page);
  await page.getByRole('combobox', { name: /speed/i }).selectOption({ label: '20×' });
  await blur(page);
  await page.keyboard.press('Space');
  const cap = await page.evaluate((l) => window.__livingcity!.linkCapacity(l), link);
  await expect.poll(async () => (await snap(page)).linkCounts[link]! / cap, { timeout: 180_000, intervals: [1000] }).toBeGreaterThanOrEqual(0.6);
  const after = await measure();
  // Then the congested road reads wider and lighter, without hue
  expect(after.width).toBeGreaterThanOrEqual(before.width + 1);
  expect(after.light).toBeGreaterThanOrEqual(before.light + 10);
});

// 15
test('legend_explains_symbols', async ({ page }) => {
  await ready(page);
  const legend = page.getByRole('region', { name: 'Legend' });
  await expect(legend).toBeVisible();
  const toggle = legend.getByRole('button');
  for (const text of [/closed road/i, /queued/i, /moving/i, /congest/i, /select/i]) await expect(legend).toContainText(text);
  expect(await legend.locator('svg').count()).toBeGreaterThanOrEqual(5);
  // keyboard reachable
  await blur(page);
  let onToggle = false;
  for (let k = 0; k < 30 && !onToggle; k++) {
    await page.keyboard.press('Tab');
    onToggle = await toggle.evaluate((el) => el === document.activeElement);
  }
  expect(onToggle).toBe(true);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // collapsed state survives a reload
  await page.reload();
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(5);
  await expect(page.getByRole('region', { name: 'Legend' }).getByRole('button')).toHaveAttribute('aria-expanded', 'false');
});

// 16
test('no_webgl2_fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText(/WebGL2/);
  await expect(page.getByRole('button', { name: /^(play|pause)$/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: /close the main bridge/i })).toBeDisabled();
});
