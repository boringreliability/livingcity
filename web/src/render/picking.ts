import type { Camera } from './camera';
import type { LinkGeom } from './geometry';

/**
 * The link whose drawn segment is nearest to screen point (sx, sy), among
 * those within `width/2 · zoom + tolerancePx` pixels; ties → lower id.
 */
export function pickLink(
  _links: readonly LinkGeom[],
  _camera: Camera,
  _sx: number,
  _sy: number,
  _tolerancePx = 8,
): number | null {
  throw new Error('not implemented');
}
