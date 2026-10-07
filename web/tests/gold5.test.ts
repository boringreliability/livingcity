// Ward core-005 Gold, regression tests for Gold review r1 findings (added in
// Gold; no approved Red test was changed).
import { expect, test } from 'vitest';

import { HOVER_HALO_PX, MOVING_MIN_PX, QUEUED_MIN_PX, SELECTED_HALO_PX } from '../src/render/renderer';

test('G2 queued and moving vehicles keep distinct shapes when zoomed out (not colour alone)', () => {
  // Given the minimum on-screen sizes (CSS px) used when the metric size would be smaller
  const movingAspect = MOVING_MIN_PX[0] / MOVING_MIN_PX[1];
  const queuedAspect = QUEUED_MIN_PX[0] / QUEUED_MIN_PX[1];
  // Then moving vehicles are long and slim, queued ones square-ish and wider
  expect(movingAspect).toBeGreaterThanOrEqual(2.5);
  expect(queuedAspect).toBeLessThanOrEqual(1.1);
  expect(QUEUED_MIN_PX[1] - MOVING_MIN_PX[1]).toBeGreaterThanOrEqual(1.5);
  // And the queued vehicle is large enough to show a ≥1 px brake band and still its body colour
  expect(QUEUED_MIN_PX[0]).toBeGreaterThanOrEqual(3);
});

test('G1 selection and hover halos are at least 2 CSS px and differ', () => {
  expect(SELECTED_HALO_PX).toBeGreaterThanOrEqual(2);
  expect(HOVER_HALO_PX).toBeGreaterThanOrEqual(2);
  expect(SELECTED_HALO_PX).toBeGreaterThanOrEqual(HOVER_HALO_PX);
});
