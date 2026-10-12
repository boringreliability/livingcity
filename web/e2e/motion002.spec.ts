// Ward motion-002, tests 7–10 (browser): one presentation time for A and B, bounded latency, the GPU
// draws where the presentation rule says (held cars behind their stop lines), no backward steps.
import { expect, test, type Page } from '@playwright/test';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Snap = { tick: number; running: boolean; camera: { zoom: number }; frameRecords: number; trackedTrip: number | null; compare: boolean; scenario: 'A' | 'B'; timeline: { positionTick: number } };
type Presentation = { tickA: number; tickB: number | null; lagS: number; lagMs: number };
type VehicleDraw = { link: number; s: number; length: number; lane: number; next: number; page: [number, number] };
type TrackedDraw = { link: number; s: number; page: [number, number] };
type Hook = {
  snapshot(): Snap;
  diagnostics(): { presentation?: Presentation };
  vehicleDraw(record: number): VehicleDraw | null;
  frameVehicle(record: number): { link: number; s: number; queued: boolean } | null;
  trackedDraw(): TrackedDraw | null;
  trackedScreenCenter(): [number, number] | null;
  vehicleScreenCenter(record: number): [number, number] | null;
  pickAt(x: number, y: number): { vehicle: number | null };
  setDebug(o: { hideVehicles?: boolean }): void;
};
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window.__livingcity as unknown as Hook).snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const stopLine = (length: number) => length - Math.min(6, length / 2);

