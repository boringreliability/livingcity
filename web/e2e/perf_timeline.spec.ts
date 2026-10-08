// Ward timeline-005, test 7: timeline costs measured in the browser (tagged @perf; `pnpm -C web e2e:perf`).
// Writes web/perf-results/timeline.json, which docs/performance.md § Timeline cites.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { percentile, weightedPercentile } from '../src/sim/perf';
import type { LivingCitySnapshot, PerfRecording } from '../src/ui/testHook';
import config from '../playwright.config';

const OUT = new URL('../perf-results/', import.meta.url);
const MIB = 1024 * 1024;
const DT = 0.5;
const SNAPSHOT_EVERY = 120; // ticks (sim-core Timeline)
const SEEKS = 24;
const RANGE_TICKS = 2400; // 20 sim min: the single-view and the lockstep recordings cover the same A ticks
const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}

/**
 * One seek by a click on the timeline track at `frac`: ms from the pointerdown to the first animation frame
 * that shows the requested position (so the value includes up to one render interval).
 */
async function timedSeek(page: Page, frac: number): Promise<{ ms: number; from: number; to: number }> {
  const box = (await page.getByRole('slider', { name: 'Timeline' }).boundingBox())!;
  const from = (await snap(page)).timeline.positionTick;
  await page.evaluate(() => {
    const w = window as unknown as { __seekT0: number };
    w.__seekT0 = -1;
    window.addEventListener('pointerdown', () => (w.__seekT0 = performance.now()), { capture: true, once: true });
  });
  await page.mouse.click(box.x + frac * box.width, box.y + box.height / 2);
  return page.evaluate(
    ({ from }) =>
      new Promise<{ ms: number; from: number; to: number }>((resolve, reject) => {
        const h = window.__livingcity!;
        const w = window as unknown as { __seekT0: number };
        const el = document.querySelector<HTMLElement>('[role="slider"][aria-label="Timeline"]')!;
        const to = Number(el.getAttribute('aria-valuenow'));
        const give = performance.now() + 10_000;
        const poll = () => {
          const pos = h.snapshot().timeline.positionTick;
          if (w.__seekT0 >= 0 && pos === to) resolve({ ms: performance.now() - w.__seekT0, from, to });
          else if (performance.now() > give) reject(new Error(`seek to ${to} not shown within 10 s (at ${pos})`));
          else requestAnimationFrame(poll);
        };
        poll();
      }),
    { from },
  );
}

/** Runs from the current position; records exactly the frames from the first at tick ≥ start to the first at ≥ end. */
async function recordRange(page: Page, start: number, end: number) {
  await blur(page);
  await page.keyboard.press('Space');
  const r = await page.evaluate(
    ({ start, end }) =>
      new Promise<{ rec: PerfRecording; first: number; last: number }>((resolve, reject) => {
        const h = window.__livingcity!;
        let first = -1;
        const give = performance.now() + 300_000;
        const poll = () => {
          const t = h.snapshot().tick;
          if (first < 0 && t >= start) {
            h.startPerfRecording();
            first = t;
          }
          if (first >= 0 && t >= end) resolve({ rec: h.stopPerfRecording(), first, last: t });
          else if (performance.now() > give) reject(new Error(`range ${start}…${end} not reached (at ${t})`));
          else requestAnimationFrame(poll);
        };
        poll();
      }),
    { start, end },
  );
  await pause(page);
  const { rec } = r;
  const ticks = rec.ticks.reduce((a, [, n]) => a + n, 0);
  const ms = rec.ticks.reduce((a, [m]) => a + m, 0);
  const perTick = rec.ticks.filter(([, n]) => n > 0).map(([m, n]) => [m / n, n] as [number, number]);
  return {
    startTick: r.first,
    endTick: r.last,
    ticksRecorded: ticks,
    wallMs: rec.wallMs,
    tickMsMean: ticks ? ms / ticks : 0,
    tickMsMedian: weightedPercentile(perTick, 0.5),
    tickMsP95: weightedPercentile(perTick, 0.95),
    timerResolutionMs: rec.timerResolutionMs,
    // as perf.spec.ts: per-tick percentiles below 10× the clock resolution are not meaningful; cite the mean then
    tickBelowTimerResolution: rec.timerResolutionMs <= 0 || weightedPercentile(perTick, 0.95) < 10 * rec.timerResolutionMs,
    achievedTicksPerS: ticks / (rec.wallMs / 1000),
    achievedSpeed: (ticks / (rec.wallMs / 1000)) * DT,
    onNetworkMedian: percentile(rec.onNetwork, 0.5),
    onNetworkMax: Math.max(0, ...rec.onNetwork),
    renderIntervalMedianMs: percentile(rec.renderIntervals, 0.5),
    renderIntervalP95Ms: percentile(rec.renderIntervals, 0.95),
  };
}

