// Ward polish-002, tests 1–6: panels never overlap, compare covers no road, refit on resize only when
// untouched, labels never half-cut, a neutral compare frame, supported widths documented.
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 900, height: 800 },
  { width: 768, height: 800 },
];

async function ready(page: Page) {
  await page.goto('/');
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}

/** Paused, one minute back, B created with B (key). */
async function branch(page: Page) {
  await pause(page);
  const slider = page.getByRole('slider', { name: 'Timeline' });
  await slider.focus();
  const p = (await snap(page)).timeline.positionTick;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBe(p - 120);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await blur(page);
}

async function enterCompare(page: Page) {
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await sleep(300);
}

/** Click a road (not a vehicle) on side `side`, at a point not covered by any panel; returns the link. */
async function selectRoad(page: Page, side: 'A' | 'B'): Promise<number> {
  const found = await page.evaluate((side) => {
    const h = window.__livingcity!;
    const s = h.snapshot();
    const canvas = side === 'A' ? 'city' : 'city-b';
    for (let l = 0; l < s.linkCounts.length; l++) {
      for (let k = 3; k < 18; k++) {
        const q = side === 'A' ? h.linkScreenPoint(l, k / 20) : h.linkScreenPointB(l, k / 20);
        if (!q) continue;
        const el = document.elementFromPoint(q[0], q[1]);
        if (el?.tagName !== 'CANVAS' || !el.classList.contains(canvas)) continue;
        if (side === 'A' && el.classList.contains('city-b')) continue;
        const pick = h.pickAt(q[0], q[1]);
        if (pick.vehicle === null && pick.link === l && pick.side === side) return { link: l, at: q };
      }
    }
    return null;
  }, side);
  expect(found, `a clickable road on ${side}`).not.toBeNull();
  await page.mouse.click(found!.at[0], found!.at[1]);
  await expect.poll(async () => (await snap(page)).selectedLink).toBe(found!.link);
  await page.mouse.move(2, 2);
  await settled(page);
  return found!.link;
}

/** Wait until every panel's size is stable (e.g. the road panel grows when its details arrive). */
async function settled(page: Page) {
  const sizes = () =>
    page.evaluate(() => [...document.querySelectorAll('section.panel')].map((e) => `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`).join(','));
  let prev = '';
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    const now = await sizes();
    if (now === prev) return;
    prev = now;
  }
}

/** The named regions are visible, and every visible panel and side label lies inside the viewport. */
async function expectPanels(page: Page, names: string[], label: string) {
  for (const n of names) await expect(page.getByRole('region', { name: n }), `${label}: ${n} visible`).toBeVisible();
  const out = await page.evaluate(() => {
    const vis = (e: Element) => {
      const st = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0 && r.width > 0 && r.height > 0;
    };
    return [...document.querySelectorAll('section.panel, .side-label')]
      .filter(vis)
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.left < -0.5 || r.top < -0.5 || r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5;
      })
      .map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '');
  });
  expect(out, `${label}: panels outside the viewport`).toEqual([]);
}

/** Pairwise overlaps among visible panels and side labels, plus horizontal scroll. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vis = (e: Element) => {
      const st = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0 && r.width > 0 && r.height > 0;
    };
    const items = [...document.querySelectorAll('section.panel, .side-label')]
      .filter(vis)
      .map((e) => ({ name: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? e.className, b: e.getBoundingClientRect() }));
    const out: string[] = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!.b;
        const b = items[j]!.b;
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push(`${items[i]!.name} × ${items[j]!.name}`);
      }
    if (document.documentElement.scrollWidth > window.innerWidth) out.push(`horizontal scroll: ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    return out;
  });
}

/** Sampled road points (each on its own canvas) inside a visible panel or side label. */
async function coveredRoads(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const h = window.__livingcity!;
    const vis = (e: Element) => {
      const st = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0 && r.width > 0 && r.height > 0;
    };
    const boxes = [...document.querySelectorAll('section.panel, .side-label')]
      .filter(vis)
      .map((e) => ({ name: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '', b: e.getBoundingClientRect() }));
    const n = h.snapshot().linkCounts.length;
    const out = new Set<string>();
    const samples = { A: 0, B: 0 };
    for (let l = 0; l < n; l++)
      for (let k = 0; k < 10; k++) {
        const t = 0.05 + k * 0.1;
        for (const [side, p] of [['A', h.linkScreenPoint(l, t)], ['B', h.linkScreenPointB(l, t)]] as const) {
          if (!p) continue;
          samples[side]++;
          for (const x of boxes) if (p[0] >= x.b.left && p[0] <= x.b.right && p[1] >= x.b.top && p[1] <= x.b.bottom) out.add(`${side} link ${l} under ${x.name}`);
        }
      }
    // both halves were actually sampled
    if (samples.A < n * 5) out.add(`too few A samples: ${samples.A}`);
    if (samples.B < n * 5) out.add(`too few B samples: ${samples.B}`);
    return [...out].slice(0, 12);
  });
}

