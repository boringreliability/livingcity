// Ward timeline-005, test 7: timeline costs measured in the browser (tagged @perf; `pnpm -C web e2e:perf`).
// Writes web/perf-results/timeline.json, which docs/performance.md § Timeline cites.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { percentile } from '../src/sim/perf';
import type { LivingCitySnapshot } from '../src/ui/testHook';

const OUT = new URL('../perf-results/', import.meta.url);
const MIB = 1024 * 1024;
const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}

/** In-page: press ← on the slider and time until a frame shows the new position (ms). */
async function timedStepBack(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const h = window.__livingcity!;
        const el = document.querySelector<HTMLElement>('[role="slider"][aria-label="Timeline"]')!;
        const from = h.snapshot().timeline.positionTick;
        el.focus();
        const t0 = performance.now();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        const poll = () => {
          if (h.snapshot().timeline.positionTick === from - 120) resolve(performance.now() - t0);
          else requestAnimationFrame(poll);
        };
        poll();
      }),
  );
}

/** Mean ms per tick and render interval over a recording of `seconds` (running). */
async function record(page: Page, seconds: number) {
  await page.evaluate(() => window.__livingcity!.startPerfRecording());
  await sleep(seconds * 1000);
  const r = await page.evaluate(() => window.__livingcity!.stopPerfRecording());
  const ticks = r.ticks.reduce((a, [, n]) => a + n, 0);
  const ms = r.ticks.reduce((a, [m]) => a + m, 0);
  return {
    ticksRecorded: ticks,
    tickMsMean: ticks ? ms / ticks : 0,
    renderIntervalMedianMs: percentile(r.renderIntervals, 0.5),
    renderIntervalP95Ms: percentile(r.renderIntervals, 0.95),
    timerResolutionMs: r.timerResolutionMs,
  };
}

test.describe('@perf', () => {
  test.describe.configure({ timeout: 900_000 });

  // 7
  test('perf_timeline_recorded @perf', async ({ browser, page }) => {
    await page.goto('/');
    await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
    await page.getByRole('combobox', { name: 'Speed' }).selectOption('60');
    await blur(page);
    // fill the replay window (48 MiB ≈ 2.3 sim h at 60× ≈ 2.5 min wall)
    await expect.poll(async () => (await snap(page)).timeline.snapshotBytes, { timeout: 400_000, intervals: [2000] }).toBeGreaterThan(44 * MIB);
    // single view, same sim range as the lockstep recording below
    const single = await record(page, 20);
    await pause(page);
    const head = (await snap(page)).timeline.headTick;
    // seeks: ← from the head, 24 times (spread over the last ~24 sim min of the full window)
    const seekMs: number[] = [];
    for (let i = 0; i < 24; i++) seekMs.push(await timedStepBack(page));
    const win = (await snap(page)).timeline;
    // branch: an intervention in A's past → B's first frame
    await blur(page);
    const t0 = Date.now();
    await page.keyboard.press('b');
    await expect.poll(async () => (await snap(page)).scenario, { intervals: [5] }).toBe('B');
    const branchMs = Date.now() - t0;
    // memory: A (now behind its head) and B (just branched)
    const memB = (await snap(page)).timeline.snapshotBytes;
    await page.getByRole('button', { name: 'A: original' }).click();
    await expect.poll(async () => (await snap(page)).scenario).toBe('A');
    const memA = (await snap(page)).timeline.snapshotBytes;
    // lockstep over a comparable range: compare from A's position, run 20 s at 60×
    await page.getByRole('button', { name: 'Compare side by side' }).click();
    await expect.poll(async () => (await snap(page)).compare).toBe(true);
    await blur(page);
    await page.keyboard.press('Space');
    const lockstep = await record(page, 20);
    await pause(page);
    const browserVersion = `${browser.browserType().name()} ${browser.version()}`;
    const hardware = (() => {
      try {
        return execFileSync('sysctl', ['-n', 'hw.model', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim().replace(/\n/g, ' · ');
      } catch {
        return 'unknown';
      }
    })();
    const out = {
      scenario: 'timeline: seek, branch, snapshot memory, lockstep compare (River City, 60×)',
      timestamp: new Date().toISOString(),
      browser: browserVersion,
      hardware,
      renderer: (await page.evaluate(() => window.__livingcity!.diagnostics())).renderer,
      conditions: { viewport: page.viewportSize(), devicePixelRatio: await page.evaluate(() => window.devicePixelRatio) },
      window: { startTick: win.windowStartTick, headTick: head, retainedSimH: (head - win.windowStartTick) / 7200 },
      seek: { n: seekMs.length, medianMs: percentile(seekMs, 0.5), p95Ms: percentile(seekMs, 0.95), maxMs: Math.max(...seekMs) },
      branch: { ms: branchMs },
      memory: {
        budgetMiB: win.budgetBytes / MIB,
        aMiB: memA / MIB,
        bMiB: memB / MIB,
        totalMiB: (memA + memB) / MIB,
      },
      single,
      lockstep,
      lockstepTickCostRatio: single.tickMsMean > 0 ? lockstep.tickMsMean / single.tickMsMean : 0,
    };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL('timeline.json', OUT), `${JSON.stringify(out, null, 2)}\n`);
    // the file is complete and consistent
    const j = JSON.parse(readFileSync(new URL('timeline.json', OUT), 'utf8')) as typeof out;
    expect(j.seek.n).toBeGreaterThanOrEqual(20);
    expect(j.seek.medianMs).toBeGreaterThan(0);
    expect(j.seek.p95Ms).toBeGreaterThanOrEqual(j.seek.medianMs);
    expect(j.branch.ms).toBeGreaterThan(0);
    expect(j.memory.aMiB).toBeGreaterThan(40);
    expect(j.memory.totalMiB).toBeLessThanOrEqual(2 * j.memory.budgetMiB + 0.01);
    for (const r of [j.single, j.lockstep]) {
      expect(r.ticksRecorded).toBeGreaterThan(0);
      expect(r.tickMsMean).toBeGreaterThan(0);
      expect(r.renderIntervalMedianMs).toBeGreaterThan(0);
    }
    expect(j.lockstepTickCostRatio).toBeGreaterThan(1);
  });
});
