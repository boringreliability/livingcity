// Ward core-004: decoding the transferred vehicle buffer.
import { expect, test } from 'vitest';

import { decodeVehicles } from '../src/sim/frame';
import { FLAG_LANE_SHIFT, FLAG_ON_CLOSED_LINK, FLAG_QUEUED, FLAG_STRANDED } from '../src/sim/protocol';

// 6
test('frame decoder reads records', () => {
  // Given two hand-built records
  const words = new Uint32Array(8);
  const f = new Float32Array(words.buffer);
  words[0] = 3;
  f[1] = 12.5;
  f[2] = 0.5;
  words[3] = FLAG_QUEUED | FLAG_ON_CLOSED_LINK | (2 << FLAG_LANE_SHIFT);
  words[4] = 7;
  f[5] = 0;
  f[6] = 13.9;
  words[7] = FLAG_STRANDED;
  // When decoded
  const d = decodeVehicles(words.buffer, 2);
  // Then every field is read back exactly
  expect(d.count).toBe(2);
  expect([d.link[0], d.link[1]]).toEqual([3, 7]);
  expect([d.s[0], d.s[1]]).toEqual([12.5, 0]);
  expect([d.v[0], d.v[1]]).toEqual([0.5, Math.fround(13.9)]);
  expect(d.flags[0]! & FLAG_QUEUED).toBeTruthy();
  expect(d.flags[0]! & FLAG_ON_CLOSED_LINK).toBeTruthy();
  expect(d.flags[1]! & FLAG_STRANDED).toBeTruthy();
  expect([d.lane(0), d.lane(1)]).toEqual([2, 0]);
  // And the views share the buffer (no copies, no per-record objects)
  expect(d.link.buffer).toBe(words.buffer);
  expect(d.s.buffer).toBe(words.buffer);
});
