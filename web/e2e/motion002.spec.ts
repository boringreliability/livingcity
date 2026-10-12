// Ward motion-002, tests 7–10 (browser): one presentation time for A and B, bounded latency, the GPU
// draws where the presentation rule says (held cars behind their stop lines), no backward steps.
import { expect, test, type Page } from '@playwright/test';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Snap = { tick: number; running: boolean; camera: { zoom: number }; frameRecords: number; trackedTrip: number | null; compare: boolean; scenario: 'A' | 'B'; timeline: { positionTick: number } };
type Presentation = { tickA: number; tickB: number | null; lagS: number; lagMs: number };
type VehicleDraw = { link: number; s: number; length: number; stop: number; lane: number; next: number; page: [number, number] };
type TrackedDraw = { link: number; s: number; page: [number, number] };
type Hook = {
  snapshot(): Snap;
  diagnostics(): { presentation?: Presentation; achievedTicksPerS: number; targetTicksPerS: number };
  vehicleDraw(record: number): VehicleDraw | null;
  frameVehicle(record: number): { link: number; s: number; queued: boolean; lane?: number; next?: number } | null;
  trackedDraw(): TrackedDraw | null;
  trackedScreenCenter(): [number, number] | null;
  vehicleScreenCenter(record: number): [number, number] | null;
  pickAt(x: number, y: number): { vehicle: number | null };
  setDebug(o: { hideVehicles?: boolean }): void;
  linkScreenPoint(link: number, t: number): [number, number] | null;
  linkInfo(link: number): { length: number; lanes: number } | null;
};
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window.__livingcity as unknown as Hook).snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

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
/** Mean RGB of the 3×3 pixels around page point `c` (Red r5 F1: a light road under a car can match its luminance). */
async function rgb(page: Page, c: [number, number]): Promise<[number, number, number]> {
  const buf = await page.screenshot({ clip: { x: Math.round(c[0] - 1.5), y: Math.round(c[1] - 1.5), width: 3, height: 3 }, animations: 'disabled' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = new OffscreenCanvas(img.width, img.height);
    const g = cv.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const m: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) m[k] += d[i + k]! / (d.length / 4);
    return m;
  }, buf.toString('base64'));
}
/** The largest per-channel difference between two mean colours. */
const colourDiff = (a: [number, number, number], b: [number, number, number]) => Math.max(...a.map((x, k) => Math.abs(x - b[k]!)));
type Sample = 'presentation' | 'lag' | 'tracked' | 'lagCheck';
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
              : what === 'lagCheck'
                ? { p: h.diagnostics().presentation ?? null, achieved: h.diagnostics().achievedTicksPerS, target: h.diagnostics().targetTicksPerS }
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
  expect(s.at(-1)!.tickA, 'both sides advance').toBeGreaterThan(s[0]!.tickA + 5);
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
    // lagMs ≈ lagS / rate; the rate is the requested one unless the engine is behind (then: skipped)
    const ps = await sampleFrames<{ p: Presentation | null; achieved: number; target: number }>(page, 1000, 'lagCheck');
    let checked = 0;
    for (const x of ps) {
      if (!x.p || x.p.lagS <= 0.01 || x.achieved < 0.9 * x.target) continue;
      checked++;
      expect(Math.abs(x.p.lagMs - (x.p.lagS * 1000) / m) / ((x.p.lagS * 1000) / m), `${m}×: lagMs ≈ lagS / rate`).toBeLessThanOrEqual(0.25);
    }
    console.log(`${m}×: lagMs/lagS cross-checked on ${checked} samples`);
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
      const out: { i: number; f: { link: number; s: number; queued: boolean; lane?: number; next?: number }; d: VehicleDraw }[] = [];
      for (let i = 0; i < h.snapshot().frameRecords; i++) {
        const f = h.frameVehicle(i);
        const d = h.vehicleDraw(i);
        if (f && d) out.push({ i, f, d });
      }
      return out;
    });
  // every held car (at its link's end in the sim) is drawn at or behind its stop line, on its own link
  const cars = await all();
  const held = cars.filter((c) => c.f.queued && c.f.s >= c.d.length - 1e-3); // held at the link end in the sim
  expect(held.length, 'held cars at junctions').toBeGreaterThanOrEqual(10);
  for (const c of held) {
    expect(c.d.link, 'drawn on its own link').toBe(c.f.link);
    expect(c.d.stop, 'the stop line is before the link end').toBeLessThanOrEqual(c.d.length - 0.5);
    expect(c.d.s, 'at or behind the stop line').toBeLessThanOrEqual(c.d.stop + 0.01);
    expect(c.d.next, 'not moving on while held').toBe(0xffff);
  }
  // held head cars (frame s = length, nobody ahead on the link) with a single-lane next link: the old rule
  // drew them exactly at the next link's start (that link's centreline start, one lane). A follower sits
  // behind the head car on its own link, so it cannot cover that old point; it can cover the head car's
  // presented point under a wrong rule, so ≥ 2 visited cars must have no same-lane car whose frame s lies
  // within ±2.6 m of their ŝ (Red r5 F2), and those are visited first. (Gold amendment: at ?demand=3 only
  // 2–8 such cars without a follower within 9.5 m exist city-wide, so the cars are visited one by one.)
  const clearOf = (c: (typeof cars)[number]) => !cars.some((o) => o !== c && o.f.link === c.f.link && o.f.lane === c.f.lane && Math.abs(o.f.s - c.d.s) <= 2.6);
  const heads = held.filter((c) => c.f.next !== undefined && c.f.next !== 0xffff).sort((a, b) => Number(clearOf(b)) - Number(clearOf(a)) || a.i - b.i);
  const single: typeof heads = [];
  for (const c of heads) {
    const lanes = await page.evaluate((next) => (window.__livingcity as unknown as Hook).linkInfo(next)?.lanes ?? 0, c.f.next!);
    if (lanes === 1) single.push(c);
  }
  expect(single.length, 'held head cars with a single-lane next link').toBeGreaterThanOrEqual(8);
  const box = (await page.locator('canvas.city').first().boundingBox())!;
  const centre: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  await wheelZoom(page, centre, (z) => z >= 4);
  const inView = (p: [number, number] | null) => !!p && p[0] > box.x + 30 && p[1] > box.y + 30 && p[0] < box.x + box.width - 30 && p[1] < box.y + box.height - 30;
  /** The car's record as presented now (records do not change while paused; Red r5 m1). */
  const drawnOf = (c: (typeof heads)[number]) => page.evaluate((i) => (window.__livingcity as unknown as Hook).vehicleDraw(i), c.i);
  /** Pan (map drags from the canvas centre, each within the canvas) until `p` is near the centre. */
  const panTo = async (c: (typeof heads)[number]) => {
    for (let k = 0; k < 40; k++) {
      const d = await drawnOf(c);
      if (!d) return null;
      const dx = centre[0] - d.page[0];
      const dy = centre[1] - d.page[1];
      if (Math.abs(dx) < box.width / 4 && Math.abs(dy) < box.height / 4) return d;
      const mx = Math.max(-box.width / 2 + 40, Math.min(box.width / 2 - 40, dx));
      const my = Math.max(-box.height / 2 + 40, Math.min(box.height / 2 - 40, dy));
      await page.mouse.move(centre[0], centre[1]);
      await page.mouse.down();
      await page.mouse.move(centre[0] + mx, centre[1] + my, { steps: 8 });
      await page.mouse.up();
      await sleep(150);
    }
    return null;
  };
  const pts: { page: [number, number]; old: [number, number]; emptyOld: boolean; clear: boolean }[] = [];
  for (const c of single.slice(0, 16)) {
    if (pts.length >= 8) break;
    const d = await panTo(c);
    if (!d || !inView(d.page)) continue;
    const old = await page.evaluate((next) => (window.__livingcity as unknown as Hook).linkScreenPoint(next, 0), c.f.next!);
    if (!old || !inView(old)) continue;
    // the old point: the next link's start; single-lane next links only, so its centreline is the lane
    const shown = await rgb(page, d.page);
    const oldShown = await rgb(page, old);
    await page.evaluate(() => (window.__livingcity as unknown as Hook).setDebug({ hideVehicles: true }));
    await sleep(300);
    const hidden = await rgb(page, d.page);
    const oldHidden = await rgb(page, old);
    await page.evaluate(() => (window.__livingcity as unknown as Hook).setDebug({ hideVehicles: false }));
    await sleep(300);
    expect(colourDiff(shown, hidden), `held head car ${pts.length} drawn at its presented point`).toBeGreaterThanOrEqual(30);
    pts.push({ page: d.page, old, emptyOld: colourDiff(oldShown, oldHidden) < 30, clear: clearOf(c) });
  }
  expect(pts.length, 'held head cars visited with their old points in view').toBeGreaterThanOrEqual(6);
  expect(pts.filter((p) => p.clear).length, 'visited cars with no other car at their presented point').toBeGreaterThanOrEqual(2);
  const emptyOld = pts.filter((p) => p.emptyOld).length;
  expect(emptyOld, 'the old points (the next link’s start, inside the junction) are mostly empty').toBeGreaterThanOrEqual(Math.ceil(pts.length / 2));

  // running at 20×: a car its newest frame shows held is never presented past its stop line
  await speed(page, 20);
  await play(page);
  const end = Date.now() + 2000;
  let checked = 0;
  while (Date.now() < end) {
    const bad = await page.evaluate(() => {
      const h = window.__livingcity as unknown as Hook;
      const out: string[] = [];
      let n = 0;
      for (let i = 0; i < h.snapshot().frameRecords; i++) {
        const f = h.frameVehicle(i);
        const d = h.vehicleDraw(i);
        if (!f || !d || !f.queued || d.link !== f.link) continue;
        if (f.s < d.length - 1e-3) continue; // held at the link end in the newest frame
        n++;
        if (d.s > d.stop + 0.01) out.push(`record ${i} on link ${d.link}: ${d.s} > stop line ${d.stop}`);
      }
      return { out, n };
    });
    checked += bad.n;
    expect(bad.out, 'running: held cars never past their stop line').toEqual([]);
  }
  expect(checked, 'held cars checked while running').toBeGreaterThan(20);
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
