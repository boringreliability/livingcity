// Ward motion-003, Gold regressions (Gold r1 MAJOR-1/2, r2 MAJOR-1): queue pins never cover a shown label
// (district or bridge name, or another pin), sampled on every animation frame while running and paused, in
// the single view and on both halves while comparing; the compare timeline names each side's interventions,
// and a marker at the window's start stays inside the track.
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

async function ready(page: Page) {
  await page.goto('/');
  await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThan(1800);
}
async function setRunning(page: Page, on: boolean) {
  await blur(page);
  if ((await snap(page)).running !== on) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(on);
}

/** Overlaps of shown queue pins with shown labels and other pins, on every animation frame for `frames`. */
function sampleOverlaps(page: Page, frames: number) {
  return page.evaluate(
    (frames) =>
      new Promise<{ samples: number; pins: number; overlaps: string[] }>((resolve) => {
        const out: string[] = [];
        let samples = 0;
        let pins = 0;
        const shown = (e: Element) => (e as HTMLElement).style.visibility !== 'hidden' && getComputedStyle(e).visibility !== 'hidden';
        const step = () => {
          for (const layer of document.querySelectorAll('.labels')) {
            const marks = [...layer.querySelectorAll('.zone, .bridge-label, .queue-pin')].filter(shown).map((e) => ({ e, r: e.getBoundingClientRect() }));
            for (const p of marks.filter((m) => m.e.classList.contains('queue-pin'))) {
              pins++;
              for (const o of marks) {
                if (o.e === p.e) continue;
                const [a, b] = [p.r, o.r];
                const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (w > 0.5 && h > 0.5) out.push(`${layer.className}: "${p.e.textContent}" × "${o.e.textContent}"`);
              }
            }
          }
          samples++;
          if (samples >= frames) resolve({ samples, pins, overlaps: [...new Set(out)] });
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    frames,
  );
}

test('pins_never_cover_labels_single_view', async ({ page }) => {
  test.setTimeout(400_000);
  await ready(page);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('20');
  await blur(page);
  await page.getByRole('button', { name: 'Close the main bridge' }).click();
  await blur(page);
  let pins = 0;
  const all: string[] = [];
  for (let k = 0; k < 4; k++) {
    await sleep(8_000); // ≈ 5 sim min per phase at 20×
    const run = await sampleOverlaps(page, 120);
    await setRunning(page, false);
    await sleep(400);
    const paused = await sampleOverlaps(page, 20);
    await setRunning(page, true);
    pins += run.pins + paused.pins;
    all.push(...run.overlaps, ...paused.overlaps);
  }
  expect(pins, 'queue pins were shown').toBeGreaterThan(100);
  expect([...new Set(all)], 'no queue pin covers a label or another pin').toEqual([]);
});

test('pins_never_cover_labels_comparing_and_named_markers', async ({ page }) => {
  test.setTimeout(400_000);
  await ready(page);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('20');
  await blur(page);
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(2600);
  await setRunning(page, false);
  // in A's past: B branches with the Main Bridge closed
  const slider = page.getByRole('slider', { name: 'Timeline' });
  await slider.focus();
  const p = (await snap(page)).timeline.positionTick;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p - 120);
  await blur(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  // the timeline names B's closure (at the branch tick, the window's start) and keeps it inside the track
  const marker = page.locator('.timeline-track').getByLabel(/^B: Closed Main Bridge at /);
  await expect(marker).toBeVisible();
  await expect(marker).toContainText('✕B');
  const track = (await page.locator('.timeline-track').boundingBox())!;
  const m = (await marker.boundingBox())!;
  expect(m.x, 'inside the track on the left').toBeGreaterThanOrEqual(track.x - 0.5);
  expect(m.x + m.width, 'inside the track on the right').toBeLessThanOrEqual(track.x + track.width + 0.5);
  // pins on both halves, running and paused
  await setRunning(page, true);
  let pins = 0;
  const all: string[] = [];
  for (let k = 0; k < 3; k++) {
    await sleep(6_000);
    const run = await sampleOverlaps(page, 120);
    await setRunning(page, false);
    await sleep(400);
    const paused = await sampleOverlaps(page, 20);
    await setRunning(page, true);
    pins += run.pins + paused.pins;
    all.push(...run.overlaps, ...paused.overlaps);
  }
  expect(pins, 'queue pins were shown').toBeGreaterThan(100);
  expect([...new Set(all)], 'no queue pin covers a label or another pin, on either half').toEqual([]);
});
