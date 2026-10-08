// Ward timeline-005, tests 1–2: the brief's acceptance criterion, end to end in the browser —
// "close a bridge, see the traffic consequences emerge, rewind, try another decision, and compare".
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const slider = (page: Page) => page.getByRole('slider', { name: 'Timeline' });
const MIN = 120; // ticks per sim minute

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}

/** An Old/North Bridge approach ≥ 80 % full while a link feeding it is ≥ 20 % full (city-005 test 10). */
async function spillback(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const h = window.__livingcity!;
    const s = h.snapshot();
    const lm = s.landmarks!;
    const occ = (l: number) => s.linkCounts[l]! / h.linkCapacity(l);
    for (const bridge of [...lm.south_bridge, ...lm.north_bridge])
      for (const a of h.approachLinks(bridge)) if (occ(a) >= 0.8 && h.approachLinks(a).some((f) => occ(f) >= 0.2)) return true;
    return false;
  });
}

/** Step back with ← (the slider focused) until the position is below `tick`. */
async function rewindBelow(page: Page, tick: number) {
  await slider(page).focus();
  for (let i = 0; i < 200 && (await snap(page)).timeline.positionTick >= tick; i++) {
    const p = (await snap(page)).timeline.positionTick;
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await snap(page)).timeline.positionTick).toBeLessThan(p);
  }
  expect((await snap(page)).timeline.positionTick).toBeLessThan(tick);
}

// 1
test('brief_acceptance_flow', async ({ page }) => {
  test.setTimeout(300_000);
  // 1. open: the city is already living
  await page.goto('/');
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
  const s0 = await snap(page);
  expect(s0.running).toBe(true);
  expect(s0.metrics['on_network']!).toBeGreaterThan(300);
  const lm = s0.landmarks!;
  const qs: number[] = [];
  for (let i = 0; i < 5; i++) {
    await expect.poll(async () => (await snap(page)).tick).toBeGreaterThanOrEqual(s0.tick + 30 * (i + 1));
    qs.push((await snap(page)).metrics['queued']!);
  }
  const queued0 = [...qs].sort((a, b) => a - b)[2]!;
  // 2. close the main bridge (at A's head: an ordinary command)
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).closed, { timeout: 10_000 }).toEqual(expect.arrayContaining(lm.central_bridge));
  const closedAt = (await snap(page)).tick;
  expect((await snap(page)).scenario).toBe('A');
  expect((await snap(page)).branchTick).toBeNull();
  // 3. the consequences emerge: queued doubles and an alternative bridge's approach spills back
  let doubled = false;
  let spilled = false;
  const deadline = Date.now() + 150_000;
  for (;;) {
    const s = await snap(page);
    doubled ||= s.metrics['queued']! >= 2 * Math.max(1, queued0);
    spilled ||= await spillback(page);
    if (doubled && spilled) break;
    // within 15 sim minutes of the closure (and a wall-clock guard), else fail at once
    expect(s.tick - closedAt, `queued doubled: ${doubled}, spillback: ${spilled}`).toBeLessThanOrEqual(15 * MIN);
    expect(Date.now(), 'wall-clock guard').toBeLessThan(deadline);
    await page.waitForTimeout(250);
  }
  await pause(page);
  const aHead = (await snap(page)).timeline.headTick;
  // 4. rewind to before the closure
  await rewindBelow(page, closedAt);
  const at = (await snap(page)).timeline.positionTick;
  for (const l of lm.central_bridge) expect((await snap(page)).closed).not.toContain(l); // the bridge is open again there
  // 5. another decision at that moment: keep the main bridge open, close the North Bridge instead
  await blur(page);
  const north = lm.north_bridge;
  const p = (await page.evaluate((l) => window.__livingcity!.linkScreenCenter(l), north[0]))!;
  await page.mouse.click(p[0], p[1]);
  await expect.poll(async () => (await snap(page)).selectedLink).toBe(north[0]);
  await page.getByRole('region', { name: 'Selected road' }).getByRole('button', { name: 'Close link' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  expect((await snap(page)).branchTick).toBe(at);
  // (B sits at its head now: closing the other direction is an ordinary command in B)
  const q = (await page.evaluate((l) => window.__livingcity!.linkScreenCenter(l), north[1]))!;
  await page.mouse.click(q[0], q[1]);
  await expect.poll(async () => (await snap(page)).selectedLink).toBe(north[1]);
  await page.getByRole('region', { name: 'Selected road' }).getByRole('button', { name: 'Close link' }).click();
  // 6. run B up to A's head
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).tick, { timeout: 150_000 }).toBeGreaterThan(aHead);
  await pause(page);
  const b = await snap(page);
  expect(b.closed).toEqual(expect.arrayContaining(north));
  for (const l of lm.central_bridge) expect(b.closed).not.toContain(l);
  // 7. compare side by side at the matching sim time
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  const s = await snap(page);
  expect(s.sides!.a.tick).toBe(s.sides!.b.tick);
  expect(s.sides!.a.tick).toBeGreaterThanOrEqual(aHead); // both have run at least as far as A had
  expect(s.sides!.a.closed).toEqual(expect.arrayContaining(lm.central_bridge));
  expect(s.sides!.b.closed).toEqual(expect.arrayContaining(north));
  for (const l of lm.central_bridge) expect(s.sides!.b.closed).not.toContain(l);
  const panel = page.getByRole('region', { name: 'Comparison' });
  await expect(panel.getByRole('row', { name: /^Incomplete/ })).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.__livingcity!.comparison()))?.tick).toBe(s.sides!.a.tick);
  const c = (await page.evaluate(() => window.__livingcity!.comparison()))!;
  expect(c.fromTick).toBe(at);
  expect(c.a[2]).toBe(c.b[2]); // identical demand: the same trips were generated in A and B
  const gen = await panel.getByRole('row', { name: /^Generated/ }).getByRole('cell').allTextContents();
  expect(Number(gen[0])).toBe(c.a[2]);
  expect(Number(gen[1])).toBe(c.b[2]);
  // incomplete trips for both, the values the sim reported
  const inc = await panel.getByRole('row', { name: /^Incomplete/ }).getByRole('cell').allTextContents();
  expect(Number(inc[0])).toBe(c.a[6]);
  expect(Number(inc[1])).toBe(c.b[6]);
  expect(c.a[6]! + c.b[6]!).toBeGreaterThan(0);
});

