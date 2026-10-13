// Ward motion-003, tests 7–10 (browser): the intervention summary, timeline markers, bridge labels and queue
// pins from real sim data; crossings since the branch in the comparison; layout and accessibility.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
/** Sim clock hh:mm:ss of a tick (DT = 0.5 s). */
const hms = (tick: number) => {
  const s = Math.floor(tick / 2);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, '0')).join(':');
};
const FORBIDDEN = /because|caused|due to|faster|slower/i;
const SIZES = [
  { width: 1280, height: 800 },
  { width: 900, height: 800 },
  { width: 768, height: 800 },
];

async function ready(page: Page, url = '/') {
  await page.goto(url);
  await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThan(1800);
}
async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}
async function speed(page: Page, m: number) {
  await page.getByRole('combobox', { name: 'Speed' }).selectOption(String(m));
  await blur(page);
}
/** Close the Main Bridge at 20× and run `ticks` more; returns the close command's tick (from the summary hook). */
async function closeAndRun(page: Page, ticks: number) {
  await speed(page, 20);
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await blur(page);
  await expect.poll(async () => (await page.evaluate(() => window.__livingcity!.interventions())).length, { timeout: 30_000 }).toBeGreaterThan(0);
  const at = (await page.evaluate(() => window.__livingcity!.interventions()))[0]!.tick;
  await expect.poll(async () => (await snap(page)).tick, { timeout: 240_000 }).toBeGreaterThan(at + ticks);
  await pause(page);
  await sleep(800);
  return at;
}
/** The expected pins: the 3 most-queued links (≥ 3), ties to the lower id. */
const expectedPins = (q: number[]) =>
  q
    .map((queued, link) => ({ link, queued }))
    .filter((x) => x.queued >= 3)
    .sort((a, b) => b.queued - a.queued || a.link - b.link)
    .slice(0, 3);
const summary = (page: Page) => page.getByRole('region', { name: 'Intervention' });
/** The comparison's count format: "+n ▲", "−n ▼" or "0". */
const countDelta = (d: number) => (d > 0 ? `+${d} ▲` : d < 0 ? `−${-d} ▼` : '0');
/** The accessible names of the timeline's intervention markers. */
const markerNames = (page: Page) => page.locator('.timeline-track [aria-label]').evaluateAll((es) => es.map((e) => e.getAttribute('aria-label')!).filter((n) => /^(Closed|Reopened) /.test(n)));

