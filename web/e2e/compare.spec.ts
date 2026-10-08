// Ward timeline-004, tests 9–16: the side-by-side comparison (contract T4).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slider = (page: Page) => page.getByRole('slider', { name: 'Timeline' });
const compareButton = (page: Page) => page.getByRole('button', { name: 'Compare side by side' });
const panel = (page: Page) => page.getByRole('region', { name: 'Comparison' });

function hms(tick: number): string {
  const s = Math.floor(tick * 0.5);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}

/** Load, step back 2 min, close the main bridge (→ B), and enter the comparison. */
async function comparing(page: Page) {
  await page.goto('/');
  await expect.poll(async () => (await snap(page)).timeline.headTick, { timeout: 60_000 }).toBeGreaterThan(2400);
  await pause(page);
  await slider(page).focus();
  for (let k = 0; k < 2; k++) {
    const p = (await snap(page)).timeline.positionTick;
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p - 120);
  }
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await compareButton(page).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await expect(compareButton(page)).toHaveAttribute('aria-pressed', 'true');
}

/** Values of a comparison row ("Incomplete" → [A, B]) as numbers. */
async function row(page: Page, name: string): Promise<[number, number]> {
  const cells = panel(page).getByRole('row', { name: new RegExp(`^${name}`) }).getByRole('cell');
  const t = await cells.allTextContents();
  const num = (s: string) => Number(s.replace(/[^\d.-]/g, ''));
  return [num(t[0]!), num(t[1]!)];
}

// 9
test('compare_split_view', async ({ page }) => {
  await comparing(page);
  const vw = page.viewportSize()!.width;
  const a = (await page.locator('canvas.city').first().boundingBox())!;
  const b = (await page.locator('canvas.city-b').boundingBox())!;
  expect(Math.abs(a.width - vw / 2)).toBeLessThanOrEqual(4);
  expect(Math.abs(b.width - vw / 2)).toBeLessThanOrEqual(4);
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1);
  await expect(page.getByText('A: original', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('B: branch', { exact: true }).first()).toBeVisible();
  await expect(panel(page)).toContainText(/sim time \d\d:\d\d:\d\d \(both\)/);
  await expect(panel(page)).toContainText(/measured since \d\d:\d\d:\d\d \(branch\)/);
  for (const name of ['Generated', 'Completed', 'Incomplete', 'Unserved', 'Mean trip', 'p95 trip']) {
    await expect(panel(page).getByRole('row', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  for (const col of ['A', 'B', 'Δ']) await expect(panel(page).getByRole('columnheader', { name: col })).toBeVisible();
  // the metrics strip and legend give way to the comparison
  await expect(page.getByRole('region', { name: 'Simulation metrics' })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Legend' })).toBeHidden();
});

// 10
test('comparison_matches_host_numbers', async ({ page }) => {
  await comparing(page);
  await blur(page);
  await page.keyboard.press('Space');
  await sleep(2500);
  await pause(page);
  await sleep(700); // the pause sends a fresh comparison
  const c = (await page.evaluate(() => window.__livingcity!.comparison()))!;
  expect(c).not.toBeNull();
  expect(c.tick).toBe((await snap(page)).tick);
  expect(c.fromTick).toBe((await snap(page)).branchTick);
  expect(await row(page, 'Generated')).toEqual([c.a[2], c.b[2]]);
  expect(await row(page, 'Completed')).toEqual([c.a[3], c.b[3]]);
  expect(await row(page, 'Incomplete')).toEqual([c.a[6], c.b[6]]);
  await expect(panel(page)).toContainText(`sim time ${hms(c.tick)} (both)`);
  await expect(panel(page)).toContainText(`measured since ${hms(c.fromTick)} (branch)`);
});

// 11
test('matching_sim_time', async ({ page }) => {
  await comparing(page);
  await blur(page);
  await page.keyboard.press('Space');
  for (let k = 0; k < 10; k++) {
    await sleep(300);
    const s = await snap(page);
    expect(s.sides).not.toBeNull();
    expect(s.sides!.a.tick).toBe(s.sides!.b.tick);
  }
  await pause(page);
  await sleep(700);
  const s = await snap(page);
  await expect(panel(page)).toContainText(`sim time ${hms(s.sides!.a.tick)} (both)`);
});

// 12
test('linked_cameras', async ({ page }) => {
  await comparing(page);
  const a = (await page.locator('canvas.city').first().boundingBox())!;
  const b = (await page.locator('canvas.city-b').boundingBox())!;
  const z0 = (await snap(page)).camera.zoom;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await snap(page)).camera.zoom).toBeGreaterThan(z0 * 1.2);
  const c0 = (await snap(page)).camera;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).camera.cx).not.toBe(c0.cx);
  // the same road sits at the same place within each half
  const road = (await snap(page)).landmarks!.central_bridge[0];
  const rel = await page.evaluate((l) => {
    const h = window.__livingcity!;
    const p = h.linkScreenPoint(l, 0.5)!;
    const q = h.linkScreenPointB(l, 0.5)!;
    const ra = document.querySelector('canvas.city')!.getBoundingClientRect();
    const rb = document.querySelector('canvas.city-b')!.getBoundingClientRect();
    return [p[0] - ra.left, p[1] - ra.top, q[0] - rb.left, q[1] - rb.top];
  }, road);
  expect(Math.abs(rel[0]! - rel[2]!)).toBeLessThanOrEqual(1);
  expect(Math.abs(rel[1]! - rel[3]!)).toBeLessThanOrEqual(1);
});

