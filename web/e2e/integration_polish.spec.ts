// Ward polish-006, tests 1, 2, 3, 5, 6: responsiveness under load, close while paused, a clean restart,
// Esc focus from the confirm panel only, pressed toggles keep a visible focus ring.
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const guide = (page: Page) => page.getByRole('region', { name: 'Demo guide' });

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

type Act = 'space' | 'seekBack' | 'compare';
type Until = { running: boolean } | { position: number } | { compare: boolean };

/** In the page: perform `act`, then the ms until the snapshot shows `until` (checked every animation frame). */
async function timed(page: Page, act: Act, until: Until): Promise<number> {
  return page.evaluate(
    ([act, until]) =>
      new Promise<number>((resolve, reject) => {
        const h = window.__livingcity!;
        const done = () => {
          const s = h.snapshot();
          if ('running' in until) return s.running === until.running;
          if ('position' in until) return s.timeline.positionTick === until.position;
          return s.compare === until.compare;
        };
        const t0 = performance.now();
        if (act === 'space') document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        else if (act === 'seekBack') {
          const el = document.querySelector<HTMLElement>('[role="slider"][aria-label="Timeline"]')!;
          el.focus();
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        } else [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Compare side by side')!.click();
        const poll = () => {
          if (done()) resolve(performance.now() - t0);
          else if (performance.now() - t0 > 5000) reject(new Error(`not within 5 s: ${JSON.stringify(until)}`));
          else requestAnimationFrame(poll);
        };
        poll();
      }),
    [act, until] as const,
  );
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

// 1
test('controls_respond_under_load', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page, '/?demand=5');
  await expect.poll(async () => (await snap(page)).metrics['on_network'] ?? 0, { timeout: 180_000, intervals: [2000] }).toBeGreaterThanOrEqual(4000);
  await blur(page);
  const pauseMs: number[] = [];
  const playMs: number[] = [];
  for (let i = 0; i < 3; i++) {
    pauseMs.push(await timed(page, 'space', { running: false }));
    playMs.push(await timed(page, 'space', { running: true }));
  }
  await pause(page);
  const seekMs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const p = (await snap(page)).timeline.positionTick;
    seekMs.push(await timed(page, 'seekBack', { position: p - 120 }));
  }
  await page.keyboard.press('b'); // in A's past: a branch B
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  const compareOn: number[] = [];
  const compareOff: number[] = [];
  for (let i = 0; i < 3; i++) {
    compareOn.push(await timed(page, 'compare', { compare: true }));
    compareOff.push(await timed(page, 'compare', { compare: false }));
  }
  const r = { pause: median(pauseMs), play: median(playMs), seek: median(seekMs), compareOn: median(compareOn), compareOff: median(compareOff) };
  console.log('responsiveness under load (ms, medians):', JSON.stringify(r));
  for (const [k, v] of Object.entries(r)) expect(v, `${k} within 300 ms`).toBeLessThanOrEqual(300);
});

// 2
test('close_while_paused', async ({ page }) => {
  await ready(page);
  await pause(page);
  const lm = (await snap(page)).landmarks!;
  const before = (await snap(page)).closed;
  const bridge = page.getByRole('button', { name: /close the main bridge/i });
  await bridge.click();
  await expect(bridge).toContainText('(pending)');
  await page.waitForTimeout(1000);
  expect((await snap(page)).closed, 'unchanged while paused').toEqual(before);
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).closed, { timeout: 2000 }).toEqual(expect.arrayContaining(lm.central_bridge));
  await expect(bridge).not.toContainText('(pending)');
});

