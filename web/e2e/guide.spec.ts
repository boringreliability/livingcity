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
  // not before 3 sim minutes: paused at ~280 ticks, step 2 is not done yet
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000, intervals: [50] }).toBeGreaterThanOrEqual(closedAt + 280);
  await pause(page);
  expect((await snap(page)).tick, 'paused before 3 sim min').toBeLessThan(closedAt + 360);
  await sleep(500);
  expect((await done(page))[1], 'step 2 not before 3 sim min').toBe(false);
  await page.keyboard.press('Space');
  // 3 sim minutes with the bridge closed
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(closedAt + 380);
  await expect.poll(async () => (await done(page))[1]).toBe(true);
  // pause and rewind (pausing alone is not enough)
  expect((await done(page))[2]).toBe(false);
  await pause(page);
  await sleep(500);
  expect((await done(page))[2], 'step 3 not on pause alone').toBe(false);
  await stepBack(page);
  await expect.poll(async () => (await done(page))[2]).toBe(true);
  // another decision in A's past: a branch
  expect((await done(page))[3]).toBe(false);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await expect.poll(async () => (await done(page))[3]).toBe(true);
  expect((await done(page))[4], 'step 5 not before compare').toBe(false);
  // with a branch, the guide still covers no road (compared with the same view, guide hidden)
  const covered = () =>
    page.evaluate(() => {
      const h = window.__livingcity!;
      const boxes = [...document.querySelectorAll('section.panel, .side-label')]
        .filter((e) => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0)
        .map((e) => e.getBoundingClientRect());
      let n = 0;
      for (let l = 0; l < h.snapshot().linkCounts.length; l++)
        for (let k = 0; k < 10; k++) {
          const q = h.linkScreenPoint(l, 0.05 + k * 0.1);
          if (q && boxes.some((b) => q[0] >= b.left && q[0] <= b.right && q[1] >= b.top && q[1] <= b.bottom)) n++;
        }
      return n;
    });
  const withGuide = await covered();
  await guide(page).getByRole('button', { name: 'Hide demo guide' }).click();
  await expect(guide(page)).toBeHidden();
  const withoutGuide = await covered();
  expect(withGuide, 'the guide adds no covered road with a branch').toBeLessThanOrEqual(withoutGuide);
  await page.getByRole('button', { name: 'Guide', exact: true }).click();
  await expect(guide(page)).toBeVisible();
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
  test.setTimeout(300_000);
  await ready(page);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('60');
  await blur(page);
  const t0 = (await snap(page)).tick;
  await sleep(15_000);
  expect((await snap(page)).tick - t0, 'the sim ran ≥ 7 sim min').toBeGreaterThanOrEqual(840);
  expect(await done(page)).toEqual([false, false, false, false, false]);
  // another road closed for ≥ 4 sim min (then reopened) ticks nothing
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
  const t1 = (await snap(page)).tick;
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThan(t1 + 480);
  await panel.getByRole('button', { name: 'Reopen link' }).click();
  await sleep(500);
  expect(await done(page), 'another road: nothing').toEqual([false, false, false, false, false]);
  await page.keyboard.press('Escape');
  // the main bridge closed and running at 1× for 12 s of wall time (≈ 24 ticks): only step 1
  const lm = (await snap(page)).landmarks!;
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('1');
  await blur(page);
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(lm.central_bridge));
  const tc = (await snap(page)).tick;
  await sleep(12_000);
  expect((await snap(page)).tick - tc, 'running, but far from 3 sim min').toBeLessThan(300);
  expect(await done(page), 'running 12 s at 1×: only step 1').toEqual([true, false, false, false, false]);
  // and paused for 12 s of wall time: still only step 1
  await pause(page);
  await sleep(12_000);
  expect(await done(page), 'paused 12 s: only step 1').toEqual([true, false, false, false, false]);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('60');
  await blur(page);
  // reopened, then ≥ 4 sim min running with the bridge open: still no step 2 (not "closed throughout")
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await blur(page);
  const t2 = (await snap(page)).tick;
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).closed.filter((l) => lm.central_bridge.includes(l)).length, { timeout: 30_000 }).toBe(0);
  await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThan(t2 + 480);
  expect((await done(page))[1], 'reopened: no step 2').toBe(false);
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
  // a new page in the same context (localStorage, not sessionStorage)
  const p1 = await context.newPage();
  await ready(p1);
  await expect(guide(p1)).toBeHidden();
  await p1.close();
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
  const hide = guide(page).getByRole('button', { name: 'Hide demo guide' });
  let on = false;
  for (let i = 0; i < 60 && !on; i++) {
    await page.keyboard.press('Tab');
    on = await hide.evaluate((el) => el === document.activeElement);
  }
  expect(on, 'Tab reaches "Hide demo guide"').toBe(true);
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Guide', exact: true })).toBeFocused();
});

// 7
test('speed_hint_when_b_lags', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page);
  await pause(page);
  await stepBack(page);
  await stepBack(page);
  // in A (even behind its head) at 20×: no hint; and rewinding without a closure does not tick step 3
  await expect(guide(page)).not.toContainText('60×');
  expect((await done(page))[2], 'step 3 needs step 1').toBe(false);
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
