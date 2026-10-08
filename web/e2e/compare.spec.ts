// Ward timeline-004, tests 11–18: the side-by-side comparison (contract T4).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slider = (page: Page) => page.getByRole('slider', { name: 'Timeline' });
const compareButton = (page: Page) => page.getByRole('button', { name: 'Compare side by side' });
const panel = (page: Page) => page.getByRole('region', { name: 'Comparison' });
const comparison = (page: Page) => page.evaluate(() => window.__livingcity!.comparison());

function hms(tick: number): string {
  const s = Math.floor(tick * 0.5);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}
/** "m:ss" of seconds, "—" when undefined (NaN). */
const mss = (s: number) => (Number.isFinite(s) ? `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}` : '—');
const fmtDelta = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0');

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}

/** The latest comparison is for the tick the page shows (a pause or seek sends a fresh one). */
async function freshComparison(page: Page) {
  await expect.poll(async () => (await comparison(page))?.tick).toBe((await snap(page)).sides!.a.tick);
  return (await comparison(page))!;
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
  // let B apply its closure, so the sides differ
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).closed.length).toBeGreaterThan(0);
  await pause(page);
  await compareButton(page).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await expect(compareButton(page)).toHaveAttribute('aria-pressed', 'true');
}

async function cellsOf(page: Page, name: string): Promise<string[]> {
  return panel(page).getByRole('row', { name: new RegExp(`^${name}`) }).getByRole('cell').allTextContents();
}

// 11
test('compare_split_view', async ({ page }) => {
  await comparing(page);
  const vw = page.viewportSize()!.width;
  const a = (await page.locator('canvas.city').first().boundingBox())!;
  const b = (await page.locator('canvas.city-b').boundingBox())!;
  expect(Math.abs(a.width - vw / 2)).toBeLessThanOrEqual(4);
  expect(Math.abs(b.width - vw / 2)).toBeLessThanOrEqual(4);
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1);
  // a corner label (not a button) inside each canvas
  for (const [text, box] of [
    ['A: original', a],
    ['B: branch', b],
  ] as const) {
    const hits = await page.getByText(text, { exact: true }).evaluateAll((els) =>
      els.filter((e) => !e.closest('button')).map((e) => {
        const r = e.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }),
    );
    expect(hits.some(([x, y, w, h]) => w! > 0 && x! >= box.x && x! + w! <= box.x + box.width && y! >= box.y && y! + h! <= box.y + box.height), text).toBe(true);
  }
  await expect(panel(page)).toContainText(/sim time \d\d:\d\d:\d\d \(both\)/);
  await expect(panel(page)).toContainText(/measured since \d\d:\d\d:\d\d \(branch\)/);
  for (const name of ['Generated', 'Completed', 'Incomplete', 'Unserved', 'Mean trip', 'p95 trip']) {
    await expect(panel(page).getByRole('row', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  for (const col of ['A', 'B', 'Δ']) await expect(panel(page).getByRole('columnheader', { name: col, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Simulation metrics' })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Legend' })).toBeHidden();
  // the camera fit leaves the comparison band: the main bridge lies inside B's inset rectangle
  const q = (await page.evaluate((l) => window.__livingcity!.linkScreenPointB(l, 0.5), (await snap(page)).landmarks!.central_bridge[0]))!;
  expect(q[0]).toBeGreaterThan(b.x + 16);
  expect(q[0]).toBeLessThan(b.x + b.width - 16);
  expect(q[1]).toBeGreaterThan(b.y + 120);
  expect(q[1]).toBeLessThan(b.y + b.height - 230);
});

// 12
test('comparison_matches_host_numbers', async ({ page }) => {
  await comparing(page);
  // right after entering (cohort of a few ticks): undefined means show "—"
  let c = await freshComparison(page);
  const mean0 = await cellsOf(page, 'Mean trip');
  expect(mean0.slice(0, 2)).toEqual([mss(c.a[7]!), mss(c.b[7]!)]);
  if (!Number.isFinite(c.a[7]!) || !Number.isFinite(c.b[7]!)) expect(mean0[2]).toBe('—');
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).sides!.a.tick, { timeout: 30_000 }).toBeGreaterThan(c.tick + 400);
  await pause(page);
  c = await freshComparison(page);
  expect(c.fromTick).toBe((await snap(page)).branchTick);
  for (const [name, i] of [
    ['Generated', 2],
    ['Completed', 3],
    ['Incomplete', 6],
  ] as const) {
    const cells = await cellsOf(page, name);
    expect([Number(cells[0]), Number(cells[1])], name).toEqual([c.a[i], c.b[i]]);
    const d = c.b[i]! - c.a[i]!;
    expect(cells[2]).toContain(fmtDelta(d));
    expect(cells[2]!.includes('▲')).toBe(d > 0);
    expect(cells[2]!.includes('▼')).toBe(d < 0);
  }
  const unserved = await cellsOf(page, 'Unserved');
  expect([Number(unserved[0]), Number(unserved[1])]).toEqual([c.a[4]! + c.a[5]!, c.b[4]! + c.b[5]!]);
  for (const [name, i] of [
    ['Mean trip', 7],
    ['p95 trip', 8],
  ] as const) {
    const cells = await cellsOf(page, name);
    expect(cells.slice(0, 2)).toEqual([mss(c.a[i]!), mss(c.b[i]!)]);
  }
  await expect(panel(page)).toContainText(`sim time ${hms(c.tick)} (both)`);
  await expect(panel(page)).toContainText(`measured since ${hms(c.fromTick)} (branch)`);
});

