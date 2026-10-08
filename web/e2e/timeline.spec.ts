// Ward timeline-003, tests 11–19: the timeline bar, scrubbing, branching and scenarios (contract T3).
import { expect, test, type Page } from '@playwright/test';

import type { LivingCitySnapshot } from '../src/ui/testHook';

const snap = (page: Page): Promise<LivingCitySnapshot> => page.evaluate(() => window.__livingcity!.snapshot());
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slider = (page: Page) => page.getByRole('slider', { name: 'Timeline' });
const bar = (page: Page) => page.getByRole('region', { name: 'Replay timeline' });
const position = async (page: Page) => (await snap(page)).timeline.positionTick;

/** Sim time hh:mm:ss of a tick (DT = 0.5 s). */
function hms(tick: number): string {
  const s = Math.floor(tick * 0.5);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

let dialogs = 0;

async function ready(page: Page): Promise<LivingCitySnapshot> {
  dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    void d.dismiss();
  });
  await page.goto('/');
  await expect.poll(async () => page.evaluate(() => window.__livingcity?.snapshot().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1800);
  // the window includes the warm-up (it starts at tick 0); let the head move past a few snapshots
  await expect.poll(async () => (await snap(page)).timeline.headTick, { timeout: 60_000 }).toBeGreaterThan(2400);
  return snap(page);
}

async function pause(page: Page) {
  await blur(page);
  if ((await snap(page)).running) await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).running).toBe(false);
  await sleep(200);
}

/** Press ← (slider focused) `n` times, waiting for each seek frame; returns the position. */
async function stepBack(page: Page, n = 1): Promise<number> {
  await slider(page).focus();
  for (let k = 0; k < n; k++) {
    const p = await position(page);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => position(page)).toBe(p - 120);
  }
  return position(page);
}

// 11
test('timeline_bar_shows_window_and_memory', async ({ page }) => {
  await ready(page);
  await pause(page);
  const s = await snap(page);
  const { windowStartTick: lo, headTick: hi, positionTick: pos, snapshotBytes } = s.timeline;
  await expect(slider(page)).toHaveAttribute('aria-valuemin', String(lo));
  await expect(slider(page)).toHaveAttribute('aria-valuemax', String(hi));
  await expect(slider(page)).toHaveAttribute('aria-valuenow', String(pos));
  await expect(slider(page)).toHaveAttribute('aria-valuetext', `sim time ${hms(pos)}`);
  // memory text is the data, per scenario
  const mib = (snapshotBytes / 1048576).toFixed(1);
  await expect(bar(page).getByText(`${mib} / 48 MiB replay memory`)).toBeVisible();
  // visible sim-time labels for the window start, the head and (after a step back) the playhead
  const back = await stepBack(page);
  expect(back).toBe(hi - 120);
  await expect(bar(page)).toContainText(hms(lo));
  await expect(bar(page)).toContainText(hms(hi));
  await expect(bar(page)).toContainText(hms(hi - 120));
  await expect(bar(page)).toContainText(/sim time/i);
  // the bar and the moved panels never cover the city: every bottom-edge road is the city canvas
  const covered = await page.evaluate(() => {
    const h = window.__livingcity!;
    const city = document.querySelector('canvas.city');
    const n = h.snapshot().linkCounts.length;
    const ys: { l: number; y0: number; y1: number }[] = [];
    for (let l = 0; l < n; l++) {
      const a = h.linkScreenPoint(l, 0);
      const b = h.linkScreenPoint(l, 1);
      if (a && b) ys.push({ l, y0: a[1], y1: b[1] });
    }
    const maxY = Math.max(...ys.map((e) => Math.max(e.y0, e.y1)));
    const bottom = ys.filter((e) => Math.abs(e.y0 - maxY) <= 2 && Math.abs(e.y1 - maxY) <= 2).map((e) => e.l);
    const pts = [...bottom, ...h.snapshot().landmarks!.south_bridge].flatMap((l) => [0.1, 0.5, 0.9].map((t) => h.linkScreenPoint(l, t)));
    return { bottom: bottom.length, covered: pts.filter((p) => !p || document.elementFromPoint(p[0], p[1]) !== city).length };
  });
  expect(covered.bottom).toBeGreaterThanOrEqual(10); // precondition: the full-width bottom road was found
  expect(covered.covered).toBe(0);
});

