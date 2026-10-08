// Ward city-005: the living opening screen, diagnostics, the unserved metric, stress demand
// and the full River City demo (tests 6–11, 15).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MIN_S = 60;

async function ready(page: Page, url = '/'): Promise<LivingCitySnapshot> {
  await page.goto(url);
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(10);
  return snap(page);
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
  await sleep(300);
}

async function resume(page: Page) {
  await blur(page);
  if (!(await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(true);
}

/** Mean absolute grayscale difference between two canvas screenshots. */
async function canvasDiff(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const lum = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const out: number[] = [];
        for (let i = 0; i < d.length; i += 4) out.push(0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!);
        return out;
      };
      const [p, q] = [await lum(x), await lum(y)];
      return p.reduce((acc, v, i) => acc + Math.abs(v - q[i]!), 0) / p.length;
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

// 6
test('opening_screen_is_alive', async ({ page }) => {
  // Given a fresh load
  const t0 = Date.now();
  await page.goto('/');
  // Then within 5 s the strip shows sim time ≥ 15:00 and ≥ 300 vehicles are on the network
  const simTime = page.getByRole('region', { name: 'Simulation metrics' }).locator('.simtime .value');
  await expect
    .poll(
      async () => {
        const text = (await simTime.textContent()) ?? '';
        const m = /^(\d\d):(\d\d):(\d\d)$/.exec(text.trim());
        const s = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
        const onNet = await page.evaluate(() => window.__livingcity?.snapshot().metrics['on_network'] ?? 0);
        return s >= 15 * MIN_S && onNet >= 300;
      },
      { timeout: 5_000, intervals: [100] },
    )
    .toBe(true);
  expect(Date.now() - t0).toBeLessThanOrEqual(5_500);
  // and the hook agrees: the first frames are at or after the warm-up's 1,800 ticks
  expect((await snap(page)).tick).toBeGreaterThanOrEqual(1800);
  // and the city moves: two canvas screenshots 1 s apart differ
  const canvas = page.locator('canvas').first();
  const a = await canvas.screenshot();
  await sleep(1000);
  const b = await canvas.screenshot();
  expect(await canvasDiff(page, a, b)).toBeGreaterThan(0.05);
});

// 7
test('diagnostics_panel_toggle', async ({ page }) => {
  await ready(page);
  const toggle = page.getByRole('button', { name: 'Diagnostics' });
  const region = page.getByRole('region', { name: 'Diagnostics' });
  // Given the default state: collapsed
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(region).toHaveCount(0);
  // When D is pressed (no control focused)
  await blur(page);
  await page.keyboard.press('d');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(region).toBeVisible();
  // Then within 2 s it shows sim tick and render interval median/p95 as numbers, separately
  const pair = (testId: string) =>
    region.getByTestId(testId).textContent().then((t) => {
      const m = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*ms/.exec(t ?? '');
      return m ? [Number(m[1]), Number(m[2])] : null;
    });
  await expect
    .poll(
      async () => {
        const tick = await pair('diag-tick');
        const render = await pair('diag-render');
        const measured = Number(((await region.getByTestId('diag-ticks-measured').textContent()) ?? '').replace(/[^\d]/g, ''));
        return tick !== null && render !== null && render[0]! > 1 && render[0]! < 1000 && render[1]! >= render[0]! && tick[1]! >= tick[0]! && measured > 0;
      },
      { timeout: 2_000, intervals: [100] },
    )
    .toBe(true);
  for (const id of ['diag-encode', 'diag-draw', 'diag-vehicles', 'diag-bytes', 'diag-speed']) {
    await expect(region.getByTestId(id)).toHaveText(/\d/);
  }
  // and the vehicle row shows the hook's numbers (it updates with frames)
  await pause(page);
  const d = await page.evaluate(() => window.__livingcity!.diagnostics());
  await expect(region.getByTestId('diag-vehicles')).toContainText(String(d.onNetwork));
  await expect(region.getByTestId('diag-vehicles')).toContainText(String(d.active));
  // When D is pressed again, it collapses; the button opens it again
  await blur(page);
  await page.keyboard.press('d');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(region).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // and D typed while a control has focus does nothing; a held D toggles once
  await page.getByRole('combobox').first().focus();
  await page.keyboard.press('d');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await blur(page);
  await page.keyboard.down('d');
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', repeat: true, bubbles: true }));
  });
  await page.keyboard.up('d');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

// 8
test('unserved_metric_shown_and_defined', async ({ page }) => {
  await ready(page);
  const strip = page.getByRole('region', { name: 'Simulation metrics' });
  // Then the strip shows "unserved" (and no longer "unreachable")
  const metric = strip.locator('.metric', { hasText: /unserved/i });
  await expect(metric).toHaveCount(1);
  await expect(metric.locator('.label')).toHaveText('unserved ⓘ');
  await expect(strip).not.toContainText(/unreachable/i);
  // with its definition as the tooltip
  const title = (await metric.getAttribute('title')) ?? '';
  expect(title).toContain('Trips the city could not serve');
  expect(title).toMatch(/no route at the origin/);
  expect(title).toMatch(/stranded/);
  expect(title).toMatch(/10 minutes in gridlock/);
  // and its value is the simulation's `unserved`
  await pause(page);
  const s = await snap(page);
  expect(s.metrics['unserved']).toBeDefined();
  await expect(metric.locator('.value')).toHaveText(String(s.metrics['unserved']));
});

// 9
test('stress_badge_for_scaled_demand', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  // Given ?demand=3
  await ready(page, '/?demand=3');
  // Then the badge says so (and never calls it realistic)
  await expect(page.getByText('stress test ×3')).toBeVisible();
  await expect(page.getByText(/realistic/i)).toHaveCount(0);
  expect((await snap(page)).demandScale).toBe(3);
  // Given an invalid value
  await ready(page, '/?demand=abc');
  // Then there is no badge, the scale is 1 and a console warning explains it
  await expect(page.getByText(/stress test/i)).toHaveCount(0);
  expect((await snap(page)).demandScale).toBe(1);
  expect(warnings.some((w) => /demand/i.test(w))).toBe(true);
  // and out-of-range values fall back too
  await ready(page, '/?demand=7');
  await expect(page.getByText(/stress test/i)).toHaveCount(0);
  expect((await snap(page)).demandScale).toBe(1);
  // and a plain load has no badge
  await ready(page, '/');
  await expect(page.getByText(/stress test/i)).toHaveCount(0);
  expect((await snap(page)).demandScale).toBe(1);
});

/** Occupancy (vehicles ÷ capacity) of the links, from the hook. */
async function spillback(page: Page): Promise<{ approach: number; feeder: number } | null> {
  return page.evaluate(() => {
    const h = window.__livingcity!;
    const s = h.snapshot();
    const lm = s.landmarks!;
    const occ = (l: number) => s.linkCounts[l]! / h.linkCapacity(l);
    for (const bridge of [...lm.south_bridge, ...lm.north_bridge]) {
      for (const a of h.approachLinks(bridge)) {
        if (occ(a) < 0.8) continue;
        for (const f of h.approachLinks(a)) if (occ(f) >= 0.2) return { approach: a, feeder: f };
      }
    }
    return null;
  });
}

// 10
test('full_demo_on_river_city', async ({ page }) => {
  test.setTimeout(240_000);
  // Given the opening city, running at 20×
  const s0 = await ready(page);
  expect(s0.running).toBe(true);
  const t0 = s0.tick;
  await expect.poll(async () => (await snap(page)).tick, { timeout: 10_000 }).toBeGreaterThan(t0 + 40);
  const before = await snap(page);
  const queued0 = before.metrics['queued']!;
  const lm = before.landmarks!;
  // When the main bridge is closed with the prominent button
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).closed, { timeout: 10_000 }).toEqual(expect.arrayContaining(lm.central_bridge));
  const closedAt = (await snap(page)).tick;
  // Then within 10 sim minutes queued doubles and an Old/North Bridge approach spills back
  let doubled = false;
  let spilled: { approach: number; feeder: number } | null = null;
  await expect
    .poll(
      async () => {
        const s = await snap(page);
        doubled ||= s.metrics['queued']! >= 2 * Math.max(1, queued0);
        spilled ??= await spillback(page);
        if (s.tick - closedAt > 10 * MIN_S * 2) return 'timeout';
        return doubled && spilled ? 'ok' : 'waiting';
      },
      { timeout: 90_000, intervals: [250] },
    )
    .toBe('ok');
  // When a car on the Old Bridge is picked and followed
  await pause(page);
  const target = await page.evaluate((old) => {
    const h = window.__livingcity!;
    const n = h.snapshot().frameRecords;
    for (let i = 0; i < n; i++) {
      const v = h.frameVehicle(i);
      if (v && (old as number[]).includes(v.link)) return { record: i, link: v.link };
    }
    return null;
  }, lm.south_bridge);
  expect(target).not.toBeNull();
  // zoom in on it (picking needs ≥ 1 px/m), then click it
  const box = (await page.locator('canvas').first().boundingBox())!;
  await expect
    .poll(async () => {
      if ((await snap(page)).camera.zoom >= 1.2) return true;
      const p = await page.evaluate((r) => window.__livingcity!.vehicleScreenCenter(r), target!.record);
      const at = p && p[0] > box.x + 40 && p[0] < box.x + box.width - 40 && p[1] > box.y + 160 && p[1] < box.y + box.height - 160 ? p : null;
      const [x, y] = at ?? (await page.evaluate((l) => window.__livingcity!.linkScreenCenter(l), target!.link))!;
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, -100);
      return false;
    }, { intervals: [150], timeout: 30_000 })
    .toBe(true);
  await page.mouse.move(5, 400);
  await sleep(200);
  const at = (await page.evaluate((r) => window.__livingcity!.vehicleScreenCenter(r), target!.record))!;
  expect(await page.evaluate(([x, y]) => window.__livingcity!.pickAt(x, y).vehicle, at)).toBe(target!.record);
  await page.mouse.click(at[0], at[1]);
  await expect.poll(async () => (await snap(page)).trackedTrip).not.toBeNull();
  const trip = (await snap(page)).trackedTrip;
  await page.getByRole('button', { name: /^follow$/i }).click();
  await expect.poll(async () => (await snap(page)).following).toBe(true);
  // Then, running again, Follow keeps the car near the canvas centre
  await resume(page);
  await sleep(1500);
  const centre = [box.x + box.width / 2, box.y + box.height / 2];
  // (1.5 s at 20× is ~30 sim s: far shorter than any trip, so the car is still tracked)
  expect((await snap(page)).trackedTrip).toBe(trip);
  expect((await snap(page)).following).toBe(true);
  const p = await page.evaluate(() => window.__livingcity!.trackedScreenCenter());
  expect(p).not.toBeNull();
  expect(Math.hypot(p![0] - centre[0]!, p![1] - centre[1]!)).toBeLessThanOrEqual(40);
  // When the bridge is reopened
  await page.keyboard.press('Escape');
  await blur(page);
  const q1 = (await snap(page)).metrics['queued']!;
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).closed, { timeout: 10_000 }).toEqual([]);
  const reopenedAt = (await snap(page)).tick;
  // Then queued falls to ≤ 0.6 × its value at the reopen within 10 sim minutes
  await expect
    .poll(
      async () => {
        const s = await snap(page);
        if (s.metrics['queued']! <= 0.6 * q1) return 'ok';
        return s.tick - reopenedAt > 10 * MIN_S * 2 ? 'timeout' : 'waiting';
      },
      { timeout: 90_000, intervals: [250] },
    )
    .toBe('ok');
});