async function ready(page: Page, url = '/') {
  await page.goto(url);
  await expect.poll(async () => (await snap(page)).tick, { timeout: 60_000 }).toBeGreaterThan(1800);
}
async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
}
async function play(page: Page) {
  await blur(page);
  if (!(await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(true);
}
async function speed(page: Page, m: number) {
  await page.getByRole('combobox', { name: 'Speed' }).selectOption(String(m));
  await blur(page);
}
async function wheelZoom(page: Page, at: [number, number], ok: (z: number) => boolean) {
  await page.mouse.move(at[0], at[1]);
  await expect
    .poll(
      async () => {
        if (ok((await snap(page)).camera.zoom)) return true;
        await page.mouse.wheel(0, -60);
        return false;
      },
      { intervals: [60], timeout: 60_000 },
    )
    .toBe(true);
  await page.mouse.move(3, 3);
  await sleep(300);
}
async function lum(page: Page, c: [number, number]): Promise<number> {
  const buf = await page.screenshot({ clip: { x: Math.round(c[0] - 1.5), y: Math.round(c[1] - 1.5), width: 3, height: 3 }, animations: 'disabled' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = new OffscreenCanvas(img.width, img.height);
    const g = cv.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    return s / (d.length / 4);
  }, buf.toString('base64'));
}
type Sample = 'presentation' | 'lag' | 'tracked';
/** Samples one fixed reading of the hook on every animation frame for `ms`. */
function sampleFrames<T>(page: Page, ms: number, what: Sample): Promise<T[]> {
  return page.evaluate(
    ([ms, what]) =>
      new Promise<T[]>((resolve) => {
        const h = window.__livingcity as unknown as Hook;
        const read = () =>
          what === 'presentation'
            ? (h.diagnostics().presentation ?? null)
            : what === 'lag'
              ? (h.diagnostics().presentation?.lagMs ?? Number.NaN)
              : { d: h.trackedDraw(), ring: h.trackedScreenCenter() };
        const out: T[] = [];
        const end = performance.now() + ms;
        const tick = () => {
          out.push(read() as T);
          if (performance.now() < end) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    [ms, what] as const,
  );
}

// 7
test('compare_shares_one_presentation_time', async ({ page }) => {
  await ready(page);
  await pause(page);
  const slider = page.getByRole('slider', { name: 'Timeline' });
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await blur(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  await speed(page, 20);
  await play(page);
  await sleep(500);
  const s = await sampleFrames<Presentation | null>(page, 2000, 'presentation');
  expect(s.length).toBeGreaterThan(10);
  for (const p of s) {
    expect(p, 'diagnostics().presentation').not.toBeNull();
    expect(p!.tickB, 'B is presented').not.toBeNull();
    expect(p!.tickA, 'A and B at one presentation time').toBe(p!.tickB);
  }
});

// 8 (browser part)
test('presentation_latency_is_bounded_in_the_browser', async ({ page }) => {
  await ready(page);
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
  const out: Record<string, number> = {};
  for (const [m, bound] of [
    [1, 600],
    [20, 120],
  ] as const) {
    await speed(page, m);
    await play(page);
    await sleep(1500);
    const lags = await sampleFrames<number>(page, 4000, 'lag');
    out[`${m}x`] = median(lags);
    expect(median(lags), `${m}×: median presentation lag (ms)`).toBeLessThanOrEqual(bound);
    expect(Math.min(...lags), `${m}×: never ahead of the newest frame`).toBeGreaterThanOrEqual(0);
  }
  console.log('presentation lag, median ms:', JSON.stringify(out));
});

// 9 (replaces motion.spec test 7)
test('gpu_draws_where_presentation_says', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page, '/?demand=3');
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await blur(page);
  const t0 = (await snap(page)).tick;
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(t0 + 1200);
  await pause(page);
  await sleep(1500); // the presentation settles on the paused frame
  const all = () =>
    page.evaluate(() => {
      const h = window.__livingcity as unknown as Hook;
      const out: { f: { link: number; s: number; queued: boolean }; d: VehicleDraw }[] = [];
      for (let i = 0; i < h.snapshot().frameRecords; i++) {
        const f = h.frameVehicle(i);
        const d = h.vehicleDraw(i);
        if (f && d) out.push({ f, d });
      }
      return out;
    });
  // every held car (at its link's end in the sim) is drawn at or behind its stop line, on its own link
  const cars = await all();
  const held = cars.filter((c) => c.f.queued && c.f.s >= stopLine(c.d.length));
  expect(held.length, 'held cars at junctions').toBeGreaterThanOrEqual(10);
  for (const c of held) {
    expect(c.d.link, 'drawn on its own link').toBe(c.f.link);
    expect(c.d.s, 'at or behind the stop line').toBeLessThanOrEqual(stopLine(c.d.length) + 0.01);
    expect(c.d.next, 'not moving on while held').toBe(0xffff);
  }
  // zoom where most held cars are; the GPU draws them where the rule says
  let best = held[0]!;
  let n = 0;
  for (const c of held) {
    const k = held.filter((e) => Math.hypot(e.d.page[0] - c.d.page[0], e.d.page[1] - c.d.page[1]) < 40).length;
    if (k > n) [best, n] = [c, k];
  }
  const box = (await page.locator('canvas.city').first().boundingBox())!;
  const centre: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(best.d.page[0], best.d.page[1]);
  await page.mouse.down();
  await page.mouse.move(centre[0], centre[1], { steps: 12 });
  await page.mouse.up();
  await sleep(300);
  await wheelZoom(page, centre, (z) => z >= 4);
  const visible = (await all()).filter((c) => c.d.page[0] > 30 && c.d.page[1] > 30 && c.d.page[0] < box.width - 30 && c.d.page[1] < box.height - 30);
  const pts = visible.slice(0, 12).map((c) => c.d.page);
  expect(pts.length, 'cars in view').toBeGreaterThanOrEqual(8);
  const shown = await Promise.all(pts.map((p) => lum(page, p)));
  await page.evaluate(() => (window.__livingcity as unknown as Hook).setDebug({ hideVehicles: true }));
  await sleep(300);
  const hidden = await Promise.all(pts.map((p) => lum(page, p)));
  for (let i = 0; i < pts.length; i++) expect(Math.abs(shown[i]! - hidden[i]!), `car ${i} drawn at its presented point`).toBeGreaterThanOrEqual(30);
});

// 10
test('tracked_car_never_steps_back_in_the_browser', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page);
  const box = (await page.locator('canvas.city').first().boundingBox())!;
  const centre: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  await wheelZoom(page, centre, (z) => z >= 1.5);
  for (const m of [1, 20]) {
    await speed(page, m);
    await play(page);
    // pick a moving car
    await expect
      .poll(
        async () => {
          const p = await page.evaluate(() => {
            const h = window.__livingcity as unknown as Hook;
            for (let i = 0; i < h.snapshot().frameRecords; i++) {
              const f = h.frameVehicle(i);
              const c = h.vehicleScreenCenter(i);
              if (f && !f.queued && c && document.elementFromPoint(c[0], c[1])?.tagName === 'CANVAS' && h.pickAt(c[0], c[1]).vehicle === i) return c;
            }
            return null;
          });
          if (!p) return false;
          await page.mouse.click(p[0], p[1]);
          return (await snap(page)).trackedTrip !== null;
        },
        { timeout: 30_000, intervals: [300] },
      )
      .toBe(true);
    await page.mouse.move(3, 3);
    const s = await sampleFrames<{ d: TrackedDraw | null; ring: [number, number] | null }>(page, 3000, 'tracked');
    const seen = new Set<number>();
    let prev: TrackedDraw | null = null;
    for (const x of s) {
      if (!x.d) continue;
      if (prev && x.d.link === prev.link) expect(x.d.s, `${m}×: tracked car steps back on link ${x.d.link}`).toBeGreaterThanOrEqual(prev.s - 0.05);
      if (prev && x.d.link !== prev.link) expect(seen.has(x.d.link), `${m}×: tracked car returns to an earlier link`).toBe(false);
      seen.add(x.d.link);
      if (x.ring) expect(Math.hypot(x.ring[0] - x.d.page[0], x.ring[1] - x.d.page[1]), 'the ring stays on the car').toBeLessThanOrEqual(1);
      prev = x.d;
    }
    await page.keyboard.press('Escape');
  }
});