// 13
test('matching_sim_time_and_scrub', async ({ page }) => {
  await comparing(page);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('20');
  await blur(page);
  await page.keyboard.press('Space');
  for (let k = 0; k < 10; k++) {
    await sleep(300);
    const s = await snap(page);
    expect(s.sides).not.toBeNull();
    expect(s.sides!.a.tick).toBe(s.sides!.b.tick); // the UI commits frame pairs together
  }
  await pause(page);
  const s = await snap(page);
  await freshComparison(page);
  await expect(panel(page)).toContainText(`sim time ${hms(s.sides!.a.tick)} (both)`);
  // scrubbing while comparing moves both sides
  await slider(page).focus();
  const p = s.sides!.a.tick;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).sides!.a.tick).toBe(p - 120);
  expect((await snap(page)).sides!.b.tick).toBe(p - 120);
  await freshComparison(page);
  await expect(panel(page)).toContainText(`sim time ${hms(p - 120)} (both)`);
});

// 14
test('linked_cameras', async ({ page }) => {
  await comparing(page);
  const b = (await page.locator('canvas.city-b').boundingBox())!;
  const road = (await snap(page)).landmarks!.central_bridge[0];
  const pointB = () => page.evaluate((l) => window.__livingcity!.linkScreenPointB(l, 0.5)!, road);
  // zoom anchored at a point on the right half keeps that point under the cursor
  const q = await pointB();
  const z0 = (await snap(page)).camera.zoom;
  await page.mouse.move(q[0], q[1]);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await snap(page)).camera.zoom).toBeGreaterThan(z0 * 1.2);
  const q1 = await pointB();
  expect(Math.hypot(q1[0] - q[0], q1[1] - q[1])).toBeLessThanOrEqual(2);
  // a drag on the right half pans by exactly the drag
  const start = [b.x + b.width / 2, b.y + b.height / 2 + 40] as const;
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(start[0] + 60, start[1] + 30, { steps: 6 });
  await page.mouse.up();
  const q2 = await pointB();
  expect(Math.abs(q2[0] - q1[0] - 60)).toBeLessThanOrEqual(2);
  expect(Math.abs(q2[1] - q1[1] - 30)).toBeLessThanOrEqual(2);
  // both renderers drew with the same camera
  const cams = await page.evaluate(() => window.__livingcity!.snapshot().drawnCameras);
  expect(cams).not.toBeNull();
  expect(cams!.a).toEqual(cams!.b);
});

// 15
test('picking_per_side', async ({ page }) => {
  await comparing(page);
  const lm = (await snap(page)).landmarks!;
  const road = lm.central_bridge[0];
  const [pa, pb] = await page.evaluate((l) => [window.__livingcity!.linkScreenPoint(l, 0.5)!, window.__livingcity!.linkScreenPointB(l, 0.5)!], road);
  const pickB = await page.evaluate(([x, y]) => window.__livingcity!.pickAt(x, y), pb!);
  expect(pickB.side).toBe('B');
  expect(lm.central_bridge).toContain(pickB.link);
  await page.mouse.click(pb![0], pb![1]);
  const selected = page.getByRole('region', { name: 'Selected road' });
  await expect(selected).toContainText('(B)');
  await expect(selected).toContainText(/state\s*closed/i);
  const pickA = await page.evaluate(([x, y]) => window.__livingcity!.pickAt(x, y), pa!);
  expect(pickA.side).toBe('A');
  await page.mouse.click(pa![0], pa![1]);
  await expect(selected).toContainText('(A)');
  await expect(selected).toContainText(/state\s*open/i);
  // vehicles are not picked while comparing (no vehicle panel opens)
  expect(pickA.vehicle).toBeNull();
  await expect(page.getByRole('region', { name: 'Selected vehicle' })).toHaveCount(0);
});