// 11
test('controls_responsive_under_load', async ({ page }) => {
  // Given 5× demand at 20×
  await ready(page, '/?demand=5');
  await expect.poll(async () => (await snap(page)).metrics['on_network']!, { timeout: 30_000 }).toBeGreaterThan(2000);
  expect((await snap(page)).running).toBe(true);
  // When Space is pressed
  await blur(page);
  await page.keyboard.press('Space');
  // Then within 300 ms of wall time frames stop advancing
  await sleep(300);
  const a = (await snap(page)).tick;
  await sleep(600);
  const b = await snap(page);
  expect(b.tick).toBe(a);
  expect(b.running).toBe(false);
  // and the panel buttons respond promptly
  const bridge = page.getByRole('button', { name: /close the main bridge/i });
  const t0 = Date.now();
  await bridge.click();
  await expect(bridge).toContainText(/pending/i, { timeout: 1_000 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await snap(page)).running, { timeout: 1_000 }).toBe(true);
  expect(Date.now() - t0).toBeLessThan(2_500);
});

// 15 (supersedes review1.spec.ts "fix G4": user decision 2026-10-08, see ward city-005)
test('fix G4 (superseded in city-005): closing the main bridge changes its grayscale appearance', async ({ page }) => {
  const s0 = await ready(page);
  const central = s0.landmarks!.central_bridge;
  const speed = page.getByRole('combobox').first();
  await speed.selectOption({ label: '1×' });
  // vehicles are not drawn: the bridge's look alone must change (the warm-up leaves cars on it)
  await page.evaluate(() => window.__livingcity!.setDebug({ hideVehicles: true }));
  const clip = async () => {
    const [a, b] = await Promise.all(central.map((l) => page.evaluate((x) => window.__livingcity!.linkScreenCenter(x), l)));
    const cx = (a![0] + b![0]) / 2;
    const cy = (a![1] + b![1]) / 2;
    return page.screenshot({ clip: { x: cx - 30, y: cy - 8, width: 60, height: 16 } });
  };
  // Given the open bridge while paused
  await pause(page);
  const open = await clip();
  // When it is closed (commands apply on the next tick: core-004 G4b) and paused again
  await resume(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(central));
  await pause(page);
  const closed = await clip();
  // Then the bridge looks clearly different in grayscale
  expect(await canvasDiff(page, open, closed)).toBeGreaterThan(15);
});
