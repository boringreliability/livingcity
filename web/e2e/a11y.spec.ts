// Ward polish-001, tests 1–7: keyboard access, visible focus, Esc order, honest labels, axe audit.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slider = (page: Page) => page.getByRole('slider', { name: 'Timeline' });

async function ready(page: Page) {
  await page.goto('/');
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}

/** ← on the slider, waiting until the position moved one minute back. */
async function stepBack(page: Page): Promise<number> {
  await slider(page).focus();
  const p = (await snap(page)).timeline.positionTick;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p - 120);
  return p - 120;
}

/** Paused, one minute back, B created by B (main bridge closed in B). */
async function withBranch(page: Page) {
  await ready(page);
  await pause(page);
  const at = await stepBack(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  expect((await snap(page)).branchTick).toBe(at);
  return at;
}

/** Wheel-zoom at the canvas centre to at least `min` px/m. */
async function zoomIn(page: Page, min: number) {
  const box = (await page.locator('canvas.city').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(
      async () => {
        if ((await snap(page)).camera.zoom >= min) return true;
        await page.mouse.wheel(0, -100);
        return false;
      },
      { intervals: [100], timeout: 30_000 },
    )
    .toBe(true);
  await page.mouse.move(5, 400);
  await sleep(200);
}

/** Select, with a pointer click, a visible road that is not part of the main bridge. */
async function selectRoad(page: Page): Promise<number> {
  const found = await page.evaluate(() => {
    const h = window.__livingcity!;
    const s = h.snapshot();
    const main = new Set(s.landmarks!.central_bridge);
    for (let l = 0; l < s.linkCounts.length; l++) {
      if (main.has(l)) continue;
      for (let k = 2; k < 19; k++) {
        const q = h.linkScreenPoint(l, k / 20);
        if (!q || document.elementFromPoint(q[0], q[1])?.tagName !== 'CANVAS') continue;
        const pick = h.pickAt(q[0], q[1]);
        if (pick.vehicle === null && pick.link === l) return { link: l, at: q };
      }
    }
    return null;
  });
  expect(found, 'a visible, clickable road').not.toBeNull();
  await page.mouse.click(found!.at[0], found!.at[1]);
  await expect.poll(async () => (await snap(page)).selectedLink).toBe(found!.link);
  return found!.link;
}

/** Track a vehicle with a pointer click (zoom ≥ 1 px/m). */
async function trackVehicle(page: Page) {
  const at = await page.evaluate(() => {
    const h = window.__livingcity!;
    for (let i = 0; i < h.snapshot().frameRecords; i++) {
      const p = h.vehicleScreenCenter(i);
      if (!p) continue;
      const free = [[0, 0], [-16, -16], [16, -16], [-16, 16], [16, 16]].every(
        ([dx, dy]) => document.elementFromPoint(p[0] + dx!, p[1] + dy!)?.tagName === 'CANVAS',
      );
      if (free && h.pickAt(p[0], p[1]).vehicle === i) return p;
    }
    return null;
  });
  expect(at, 'a clickable vehicle').not.toBeNull();
  await page.mouse.click(at![0], at![1]);
  await expect.poll(async () => (await snap(page)).trackedTrip).not.toBeNull();
}

/** The visible, enabled, keyboard-focusable controls in DOM order (their test ids). */
async function focusables(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = 'button, select, input, textarea, a[href], [tabindex]:not([tabindex="-1"]), [role="slider"]';
    let n = 0;
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && !(el as HTMLButtonElement).disabled && el.tabIndex >= 0;
      })
      .map((el) => {
        el.dataset['a11yId'] ??= `f${n++}-${(el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 30)}`;
        return el.dataset['a11yId']!;
      });
  });
}

/** The focused element's id (as tagged by `focusables`) and whether it shows a focus indicator. */
async function focused(page: Page): Promise<{ id: string | null; ring: boolean; tag: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { id: null, ring: false, tag: 'BODY' };
    const st = getComputedStyle(el);
    const outline = st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 2;
    const shadow = st.boxShadow !== 'none' && st.boxShadow.trim() !== '';
    return { id: el.dataset['a11yId'] ?? null, ring: outline || shadow, tag: el.tagName };
  });
}

