// Ward core-005: camera, picking and road geometry (pure, no WebGL).
import { describe, expect, test } from 'vitest';

import { Camera, MAX_ZOOM, MIN_ZOOM } from '../src/render/camera';
import { buildRoadGeometry, LANE_WIDTH_M, MEDIAN_GAP_M, vehiclePosition } from '../src/render/geometry';
import { pickLink } from '../src/render/picking';
import type { NetworkArrays } from '../src/sim/protocol';

/** A(0,0) ⇄ B(100,0) (2 lanes each way), A → C(0,50) one-way 1 lane. */
function smallNetwork(): NetworkArrays {
  return {
    nodeXy: new Float32Array([0, 0, 100, 0, 0, 50]),
    nodeIsZone: new Uint8Array([0, 0, 0]),
    linkFrom: new Uint32Array([0, 1, 0]),
    linkTo: new Uint32Array([1, 0, 2]),
    linkLanes: new Uint8Array([2, 2, 1]),
    linkLength: new Float32Array([100, 100, 50]),
    linkSpeed: new Float32Array([13.9, 13.9, 11.1]),
  };
}

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

describe('camera', () => {
  // 1
  test('camera round trip and zoom about cursor', () => {
    const cam = new Camera();
    cam.setViewport(800, 600);
    for (const zoom of [0.1, 1, 7.3]) {
      for (const [cx, cy] of [
        [0, 0],
        [1234, -567],
      ]) {
        cam.zoom = zoom;
        cam.cx = cx!;
        cam.cy = cy!;
        // Then the view centre maps to the screen centre, y up becomes y down
        const [sx, sy] = cam.worldToScreen(cx!, cy!);
        expect(close(sx, 400) && close(sy, 300)).toBe(true);
        expect(cam.worldToScreen(cx!, cy! + 1)[1]).toBeLessThan(300);
        // And screen → world → screen is the identity
        for (const [px, py] of [
          [0, 0],
          [800, 600],
          [123.4, 56.7],
        ]) {
          const [wx, wy] = cam.screenToWorld(px!, py!);
          const [bx, by] = cam.worldToScreen(wx, wy);
          expect(close(bx, px!) && close(by, py!)).toBe(true);
        }
      }
    }
    // When zooming about a cursor, Then the world point under it stays fixed
    cam.zoom = 1;
    cam.cx = 10;
    cam.cy = 20;
    const before = cam.screenToWorld(200, 150);
    cam.zoomAt(200, 150, 2);
    expect(cam.zoom).toBe(2);
    const after = cam.screenToWorld(200, 150);
    expect(close(after[0], before[0]) && close(after[1], before[1])).toBe(true);
    // And zoom is clamped, still about the cursor
    cam.zoomAt(200, 150, 1e9);
    expect(cam.zoom).toBe(MAX_ZOOM);
    const clamped = cam.screenToWorld(200, 150);
    expect(close(clamped[0], before[0]) && close(clamped[1], before[1])).toBe(true);
    cam.zoomAt(200, 150, 1e-12);
    expect(cam.zoom).toBe(MIN_ZOOM);
    // And panning moves the content with the pointer
    cam.zoom = 2;
    const w0 = cam.screenToWorld(400, 300);
    cam.panBy(10, -6);
    const w1 = cam.screenToWorld(410, 294);
    expect(close(w1[0], w0[0]) && close(w1[1], w0[1])).toBe(true);
    // And fit contains the bounds with the padding, tight in one dimension
    cam.fit({ minX: -1000, minY: -500, maxX: 1000, maxY: 500 }, 20);
    const corners = [cam.worldToScreen(-1000, -500), cam.worldToScreen(1000, 500)];
    for (const [x, y] of corners) {
      expect(x!).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(x!).toBeLessThanOrEqual(780 + 1e-6);
      expect(y!).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(y!).toBeLessThanOrEqual(580 + 1e-6);
    }
    const spanX = Math.abs(corners[1]![0] - corners[0]![0]);
    const spanY = Math.abs(corners[1]![1] - corners[0]![1]);
    expect(close(spanX, 760) || close(spanY, 560)).toBe(true);
  });
});