// 12
test('keyboard_scrub', async ({ page }) => {
  await ready(page);
  // ← while running pauses and goes 1 sim min back from where it was
  expect((await snap(page)).running).toBe(true);
  await slider(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => {
      const s = await snap(page);
      return !s.running && s.timeline.headTick - s.timeline.positionTick >= 120;
    })
    .toBe(true);
  const r = await snap(page);
  expect(r.timeline.headTick - r.timeline.positionTick).toBeLessThanOrEqual(140);
  await page.keyboard.press('End');
  await expect.poll(async () => position(page)).toBe((await snap(page)).timeline.headTick);
  await pause(page);
  // exact arithmetic while paused
  const p0 = await position(page);
  await stepBack(page);
  expect(await position(page)).toBe(p0 - 120);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => position(page)).toBe(p0);
  await page.keyboard.press('Home');
  const lo = (await snap(page)).timeline.windowStartTick;
  await expect.poll(async () => position(page)).toBe(lo);
  // the metrics strip shows the sought sim time
  await expect(page.getByRole('region', { name: 'Simulation metrics' }).locator('.simtime .value')).toHaveText(hms(lo));
  // ← at the window start clamps, without an error
  await page.keyboard.press('ArrowLeft');
  await sleep(300);
  expect(await position(page)).toBe(lo);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('End');
  await expect.poll(async () => position(page)).toBe((await snap(page)).timeline.headTick);
  // the buttons do what they say
  const { headTick: hi, windowStartTick: lo2 } = (await snap(page)).timeline;
  await page.getByRole('button', { name: '−1 min' }).click();
  await expect.poll(async () => position(page)).toBe(hi - 120);
  await page.getByRole('button', { name: '+1 min' }).click();
  await expect.poll(async () => position(page)).toBe(hi);
  await page.getByRole('button', { name: 'Jump to start' }).click();
  await expect.poll(async () => position(page)).toBe(lo2);
  await page.getByRole('button', { name: 'Live' }).click();
  await expect.poll(async () => position(page)).toBe(hi);
});

// 13
test('pointer_scrub', async ({ page }) => {
  await ready(page);
  expect((await snap(page)).running).toBe(true);
  const box = (await slider(page).boundingBox())!;
  const at = (f: number) => [box.x + f * box.width, box.y + box.height / 2] as const;
  // a click while running seeks and pauses
  await page.mouse.click(...at(0.25));
  await expect.poll(async () => (await snap(page)).running).toBe(false);
  const { windowStartTick: lo, headTick: hi } = (await snap(page)).timeline;
  const near = (tick: number, f: number) => Math.abs(tick - (lo + f * (hi - lo))) <= 0.02 * (hi - lo) + 1;
  await expect.poll(async () => near(await position(page), 0.25)).toBe(true);
  // a drag seeks while moving and ends at the release point
  await page.mouse.move(...at(0.8));
  await page.mouse.down();
  const seen = new Set<number>();
  for (let k = 1; k <= 8; k++) {
    await page.mouse.move(...at(0.8 - k * 0.05), { steps: 2 });
    await sleep(120);
    seen.add(await position(page));
  }
  await page.mouse.up();
  await expect.poll(async () => near(await position(page), 0.4)).toBe(true);
  expect(seen.size).toBeGreaterThanOrEqual(3); // it sought during the drag, not only on release
  expect((await snap(page)).timeline.headTick).toBe(hi); // scrubbing never moves the head
});

// 14
test('play_from_the_past_replays_then_continues', async ({ page }) => {
  await ready(page);
  await pause(page);
  await page.getByRole('combobox', { name: 'Speed' }).selectOption({ label: '5×' }); // 10 ticks/s: every tick is in a frame
  await blur(page);
  const s0 = await snap(page);
  const head = s0.timeline.headTick;
  const metricsAtHead = s0.metrics;
  await stepBack(page);
  // capture the metrics in the page at the exact old head while replaying
  await page.evaluate((h) => {
    const w = window as unknown as { __atHead?: Record<string, number> };
    const id = setInterval(() => {
      const s = window.__livingcity!.snapshot();
      if (s.tick === h && !w.__atHead) w.__atHead = { ...s.metrics };
      if (s.tick > h) clearInterval(id);
    }, 2);
  }, head);
  await blur(page);
  await page.keyboard.press('Space'); // play
  await expect.poll(async () => position(page), { timeout: 60_000 }).toBeGreaterThan(head + 20);
  expect((await snap(page)).timeline.headTick).toBeGreaterThan(head);
  const replayed = await page.evaluate(() => (window as unknown as { __atHead?: Record<string, number> }).__atHead ?? null);
  expect(replayed).toEqual(metricsAtHead);
  // the replay caught up: A is at its head again, so an intervention is ordinary (no branch, no prompt)
  await pause(page);
  const caught = await snap(page);
  expect(caught.timeline.positionTick).toBe(caught.timeline.headTick);
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await sleep(300);
  await expect(page.getByText('Replace the branch?')).toHaveCount(0);
  expect((await snap(page)).scenario).toBe('A');
  expect((await snap(page)).branchTick).toBeNull();
  expect((await snap(page)).timeline.headTick).toBe(caught.timeline.headTick);
  await blur(page);
  await page.keyboard.press('Space');
  const central = caught.landmarks!.central_bridge;
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(central));
  expect((await snap(page)).scenario).toBe('A');
});

