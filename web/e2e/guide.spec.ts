// Ward polish-004, tests 1–3 and 5–8: the in-app demo guide (first run), ticked from real actions only.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { GUIDE_STEPS } from '../src/ui/DemoGuide';
import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const guide = (page: Page) => page.getByRole('region', { name: 'Demo guide' });

async function ready(page: Page) {
  await page.goto('/');
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

/** For each step (in GUIDE_STEPS order): whether it shows as done (a ✓ in its text). */
async function done(page: Page): Promise<boolean[]> {
  const items = guide(page).getByRole('listitem');
  await expect(items).toHaveCount(5);
  const texts = await items.allTextContents();
  texts.forEach((t, i) => expect(t, `step ${i + 1} names its title`).toContain(GUIDE_STEPS[i]!));
  return texts.map((t) => t.includes('✓'));
}

// 1
test('guide_shows_on_first_visit', async ({ page }) => {
  test.setTimeout(180_000);
  for (const size of [
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size);
    await ready(page);
    await expect(guide(page)).toBeVisible();
    expect(await done(page)).toEqual([false, false, false, false, false]);
    const r = await page.evaluate(() => {
      const g = document.querySelector('section[aria-label="Demo guide"]')!.getBoundingClientRect();
      const others = [...document.querySelectorAll('section.panel, .side-label')]
        .filter((e) => e.getAttribute('aria-label') !== 'Demo guide' && e.getBoundingClientRect().width > 0)
        .filter((e) => {
          const b = e.getBoundingClientRect();
          return g.left < b.right - 0.5 && b.left < g.right - 0.5 && g.top < b.bottom - 0.5 && b.top < g.bottom - 0.5;
        })
        .map((e) => e.getAttribute('aria-label') ?? e.className);
      const h = window.__livingcity!;
      let roads = 0;
      for (let l = 0; l < h.snapshot().linkCounts.length; l++)
        for (let k = 0; k < 10; k++) {
          const p = h.linkScreenPoint(l, 0.05 + k * 0.1);
          if (p && p[0] >= g.left && p[0] <= g.right && p[1] >= g.top && p[1] <= g.bottom) roads++;
        }
      return { others, roads };
    });
    expect(r.others, `${size.width}: overlaps`).toEqual([]);
    expect(r.roads, `${size.width}: roads under the guide`).toBe(0);
  }
});

// 2
test('steps_tick_from_real_actions', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page);
  const lm = (await snap(page)).landmarks!;
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(lm.central_bridge));
  const closedAt = (await snap(page)).tick;
  await expect.poll(async () => (await done(page))[0]).toBe(true);
  expect((await done(page))[1]).toBe(false);
  // 3 sim minutes with the bridge closed
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(closedAt + 380);
  await expect.poll(async () => (await done(page))[1]).toBe(true);
  // pause and rewind
  expect((await done(page))[2]).toBe(false);
  await pause(page);
  await stepBack(page);
  await expect.poll(async () => (await done(page))[2]).toBe(true);
  // another decision in A's past: a branch
  expect((await done(page))[3]).toBe(false);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await expect.poll(async () => (await done(page))[3]).toBe(true);
  // compare: the guide steps aside; afterwards step 5 is done and the demo complete
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await expect(guide(page)).toBeHidden();
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(false);
  await expect(guide(page)).toBeVisible();
  await expect.poll(async () => done(page)).toEqual([true, true, true, true, true]);
  await expect(guide(page)).toContainText(/demo complete/i);
});

// 3
test('no_step_ticks_by_time_alone', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('60');
  await blur(page);
  const t0 = (await snap(page)).tick;
  await sleep(15_000);
  expect((await snap(page)).tick - t0, 'the sim ran ≥ 7 sim min').toBeGreaterThanOrEqual(840);
  expect(await done(page)).toEqual([false, false, false, false, false]);
  // closing and reopening another road ticks nothing
  await pause(page);
  const found = await page.evaluate(() => {
    const h = window.__livingcity!;
    const s = h.snapshot();
    const main = new Set(s.landmarks!.central_bridge);
    for (let l = 0; l < s.linkCounts.length; l++) {
      if (main.has(l)) continue;
      const q = h.linkScreenPoint(l, 0.5);
      if (!q || document.elementFromPoint(q[0], q[1])?.tagName !== 'CANVAS') continue;
      const pick = h.pickAt(q[0], q[1]);
      if (pick.vehicle === null && pick.link === l) return q;
    }
    return null;
  });
  expect(found).not.toBeNull();
  await page.mouse.click(found![0], found![1]);
  const panel = page.getByRole('region', { name: 'Selected road' });
  await panel.getByRole('button', { name: 'Close link' }).click();
  await blur(page);
  await page.keyboard.press('Space');
  await sleep(1000);
  await panel.getByRole('button', { name: 'Reopen link' }).click();
  await sleep(1000);
  expect(await done(page)).toEqual([false, false, false, false, false]);
});

// 5
test('dismiss_is_remembered_and_reopenable', async ({ page, context }) => {
  test.setTimeout(240_000);
  await ready(page);
  const toggle = page.getByRole('button', { name: 'Guide', exact: true });
  await expect(guide(page)).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await guide(page).getByRole('button', { name: 'Hide demo guide' }).click();
  await expect(guide(page)).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await ready(page); // reload
  await expect(guide(page)).toBeHidden();
  await toggle.click();
  await expect(guide(page)).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await ready(page);
  await expect(guide(page)).toBeVisible();
  // storage blocked: still works, no page error
  const p2 = await context.newPage();
  const errors: string[] = [];
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('storage blocked');
      },
    });
  });
  await ready(p2);
  await expect(guide(p2)).toBeVisible();
  await guide(p2).getByRole('button', { name: 'Hide demo guide' }).click();
  await expect(guide(p2)).toBeHidden();
  await p2.getByRole('button', { name: 'Guide', exact: true }).click();
  await expect(guide(p2)).toBeVisible();
  expect(errors).toEqual([]);
});

// 6
test('guide_keyboard_and_axe', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page);
  await expect(guide(page)).toBeVisible();
  const r = await new AxeBuilder({ page }).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  await blur(page);
  let on = false;
  for (let i = 0; i < 60 && !on; i++) {
    await page.keyboard.press('Tab');
    on = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Hide demo guide' || document.activeElement?.textContent?.trim() === 'Hide demo guide');
  }
  expect(on, 'Tab reaches "Hide demo guide"').toBe(true);
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Guide');
});

// 7
test('speed_hint_when_b_lags', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page);
  await pause(page);
  await stepBack(page);
  await stepBack(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  // B is viewed at its branch tick, below A's head; speed 20×
  await expect(page.getByRole('combobox', { name: 'Speed' })).toHaveValue('20');
  await expect(guide(page)).toContainText('60×');
  expect(await guide(page).getByRole('button', { name: /60/ }).count()).toBe(0);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('60');
  await expect(guide(page)).not.toContainText('60×');
});

// 8
test('warmup_state_is_shown', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/*.wasm*', async (route) => {
    await sleep(1500);
    await route.continue();
  });
  await page.goto('/');
  const status = page.getByRole('status').filter({ hasText: 'Starting the city…' });
  await expect(status).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
  await expect(status).toHaveCount(0);
  await expect(guide(page)).toBeVisible();
});