describe('geometry and picking', () => {
  // 3
  test('road geometry offsets two-way pairs', () => {
    const g = buildRoadGeometry(smallNetwork());
    const [ab, ba, ac] = g.links;
    // Then widths are lanes × 3.5 m
    expect([ab!.width, ba!.width, ac!.width]).toEqual([2 * LANE_WIDTH_M, 2 * LANE_WIDTH_M, LANE_WIDTH_M]);
    // And the right-hand normal of an eastbound link points south (world y up)
    expect(close(ab!.nx, 0) && close(ab!.ny, -1)).toBe(true);
    expect(close(ac!.nx, 1) && close(ac!.ny, 0)).toBe(true);
    // And the two directions are shifted to their right by width/2 + gap/2, never overlapping
    expect(close(ab!.y0, -(ab!.width / 2 + MEDIAN_GAP_M / 2))).toBe(true);
    expect(close(ba!.y0, ba!.width / 2 + MEDIAN_GAP_M / 2)).toBe(true);
    const separation = ba!.y0 - ab!.y0;
    expect(separation).toBeGreaterThanOrEqual((ab!.width + ba!.width) / 2 + MEDIAN_GAP_M - 1e-9);
    // And a one-way link stays centered on its node line
    expect([ac!.x0, ac!.y0, ac!.x1, ac!.y1].every((v, i) => close(v, [0, 0, 0, 50][i]!))).toBe(true);
    // And lane 0 is the rightmost lane
    const p0 = vehiclePosition(ab!, 50, 0);
    const p1 = vehiclePosition(ab!, 50, 1);
    expect((p0[0] - p1[0]) * ab!.nx + (p0[1] - p1[1]) * ab!.ny).toBeCloseTo(LANE_WIDTH_M, 9);
    expect(close(p0[0], 50)).toBe(true);
    // And s runs along the simulation length to the drawn end
    const end = vehiclePosition(ab!, ab!.length, 0);
    expect(close(end[0], ab!.x1)).toBe(true);
    // And the bounds contain every node
    expect(g.bounds.minX).toBeLessThanOrEqual(0);
    expect(g.bounds.maxX).toBeGreaterThanOrEqual(100);
    expect(g.bounds.maxY).toBeGreaterThanOrEqual(50);
  });

  // 2
  test('picking selects nearest link within tolerance', () => {
    const g = buildRoadGeometry(smallNetwork());
    const cam = new Camera();
    cam.setViewport(400, 400);
    cam.cx = 50;
    cam.cy = 0;
    cam.zoom = 4;
    const at = (x: number, y: number) => cam.worldToScreen(x, y);
    // Then each direction picks its own drawn lane
    expect(pickLink(g.links, cam, ...at(50, -4))).toBe(0);
    expect(pickLink(g.links, cam, ...at(50, 4))).toBe(1);
    // And an exact tie picks the lower id
    expect(pickLink(g.links, cam, ...at(50, 0))).toBe(0);
    // And the one-way link is picked near its centerline
    expect(pickLink(g.links, cam, ...at(0.5, 25))).toBe(2);
    // And nothing is picked outside the tolerance
    expect(pickLink(g.links, cam, ...at(50, 30))).toBeNull();
    // And the tolerance scales with zoom (width in px) plus a fixed pixel margin
    expect(pickLink(g.links, cam, ...at(50, 15))).toBeNull();
    cam.zoom = 0.5;
    expect(pickLink(g.links, cam, ...at(50, 15))).toBe(1);
  });
});

// Tests 14–16: proposed and verified by the Red reviewer, round 1 (U2, U6, U13, U16).
/** A(0,0) → B(100,0) → C(200,0), collinear one-way links; plus a diagonal pair A ⇄ D(30,40) (sim length 60 ≠ 50). */
function lineNetwork(): NetworkArrays {
  return {
    nodeXy: new Float32Array([0, 0, 100, 0, 200, 0, 30, 40]),
    nodeIsZone: new Uint8Array(4),
    linkFrom: new Uint32Array([0, 1, 0, 3]),
    linkTo: new Uint32Array([1, 2, 3, 0]),
    linkLanes: new Uint8Array([1, 1, 1, 1]),
    linkLength: new Float32Array([100, 100, 60, 60]),
    linkSpeed: new Float32Array([10, 10, 10, 10]),
  };
}

test('fix U16: picking measures distance to the segment, not to its infinite line', () => {
  const g = buildRoadGeometry(lineNetwork());
  const cam = new Camera();
  cam.setViewport(800, 400);
  cam.cx = 100;
  cam.cy = 0;
  cam.zoom = 2;
  // Clicking the middle of B→C (id 1) must not pick the collinear, lower-id A→B (id 0)
  expect(pickLink(g.links, cam, ...cam.worldToScreen(150, 0))).toBe(1);
  // And a point beyond the end of the line picks nothing
  expect(pickLink(g.links, cam, ...cam.worldToScreen(260, 0))).toBeNull();
});

test('fix U2/U6: both endpoints are shifted, and s maps by the simulation length', () => {
  const g = buildRoadGeometry(lineNetwork());
  const ad = g.links[2]!;
  const off = ad.width / 2 + MEDIAN_GAP_M / 2;
  // unit right normal of (30, 40)/50 is (0.8, −0.6)
  expect(close(ad.nx, 0.8) && close(ad.ny, -0.6)).toBe(true);
  expect([ad.x0, ad.y0, ad.x1, ad.y1].every((v, i) => close(v, [0.8 * off, -0.6 * off, 30 + 0.8 * off, 40 - 0.6 * off][i]!))).toBe(true);
  // s = length_sim reaches the drawn end even though the drawn length (50) differs from the sim length (60)
  const end = vehiclePosition(ad, 60, 0);
  expect(close(end[0], ad.x1) && close(end[1], ad.y1)).toBe(true);
  const mid = vehiclePosition(ad, 30, 0);
  expect(close(mid[0], (ad.x0 + ad.x1) / 2) && close(mid[1], (ad.y0 + ad.y1) / 2)).toBe(true);
});

test('fix U13: fit clamps the zoom', () => {
  const cam = new Camera();
  cam.setViewport(800, 600);
  cam.fit({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 10);
  expect(cam.zoom).toBe(MAX_ZOOM);
  cam.fit({ minX: -1e7, minY: -1e7, maxX: 1e7, maxY: 1e7 }, 10);
  expect(cam.zoom).toBe(MIN_ZOOM);
});