/** Tab from the body through all controls: every one is visited, each with a visible ring; Shift+Tab walks back. */
async function tabTour(page: Page, label: string) {
  const all = await focusables(page);
  expect(all.length, `${label}: controls found`).toBeGreaterThan(3);
  await blur(page);
  const forward: string[] = [];
  for (let i = 0; i < all.length + 5; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (f.id === null) continue; // the page itself (wrap-around)
    expect(f.ring, `${label}: focus ring on ${f.id}`).toBe(true);
    if (forward.includes(f.id)) break;
    forward.push(f.id);
  }
  expect([...forward].sort(), `${label}: Tab visits every control`).toEqual([...all].sort());
  // back again: from the last control, Shift+Tab visits them in reverse
  for (let i = 0; i < all.length + 5 && (await focused(page)).id !== forward.at(-1); i++) await page.keyboard.press('Shift+Tab');
  expect((await focused(page)).id, `${label}: Shift+Tab reaches the last control`).toBe(forward.at(-1));
  const back: string[] = [forward.at(-1)!];
  for (let i = 0; i < forward.length + 5 && back.length < forward.length; i++) {
    await page.keyboard.press('Shift+Tab');
    const f = await focused(page);
    if (f.id === null && f.tag === 'BODY') continue; // the page itself (wrap-around), as forward
    back.push(f.id ?? `untagged ${f.tag}`);
  }
  expect(back, `${label}: Shift+Tab walks back`).toEqual([...forward].reverse());
}

/** document.activeElement is connected, visible, and the body or a control. */
async function focusIsSane(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return { ok: false, why: 'no activeElement' };
    if (el === document.body) return { ok: true, why: 'body' };
    const box = el.getBoundingClientRect();
    const control = el.matches('button, select, input, a[href], [role="slider"], [tabindex]');
    return { ok: el.isConnected && box.width > 0 && box.height > 0 && control, why: `${el.tagName} ${el.textContent?.slice(0, 30)}` };
  });
  expect(r.ok, `${label}: focus on ${r.why}`).toBe(true);
}

const confirmPanel = (page: Page) => page.getByRole('region', { name: 'Confirm replacing the branch' });

/** With B existing: view A, step back in A's past, press B → the confirm-replace panel. */
async function openConfirm(page: Page) {
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  await stepBack(page);
  await page.keyboard.press('b');
  await expect(confirmPanel(page)).toBeVisible();
}

// 1
test('tab_reaches_every_control_with_visible_focus', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page);
  await tabTour(page, 'single view');
  await pause(page);
  await zoomIn(page, 0.5);
  await selectRoad(page);
  await tabTour(page, 'road selected');
  await page.keyboard.press('Escape');
  await stepBack(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await tabTour(page, 'compare');
});

// 2
test('esc_closes_innermost_first', async ({ page }) => {
  test.setTimeout(180_000);
  const at = await withBranch(page);
  const bClosed = (await snap(page)).closed;
  await zoomIn(page, 0.5);
  // confirm-replace over a road selection (in A)
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  const link = await selectRoad(page);
  const aBefore = await snap(page);
  await stepBack(page);
  await page.keyboard.press('b');
  await expect(confirmPanel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirmPanel(page)).toHaveCount(0);
  await sleep(300);
  const s = await snap(page);
  expect(s.branchTick).toBe(at); // B not replaced
  expect(s.scenario).toBe('A');
  expect(s.timeline.headTick).toBe(aBefore.timeline.headTick); // A not edited
  expect(s.closed).toEqual(aBefore.closed);
  expect(s.selectedLink).toBe(link); // only the innermost closed
  await page.getByRole('button', { name: /^B: branch from/ }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  expect((await snap(page)).closed).toEqual(bClosed);
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).selectedLink).toBeNull();
  // vehicle before road
  await zoomIn(page, 1.2);
  await selectRoad(page);
  await trackVehicle(page);
  expect((await snap(page)).selectedLink).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).trackedTrip).toBeNull();
  expect((await snap(page)).selectedLink).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).selectedLink).toBeNull();
});

// 3
test('speed_select_pointer_pick_keeps_shortcuts', async ({ page }) => {
  await ready(page);
  const speed = page.getByRole('combobox', { name: 'Speed' });
  // pointer: click the select, pick 60×
  await speed.click();
  await speed.selectOption('60');
  await expect(speed).toHaveValue('60');
  await expect.poll(async () => page.evaluate(() => document.activeElement?.tagName)).not.toBe('SELECT');
  expect((await snap(page)).running).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
  await expect(speed).toHaveValue('60');
  // keyboard: Tab to the select, change with an arrow key → focus stays
  await blur(page);
  let on = false;
  for (let i = 0; i < 40 && !on; i++) {
    await page.keyboard.press('Tab');
    on = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Speed');
  }
  expect(on).toBe(true);
  await page.keyboard.press('ArrowUp');
  await expect(speed).not.toHaveValue('60');
  await sleep(200);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Speed');
});