// 15
test('close_in_the_past_creates_branch', async ({ page }) => {
  const s0 = await ready(page);
  await pause(page);
  const pos = await stepBack(page, 2);
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  const bButton = page.getByRole('button', { name: /^B: branch from \d\d:\d\d:\d\d$/ });
  await expect(bButton).toHaveAccessibleName(`B: branch from ${hms(pos)}`);
  await expect(bButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Viewing B: branch')).toBeVisible();
  await expect(bar(page)).toContainText(`branch ${hms(pos)}`); // the labelled branch marker
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  expect((await snap(page)).branchTick).toBe(pos);
  // B runs and closes the bridge
  await blur(page);
  await page.keyboard.press('Space');
  const central = s0.landmarks!.central_bridge;
  await expect.poll(async () => (await snap(page)).closed).toEqual(expect.arrayContaining(central));
  // switching to A (while B runs) pauses and shows A: its bridge open at its own position
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  expect((await snap(page)).running).toBe(false);
  await expect(page.getByText('Viewing A: original')).toBeVisible();
  const a = await snap(page);
  expect(a.tick).toBe(pos);
  expect(a.closed).not.toContain(central[0]);
  expect(dialogs).toBe(0);
});

// 16
test('replace_branch_needs_confirmation', async ({ page }) => {
  await ready(page);
  await pause(page);
  await stepBack(page);
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  const firstBranch = (await snap(page)).branchTick!;
  await page.getByRole('button', { name: 'A: original' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  const newPos = await stepBack(page);
  expect(newPos).toBe(firstBranch - 120);
  await blur(page);
  // When B is pressed in A's past while B exists
  await page.keyboard.press('b');
  await expect(page.getByText('Replace the branch?')).toBeVisible();
  // Cancel keeps everything
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Replace the branch?')).toHaveCount(0);
  await sleep(300);
  expect((await snap(page)).branchTick).toBe(firstBranch);
  expect((await snap(page)).scenario).toBe('A');
  // Replace makes a new B at the new position
  await blur(page);
  await page.keyboard.press('b');
  await page.getByRole('button', { name: 'Replace the branch' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  expect((await snap(page)).branchTick).toBe(newPos);
  expect(dialogs).toBe(0);
});

// 17
test('discard_branch', async ({ page }) => {
  await ready(page);
  await pause(page);
  await stepBack(page);
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  await page.getByRole('button', { name: 'Discard branch' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('A');
  expect((await snap(page)).branchTick).toBeNull();
  await expect(page.getByRole('button', { name: 'A: original' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^B: branch from/ })).toHaveCount(0);
  await expect(page.getByText(/Viewing [AB]:/)).toHaveCount(0);
  expect(dialogs).toBe(0);
});

// 18
test('timeline_is_keyboard_and_label_accessible', async ({ page }) => {
  await ready(page);
  await pause(page);
  // every timeline control is reachable by Tab, with its accessible name
  await blur(page);
  const targets = {
    Timeline: slider(page),
    'Jump to start': page.getByRole('button', { name: 'Jump to start' }),
    '−1 min': page.getByRole('button', { name: '−1 min' }),
    '+1 min': page.getByRole('button', { name: '+1 min' }),
    Live: page.getByRole('button', { name: 'Live' }),
  };
  const reached = new Set<string>();
  for (let i = 0; i < 60 && reached.size < Object.keys(targets).length; i++) {
    await page.keyboard.press('Tab');
    for (const [name, loc] of Object.entries(targets)) {
      if (await loc.evaluate((el) => el === document.activeElement)) reached.add(name);
    }
  }
  for (const n of Object.keys(targets)) expect(reached, `Tab reaches ${n}`).toContain(n);
  // scenario buttons use aria-pressed, and the viewed scenario is named in text
  await stepBack(page);
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect(page.getByRole('button', { name: 'A: original' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /^B: branch from/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Viewing B: branch')).toBeVisible();
  expect(dialogs).toBe(0);
});

// 19
test('road_panel_in_the_past_branches_and_b_past_edits_b', async ({ page }) => {
  const s0 = await ready(page);
  await pause(page);
  const pos = await stepBack(page);
  await blur(page);
  // the road panel's Close in A's past creates B (no error)
  const road = s0.landmarks!.north_bridge[0];
  const p = (await page.evaluate((l) => window.__livingcity!.linkScreenCenter(l), road))!;
  await page.mouse.click(p[0], p[1]);
  await expect.poll(async () => (await snap(page)).selectedLink).toBe(road);
  await page.getByRole('region', { name: 'Selected road' }).getByRole('button', { name: 'Close link' }).click();
  await expect.poll(async () => (await snap(page)).scenario).toBe('B');
  expect((await snap(page)).branchTick).toBe(pos);
  await sleep(300);
  await expect(page.getByRole('alert')).toHaveCount(0);
  // in B's own past, an intervention edits B: no confirmation, B's head is cut at the position
  await blur(page);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).timeline.headTick, { timeout: 30_000 }).toBeGreaterThan(pos + 240);
  await pause(page);
  const bPos = await stepBack(page);
  await page.getByRole('button', { name: /close the main bridge/i }).click();
  await expect(page.getByText('Replace the branch?')).toHaveCount(0);
  await expect.poll(async () => (await snap(page)).timeline.headTick).toBe(bPos);
  expect((await snap(page)).scenario).toBe('B');
  expect((await snap(page)).branchTick).toBe(pos);
  expect(dialogs).toBe(0);
});
