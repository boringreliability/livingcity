// Ward polish-002, Gold r1 regressions (the approved layout spec stays frozen): the confirm-replace
// panel and a widened control panel (behind message, stress badge) never overlap other panels.
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 800 },
  { width: 768, height: 800 },
];

async function ready(page: Page, url = '/') {
  await page.goto(url);
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}

async function stepBack(page: Page) {
  const slider = page.getByRole('slider', { name: 'Timeline' });
  await slider.focus();
  const p = (await snap(page)).timeline.positionTick;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p - 120);
}

/** Pairwise overlaps among visible panels and side labels (optionally after a DOM tweak in the same task). */
async function overlaps(page: Page, tweak?: 'behind'): Promise<string[]> {
  return page.evaluate((tweak) => {
    if (tweak === 'behind') {
      // the brief's "cannot keep up" message at full length (React rewrites it on the next frame)
      const s = document.querySelector('.controls .behind');
      if (s) s.textContent = '⚠ Behind — the engine cannot keep up with this speed';
    }
    const vis = (e: Element) => {
      const st = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0 && r.width > 0 && r.height > 0;
    };
    const items = [...document.querySelectorAll('section.panel, .side-label')]
      .filter(vis)
      .map((e) => ({ name: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '', b: e.getBoundingClientRect() }));
    const out: string[] = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!.b;
        const b = items[j]!.b;
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push(`${items[i]!.name} × ${items[j]!.name}`);
      }
    for (const x of items) if (x.b.right > window.innerWidth + 0.5 || x.b.bottom > window.innerHeight + 0.5) out.push(`${x.name} off screen`);
    return out;
  }, tweak);
}

for (const size of SIZES) {
  test(`confirm_replace_and_wide_controls_never_overlap (${size.width}×${size.height})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(size);
    await ready(page);
    await pause(page);
    // diagnostics open (D is ignored while the confirmation's button has focus, so first)
    await page.keyboard.press('d');
    await expect(page.getByRole('region', { name: 'Diagnostics' })).toBeVisible();
    // a road selected (the right column is occupied), B exists, then an intervention in A's past
    const c = await page.evaluate((l) => window.__livingcity!.linkScreenCenter(l), (await snap(page)).landmarks!.north_bridge[0]!);
    await page.mouse.click(c![0], c![1]);
    await expect.poll(async () => (await snap(page)).selectedLink).not.toBeNull();
    await stepBack(page);
    await page.keyboard.press('b');
    await expect.poll(async () => (await snap(page)).scenario).toBe('B');
    await page.getByRole('button', { name: 'A: original' }).click();
    await expect.poll(async () => (await snap(page)).scenario).toBe('A');
    await stepBack(page);
    await page.keyboard.press('b');
    await expect(page.getByRole('region', { name: 'Confirm replacing the branch' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Diagnostics' })).toBeVisible();
    await page.waitForTimeout(400);
    expect(await overlaps(page), 'confirm + scenarios + road + diagnostics').toEqual([]);
    expect(await overlaps(page, 'behind'), 'with the behind message').toEqual([]);
    // the scenario panel's buttons stay clickable under the confirmation
    for (const name of [/^B: branch from/, 'Discard branch']) {
      const box = (await page.getByRole('button', { name }).boundingBox())!;
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.scenarios') !== null, [box.x + box.width / 2, box.y + box.height / 2] as const);
      expect(hit, `${String(name)} not covered`).toBe(true);
    }
  });
}

test('stress badge widens nothing into the scenario panel (1280×800 and 900×800)', async ({ page }) => {
  test.setTimeout(180_000);
  for (const size of [SIZES[0]!, SIZES[2]!]) {
    await page.setViewportSize(size);
    await ready(page, '/?demand=6');
    await pause(page);
    await stepBack(page);
    await page.keyboard.press('b');
    await expect.poll(async () => (await snap(page)).scenario).toBe('B');
    await expect(page.getByRole('region', { name: 'Simulation controls' })).toContainText(/stress|×6|6×/i);
    expect(await overlaps(page), `${size.width}: stress badge`).toEqual([]);
    expect(await overlaps(page, 'behind'), `${size.width}: stress badge + behind`).toEqual([]);
  }
});

for (const size of SIZES) {
  test(`error banner overlaps nothing and does not stick (Gold r2 M1, ${size.width}×${size.height})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(size);
    await ready(page);
    await pause(page);
    await stepBack(page);
    const branchAt = (await snap(page)).timeline.positionTick;
    await page.keyboard.press('b');
    await expect.poll(async () => (await snap(page)).scenario).toBe('B');
    // A before the branch tick → the host refuses compare
    await page.getByRole('button', { name: 'A: original' }).click();
    await expect.poll(async () => (await snap(page)).scenario).toBe('A');
    while ((await snap(page)).timeline.positionTick >= branchAt) await stepBack(page);
    await page.getByRole('button', { name: 'Compare side by side' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/compare refused/i);
    await page.waitForTimeout(300);
    expect(await overlaps(page), 'with the error banner').toEqual([]);
    // the next accepted action clears the stale refusal
    await page.getByRole('button', { name: /^B: branch from/ }).click();
    await expect(alert).toHaveCount(0);
    // and a banner can be dismissed
    await page.getByRole('button', { name: 'A: original' }).click();
    await expect.poll(async () => (await snap(page)).scenario).toBe('A');
    await page.getByRole('button', { name: 'Compare side by side' }).click();
    await expect(alert).toContainText(/compare refused/i);
    await alert.getByRole('button', { name: 'Dismiss' }).click();
    await expect(alert).toHaveCount(0);
  });
}

