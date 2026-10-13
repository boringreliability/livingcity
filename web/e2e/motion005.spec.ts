// Ward motion-005, tests 1–6 (browser): the epic's six flows, each observed at 1× and at 20× through
// successive animation frames (screenshots record the layout; samples are attached to the report).
import { expect, test, type Page } from '@playwright/test';

import { NO_NEXT } from '../src/render/motion';
import type { LivingCitySnapshot } from '../src/ui/testHook';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type P = [number, number];
type TrackedDraw = { link: number; s: number; length: number; world: P; page: P };
type VehicleDraw = { link: number; s: number; stop: number; world: P; page: P };
type FrameVehicle = { link: number; s: number; queued: boolean; lane: number; next: number };
type Presentation = { tickA: number; tickB: number | null; lagMs: number };
type Hook = {
  snapshot(): LivingCitySnapshot;
  diagnostics(): { presentation: Presentation };
  trackedDraw(): TrackedDraw | null;
  trackedScreenCenter(): P | null;
  trackedMarker(): { page: P; radiusPx: number } | null;
  vehicleDraw(record: number): VehicleDraw | null;
  vehicleScreenCenter(record: number): P | null;
  frameVehicle(record: number): FrameVehicle | null;
  drawAt(link: number, s: number, lane: number, next: number): P;
  pickAt(x: number, y: number): { vehicle: number | null; link: number | null };
  linkScreenPoint(link: number, t: number): P | null;
  linkInfo(link: number): { length: number; lanes: number } | null;
  queuePins(): { link: number; queued: number; page: P }[];
  closureSigns(): { link: number; page: P; radiusPx: number }[];
  interventions(): { tick: number; kind: 'close' | 'open'; label: string; links: number[] }[];
  comparison(): { tick: number; a: number[]; b: number[]; crossings: { baseTick: number } | null } | null;
};
const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** The motion bound (ward spec): metres a drawn car may move between two animation frames dt ms apart. */
const V_MAX = 20;
const bound = (m: number, dtMs: number) => (3 * V_MAX * m * dtMs) / 1000 + 2;

