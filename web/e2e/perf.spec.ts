// Ward city-005, tests 12–14: the measurement harness (tagged @perf; run with `pnpm -C web e2e:perf`).
// Every number in docs/performance.md comes from the JSON files written here. All statistics are
// computed from one recording that spans the whole measurement (not from the sliding windows).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { percentile, weightedPercentile } from '../src/sim/perf';
import type { LivingCitySnapshot } from '../src/ui/testHook';
import config from '../playwright.config';

const OUT = new URL('../perf-results/', import.meta.url);
const DT = 0.5;
/** The brief's targets (livingcity.md § Performance). */
// "10,000 active vehicles" is scored on vehicles on the network: the sim's `active` also counts trips still
// waiting at their origin (Red r2 A1), which are not vehicles the engine moves or the renderer draws.
const TARGET = { onNetworkVehicles: 10_000, renderIntervalMedianMs: 17.5, stressOnNetwork: 5_000 };
const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hardware(): string {
  try {
    return execFileSync('sysctl', ['-n', 'hw.model', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim().replace(/\n/g, ' · ');
  } catch {
    return 'unknown (sysctl unavailable)';
  }
}

async function open(page: Page, url: string, speedLabel: string) {
  await page.goto(url);
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(10);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption({ label: speedLabel });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Records for `seconds` of wall time (running `during` right after the start) and reduces the whole recording. */
async function measure(page: Page, seconds: number, during?: () => Promise<void>) {
  await page.evaluate(() => window.__livingcity!.startPerfRecording());
  const t0 = Date.now();
  if (during) await during();
  await sleep(Math.max(0, seconds * 1000 - (Date.now() - t0)));
  const r = await page.evaluate(() => window.__livingcity!.stopPerfRecording());
  const d = await page.evaluate(() => window.__livingcity!.diagnostics());
  const ticks = r.ticks.reduce((a, [, n]) => a + n, 0);
  const ms = r.ticks.reduce((a, [m]) => a + m, 0);
  const tickMsMedian = weightedPercentile(r.ticks.map(([m, n]) => [m / n, n] as [number, number]), 0.5);
  const perFrame = r.ticks.filter(([, n]) => n > 0).map(([m, n]) => m / n);
  return {
    wallMs: r.wallMs,
    framesRecorded: r.frames,
    ticksRecorded: ticks,
    renderSamples: r.renderIntervals.length,
    onNetworkMedian: percentile(r.onNetwork, 0.5),
    onNetworkMax: Math.max(0, ...r.onNetwork),
    activeMedian: percentile(r.active, 0.5),
    activeMax: Math.max(0, ...r.active),
    waitingAtOriginMax: Math.max(0, ...r.waitingAtOrigin),
    tickMsMean: ticks > 0 ? ms / ticks : 0,
    tickMsMedian,
    tickMsP95: weightedPercentile(r.ticks.map(([m, n]) => [m / n, n] as [number, number]), 0.95),
    tickMsMaxFrame: Math.max(0, ...perFrame),
    timerResolutionMs: r.timerResolutionMs,
    // coarse clocks (Chrome workers: ~0.1 ms) make per-tick percentiles meaningless below ~10 steps; cite the mean then
    // an unknown resolution (≤ 0) counts as "below" too: never present unflagged sub-resolution percentiles
    tickBelowTimerResolution:
      r.timerResolutionMs <= 0 || weightedPercentile(r.ticks.map(([m, n]) => [m / n, n] as [number, number]), 0.95) < 10 * r.timerResolutionMs,
    renderIntervalMedianMs: percentile(r.renderIntervals, 0.5),
    renderIntervalP95Ms: percentile(r.renderIntervals, 0.95),
    drawMedianMs: percentile(r.drawMs, 0.5),
    drawP95Ms: percentile(r.drawMs, 0.95),
    achievedTicksPerS: ticks / (r.wallMs / 1000),
    achievedSpeed: (ticks / (r.wallMs / 1000)) * DT,
    targetTicksPerS: d.targetTicksPerS,
    frameBytes: d.frameBytes,
    renderer: d.renderer,
  };
}

async function record(browser: Browser, page: Page, name: string, meta: Record<string, unknown>, m: Awaited<ReturnType<typeof measure>>) {
  const use = config.use ?? {};
  const out = {
    ...meta,
    timestamp: new Date().toISOString(),
    browser: `${browser.browserType().name()} ${browser.version()}`,
    hardware: hardware(),
    conditions: {
      viewport: page.viewportSize(),
      devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
      // the real browser user agent (devices[...] overrides the page's), via CDP
      headless: await (async () => {
        const cdp = await page.context().newCDPSession(page);
        const { userAgent } = (await cdp.send('Browser.getVersion')) as { userAgent: string };
        await cdp.detach();
        return /Headless/.test(userAgent);
      })(),
      launchArgs: use.launchOptions?.args ?? [],
    },
    city: (await snap(page)).city,
    ...m,
    targets: {
      onNetworkVehicles: {
        target: TARGET.onNetworkVehicles,
        measuredMax: m.onNetworkMax,
        met: m.onNetworkMax >= TARGET.onNetworkVehicles,
        note: 'active also counts trips waiting at their origin; see activeMax / waitingAtOriginMax',
      },
      smoothRendering: { targetIntervalMedianMs: TARGET.renderIntervalMedianMs, measured: m.renderIntervalMedianMs, met: m.renderIntervalMedianMs <= TARGET.renderIntervalMedianMs },
      ...(meta['scenario'] === 'stress'
        ? { stressOnNetwork: { target: TARGET.stressOnNetwork, measuredMax: m.onNetworkMax, met: m.onNetworkMax >= TARGET.stressOnNetwork } }
        : {}),
    },
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL(`${name}.json`, OUT), `${JSON.stringify(out, null, 2)}\n`);
}

const NUMBERS = [
  'wallMs', 'framesRecorded', 'ticksRecorded', 'renderSamples', 'onNetworkMedian', 'onNetworkMax', 'activeMedian', 'activeMax', 'waitingAtOriginMax',
  'tickMsMean', 'tickMsMedian', 'tickMsP95', 'tickMsMaxFrame', 'timerResolutionMs', 'renderIntervalMedianMs', 'renderIntervalP95Ms',
  'drawMedianMs', 'drawP95Ms', 'achievedTicksPerS', 'achievedSpeed', 'targetTicksPerS', 'frameBytes', 'multiplier', 'durationS',
] as const;

/** Reads a written file back and checks it is complete and self-consistent. */
function check(file: string, durationS: number) {
  const j = JSON.parse(readFileSync(new URL(file, OUT), 'utf8')) as Record<string, unknown>;
  for (const k of NUMBERS) {
    expect(typeof j[k], k).toBe('number');
    expect(Number.isFinite(j[k] as number), k).toBe(true);
  }
  for (const k of ['scenario', 'url', 'timestamp', 'browser', 'hardware', 'renderer', 'city']) expect(typeof j[k], k).toBe('string');
  expect(typeof j['tickBelowTimerResolution']).toBe('boolean');
  const n = (k: string) => j[k] as number;
  // the recording spans the whole measurement (sanity floors only: a slow result is reported, not failed)
  expect(n('wallMs')).toBeGreaterThanOrEqual(durationS * 1000);
  expect(n('renderSamples')).toBeGreaterThanOrEqual(durationS);
  expect(n('framesRecorded')).toBeGreaterThan(0);
  expect(n('ticksRecorded')).toBeGreaterThan(0);
  expect(n('onNetworkMedian')).toBeGreaterThan(0);
  expect(n('renderIntervalMedianMs')).toBeGreaterThan(0);
  expect(n('renderIntervalP95Ms')).toBeGreaterThanOrEqual(n('renderIntervalMedianMs'));
  expect(n('tickMsP95')).toBeGreaterThanOrEqual(n('tickMsMedian'));
  expect(n('timerResolutionMs')).toBeGreaterThanOrEqual(0);
  expect(j['tickBelowTimerResolution']).toBe(n('timerResolutionMs') <= 0 || n('tickMsP95') < 10 * n('timerResolutionMs'));
  expect(typeof (j['conditions'] as Record<string, unknown>)['headless']).toBe('boolean');
  expect(n('activeMax')).toBeGreaterThanOrEqual(n('onNetworkMax'));
  const t = j['targets'] as Record<string, { met: boolean }>;
  expect(t['activeVehicles']).toBeUndefined();
  expect(t['onNetworkVehicles']!.met).toBe(n('onNetworkMax') >= TARGET.onNetworkVehicles);
  expect(t['smoothRendering']!.met).toBe(n('renderIntervalMedianMs') <= TARGET.renderIntervalMedianMs);
  return j;
}

test.describe('@perf', () => {
  test.describe.configure({ timeout: 600_000 });

  // 12
  test('perf_baseline_recorded @perf', async ({ browser, page }) => {
    for (const [label, mult] of [['1×', 1], ['20×', 20]] as const) {
      await open(page, '/', label);
      await sleep(5_000);
      const m = await measure(page, 60);
      await record(browser, page, `baseline-${mult}x`, { scenario: `baseline ${label}`, url: '/', multiplier: mult, durationS: 60 }, m);
      check(`baseline-${mult}x.json`, 60);
    }
  });

  // 13
  test('perf_closure_burst_recorded @perf', async ({ browser, page }) => {
    await open(page, '/', '20×');
    await sleep(5_000);
    const lm = (await snap(page)).landmarks!;
    // one recording from the click: the first 60 wall seconds after closing (≈ 20 sim minutes at 20×)
    const m = await measure(page, 60, async () => {
      await page.getByRole('button', { name: /close the main bridge/i }).click();
      await expect.poll(async () => (await snap(page)).closed, { timeout: 10_000 }).toEqual(expect.arrayContaining(lm.central_bridge));
    });
    await record(browser, page, 'closure-burst', { scenario: 'closure burst: first 60 s after closing the Main Bridge at 20×', url: '/', multiplier: 20, durationS: 60 }, m);
    check('closure-burst.json', 60);
  });

  // 14
  test('perf_stress_recorded @perf', async ({ browser, page }) => {
    await open(page, '/?demand=5', '5×');
    await sleep(20_000); // let the stressed city fill up
    const m = await measure(page, 60);
    await record(browser, page, 'stress-5x', { scenario: 'stress', url: '/?demand=5', multiplier: 5, durationS: 60 }, m);
    const j = check('stress-5x.json', 60);
    // ≥ 5,000 on the network is the brief's ask; if missed, the JSON states the measured maximum and met = false
    const t = (j['targets'] as Record<string, { met: boolean; measuredMax: number }>)['stressOnNetwork']!;
    expect(t.measuredMax).toBe(j['onNetworkMax']);
    expect(t.met).toBe((j['onNetworkMax'] as number) >= TARGET.stressOnNetwork);
  });
});
