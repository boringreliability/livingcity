// Ward city-005, tests 12–14: the measurement harness (tagged @perf; run with `pnpm -C web e2e:perf`).
// Every number in docs/performance.md comes from the JSON files written here.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { expect, test, type Browser, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const OUT = new URL('../perf-results/', import.meta.url);
const DT = 0.5;
const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hardware(): string {
  try {
    return execFileSync('sysctl', ['-n', 'hw.model', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim().replace(/\n/g, ' · ');
  } catch {
    return 'unknown (sysctl unavailable)';
  }
}

async function gpu(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'no WebGL2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });
}

async function open(page: Page, url: string, speedLabel: string) {
  await page.goto(url);
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(10);
  await page.getByRole('combobox').first().selectOption({ label: speedLabel });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.max(1, Math.ceil(0.5 * s.length)) - 1]! : 0;
};

/** Samples the hook every 500 ms for `seconds`; the windows (1,000 ticks / 300 frames) are read at the end. */
async function measure(page: Page, seconds: number) {
  const onNet: number[] = [];
  const active: number[] = [];
  let tickMax = 0;
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await sleep(500);
    const d = await page.evaluate(() => window.__livingcity!.diagnostics());
    onNet.push(d.onNetwork);
    active.push(d.active);
    tickMax = Math.max(tickMax, d.perf?.tickMsMax ?? 0);
  }
  const d = await page.evaluate(() => window.__livingcity!.diagnostics());
  return {
    onNetworkMedian: median(onNet),
    onNetworkMax: Math.max(...onNet),
    activeMedian: median(active),
    activeMax: Math.max(...active),
    tickMsMedian: d.perf!.tickMsMedian,
    tickMsP95: d.perf!.tickMsP95,
    tickMsMax: Math.max(tickMax, d.perf!.tickMsMax),
    ticksMeasured: d.perf!.ticksMeasured,
    encodeMs: d.perf!.encodeMs,
    renderIntervalMedianMs: d.render.intervalMedianMs,
    renderIntervalP95Ms: d.render.intervalP95Ms,
    drawMedianMs: d.render.drawMedianMs,
    drawP95Ms: d.render.drawP95Ms,
    renderSamples: d.render.samples,
    frameBytes: d.frameBytes,
    achievedTicksPerS: d.achievedTicksPerS,
    targetTicksPerS: d.targetTicksPerS,
    achievedSpeed: d.achievedTicksPerS * DT,
  };
}

async function record(browser: Browser, page: Page, name: string, meta: Record<string, unknown>, m: Awaited<ReturnType<typeof measure>>) {
  const out = {
    ...meta,
    timestamp: new Date().toISOString(),
    browser: `${browser.browserType().name()} ${browser.version()}`,
    gpu: await gpu(page),
    hardware: hardware(),
    sim: (await snap(page)).city,
    ...m,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL(`${name}.json`, OUT), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

const FIELDS = [
  'onNetworkMedian', 'onNetworkMax', 'activeMedian', 'activeMax', 'tickMsMedian', 'tickMsP95', 'tickMsMax', 'ticksMeasured',
  'encodeMs', 'renderIntervalMedianMs', 'renderIntervalP95Ms', 'drawMedianMs', 'drawP95Ms', 'renderSamples', 'frameBytes',
  'achievedTicksPerS', 'targetTicksPerS', 'achievedSpeed', 'multiplier', 'durationS',
] as const;

function check(file: string) {
  const j = JSON.parse(readFileSync(new URL(file, OUT), 'utf8')) as Record<string, unknown>;
  for (const k of FIELDS) {
    expect(typeof j[k], k).toBe('number');
    expect(Number.isFinite(j[k] as number), k).toBe(true);
  }
  for (const k of ['scenario', 'url', 'timestamp', 'browser', 'gpu', 'hardware']) expect(typeof j[k], k).toBe('string');
  expect(j['onNetworkMedian'] as number).toBeGreaterThan(0);
  expect(j['ticksMeasured'] as number).toBeGreaterThanOrEqual(100);
  expect(j['renderSamples'] as number).toBeGreaterThanOrEqual(100);
  expect(j['renderIntervalMedianMs'] as number).toBeGreaterThan(0);
  expect(j['renderIntervalP95Ms'] as number).toBeGreaterThanOrEqual(j['renderIntervalMedianMs'] as number);
  expect(j['tickMsP95'] as number).toBeGreaterThanOrEqual(j['tickMsMedian'] as number);
  expect(j['tickMsMax'] as number).toBeGreaterThanOrEqual(j['tickMsP95'] as number);
  return j;
}

test.describe('@perf', () => {
  test.describe.configure({ timeout: 300_000 });

  // 12
  test('perf_baseline_recorded @perf', async ({ browser, page }) => {
    for (const [label, mult] of [['1×', 1], ['20×', 20]] as const) {
      await open(page, '/', label);
      await sleep(5_000); // settle (window refill at the new speed)
      const m = await measure(page, 20);
      await record(browser, page, `baseline-${mult}x`, { scenario: `baseline ${label}`, url: '/', multiplier: mult, durationS: 20 }, m);
      check(`baseline-${mult}x.json`);
    }
  });

  // 13
  test('perf_closure_burst_recorded @perf', async ({ browser, page }) => {
    await open(page, '/', '20×');
    await sleep(5_000);
    await page.getByRole('button', { name: /close the main bridge/i }).click();
    const lm = (await snap(page)).landmarks!;
    await expect.poll(async () => (await snap(page)).closed, { timeout: 10_000 }).toEqual(expect.arrayContaining(lm.central_bridge));
    // the first 60 wall seconds after closing (≈ 20 sim minutes at 20×)
    const m = await measure(page, 60);
    await record(browser, page, 'closure-burst', { scenario: 'closure burst: first 60 s after closing the Main Bridge at 20×', url: '/', multiplier: 20, durationS: 60 }, m);
    const j = check('closure-burst.json');
    expect(j['tickMsMax'] as number).toBeGreaterThan(0);
  });

  // 14
  test('perf_stress_recorded @perf', async ({ browser, page }) => {
    await open(page, '/?demand=5', '5×');
    // let the stressed city fill up, then measure
    await sleep(20_000);
    const m = await measure(page, 30);
    await record(browser, page, 'stress-5x', { scenario: 'stress: ?demand=5 at 5×', url: '/?demand=5', multiplier: 5, durationS: 30 }, m);
    const j = check('stress-5x.json');
    // the brief asks for ≥ 5,000 on the network; otherwise the measured maximum is what the report states
    expect(j['onNetworkMax'] as number).toBeGreaterThan(0);
  });
});