// 2
test('acceptance_flow_keyboard_only', async ({ page }) => {
  test.setTimeout(240_000);
  // every pointer/mouse/touch/wheel event the page sees (Enter on a button fires `click`, which is not counted)
  await page.addInitScript(() => {
    const w = window as unknown as { __pointerEvents: string[] };
    w.__pointerEvents = [];
    for (const t of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'touchstart', 'touchend', 'wheel'])
      window.addEventListener(t, () => w.__pointerEvents.push(t), true);
  });
  await page.goto('/');
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
  const lm = (await snap(page)).landmarks!;
  // close the main bridge with B, let it act
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).closed, { timeout: 10_000 }).toEqual(expect.arrayContaining(lm.central_bridge));
  const closedAt = (await snap(page)).tick;
  await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThan(closedAt + 2 * MIN);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
  // Tab to the slider, rewind with ← to before the closure
  let onSlider = false;
  for (let i = 0; i < 60 && !onSlider; i++) {
    await page.keyboard.press('Tab');
    onSlider = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'slider');
  }
  expect(onSlider).toBe(true);
  for (let i = 0; i < 40 && (await snap(page)).timeline.positionTick >= closedAt; i++) {
    const p = (await snap(page)).timeline.positionTick;
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await snap(page)).timeline.positionTick).toBeLessThan(p);
  }
  expect((await snap(page)).timeline.positionTick).toBeLessThan(closedAt);
  const at = (await snap(page)).timeline.positionTick;
  // another decision there with B, pressed on the focused slider (in A's past it creates the branch)
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  expect((await snap(page)).branchTick).toBe(at);
  expect(at).toBeLessThan(closedAt);
  // Tab to "Compare side by side" and press Enter
  let onCompare = false;
  for (let i = 0; i < 60 && !onCompare; i++) {
    await page.keyboard.press('Tab');
    onCompare = await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Compare side by side');
  }
  expect(onCompare).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await expect(page.getByRole('region', { name: 'Comparison' })).toBeVisible();
  expect((await snap(page)).sides!.a.tick).toBe(at);
  expect(await page.evaluate(() => (window as unknown as { __pointerEvents: string[] }).__pointerEvents)).toEqual([]);
});
