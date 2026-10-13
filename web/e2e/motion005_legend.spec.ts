// motion-005 Gold r2 MAJOR 1 (regression): the legend's placement is a function of the current fit only.
// On GitHub's Linux runners the gap between the metrics and the legend is ~19 px at 1280×800; once the
// legend had stacked (any transient: a wider fallback font, a wider metric value), it stayed stacked
// over the city, because it unstacked only from a 24 px gap. Whenever the two panels fit side by side
// (gap ≥ 12 px, `ui/bottomBand.ts`), the legend must be beside the metrics, whatever came before.
import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));

const band = (page: Page) =>
  page.evaluate(() => {
    const l = document.querySelector('section.panel.legend')!.getBoundingClientRect();
    const m = document.querySelector('section.panel.metrics')!.getBoundingClientRect();
    return { gap: l.left - m.right, legendBottom: l.bottom, legendTop: l.top, metricsTop: m.top, metricsBottom: m.bottom };
  });

/** Widen the metrics panel by `px` (its content, not the window): a stand-in for wider glyphs or values. */
async function widenMetrics(page: Page, px: number) {
  await page.evaluate((px) => {
    const m = document.querySelector<HTMLElement>('section.panel.metrics')!;
    let s = document.getElementById('m5-widen') as HTMLStyleElement | null;
    if (!s) {
      s = document.createElement('style');
      s.id = 'm5-widen';
      s.dataset.w = String(m.getBoundingClientRect().width); // the panel's own width, read before any override
      document.head.append(s);
    }
    s.textContent = px > 0 ? `section.panel.metrics { min-width: ${Number(s.dataset.w) + px}px; box-sizing: border-box; }` : '';
  }, px);
  await settle(page);
}

test('legend_unstacks_whenever_it_fits', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  // paused: the metric values (and with them the panel's width) hold still while the gap is set
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect.poll(async () => page.evaluate(() => window.__livingcity!.snapshot().running)).toBe(false);
  await settle(page);
  const base = await band(page);
  // the starting point on this machine: beside, with some room
  expect(Math.abs(base.legendBottom - base.metricsBottom), 'beside at the start').toBeLessThanOrEqual(2);
  expect(base.gap, 'the panels fit at 1280×800 here').toBeGreaterThanOrEqual(14);
  // gaps a machine with other font metrics may have; each one reached from a stacked legend
  for (const target of [12.5, 15, 19, 23]) {
    if (target > base.gap) continue;
    await widenMetrics(page, Math.ceil(base.gap) + 20); // no room: the legend stacks
    const s = await band(page);
    expect(s.legendBottom, `stacked above the metrics before trying gap ${target}`).toBeLessThanOrEqual(s.metricsTop + 1);
    await widenMetrics(page, base.gap - target); // room again, gap ≈ target
    const b = await band(page);
    expect(b.gap, `gap set to ~${target} px`).toBeGreaterThanOrEqual(12);
    expect(Math.abs(b.legendBottom - b.metricsBottom), `gap ${b.gap.toFixed(1)} px: the legend is beside the metrics again`).toBeLessThanOrEqual(2);
  }
  // and with no room it still stacks (the placement is not simply pinned beside)
  await widenMetrics(page, base.gap - 8);
  const n = await band(page);
  expect(n.gap).toBeLessThan(12);
  expect(n.legendBottom, 'gap below 12 px: stacked').toBeLessThanOrEqual(n.metricsTop + 1);
  await widenMetrics(page, 0);
  const back = await band(page);
  expect(Math.abs(back.legendBottom - back.metricsBottom), 'restored: beside').toBeLessThanOrEqual(2);
});
