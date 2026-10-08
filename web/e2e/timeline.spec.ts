// Ward timeline-003, tests 11–18: the timeline bar, scrubbing, branching and scenarios (contract T3).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slider = (page: Page) => page.getByRole('slider', { name: 'Timeline' });

async function ready(page: Page): Promise<LivingCitySnapshot> {
  page.on('dialog', () => {
    throw new Error('no native dialog may appear');
  });
  await page.goto('/');
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
  // let the replay window grow past a few snapshots (20× ≈ 40 ticks/s)
  await expect.poll(async () => (await snap(page)).timeline.headTick - (await snap(page)).timeline.windowStartTick, { timeout: 60_000 }).toBeGreaterThan(600);
  return snap(page);
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
  await sleep(200);
}

// 11
test('timeline_bar_shows_window_and_memory', async ({ page }) => {
  await ready(page);
  await pause(page);
  const s = await snap(page);
  const tl = s.timeline;
  await expect(slider(page)).toHaveAttribute('aria-valuemin', String(tl.windowStartTick));
  await expect(slider(page)).toHaveAttribute('aria-valuemax', String(tl.headTick));
  await expect(slider(page)).toHaveAttribute('aria-valuenow', String(tl.positionTick));
  await expect(slider(page)).toHaveAttribute('aria-valuetext', /sim time \d\d:\d\d:\d\d/);
  await expect(page.getByText(/\d+(\.\d)? \/ 48 MiB/)).toBeVisible();
  // the bar and the moved panels never cover the city: the bottom-most roads are still canvas
  const covered = await page.evaluate(() => {
    const h = window.__livingcity!;
    const lm = h.snapshot().landmarks!;
    const pts = [...lm.south_bridge].flatMap((l) => [h.linkScreenPoint(l, 0.5), h.linkScreenPoint(l, 0.1), h.linkScreenPoint(l, 0.9)]);
    return pts.filter((p) => p && document.elementFromPoint(p[0], p[1])?.tagName !== 'CANVAS').length;
  });
  expect(covered).toBe(0);
});

// 12
test('keyboard_scrub', async ({ page }) => {
  await ready(page);
  await pause(page);
  const p0 = (await snap(page)).timeline.positionTick;
  await slider(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p0 - 120);
  expect((await snap(page)).running).toBe(false);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p0);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe((await snap(page)).timeline.windowStartTick);
  await page.keyboard.press('End');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe((await snap(page)).timeline.headTick);
});

// 13
test('pointer_scrub', async ({ page }) => {
  await ready(page);
  await pause(page);
  const { windowStartTick: lo, headTick: hi } = (await snap(page)).timeline;
  const box = (await slider(page).boundingBox())!;
  const at = (f: number) => [box.x + f * box.width, box.y + box.height / 2] as const;
  const near = (tick: number, f: number) => Math.abs(tick - (lo + f * (hi - lo))) <= 0.02 * (hi - lo) + 1;
  // a click seeks
  await page.mouse.click(...at(0.25));
  await expect.poll(async () => near((await snap(page)).timeline.positionTick, 0.25)).toBe(true);
  // a drag seeks while moving and ends at the release point
  await page.mouse.move(...at(0.8));
  await page.mouse.down();
  const seen = new Set<number>();
  for (let k = 1; k <= 8; k++) {
    await page.mouse.move(...at(0.8 - k * 0.05), { steps: 2 });
    await sleep(120);
    seen.add((await snap(page)).timeline.positionTick);
  }
  await page.mouse.up();
  await expect.poll(async () => near((await snap(page)).timeline.positionTick, 0.4)).toBe(true);
  expect(seen.size).toBeGreaterThanOrEqual(3); // it seeked during the drag, not only on release
  expect((await snap(page)).timeline.headTick).toBe(hi); // scrubbing never moves the head
});

// 14
test('play_from_the_past_replays_then_continues', async ({ page }) => {
  await ready(page);
  await pause(page);
  const s0 = await snap(page);
  const head = s0.timeline.headTick;
  const metricsAtHead = s0.metrics;
  await slider(page).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(head - 240);
  await blur(page);
  await page.keyboard.press('Space'); // play
  await expect.poll(async () => (await snap(page)).timeline.positionTick, { timeout: 30_000 }).toBeGreaterThan(head + 40);
  expect((await snap(page)).timeline.headTick).toBeGreaterThan(head);
  // determinism: the old head's state is the same
  await pause(page);
  await slider(page).focus();
  await page.evaluate((t) => window.__livingcity!.seekForTest(t), head);
  await expect.poll(async () => (await snap(page)).tick).toBe(head);
  expect((await snap(page)).metrics).toEqual(metricsAtHead);
});

// 15
test('close_in_the_past_creates_branch', async ({ page }) => {
  const s0 = await ready(page);
  await pause(page);
  await slider(page).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const pos = (await snap(page)).timeline.positionTick;
  await expect.poll(async () => (await snap(page)).tick).toBe(pos);
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  const bButton = page.getByRole('button', { name: /^B: branch from \d\d:\d\d:\d\d$/ });
  await expect(bButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Viewing B: branch')).toBeVisible();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  expect((await snap(page)).branchTick).toBe(pos);
  // B runs and closes the bridge
  await blur(page);
  await page.keyboard.press('Space');
  const central = s0.landmarks!.central_bridge;
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(central));
  await pause(page);
  // A is preserved: its bridge is open at its own position
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  await expect(page.getByText('Viewing A: original')).toBeVisible();
  const a = await snap(page);
  expect(a.tick).toBe(pos);
  expect(a.closed).not.toContain(central[0]);
});

// 16
test('replace_branch_needs_confirmation', async ({ page }) => {
  await ready(page);
  await pause(page);
  await slider(page).focus();
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  const firstBranch = (await snap(page)).branchTick;
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  await slider(page).focus();
  await page.keyboard.press('ArrowLeft');
  const newPos = (await snap(page)).timeline.positionTick;
  await expect.poll(async () => (await snap(page)).tick).toBe(newPos);
  await blur(page);
  // When B is pressed in A's past while B exists
  await page.keyboard.press('b');
  await expect(page.getByText('Replace the branch?')).toBeVisible();
  // Cancel keeps everything
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Replace the branch?')).toHaveCount(0);
  expect((await snap(page)).branchTick).toBe(firstBranch);
  expect((await snap(page)).scenario).toBe('A');
  // Replace makes a new B at the new position
  await blur(page);
  await page.keyboard.press('b');
  await page.getByRole('button', { name: 'Replace the branch' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  expect((await snap(page)).branchTick).toBe(newPos);
});

// 17
test('discard_branch', async ({ page }) => {
  await ready(page);
  await pause(page);
  await slider(page).focus();
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'Discard branch' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  expect((await snap(page)).branchTick).toBeNull();
  await expect(page.getByRole('button', { name: 'A: original' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^B: branch from/ })).toHaveCount(0);
});

// 18
test('timeline_is_keyboard_and_label_accessible', async ({ page }) => {
  await ready(page);
  await pause(page);
  // all timeline controls are named and reachable by Tab
  for (const name of ['Jump to start', '−1 min', '+1 min', 'Live']) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
  await blur(page);
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'slider');
  }
  expect(reached).toBe(true);
  // scenario buttons use aria-pressed, and the viewed scenario is named in text
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect(page.getByRole('button', { name: 'A: original' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /^B: branch from/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Viewing B: branch')).toBeVisible();
});