// 16
test('interventions_disabled_while_comparing', async ({ page }) => {
  await comparing(page);
  const bridge = page.getByRole('button', { name: /close the main bridge/i });
  await expect(bridge).toBeDisabled();
  await expect(bridge).toHaveAttribute('title', 'Exit comparison to change roads');
  // the road panel's Close/Reopen too
  const road = (await snap(page)).landmarks!.north_bridge[0];
  const pb = (await page.evaluate((l) => window.__livingcity!.linkScreenPointB(l, 0.5)!, road))!;
  await page.mouse.click(pb[0], pb[1]);
  const action = page.getByRole('region', { name: 'Selected road' }).getByRole('button', { name: /^(Close|Reopen) link$/ });
  await expect(action).toBeDisabled();
  await expect(action).toHaveAttribute('title', 'Exit comparison to change roads');
  // the B key does nothing: no confirmation, no pending cue, no change after running
  const before = await snap(page);
  await blur(page);
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: 'Replace the branch' })).toHaveCount(0);
  await expect(bridge).not.toContainText(/pending/i);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).sides!.a.tick).toBeGreaterThan(before.sides!.a.tick + 20);
  await pause(page);
  const after = await snap(page);
  expect(after.sides!.a.closed).toEqual(before.sides!.a.closed);
  expect(after.sides!.b.closed).toEqual(before.sides!.b.closed);
  expect(after.scenario).toBe(before.scenario);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

// 17
test('exit_compare_returns_to_single_view', async ({ page }) => {
  const lost: string[] = [];
  page.on('console', (m) => {
    if (/Too many active WebGL contexts|CONTEXT_LOST/i.test(m.text())) lost.push(m.text());
  });
  await comparing(page);
  await compareButton(page).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(false);
  const vw = page.viewportSize()!.width;
  expect(Math.abs((await page.locator('canvas.city').first().boundingBox())!.width - vw)).toBeLessThanOrEqual(2);
  await expect(page.locator('canvas.city-b')).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Simulation metrics' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Legend' })).toBeVisible();
  // repeated toggling releases B's context: A's map never loses its own
  for (let k = 0; k < 18; k++) {
    await compareButton(page).click();
    await expect.poll(async () => (await snap(page)).compare).toBe(k % 2 === 0);
  }
  expect(
    await page.evaluate(() => (document.querySelector('canvas.city') as HTMLCanvasElement).getContext('webgl2')!.isContextLost()),
  ).toBe(false);
  const f0 = (await snap(page)).renderFrames;
  await expect.poll(async () => (await snap(page)).renderFrames).toBeGreaterThan(f0 + 5);
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(lost).toEqual([]);
  // discarding while comparing also returns to the single view
  await compareButton(page).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await page.getByRole('button', { name: 'Discard branch' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(false);
  await expect(page.locator('canvas.city-b')).toHaveCount(0);
  expect((await snap(page)).branchTick).toBeNull();
});

// 18
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
    const box = (await controls.nth(i).boundingBox())!;
    const onTop = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.controls') !== null, [box.x + box.width / 2, box.y + box.height / 2] as const);
    expect(onTop, `control ${i} is clickable`).toBe(true);
  }
  // the confirmation takes focus on its primary button; Cancel and Replace return focus to the slider
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  for (const choice of ['Cancel', 'Replace the branch'] as const) {
    await slider(page).focus();
    const q = (await snap(page)).timeline.positionTick;
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(q - 120);
    await blur(page);
    await page.keyboard.press('b');
    await expect(page.getByRole('button', { name: 'Replace the branch' })).toBeFocused();
    await page.getByRole('button', { name: choice }).click();
    await expect(slider(page)).toBeFocused();
    if (choice === 'Replace the branch') await expect.poll(async () => (await snap(page)).branchTick).toBe(q - 120);
  }
});