// 13
test('picking_per_side', async ({ page }) => {
  await comparing(page);
  const road = (await snap(page)).landmarks!.north_bridge[0];
  const [pa, pb] = await page.evaluate((l) => [window.__livingcity!.linkScreenPoint(l, 0.5)!, window.__livingcity!.linkScreenPointB(l, 0.5)!], road);
  expect(await page.evaluate(([x, y]) => window.__livingcity!.pickAt(x, y).side, pb!)).toBe('B');
  await page.mouse.click(pb![0], pb![1]);
  await expect(page.getByRole('region', { name: 'Selected road' })).toContainText('(B)');
  expect(await page.evaluate(([x, y]) => window.__livingcity!.pickAt(x, y).side, pa!)).toBe('A');
  await page.mouse.click(pa![0], pa![1]);
  await expect(page.getByRole('region', { name: 'Selected road' })).toContainText('(A)');
});

// 14
test('interventions_disabled_while_comparing', async ({ page }) => {
  await comparing(page);
  const bridge = page.getByRole('button', { name: /close the main bridge/i });
  await expect(bridge).toBeDisabled();
  await expect(bridge).toHaveAttribute('title', 'Exit comparison to change roads');
  const before = await snap(page);
  await blur(page);
  await page.keyboard.press('b');
  await sleep(400);
  const after = await snap(page);
  expect(after.sides!.a.closed).toEqual(before.sides!.a.closed);
  expect(after.sides!.b.closed).toEqual(before.sides!.b.closed);
  expect(after.scenario).toBe(before.scenario);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

// 15
test('exit_compare_returns_to_single_view', async ({ page }) => {
  await comparing(page);
  await compareButton(page).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(false);
  const vw = page.viewportSize()!.width;
  expect(Math.abs((await page.locator('canvas.city').first().boundingBox())!.width - vw)).toBeLessThanOrEqual(2);
  await expect(page.locator('canvas.city-b')).toBeHidden();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Simulation metrics' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Legend' })).toBeVisible();
  // discarding while comparing also returns to the single view
  await compareButton(page).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await page.getByRole('button', { name: 'Discard branch' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(false);
  await expect(page.locator('canvas.city-b')).toBeHidden();
  expect((await snap(page)).branchTick).toBeNull();
});

// 16
test('layout_and_focus_fixes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await expect.poll(async () => (await snap(page)).timeline.headTick, { timeout: 60_000 }).toBeGreaterThan(2400);
  await pause(page);
  await slider(page).focus();
  const p = (await snap(page)).timeline.positionTick;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p - 120);
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  // the scenario panel covers none of the control panel's controls
  const controls = page.getByRole('region', { name: 'Simulation controls' }).locator('button, select');
  for (let i = 0; i < (await controls.count()); i++) {
    const c = controls.nth(i);
    const box = (await c.boundingBox())!;
    const onTop = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.controls') !== null, [box.x + box.width / 2, box.y + box.height / 2] as const);
    expect(onTop, `control ${i} is clickable`).toBe(true);
  }
  // the confirmation takes focus on its primary button, and Cancel returns focus to the slider
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  await slider(page).focus();
  const q = (await snap(page)).timeline.positionTick;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(q - 120);
  await blur(page);
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: 'Replace the branch' })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(slider(page)).toBeFocused();
});