test('panels keep their element (and focus) when the window crosses 960 px (Gold r2 m2)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await ready(page);
  await pause(page);
  await stepBack(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'A: original' }).click();
  await stepBack(page);
  await page.keyboard.press('b');
  await expect(page.getByRole('region', { name: 'Confirm replacing the branch' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).focus();
  await page.evaluate(() => ((window as unknown as { __cancel: Element | null }).__cancel = document.activeElement));
  for (const width of [900, 1024, 768]) {
    await page.setViewportSize({ width, height: 768 });
    await page.waitForTimeout(300);
    const same = await page.evaluate(() => document.activeElement === (window as unknown as { __cancel: Element | null }).__cancel && document.activeElement?.isConnected);
    expect(same, `${width}: focus stays on the same Cancel button`).toBe(true);
    expect(await overlaps(page), `${width}: panels`).toEqual([]);
  }
});

test('timeline bar stays usable at 900 and 768 px (Gold r1 m6)', async ({ page }) => {
  test.setTimeout(180_000);
  for (const size of [SIZES[2]!, SIZES[3]!]) {
    await page.setViewportSize(size);
    await ready(page);
    await pause(page);
    await stepBack(page);
    await page.keyboard.press('b');
    await expect.poll(async () => (await snap(page)).scenario).toBe('B');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const bar = document.querySelector('.timeline')!;
      const track = bar.querySelector('.timeline-track')!.getBoundingClientRect();
      // the bar's direct children, and the branch caption inside the track, must not overlap one another
      const parts = [...bar.children, ...bar.querySelectorAll('.timeline-branch')].map((e) => ({ n: e.className, b: e.getBoundingClientRect() }));
      const bad: string[] = [];
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i]!.b;
          const b = parts[j]!.b;
          const nested = parts[i]!.n === 'timeline-track' || parts[j]!.n === 'timeline-track';
          if (!nested && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) bad.push(`${parts[i]!.n} × ${parts[j]!.n}`);
        }
      const buttons = [...bar.querySelectorAll('.timeline-buttons button')].map((b) => b.getBoundingClientRect().height);
      return { trackW: track.width, vw: window.innerWidth, bad, maxButtonH: Math.max(...buttons) };
    });
    expect(r.trackW, `${size.width}: the track is wide`).toBeGreaterThanOrEqual(0.6 * r.vw);
    expect(r.bad, `${size.width}: timeline parts overlap`).toEqual([]);
    expect(r.maxButtonH, `${size.width}: buttons on one line`).toBeLessThan(30);
    for (const name of ['Jump to start', '−1 min', '+1 min', 'Live']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    expect(await overlaps(page), `${size.width}: panels`).toEqual([]);
  }
});
