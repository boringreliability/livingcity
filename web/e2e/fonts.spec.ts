// Ward fonts-001, tests 2–5: the bundled fonts load in the browser, and the legend sits beside the
// metrics only when they fit (measured), for any font.
import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page, url = '/') {
  await page.goto(url);
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Pairwise overlaps among visible panels and side labels, panels outside the viewport, horizontal scroll. */
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
    for (const x of items) {
      const b = x.b;
      if (b.left < -0.5 || b.top < -0.5 || b.right > window.innerWidth + 0.5 || b.bottom > window.innerHeight + 0.5) out.push(`${x.name} outside the viewport`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth) out.push(`horizontal scroll: ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    return out;
  });
}

type Box = { top: number; bottom: number; left: number; right: number };
const boxes = (page: Page) =>
  page.evaluate(() => {
    const r = (sel: string) => {
      const b = document.querySelector(sel)!.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    };
    return { legend: r('section.panel.legend'), metrics: r('section.panel.metrics') };
  });
const beside = (l: Box, m: Box) => Math.abs(l.bottom - m.bottom) <= 2;
const stacked = (l: Box, m: Box) => l.bottom <= m.top + 1;

/** Let a resize or a style change settle (the placement is measured, then applied). */
const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));

// 2
test('fonts_load_in_the_browser', async ({ page }) => {
  const foreign: string[] = [];
  const origin = new URL(test.info().project.use.baseURL!).host;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.host !== origin) foreign.push(r.url());
  });
  await ready(page);
  const r = await page.evaluate(() => {
    const faces = [...document.fonts].map((f) => ({ family: f.family.replace(/["']/g, ''), status: f.status }));
    const sample = 'Mean trip 12:34 Hillside Gardens 00:16:37';
    const width = (parent: Element, font?: string) => {
      const s = document.createElement('span');
      s.textContent = sample;
      Object.assign(s.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', letterSpacing: 'normal' });
      if (font) s.style.font = font;
      parent.append(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    const metrics = document.querySelector('section.panel.metrics')!;
    const mono = document.querySelector('section.panel.metrics .mono')!;
    const cs = getComputedStyle(metrics);
    const ms = getComputedStyle(mono);
    const size = (c: CSSStyleDeclaration) => `${c.fontStyle} ${c.fontWeight} ${c.fontSize}`;
    return {
      faces,
      ui: { inherited: width(metrics), bundled: width(document.body, `${size(cs)} "Inter Variable"`), monospace: width(document.body, `${size(cs)} monospace`) },
      mono: { inherited: width(mono), bundled: width(document.body, `${size(ms)} "JetBrains Mono"`), monospace: width(document.body, `${size(ms)} monospace`) },
    };
  });
  for (const fam of ['Inter Variable', 'JetBrains Mono'])
    expect(r.faces.some((f) => f.family === fam && f.status === 'loaded'), `a loaded FontFace for ${fam}`).toBe(true);
  // the metrics' text is drawn in the bundled UI font, and the sim time in the bundled monospace font
  expect(Math.abs(r.ui.inherited - r.ui.bundled), 'UI text width = "Inter Variable"').toBeLessThanOrEqual(0.5);
  expect(Math.abs(r.ui.inherited - r.ui.monospace), 'and not a monospace fallback').toBeGreaterThan(5);
  expect(Math.abs(r.mono.inherited - r.mono.bundled), 'sim time width = "JetBrains Mono"').toBeLessThanOrEqual(0.5);
  expect(foreign, 'no request leaves the origin').toEqual([]);
});

// 3
test('legend_stacks_when_it_does_not_fit', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await ready(page);
  // a wide font, simulated: every panel's text spaced out
  await page.addStyleTag({ content: 'section.panel, section.panel * { letter-spacing: 0.12em !important; }' });
  for (const size of [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await settle(page);
    expect(await layoutProblems(page), `${size.width}×${size.height} with wide text`).toEqual([]);
    const { legend, metrics } = await boxes(page);
    expect(beside(legend, metrics) || stacked(legend, metrics), `${size.width}: beside or just above, nothing in between`).toBe(true);
  }
  // at 1280 the spaced-out panels cannot share the band: the legend is above the metrics
  await page.setViewportSize({ width: 1600, height: 900 });
  await settle(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await settle(page);
  const { legend, metrics } = await boxes(page);
  expect(stacked(legend, metrics), '1280 with wide text: stacked').toBe(true);
  expect(await layoutProblems(page)).toEqual([]);
});

// 3b (Red r1 M1): at one fixed window size the placement follows the panels' own widths, so no
// fixed breakpoint can pass: beside → (wider text, no resize) stacked → (collapse + expand) stacked → beside
test('placement_follows_the_panels_not_the_window', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await ready(page);
  await settle(page);
  let b = await boxes(page);
  expect(beside(b.legend, b.metrics), '1600, normal text: beside').toBe(true);
  const wide = await page.addStyleTag({ content: 'section.panel, section.panel * { letter-spacing: 0.35em !important; }' });
  await settle(page);
  b = await boxes(page);
  expect(stacked(b.legend, b.metrics), '1600, wider text, same window: stacked').toBe(true);
  expect(await layoutProblems(page), '1600 with wide text').toEqual([]);
  const toggle = page.getByRole('region', { name: 'Legend' }).getByRole('button').first();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await settle(page);
  expect(await layoutProblems(page), 'collapsed').toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await settle(page);
  b = await boxes(page);
  expect(stacked(b.legend, b.metrics), 'expanded again with wide text: stacked').toBe(true);
  expect(await layoutProblems(page)).toEqual([]);
  await wide.evaluate((el) => (el as Element).remove());
  await settle(page);
  b = await boxes(page);
  expect(beside(b.legend, b.metrics), 'normal text again: beside').toBe(true);
  expect(await layoutProblems(page)).toEqual([]);
});

// 4
test('legend_beside_when_it_fits', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await ready(page);
  await settle(page);
  let b = await boxes(page);
  expect(beside(b.legend, b.metrics), '1600: beside the metrics').toBe(true);
  expect(await layoutProblems(page)).toEqual([]);
  await page.setViewportSize({ width: 1024, height: 768 });
  await settle(page);
  b = await boxes(page);
  expect(stacked(b.legend, b.metrics), '1024: above the metrics').toBe(true);
  expect(await layoutProblems(page)).toEqual([]);
  // collapse and expand: the same placement, no overlap
  const toggle = page.getByRole('region', { name: 'Legend' }).getByRole('button').first();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await settle(page);
  expect(await layoutProblems(page)).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await settle(page);
  b = await boxes(page);
  expect(stacked(b.legend, b.metrics), '1024 after collapse + expand: above the metrics').toBe(true);
  expect(await layoutProblems(page)).toEqual([]);
});

// 5
test('fonts_blocked_still_lays_out', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let blocked = 0;
  await page.route('**/*.woff2', (route) => {
    blocked++;
    return route.abort();
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  await settle(page);
  expect(await layoutProblems(page), '1280×800, system fonts').toEqual([]);
  await page.setViewportSize({ width: 1024, height: 768 });
  await settle(page);
  expect(await layoutProblems(page), '1024×768, system fonts').toEqual([]);
  // the simulation runs on
  const t0 = await page.evaluate(() => window.__livingcity!.snapshot().tick);
  await expect.poll(async () => page.evaluate(() => window.__livingcity!.snapshot().tick)).toBeGreaterThan(t0);
  expect(errors).toEqual([]);
  // with the fonts bundled, the app asks for them (and gets none)
  expect(blocked, 'woff2 requests were made and blocked').toBeGreaterThan(0);
});