// 7
test('intervention_summary_and_map_markers', async ({ page }) => {
  test.setTimeout(400_000);
  await ready(page);
  const at = await closeAndRun(page, 1800);
  const s = await snap(page);
  const entries = await page.evaluate(() => window.__livingcity!.interventions());
  expect(entries).toEqual([{ tick: at, kind: 'close', label: 'Main Bridge', links: [...s.landmarks!.central_bridge] }]);
  // the summary: which road, when
  const box = summary(page);
  await expect(box).toBeVisible();
  await expect(box).toContainText('Closed Main Bridge');
  await expect(box).toContainText(hms(at));
  await expect(box).toContainText('✕');
  await expect(box).toContainText(/observed/i);
  expect(await box.innerText()).not.toMatch(FORBIDDEN);
  // the timeline marker: at the tick's fraction of the track, named, with a glyph
  const marker = page.locator('.timeline-track').getByLabel(`Closed Main Bridge at ${hms(at)}`);
  await expect(marker).toBeVisible();
  await expect(marker).toContainText('✕');
  const track = (await page.locator('.timeline-track').boundingBox())!;
  const mb = (await marker.boundingBox())!;
  const { windowStartTick: lo, headTick: hi } = s.timeline;
  const x = track.x + ((at - lo) / Math.max(1, hi - lo)) * track.width;
  expect(Math.abs(mb.x + mb.width / 2 - x), 'marker at the close tick').toBeLessThanOrEqual(2);
  // the bridges named on the map, at their midpoints
  const labels = await page.evaluate(() => window.__livingcity!.bridgeLabels());
  expect(labels.map((l) => l.name)).toEqual(['North Bridge', 'Main Bridge', 'Old Bridge']);
  for (const [i, key] of (['north_bridge', 'central_bridge', 'south_bridge'] as const).entries()) {
    const [we, ew] = s.landmarks![key];
    const mid = await page.evaluate(([a, b]) => {
      const h = window.__livingcity!;
      const p = h.linkScreenPoint(a, 0.5)!;
      const q = h.linkScreenPoint(b, 0.5)!;
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as [number, number];
    }, [we, ew] as const);
    expect(labels[i]!.shown, `${labels[i]!.name} shown at the fitted view`).toBe(true);
    expect(Math.hypot(labels[i]!.page[0] - mid[0], labels[i]!.page[1] - mid[1]), `${labels[i]!.name} at its bridge`).toBeLessThanOrEqual(6);
    await expect(page.locator('.labels .bridge-label', { hasText: labels[i]!.name })).toBeVisible();
  }
  // the queue pins: the most-queued links of the frame, with their counts, at their stop-line ends
  const pins = await page.evaluate(() => window.__livingcity!.queuePins());
  const want = expectedPins(s.linkQueued);
  expect(want.length, 'queues after closing the Main Bridge').toBeGreaterThan(0);
  expect(pins.map(({ link, queued }) => ({ link, queued }))).toEqual(want);
  for (const p of pins) {
    const end = (await page.evaluate((l) => window.__livingcity!.linkScreenPoint(l, 1), p.link))!;
    expect(Math.hypot(p.page[0] - end[0], p.page[1] - end[1]), `pin of link ${p.link} at its stop-line end`).toBeLessThanOrEqual(8);
    await expect(page.locator('.labels .queue-pin').filter({ hasText: new RegExp(`^\\s*▼ ${p.queued}\\s*$`) }).first()).toBeAttached();
  }
  // the summary lists the same queues, and the crossings it shows are the hook's
  for (const p of want) await expect(box.getByRole('button', { name: new RegExp(`^Link ${p.link} · ${p.queued} queued`) })).toBeVisible();
  const rates = await page.evaluate(() => window.__livingcity!.crossings());
  expect(rates.map((r) => r.name)).toEqual(['North Bridge', 'Main Bridge', 'Old Bridge']);
  for (const r of rates) {
    expect(r.now, `${r.name}: a rate now`).not.toBeNull();
    expect(r.before, `${r.name}: a rate before the closure`).not.toBeNull();
    const cells = await box.getByRole('row', { name: new RegExp(`^${r.name}`) }).getByRole('cell').allInnerTexts();
    expect(cells.map((c) => c.trim()), `${r.name}: now, before, change`).toEqual([String(Math.round(r.now!)), String(Math.round(r.before!)), countDelta(Math.round(r.now!) - Math.round(r.before!))]);
  }
  // the Main Bridge is closed: nothing crosses it now
  expect(rates[1]!.now).toBe(0);
  for (const n of await markerNames(page)) expect(n).not.toMatch(FORBIDDEN);

  // reopen (Red r1 M3): a second line with ○, a ○ marker at its tick, two entries in tick order
  await page.getByRole('button', { name: /reopen/i }).first().click();
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await page.evaluate(() => window.__livingcity!.interventions())).length, { timeout: 30_000 }).toBe(2);
  await pause(page);
  const two = await page.evaluate(() => window.__livingcity!.interventions());
  expect(two.map((e) => [e.kind, e.label])).toEqual([
    ['close', 'Main Bridge'],
    ['open', 'Main Bridge'],
  ]);
  expect(two[1]!.tick).toBeGreaterThan(two[0]!.tick);
  await expect(box).toContainText(`○ Reopened Main Bridge · ${hms(two[1]!.tick)}`);
  await expect(box).toContainText(`✕ Closed Main Bridge · ${hms(at)}`);
  const reopened = page.locator('.timeline-track').getByLabel(`Reopened Main Bridge at ${hms(two[1]!.tick)}`);
  await expect(reopened).toContainText('○');
  const s2 = await snap(page);
  const tr = (await page.locator('.timeline-track').boundingBox())!;
  const rb = (await reopened.boundingBox())!;
  const x2 = tr.x + ((two[1]!.tick - s2.timeline.windowStartTick) / Math.max(1, s2.timeline.headTick - s2.timeline.windowStartTick)) * tr.width;
  expect(Math.abs(rb.x + rb.width / 2 - x2), 'reopen marker at its tick').toBeLessThanOrEqual(2);

  // rewind to before the closure: the summary goes, both markers stay where they were in time
  await page.getByRole('button', { name: /jump to start/i }).click();
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBeLessThan(at);
  await expect(box).toBeHidden();
  expect(await page.evaluate(() => window.__livingcity!.interventions())).toEqual([]);
  expect((await markerNames(page)).sort()).toEqual([`Closed Main Bridge at ${hms(at)}`, `Reopened Main Bridge at ${hms(two[1]!.tick)}`].sort());
});

