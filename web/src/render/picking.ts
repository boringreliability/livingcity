import type { Camera } from './camera';
import type { LinkGeom } from './geometry';

/** Distance (world metres) from (px, py) to the segment (x0, y0)–(x1, y1). */
function segmentDistance(px: number, py: number, l: LinkGeom): number {
  const dx = l.x1 - l.x0;
  const dy = l.y1 - l.y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - l.x0) * dx + (py - l.y0) * dy) / len2)) : 0;
  return Math.hypot(px - (l.x0 + t * dx), py - (l.y0 + t * dy));
}

/**
 * The link whose drawn segment is nearest to screen point (sx, sy), among
 * those within `width/2 · zoom + tolerancePx` pixels; ties → lower id.
 */
export function pickLink(
  links: readonly LinkGeom[],
  camera: Camera,
  sx: number,
  sy: number,
  tolerancePx = 8,
): number | null {
  const [wx, wy] = camera.screenToWorld(sx, sy);
  let best: number | null = null;
  let bestPx = Infinity;
  for (const l of links) {
    const px = segmentDistance(wx, wy, l) * camera.zoom;
    if (px <= (l.width / 2) * camera.zoom + tolerancePx && px < bestPx) {
      best = l.id;
      bestPx = px;
    }
  }
  return best;
}