/** Camera equality with a fresh fit (centre within 1 m, zoom within 0.1 %). */
function sameCamera(got: { cx: number; cy: number; zoom: number }, fresh: { cx: number; cy: number; zoom: number }, label: string) {
  expect(Math.abs(got.cx - fresh.cx), `${label}: cx = fresh fit`).toBeLessThanOrEqual(1);
  expect(Math.abs(got.cy - fresh.cy), `${label}: cy = fresh fit`).toBeLessThanOrEqual(1);
  expect(Math.abs(got.zoom / fresh.zoom - 1), `${label}: zoom = fresh fit`).toBeLessThanOrEqual(1e-3);
}

async function resizeTo(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await sleep(600);
}

// 1
test('panels_never_overlap', async ({ page }) => {
  test.setTimeout(600_000);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await ready(page);
    const at = `${size.width}×${size.height}`;
    const base = ['Simulation controls', 'Replay timeline'];
    const single = [...base, 'Simulation metrics', 'Legend'];
    const check = async (state: string, names: string[]) => {
      await settled(page);
      expect(await layoutProblems(page), `${at} ${state}`).toEqual([]);
      await expectPanels(page, names, `${at} ${state}`);
    };
    await check('single', single);
    // the legend stays reachable (its toggle on screen), collapsed or not
    const legendToggle = page.getByRole('region', { name: 'Legend' }).getByRole('button');
    await expect(legendToggle).toBeVisible();
    await pause(page);
    await selectRoad(page, 'A');
    await check('road selected', [...single, 'Selected road']);
    await page.keyboard.press('Escape');
    await page.keyboard.press('d');
    await check('diagnostics open', [...single, 'Diagnostics']);
    await page.keyboard.press('d');
    await branch(page);
    await selectRoad(page, 'A');
    await check('branch + road selected', [...single, 'Selected road', 'Scenarios']);
    await page.keyboard.press('Escape');
    await enterCompare(page);
    await expect(page.getByRole('region', { name: 'Comparison' })).toBeVisible();
    await check('compare', [...base, 'Scenarios', 'Comparison']);
    await expect(page.locator('.side-label')).toHaveCount(2);
    await selectRoad(page, 'B');
    await check('compare + road selected', [...base, 'Scenarios', 'Comparison', 'Selected road']);
  }
});

// 2
test('compare_panels_cover_no_road', async ({ page }) => {
  test.setTimeout(300_000);
  for (const size of [SIZES[0]!, SIZES[2]!]) {
    await page.setViewportSize(size);
    await ready(page);
    await branch(page);
    await enterCompare(page);
    const at = `${size.width}×${size.height}`;
    expect(await coveredRoads(page), `${at} compare`).toEqual([]);
    await selectRoad(page, 'A');
    expect(await coveredRoads(page), `${at} compare, road selected on A`).toEqual([]);
    await page.keyboard.press('Escape');
    await selectRoad(page, 'B');
    expect(await coveredRoads(page), `${at} compare, road selected on B`).toEqual([]);
  }
});