test.describe('@perf', () => {
  test.describe.configure({ timeout: 900_000 });

  // 7
  test('perf_timeline_recorded @perf', async ({ browser, page }) => {
    await page.goto('/');
    await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
    const multiplier = 60;
    await page.getByRole('combobox', { name: 'Speed' }).selectOption(String(multiplier));
    await blur(page);
    // fill the replay window (48 MiB ≈ 2.3 sim h at 60× ≈ 2.5 min wall)
    await expect.poll(async () => (await snap(page)).timeline.snapshotBytes, { timeout: 400_000, intervals: [2000] }).toBeGreaterThan(44 * MIB);
    await pause(page);
    const full = (await snap(page)).timeline;
    const renderPaused = await page.evaluate(() => window.__livingcity!.diagnostics().render);

    // seeks: clicks spread over the whole window, so the replay distance from the snapshot below varies
    const seeks: { ms: number; from: number; to: number }[] = [];
    for (let i = 0; i < SEEKS; i++) seeks.push(await timedSeek(page, (i + 0.37) / SEEKS));
    const seekMs = seeks.map((s) => s.ms);
    const replayTicks = seeks.map((s) => s.to % SNAPSHOT_EVERY);
    const after = (await snap(page)).timeline;

    // the same A range twice: [start, start + RANGE_TICKS], first in single view, then in lockstep (branched just before start)
    const P = full.headTick - RANGE_TICKS - 600;
    const start = (await timedSeek(page, (P - full.windowStartTick) / (full.headTick - full.windowStartTick))).to;
    const single = await recordRange(page, start, start + RANGE_TICKS);
    // back to at most one snapshot interval before `start`, by ← (one sim minute per press)
    await page.getByRole('slider', { name: 'Timeline' }).focus();
    for (let i = 0; i < 400 && (await snap(page)).timeline.positionTick > start; i++) {
      const before = (await snap(page)).timeline.positionTick;
      await page.keyboard.press('ArrowLeft');
      await expect.poll(async () => (await snap(page)).timeline.positionTick).toBeLessThan(before);
    }
    const branchAt = (await snap(page)).timeline.positionTick;
    expect(start - branchAt).toBeLessThan(SNAPSHOT_EVERY);
    // branch: an intervention in A's past (B on the slider) → the first frame of B, timed in the page
    const branchMs = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const h = window.__livingcity!;
          const el = document.querySelector<HTMLElement>('[role="slider"][aria-label="Timeline"]')!;
          const frames = h.snapshot().renderFrames;
          const t0 = performance.now();
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
          const give = t0 + 10_000;
          const poll = () => {
            const s = h.snapshot();
            if (s.scenario === 'B' && s.renderFrames > frames) resolve(performance.now() - t0);
            else if (performance.now() > give) reject(new Error('no B frame within 10 s'));
            else requestAnimationFrame(poll);
          };
          poll();
        }),
    );
    const memB = (await snap(page)).timeline.snapshotBytes;
    await page.getByRole('button', { name: 'A: original' }).click();
    await expect.poll(async () => (await snap(page)).scenario).toBe('A');
    const memA = (await snap(page)).timeline.snapshotBytes;
    await page.getByRole('button', { name: 'Compare side by side' }).click();
    await expect.poll(async () => (await snap(page)).compare).toBe(true);
    expect((await snap(page)).sides!.a.tick).toBe(branchAt);
    const lockstep = await recordRange(page, start, start + RANGE_TICKS);
    const s = await snap(page);
    expect(s.sides!.a.tick).toBe(s.sides!.b.tick);
    const memAfterLockstepViewed = s.timeline.snapshotBytes;

    const use = config.use ?? {};
    const out = {
      scenario: `timeline: seek, branch, snapshot memory, lockstep compare (River City, ${multiplier}×)`,
      timestamp: new Date().toISOString(),
      browser: `${browser.browserType().name()} ${browser.version()}`,
      hardware: (() => {
        try {
          return execFileSync('sysctl', ['-n', 'hw.model', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim().replace(/\n/g, ' · ');
        } catch {
          return 'unknown (sysctl unavailable)';
        }
      })(),
      renderer: (await page.evaluate(() => window.__livingcity!.diagnostics())).renderer,
      city: s.city,
      multiplier,
      conditions: {
        viewport: page.viewportSize(),
        devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
        headless: await (async () => {
          const cdp = await page.context().newCDPSession(page);
          const { userAgent } = (await cdp.send('Browser.getVersion')) as { userAgent: string };
          await cdp.detach();
          return /Headless/.test(userAgent);
        })(),
        launchArgs: use.launchOptions?.args ?? [],
      },
      window: {
        startTick: full.windowStartTick,
        headTick: full.headTick,
        retainedSimH: (full.headTick - full.windowStartTick) / 7200,
        snapshotIntervalTicks: SNAPSHOT_EVERY,
      },
      seek: {
        n: seeks.length,
        method: 'click on the timeline track → first animation frame showing the target (includes up to one render interval)',
        targets: seeks.map((x) => x.to),
        replayTicks,
        replayTicksMin: Math.min(...replayTicks),
        replayTicksMax: Math.max(...replayTicks),
        medianMs: percentile(seekMs, 0.5),
        p95Ms: percentile(seekMs, 0.95),
        maxMs: Math.max(...seekMs),
        renderIntervalMedianMs: renderPaused.intervalMedianMs,
        // a latency within ~2 frame intervals is bounded by the frame rate, not by the replay
        frameBound: percentile(seekMs, 0.5) < 2 * renderPaused.intervalMedianMs,
      },
      branch: {
        ms: branchMs,
        atTick: branchAt,
        method: "keydown B in A's past → first rendered frame of B (in the page)",
      },
      memory: {
        budgetMiB: full.budgetBytes / MIB,
        aMiB: memA / MIB,
        bMiB: memB / MIB,
        totalMiB: (memA + memB) / MIB,
        viewedAfterLockstepMiB: memAfterLockstepViewed / MIB,
      },
      single,
      lockstep,
      lockstepTickCostRatio: single.tickMsMean > 0 ? lockstep.tickMsMean / single.tickMsMean : 0,
    };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL('timeline.json', OUT), `${JSON.stringify(out, null, 2)}\n`);

    // the file is complete and consistent
    const j = JSON.parse(readFileSync(new URL('timeline.json', OUT), 'utf8')) as typeof out;
    expect(typeof j.conditions.headless).toBe('boolean');
    expect(j.city).toBe('river_city');
    // seeks: ≥ 20, all inside the full window, spread over it, with varied replay distances
    expect(j.seek.n).toBeGreaterThanOrEqual(20);
    for (const t of j.seek.targets) {
      expect(t).toBeGreaterThanOrEqual(after.windowStartTick);
      expect(t).toBeLessThanOrEqual(after.headTick);
    }
    const spread = (Math.max(...j.seek.targets) - Math.min(...j.seek.targets)) / (j.window.headTick - j.window.startTick);
    expect(spread).toBeGreaterThan(0.8);
    expect(new Set(j.seek.replayTicks).size).toBeGreaterThanOrEqual(10);
    expect(j.seek.replayTicksMax).toBeGreaterThan(90);
    expect(j.seek.medianMs).toBeGreaterThan(0);
    expect(j.seek.p95Ms).toBeGreaterThanOrEqual(j.seek.medianMs);
    expect(j.seek.frameBound).toBe(j.seek.medianMs < 2 * j.seek.renderIntervalMedianMs);
    expect(j.branch.ms).toBeGreaterThan(0);
    // memory: each scenario within its budget, the pair ≤ 2 × budget, also after the lockstep run
    expect(j.memory.aMiB).toBeGreaterThan(40);
    expect(j.memory.aMiB).toBeLessThanOrEqual(j.memory.budgetMiB + 0.01);
    expect(j.memory.bMiB).toBeLessThanOrEqual(j.memory.budgetMiB + 0.01);
    expect(j.memory.totalMiB).toBeLessThanOrEqual(2 * j.memory.budgetMiB + 0.01);
    expect(j.memory.viewedAfterLockstepMiB).toBeLessThanOrEqual(j.memory.budgetMiB + 0.01);
    // the same sim range: both recordings start at `start` (± one frame's ticks) and span RANGE_TICKS
    for (const r of [j.single, j.lockstep]) {
      expect(Math.abs(r.startTick - start)).toBeLessThanOrEqual(20);
      expect(r.endTick - start).toBeGreaterThanOrEqual(RANGE_TICKS);
      expect(r.endTick - start).toBeLessThanOrEqual(RANGE_TICKS + 20);
      expect(r.ticksRecorded).toBeGreaterThan(0.95 * RANGE_TICKS);
      expect(r.tickMsMean).toBeGreaterThan(0);
      expect(r.tickBelowTimerResolution).toBe(r.timerResolutionMs <= 0 || r.tickMsP95 < 10 * r.timerResolutionMs);
      expect(r.onNetworkMedian).toBeGreaterThan(0);
      expect(r.renderIntervalMedianMs).toBeGreaterThan(0);
    }
    expect(j.lockstepTickCostRatio).toBeGreaterThan(1);
  });
});