// 3
test('restart_is_clean', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page);
  // guide step 1, a branch (step 4), compare (step 5), a selection and a tracked vehicle
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).closed.length).toBeGreaterThan(0);
  await pause(page);
  await stepBack(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(false);
  const steps = async () => (await guide(page).getByRole('listitem').allTextContents()).map((t) => t.includes('✓'));
  await expect.poll(steps).toEqual([true, false, true, true, true]);
  const link = await page.evaluate(() => {
    const h = window.__livingcity!;
    for (let l = 0; l < h.snapshot().linkCounts.length; l++) {
      const q = h.linkScreenPoint(l, 0.5);
      if (q && document.elementFromPoint(q[0], q[1])?.tagName === 'CANVAS' && h.pickAt(q[0], q[1]).link === l && h.pickAt(q[0], q[1]).vehicle === null) return q;
    }
    return null;
  });
  await page.mouse.click(link![0], link![1]);
  await expect.poll(async () => (await snap(page)).selectedLink).not.toBeNull();
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  // the trap
  await page.evaluate(() => (window.__livingcity as unknown as { debugTrap(): void }).debugTrap());
  const alert = page.getByRole('alert').filter({ hasText: /the simulation stopped/i });
  await expect(alert).toBeVisible({ timeout: 10_000 });
  for (const c of [page.getByRole('button', { name: /^(Play|Pause)$/ }), page.getByRole('combobox', { name: 'Speed' }), page.getByRole('button', { name: /close the main bridge/i })]) {
    await expect(c).toBeDisabled();
    expect(((await c.getAttribute('title')) ?? '').length, 'disabled with a reason').toBeGreaterThan(5);
  }
  // restart: the alert stays until the new world's first frame
  await alert.getByRole('button', { name: 'Restart simulation' }).click();
  await page.waitForTimeout(100);
  const stillThere = await alert.count();
  const firstFrameSeen = await page.evaluate(() => (window.__livingcity?.snapshot().tick ?? 0) > 0 && (window.__livingcity?.snapshot().renderFrames ?? 0) > 0);
  if (!firstFrameSeen) expect(stillThere, 'the alert stays until the new world is ready').toBe(1);
  await expect(alert).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
  const s = await snap(page);
  expect(s.compare).toBe(false);
  expect(s.branchTick).toBeNull();
  expect(s.selectedLink).toBeNull();
  expect(s.trackedTrip).toBeNull();
  expect(s.closed).toEqual([]);
  await expect.poll(steps).toEqual([false, false, false, false, false]);
  for (const c of [page.getByRole('combobox', { name: 'Speed' }), page.getByRole('button', { name: /close the main bridge/i })]) await expect(c).toBeEnabled();
});

// 5
test('esc_focus_only_from_the_confirm', async ({ page }) => {
  await ready(page);
  await pause(page);
  await stepBack(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  const confirm = page.getByRole('region', { name: 'Confirm replacing the branch' });
  // focus outside the panel (body): Esc closes it, focus stays put
  await stepBack(page);
  await page.keyboard.press('b');
  await expect(confirm).toBeVisible();
  await blur(page);
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  // focus inside the panel: Esc closes it and moves focus to the slider
  await stepBack(page);
  await page.keyboard.press('b');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).focus();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Timeline' })).toBeFocused();
});

// 6
test('pressed_toggles_show_focus', async ({ page }) => {
  await ready(page);
  await pause(page);
  await stepBack(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await blur(page);
  await page.keyboard.press('d');
  const targets = [
    page.getByRole('button', { name: 'Guide', exact: true }),
    page.getByRole('button', { name: 'Diagnostics' }),
    page.getByRole('button', { name: /^B: branch from/ }),
  ];
  const ring = (el: Element) => {
    const c = getComputedStyle(el);
    return `${c.outlineStyle}|${c.outlineWidth}|${c.outlineColor}|${c.outlineOffset}|${c.boxShadow}`;
  };
  for (const t of targets) {
    expect(await t.evaluate((el) => el.getAttribute('aria-pressed') ?? el.getAttribute('aria-expanded')), 'a pressed toggle').toBe('true');
    await blur(page);
    const unfocused = await t.evaluate(ring);
    // keyboard focus (focus-visible): Tab until it is focused
    let on = false;
    for (let i = 0; i < 60 && !on; i++) {
      await page.keyboard.press('Tab');
      on = await t.evaluate((el) => el === document.activeElement);
    }
    expect(on).toBe(true);
    const focused = await t.evaluate(ring);
    expect(focused, `${await t.getAttribute('aria-label') ?? await t.textContent()}: a focused pressed toggle looks different`).not.toBe(unfocused);
  }
});