// 3
test('resize_refits_an_untouched_view', async ({ page }) => {
  test.setTimeout(400_000);
  const steps = [
    { width: 1024, height: 768 },
    { width: 900, height: 700 },
    { width: 1280, height: 800 },
  ];
  // single view: a resized, untouched view equals a fresh load at that size
  const fresh: Record<string, { cx: number; cy: number; zoom: number }> = {};
  for (const s of steps) {
    await page.setViewportSize(s);
    await ready(page);
    fresh[`${s.width}x${s.height}`] = (await snap(page)).camera;
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  await pause(page);
  await selectRoad(page, 'A'); // selecting is not a camera move
  for (const s of steps) {
    await resizeTo(page, s);
    sameCamera((await snap(page)).camera, fresh[`${s.width}x${s.height}`]!, `single ${s.width}×${s.height}`);
  }
  // compare: a resized, untouched compare view equals a fresh compare entry at that size
  await page.keyboard.press('Escape');
  await branch(page);
  await enterCompare(page);
  await selectRoad(page, 'A');
  for (const s of steps) {
    await resizeTo(page, s);
    const got = (await snap(page)).camera;
    // a fresh fit at this size: leave and re-enter compare (entering compare always fits)
    await page.getByRole('button', { name: 'Compare side by side' }).click();
    await expect.poll(async () => (await snap(page)).compare).toBe(false);
    await enterCompare(page);
    sameCamera(got, (await snap(page)).camera, `compare ${s.width}×${s.height}`);
  }
});

// 4
test('resize_keeps_a_user_camera', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  await pause(page);
  const userMove = async () => {
    const box = (await page.locator('canvas.city').first().boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await sleep(300);
    await page.mouse.move(cx - 60, cy - 40);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, { steps: 8 });
    await page.mouse.up();
    await page.mouse.move(2, 2);
    await sleep(300);
  };
  await userMove();
  const before = (await snap(page)).camera;
  await resizeTo(page, { width: 1024, height: 768 });
  const after = (await snap(page)).camera;
  expect(Math.abs(after.cx - before.cx), 'single: cx kept').toBeLessThanOrEqual(1);
  expect(Math.abs(after.cy - before.cy), 'single: cy kept').toBeLessThanOrEqual(1);
  expect(Math.abs(after.zoom - before.zoom), 'single: zoom kept').toBeLessThanOrEqual(1e-6);
  // compare: entering fits; a pan there is a user move, kept across a resize
  await resizeTo(page, { width: 1280, height: 800 });
  await branch(page);
  await enterCompare(page);
  const box = (await page.locator('canvas.city').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(2, 2);
  await sleep(300);
  const b2 = (await snap(page)).camera;
  await resizeTo(page, { width: 1024, height: 768 });
  const a2 = (await snap(page)).camera;
  expect(Math.abs(a2.cx - b2.cx), 'compare: cx kept').toBeLessThanOrEqual(1);
  expect(Math.abs(a2.cy - b2.cy), 'compare: cy kept').toBeLessThanOrEqual(1);
  expect(Math.abs(a2.zoom - b2.zoom), 'compare: zoom kept').toBeLessThanOrEqual(1e-6);
});

// 5
test('labels_never_half_cut', async ({ page }) => {
  test.setTimeout(300_000);
  /** Visible labels lie fully inside their layer; hidden ones (visibility: hidden keeps their box) would have been cut. */
  const check = async (label: string) => {
    await sleep(400);
    const r = await page.evaluate(() => {
      return [...document.querySelectorAll('.labels')].map((layer) => {
        const b = layer.getBoundingClientRect();
        const inside = (z: Element) => {
          const r = z.getBoundingClientRect();
          return r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
        };
        const zones = [...layer.querySelectorAll('.zone')].filter((z) => getComputedStyle(z).display !== 'none' && z.getBoundingClientRect().width > 0);
        const shown = (z: Element) => getComputedStyle(z).visibility !== 'hidden' && Number(getComputedStyle(z).opacity) > 0;
        return {
          layer: layer.className,
          total: zones.length,
          cut: zones.filter((z) => shown(z) && !inside(z)).map((z) => z.textContent?.trim() ?? ''),
          hiddenButFits: zones.filter((z) => !shown(z) && inside(z)).map((z) => z.textContent?.trim() ?? ''),
        };
      });
    });
    expect(r.length, `${label}: label layers`).toBeGreaterThan(0);
    for (const l of r) {
      expect(l.total, `${label}: ${l.layer} has its labels`).toBeGreaterThan(10);
      expect(l.cut, `${label}: ${l.layer} labels cut at the edge`).toEqual([]);
      expect(l.hiddenButFits, `${label}: ${l.layer} labels hidden although they fit`).toEqual([]);
    }
  };
  await page.setViewportSize({ width: 768, height: 800 });
  await ready(page);
  await check('single 768×800');
  await resizeTo(page, { width: 1280, height: 800 });
  await check('single resized to 1280×800');
  await pause(page);
  await branch(page);
  await enterCompare(page);
  await check('compare 1280×800');
  await resizeTo(page, { width: 1024, height: 768 });
  await check('compare resized to 1024×768');
  // after a pan, labels move across the edges: still never cut, never hidden needlessly
  const box = (await page.locator('canvas.city').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 10, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(2, 2);
  await check('compare after a pan');
});

// 6
test('compare_frame_and_supported_widths', async ({ page }) => {
  await ready(page);
  await branch(page);
  const panel = page.getByRole('region', { name: 'Scenarios' });
  const frame = () =>
    panel.locator('.scenario-label').evaluate((el) => {
      const st = getComputedStyle(el);
      return { dashed: st.borderTopStyle === 'dashed', striped: st.backgroundImage !== 'none' };
    });
  // viewing B: B's pattern (dashed and striped), on the heading
  await expect(panel).toHaveClass(/viewing-b/);
  expect(await frame()).toEqual({ dashed: true, striped: true });
  // comparing: neutral
  await enterCompare(page);
  await expect(panel).not.toHaveClass(/viewing-b/);
  expect(await frame()).toEqual({ dashed: false, striped: false });
  // back to viewing B: B's pattern again
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(false);
  await expect(panel).toHaveClass(/viewing-b/);
  expect(await frame()).toEqual({ dashed: true, striped: true });
  // README: the supported window widths
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  expect(readme).toMatch(/\b768\s?px\b/);
  expect(readme).toMatch(/(minimum|at least|narrower)[^\n]*768\s?px|768\s?px[^\n]*(minimum|at least|or wider|narrower)/i);
});
