import type { Bounds } from './geometry';

export const MIN_ZOOM = 0.05; // CSS px per metre
export const MAX_ZOOM = 40;

/**
 * 2D camera: world metres (y up) ↔ screen CSS pixels (y down).
 * `zoom` is CSS px per metre; (cx, cy) is the world point at the viewport centre.
 */
export class Camera {
  cx = 0;
  cy = 0;
  zoom = 1;
  width = 1;
  height = 1;

  setViewport(_width: number, _height: number): void {
    throw new Error('not implemented');
  }

  worldToScreen(_x: number, _y: number): [number, number] {
    throw new Error('not implemented');
  }

  screenToWorld(_sx: number, _sy: number): [number, number] {
    throw new Error('not implemented');
  }

  panBy(_dxPx: number, _dyPx: number): void {
    throw new Error('not implemented');
  }

  /** Zoom by `factor` keeping the world point under (sx, sy) fixed (clamped). */
  zoomAt(_sx: number, _sy: number, _factor: number): void {
    throw new Error('not implemented');
  }

  /** Center and zoom so that `bounds` fits with `paddingPx` margin. */
  fit(_bounds: Bounds, _paddingPx: number): void {
    throw new Error('not implemented');
  }
}
