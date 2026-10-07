import type { Bounds } from './geometry';

export const MIN_ZOOM = 0.05; // CSS px per metre
export const MAX_ZOOM = 40;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * 2D camera: world metres (y up) ↔ screen CSS pixels (y down).
 * `zoom` is CSS px per metre; (cx, cy) is the world point at the viewport centre.
 * No easing or inertia: every change applies at once.
 */
export class Camera {
  cx = 0;
  cy = 0;
  zoom = 1;
  width = 1;
  height = 1;

  setViewport(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  worldToScreen(x: number, y: number): [number, number] {
    return [this.width / 2 + (x - this.cx) * this.zoom, this.height / 2 - (y - this.cy) * this.zoom];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [this.cx + (sx - this.width / 2) / this.zoom, this.cy - (sy - this.height / 2) / this.zoom];
  }

  /** Move the content with the pointer by (dx, dy) CSS px. */
  panBy(dxPx: number, dyPx: number): void {
    this.cx -= dxPx / this.zoom;
    this.cy += dyPx / this.zoom;
  }

  /** Zoom by `factor` keeping the world point under (sx, sy) fixed (clamped). */
  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = clampZoom(this.zoom * factor);
    this.cx = wx - (sx - this.width / 2) / this.zoom;
    this.cy = wy + (sy - this.height / 2) / this.zoom;
  }

  /** Center and zoom so that `bounds` fits with `paddingPx` margin. */
  fit(bounds: Bounds, paddingPx: number): void {
    const w = Math.max(1, this.width - 2 * paddingPx);
    const h = Math.max(1, this.height - 2 * paddingPx);
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    this.zoom = clampZoom(Math.min(bw > 0 ? w / bw : Infinity, bh > 0 ? h / bh : Infinity));
    this.cx = (bounds.minX + bounds.maxX) / 2;
    this.cy = (bounds.minY + bounds.maxY) / 2;
  }
}
