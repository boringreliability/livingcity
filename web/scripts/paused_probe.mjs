// Paused frame production in the browser (before/after motion-001). Usage: node paused_probe.mjs <baseURL> <out.json> <label>
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
const require = createRequire('/Users/Z6DEC/kmddev/livingcity/.claude/worktrees/epic-sim-core/web/package.json');
const { chromium } = require('@playwright/test');

const [base, out, label] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const result = { label, timestamp: new Date().toISOString(), loadBefore: loadavg(), runs: [] };

async function measure(url, compare) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // count the frames the UI receives from the worker, and their transferable/cloned bytes
  await page.addInitScript(() => {
    const W = window.Worker;
    window.__frames = { n: 0, bytes: 0 };
    window.Worker = class extends W {
      constructor(...a) {
        super(...a);
        this.addEventListener('message', (e) => {
          const m = e.data;
          if (m && m.type === 'frame') {
            window.__frames.n++;
            const ta = [m.vehicles, m.nextLinks, m.linkCounts, m.linkQueued, m.closed, m.metrics, m.tripIds];
            window.__frames.bytes += ta.reduce((s, x) => s + (x ? x.byteLength : 0), 0);
          }
        });
      }
    };
  });
  await page.goto(url);
  await page.waitForFunction(() => (window.__livingcity?.snapshot().tick ?? 0) > 1800, null, { timeout: 120_000 });
  if (compare) {
    await page.evaluate(() => (document.activeElement)?.blur());
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__livingcity.snapshot().running === false);
    await page.getByRole('slider', { name: 'Timeline' }).focus();
    await page.keyboard.press('ArrowLeft');
    await page.mouse.click(3, 300);
    await page.keyboard.press('b');
    await page.waitForFunction(() => window.__livingcity.snapshot().scenario === 'B');
    await page.getByRole('button', { name: 'Compare side by side' }).click();
    await page.waitForFunction(() => window.__livingcity.snapshot().compare === true);
  } else {
    await page.evaluate(() => (document.activeElement)?.blur());
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__livingcity.snapshot().running === false);
  }
  await page.waitForTimeout(2000); // settle
  const a = await page.evaluate(() => ({ ...window.__frames, t: performance.now() }));
  await page.waitForTimeout(5000);
  const b = await page.evaluate(() => ({ ...window.__frames, t: performance.now() }));
  const s = (b.t - a.t) / 1000;
  const r = { url, compare, seconds: +s.toFixed(2), framesPerS: +((b.n - a.n) / s).toFixed(1), bytesPerS: Math.round((b.bytes - a.bytes) / s), bytesPerFrame: b.n > a.n ? Math.round((b.bytes - a.bytes) / (b.n - a.n)) : 0 };
  await page.close();
  return r;
}

for (const [url, compare] of [[`${base}/`, false], [`${base}/?demand=5`, false], [`${base}/`, true]]) result.runs.push(await measure(url, compare));
result.loadAfter = loadavg();
await browser.close();
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 1));
