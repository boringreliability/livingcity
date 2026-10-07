// Ward core-005, tests 17–20: proposed and verified against a prototype by the
// Red reviewer, round 2 (honest "Behind" status, play/pause naming, vehicles on their
// own roadway in the drawn image, HiDPI picking without a wheel-rate assumption).
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
const center = async (page: Page, l: number) => page.evaluate((x) => window.__livingcity!.linkScreenCenter(x), l);
const running = (page: Page) => async () => (await snap(page))!.running;

// S1 (spec r2): honest reporting when the engine cannot keep up
test('fix S1: a stalled engine shows a visible, non-colour "Behind" status that clears again', async ({ page }) => {
  await ready(page);
  await speedSelect(page).selectOption({ label: '60×' });
  // Then achieved vs target speed is shown
  await expect(page.getByTestId('achieved-speed')).toHaveText(/\d/);
  // Record (every animation frame) whether a visible status with the text "Behind" is on screen
  await page.evaluate(() => {
    const w = window as unknown as { __sawBehind: boolean };
    w.__sawBehind = false;
    const check = () => {
      if (
        Array.from(document.querySelectorAll<HTMLElement>('[role="status"]')).some(
          (e) => /behind/i.test(e.innerText) && e.checkVisibility(),
        )
      )
        w.__sawBehind = true;
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  // When the simulation worker stalls for 2.5 s (the engine cannot keep up)
  // the simulation worker, selected by its script URL (Red review r3, n9)
  const worker = page.workers().find((w) => /\/sim\/worker\.ts/.test(w.url()))!;
  expect(worker).toBeTruthy();
  await worker.evaluate(() => {
    const end = Date.now() + 2500;
    while (Date.now() < end) {
      /* busy: the engine is behind */
    }
  });
  // Then a status with the visible text "Behind" appears (text, not colour alone)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __sawBehind: boolean }).__sawBehind), { timeout: 10_000 })
    .toBe(true);
  // And once the engine keeps up again, it clears
  await expect(page.getByRole('status').filter({ hasText: /behind/i })).toBeHidden({ timeout: 15_000 });
});

// N1 (spec r2): initial state, and the play/pause name follows the confirmed state (also via the keyboard)
test('fix N1: the app starts running at 20×, and the play/pause name follows the state', async ({ page }) => {
  await ready(page);
  await expect(speedSelect(page).locator('option:checked')).toHaveText('20×');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  // When paused with the keyboard, Then the button is named "Play"
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(running(page)).toBe(false);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  // When "Play" is clicked, Then it runs and is named "Pause" again
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(running(page)).toBe(true);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

// N2: vehicles are drawn on their own carriageway (the shader, not only the TS helper)
test('fix N2: vehicles are drawn inside their own right-hand roadway', async ({ page }) => {
  const s0 = await ready(page);
  const [we, ew] = s0.landmarks!.central_bridge;
  await speedSelect(page).selectOption({ label: '60×' });
  // Given the east→west direction closed and empty while west→east carries traffic
  const pe = (await center(page, ew))!;
  await page.mouse.click(pe[0], pe[1]);
  await expect.poll(async () => (await snap(page))!.selectedLink).toBe(ew);
  await page.getByRole('button', { name: /^close link$/i }).click();
  await expect.poll(async () => (await snap(page))!.closed).toContain(ew);
  await blur(page);
  await page.keyboard.press('Escape');
  // And the view zoomed onto the bridge (one wheel notch at a time; the rate is not specified)
  const sep = async () => {
    const [a, b] = [(await center(page, we))!, (await center(page, ew))!];
    return { a, b, px: Math.abs(a[1] - b[1]) };
  };
  const m = await sep();
  await page.mouse.move((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2);
  await expect
    .poll(async () => {
      if ((await sep()).px >= 40) return true;
      await page.mouse.wheel(0, -100);
      return false;
    }, { intervals: [150], timeout: 30_000 })
    .toBe(true);
  await page.mouse.move(2, 2);
  const { a, b, px } = await sep();
  const zoom = px / 8; // centre lines are (3.5 + 3.5 + 1) m apart for two 2-lane directions
  const vw = page.viewportSize()!;
  const x0 = Math.max(0, Math.round(a[0] - 80 * zoom));
  const x1 = Math.min(vw.width, Math.round(a[0] + 80 * zoom));
  const y0 = Math.max(0, Math.round(Math.min(a[1], b[1]) - 2 * px));
  const y1 = Math.min(vw.height, Math.round(Math.max(a[1], b[1]) + 2 * px));
  const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const togglePause = async (r: boolean) => {
    await page.keyboard.press('Space');
    await expect.poll(running(page)).toBe(r);
  };
  const shot = async () => {
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*')))
        el.style.visibility = el !== canvas && !el.contains(canvas) ? 'hidden' : '';
    });
    const png = await page.screenshot({ clip });
    await page.evaluate(() => {
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) el.style.visibility = '';
    });
    return png.toString('base64');
  };
  // When a paused picture with traffic on west→east only is followed (after a little movement) by a second one
  let A = '';
  await expect
    .poll(async () => {
      await togglePause(false);
      const s = (await snap(page))!;
      if (s.linkCounts[we]! > 0 && s.linkCounts[ew] === 0) {
        await sleep(300);
        A = await shot();
        return true;
      }
      await togglePause(true);
      await sleep(200);
      return false;
    }, { intervals: [0], timeout: 60_000 })
    .toBe(true);
  await togglePause(true);
  await sleep(500);
  await togglePause(false);
  await sleep(300);
  const B = await shot();
  // Then every changed pixel (a moving vehicle) lies within the west→east roadway (half width 3.5 m + 0.5 m)
  const { changed, inside } = await page.evaluate(
    async ([A, B, yRoad, half]) => {
      const load = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
      };
      const [p, q] = [await load(A as string), await load(B as string)];
      let changed = 0;
      let inside = 0;
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++) {
          const i = 4 * (y * p.w + x);
          const diff = Math.abs(p.d[i]! - q.d[i]!) + Math.abs(p.d[i + 1]! - q.d[i + 1]!) + Math.abs(p.d[i + 2]! - q.d[i + 2]!);
          if (diff > 30) {
            changed++;
            if (Math.abs(y + 0.5 - (yRoad as number)) <= (half as number)) inside++;
          }
        }
      return { changed, inside };
    },
    [A, B, a[1] - y0, 4.0 * zoom] as const,
  );
  expect(changed).toBeGreaterThan(20);
  expect(inside / changed).toBeGreaterThan(0.95);
});

// Replacement for review1 "fix G5" (BLOCKER B6): no assumption about the wheel zoom rate
test.describe('HiDPI', () => {
  test.use({ deviceScaleFactor: 2 });
  test('fix G5 (r2): clicking a road selects it at DPR 2, also after zooming with the wheel', async ({ page }) => {
    const s0 = await ready(page);
    const road = s0.landmarks!.central_bridge[0];
    const other = s0.landmarks!.north_bridge[0];
    // The backing store follows devicePixelRatio (sharp on HiDPI)
    await expect
      .poll(() => page.evaluate(() => { const c = document.querySelector('canvas')!; return c.width / c.clientWidth; }))
      .toBeCloseTo(2, 1);
    let p = (await center(page, road))!;
    await page.mouse.click(p[0], p[1]);
    await expect.poll(async () => (await snap(page))!.selectedLink).toBe(road);
    // When zooming with the wheel slightly off the road (one notch at a time until the view changes)
    const before = (await center(page, other))!;
    await page.mouse.move(p[0] + 6, p[1] + 3);
    await expect
      .poll(async () => {
        const c = await center(page, other);
        if (c === null || Math.abs(c[1] - before[1]) > 1) return true;
        await page.mouse.wheel(0, -100);
        return false;
      }, { intervals: [150], timeout: 30_000 })
      .toBe(true);
    // Then clicking the (moved) road centre on the canvas still selects that road
    await blur(page);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await snap(page))!.selectedLink).toBeNull();
    p = (await center(page, road))!;
    expect(p).not.toBeNull();
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, p)).toBe('CANVAS');
    await page.mouse.click(p[0], p[1]);
    await expect.poll(async () => (await snap(page))!.selectedLink).toBe(road);
  });
});