// 4
test('focus_never_left_on_removed_elements', async ({ page }) => {
  test.setTimeout(180_000);
  await withBranch(page);
  await zoomIn(page, 0.5);
  // Esc on confirm-replace
  await openConfirm(page);
  await page.keyboard.press('Escape');
  await expect(confirmPanel(page)).toHaveCount(0);
  await focusIsSane(page, 'Esc on confirm');
  // Replace (keyboard: the autofocused button + Enter)
  await stepBack(page);
  await page.keyboard.press('b');
  await expect(confirmPanel(page)).toBeVisible();
  await page.getByRole('button', { name: 'Replace the branch' }).focus();
  await page.keyboard.press('Enter');
  await expect(confirmPanel(page)).toHaveCount(0);
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await focusIsSane(page, 'Replace');
  // Esc clearing a selection while the road panel's button has focus
  await selectRoad(page);
  await page.getByRole('region', { name: 'Selected road' }).getByRole('button', { name: /^(Close|Reopen) link$/ }).focus();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).selectedLink).toBeNull();
  await focusIsSane(page, 'Esc on the road panel');
  // leaving compare (keyboard)
  const compare = page.getByRole('button', { name: 'Compare side by side' });
  await compare.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await page.getByRole('button', { name: 'Compare side by side' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snap(page)).compare).toBe(false);
  await focusIsSane(page, 'leaving compare');
  // Discard branch (keyboard)
  await page.getByRole('button', { name: 'Discard branch' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snap(page)).branchTick).toBeNull();
  await focusIsSane(page, 'Discard branch');
});

// 5
test('compare_heading_and_bridge_button_are_honest', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page);
  const lm = (await snap(page)).landmarks!;
  const bridge = page.getByRole('button', { name: /close the main bridge/i });
  // A: close the main bridge at the head, let it act, pause
  await bridge.click();
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(lm.central_bridge));
  const closedAt = (await snap(page)).tick;
  await expect.poll(async () => (await snap(page)).tick, { timeout: 30_000 }).toBeGreaterThan(closedAt + 240);
  await pause(page);
  // B: from before the closure, close the North Bridge instead (B's main bridge stays open)
  while ((await snap(page)).timeline.positionTick >= closedAt) await stepBack(page);
  await zoomIn(page, 0.5);
  await selectRoad(page);
  await page.getByRole('region', { name: 'Selected road' }).getByRole('button', { name: 'Close link' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.keyboard.press('Escape');
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).tick, { timeout: 30_000 }).toBeGreaterThan((await snap(page)).branchTick! + 120);
  await pause(page);
  const heading = page.getByRole('region', { name: 'Scenarios' }).locator('.scenario-label');
  // viewing B: not pressed, the ordinary label
  await expect(heading).toHaveText('Viewing B: branch');
  await expect(bridge).toHaveAttribute('aria-pressed', 'false');
  await expect(bridge).toHaveText(/^\s*Close the main bridge\s*$/);
  // viewing A at its head: pressed, reads as closed
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  await slider(page).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe((await snap(page)).timeline.headTick);
  await expect(heading).toHaveText('Viewing A: original');
  await expect(bridge).toHaveAttribute('aria-pressed', 'true');
  await expect(bridge).toHaveText(/closed/i);
  // comparing: neutral, disabled, explained
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await expect(heading).toHaveText('Comparing A and B');
  await expect(bridge).toBeDisabled();
  expect(await bridge.getAttribute('aria-pressed')).toBeNull();
  await expect(bridge).toHaveText(/^\s*Close the main bridge\s*$/);
  expect(((await bridge.getAttribute('title')) ?? '').trim().length).toBeGreaterThan(5);
  // leaving compare: back to the viewed scenario (A)
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(false);
  await expect(heading).toHaveText('Viewing A: original');
  await expect(bridge).toHaveAttribute('aria-pressed', 'true');
});

// 6
test('page_has_one_h1', async ({ page }) => {
  await withBranch(page);
  const h1 = async () => page.evaluate(() => [...document.querySelectorAll('h1')].map((h) => h.textContent?.trim() ?? ''));
  const check = async (label: string) => {
    const hs = await h1();
    expect(hs.length, `${label}: one h1`).toBe(1);
    expect(hs[0]!.length, `${label}: h1 text`).toBeGreaterThan(3);
  };
  await check('branch');
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  await check('single');
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await check('compare');
});

// 7
test('axe_no_serious_or_critical', async ({ page }) => {
  test.setTimeout(240_000);
  const audit = async (label: string) => {
    const r = await new AxeBuilder({ page }).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.id === 'page-has-heading-one');
    expect(bad.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${label}: axe`).toEqual([]);
  };
  await ready(page);
  await audit('single view');
  await pause(page);
  await zoomIn(page, 1.2);
  await selectRoad(page);
  await audit('road selected');
  await trackVehicle(page);
  await audit('vehicle tracked');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  await expect(page.getByRole('button', { name: 'Diagnostics' })).toHaveAttribute('aria-expanded', 'true');
  await audit('diagnostics');
  await page.keyboard.press('d');
  await stepBack(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await audit('branch B');
  await openConfirm(page);
  await audit('confirm replace');
  await page.getByRole('button', { name: 'Cancel' }).click();
  // A now sits before the branch tick: compare from B
  await page.getByRole('button', { name: /^B: branch from/ }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await audit('compare');
});