// 7b (Red r1 M2): the other city names its bridges and shows the same summary
test('consequences_in_three_bridges', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?city=three_bridges');
  await expect.poll(async () => (await snap(page)).city, { timeout: 60_000 }).toBe('three_bridges');
  await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThan(200);
  const at = await closeAndRun(page, 600);
  await expect(summary(page)).toContainText(`✕ Closed Main Bridge · ${hms(at)}`);
  const labels = await page.evaluate(() => window.__livingcity!.bridgeLabels());
  expect(labels.map((l) => l.name)).toEqual(['North Bridge', 'Main Bridge', 'South Bridge']);
  await expect(page.locator('.labels .bridge-label')).toHaveCount(3);
  const rates = await page.evaluate(() => window.__livingcity!.crossings());
  expect(rates.map((r) => r.name)).toEqual(['North Bridge', 'Main Bridge', 'South Bridge']);
  for (const r of rates) await expect(summary(page).getByRole('row', { name: new RegExp(`^${r.name}`) })).toBeVisible();
});

// 8
test('summary_queue_entry_selects_the_link', async ({ page }) => {
  test.setTimeout(400_000);
  await ready(page);
  await closeAndRun(page, 1200);
  const pins = await page.evaluate(() => window.__livingcity!.queuePins());
  expect(pins.length).toBeGreaterThan(0);
  const { link, queued } = pins[0]!;
  await summary(page).getByRole('button', { name: new RegExp(`^Link ${link} · ${queued} queued`) }).click();
  await expect.poll(async () => (await snap(page)).selectedLink).toBe(link);
  const sel = page.getByRole('region', { name: 'Selected road' });
  await expect(sel.getByRole('heading', { name: new RegExp(`^Link ${link}\\b`) })).toBeVisible();
  await expect(sel, 'the panel shows the same queue count').toContainText(new RegExp(`queued\\s*${queued}\\b`, 'i'));
});

// 9
test('compare_shows_crossings_since_branch', async ({ page }) => {
  test.setTimeout(400_000);
  await ready(page);
  await speed(page, 20);
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(2600);
  await pause(page);
  // in A's past: B branches with the Main Bridge closed
  const slider = page.getByRole('slider', { name: 'Timeline' });
  await slider.focus();
  const p = (await snap(page)).timeline.positionTick;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p - 120);
  await blur(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(p + 600);
  await pause(page);
  const c = (await page.evaluate(() => window.__livingcity!.comparison()))!;
  expect(c.crossings, 'crossings since the branch').not.toBeNull();
  expect(c.crossings!.baseTick).toBe(c.fromTick);
  const panel = page.getByRole('region', { name: 'Comparison' });
  for (const [i, name] of ['North Bridge', 'Main Bridge', 'Old Bridge'].entries()) {
    const a = c.crossings!.a[2 * i]! + c.crossings!.a[2 * i + 1]!;
    const b = c.crossings!.b[2 * i]! + c.crossings!.b[2 * i + 1]!;
    const cells = panel.getByRole('row', { name: new RegExp(`^Crossings · ${name}`) }).getByRole('cell');
    await expect(cells).toHaveCount(3);
    const [ta, tb, td] = await cells.allInnerTexts();
    expect(Number(ta!.replace(/\D/g, '')), `${name} A`).toBe(a);
    expect(Number(tb!.replace(/\D/g, '')), `${name} B`).toBe(b);
    const d = b - a;
    expect(td!.trim(), `${name} Δ`).toBe(d === 0 ? '0' : `${d > 0 ? '+' : '−'}${Math.abs(d)} ${d > 0 ? '▲' : '▼'}`);
  }
  // B has the Main Bridge closed since the branch: fewer crossings of it than A (open)
  expect(c.crossings!.b[2]! + c.crossings!.b[3]!, 'B (closed) < A (open) on the Main Bridge').toBeLessThan(c.crossings!.a[2]! + c.crossings!.a[3]!);
  await expect(summary(page), 'the summary is single-view only').toBeHidden();
  for (const row of ['Generated', 'Completed', 'Incomplete', 'Unserved', 'Mean trip', 'p95 trip']) await expect(panel.getByRole('row', { name: new RegExp(`^${row}`) })).toBeVisible();
  expect(await panel.innerText()).not.toMatch(/faster|slower/i);
  // both halves: bridge labels and queue pins from each side's own frame
  await expect(page.locator('.labels-b .bridge-label')).toHaveCount(3);
  expect(await page.locator('.labels-b .queue-pin').count(), 'queue pins on B').toBeGreaterThan(0);
  expect(await page.locator('.labels:not(.labels-b) .queue-pin').count(), 'queue pins on A').toBeGreaterThan(0);
});

