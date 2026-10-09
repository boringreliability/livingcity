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
  await sleep(200);
  return found!.link;
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
    for (let l = 0; l < n; l++)
      for (let k = 0; k < 10; k++) {
        const t = 0.05 + k * 0.1;
        for (const [side, p] of [['A', h.linkScreenPoint(l, t)], ['B', h.linkScreenPointB(l, t)]] as const) {
          if (!p) continue;
          for (const x of boxes) if (p[0] >= x.b.left && p[0] <= x.b.right && p[1] >= x.b.top && p[1] <= x.b.bottom) out.add(`${side} link ${l} under ${x.name}`);
        }
      }
    return [...out].slice(0, 12);
  });
}

/** Every link midpoint inside its own canvas, and the network's screen box spans ≥ 60 % of the canvas width or height. */
async function fitted(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const h = window.__livingcity!;
    const n = h.snapshot().linkCounts.length;
    const res: { side: string; outside: number; spanW: number; spanH: number }[] = [];
    for (const [side, sel, get] of [
      ['A', 'canvas.city:not(.city-b)', (l: number, t: number) => h.linkScreenPoint(l, t)],
      ['B', 'canvas.city-b', (l: number, t: number) => h.linkScreenPointB(l, t)],
    ] as const) {
      const c = document.querySelector(sel);
      if (!c) continue;
      const b = c.getBoundingClientRect();
      let outside = 0;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let l = 0; l < n; l++) {
        const m = get(l, 0.5);
        if (!m || m[0] < b.left || m[0] > b.right || m[1] < b.top || m[1] > b.bottom) outside++;
        for (const t of [0, 1]) {
          const p = get(l, t);
          if (!p) continue;
          x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
        }
      }
      res.push({ side, outside, spanW: (x1 - x0) / b.width, spanH: (y1 - y0) / b.height });
    }
    return res;
  });
  expect(r.length, `${label}: canvases`).toBeGreaterThan(0);
  for (const s of r) {
    expect(s.outside, `${label}: ${s.side} link midpoints outside the canvas`).toBe(0);
    expect(Math.max(s.spanW, s.spanH), `${label}: ${s.side} network spans ≥ 60 % (refit)`).toBeGreaterThanOrEqual(0.6);
  }
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
    const check = async (state: string) => expect(await layoutProblems(page), `${at} ${state}`).toEqual([]);
    await check('single');
    await pause(page);
    await selectRoad(page, 'A');
    await check('road selected');
    await page.keyboard.press('Escape');
    await page.keyboard.press('d');
    await expect(page.getByRole('region', { name: 'Diagnostics' })).toBeVisible();
    await check('diagnostics open');
    await page.keyboard.press('d');
    await branch(page);
    await selectRoad(page, 'A');
    await check('branch + road selected');
    await page.keyboard.press('Escape');
    await enterCompare(page);
    await check('compare');
    await selectRoad(page, 'B');
    await check('compare + road selected');
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
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  const steps = [
    { width: 1024, height: 768 },
    { width: 900, height: 700 },
    { width: 1280, height: 800 },
  ];
  for (const s of steps) {
    await resizeTo(page, s);
    await fitted(page, `single ${s.width}×${s.height}`);
  }
  await branch(page);
  await enterCompare(page);
  for (const s of steps) {
    await resizeTo(page, s);
    await fitted(page, `compare ${s.width}×${s.height}`);
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
  const cut = async (label: string, minVisiblePerLayer: number) => {
    const r = await page.evaluate(() => {
      const vis = (e: Element) => {
        const st = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0 && r.width > 0 && r.height > 0;
      };
      return [...document.querySelectorAll('.labels')].map((layer) => {
        const b = layer.getBoundingClientRect();
        const shown = [...layer.querySelectorAll('.zone')].filter(vis);
        const cutOff = shown
          .filter((z) => {
            const r = z.getBoundingClientRect();
            return r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5;
          })
          .map((z) => z.textContent?.trim() ?? '');
        return { layer: layer.className, shown: shown.length, cutOff };
      });
    });
    for (const l of r) {
      expect(l.cutOff, `${label}: ${l.layer} labels cut at the edge`).toEqual([]);
      expect(l.shown, `${label}: ${l.layer} visible labels`).toBeGreaterThanOrEqual(minVisiblePerLayer);
    }
  };
  await page.setViewportSize({ width: 768, height: 800 });
  await ready(page);
  await cut('single 768×800', 1);
  for (const [size, min] of [
    [{ width: 1280, height: 800 }, 5],
    [{ width: 1024, height: 768 }, 1],
  ] as const) {
    await page.setViewportSize(size);
    await ready(page);
    await branch(page);
    await enterCompare(page);
    await cut(`compare ${size.width}×${size.height}`, min);
  }
});

// 6
test('compare_frame_and_supported_widths', async ({ page }) => {
  await ready(page);
  await branch(page);
  const panel = page.getByRole('region', { name: 'Scenarios' });
  await expect(panel).toHaveClass(/viewing-b/);
  await enterCompare(page);
  await expect(panel).not.toHaveClass(/viewing-b/);
  expect(await panel.evaluate((el) => getComputedStyle(el).borderTopStyle)).not.toBe('dashed');
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(false);
  await expect(panel).toHaveClass(/viewing-b/);
  // README: the supported window widths
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  expect(readme).toMatch(/\b768\s?px\b/);
  expect(readme).toMatch(/(minimum|at least|narrower)[^\n]*768\s?px|768\s?px[^\n]*(minimum|at least|or wider|narrower)/i);
});
