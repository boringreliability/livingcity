// Ward polish-006, tests 1, 2, 3, 5, 6: responsiveness under load, close while paused, a clean restart,
// Esc focus from the confirm panel only, pressed toggles keep a visible focus ring.
import { loadavg } from 'node:os';

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
        const frames0 = h.snapshot().renderFrames;
        const done = () => {
          const s = h.snapshot();
          if (s.renderFrames <= frames0) return false; // a frame was drawn after the action
          if ('running' in until) return s.running === until.running;
          if ('position' in until) return s.timeline.positionTick === until.position;
          return s.compare === until.compare && (s.drawnCameras !== null) === until.compare; // and drawn that way
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
        requestAnimationFrame(poll); // not in the same task as the action
      }),
    [act, until] as const,
  );
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

// 1
test('controls_respond_under_load', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page, '/?demand=5');
  await expect(page.getByRole('combobox', { name: 'Speed' })).toHaveValue('20');
  const loadBefore = loadavg();
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
  console.log('responsiveness under load (ms, medians):', JSON.stringify(r), 'machine load before/after:', loadBefore.map((x) => x.toFixed(1)).join(' '), '/', loadavg().map((x) => x.toFixed(1)).join(' '));
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
/** Trap the sim, check the halted controls, restart, and return when the new world is running. */
async function trapAndRestart(page: Page) {
  await page.evaluate(() => (window.__livingcity as unknown as { debugTrap(): void }).debugTrap());
  const alert = page.getByRole('alert').filter({ hasText: /the simulation stopped/i });
  await expect(alert).toBeVisible({ timeout: 10_000 });
  // halted: the run controls are disabled and say why
  for (const c of [page.getByRole('button', { name: /^(Play|Pause)$/ }), page.getByRole('combobox', { name: 'Speed' }), page.getByRole('button', { name: /close the main bridge/i })]) {
    await expect(c).toBeDisabled();
    expect((await c.getAttribute('title')) ?? '', 'the reason names the halt').toMatch(/stopped|halted|restart/i);
  }
  // restart: in the page, when the alert goes vs when the new world's first frame shows
  const deadTick = (await snap(page)).tick;
  const timing = page.evaluate(
    (deadTick) =>
      new Promise<{ alertGone: number; firstFrame: number }>((resolve) => {
        const h = window.__livingcity!;
        let alertGone = -1;
        let firstFrame = -1;
        const t0 = performance.now();
        const poll = () => {
          const now = performance.now() - t0;
          if (firstFrame < 0 && h.snapshot().tick !== deadTick) firstFrame = now;
          const gone = ![...document.querySelectorAll('[role="alert"]')].some((e) => /the simulation stopped/i.test(e.textContent ?? ''));
          if (alertGone < 0 && gone) alertGone = now;
          if ((alertGone >= 0 && firstFrame >= 0) || now > 60_000) resolve({ alertGone, firstFrame });
          else requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      }),
    deadTick,
  );
  await alert.getByRole('button', { name: 'Restart simulation' }).click();
  const t = await timing;
  expect(t.firstFrame, 'the new world showed a frame').toBeGreaterThanOrEqual(0);
  expect(t.alertGone, 'the alert stays until the new world is ready').toBeGreaterThanOrEqual(t.firstFrame);
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
  for (const c of [page.getByRole('combobox', { name: 'Speed' }), page.getByRole('button', { name: /close the main bridge/i })]) await expect(c).toBeEnabled();
}

test('restart_is_clean', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page);
  const steps = async () => (await guide(page).getByRole('listitem').allTextContents()).map((t) => t.includes('✓'));
  // phase 1 (single view): guide steps 1/3/4, a selection, a tracked and followed vehicle, the confirm dialog open
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).closed.length).toBeGreaterThan(0);
  await pause(page);
  await stepBack(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  await expect.poll(steps).toEqual([true, false, true, true, false]);
  // rewind first: a seek is a jump and drops the tracked vehicle itself, so it must come before tracking
  await stepBack(page);
  const box = (await page.locator('canvas.city').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => { if ((await snap(page)).camera.zoom >= 1.2) return true; await page.mouse.wheel(0, -100); return false; }, { intervals: [100], timeout: 30_000 }).toBe(true);
  await page.mouse.move(3, 3);
  const pick = await page.evaluate(() => {
    const h = window.__livingcity!;
    let road: [number, number] | null = null;
    let car: [number, number] | null = null;
    for (let i = 0; i < h.snapshot().frameRecords && !car; i++) {
      const p = h.vehicleScreenCenter(i);
      if (p && document.elementFromPoint(p[0], p[1])?.tagName === 'CANVAS' && h.pickAt(p[0], p[1]).vehicle === i) car = p;
    }
    for (let l = 0; l < h.snapshot().linkCounts.length && !road; l++) {
      const q = h.linkScreenPoint(l, 0.5);
      if (q && document.elementFromPoint(q[0], q[1])?.tagName === 'CANVAS' && h.pickAt(q[0], q[1]).link === l && h.pickAt(q[0], q[1]).vehicle === null) road = q;
    }
    return { road, car };
  });
  await page.mouse.click(pick.road![0], pick.road![1]);
  await expect.poll(async () => (await snap(page)).selectedLink).not.toBeNull();
  await page.mouse.click(pick.car![0], pick.car![1]);
  await expect.poll(async () => (await snap(page)).trackedTrip).not.toBeNull();
  await page.getByRole('region', { name: 'Selected vehicle' }).getByRole('button', { name: /^Follow/ }).click();
  await expect.poll(async () => (await snap(page)).following).toBe(true);
  await page.keyboard.press('b');
  const confirm = page.getByRole('region', { name: 'Confirm replacing the branch' });
  await expect(confirm).toBeVisible();
  // everything Restart must clear is set right before the trap
  const pre = await snap(page);
  expect(pre.selectedLink, 'a selected road before the trap').not.toBeNull();
  expect(pre.trackedTrip, 'a tracked vehicle before the trap').not.toBeNull();
  expect(pre.following, 'Follow on before the trap').toBe(true);
  await trapAndRestart(page);
  let s = await snap(page);
  expect(s.branchTick).toBeNull();
  expect(s.selectedLink).toBeNull();
  expect(s.trackedTrip).toBeNull();
  expect(s.following).toBe(false);
  expect(s.closed).toEqual([]);
  await expect(confirm).toHaveCount(0);
  await expect.poll(steps).toEqual([false, false, false, false, false]);
  // phase 2 (comparing): a held pair, the comparison panel
  await pause(page);
  await stepBack(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await page.keyboard.press('Space');
  await trapAndRestart(page);
  s = await snap(page);
  expect(s.compare).toBe(false);
  expect(s.branchTick).toBeNull();
  await expect(page.getByRole('region', { name: 'Comparison' })).toHaveCount(0);
  expect(await page.locator('canvas.city-b').count()).toBe(0);
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
  // focus on another control outside the panel: Esc closes it, focus stays on that control
  await stepBack(page);
  await page.keyboard.press('b');
  await expect(confirm).toBeVisible();
  const live = page.getByRole('button', { name: 'Live', exact: true });
  await live.focus();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(live).toBeFocused();
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
  // shape, not colour alone (the user is colourblind): outline style/width/offset or the box-shadow geometry
  const ring = (el: Element) => {
    const c = getComputedStyle(el);
    const shadowShape = c.boxShadow.replace(/rgba?\([^)]*\)|#[0-9a-f]+/gi, '').trim();
    return `${c.outlineStyle}|${c.outlineWidth}|${c.outlineOffset}|${shadowShape}`;
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
