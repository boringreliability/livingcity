// Ward motion-002, Gold r1 regression (M1) with the Red r6 fix tests: without animation frames (a hidden
// tab) the presenter's frame history stays bounded, and presenting resumes near the newest frame; the bound
// never fires during normal playback (also at 60× after a 1 s worker stall), also with a shared clock.
import { describe, expect, test } from 'vitest';

import type { LinkGeom } from '../src/render/geometry';
import { PresentationClock, Presenter, type PresentClockInput } from '../src/render/presentation';
import { decodeVehicles } from '../src/sim/frame';
import { DT } from '../src/sim/protocol';

/** The history bound (presentation.ts MAX_KEPT). */
const BOUND = 128;
// one straight 200 m link, one lane
const LINK: LinkGeom = { id: 0, x0: 0, y0: 0, x1: 200, y1: 0, nx: 0, ny: -1, width: 3.5, lanes: 1, length: 200 };
const run = (m: number): PresentClockInput => ({ running: true, multiplier: m, achievedTicksPerS: 2 * m, behind: false });
/** Frame position of car i at `tick`: inside the link, away from both end zones (drawn at exactly s). */
const sAt = (tick: number, i: number) => 20 + ((tick + i) % 150);

function frame(tick: number, cars: number, compare = false, scenario: 0 | 1 = 0) {
  const words = new Uint32Array(cars * 4);
  const f32 = new Float32Array(words.buffer);
  for (let i = 0; i < cars; i++) {
    words[i * 4] = 0;
    f32[i * 4 + 1] = sAt(tick, i);
  }
  return { tick, scenario, world: 1, epoch: 1, compare, vehicles: decodeVehicles(words.buffer, cars), tripIds: Uint32Array.from({ length: cars }, (_, i) => i + 1) };
}
/** The tick the worker reached after `ms` of wall time at `m`× (DT = 0.5 s: 2·m ticks per second). */
const tickAt = (ms: number, m: number) => 1000 + Math.floor((ms * 2 * m) / 1000);

describe('motion-002 gold regression', () => {
  test('history_stays_bounded_without_animation_frames', () => {
    const p = new Presenter([LINK], [0], [1]);
    let most = 0;
    let last = 0;
    // 20× for 60 s of wall time, a frame every 16 ms, and no advance at all (a hidden tab)
    for (let k = 0; k < 3750; k++) {
      last = tickAt(k * 16, 20);
      p.push(frame(last, 500), k * 16, run(20));
      most = Math.max(most, p.retainedFrames());
    }
    expect(most, 'frames held without advance').toBeLessThanOrEqual(BOUND);
    // back in view: presenting resumes near the newest frame (never ahead of it), every car drawn at its frame
    const P = p.advance(3750 * 16 + 16);
    expect(P).toBeLessThanOrEqual(last * DT + 1e-9);
    expect(P, 'resumes near the newest frame (not frozen on an old history)').toBeGreaterThanOrEqual(last * DT - 4 * DT);
    expect(p.vehicles().length).toBe(500);
    for (let n = 1; n <= 60; n++) p.advance(3750 * 16 + 16 + n * 16);
    expect(p.vehicle(1)!.s, 'trip 1 at the newest frame').toBeCloseTo(sAt(last, 0), 4);
  });

  test('history_stays_bounded_with_empty_frames', () => {
    const p = new Presenter([LINK], [0], [1]);
    for (let k = 0; k < 2000; k++) p.push(frame(tickAt(k * 16, 20), 0), k * 16, run(20));
    expect(p.retainedFrames()).toBeLessThanOrEqual(BOUND);
  });

  test('history_stays_bounded_in_compare', () => {
    const clock = new PresentationClock();
    const a = new Presenter([LINK], [0], [1], clock);
    const b = new Presenter([LINK], [0], [1], clock);
    let most = 0;
    let last = 0;
    for (let k = 0; k < 2000; k++) {
      last = tickAt(k * 16, 20);
      a.push(frame(last, 100, true, 0), k * 16, run(20));
      b.push(frame(last, 100, true, 1), k * 16 + 1, run(20));
      most = Math.max(most, a.retainedFrames(), b.retainedFrames());
    }
    expect(most).toBeLessThanOrEqual(BOUND);
    const now = 2000 * 16 + 16;
    const PA = a.advance(now);
    const PB = b.advance(now);
    expect(PA, 'one presentation time').toBe(PB);
    expect(PA).toBeLessThanOrEqual(last * DT + 1e-9);
    expect(PA).toBeGreaterThanOrEqual(last * DT - 4 * DT);
  });

  for (const [m, stallMs] of [
    [20, 0],
    [60, 0],
    [60, 1000],
  ] as const)
    test(`normal_playback_never_hits_the_bound (${m}×${stallMs ? `, ${stallMs} ms worker stall` : ''})`, () => {
      // frames every 16 ms carry the tick the worker reached; a stall posts nothing, then one frame with the
      // backlog (the SimClock caps it at 1 s of ticks); an animation frame every 16 ms (100 ms around the
      // stall). P must never fall back or jump (a reset by the bound would jump to the newest frame).
      const p = new Presenter([LINK], [0], [1]);
      let most = 0;
      let lastP: number | null = null;
      let lastN = 0;
      const stallAt = 2000;
      let nextDraw = 8;
      for (let ms = 0; ms < 8000; ms += 16) {
        const stalled = stallMs > 0 && ms >= stallAt && ms < stallAt + stallMs;
        if (!stalled) p.push(frame(tickAt(ms, m), 50), ms, run(m));
        while (nextDraw <= ms + 16) {
          const P = p.advance(nextDraw);
          if (lastP !== null) {
            expect(P, `${m}×: P never falls back`).toBeGreaterThanOrEqual(lastP - 1e-9);
            expect(P - lastP, `${m}×: P never jumps (no reset by the bound)`).toBeLessThanOrEqual(1.5 * (m / 1000) * (nextDraw - lastN) + 1e-9);
          }
          lastP = P;
          lastN = nextDraw;
          nextDraw += stalled ? 100 : 16;
          most = Math.max(most, p.retainedFrames());
        }
      }
      expect(most, `${m}×: history in normal playback`).toBeLessThan(BOUND / 2);
    });
});
