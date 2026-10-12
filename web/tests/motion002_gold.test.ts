// Ward motion-002, Gold r1 regression (M1): without animation frames (a hidden tab) the presenter's frame
// history stays bounded, and presenting resumes from the newest frame.
import { describe, expect, test } from 'vitest';

import type { LinkGeom } from '../src/render/geometry';
import { Presenter, type PresentClockInput } from '../src/render/presentation';
import { decodeVehicles } from '../src/sim/frame';
import { DT } from '../src/sim/protocol';

// one straight 200 m link, one lane
const LINK: LinkGeom = { id: 0, x0: 0, y0: 0, x1: 200, y1: 0, nx: 0, ny: -1, width: 3.5, lanes: 1, length: 200 };
const RUN: PresentClockInput = { running: true, multiplier: 20, achievedTicksPerS: 40, behind: false };

function frame(tick: number, cars: number) {
  const words = new Uint32Array(cars * 4);
  const f32 = new Float32Array(words.buffer);
  for (let i = 0; i < cars; i++) {
    words[i * 4] = 0;
    f32[i * 4 + 1] = 20 + ((tick + i) % 150);
  }
  return { tick, scenario: 0 as const, world: 1, epoch: 1, compare: false, vehicles: decodeVehicles(words.buffer, cars), tripIds: Uint32Array.from({ length: cars }, (_, i) => i + 1) };
}

describe('motion-002 gold regression', () => {
  test('history_stays_bounded_without_animation_frames', () => {
    const p = new Presenter([LINK], [0], [1]);
    let most = 0;
    // 20× for 60 s of wall time, a frame every 16 ms, and no advance at all (a hidden tab)
    for (let k = 0; k < 3750; k++) {
      p.push(frame(1000 + k, 500), k * 16, RUN);
      most = Math.max(most, p.retainedFrames());
    }
    expect(most, 'frames held without advance').toBeLessThanOrEqual(48);
    // back in view: presenting resumes at most at the newest frame, with every car drawn
    const P = p.advance(3750 * 16 + 16);
    expect(P).toBeLessThanOrEqual((1000 + 3749) * DT + 1e-9);
    expect(p.vehicles().length).toBe(500);
  });

  test('history_stays_bounded_with_empty_frames', () => {
    const p = new Presenter([LINK], [0], [1]);
    for (let k = 0; k < 500; k++) p.push(frame(10 + k, 0), k * 16, RUN);
    expect(p.retainedFrames()).toBeLessThanOrEqual(48);
  });

  test('normal_playback_never_hits_the_bound', () => {
    // 20× = 40 ticks/s: a frame every 16 ms carries the tick the worker reached; with an animation frame
    // in between, the history stays small (no reset ever fires)
    const p = new Presenter([LINK], [0], [1]);
    let most = 0;
    for (let k = 0; k < 600; k++) {
      p.push(frame(1000 + Math.floor((k * 16) / 25), 50), k * 16, RUN);
      p.advance(k * 16 + 8);
      most = Math.max(most, p.retainedFrames());
    }
    expect(most).toBeLessThan(16);
  });
});