async function ready(page: Page, url = '/') {
  await page.goto(url);
  await expect.poll(async () => (await snap(page)).tick, { timeout: 90_000 }).toBeGreaterThan(1800);
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
async function canvasCentre(page: Page): Promise<P> {
  const box = (await page.locator('canvas.city').first().boundingBox())!;
  return [box.x + box.width / 2, box.y + box.height / 2];
}
async function wheelZoom(page: Page, at: P, ok: (z: number) => boolean) {
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
async function shot(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}
async function attachJson(name: string, data: unknown) {
  await test.info().attach(name, { body: JSON.stringify(data), contentType: 'application/json' });
}
const mainBridge = async (page: Page) => (await snap(page)).landmarks!.central_bridge as number[];
const bridgeButton = (page: Page) => page.getByRole('button', { name: 'Close the main bridge' });

/**
 * Follow a moving car that is on the canvas, clickable, ≥ `minFrac` along its link, and whose remaining route
 * has ≥ 2 links (Escape and try another otherwise). Returns its route at the start.
 */
async function followMovingCar(page: Page, minFrac = 0): Promise<number[]> {
  let route: number[] = [];
  await expect
    .poll(
      async () => {
        const p = await page.evaluate((minFrac) => {
          const h = window.__livingcity as unknown as Hook;
          const n = h.snapshot().frameRecords;
          for (let i = 0; i < n; i++) {
            const f = h.frameVehicle(i);
            const c = h.vehicleScreenCenter(i);
            const info = f ? h.linkInfo(f.link) : null;
            if (!f || f.queued || !c || !info || f.s / info.length < minFrac) continue;
            if (document.elementFromPoint(c[0], c[1])?.tagName !== 'CANVAS' || h.pickAt(c[0], c[1]).vehicle !== i) continue;
            return c;
          }
          return null;
        }, minFrac);
        if (!p) return false;
        await page.mouse.click(p[0], p[1]);
        const s = await snap(page);
        if (s.trackedTrip !== null && s.trackedRoute.length >= 2) {
          route = s.trackedRoute;
          return true;
        }
        await page.keyboard.press('Escape');
        return false;
      },
      { timeout: 60_000, intervals: [300] },
    )
    .toBe(true);
  await page.mouse.move(3, 3);
  return route;
}

type TrackedSample = { t: number; d: TrackedDraw | null; marker: { page: P } | null; centre: P | null; route: number[] };
/** Tracked-car samples on every animation frame, for `ms` or until it has left `stopOffLink` (if given). */
function sampleTracked(page: Page, ms: number, stopOffLink: number | null): Promise<TrackedSample[]> {
  return page.evaluate(
    ([ms, stopOff]) =>
      new Promise<TrackedSample[]>((resolve) => {
        const h = window.__livingcity as unknown as Hook;
        const out: TrackedSample[] = [];
        const end = performance.now() + ms;
        let after = 0;
        const step = () => {
          const d = h.trackedDraw();
          out.push({ t: performance.now(), d, marker: h.trackedMarker(), centre: h.trackedScreenCenter(), route: h.snapshot().trackedRoute });
          if (stopOff !== null && d && d.link !== stopOff) after++;
          // keep 30 more frames after the crossing so the step across it and after it are both seen
          if (performance.now() < end && after < 30) requestAnimationFrame(step);
          else resolve(out);
        };
        requestAnimationFrame(step);
      }),
    [ms, stopOffLink] as const,
  );
}

/**
 * The tracked-car rule (tests 1, 4, 5): every link entered is next on the remaining route (the previous
 * frame's, or the route at that frame: rerouting is allowed) and never one visited before; no backward step;
 * the motion bound; the brackets on the car.
 */
function checkTracked(samples: TrackedSample[], m: number, what: string) {
  let prev: TrackedSample | null = null;
  let changes = 0;
  const visited = new Set<number>();
  for (const x of samples) {
    if (!x.d) continue;
    if (x.marker && x.centre) expect(Math.hypot(x.marker.page[0] - x.centre[0], x.marker.page[1] - x.centre[1]), `${what}: brackets on the car`).toBeLessThanOrEqual(1.5);
    if (prev?.d) {
      const dist = Math.hypot(x.d.world[0] - prev.d.world[0], x.d.world[1] - prev.d.world[1]);
      expect(dist, `${what}: step of ${dist.toFixed(2)} m in ${(x.t - prev.t).toFixed(0)} ms (link ${prev.d.link} → ${x.d.link})`).toBeLessThanOrEqual(bound(m, x.t - prev.t));
      if (x.d.link === prev.d.link) expect(x.d.s, `${what}: no backward step on link ${x.d.link}`).toBeGreaterThanOrEqual(prev.d.s - 0.05);
      else {
        changes++;
        const next = prev.route.indexOf(x.d.link) >= 1 || x.route[0] === x.d.link;
        expect(next, `${what}: link ${x.d.link} is next on the route (was ${JSON.stringify(prev.route.slice(0, 3))}, now ${JSON.stringify(x.route.slice(0, 3))})`).toBe(true);
        expect(visited.has(x.d.link), `${what}: link ${x.d.link} was visited before`).toBe(false);
      }
    }
    visited.add(x.d.link);
    prev = x;
  }
  return changes;
}

for (const m of [1, 20]) {
  // 1
  test(`flow_junction_crossing (${m}×)`, async ({ page }) => {
    test.setTimeout(300_000);
    await ready(page);
    await wheelZoom(page, await canvasCentre(page), (z) => z >= 1.5);
    await speed(page, m);
    await play(page);
    let crossed = 0;
    for (let attempt = 0; attempt < 4 && crossed === 0; attempt++) {
      const route = await followMovingCar(page, m === 1 ? 0.5 : 0);
      await shot(page, `junction-${m}x-before-${attempt}`);
      const first = (await page.evaluate(() => window.__livingcity!.trackedDraw()))?.link ?? route[0]!;
      const s = await sampleTracked(page, 40_000, first);
      await attachJson(`junction-${m}x-samples-${attempt}`, s);
      crossed = checkTracked(s, m, `${m}× junction`);
      if (crossed) await shot(page, `junction-${m}x-after`);
      await page.keyboard.press('Escape');
    }
    expect(crossed, `${m}×: the followed car entered a new link`).toBeGreaterThanOrEqual(1);
  });

  // 4
  test(`flow_pause_inspect_resume (${m}×)`, async ({ page }) => {
    test.setTimeout(300_000);
    await ready(page);
    await wheelZoom(page, await canvasCentre(page), (z) => z >= 1.5);
    await speed(page, m);
    await play(page);
    await sleep(1500);
    await pause(page);
    // quiet pause, UI alive
    const a = await snap(page);
    await sleep(2000);
    const b = await snap(page);
    expect(b.framesReceived - a.framesReceived, `${m}×: frames received while paused`).toBeLessThanOrEqual(2);
    expect(b.tick, `${m}×: tick unchanged while paused`).toBe(a.tick);
    expect(b.renderFrames - a.renderFrames, `${m}×: drawing continues while paused`).toBeGreaterThanOrEqual(20);
    // inspect a road (a point that picks a link and no car)
    const roadAt = await page.evaluate(() => {
      const h = window.__livingcity as unknown as Hook;
      const n = h.snapshot().linkCounts.length;
      for (let l = 0; l < n; l++) {
        const p = h.linkScreenPoint(l, 0.5);
        if (!p || document.elementFromPoint(p[0], p[1])?.tagName !== 'CANVAS') continue;
        const k = h.pickAt(p[0], p[1]);
        if (k.link === l && k.vehicle === null) return { l, p };
      }
      return null;
    });
    expect(roadAt, 'a road to inspect on the canvas').not.toBeNull();
    await page.mouse.click(roadAt!.p[0], roadAt!.p[1]);
    await expect.poll(async () => (await snap(page)).selectedLink).toBe(roadAt!.l);
    await expect(page.getByRole('region', { name: 'Selected road' })).toBeVisible();
    await shot(page, `pause-${m}x-road`);
    await page.keyboard.press('Escape');
    // inspect a car while paused
    const route = await followMovingCar(page);
    const m0 = await page.evaluate(() => ({ mk: window.__livingcity!.trackedMarker(), c: window.__livingcity!.trackedScreenCenter(), d: window.__livingcity!.trackedDraw() }));
    expect(m0.mk && m0.c, 'brackets and centre while paused').toBeTruthy();
    expect(Math.hypot(m0.mk!.page[0] - m0.c![0], m0.mk!.page[1] - m0.c![1])).toBeLessThanOrEqual(1.5);
    await sleep(1000);
    const d1 = await page.evaluate(() => window.__livingcity!.trackedDraw());
    expect(Math.hypot(d1!.world[0] - m0.d!.world[0], d1!.world[1] - m0.d!.world[1]), `${m}×: the paused car stays put`).toBeLessThanOrEqual(0.01);
    await shot(page, `pause-${m}x-car`);
    // resume
    const t0 = (await snap(page)).tick;
    const startS = d1!.s;
    const startLink = d1!.link;
    await play(page);
    const s = await sampleTracked(page, 3000, null);
    await attachJson(`resume-${m}x-samples`, s);
    expect((await snap(page)).tick, `${m}×: tick advances after resume`).toBeGreaterThan(t0);
    checkTracked(s, m, `${m}× resume`);
    const last = s.filter((x) => x.d).at(-1)!.d!;
    const progressed = last.link !== startLink ? route.includes(last.link) || s.some((x) => x.route.includes(last.link)) : last.s > startS;
    expect(progressed, `${m}×: the tracked car moves on after resume`).toBe(true);
  });

  // 5
  test(`flow_rewind_and_branch (${m}×)`, async ({ page }) => {
    test.setTimeout(300_000);
    await ready(page);
    await wheelZoom(page, await canvasCentre(page), (z) => z >= 1.5);
    await speed(page, m);
    await play(page);
    await sleep(3000);
    await pause(page);
    const before = (await snap(page)).tick;
    // one seek, sampled from the click on: after it, the presentation stands on the new frame and nothing moves
    // (a presenter that kept history from before the seek would animate cars from their old places)
    type SeekSample = { tick: number; presA: number; cars: { link: number; s: number; fLink: number; fS: number; world: P }[] };
    const sampling = page.evaluate(
      () =>
        new Promise<SeekSample[]>((resolve) => {
          const h = window.__livingcity as unknown as Hook;
          const out: SeekSample[] = [];
          const end = performance.now() + 1500;
          const step = () => {
            const cars: SeekSample['cars'] = [];
            const records = h.snapshot().frameRecords;
            for (let i = 0; i < records && cars.length < 40; i++) {
              const f = h.frameVehicle(i);
              const v = h.vehicleDraw(i);
              if (!f || !v || !h.vehicleScreenCenter(i)) continue;
              cars.push({ link: v.link, s: v.s, fLink: f.link, fS: f.s, world: v.world });
            }
            out.push({ tick: h.snapshot().tick, presA: h.diagnostics().presentation.tickA, cars });
            if (performance.now() < end) requestAnimationFrame(step);
            else resolve(out);
          };
          requestAnimationFrame(step);
        }),
    );
    await page.getByRole('button', { name: '−1 min' }).click();
    const seek = await sampling;
    await attachJson(`seek-${m}x-samples`, seek);
    const after = seek.filter((x) => x.tick !== before);
    expect(after.length, `${m}×: samples after the seek`).toBeGreaterThanOrEqual(10);
    expect(after[0]!.tick, `${m}×: the seek went back`).toBeLessThan(before);
    for (const x of after) {
      expect(x.tick, `${m}×: one frame after the seek (paused)`).toBe(after[0]!.tick);
      expect(x.presA, `${m}×: the presentation stands on the new frame`).toBe(x.tick);
      const placed = x.cars.filter((c) => c.link === c.fLink && Math.abs(c.s - c.fS) <= 15).length;
      expect(placed / x.cars.length, `${m}×: cars on their new records' links`).toBeGreaterThanOrEqual(0.95);
      x.cars.forEach((c, i) => {
        const c0 = after[0]!.cars[i]!;
        expect(Math.hypot(c.world[0] - c0.world[0], c.world[1] - c0.world[1]), `${m}×: car ${i} still after the seek`).toBeLessThanOrEqual(0.01);
      });
    }
    await expect.poll(async () => (await snap(page)).timeline.positionTick).toBeLessThan(before);
    // branch: a decision in the past (toggling the Main Bridge with b) creates branch B there
    const at = (await snap(page)).timeline.positionTick;
    await page.getByRole('slider', { name: 'Timeline' }).focus();
    await page.keyboard.press('b');
    await expect.poll(async () => (await snap(page)).scenario).toBe('B');
    expect((await snap(page)).branchTick).toBe(at);
    await shot(page, `branch-${m}x`);
    // resume on B
    await play(page);
    const t0 = (await snap(page)).tick;
    await followMovingCar(page);
    const s = await sampleTracked(page, 3000, null);
    await attachJson(`branch-${m}x-samples`, s);
    checkTracked(s, m, `${m}× on B`);
    expect((await snap(page)).tick, `${m}×: B advances`).toBeGreaterThan(t0);
  });
}

// 2
test('flow_queue_forms_and_releases', async ({ page }) => {
  test.setTimeout(420_000);
  await ready(page);
  const main = await mainBridge(page);
  await speed(page, 20);
  await play(page);
  await bridgeButton(page).click();
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(main));
  const closedAt = (await snap(page)).simTimeS;
  await expect
    .poll(async () => (await page.evaluate(() => (window.__livingcity as unknown as Hook).queuePins())).some((p) => p.queued >= 10), { timeout: 120_000, intervals: [500] })
    .toBe(true);
  expect((await snap(page)).simTimeS - closedAt, 'a queue of ≥ 10 within 20 sim min').toBeLessThanOrEqual(20 * 60);
  // the longest queue; zoom to it while paused so it is still there to observe
  await pause(page);
  const pin = (await page.evaluate(() => (window.__livingcity as unknown as Hook).queuePins())).sort((a, b) => b.queued - a.queued)[0]!;
  await wheelZoom(page, pin.page, (z) => z >= 3);
  await shot(page, 'queue-formed');
  for (const mm of [1, 20]) {
    await speed(page, mm);
    await play(page);
    const frames = await page.evaluate(
      (link) =>
        new Promise<{ queued: number; behind: boolean }[]>((resolve) => {
          const h = window.__livingcity as unknown as Hook;
          const out: { queued: number; behind: boolean }[] = [];
          const end = performance.now() + 3000;
          const step = () => {
            let queued = 0;
            let behind = true;
            const n = h.snapshot().frameRecords;
            for (let i = 0; i < n; i++) {
              const f = h.frameVehicle(i);
              if (!f || f.link !== link || !f.queued) continue;
              const v = h.vehicleDraw(i);
              if (!v || v.link !== link) continue;
              queued++;
              if (v.s > v.stop + 0.05) behind = false;
            }
            out.push({ queued, behind });
            if (performance.now() < end) requestAnimationFrame(step);
            else resolve(out);
          };
          requestAnimationFrame(step);
        }),
      pin.link,
    );
    await attachJson(`queue-${mm}x-frames`, frames);
    for (const f of frames) expect(f.behind, `${mm}×: queued cars held behind the stop line`).toBe(true);
    // not vacuous: queued cars were on the link in enough frames to see them held (the queue may drain at 20×)
    expect(frames.filter((f) => f.queued >= 1).length, `${mm}×: frames with queued cars`).toBeGreaterThanOrEqual(20);
  }
  // release
  await speed(page, 20);
  const pinLinks = (await page.evaluate(() => (window.__livingcity as unknown as Hook).queuePins())).map((p) => p.link);
  await bridgeButton(page).click();
  await expect.poll(async () => (await snap(page)).closed.filter((l) => main.includes(l)).length).toBe(0);
  const s0 = await snap(page);
  const sum = (s: LivingCitySnapshot) => pinLinks.reduce((a, l) => a + (s.linkQueued[l] ?? 0), 0);
  const q0 = sum(s0);
  expect(q0, 'queued on the pinned links at the reopen').toBeGreaterThan(0);
  await expect
    .poll(
      async () => {
        const s = await snap(page);
        return sum(s) <= 0.5 * q0 || s.simTimeS - s0.simTimeS > 15 * 60;
      },
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(true);
  const s1 = await snap(page);
  expect(sum(s1), `queues released within 15 sim min (from ${q0})`).toBeLessThanOrEqual(0.5 * q0);
  expect(await page.evaluate(() => (window.__livingcity as unknown as Hook).closureSigns().length), 'no ring after the reopen').toBe(0);
  await shot(page, 'queue-released');
});

// 3
test('flow_close_and_reopen_main_bridge', async ({ page }) => {
  test.setTimeout(420_000);
  await ready(page);
  const main = await mainBridge(page);
  const markers = () => page.locator('.timeline-intervention').count();
  const entries = (kind: 'close' | 'open') =>
    page.evaluate((k) => (window.__livingcity as unknown as Hook).interventions().filter((e) => e.kind === k && e.label === 'Main Bridge').length, kind);
  for (const m of [1, 20]) {
    await speed(page, m);
    await play(page);
    const [c0, mk0, t0] = [await entries('close'), await markers(), (await snap(page)).tick];
    await bridgeButton(page).click();
    await expect.poll(async () => (await snap(page)).closed, { timeout: 2000 }).toEqual(expect.arrayContaining(main));
    const rings = await page.evaluate(() => (window.__livingcity as unknown as Hook).closureSigns());
    for (const l of main) {
      const mid = (await page.evaluate((x) => window.__livingcity!.linkScreenPoint(x, 0.5), l))!;
      const r = rings.find((x) => x.link === l);
      expect(r, `${m}×: ring on link ${l}`).toBeDefined();
      expect(Math.hypot(r!.page[0] - mid[0], r!.page[1] - mid[1]), `${m}×: ring at the link's middle`).toBeLessThanOrEqual(2);
    }
    await expect.poll(() => entries('close')).toBe(c0 + 1);
    const closeEntry = (await page.evaluate(() => (window.__livingcity as unknown as Hook).interventions())).filter((e) => e.kind === 'close').at(-1)!;
    expect(closeEntry.tick, `${m}×: the closure's tick`).toBeGreaterThanOrEqual(t0);
    await expect.poll(markers).toBe(mk0 + 1);
    await shot(page, `bridge-${m}x-closed`);
    // run at 20×: the bridge empties, never fills again
    await speed(page, 20);
    const onMain = (s: LivingCitySnapshot) => main.reduce((a, l) => a + (s.linkCounts[l] ?? 0), 0);
    let last = onMain(await snap(page));
    const start = (await snap(page)).tick;
    await expect
      .poll(
        async () => {
          const s = await snap(page);
          const now = onMain(s);
          expect(now, `${m}×: no car enters the closed bridge`).toBeLessThanOrEqual(last);
          last = now;
          return now === 0 && s.tick - start >= 300;
        },
        { timeout: 120_000, intervals: [200] },
      )
      .toBe(true);
    // reopen
    await speed(page, m);
    const [o0, mk1] = [await entries('open'), await markers()];
    await bridgeButton(page).click();
    await expect.poll(async () => (await snap(page)).closed.filter((l) => main.includes(l)).length, { timeout: 2000 }).toBe(0);
    await expect.poll(async () => page.evaluate(() => (window.__livingcity as unknown as Hook).closureSigns().length)).toBe(0);
    await expect.poll(() => entries('open')).toBe(o0 + 1);
    await expect.poll(markers).toBe(mk1 + 1);
    await shot(page, `bridge-${m}x-reopened`);
  }
});

// 6
test('flow_side_by_side_compare', async ({ page }) => {
  test.setTimeout(420_000);
  await ready(page);
  const main = await mainBridge(page);
  await speed(page, 20);
  await play(page);
  await bridgeButton(page).click();
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(main));
  const t = (await snap(page)).tick;
  await expect.poll(async () => (await snap(page)).tick, { timeout: 120_000 }).toBeGreaterThan(t + 600);
  await pause(page);
  // the demo's decision: rewind a minute (still after A's closure) and reopen the bridge there, which branches B
  const closeTick = (await page.evaluate(() => (window.__livingcity as unknown as Hook).interventions())).filter((e) => e.kind === 'close').at(-1)!.tick;
  const live = (await snap(page)).tick;
  await page.getByRole('button', { name: '−1 min' }).click();
  await expect.poll(async () => (await snap(page)).timeline.positionTick).toBeLessThan(live);
  expect((await snap(page)).timeline.positionTick, 'rewound to after the closure').toBeGreaterThan(closeTick);
  await page.getByRole('slider', { name: 'Timeline' }).focus();
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'Compare side by side' }).click();
  await expect.poll(async () => (await snap(page)).compare).toBe(true);
  for (const m of [1, 20]) {
    await speed(page, m);
    await play(page);
    const frames = await page.evaluate(
      () =>
        new Promise<{ same: boolean; cams: boolean; pres: boolean }[]>((resolve) => {
          const h = window.__livingcity as unknown as Hook;
          const out: { same: boolean; cams: boolean; pres: boolean }[] = [];
          const end = performance.now() + 3000;
          const step = () => {
            const s = h.snapshot();
            const p = h.diagnostics().presentation;
            const c = s.drawnCameras;
            out.push({
              same: !!s.sides && s.sides.a.tick === s.sides.b.tick,
              cams: !!c && c.a.cx === c.b.cx && c.a.cy === c.b.cy && c.a.zoom === c.b.zoom,
              pres: p.tickB !== null && p.tickA === p.tickB,
            });
            if (performance.now() < end) requestAnimationFrame(step);
            else resolve(out);
          };
          requestAnimationFrame(step);
        }),
    );
    await attachJson(`compare-${m}x-frames`, frames);
    for (const f of frames) {
      expect(f.same, `${m}×: A and B at the same tick`).toBe(true);
      expect(f.cams, `${m}×: linked cameras`).toBe(true);
    }
    expect(frames.filter((f) => f.pres).length / frames.length, `${m}×: one presentation time`).toBeGreaterThanOrEqual(0.95);
    await shot(page, `compare-${m}x`);
  }
  await pause(page);
  await sleep(500);
  const s = await snap(page);
  const cmp = (await page.evaluate(() => (window.__livingcity as unknown as Hook).comparison()))!;
  expect(cmp, 'a comparison').not.toBeNull();
  expect(cmp.tick).toBe(s.sides!.a.tick);
  expect(cmp.tick).toBe(s.sides!.b.tick);
  expect(cmp.a.length).toBe(cmp.b.length);
  expect(cmp.crossings?.baseTick ?? -1).toBeGreaterThanOrEqual(0);
  expect(s.sides!.a.closed).toEqual(expect.arrayContaining(main));
  for (const l of main) expect(s.sides!.b.closed).not.toContain(l);
  const panel = page.getByRole('region', { name: 'Comparison' });
  await expect(panel).toContainText('Incomplete');
  await expect(panel).toContainText('Unserved');
});