// 10
for (const size of SIZES) {
  test(`consequences_layout_and_a11y (${size.width}×${size.height})`, async ({ page }) => {
    test.setTimeout(400_000);
    await page.setViewportSize(size);
    await ready(page);
    await closeAndRun(page, 900);
    await expect(summary(page)).toBeVisible();
    const r = await page.evaluate(() => {
      const vis = (e: Element) => {
        const st = getComputedStyle(e);
        const b = e.getBoundingClientRect();
        return st.visibility !== 'hidden' && st.display !== 'none' && b.width > 0 && b.height > 0;
      };
      const panels = [...document.querySelectorAll('section.panel')].filter(vis).map((e) => ({ name: e.getAttribute('aria-label') ?? e.className, b: e.getBoundingClientRect() }));
      const overlaps: string[] = [];
      for (let i = 0; i < panels.length; i++)
        for (let j = i + 1; j < panels.length; j++) {
          const [p, q] = [panels[i]!.b, panels[j]!.b];
          if (p.left < q.right - 0.5 && q.left < p.right - 0.5 && p.top < q.bottom - 0.5 && q.top < p.bottom - 0.5) overlaps.push(`${panels[i]!.name} × ${panels[j]!.name}`);
        }
      const outside = panels.filter((p) => p.b.left < -0.5 || p.b.top < -0.5 || p.b.right > innerWidth + 0.5 || p.b.bottom > innerHeight + 0.5).map((p) => p.name);
      const marks: string[] = [];
      for (const e of document.querySelectorAll('.labels .bridge-label, .labels .queue-pin')) {
        const layer = e.closest('.labels')!.getBoundingClientRect();
        const b = e.getBoundingClientRect();
        const fits = b.left >= layer.left - 0.5 && b.top >= layer.top - 0.5 && b.right <= layer.right + 0.5 && b.bottom <= layer.bottom + 0.5;
        const shown = getComputedStyle(e).visibility !== 'hidden';
        if (getComputedStyle(e).display === 'none' || b.width === 0) marks.push(`${e.textContent}: not laid out`);
        else if (shown && !fits) marks.push(`${e.textContent}: shown but cut`);
        else if (!shown && fits) marks.push(`${e.textContent}: hidden although it fits`);
      }
      return { overlaps, outside, marks, scroll: document.documentElement.scrollWidth > innerWidth };
    });
    expect(r.overlaps, 'panels overlap').toEqual([]);
    expect(r.outside, 'panels outside the viewport').toEqual([]);
    expect(r.marks, 'map marks').toEqual([]);
    expect(r.scroll, 'horizontal scroll').toBe(false);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

test('intervention_marker_clears_the_branch_marker', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page);
  await speed(page, 20);
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(2400);
  await pause(page);
  // in A's past: B branches with the closure at its branch tick, so both markers sit at the same time
  const slider = page.getByRole('slider', { name: 'Timeline' });
  await slider.focus();
  const p = (await snap(page)).timeline.positionTick;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p - 120);
  await blur(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  const branch = (await page.locator('.timeline-branch').boundingBox())!;
  const marker = page.locator('.timeline-track').getByLabel(/^Closed Main Bridge at /);
  await expect(marker).toBeVisible();
  const m = (await marker.boundingBox())!;
  const apart = m.x + m.width <= branch.x + 0.5 || branch.x + branch.width <= m.x + 0.5 || m.y + m.height <= branch.y + 0.5 || branch.y + branch.height <= m.y + 0.5;
  expect(apart, 'the intervention marker does not overlap the branch marker').toBe(true);
});
